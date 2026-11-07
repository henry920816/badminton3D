"""匯出擊球資料 CSV"""

import csv
from io import StringIO

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    Hit,
    Match,
    Rally,
)


router = APIRouter()


@router.get(
    "/export/csv"
)
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
            Hit.rally_id
            == Rally.id,
        )
        .filter(
            Hit.match_id
            == match_id
        )
        .order_by(
            Hit.rally_id,
            Hit.ball_round,
        )
        .all()
    )

    output = (
        StringIO()
    )

    writer = csv.writer(
        output
    )

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
                    if (
                        hit.new_hit_frame
                        is not None
                    )
                    else ""
                ),

                hit.shot_type,

                hit.hand,

                hit.note,

                f"{hit.confidence:.3f}",
            ]
        )

    csv_text = (
        output.getvalue()
    )

    return Response(
        content=
            csv_text,

        media_type=
            "text/csv",

        headers={
            "Content-Disposition": (
                "attachment; "
                f'filename="shot_annotated_match_{match_id}.csv"'
            )
        },
    )
