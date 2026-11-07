"""比賽資訊、timeline 與 3D 軌跡（ball_traj）的讀取"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    Anomaly,
    BallTraj,
    Hit,
    Match,
    Rally,
)
from ..schemas import (
    MatchOut,
    TimelineOut,
    TrajPoint,
)


router = APIRouter()


@router.get(
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


@router.get(
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


@router.get(
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
