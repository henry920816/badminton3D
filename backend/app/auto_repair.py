import math
from datetime import datetime
from itertools import combinations

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .db import get_db
from .repair_geometry import (
    cameras_by_index_for_match, observation_dict, status_map, bad_count,
    single_frame_grid, projection_error, camera_image_bounds,
    project_inside_image, robust_threshold, leave_one_out_errors,
    ransac_consensus_observations, robust_multiview_candidate,
    best_safe_replacement_subset,
)
from .models import BallPosition2D, BallPosition2DCorrection, BallTraj, Match, Hit, TrajectoryRepairHistory
from .triangulation import project_raw_point, scan_2d_camera_grid, triangulate_observations
from .ball2d_reference import attach_reference_3d, reference_evidence
from .ball2d_corrections import load_ball_2d_rows
from .edit_history import make_batch
from .quality2d_temporal import attach_temporal_evidence, assess_temporal_candidate


router = APIRouter()

MAX_AUTO_REPAIR_FRAMES = 6000


class AutoRepair2DPayload(BaseModel):
    start_frame: int
    end_frame: int
    dry_run: bool = False
    source: str = "corrected"


@router.post("/matches/{match_id}/traj2d/auto-repair")
def auto_repair_traj_2d(
    match_id: int,
    payload: AutoRepair2DPayload,
    db: Session = Depends(get_db),
):
    match = db.query(Match).filter(Match.id == match_id).with_for_update().first()

    if match is None:
        raise HTTPException(status_code=404, detail="match not found")

    start_frame = int(payload.start_frame)
    end_frame = int(payload.end_frame)

    if start_frame < 0 or end_frame < start_frame:
        raise HTTPException(
            status_code=400,
            detail="start_frame / end_frame 範圍無效",
        )

    if end_frame - start_frame > MAX_AUTO_REPAIR_FRAMES:
        raise HTTPException(
            status_code=400,
            detail=f"範圍太大，最多 {MAX_AUTO_REPAIR_FRAMES} frames",
        )

    cameras_by_index = cameras_by_index_for_match(match)

    if len(cameras_by_index) < 2:
        raise HTTPException(status_code=400, detail="可用相機不足")

    # All decisions use the same corrected 2D overlay as the quality grid.
    # Original points are never modified by this endpoint.
    if payload.source != "corrected":
        raise HTTPException(status_code=400, detail="自動修正請使用 corrected 2D 來源（原始標註會保留）")

    rows = load_ball_2d_rows(
        db, match_id, start_frame, end_frame, source="corrected", visible_only=True,
    )
    observations_by_frame = {}
    for row in rows:
        camera_index = int(row["camera_index"])
        if camera_index not in cameras_by_index:
            continue
        frame = int(row["frame"])
        observations_by_frame.setdefault(frame, []).append({
            "camera_index": camera_index,
            "x": float(row["x"]),
            "y": float(row["y"]),
            "corrected": bool(row.get("corrected")),
        })

    # The preexisting correction layer is snapshotted so undo can restore it.
    preexisting_corrections = {
        (int(row.frame), int(row.camera_index)): row
        for row in db.query(BallPosition2DCorrection).filter(
            BallPosition2DCorrection.match_id == match_id,
            BallPosition2DCorrection.frame >= start_frame,
            BallPosition2DCorrection.frame <= end_frame,
        ).all()
    }
    nearby_hits = {
        int(row.new_hit_frame if row.new_hit_frame is not None else row.hit_frame)
        for row in db.query(Hit).filter(
            Hit.match_id == match_id,
            Hit.hit_frame >= start_frame - 3,
            Hit.hit_frame <= end_frame + 3,
        )
    }
    observations_snapshot = {
        frame: [dict(item) for item in items]
        for frame, items in observations_by_frame.items()
    }

    # 原始 3D 僅於其他至少三視角獨立佐證後才有第一順位。
    original_3d_by_frame = {
        int(row.frame): {"x": row.x, "y": row.y, "z": row.z}
        for row in db.query(BallTraj).filter(
            BallTraj.match_id == match_id,
            BallTraj.frame >= start_frame,
            BallTraj.frame <= end_frame,
        )
    }

    # 品質檢查與修復統一使用相同優先序：可信原始 3D > 雙錨點 > 2D。
    original_grid = attach_temporal_evidence(attach_reference_3d(
        scan_2d_camera_grid(
            cameras_by_index, observations_by_frame, start_frame, end_frame,
        ),
        cameras_by_index, observations_by_frame, original_3d_by_frame,
    ), observations_by_frame)
    original_status_by_frame = {
        int(item["frame"]): status_map(item)
        for item in original_grid
    }
    original_grid_by_frame = {int(item["frame"]): item for item in original_grid}

    bad_frames = [
        frame
        for frame, statuses in original_status_by_frame.items()
        if bad_count(statuses) > 0
    ]

    results = []
    repaired_2d_points = []
    history_ids = []
    history_batch = None

    try:
        for frame in bad_frames:
            original_statuses = original_status_by_frame[frame]
            original_bad_indices = [
                camera_index
                for camera_index, status in original_statuses.items()
                if status == "bad"
            ]
            original_ok_indices = {
                camera_index
                for camera_index, status in original_statuses.items()
                if status == "ok"
            }

            frame_observations = {
                int(item["camera_index"]): dict(item)
                for item in observations_by_frame.get(frame, [])
            }
            reference_3d = reference_evidence(
                cameras_by_index,
                list(frame_observations.values()),
                original_3d_by_frame.get(frame),
            )
            reference_is_supported = reference_3d["trust"] == "corroborated"
            good_observations = [
                frame_observations[camera_index]
                for camera_index in sorted(original_ok_indices)
                if camera_index in frame_observations
            ]

            # 原始 3D 是第一順位的「候選修正來源」。僅對已經由
            # 至少三台其他相機獨立佐證，且當前偏差 >30px 的 Bad 視角使用。
            # 否則才退回多視角 2D 重建，避免自我驗證及無條件信任原始 3D。
            primary_replacements = {}
            evidence_by_camera = {
                int(item["camera_index"]): item
                for item in original_grid_by_frame[frame].get("cameras", [])
            }
            for camera_index in original_bad_indices:
                item = evidence_by_camera.get(camera_index, {})
                if not (
                    item.get("original_3d_primary")
                    and item.get("reference_3d_status") == "disagrees"
                    and item.get("reference_3d_independently_supported")
                ):
                    continue
                camera = cameras_by_index.get(camera_index)
                if camera is None:
                    continue
                projected = project_inside_image(original_3d_by_frame[frame], camera)
                if projected is not None:
                    primary_replacements[camera_index] = {
                        "camera_index": camera_index,
                        "x": float(projected["x"]),
                        "y": float(projected["y"]),
                    }

            remaining_bad = [i for i in original_bad_indices if i not in primary_replacements]
            geometry_candidate = (
                robust_multiview_candidate(cameras_by_index, good_observations)
                if remaining_bad else None
            )
            candidate_bad_points = dict(primary_replacements)
            replacement_source = {i: "original_3d_primary" for i in primary_replacements}
            if geometry_candidate is not None:
                for camera_index in remaining_bad:
                    camera = cameras_by_index.get(camera_index)
                    if camera is None:
                        continue
                    projected = project_inside_image(geometry_candidate["point"], camera)
                    if projected is None:
                        continue
                    independent = reference_3d["independent_by_camera"].get(camera_index, {})
                    # 若該視角確實有可信原始 3D，但計算出的候選與其
                    # 相差過大，不能利用次順位的雙視角結果覆蓋它。
                    if independent.get("supported"):
                        reference_prediction = project_inside_image(
                            original_3d_by_frame[frame], camera,
                        )
                        if (reference_prediction is None or math.hypot(
                            reference_prediction["x"] - projected["x"],
                            reference_prediction["y"] - projected["y"],
                        ) > 24.0):
                            continue
                    candidate_bad_points[camera_index] = {
                        "camera_index": camera_index,
                        "x": float(projected["x"]),
                        "y": float(projected["y"]),
                    }
                    replacement_source[camera_index] = "multiview_2d_fallback"

            # Time continuity is an independent safeguard, not a geometry vote.
            # Near a hit, a discontinuity may be real and is left for review.
            temporal_checks = {}
            for camera_index in list(candidate_bad_points):
                check = assess_temporal_candidate(
                    observations_snapshot, frame, camera_index,
                    candidate_bad_points[camera_index],
                )
                if any(abs(frame - hit) <= 2 for hit in nearby_hits):
                    check = dict(check, status="review", reason="擊球點附近請人工核對")
                temporal_checks[camera_index] = check
                if check["status"] == "review":
                    candidate_bad_points.pop(camera_index)
                    replacement_source.pop(camera_index, None)

            if not candidate_bad_points:
                results.append({
                    "frame": frame,
                    "status": "skipped",
                    "reason": (
                        "候選與前後影格不一致或接近擊球點，需要人工檢查"
                        if any(item["status"] == "review" for item in temporal_checks.values())
                        else "可信原始 3D 與備援 2D 重建均未產生安全候選"
                    ),
                    "temporal": temporal_checks,
                    "original_bad_camera_indices": original_bad_indices,
                })
                continue

            # 保留既有 API/修復紀錄的欄位。3D 第一順位並不偽造 DLT 品質指標。
            if geometry_candidate is not None:
                candidate = dict(geometry_candidate)
            else:
                supporting_errors = [
                    float(error) for error in reference_3d["by_camera"].values()
                    if math.isfinite(float(error)) and float(error) <= 12.0
                ]
                rms = math.sqrt(sum(e * e for e in supporting_errors) / len(supporting_errors)) if supporting_errors else None
                candidate = {
                    "point": original_3d_by_frame[frame],
                    "mode": "original_3d_primary",
                    "reliable_camera_indices": sorted(
                        int(i) for i, e in reference_3d["by_camera"].items()
                        if math.isfinite(float(e)) and float(e) <= 12.0
                    ),
                    "rms_error": rms,
                    "max_error": max(supporting_errors) if supporting_errors else None,
                    "condition_ratio": None,
                    "loo": [],
                    "ransac": None,
                    "removed_cameras": [],
                }

            candidate["temporal"] = temporal_checks

            safe_replacement = best_safe_replacement_subset(
                cameras_by_index,
                frame,
                frame_observations,
                candidate_bad_points,
                original_ok_indices,
                original_3d_by_frame.get(frame),
            )

            if safe_replacement is None:
                results.append(
                    {
                        "frame": frame,
                        "status": "skipped",
                        "reason": "候選未通過原 detector 的安全回驗",
                        "mode": "unverified",
                        "original_bad_camera_indices": original_bad_indices,
                    }
                )
                continue

            accepted_indices = safe_replacement["camera_indices"]
            accepted_sources = {i: replacement_source[i] for i in accepted_indices}
            chosen_modes = set(accepted_sources.values())
            repair_mode = (
                "original_3d_primary" if chosen_modes == {"original_3d_primary"}
                else "multiview_2d_fallback" if chosen_modes == {"multiview_2d_fallback"}
                else "original_3d_primary_and_2d_fallback"
            )
            working_observations = safe_replacement["observations"]
            final_statuses = safe_replacement["statuses"]

            if any(
                final_statuses.get(camera_index) != "ok"
                for camera_index in original_ok_indices
            ):
                continue

            if any(
                final_statuses.get(camera_index) != "ok"
                for camera_index in accepted_indices
            ):
                continue

            original_2d = []
            new_2d = []

            for camera_index in accepted_indices:
                current = frame_observations.get(camera_index)
                if current is None:
                    continue
                previous = preexisting_corrections.get((frame, camera_index))
                original_2d.append({
                    "camera_index": camera_index,
                    "existed": previous is not None,
                    "visibility": int(previous.visibility) if previous is not None else 0,
                    "x": float(previous.x) if previous is not None else 0.0,
                    "y": float(previous.y) if previous is not None else 0.0,
                })
                replacement = working_observations[camera_index]
                new_2d.append({
                    "camera_index": camera_index, "frame": frame,
                    "existed": True, "visibility": 1,
                    "x": float(replacement["x"]),
                    "y": float(replacement["y"]),
                })

            if not new_2d:
                results.append(
                    {
                        "frame": frame,
                        "status": "skipped",
                        "reason": "沒有可寫入的 bad camera row",
                    }
                )
                continue

            repair_id = None

            if not payload.dry_run:
                for item in new_2d:
                    key = (frame, int(item["camera_index"]))
                    correction = preexisting_corrections.get(key)
                    if correction is None:
                        correction = BallPosition2DCorrection(
                            match_id=match_id, camera_index=key[1], frame=frame,
                            created_at=datetime.utcnow(),
                        )
                        db.add(correction)
                        preexisting_corrections[key] = correction
                    correction.visibility = 1
                    correction.x = float(item["x"])
                    correction.y = float(item["y"])
                    correction.updated_at = datetime.utcnow()

                if history_batch is None:
                    history_batch = make_batch(db, match_id)
                history = TrajectoryRepairHistory(
                    match_id=match_id,
                    frame=frame,
                    source="auto_2d_overlay",
                    original_point=None,
                    repaired_point={},
                    original_2d=original_2d,
                    repaired_2d=new_2d,
                    reprojection={
                        "edit_batch": history_batch,
                        "edit_label": "原有 2D 自動修復",
                        "mode": repair_mode,
                        "reliable_camera_indices":
                            candidate["reliable_camera_indices"],
                        "rms_error": candidate["rms_error"],
                        "max_error": candidate["max_error"],
                        "condition_ratio": candidate["condition_ratio"],
                        "loo": candidate.get("loo", []),
                        "ransac": candidate.get("ransac"),
                        "temporal": candidate.get("temporal"),
                        "removed_cameras":
                            candidate.get("removed_cameras", []),
                        "accepted_camera_indices": accepted_indices,
                        "replacement_sources": accepted_sources,
                        "original_3d_reference": {
                            "trust": reference_3d["trust"],
                            "support_count": reference_3d["support_count"],
                            "evaluated_count": reference_3d["evaluated_count"],
                            "used_as_safety_check": reference_is_supported,
                        },
                    },
                    created_at=datetime.utcnow(),
                )
                db.add(history)
                db.flush()

                repair_id = int(history.id)
                history_ids.append(repair_id)

            for item in new_2d:
                camera_index = int(item["camera_index"])

                observations_by_frame[frame] = [
                    observation
                    for observation in observations_by_frame.get(frame, [])
                    if int(observation["camera_index"]) != camera_index
                ]
                observations_by_frame[frame].append(
                    {
                        "camera_index": camera_index,
                        "x": float(item["x"]),
                        "y": float(item["y"]),
                    }
                )

            repaired_2d_points.extend(new_2d)

            results.append(
                {
                    "frame": frame,
                    "status": "would_repair" if payload.dry_run else "repaired",
                    "repair_id": repair_id,
                    "mode": repair_mode,
                    "reliable_camera_indices":
                        candidate["reliable_camera_indices"],
                    "original_bad_camera_indices": original_bad_indices,
                    "repaired_camera_indices": accepted_indices,
                    "replacement_sources": accepted_sources,
                    "rms_error": candidate["rms_error"],
                    "max_error": candidate["max_error"],
                    "condition_ratio": candidate["condition_ratio"],
                    "temporal": candidate.get("temporal"),
                    "original_3d_reference": {
                        "trust": reference_3d["trust"],
                        "support_count": reference_3d["support_count"],
                        "used_as_safety_check": reference_is_supported,
                    },
                }
            )

        # Recheck the complete range with the current detector.
        final_grid = attach_temporal_evidence(attach_reference_3d(
            scan_2d_camera_grid(
                cameras_by_index, observations_by_frame, start_frame, end_frame,
            ),
            cameras_by_index, observations_by_frame, original_3d_by_frame,
        ), observations_by_frame)
        final_status_by_frame = {
            int(item["frame"]): status_map(item)
            for item in final_grid
        }

        regressions = []

        for frame, original_statuses in original_status_by_frame.items():
            final_statuses = final_status_by_frame.get(frame, {})
            new_bad = [
                camera_index
                for camera_index, status in original_statuses.items()
                if (
                    status == "ok"
                    and final_statuses.get(camera_index) != "ok"
                )
            ]

            if new_bad:
                regressions.append(
                    {
                        "frame": frame,
                        "camera_indices": new_bad,
                    }
                )

        if regressions:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail={
                    "message":
                        "安全回驗發現新的 bad camera，整批自動修正已取消",
                    "regressions": regressions,
                },
            )

        if payload.dry_run:
            db.rollback()
        else:
            db.commit()

    except HTTPException:
        db.rollback()
        raise

    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=(
                "自動修正失敗，本次修改已全部 rollback："
                f"{exc}"
            ),
        ) from exc

    repaired_frames = [
        item
        for item in results
        if item["status"] in ("repaired", "would_repair")
    ]
    skipped_frames = [
        item
        for item in results
        if item["status"] == "skipped"
    ]

    return {
        "ok": True,
        "dry_run": bool(payload.dry_run),
        "start_frame": start_frame,
        "end_frame": end_frame,
        "detected_bad_frames": len(bad_frames),
        "repaired_frames": len(repaired_frames),
        "repaired_2d_points": len(repaired_2d_points),
        "skipped_frames": len(skipped_frames),
        "repair_ids": history_ids,
        "trajectory_points": [],
        "scope": "2d_correction_overlay",
        "source": "corrected",
        "ball_2d_points": repaired_2d_points,
        "frames": results,
        "grid": final_grid,
    }


class UndoAutoRepairPayload(BaseModel):
    repair_ids: list[int]


@router.post('/matches/{match_id}/traj2d/auto-repair/undo')
def undo_auto_repair_traj_2d(
    match_id: int,
    payload: UndoAutoRepairPayload,
    db: Session = Depends(get_db),
):
    ids = sorted(set(payload.repair_ids), reverse=True)
    if not ids or len(ids) > MAX_AUTO_REPAIR_FRAMES + 1:
        raise HTTPException(status_code=400, detail='修復紀錄數量無效')
    try:
        match = db.query(Match).filter(Match.id == match_id).with_for_update().first()
        if match is None:
            raise HTTPException(status_code=404, detail='找不到資料集')
        histories = (
            db.query(TrajectoryRepairHistory)
            .filter(TrajectoryRepairHistory.match_id == match_id, TrajectoryRepairHistory.id.in_(ids))
            .order_by(TrajectoryRepairHistory.id.desc()).with_for_update().all()
        )
        if len(histories) != len(ids):
            raise HTTPException(status_code=404, detail='找不到完整修復紀錄')
        if len({item.frame for item in histories}) != len(histories):
            raise HTTPException(status_code=400, detail='同一次復原不可包含重複 frame')
        points2d = []
        for history in histories:
            if history.source not in ('auto_2d_only', 'auto_2d_overlay') or history.reverted_at is not None:
                raise HTTPException(status_code=409, detail='紀錄不是可復原的 2D 修復，或已復原')
            indices = {int(item['camera_index']) for item in history.repaired_2d or []}
            later = db.query(TrajectoryRepairHistory).filter(
                TrajectoryRepairHistory.match_id == match_id,
                TrajectoryRepairHistory.frame == history.frame,
                TrajectoryRepairHistory.id > history.id,
                TrajectoryRepairHistory.reverted_at.is_(None),
            ).all()
            if any(indices.intersection(int(point['camera_index']) for point in item.repaired_2d or []) for item in later):
                raise HTTPException(status_code=409, detail=f'frame {history.frame} 的 2D 標註已有後續修復，整批未復原')
            if history.source == 'auto_2d_overlay':
                for repaired in history.repaired_2d or []:
                    index = int(repaired['camera_index'])
                    correction = db.query(BallPosition2DCorrection).filter_by(
                        match_id=match_id, frame=history.frame, camera_index=index,
                    ).with_for_update().first()
                    if (correction is None or int(correction.visibility) != int(repaired['visibility'])
                        or not math.isclose(correction.x, float(repaired['x']), abs_tol=1e-7, rel_tol=0)
                        or not math.isclose(correction.y, float(repaired['y']), abs_tol=1e-7, rel_tol=0)):
                        raise HTTPException(status_code=409, detail=f'frame {history.frame} Cam {index} 已有後續變動，不能復原')
                    previous = next((row for row in history.original_2d or []
                                     if int(row['camera_index']) == index), None)
                    if previous is None:
                        raise HTTPException(status_code=409, detail='缺少修復前的資料')
                    if previous.get('existed'):
                        correction.visibility = int(previous['visibility'])
                        correction.x = float(previous['x'])
                        correction.y = float(previous['y'])
                    else:
                        db.delete(correction)
                    # Return the effective corrected overlay after undo.
                    if previous.get('existed'):
                        restored = previous
                    else:
                        raw = db.query(BallPosition2D).filter_by(
                            match_id=match_id, frame=history.frame, camera_index=index,
                        ).first()
                        restored = {'visibility': raw.visibility, 'x': raw.x, 'y': raw.y} if raw else {'visibility': 0, 'x': 0, 'y': 0}
                    points2d.append(dict(camera_index=index, frame=history.frame,
                                         x=restored['x'], y=restored['y'], visibility=restored['visibility']))
                history.reverted_at = datetime.utcnow()
                continue
            current2d = {}
            for repaired in history.repaired_2d or []:
                index = int(repaired['camera_index'])
                point = db.query(BallPosition2D).filter_by(
                    match_id=match_id, frame=history.frame, camera_index=index,
                ).with_for_update().first()
                if point is None or point.visibility != repaired['visibility'] or any(
                    not math.isclose(float(getattr(point, axis)), float(repaired[axis]), rel_tol=0, abs_tol=1e-7)
                    for axis in ('x', 'y')
                ):
                    raise HTTPException(status_code=409, detail=f'frame {history.frame} 的 Cam {index} 已有後續修改，整批未復原')
                current2d[index] = point
            for original in history.original_2d or []:
                index = int(original['camera_index'])
                point = current2d.get(index)
                if not original.get('existed') or point is None:
                    raise HTTPException(status_code=409, detail='自動修復紀錄不完整，整批未復原')
                point.x = float(original['x'])
                point.y = float(original['y'])
                point.visibility = int(original['visibility'])
                points2d.append(dict(camera_index=index, frame=history.frame, x=point.x, y=point.y, visibility=point.visibility))
            history.reverted_at = datetime.utcnow()
        db.commit()
        return {'ok': True, 'reverted_frames': len(histories), 'scope': '2d_only', 'trajectory_points': [],
                'deleted_frames': [], 'ball_2d_points': points2d}
    except Exception:
        db.rollback()
        raise
