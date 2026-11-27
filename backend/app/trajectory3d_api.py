"""Preview, verify, version and export 3D corrections without changing source 2D/3D."""
from __future__ import annotations

import csv
import io
import math
from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .db import get_db
from .models import BallTraj, Hit, Match, Trajectory3DPoint, Trajectory3DVersion
from .trajectory3d_core import MAX_RALLY_FRAMES, analyze_range, fingerprint

router = APIRouter()


class AnalyzeRequest(BaseModel):
    start_frame: int = Field(ge=0)
    end_frame: int = Field(ge=0)
    source_2d: Literal["original", "corrected"] = "corrected"


class SaveRequest(AnalyzeRequest):
    source_fingerprint: str
    # Omitted means high-confidence automatic candidates only.
    frames: list[int] | None = None
    confirm_review: bool = False
    base_version_id: int | None = None


def _checked_match(db: Session, match_id: int):
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="找不到資料集")
    return match


def _checked_range(match, start, end):
    if start > end or end > match.duration_frame:
        raise HTTPException(status_code=400, detail="影格區間不正確")
    if end - start + 1 > MAX_RALLY_FRAMES:
        raise HTTPException(status_code=400, detail=f"最多分析 {MAX_RALLY_FRAMES} 幀，請選擇較短的 Rally")


def _observations(db, match_id, start, end, source):
    # Reuse the Oct-05 source switch: correction rows take precedence over the
    # original labels, without creating observations from projected 3D points.
    from .ball2d_corrections import load_ball_2d_rows
    return load_ball_2d_rows(db, match_id, start, end, source=source, visible_only=True)


def _load_inputs(db: Session, match_id: int, start: int, end: int, source: str):
    match = _checked_match(db, match_id)
    _checked_range(match, start, end)
    cameras = {}
    for default_index, cam in enumerate(match.cameras or []):
        if isinstance(cam, dict) and isinstance(cam.get("projection"), dict):
            cameras[int(cam.get("index", default_index))] = cam
    obs = _observations(db, match_id, start, end, source)
    originals = {
        row.frame: dict(x=row.x, y=row.y, z=row.z)
        for row in db.query(BallTraj).filter(
            BallTraj.match_id == match_id, BallTraj.frame >= start,
            BallTraj.frame <= end).all()
    }
    hits = [int(hit.new_hit_frame if hit.new_hit_frame is not None else hit.hit_frame)
            for hit in db.query(Hit).filter(Hit.match_id == match_id,
                Hit.hit_frame >= start - 3, Hit.hit_frame <= end + 3).all()]
    camera_fingerprint = {index: cam.get("projection") for index, cam in cameras.items()}
    digest = fingerprint(camera_fingerprint, obs, originals, hits, match.fps)
    return match, cameras, obs, originals, hits, digest


def _calibration_stats(frames):
    errors = defaultdict(list)
    for r in frames:
        # Only use a 3D point from at least 3 consistent views; do not interpret
        # a projection of a predicted 2D point as independent validation.
        if r.get("inlier_views", 0) < 3:
            continue
        for view in r.get("view_diagnostics", []):
            # Only pixels held OUT of their own 3D fit may be used for this
            # diagnostic; fitting residuals are optimistically biased.
            err = view.get("heldout_residual_px")
            if err is not None:
                errors[view["camera_index"]].append(float(err))
    return [dict(camera_index=k, samples=len(v), median_residual_px=round(sorted(v)[len(v)//2], 2),
                 max_residual_px=round(max(v), 2))
            for k, v in sorted(errors.items())]


def _analyze(db, match_id, payload):
    match, cameras, obs, originals, hits, digest = _load_inputs(
        db, match_id, payload.start_frame, payload.end_frame, payload.source_2d)
    if len(cameras) < 2:
        raise HTTPException(status_code=400, detail="缺少至少兩台已校正的相機")
    analysis = analyze_range(cameras, obs, originals, hits,
                             payload.start_frame, payload.end_frame, match.fps)
    return {**analysis, "source_fingerprint": digest,
            "source_2d": payload.source_2d, "start_frame": payload.start_frame,
            "end_frame": payload.end_frame,
            "camera_quality": _calibration_stats(analysis["frames"])}


@router.post("/matches/{match_id}/traj3d/analyze")
def analyze_trajectory_3d(match_id: int, payload: AnalyzeRequest, db: Session = Depends(get_db)):
    """Dry-run only: no source labels and no 3D points are modified."""
    return _analyze(db, match_id, payload)


@router.post("/matches/{match_id}/traj3d/versions")
def save_trajectory_3d_version(match_id: int, payload: SaveRequest, db: Session = Depends(get_db)):
    """Re-run analysis on the server; never trust client-supplied 3D coordinates."""
    report = _analyze(db, match_id, payload)
    if report["source_fingerprint"] != payload.source_fingerprint:
        raise HTTPException(status_code=409, detail="2D／相機／原始軌跡或 Hit 已更新，請重新分析再儲存")
    if payload.base_version_id is not None:
        base = db.get(Trajectory3DVersion, payload.base_version_id)
        if base is None or base.match_id != match_id:
            raise HTTPException(status_code=404, detail="找不到基礎 3D 版本")
    eligible = {r["frame"]: r for r in report["frames"] if r["status"] == "auto" or
                (payload.confirm_review and r["status"] == "review" and "point" in r)}
    selected = set(payload.frames) if payload.frames is not None else {
        f for f, r in eligible.items() if r["status"] == "auto"
    }
    if not selected:
        raise HTTPException(status_code=400, detail="目前沒有可儲存的高信心修正")
    if not selected.issubset(eligible):
        raise HTTPException(status_code=400, detail="包含未通過檢查的影格；需要人工確認者請明確啟用審核")

    # Build a cumulative new version from the optional previous version.
    # It remains safe to select older versions in the UI.
    existing = {}
    if payload.base_version_id is not None:
        base = db.get(Trajectory3DVersion, payload.base_version_id)
        for old in db.query(Trajectory3DPoint).filter_by(version_id=base.id).all():
            existing[old.frame] = dict(frame=old.frame, point=dict(x=old.x, y=old.y, z=old.z),
                                       status=old.quality, diagnostics=old.diagnostics)
    for frame in selected:
        existing[frame] = eligible[frame]
    version = Trajectory3DVersion(
        match_id=match_id, start_frame=payload.start_frame, end_frame=payload.end_frame,
        source_2d=payload.source_2d, source_fingerprint=payload.source_fingerprint,
        base_version_id=payload.base_version_id, count=len(existing),
        summary={"selected_frames": len(selected), "analysis": report["summary"],
                 "confirmed_review": bool(payload.confirm_review)},
    )
    try:
        db.add(version)
        db.flush()
        for frame, result in sorted(existing.items()):
            p = result["point"]
            diag = {k: result.get(k) for k in ("reason", "rms_px", "inlier_views",
                "estimated_sigma_m", "shift_from_original_m", "recommended_camera",
                "heldout_rms_px", "heldout_max_px", "heldout_views")}
            diag.update(result.get("diagnostics") or {})
            db.add(Trajectory3DPoint(
                version_id=version.id, frame=frame,
                x=p["x"], y=p["y"], z=p["z"],
                confidence=0.9 if result["status"] == "auto" else 0.5,
                quality=result["status"], diagnostics=diag,
            ))
        db.commit()
        return {"id": version.id, "saved": len(selected), "total": len(existing),
                "message": "已儲存新的 3D 修正版本，原始 ball_traj 不變"}
    except Exception:
        db.rollback()
        raise


@router.get("/matches/{match_id}/traj3d/versions")
def list_trajectory_3d_versions(match_id: int, db: Session = Depends(get_db)):
    _checked_match(db, match_id)
    versions = db.query(Trajectory3DVersion).filter_by(match_id=match_id).order_by(
        Trajectory3DVersion.id.desc()).all()
    return [dict(id=v.id, start_frame=v.start_frame, end_frame=v.end_frame,
                 source_2d=v.source_2d, count=v.count, base_version_id=v.base_version_id,
                 summary=v.summary, created_at=v.created_at.isoformat() if v.created_at else None)
            for v in versions]


def _merged_traj(db, match_id, version_id, start, end):
    match = _checked_match(db, match_id)
    if version_id is not None:
        version = db.get(Trajectory3DVersion, version_id)
        if version is None or version.match_id != match_id:
            raise HTTPException(status_code=404, detail="3D 版本不存在或不屬於此資料集")
    rows = db.query(BallTraj).filter(
        BallTraj.match_id == match_id, BallTraj.frame >= start, BallTraj.frame <= end,
    ).order_by(BallTraj.frame).all()
    merged = {r.frame: dict(frame=r.frame, t_sec=r.t_sec,
                            x=r.x, y=r.y, z=r.z, confidence=r.confidence) for r in rows}
    if version_id is not None:
        for p in db.query(Trajectory3DPoint).filter(
            Trajectory3DPoint.version_id == version_id,
            Trajectory3DPoint.frame >= start,
            Trajectory3DPoint.frame <= end).all():
            merged[p.frame] = dict(frame=p.frame, t_sec=p.frame / (match.fps or 50),
                                   x=p.x, y=p.y, z=p.z, confidence=p.confidence)
    points = [merged[f] for f in sorted(merged)]
    last = None
    for p in points:
        p["speed"] = None
        if last is not None and p["t_sec"] > last["t_sec"]:
            p["speed"] = math.dist((p["x"], p["y"], p["z"]),
                                   (last["x"], last["y"], last["z"])) / (p["t_sec"] - last["t_sec"])
        last = p
    return points


@router.get("/matches/{match_id}/traj3d/trajectory")
def get_trajectory_3d(match_id: int, version_id: int | None = None,
                      start: int = Query(0, ge=0), end: int = Query(999999999, ge=0),
                      db: Session = Depends(get_db)):
    return _merged_traj(db, match_id, version_id, start, end)


@router.get("/matches/{match_id}/traj3d/versions/{version_id}/export")
def export_trajectory_3d_version(match_id: int, version_id: int, db: Session = Depends(get_db)):
    rows = _merged_traj(db, match_id, version_id, 0, 999999999)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Frame", "Time", "X", "Y", "Z", "Confidence", "Speed"])
    for p in rows:
        writer.writerow([p["frame"], p["t_sec"], p["x"], p["y"], p["z"],
                         p["confidence"], p["speed"] if p["speed"] is not None else ""])
    return Response(content=output.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="match{match_id}_3d_version{version_id}.csv"'})
