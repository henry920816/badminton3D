import csv
import os
from io import StringIO

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .db import engine, get_db
from .models import Anomaly, BallTraj, Base, Hit, Match, Rally
from .schemas import AnomalyPatch, HitPatch, MatchOut, TimelineOut, TrajPoint, TrajRepairPayload
from .seed import seed_demo

app = FastAPI(title="Badminton 3D Debugger MVP", version="0.1.0")

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
            {
                "id": r.id,
                "rally_index": r.rally_index,
                "start_frame": r.start_frame,
                "end_frame": r.end_frame,
                "status": r.status,
            }
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

    return [
        TrajPoint(
            frame=row.frame,
            t_sec=row.t_sec,
            x=row.x,
            y=row.y,
            z=row.z,
            speed=row.speed,
            confidence=row.confidence,
        )
        for row in rows
    ]


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
