import math
from datetime import datetime
from itertools import combinations

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .db import get_db
from .models import BallPosition2D, Match, TrajectoryRepairHistory
from .triangulation import project_raw_point, scan_2d_camera_grid, triangulate_observations


router = APIRouter()

MAX_AUTO_REPAIR_FRAMES = 6000
PAIR_INLIER_THRESHOLD_PX = 30.0
LOO_BASE_THRESHOLD_PX = 45.0


class AutoRepair2DPayload(BaseModel):
    start_frame: int
    end_frame: int
    dry_run: bool = False


def cameras_by_index_for_match(match: Match) -> dict[int, dict]:
    cameras = match.cameras if isinstance(match.cameras, list) else []
    result = {}

    for fallback_index, camera in enumerate(cameras):
        if not isinstance(camera, dict):
            continue
        try:
            result[int(camera.get("index", fallback_index))] = camera
        except (TypeError, ValueError):
            continue

    return result


def observation_dict(row: BallPosition2D) -> dict:
    return {
        "camera_index": int(row.camera_index),
        "x": float(row.x),
        "y": float(row.y),
    }


def status_map(grid_frame: dict) -> dict[int, str]:
    return {
        int(item["camera_index"]): str(item["status"])
        for item in (grid_frame.get("cameras") or [])
    }


def bad_count(statuses: dict[int, str]) -> int:
    return sum(1 for status in statuses.values() if status == "bad")


def single_frame_grid(
    cameras_by_index: dict[int, dict],
    observations: list[dict],
    frame: int,
) -> dict:
    return scan_2d_camera_grid(
        cameras_by_index,
        {frame: observations},
        frame,
        frame,
    )[0]


def projection_error(point: dict, camera: dict, observation: dict) -> float | None:
    projected = project_raw_point(point, camera)

    if projected is None:
        return None

    dx = float(projected["x"]) - float(observation["x"])
    dy = float(projected["y"]) - float(observation["y"])
    error = math.sqrt(dx * dx + dy * dy)

    return float(error) if math.isfinite(error) else None


def camera_image_bounds(camera: dict) -> tuple[float, float]:
    projection = camera.get("projection") if isinstance(camera, dict) else None

    if not isinstance(projection, dict):
        return 1920.0, 1200.0

    width = projection.get("imageWidth", projection.get("image_width", 1920.0))
    height = projection.get("imageHeight", projection.get("image_height", 1200.0))

    try:
        width = float(width)
        height = float(height)
    except (TypeError, ValueError):
        return 1920.0, 1200.0

    if (
        width <= 0
        or height <= 0
        or not math.isfinite(width)
        or not math.isfinite(height)
    ):
        return 1920.0, 1200.0

    return width, height


def project_inside_image(point: dict, camera: dict) -> dict | None:
    projected = project_raw_point(point, camera)

    if projected is None:
        return None

    x = float(projected["x"])
    y = float(projected["y"])
    width, height = camera_image_bounds(camera)

    if (
        not math.isfinite(x)
        or not math.isfinite(y)
        or x < 0
        or x > width
        or y < 0
        or y > height
    ):
        return None

    return {
        "x": x,
        "y": y,
        "depth": float(projected["depth"]),
    }


def robust_threshold(errors: list[float], minimum: float) -> float:
    if not errors:
        return minimum

    values = np.asarray(errors, dtype=np.float64)
    median = float(np.median(values))
    mad = float(np.median(np.abs(values - median)))
    robust_sigma = 1.4826 * mad

    return float(max(minimum, median + 4.0 * robust_sigma))


def leave_one_out_errors(
    cameras_by_index: dict[int, dict],
    observations: list[dict],
) -> list[dict]:
    if len(observations) < 3:
        return []

    by_camera = {
        int(item["camera_index"]): item
        for item in observations
    }
    results = []

    for camera_index in sorted(by_camera):
        others = [
            observation
            for other_index, observation in by_camera.items()
            if other_index != camera_index
        ]

        if len(others) < 2:
            continue

        try:
            reconstruction = triangulate_observations(cameras_by_index, others)
        except ValueError:
            continue

        camera = cameras_by_index.get(camera_index)
        if camera is None:
            continue

        error = projection_error(
            reconstruction["point"],
            camera,
            by_camera[camera_index],
        )

        if error is not None:
            results.append(
                {
                    "camera_index": camera_index,
                    "pixel_error": error,
                }
            )

    return results


def ransac_consensus_observations(
    cameras_by_index: dict[int, dict],
    observations: list[dict],
) -> tuple[list[dict], dict | None]:
    if len(observations) < 3:
        return observations, None

    by_camera = {
        int(item["camera_index"]): item
        for item in observations
    }
    best = None

    for first_index, second_index in combinations(sorted(by_camera), 2):
        pair = [by_camera[first_index], by_camera[second_index]]

        try:
            result = triangulate_observations(cameras_by_index, pair)
        except ValueError:
            continue

        errors = {}

        for camera_index in sorted(by_camera):
            camera = cameras_by_index.get(camera_index)
            if camera is None:
                continue

            error = projection_error(
                result["point"],
                camera,
                by_camera[camera_index],
            )

            if error is not None:
                errors[camera_index] = error

        inliers = [
            camera_index
            for camera_index, error in errors.items()
            if error <= PAIR_INLIER_THRESHOLD_PX
        ]

        if len(inliers) < 3:
            continue

        median_error = float(
            np.median([errors[camera_index] for camera_index in inliers])
        )

        candidate = {
            "pair": [first_index, second_index],
            "inlier_indices": inliers,
            "inlier_count": len(inliers),
            "median_inlier_error": median_error,
        }

        if (
            best is None
            or candidate["inlier_count"] > best["inlier_count"]
            or (
                candidate["inlier_count"] == best["inlier_count"]
                and candidate["median_inlier_error"] < best["median_inlier_error"]
            )
        ):
            best = candidate

    if best is None:
        return observations, None

    return [by_camera[index] for index in best["inlier_indices"]], best


def robust_multiview_candidate(
    cameras_by_index: dict[int, dict],
    observations: list[dict],
) -> dict | None:
    if len(observations) < 3:
        return None

    selected, ransac = ransac_consensus_observations(
        cameras_by_index,
        observations,
    )

    if len(selected) < 3:
        return None

    working = [dict(item) for item in selected]
    removed = []

    while len(working) > 3:
        loo = leave_one_out_errors(cameras_by_index, working)

        if len(loo) != len(working):
            break

        threshold = robust_threshold(
            [float(item["pixel_error"]) for item in loo],
            LOO_BASE_THRESHOLD_PX,
        )
        worst = max(loo, key=lambda item: item["pixel_error"])

        if float(worst["pixel_error"]) <= threshold:
            break

        worst_index = int(worst["camera_index"])
        working = [
            item
            for item in working
            if int(item["camera_index"]) != worst_index
        ]
        removed.append(
            {
                "camera_index": worst_index,
                "pixel_error": float(worst["pixel_error"]),
                "threshold": threshold,
            }
        )

    final_loo = leave_one_out_errors(cameras_by_index, working)

    if len(final_loo) != len(working):
        return None

    final_errors = [float(item["pixel_error"]) for item in final_loo]
    final_threshold = robust_threshold(final_errors, LOO_BASE_THRESHOLD_PX)

    # 只擋明顯崩掉，不把它當一般 RMS 生死線。
    if final_errors and max(final_errors) > max(90.0, final_threshold):
        return None

    try:
        reconstruction = triangulate_observations(
            cameras_by_index,
            working,
        )
    except ValueError:
        return None

    return {
        "mode": "multiview",
        "point": reconstruction["point"],
        "reliable_camera_indices": [
            int(item["camera_index"])
            for item in working
        ],
        "rms_error": float(reconstruction["rms_error"]),
        "max_error": float(reconstruction["max_error"]),
        "condition_ratio": float(reconstruction["condition_ratio"]),
        "loo": final_loo,
        "ransac": ransac,
        "removed_cameras": removed,
    }


def best_safe_replacement_subset(
    cameras_by_index: dict[int, dict],
    frame: int,
    frame_observations: dict[int, dict],
    candidate_bad_points: dict[int, dict],
    original_ok_indices: set[int],
) -> dict | None:
    candidate_indices = sorted(candidate_bad_points)

    if not candidate_indices:
        return None

    baseline_statuses = status_map(
        single_frame_grid(
            cameras_by_index,
            list(frame_observations.values()),
            frame,
        )
    )
    baseline_bad_count = bad_count(baseline_statuses)
    best = None

    # 從一次修最多支 bad camera 的組合開始找。
    for subset_size in range(len(candidate_indices), 0, -1):
        for subset in combinations(candidate_indices, subset_size):
            trial_observations = {
                camera_index: dict(observation)
                for camera_index, observation in frame_observations.items()
            }

            for camera_index in subset:
                trial_observations[camera_index] = dict(
                    candidate_bad_points[camera_index]
                )

            trial_grid = single_frame_grid(
                cameras_by_index,
                list(trial_observations.values()),
                frame,
            )
            trial_statuses = status_map(trial_grid)
            trial_bad_count = bad_count(trial_statuses)

            new_bad_on_original_ok = [
                camera_index
                for camera_index in original_ok_indices
                if trial_statuses.get(camera_index) != "ok"
            ]
            repaired_still_bad = [
                camera_index
                for camera_index in subset
                if trial_statuses.get(camera_index) != "ok"
            ]

            if new_bad_on_original_ok or repaired_still_bad:
                continue

            if trial_bad_count >= baseline_bad_count:
                continue

            candidate = {
                "camera_indices": list(subset),
                "observations": trial_observations,
                "statuses": trial_statuses,
                "bad_count": trial_bad_count,
            }

            if (
                best is None
                or len(candidate["camera_indices"]) > len(best["camera_indices"])
                or (
                    len(candidate["camera_indices"]) == len(best["camera_indices"])
                    and candidate["bad_count"] < best["bad_count"]
                )
            ):
                best = candidate

        if best is not None:
            break

    return best


@router.post("/matches/{match_id}/traj2d/auto-repair")
def auto_repair_traj_2d(
    match_id: int,
    payload: AutoRepair2DPayload,
    db: Session = Depends(get_db),
):
    match = db.get(Match, match_id)

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

    rows = (
        db.query(BallPosition2D)
        .filter(
            BallPosition2D.match_id == match_id,
            BallPosition2D.frame >= start_frame,
            BallPosition2D.frame <= end_frame,
            BallPosition2D.visibility > 0,
        )
        .order_by(
            BallPosition2D.frame,
            BallPosition2D.camera_index,
        )
        .all()
    )

    rows_by_frame_camera = {}
    observations_by_frame = {}

    for row in rows:
        camera_index = int(row.camera_index)

        if camera_index not in cameras_by_index:
            continue

        frame = int(row.frame)
        rows_by_frame_camera[(frame, camera_index)] = row
        observations_by_frame.setdefault(frame, []).append(
            observation_dict(row)
        )

    # Use the same detector as the quality grid.
    original_grid = scan_2d_camera_grid(
        cameras_by_index,
        observations_by_frame,
        start_frame,
        end_frame,
    )
    original_status_by_frame = {
        int(item["frame"]): status_map(item)
        for item in original_grid
    }

    bad_frames = [
        frame
        for frame, statuses in original_status_by_frame.items()
        if bad_count(statuses) > 0
    ]

    results = []
    repaired_2d_points = []
    history_ids = []

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
            good_observations = [
                frame_observations[camera_index]
                for camera_index in sorted(original_ok_indices)
                if camera_index in frame_observations
            ]

            # Geometry is temporary: this route never reads or writes BallTraj.
            candidate = robust_multiview_candidate(
                cameras_by_index,
                good_observations,
            )

            if candidate is None:
                results.append(
                    {
                        "frame": frame,
                        "status": "skipped",
                        "reason": "找不到可驗證的可靠重建候選",
                        "original_bad_camera_indices": original_bad_indices,
                    }
                )
                continue

            candidate_bad_points = {}

            for camera_index in original_bad_indices:
                camera = cameras_by_index.get(camera_index)

                if camera is None:
                    continue

                projected = project_inside_image(
                    candidate["point"],
                    camera,
                )

                if projected is None:
                    continue

                candidate_bad_points[camera_index] = {
                    "camera_index": camera_index,
                    "x": float(projected["x"]),
                    "y": float(projected["y"]),
                }

            safe_replacement = best_safe_replacement_subset(
                cameras_by_index,
                frame,
                frame_observations,
                candidate_bad_points,
                original_ok_indices,
            )

            if safe_replacement is None:
                results.append(
                    {
                        "frame": frame,
                        "status": "skipped",
                        "reason": "候選未通過原 detector 的安全回驗",
                        "mode": candidate["mode"],
                        "original_bad_camera_indices": original_bad_indices,
                    }
                )
                continue

            accepted_indices = safe_replacement["camera_indices"]
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
                row = rows_by_frame_camera.get((frame, camera_index))

                if row is None:
                    continue

                original_2d.append(
                    {
                        "camera_index": camera_index,
                        "existed": True,
                        "visibility": int(row.visibility),
                        "x": float(row.x),
                        "y": float(row.y),
                    }
                )

                replacement = working_observations[camera_index]

                new_2d.append(
                    {
                        "camera_index": camera_index,
                        "frame": frame,
                        "visibility": 1,
                        "x": float(replacement["x"]),
                        "y": float(replacement["y"]),
                    }
                )

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
                    row = rows_by_frame_camera[
                        (frame, int(item["camera_index"]))
                    ]
                    row.visibility = 1
                    row.x = float(item["x"])
                    row.y = float(item["y"])

                history = TrajectoryRepairHistory(
                    match_id=match_id,
                    frame=frame,
                    source="auto_2d_only",
                    original_point=None,
                    repaired_point={},
                    original_2d=original_2d,
                    repaired_2d=new_2d,
                    reprojection={
                        "mode": candidate["mode"],
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
                    "mode": candidate["mode"],
                    "reliable_camera_indices":
                        candidate["reliable_camera_indices"],
                    "original_bad_camera_indices": original_bad_indices,
                    "repaired_camera_indices": accepted_indices,
                    "rms_error": candidate["rms_error"],
                    "max_error": candidate["max_error"],
                    "condition_ratio": candidate["condition_ratio"],
                    "temporal": candidate.get("temporal"),
                }
            )

        # Recheck the complete range with the current detector.
        final_grid = scan_2d_camera_grid(
            cameras_by_index,
            observations_by_frame,
            start_frame,
            end_frame,
        )
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
        "scope": "2d_only",
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
            if history.source != 'auto_2d_only' or history.reverted_at is not None:
                raise HTTPException(status_code=409, detail='只可復原新版純 2D 修復；此紀錄屬於其他修復類型或已復原')
            indices = {int(item['camera_index']) for item in history.repaired_2d or []}
            later = db.query(TrajectoryRepairHistory).filter(
                TrajectoryRepairHistory.match_id == match_id,
                TrajectoryRepairHistory.frame == history.frame,
                TrajectoryRepairHistory.id > history.id,
                TrajectoryRepairHistory.reverted_at.is_(None),
            ).all()
            if any(indices.intersection(int(point['camera_index']) for point in item.repaired_2d or []) for item in later):
                raise HTTPException(status_code=409, detail=f'frame {history.frame} 的 2D 標註已有後續修復，整批未復原')
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
