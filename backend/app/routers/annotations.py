"""擊球與異常標註的修改"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    Anomaly,
    Hit,
)
from ..schemas import (
    AnomalyPatch,
    HitPatch,
)


router = APIRouter()


@router.patch(
    "/hits/{hit_id}"
)
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

    update_data = (
        payload.model_dump(
            exclude_unset=True
        )
    )

    for key, value in (
        update_data.items()
    ):
        setattr(
            hit,
            key,
            value,
        )

    db.commit()

    db.refresh(
        hit
    )

    return {
        "ok":
            True,

        "hit": {
            "id":
                hit.id,

            "rally_id":
                hit.rally_id,

            "ball_round":
                hit.ball_round,

            "player":
                hit.player,

            "hit_frame":
                hit.hit_frame,

            "new_hit_frame":
                hit.new_hit_frame,

            "shot_type":
                hit.shot_type,

            "hand":
                hit.hand,

            "note":
                hit.note,

            "confidence":
                hit.confidence,
        },
    }


@router.patch(
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

    update_data = (
        payload.model_dump(
            exclude_unset=True
        )
    )

    for key, value in (
        update_data.items()
    ):
        setattr(
            anomaly,
            key,
            value,
        )

    db.commit()

    db.refresh(
        anomaly
    )

    return {
        "ok":
            True,

        "anomaly": {
            "id":
                anomaly.id,

            "start_frame":
                anomaly.start_frame,

            "end_frame":
                anomaly.end_frame,

            "kind":
                anomaly.kind,

            "severity":
                anomaly.severity,

            "status":
                anomaly.status,

            "comment":
                anomaly.comment,
        },
    }
