import os
from fastapi import FastAPI, Depends, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select
import csv
from io import StringIO

from .db import engine, get_db
from .models import Base, Match, Rally, Hit, BallTraj, Anomaly
from .schemas import MatchOut, TimelineOut, TrajPoint, HitPatch, AnomalyPatch
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

    # seed demo data only if enabled
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
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(status_code=404, detail="match not found")
    return MatchOut(id=m.id, title=m.title, fps=m.fps, duration_sec=m.duration_sec, cameras=m.cameras or [])

@app.get("/matches/{match_id}/timeline", response_model=TimelineOut)
def get_timeline(match_id: int, db: Session = Depends(get_db)):
    if not db.get(Match, match_id):
        raise HTTPException(status_code=404, detail="match not found")

    rallies = db.query(Rally).filter(Rally.match_id == match_id).order_by(Rally.rally_index).all()
    hits = db.query(Hit).join(Rally, Hit.rally_id == Rally.id).filter(Hit.match_id == match_id).order_by(Hit.rally_id, Hit.ball_round).all()
    anomalies = db.query(Anomaly).filter(Anomaly.match_id == match_id).order_by(Anomaly.start_frame).all()

    return TimelineOut(
        rallies=[{
            "id": r.id,
            "rally_index": r.rally_index,
            "start_frame": r.start_frame,
            "end_frame": r.end_frame,
            "status": r.status,
        } for r in rallies],
        hits=[{
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
        } for h in hits],
        anomalies=[{
            "id": a.id,
            "start_frame": a.start_frame,
            "end_frame": a.end_frame,
            "kind": a.kind,
            "severity": a.severity,
            "status": a.status,
            "comment": a.comment,
        } for a in anomalies],
    )

@app.get("/matches/{match_id}/traj", response_model=list[TrajPoint])
def get_traj(match_id: int, start: int = 0, end: int = 999999999, db: Session = Depends(get_db)):
    if not db.get(Match, match_id):
        raise HTTPException(status_code=404, detail="match not found")

    q = db.query(BallTraj).filter(
        BallTraj.match_id == match_id,
        BallTraj.frame >= start,
        BallTraj.frame <= end,
    ).order_by(BallTraj.frame)

    rows = q.all()
    return [TrajPoint(frame=r.frame, t_sec=r.t_sec, x=r.x, y=r.y, z=r.z, confidence=r.confidence) for r in rows]

@app.patch("/hits/{hit_id}")
def patch_hit(hit_id: int, payload: HitPatch, db: Session = Depends(get_db)):
    h = db.get(Hit, hit_id)
    if not h:
        raise HTTPException(status_code=404, detail="hit not found")

    if payload.new_hit_frame is not None:
        h.new_hit_frame = payload.new_hit_frame
    if payload.shot_type is not None:
        h.shot_type = payload.shot_type
    if payload.hand is not None:
        h.hand = payload.hand
    if payload.note is not None:
        h.note = payload.note
    if payload.confidence is not None:
        h.confidence = payload.confidence

    db.commit()
    return {"ok": True}

@app.patch("/anomalies/{anomaly_id}")
def patch_anomaly(anomaly_id: int, payload: AnomalyPatch, db: Session = Depends(get_db)):
    a = db.get(Anomaly, anomaly_id)
    if not a:
        raise HTTPException(status_code=404, detail="anomaly not found")

    if payload.status is not None:
        a.status = payload.status
    if payload.comment is not None:
        a.comment = payload.comment
    if payload.severity is not None:
        a.severity = payload.severity
    if payload.kind is not None:
        a.kind = payload.kind

    db.commit()
    return {"ok": True}

@app.get("/export/csv")
def export_csv(match_id: int, db: Session = Depends(get_db)):
    # Export hits into a csv similar to shot_annotated.csv spirit
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(status_code=404, detail="match not found")

    hits = db.query(Hit).join(Rally, Hit.rally_id == Rally.id).filter(Hit.match_id == match_id).order_by(Hit.rally_id, Hit.ball_round).all()

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["HitID", "RallyID", "BallRound", "Player", "HitFrame", "NewHitFrame", "ShotType", "Hand", "Note", "Confidence"])
    for h in hits:
        writer.writerow([h.id, h.rally_id, h.ball_round, h.player, h.hit_frame, h.new_hit_frame if h.new_hit_frame is not None else "", h.shot_type, h.hand, h.note, f"{h.confidence:.3f}"])

    csv_text = output.getvalue()
    return Response(content=csv_text, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="shot_annotated_match_{match_id}.csv"'})
