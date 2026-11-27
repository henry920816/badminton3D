"""整場比賽的藍色 2D 標註清除。

只掃描目前資料集的 Rally；分段查 DB、分段寫修正，避免整場資料一次塞進記憶體。
所有 Rally 共用同一個修正批號，按一次「上一步」可全部還原。
"""

from bisect import bisect_left
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .ball2d_corrections import load_ball_2d_rows
from .db import get_db
from .edit_history import add_history, make_batch, snapshot
from .models import BallPosition2DCorrection, BallTraj, Match, Rally
from .quality_review import blue_review_issue, view_projection
from .repair_geometry import cameras_by_index_for_match

router = APIRouter()
FRAME_CHUNK = 1500
HISTORY_CHUNK = 250


def rally_ranges(rallies):
    """Rally 可能重疊，先合併，避免同一幀處理兩次。"""
    windows = sorted((int(row.start_frame), int(row.end_frame)) for row in rallies
                     if int(row.end_frame) >= int(row.start_frame))
    merged = []
    for start, end in windows:
        if merged and start <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def frame_chunks(windows):
    for start, end in windows:
        for first in range(start, end + 1, FRAME_CHUNK):
            yield first, min(end, first + FRAME_CHUNK - 1)


def blue_points_in_range(db, match, cameras, start, end):
    """在指定範圍找出藍格；規則和品質格共用 blue_review_issue。"""
    observations = load_ball_2d_rows(db, match.id, start, end,
                                     source='corrected', visible_only=True)
    if not observations:
        return []
    points3d = {
        int(row.frame): {'x': row.x, 'y': row.y, 'z': row.z}
        for row in db.query(BallTraj).filter(
            BallTraj.match_id == match.id,
            BallTraj.frame >= start,
            BallTraj.frame <= end,
        )
    }
    selected = []
    for row in observations:
        camera = cameras.get(int(row['camera_index']))
        if camera is None:
            continue
        frame = int(row['frame'])
        if blue_review_issue(view_projection(points3d.get(frame), camera), row):
            selected.append((frame, int(row['camera_index'])))
    return selected


@router.post('/matches/{match_id}/traj2d/review-hide-dataset')
def hide_blue_for_dataset(match_id: int, db: Session = Depends(get_db)):
    """消除目前資料集所有 Rally 的藍格；不改原始 2D，不跳確認視窗。"""
    try:
        match = db.query(Match).filter(Match.id == match_id).with_for_update().first()
        if match is None:
            raise HTTPException(404, detail='找不到資料集')
        rallies = db.query(Rally).filter(Rally.match_id == match_id).order_by(Rally.start_frame).all()
        cameras = cameras_by_index_for_match(match)
        windows = rally_ranges(rallies)
        rally_spans = [(int(r.id), int(r.start_frame), int(r.end_frame)) for r in rallies]
        history_ids = []
        affected_rallies = set()
        affected_frames = 0
        hidden_points = 0
        batch = None
        now = datetime.utcnow()

        # 每批只看最多 1500 幀，不需要把所有 Rally 的點全部讀進來。
        for start, end in frame_chunks(windows):
            selected = blue_points_in_range(db, match, cameras, start, end)
            if not selected:
                continue
            if batch is None:
                batch = make_batch(db, match_id)

            existing = {
                (int(row.frame), int(row.camera_index)): row
                for row in db.query(BallPosition2DCorrection).filter(
                    BallPosition2DCorrection.match_id == match_id,
                    BallPosition2DCorrection.frame >= start,
                    BallPosition2DCorrection.frame <= end,
                )
            }
            before, after = [], []
            history_rows = []
            selected_frames = sorted({frame for frame, _ in selected})
            hidden_points += len(selected)
            affected_frames += len(selected_frames)

            for rally_id, first, last in rally_spans:
                index = bisect_left(selected_frames, first)
                if index < len(selected_frames) and selected_frames[index] <= last:
                    affected_rallies.add(rally_id)

            for frame, index in selected:
                previous = existing.get((frame, index))
                before.append(snapshot(previous, index, frame))
                if previous is None:
                    previous = BallPosition2DCorrection(
                        match_id=match_id, frame=frame, camera_index=index,
                        created_at=now,
                    )
                    db.add(previous)
                previous.visibility = 0
                previous.x = 0.0
                previous.y = 0.0
                previous.updated_at = now
                after.append({'camera_index': index, 'frame': frame, 'existed': True,
                              'visibility': 0, 'x': 0.0, 'y': 0.0})
                if len(after) == HISTORY_CHUNK:
                    history_rows.append(add_history(
                        db, match_id, frame, before, after, batch,
                        '整場藍色 2D 標註清除',
                    ))
                    before, after = [], []

            if after:
                history_rows.append(add_history(
                    db, match_id, selected[-1][0], before, after, batch,
                    '整場藍色 2D 標註清除',
                ))
            db.flush()
            history_ids.extend(int(row.id) for row in history_rows)

        if batch is not None:
            db.commit()
        else:
            db.rollback()
        return {'ok': True, 'hidden_points': hidden_points,
                'affected_frames': affected_frames,
                'affected_rallies': len(affected_rallies),
                'total_rallies': len(rallies), 'repair_ids': history_ids}
    except Exception:
        db.rollback()
        raise
