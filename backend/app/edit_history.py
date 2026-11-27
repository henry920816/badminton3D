"""2D 修正的上一步／下一步。使用現有的修復紀錄表，不變更資料庫結構。

每次使用者操作是一批；還原前會比對目前修正層，防止覆蓋後續更動。
"""
from datetime import datetime
import math
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .db import get_db
from .models import BallPosition2D, BallPosition2DCorrection, Match, TrajectoryRepairHistory

router = APIRouter()
EDIT_SOURCES = ('auto_2d_overlay', 'manual_2d_overlay')


def make_batch(db, match_id):
    """新操作會使先前復原的操作不能再往前重做。必須和本次寫入同一交易。"""
    undone = db.query(TrajectoryRepairHistory).filter(
        TrajectoryRepairHistory.match_id == match_id,
        TrajectoryRepairHistory.source.in_(EDIT_SOURCES),
        TrajectoryRepairHistory.reverted_at.is_not(None),
    ).all()
    for row in undone:
        meta = row.reprojection or {}
        if meta.get('edit_batch') and not meta.get('redo_discarded'):
            row.reprojection = {**meta, 'redo_discarded': True}
    return uuid4().hex


def add_history(db, match_id, frame, before, after, batch, label, source='manual_2d_overlay'):
    """before/after 的每一點記錄的是修正表，不是原始資料。"""
    record = TrajectoryRepairHistory(
        match_id=match_id, frame=frame, source=source,
        original_point=None, repaired_point={}, original_2d=before,
        repaired_2d=after, reprojection={'edit_batch': batch, 'edit_label': label},
        created_at=datetime.utcnow(),
    )
    db.add(record)
    return record


def snapshot(row, camera_index, frame):
    return {
        'camera_index': int(camera_index), 'frame': int(frame),
        'existed': row is not None,
        'visibility': int(row.visibility) if row is not None else 0,
        'x': float(row.x) if row is not None else 0.0,
        'y': float(row.y) if row is not None else 0.0,
    }


def _records(db, match_id):
    return [row for row in db.query(TrajectoryRepairHistory).filter(
        TrajectoryRepairHistory.match_id == match_id,
        TrajectoryRepairHistory.source.in_(EDIT_SOURCES),
    ).order_by(TrajectoryRepairHistory.id).all()
        if ((row.reprojection or {}).get('edit_batch') and
            not (row.reprojection or {}).get('source_data_invalidated'))]


def _batches(rows):
    result = {}
    for row in rows:
        meta = row.reprojection or {}
        key = meta['edit_batch']
        group = result.setdefault(key, {'id': key, 'label': meta.get('edit_label', '2D 修正'),
                                        'rows': [], 'last_id': row.id,
                                        'reverted_at': row.reverted_at,
                                        'discarded': bool(meta.get('redo_discarded'))})
        group['rows'].append(row)
        group['last_id'] = max(group['last_id'], row.id)
        if row.reverted_at and (group['reverted_at'] is None or row.reverted_at > group['reverted_at']):
            group['reverted_at'] = row.reverted_at
        if meta.get('redo_discarded'):
            group['discarded'] = True
    return list(result.values())


def _candidates(db, match_id):
    groups = _batches(_records(db, match_id))
    active = [group for group in groups if all(row.reverted_at is None for row in group['rows'])]
    undone = [group for group in groups if not group['discarded'] and
              all(row.reverted_at is not None for row in group['rows'])]
    last_active = max(active, key=lambda group: group['last_id'], default=None)
    last_undone = max(undone, key=lambda group: (group['reverted_at'], group['last_id']), default=None)
    return last_active, last_undone


@router.get('/matches/{match_id}/traj2d/edit-history')
def get_2d_edit_history(match_id: int, db: Session = Depends(get_db)):
    if db.get(Match, match_id) is None:
        raise HTTPException(404, detail='找不到資料集')
    undo, redo = _candidates(db, match_id)
    return {'can_undo': undo is not None, 'undo_label': undo['label'] if undo else None,
            'can_redo': redo is not None, 'redo_label': redo['label'] if redo else None}


def _equal(current, expected):
    if bool(current) != bool(expected.get('existed')):
        return False
    if current is None:
        return True
    return (int(current.visibility) == int(expected['visibility']) and
            math.isclose(float(current.x), float(expected['x']), abs_tol=1e-6, rel_tol=0) and
            math.isclose(float(current.y), float(expected['y']), abs_tol=1e-6, rel_tol=0))


def _apply(db, match_id, direction):
    match = db.query(Match).filter(Match.id == match_id).with_for_update().first()
    if match is None:
        raise HTTPException(404, detail='找不到資料集')
    undo, redo = _candidates(db, match_id)
    selected = undo if direction == 'undo' else redo
    if selected is None:
        raise HTTPException(409, detail='沒有可執行的上一步／下一步')

    # 大批次修正可能跨數萬幀。先整理要動的 key，再分段查 DB；
    # 不要每筆修正都單獨查一次 PostgreSQL。
    expected = {}
    targets = {}
    for history in selected['rows']:
        before = {(int(p['camera_index']), int(p.get('frame', history.frame))): p
                  for p in history.original_2d or []}
        after = {(int(p['camera_index']), int(p.get('frame', history.frame))): p
                 for p in history.repaired_2d or []}
        if not before or before.keys() != after.keys():
            raise HTTPException(409, detail='修正紀錄不完整')
        source = after if direction == 'undo' else before
        target = before if direction == 'undo' else after
        for key, row in source.items():
            if key in expected:
                raise HTTPException(409, detail='同一批操作重複修正相同影格')
            expected[key] = row
            targets[key] = target[key]

    frames = sorted({frame for _, frame in expected})
    needs_original = {frame for key, target in targets.items() if not target.get('existed')
                      for frame in (key[1],)}
    current = {}
    original = {}
    for offset in range(0, len(frames), 400):
        chunk = frames[offset:offset + 400]
        for row in db.query(BallPosition2DCorrection).filter(
            BallPosition2DCorrection.match_id == match_id,
            BallPosition2DCorrection.frame.in_(chunk),
        ):
            key = int(row.camera_index), int(row.frame)
            if key in expected:
                current[key] = row
        # 「回到原始 2D」時才需要查有效原始值。
        if needs_original.intersection(chunk):
            for row in db.query(BallPosition2D).filter(
                BallPosition2D.match_id == match_id,
                BallPosition2D.frame.in_(chunk),
            ):
                original[(int(row.camera_index), int(row.frame))] = row

    for key, source in expected.items():
        if not _equal(current.get(key), source):
            raise HTTPException(409, detail=f'Cam {key[0]} Frame {key[1]} 已有其他更動，請刷新資料')

    now = datetime.utcnow()
    changes = []
    for (camera_index, frame), target in targets.items():
        correction = current.get((camera_index, frame))
        if not target['existed']:
            if correction is not None:
                db.delete(correction)
            raw = original.get((camera_index, frame))
            effective = {'visibility': raw.visibility, 'x': raw.x, 'y': raw.y} if raw else None
            # 前端目前只需知道整批已更新，僅回傳少量示例避免巨大的 HTTP 回應。
            if len(changes) < 100:
                changes.append({'camera_index': camera_index, 'frame': frame,
                                'correction': None, 'effective': effective})
        else:
            if correction is None:
                correction = BallPosition2DCorrection(match_id=match_id, camera_index=camera_index,
                                                      frame=frame, created_at=now)
                db.add(correction)
            correction.visibility = int(target['visibility'])
            correction.x = float(target['x'])
            correction.y = float(target['y'])
            correction.updated_at = now
            if len(changes) < 100:
                value = {'visibility': correction.visibility, 'x': correction.x, 'y': correction.y}
                changes.append({'camera_index': camera_index, 'frame': frame,
                                'correction': value, 'effective': value})
    for history in selected['rows']:
        history.reverted_at = now if direction == 'undo' else None
    db.commit()
    return {'ok': True, 'direction': direction, 'label': selected['label'],
            'updated_points': len(targets), 'changes': changes}


@router.post('/matches/{match_id}/traj2d/edit-history/undo')
def undo_2d_edit(match_id: int, db: Session = Depends(get_db)):
    try:
        return _apply(db, match_id, 'undo')
    except Exception:
        db.rollback()
        raise


@router.post('/matches/{match_id}/traj2d/edit-history/redo')
def redo_2d_edit(match_id: int, db: Session = Depends(get_db)):
    try:
        return _apply(db, match_id, 'redo')
    except Exception:
        db.rollback()
        raise
