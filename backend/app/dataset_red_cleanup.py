"""整份資料集的紅色 2D 位置修正。

逐段套用品質檢查的紅色判定，不能只依誤差大小硬改。
原始標註不動，整批修正共用一筆上一步／下一步操作。
"""

from datetime import datetime
from bisect import bisect_left

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .dataset_blue_cleanup import frame_chunks, rally_ranges, HISTORY_CHUNK
from .db import get_db
from .edit_history import add_history, make_batch, snapshot
from .models import BallPosition2DCorrection, Match, Rally
from .review_repair_routes import _get_inputs

router = APIRouter()


def red_points_in_range(db, match, start, end):
    """只取後端已確認可以套用 3D 投影的紅格。"""
    selected = []
    for row in _get_inputs(db, match, start, end):
        frame = int(row['frame'])
        for cell in row['cameras']:
            if (cell.get('review_status') != 'auto_fix'
                    or cell.get('review_action') != 'move_to_3d'
                    or not cell.get('review_auto_allowed')):
                continue
            xy = cell.get('review_candidate_2d')
            if xy is not None:
                selected.append((frame, int(cell['camera_index']), float(xy['x']), float(xy['y'])))
    return selected


@router.post('/matches/{match_id}/traj2d/review-repair-dataset')
def repair_all_red_dataset(match_id: int, db: Session = Depends(get_db)):
    """一次修正所有 Rally 的紅格；已經修正過的點不重複覆蓋。"""
    try:
        match = db.query(Match).filter(Match.id == match_id).with_for_update().first()
        if match is None:
            raise HTTPException(404, detail='找不到資料集')

        rallies = db.query(Rally).filter(Rally.match_id == match_id).order_by(Rally.start_frame).all()
        batch = None
        history_ids = []
        corrected_count = 0
        changed_frames = set()
        changed_rallies = set()
        # Rally 的結束影格依專案慣例包含在內；重疊範圍只會掃描一次。
        for start, end in frame_chunks(rally_ranges(rallies)):
            candidates = red_points_in_range(db, match, start, end)
            if not candidates:
                continue
            # 一個 3D 投影可能已經在之前的人工修正中使用過，這裡絕對不能覆蓋。
            existing = {
                (int(item.frame), int(item.camera_index))
                for item in db.query(BallPosition2DCorrection).filter(
                    BallPosition2DCorrection.match_id == match_id,
                    BallPosition2DCorrection.frame >= start,
                    BallPosition2DCorrection.frame <= end,
                )
            }
            candidates = [row for row in candidates if (row[0], row[1]) not in existing]
            if not candidates:
                continue
            if batch is None:
                batch = make_batch(db, match_id)
            changed_in_chunk = sorted({frame for frame, _, _, _ in candidates})
            for rally in rallies:
                position = bisect_left(changed_in_chunk, int(rally.start_frame))
                if position < len(changed_in_chunk) and changed_in_chunk[position] <= int(rally.end_frame):
                    changed_rallies.add(int(rally.id))
            before, after = [], []
            for frame, camera_index, x, y in candidates:
                db.add(BallPosition2DCorrection(
                    match_id=match_id, frame=frame, camera_index=camera_index,
                    visibility=1, x=x, y=y,
                    created_at=datetime.utcnow(), updated_at=datetime.utcnow(),
                ))
                before.append(snapshot(None, camera_index, frame))
                after.append({'camera_index': camera_index, 'frame': frame,
                              'existed': True, 'visibility': 1, 'x': x, 'y': y})
                changed_frames.add(frame)
                corrected_count += 1
                if len(after) >= HISTORY_CHUNK:
                    record = add_history(db, match_id, frame, before, after, batch,
                                         '整場紅色 2D 位置修正', source='auto_2d_overlay')
                    db.flush()
                    history_ids.append(int(record.id))
                    before, after = [], []
            if after:
                record = add_history(db, match_id, candidates[-1][0], before, after, batch,
                                     '整場紅色 2D 位置修正', source='auto_2d_overlay')
                db.flush()
                history_ids.append(int(record.id))
        if batch:
            db.commit()
        else:
            db.rollback()
        return {
            'ok': True, 'repaired_points': corrected_count,
            'repaired_frames': len(changed_frames),
            'affected_rallies': len(changed_rallies),
            'total_rallies': len(rallies),
            'repair_ids': history_ids[:100],
        }
    except Exception:
        db.rollback()
        raise
