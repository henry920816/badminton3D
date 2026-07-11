import csv
import os
from io import StringIO
from pathlib import Path

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .db import engine, get_db
from .models import Anomaly, BallTraj, Base, Hit, Match, Rally
from .schemas import AnomalyPatch, HitPatch, MatchOut, TimelineOut, TrajPoint, TrajRepairPayload
from .seed import seed_demo

app = FastAPI(title="Badminton 3D Debugger MVP", version="0.1.0")

APP_DIR = Path(__file__).resolve().parent
DATASET_ROOT = Path(os.getenv("DATASET_ROOT", APP_DIR / "datasets"))
RALLY_DATA_ROOT = Path(os.getenv("RALLY_DATA_ROOT", DATASET_ROOT / "12_24_1_new"))
SMPL_REPLAY_NPZ_ROOT = Path(os.getenv("SMPL_REPLAY_NPZ_ROOT", DATASET_ROOT / "new_racket_npz" / "241224_1"))
SMPL_FORWARD_SHARED_URL = os.getenv("SMPL_FORWARD_SHARED_URL", "/models/smpl/forward/shared.json")
SMPL_FORWARD_PLAYER_URL = os.getenv("SMPL_FORWARD_PLAYER_URL", "/models/smpl/forward/players/neutral.json")

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173")
origins = [o.strip() for o in CORS_ORIGINS.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    Base.metadata.create_all(bind=engine)

    seed_enabled = os.getenv("SEED_DEMO", "0") == "1"
    if seed_enabled:
        from .db import SessionLocal

        db = SessionLocal()
        try:
            seed_demo(db)
        finally:
            db.close()


@app.get("/health")
def health():
    return {"ok": True}


def _smpl_forward_model() -> dict:
    return {
        "shared_url": SMPL_FORWARD_SHARED_URL,
        "player_url": SMPL_FORWARD_PLAYER_URL,
    }


def _find_rally_source(start_frame: int, end_frame: int) -> dict | None:
    best = None
    best_dist = None

    if not RALLY_DATA_ROOT.exists():
        return None

    for csv_path in sorted(RALLY_DATA_ROOT.glob("*_set*/RallySeg.csv")):
        with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    start = int(float(row.get("Start", 0)))
                    end = int(float(row.get("End", start)))
                except Exception:
                    continue

                candidate = {
                    "score": row.get("Score"),
                    "up_court": row.get("UpCourt"),
                    "down_court": row.get("DownCourt"),
                    "start_frame": start,
                    "end_frame": end,
                }

                if start == start_frame and end == end_frame:
                    return candidate

                dist = abs(start - start_frame) + abs(end - end_frame)
                if best_dist is None or dist < best_dist:
                    best_dist = dist
                    best = candidate

    return best


def _serialize_rally(r: Rally) -> dict:
    source = _find_rally_source(r.start_frame, r.end_frame)
    up_court = source.get("up_court") if source else None
    down_court = source.get("down_court") if source else None

    return {
        "id": r.id,
        "rally_index": r.rally_index,
        "start_frame": r.start_frame,
        "end_frame": r.end_frame,
        "status": r.status,
        "score": source.get("score") if source else None,
        "up_court": up_court,
        "down_court": down_court,
        "players": [
            {
                "court": "up",
                "player_index": 0,
                "name": up_court,
                "smpl_forward_model": _smpl_forward_model(),
            },
            {
                "court": "down",
                "player_index": 1,
                "name": down_court,
                "smpl_forward_model": _smpl_forward_model(),
            },
        ],
    }


def _npz_array(data, *names: str):
    for name in names:
        if name in data.files:
            return data[name]
    raise KeyError(f"missing arrays: {' or '.join(names)}")


def _load_smpl_motion_npz(
    path: Path,
    *,
    player_id: str,
    player_index: int,
    court: str,
    name: str | None,
    rally_start_frame: int,
    request_start_frame: int,
    request_end_frame: int,
    fps: float,
) -> dict | None:
    if not path.exists():
        return None

    try:
        with np.load(path, allow_pickle=False) as data:
            body_pose_raw = _npz_array(data, "body_pose", "data/body_pose")
            trans = _npz_array(data, "trans", "transl", "data/trans", "data/transl").astype(np.float32)
            beta = _npz_array(data, "beta", "betas", "data/beta", "data/betas").astype(np.float32)
            mask = data["mask"] if "mask" in data.files else data["data/mask"] if "data/mask" in data.files else None
            global_orient_raw = data["global_orient"] if "global_orient" in data.files else data["data/global_orient"] if "data/global_orient" in data.files else None
            racket_pose = data["racket_pose"] if "racket_pose" in data.files else data["data/racket_pose"] if "data/racket_pose" in data.files else None
            racket_transform = data["racket_transform"] if "racket_transform" in data.files else data["data/racket_transform"] if "data/racket_transform" in data.files else None
            racket_frame_offset = data["racket_frame_offset"] if "racket_frame_offset" in data.files else data["data/racket_frame_offset"] if "data/racket_frame_offset" in data.files else None
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"failed to load {path.name}: {exc}") from exc

    body_pose_raw = np.asarray(body_pose_raw, dtype=np.float32)
    if trans.ndim != 2 or trans.shape[1] != 3:
        raise HTTPException(status_code=500, detail=f"{path.name} trans must be [N,3]")

    frame_count = int(trans.shape[0])
    if body_pose_raw.ndim == 2 and body_pose_raw.shape[1] == 72:
        global_orient = body_pose_raw[:, :3]
        body_pose = body_pose_raw[:, 3:].reshape(frame_count, 23, 3)
    elif body_pose_raw.ndim == 2 and body_pose_raw.shape[1] == 69:
        global_orient = np.zeros((frame_count, 3), dtype=np.float32) if global_orient_raw is None else np.asarray(global_orient_raw, dtype=np.float32)
        body_pose = body_pose_raw.reshape(frame_count, 23, 3)
    elif body_pose_raw.ndim == 3 and body_pose_raw.shape[1:] == (23, 3):
        global_orient = np.zeros((frame_count, 3), dtype=np.float32) if global_orient_raw is None else np.asarray(global_orient_raw, dtype=np.float32)
        body_pose = body_pose_raw
    else:
        raise HTTPException(status_code=500, detail=f"{path.name} body_pose must be [N,72], [N,69], or [N,23,3]")

    if len(body_pose) != frame_count:
        raise HTTPException(status_code=500, detail=f"{path.name} body_pose/trans frame counts differ")

    if beta.ndim == 1:
        beta = beta[None, :]
    if beta.ndim != 2 or beta.shape[1] < 10:
        raise HTTPException(status_code=500, detail=f"{path.name} beta must be [10] or [N,10]")
    beta = beta[:, :10]

    if mask is None:
        mask_array = np.ones((frame_count,), dtype=bool)
    else:
        mask_array = np.asarray(mask).reshape(-1).astype(bool)
        if len(mask_array) != frame_count:
            raise HTTPException(status_code=500, detail=f"{path.name} mask must have N elements")

    if racket_pose is not None:
        racket_pose = np.asarray(racket_pose, dtype=np.float32)
        if racket_pose.ndim != 2 or racket_pose.shape != (frame_count, 3):
            raise HTTPException(status_code=500, detail=f"{path.name} racket_pose must be [N,3]")

    if racket_transform is not None:
        racket_transform = np.asarray(racket_transform, dtype=np.float32)
        if racket_transform.ndim != 3 or racket_transform.shape != (frame_count, 4, 4):
            raise HTTPException(status_code=500, detail=f"{path.name} racket_transform must be [N,4,4]")

    if racket_frame_offset is not None:
        racket_frame_offset = np.asarray(racket_frame_offset, dtype=np.float32)
        if racket_frame_offset.ndim != 2 or racket_frame_offset.shape != (frame_count, 3):
            raise HTTPException(status_code=500, detail=f"{path.name} racket_frame_offset must be [N,3]")

    local_start = max(0, request_start_frame - rally_start_frame)
    local_end = min(frame_count - 1, request_end_frame - rally_start_frame)
    if local_start > local_end:
        return None

    frames = []
    for i in range(local_start, local_end + 1):
        frame = rally_start_frame + i
        frames.append({
            "frame": frame,
            "local_frame": i,
            "t_sec": frame / fps if fps > 0 else 0.0,
            "valid": bool(mask_array[i]),
            "global_orient": global_orient[i].astype(float).tolist(),
            "body_pose": body_pose[i].astype(float).tolist(),
            "trans": trans[i].astype(float).tolist(),
            "racket_pose": racket_pose[i].astype(float).tolist() if racket_pose is not None else None,
            "racket_transform": racket_transform[i].astype(float).tolist() if racket_transform is not None else None,
            "racket_frame_offset": racket_frame_offset[i].astype(float).tolist() if racket_frame_offset is not None else None,
        })

    return {
        "id": player_id,
        "player_index": player_index,
        "court": court,
        "name": name,
        "start_frame": rally_start_frame,
        "frame_count": frame_count,
        "fps": fps,
        "beta": beta[0].astype(float).tolist(),
        "source_path": str(path),
        "smpl_forward_model": _smpl_forward_model(),
        "frames": frames,
    }


@app.get("/matches/{match_id}", response_model=MatchOut)
def get_match(match_id: int, db: Session = Depends(get_db)):
    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="match not found")
    return MatchOut(
        id=match.id,
        title=match.title,
        fps=match.fps,
        duration_frame=match.duration_frame,
        cameras=match.cameras or [],
    )


@app.get("/matches/{match_id}/timeline", response_model=TimelineOut)
def get_timeline(match_id: int, db: Session = Depends(get_db)):
    if not db.get(Match, match_id):
        raise HTTPException(status_code=404, detail="match not found")

    rallies = db.query(Rally).filter(Rally.match_id == match_id).order_by(Rally.rally_index).all()
    hits = db.query(Hit).join(Rally, Hit.rally_id == Rally.id).filter(Hit.match_id == match_id).order_by(Hit.rally_id, Hit.ball_round).all()
    anomalies = db.query(Anomaly).filter(Anomaly.match_id == match_id).order_by(Anomaly.start_frame).all()

    return TimelineOut(
        rallies=[
            _serialize_rally(r)
            for r in rallies
        ],
        hits=[
            {
                "id": h.id,
                "rally_id": h.rally_id,
                "ball_round": h.ball_round,
                "player": h.player,
                "hit_frame": h.hit_frame,
                "new_hit_frame": h.new_hit_frame,
                "shot_type": h.shot_type,
                "hand": h.hand,
                "note": h.note,
                "confidence": h.confidence,
            }
            for h in hits
        ],
        anomalies=[
            {
                "id": a.id,
                "start_frame": a.start_frame,
                "end_frame": a.end_frame,
                "kind": a.kind,
                "severity": a.severity,
                "status": a.status,
                "comment": a.comment,
            }
            for a in anomalies
        ],
    )


@app.get("/matches/{match_id}/traj", response_model=list[TrajPoint])
def get_traj(match_id: int, start: int = 0, end: int = 999999999, db: Session = Depends(get_db)):
    if not db.get(Match, match_id):
        raise HTTPException(status_code=404, detail="match not found")

    rows = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame >= start,
            BallTraj.frame <= end,
        )
        .order_by(BallTraj.frame)
        .all()
    )

    results = []
    for i, row in enumerate(rows):
        speed = None
        if i > 0:
            prev = rows[i-1]
            dt = row.t_sec - prev.t_sec
            if dt > 0:
                dist = ((row.x - prev.x)**2 + (row.y - prev.y)**2 + (row.z - prev.z)**2) ** 0.5
                speed = dist / dt
        results.append(TrajPoint(
            frame=row.frame,
            t_sec=row.t_sec,
            x=row.x,
            y=row.y,
            z=row.z,
            speed=speed,
            confidence=row.confidence,
        ))

    return results


@app.get("/matches/{match_id}/smpl-replay")
def get_smpl_replay(match_id: int, start: int, end: int, db: Session = Depends(get_db)):
    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="match not found")

    rally = (
        db.query(Rally)
        .filter(
            Rally.match_id == match_id,
            Rally.start_frame <= end,
            Rally.end_frame >= start,
        )
        .order_by(Rally.start_frame)
        .first()
    )
    if not rally:
        raise HTTPException(status_code=404, detail="rally not found for requested range")

    source = _find_rally_source(rally.start_frame, rally.end_frame)
    score = source.get("score") if source else None
    if not score:
        raise HTTPException(status_code=404, detail="rally score metadata not found")

    players = []
    checked_paths = []
    player_specs = [
        (0, "up", source.get("up_court") if source else None),
        (1, "down", source.get("down_court") if source else None),
    ]

    for player_index, court, player_name in player_specs:
        path = SMPL_REPLAY_NPZ_ROOT / f"{score}_{player_index}.npz"
        checked_paths.append(str(path))
        player = _load_smpl_motion_npz(
            path,
            player_id=f"player_{player_index}",
            player_index=player_index,
            court=court,
            name=player_name,
            rally_start_frame=rally.start_frame,
            request_start_frame=start,
            request_end_frame=end,
            fps=match.fps,
        )
        if player:
            players.append(player)

    if not players:
        raise HTTPException(
            status_code=404,
            detail={
                "message": "SMPL replay pose chunks not found",
                "score": score,
                "checked_paths": checked_paths,
            },
        )

    return {
        "match_id": match_id,
        "rally_id": rally.id,
        "rally_index": rally.rally_index,
        "score": score,
        "start_frame": rally.start_frame,
        "end_frame": rally.end_frame,
        "fps": match.fps,
        "players": players,
    }


@app.patch("/hits/{hit_id}")
def patch_hit(hit_id: int, payload: HitPatch, db: Session = Depends(get_db)):
    hit = db.get(Hit, hit_id)
    if not hit:
        raise HTTPException(status_code=404, detail="hit not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(hit, key, value)

    db.commit()
    db.refresh(hit)
    return {
        "ok": True,
        "hit": {
            "id": hit.id,
            "rally_id": hit.rally_id,
            "ball_round": hit.ball_round,
            "player": hit.player,
            "hit_frame": hit.hit_frame,
            "new_hit_frame": hit.new_hit_frame,
            "shot_type": hit.shot_type,
            "hand": hit.hand,
            "note": hit.note,
            "confidence": hit.confidence,
        },
    }


@app.patch("/anomalies/{anomaly_id}")
def patch_anomaly(anomaly_id: int, payload: AnomalyPatch, db: Session = Depends(get_db)):
    anomaly = db.get(Anomaly, anomaly_id)
    if not anomaly:
        raise HTTPException(status_code=404, detail="anomaly not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(anomaly, key, value)

    db.commit()
    db.refresh(anomaly)
    return {
        "ok": True,
        "anomaly": {
            "id": anomaly.id,
            "start_frame": anomaly.start_frame,
            "end_frame": anomaly.end_frame,
            "kind": anomaly.kind,
            "severity": anomaly.severity,
            "status": anomaly.status,
            "comment": anomaly.comment,
        },
    }


@app.patch("/matches/{match_id}/traj/repair")
def repair_traj(match_id: int, payload: TrajRepairPayload, db: Session = Depends(get_db)):
    if not db.get(Match, match_id):
        raise HTTPException(status_code=404, detail="match not found")

    start_frame = min(payload.start_frame, payload.end_frame)
    end_frame = max(payload.start_frame, payload.end_frame)

    if start_frame == end_frame:
        return {"ok": True, "count": 0}

    p_start = db.query(BallTraj).filter(BallTraj.match_id == match_id, BallTraj.frame == start_frame).first()
    p_end = db.query(BallTraj).filter(BallTraj.match_id == match_id, BallTraj.frame == end_frame).first()
    if not p_start or not p_end:
        raise HTTPException(status_code=400, detail="Start or end frame not found in trajectory data")

    points = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame > start_frame,
            BallTraj.frame < end_frame,
        )
        .all()
    )

    frame_diff = end_frame - start_frame

    p_pre = db.query(BallTraj).filter(BallTraj.match_id == match_id, BallTraj.frame < start_frame).order_by(BallTraj.frame.desc()).first()
    p_post = db.query(BallTraj).filter(BallTraj.match_id == match_id, BallTraj.frame > end_frame).order_by(BallTraj.frame.asc()).first()

    v0_x, v0_y, v0_z = p_end.x - p_start.x, p_end.y - p_start.y, p_end.z - p_start.z
    if p_pre:
        dt = end_frame - p_pre.frame
        v0_x = (p_end.x - p_pre.x) / dt * frame_diff
        v0_y = (p_end.y - p_pre.y) / dt * frame_diff
        v0_z = (p_end.z - p_pre.z) / dt * frame_diff

    v1_x, v1_y, v1_z = p_end.x - p_start.x, p_end.y - p_start.y, p_end.z - p_start.z
    if p_post:
        dt = p_post.frame - start_frame
        v1_x = (p_post.x - p_start.x) / dt * frame_diff
        v1_y = (p_post.y - p_start.y) / dt * frame_diff
        v1_z = (p_post.z - p_start.z) / dt * frame_diff

    count = 0
    for point in points:
        t = (point.frame - start_frame) / frame_diff
        t2 = t * t
        t3 = t2 * t

        h00 = 2 * t3 - 3 * t2 + 1
        h10 = t3 - 2 * t2 + t
        h01 = -2 * t3 + 3 * t2
        h11 = t3 - t2

        point.x = h00 * p_start.x + h10 * v0_x + h01 * p_end.x + h11 * v1_x
        point.y = h00 * p_start.y + h10 * v0_y + h01 * p_end.y + h11 * v1_y
        point.z = h00 * p_start.z + h10 * v0_z + h01 * p_end.z + h11 * v1_z
        count += 1

    db.commit()
    return {"ok": True, "count": count}


@app.get("/export/csv")
def export_csv(match_id: int, db: Session = Depends(get_db)):
    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="match not found")

    hits = db.query(Hit).join(Rally, Hit.rally_id == Rally.id).filter(Hit.match_id == match_id).order_by(Hit.rally_id, Hit.ball_round).all()

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["HitID", "RallyID", "BallRound", "Player", "HitFrame", "NewHitFrame", "ShotType", "Hand", "Note", "Confidence"])
    for hit in hits:
        writer.writerow([
            hit.id,
            hit.rally_id,
            hit.ball_round,
            hit.player,
            hit.hit_frame,
            hit.new_hit_frame if hit.new_hit_frame is not None else "",
            hit.shot_type,
            hit.hand,
            hit.note,
            f"{hit.confidence:.3f}",
        ])

    csv_text = output.getvalue()
    return Response(content=csv_text, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="shot_annotated_match_{match_id}.csv"'})
