import csv
import os
from io import StringIO

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .db import engine, get_db
from .dataset_upload import router as dataset_upload_router
from .models import Anomaly, BallTraj, Base, Hit, Match, Rally
from .schemas import (
    AnomalyPatch,
    HitPatch,
    MatchOut,
    TimelineOut,
    TrajPoint,
    TrajRepairPayload,
)


app = FastAPI(
    title="Badminton 3D Debugger MVP",
    version="0.1.0",
)

app.include_router(
    dataset_upload_router
)


CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173",
)

origins = [
    origin.strip()
    for origin in CORS_ORIGINS.split(",")
    if origin.strip()
]


app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(
        bind=engine
    )


@app.get("/health")
def health():
    return {
        "ok": True,
    }


@app.get(
    "/matches/{match_id}",
    response_model=MatchOut,
)
def get_match(
    match_id: int,
    db: Session = Depends(get_db),
):
    match = db.get(
        Match,
        match_id,
    )

    if match is None:
        raise HTTPException(
            status_code=404,
            detail="match not found",
        )

    return MatchOut(
        id=match.id,
        title=match.title,
        fps=match.fps,
        duration_frame=match.duration_frame,
        cameras=match.cameras or [],
    )


@app.get(
    "/matches/{match_id}/timeline",
    response_model=TimelineOut,
)
def get_timeline(
    match_id: int,
    db: Session = Depends(get_db),
):
    match = db.get(
        Match,
        match_id,
    )

    if match is None:
        raise HTTPException(
            status_code=404,
            detail="match not found",
        )

    rallies = (
        db.query(Rally)
        .filter(
            Rally.match_id == match_id
        )
        .order_by(
            Rally.rally_index
        )
        .all()
    )

    hits = (
        db.query(Hit)
        .join(
            Rally,
            Hit.rally_id == Rally.id,
        )
        .filter(
            Hit.match_id == match_id
        )
        .order_by(
            Hit.rally_id,
            Hit.ball_round,
        )
        .all()
    )

    anomalies = (
        db.query(Anomaly)
        .filter(
            Anomaly.match_id == match_id
        )
        .order_by(
            Anomaly.start_frame
        )
        .all()
    )

    return TimelineOut(
        rallies=[
            {
                "id": rally.id,
                "rally_index": rally.rally_index,
                "start_frame": rally.start_frame,
                "end_frame": rally.end_frame,
                "status": rally.status,
            }
            for rally in rallies
        ],
        hits=[
            {
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
            }
            for hit in hits
        ],
        anomalies=[
            {
                "id": anomaly.id,
                "start_frame": anomaly.start_frame,
                "end_frame": anomaly.end_frame,
                "kind": anomaly.kind,
                "severity": anomaly.severity,
                "status": anomaly.status,
                "comment": anomaly.comment,
            }
            for anomaly in anomalies
        ],
    )


@app.get(
    "/matches/{match_id}/traj",
    response_model=list[TrajPoint],
)
def get_traj(
    match_id: int,
    start: int = 0,
    end: int = 999999999,
    db: Session = Depends(get_db),
):
    match = db.get(
        Match,
        match_id,
    )

    if match is None:
        raise HTTPException(
            status_code=404,
            detail="match not found",
        )

    rows = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame >= start,
            BallTraj.frame <= end,
        )
        .order_by(
            BallTraj.frame
        )
        .all()
    )

    results = []

    for index, row in enumerate(rows):
        speed = None

        if index > 0:
            previous = rows[index - 1]

            time_difference = (
                row.t_sec
                - previous.t_sec
            )

            if time_difference > 0:
                distance = (
                    (
                        row.x
                        - previous.x
                    ) ** 2
                    + (
                        row.y
                        - previous.y
                    ) ** 2
                    + (
                        row.z
                        - previous.z
                    ) ** 2
                ) ** 0.5

                speed = (
                    distance
                    / time_difference
                )

        results.append(
            TrajPoint(
                frame=row.frame,
                t_sec=row.t_sec,
                x=row.x,
                y=row.y,
                z=row.z,
                speed=speed,
                confidence=row.confidence,
            )
        )

    return results


@app.patch("/hits/{hit_id}")
def patch_hit(
    hit_id: int,
    payload: HitPatch,
    db: Session = Depends(get_db),
):
    hit = db.get(
        Hit,
        hit_id,
    )

    if hit is None:
        raise HTTPException(
            status_code=404,
            detail="hit not found",
        )

    update_data = payload.model_dump(
        exclude_unset=True
    )

    for key, value in update_data.items():
        setattr(
            hit,
            key,
            value,
        )

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


@app.patch(
    "/anomalies/{anomaly_id}"
)
def patch_anomaly(
    anomaly_id: int,
    payload: AnomalyPatch,
    db: Session = Depends(get_db),
):
    anomaly = db.get(
        Anomaly,
        anomaly_id,
    )

    if anomaly is None:
        raise HTTPException(
            status_code=404,
            detail="anomaly not found",
        )

    update_data = payload.model_dump(
        exclude_unset=True
    )

    for key, value in update_data.items():
        setattr(
            anomaly,
            key,
            value,
        )

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


@app.patch(
    "/matches/{match_id}/traj/repair"
)
def repair_traj(
    match_id: int,
    payload: TrajRepairPayload,
    db: Session = Depends(get_db),
):
    match = db.get(
        Match,
        match_id,
    )

    if match is None:
        raise HTTPException(
            status_code=404,
            detail="match not found",
        )

    start_frame = min(
        payload.start_frame,
        payload.end_frame,
    )

    end_frame = max(
        payload.start_frame,
        payload.end_frame,
    )

    if start_frame == end_frame:
        return {
            "ok": True,
            "count": 0,
        }

    start_point = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame == start_frame,
        )
        .first()
    )

    end_point = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame == end_frame,
        )
        .first()
    )

    if (
        start_point is None
        or end_point is None
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Start or end frame not found "
                "in trajectory data"
            ),
        )

    points = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame > start_frame,
            BallTraj.frame < end_frame,
        )
        .all()
    )

    frame_difference = (
        end_frame
        - start_frame
    )

    previous_point = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame < start_frame,
        )
        .order_by(
            BallTraj.frame.desc()
        )
        .first()
    )

    next_point = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame > end_frame,
        )
        .order_by(
            BallTraj.frame.asc()
        )
        .first()
    )

    start_velocity_x = (
        end_point.x
        - start_point.x
    )

    start_velocity_y = (
        end_point.y
        - start_point.y
    )

    start_velocity_z = (
        end_point.z
        - start_point.z
    )

    if previous_point is not None:
        time_difference = (
            end_frame
            - previous_point.frame
        )

        start_velocity_x = (
            (
                end_point.x
                - previous_point.x
            )
            / time_difference
            * frame_difference
        )

        start_velocity_y = (
            (
                end_point.y
                - previous_point.y
            )
            / time_difference
            * frame_difference
        )

        start_velocity_z = (
            (
                end_point.z
                - previous_point.z
            )
            / time_difference
            * frame_difference
        )

    end_velocity_x = (
        end_point.x
        - start_point.x
    )

    end_velocity_y = (
        end_point.y
        - start_point.y
    )

    end_velocity_z = (
        end_point.z
        - start_point.z
    )

    if next_point is not None:
        time_difference = (
            next_point.frame
            - start_frame
        )

        end_velocity_x = (
            (
                next_point.x
                - start_point.x
            )
            / time_difference
            * frame_difference
        )

        end_velocity_y = (
            (
                next_point.y
                - start_point.y
            )
            / time_difference
            * frame_difference
        )

        end_velocity_z = (
            (
                next_point.z
                - start_point.z
            )
            / time_difference
            * frame_difference
        )

    count = 0

    for point in points:
        time_ratio = (
            point.frame
            - start_frame
        ) / frame_difference

        time_ratio_squared = (
            time_ratio
            * time_ratio
        )

        time_ratio_cubed = (
            time_ratio_squared
            * time_ratio
        )

        h00 = (
            2
            * time_ratio_cubed
            - 3
            * time_ratio_squared
            + 1
        )

        h10 = (
            time_ratio_cubed
            - 2
            * time_ratio_squared
            + time_ratio
        )

        h01 = (
            -2
            * time_ratio_cubed
            + 3
            * time_ratio_squared
        )

        h11 = (
            time_ratio_cubed
            - time_ratio_squared
        )

        point.x = (
            h00 * start_point.x
            + h10 * start_velocity_x
            + h01 * end_point.x
            + h11 * end_velocity_x
        )

        point.y = (
            h00 * start_point.y
            + h10 * start_velocity_y
            + h01 * end_point.y
            + h11 * end_velocity_y
        )

        point.z = (
            h00 * start_point.z
            + h10 * start_velocity_z
            + h01 * end_point.z
            + h11 * end_velocity_z
        )

        count += 1

    db.commit()

    return {
        "ok": True,
        "count": count,
    }


@app.get("/export/csv")
def export_csv(
    match_id: int,
    db: Session = Depends(get_db),
):
    match = db.get(
        Match,
        match_id,
    )

    if match is None:
        raise HTTPException(
            status_code=404,
            detail="match not found",
        )

    hits = (
        db.query(Hit)
        .join(
            Rally,
            Hit.rally_id == Rally.id,
        )
        .filter(
            Hit.match_id == match_id
        )
        .order_by(
            Hit.rally_id,
            Hit.ball_round,
        )
        .all()
    )

    output = StringIO()
    writer = csv.writer(output)

    writer.writerow(
        [
            "HitID",
            "RallyID",
            "BallRound",
            "Player",
            "HitFrame",
            "NewHitFrame",
            "ShotType",
            "Hand",
            "Note",
            "Confidence",
        ]
    )

    for hit in hits:
        writer.writerow(
            [
                hit.id,
                hit.rally_id,
                hit.ball_round,
                hit.player,
                hit.hit_frame,
                (
                    hit.new_hit_frame
                    if hit.new_hit_frame is not None
                    else ""
                ),
                hit.shot_type,
                hit.hand,
                hit.note,
                f"{hit.confidence:.3f}",
            ]
        )

    csv_text = output.getvalue()

    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                "attachment; "
                f'filename="shot_annotated_match_{match_id}.csv"'
            )
        },
    )