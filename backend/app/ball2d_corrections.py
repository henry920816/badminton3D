"""2D 羽球標註的修正層。

修正存在 ball_position_2d_corrections，原始的 ball_positions_2d 完全不動。
讀取 2D 資料的地方用 load_ball_2d_rows，依 source 決定要不要把修正疊上去：
'original' 只讀原始資料，'corrected' 有修正的格子以修正值為準。
"""

import csv
import io
import math
import zipfile
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import and_
from sqlalchemy.orm import Session

from .db import get_db
from .models import BallPosition2D, BallPosition2DCorrection, Match, Rally


Ball2DSource = Literal["original", "corrected"]

ALL_FRAMES = 999_999_999


router = APIRouter()


def load_ball_2d_rows(
    db: Session,
    match_id: int,
    start_frame: int,
    end_frame: int,
    *,
    camera_index: int | None = None,
    source: Ball2DSource = "original",
    visible_only: bool = False,
) -> list[dict]:
    """回傳 {camera_index, frame, visibility, x, y, corrected}，依 frame、camera 排序。

    visible_only 時原始資料在資料庫端就先濾掉看不見的列；修正值另外讀，
    所以原本看不見、修正成看得見的格子仍然會出現。
    """
    query = db.query(
        BallPosition2D.camera_index,
        BallPosition2D.frame,
        BallPosition2D.visibility,
        BallPosition2D.x,
        BallPosition2D.y,
    ).filter(
        BallPosition2D.match_id == match_id,
        BallPosition2D.frame >= start_frame,
        BallPosition2D.frame <= end_frame,
    )

    if camera_index is not None:
        query = query.filter(BallPosition2D.camera_index == camera_index)
    if visible_only:
        query = query.filter(BallPosition2D.visibility > 0)

    rows = {
        (row.camera_index, row.frame): {
            "camera_index": row.camera_index,
            "frame": row.frame,
            "visibility": row.visibility,
            "x": row.x,
            "y": row.y,
            "corrected": False,
        }
        for row in query
    }

    if source == "corrected":
        for correction in _correction_query(
            db, match_id, start_frame, end_frame, camera_index,
        ):
            rows[(correction.camera_index, correction.frame)] = {
                "camera_index": correction.camera_index,
                "frame": correction.frame,
                "visibility": correction.visibility,
                "x": correction.x,
                "y": correction.y,
                "corrected": True,
            }

    result = sorted(rows.values(), key=lambda row: (row["frame"], row["camera_index"]))

    if visible_only:
        result = [row for row in result if row["visibility"] > 0]

    return result


def _correction_query(db, match_id, start_frame, end_frame, camera_index=None):
    query = db.query(BallPosition2DCorrection).filter(
        BallPosition2DCorrection.match_id == match_id,
        BallPosition2DCorrection.frame >= start_frame,
        BallPosition2DCorrection.frame <= end_frame,
    )
    if camera_index is not None:
        query = query.filter(BallPosition2DCorrection.camera_index == camera_index)
    return query


def _require_match(db: Session, match_id: int) -> Match:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="match not found")
    return match


def _original_point(db, match_id, camera_index, frame) -> dict | None:
    row = db.query(BallPosition2D).filter_by(
        match_id=match_id, camera_index=camera_index, frame=frame,
    ).first()
    if row is None:
        return None
    return {"visibility": row.visibility, "x": row.x, "y": row.y}


def _correction_dict(correction: BallPosition2DCorrection, original: dict | None) -> dict:
    return {
        "camera_index": correction.camera_index,
        "frame": correction.frame,
        "visibility": correction.visibility,
        "x": correction.x,
        "y": correction.y,
        "original": original,
        "updated_at": correction.updated_at.isoformat() if correction.updated_at else None,
    }


class Ball2DCorrectionPayload(BaseModel):
    camera_index: int = Field(ge=0)
    frame: int = Field(ge=0)
    visibility: int = Field(ge=0, le=1)
    x: float = 0.0
    y: float = 0.0


@router.get("/matches/{match_id}/traj2d/corrections")
def list_ball_2d_corrections(
    match_id: int,
    camera_index: int | None = None,
    start: int = 0,
    end: int = ALL_FRAMES,
    db: Session = Depends(get_db),
):
    """列出修正，每筆附上對應的原始值（原始資料沒有這格時為 null）。"""
    _require_match(db, match_id)

    query = (
        db.query(BallPosition2DCorrection, BallPosition2D)
        .outerjoin(
            BallPosition2D,
            and_(
                BallPosition2D.match_id == BallPosition2DCorrection.match_id,
                BallPosition2D.camera_index == BallPosition2DCorrection.camera_index,
                BallPosition2D.frame == BallPosition2DCorrection.frame,
            ),
        )
        .filter(
            BallPosition2DCorrection.match_id == match_id,
            BallPosition2DCorrection.frame >= start,
            BallPosition2DCorrection.frame <= end,
        )
    )
    if camera_index is not None:
        query = query.filter(BallPosition2DCorrection.camera_index == camera_index)

    return [
        _correction_dict(
            correction,
            {"visibility": original.visibility, "x": original.x, "y": original.y}
            if original is not None else None,
        )
        for correction, original in query.order_by(
            BallPosition2DCorrection.camera_index,
            BallPosition2DCorrection.frame,
        )
    ]


@router.put("/matches/{match_id}/traj2d/corrections")
def save_ball_2d_correction(
    match_id: int,
    payload: Ball2DCorrectionPayload,
    db: Session = Depends(get_db),
):
    """新增或覆寫一格的修正。看不見（visibility 0）時座標存成 0，同原始 CSV。"""
    match = _require_match(db, match_id)

    if payload.frame > match.duration_frame:
        raise HTTPException(status_code=400, detail="frame 超出資料集範圍")

    visible = payload.visibility == 1
    if visible and not (math.isfinite(payload.x) and math.isfinite(payload.y)):
        raise HTTPException(status_code=400, detail="x、y 必須是有限數值")

    correction = db.query(BallPosition2DCorrection).filter_by(
        match_id=match_id, camera_index=payload.camera_index, frame=payload.frame,
    ).first()

    now = datetime.utcnow()
    if correction is None:
        correction = BallPosition2DCorrection(
            match_id=match_id,
            camera_index=payload.camera_index,
            frame=payload.frame,
            created_at=now,
        )
        db.add(correction)

    correction.visibility = payload.visibility
    correction.x = float(payload.x) if visible else 0.0
    correction.y = float(payload.y) if visible else 0.0
    correction.updated_at = now

    db.commit()
    db.refresh(correction)

    return _correction_dict(
        correction,
        _original_point(db, match_id, payload.camera_index, payload.frame),
    )


@router.delete("/matches/{match_id}/traj2d/corrections")
def delete_ball_2d_correction(
    match_id: int,
    camera_index: int,
    frame: int,
    db: Session = Depends(get_db),
):
    """刪掉一格的修正，回到原始值。回傳原始值讓前端還原畫面。"""
    _require_match(db, match_id)

    correction = db.query(BallPosition2DCorrection).filter_by(
        match_id=match_id, camera_index=camera_index, frame=frame,
    ).first()
    if correction is None:
        raise HTTPException(status_code=404, detail="這格沒有修正")

    db.delete(correction)
    db.commit()

    return {
        "camera_index": camera_index,
        "frame": frame,
        "original": _original_point(db, match_id, camera_index, frame),
    }


def _csv_text(header: list[str], rows: list[list]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue()


def _format_coordinate(value: float) -> str:
    return f"{value:.6g}"


@router.get("/matches/{match_id}/traj2d/corrections/export")
def export_corrected_ball_2d(
    match_id: int,
    match_number: int | None = Query(default=None, ge=0),
    db: Session = Depends(get_db),
):
    """匯出「原始 + 修正」合併後的 2D 標註 zip。

    每個 rally、每台相機一個 *_ball.csv，路徑與檔名同上傳格式
    （rally{r}/view{c}/v3/match{N}_{r}_{start}_{end}_view{c}_ball.csv，
    Frame 從 rally 起點算起），可以直接當成新的資料集上傳。原始的 match
    編號沒有存在資料庫，預設用資料庫的 match id，可用 match_number 指定。
    另附 corrections.csv 列出每一筆修正與原始值，rally 範圍外的修正也在裡面。
    """
    match = _require_match(db, match_id)
    number = match_number if match_number is not None else match.id

    rows_by_camera: dict[int, dict[int, dict]] = {}
    for row in load_ball_2d_rows(db, match_id, 0, ALL_FRAMES, source="corrected"):
        rows_by_camera.setdefault(row["camera_index"], {})[row["frame"]] = row

    rallies = (
        db.query(Rally)
        .filter(Rally.match_id == match_id)
        .order_by(Rally.start_frame)
        .all()
    )

    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
        for rally in rallies:
            # 上傳格式的 Frame 介於 0（含）與 end - start（不含）
            span = range(rally.start_frame, rally.end_frame)
            for camera_index in sorted(rows_by_camera):
                camera_rows = rows_by_camera[camera_index]
                frames = [frame for frame in span if frame in camera_rows]
                if not frames:
                    continue
                path = (
                    f"rally{rally.rally_index}/view{camera_index}/v3/"
                    f"match{number}_{rally.rally_index}_{rally.start_frame}_"
                    f"{rally.end_frame}_view{camera_index}_ball.csv"
                )
                zipped.writestr(path, _csv_text(
                    ["Frame", "Visibility", "X", "Y"],
                    [
                        [
                            frame - rally.start_frame,
                            camera_rows[frame]["visibility"],
                            _format_coordinate(camera_rows[frame]["x"]),
                            _format_coordinate(camera_rows[frame]["y"]),
                        ]
                        for frame in frames
                    ],
                ))

        corrections = list_ball_2d_corrections(match_id, db=db)
        zipped.writestr("corrections.csv", _csv_text(
            [
                "Camera", "Frame", "Visibility", "X", "Y",
                "OriginalVisibility", "OriginalX", "OriginalY", "UpdatedAt",
            ],
            [
                [
                    item["camera_index"],
                    item["frame"],
                    item["visibility"],
                    _format_coordinate(item["x"]),
                    _format_coordinate(item["y"]),
                    *(
                        [
                            item["original"]["visibility"],
                            _format_coordinate(item["original"]["x"]),
                            _format_coordinate(item["original"]["y"]),
                        ]
                        if item["original"] else ["", "", ""]
                    ),
                    item["updated_at"] or "",
                ]
                for item in corrections
            ],
        ))

    return Response(
        content=archive.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="match{match_id}_ball_2d_corrected.zip"'
            ),
        },
    )
