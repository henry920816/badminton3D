"""紅色自動修正與藍色人工移除的儲存 API，資料都寫入 2D 修正層。"""

from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .ball2d_corrections import load_ball_2d_rows
from .edit_history import make_batch, add_history, snapshot
from .db import get_db
from .models import (
    BallPosition2DCorrection, BallTraj, Hit, Match, TrajectoryRepairHistory,
)
from .quality_review import attach_review_quality, view_projection, blue_review_issue
from .repair_geometry import cameras_by_index_for_match

router = APIRouter()
MAX_FRAMES = 6000


class ReviewRepairPayload(BaseModel):
    start_frame: int
    end_frame: int
    mode: str = 'preview'
    action_filter: str = 'all'
    source: str = 'corrected'
    camera_indexes: list[int] | None = None


def _get_inputs(db, match, start, end):
    cameras = cameras_by_index_for_match(match)
    observations = defaultdict(list)
    for item in load_ball_2d_rows(db, match.id, start, end,
                                  source='corrected', visible_only=True):
        if int(item['camera_index']) in cameras:
            observations[int(item['frame'])].append(item)
    points3d = {
        int(item.frame): {'x': item.x, 'y': item.y, 'z': item.z}
        for item in db.query(BallTraj).filter(
            BallTraj.match_id == match.id,
            BallTraj.frame >= start,
            BallTraj.frame <= end,
        )
    }
    hit_frames = {
        int(item.new_hit_frame if item.new_hit_frame is not None else item.hit_frame)
        for item in db.query(Hit).filter(Hit.match_id == match.id)
    }
    grid = [
        {'frame': frame, 'cameras': [
            {'camera_index': index, 'status': 'unknown' if any(
                int(o['camera_index']) == index for o in observations.get(frame, [])
            ) else 'no_data'}
            for index in cameras
        ]}
        for frame in range(start, end + 1)
    ]
    return attach_review_quality(grid, cameras, observations, points3d, hit_frames)


@router.post('/matches/{match_id}/traj2d/review-repair')
def review_repair_traj_2d(match_id: int, payload: ReviewRepairPayload,
                          db: Session = Depends(get_db)):
    """preview 不動 DB；apply 只改尚未存在人工／系統修正的 2D 格子。"""
    start, end = int(payload.start_frame), int(payload.end_frame)
    if start < 0 or end < start or end - start + 1 > MAX_FRAMES:
        raise HTTPException(400, detail='影格範圍無效或超過 6000 幀')
    if payload.mode not in ('preview', 'apply'):
        raise HTTPException(400, detail='mode 只能是 preview 或 apply')
    if payload.action_filter not in ('all', 'outside', 'position'):
        raise HTTPException(400, detail='action_filter 只能是 all / outside / position')
    if payload.camera_indexes is not None and (
        not payload.camera_indexes or any(index < 0 for index in payload.camera_indexes)
    ):
        raise HTTPException(400, detail='camera_indexes 必須是有效的相機編號')
    if payload.source != 'corrected':
        raise HTTPException(400, detail='只能寫入 corrected 修正層')

    try:
        match_query = db.query(Match).filter(Match.id == match_id)
        match = (match_query.with_for_update().first()
                 if payload.mode == 'apply' else match_query.first())
        if match is None:
            raise HTTPException(404, detail='找不到資料集')
        grid = _get_inputs(db, match, start, end)
        existing = {
            (int(item.frame), int(item.camera_index))
            for item in db.query(BallPosition2DCorrection).filter(
                BallPosition2DCorrection.match_id == match_id,
                BallPosition2DCorrection.frame >= start,
                BallPosition2DCorrection.frame <= end,
            )
        }
        actions = []
        selected_cameras = set(payload.camera_indexes) if payload.camera_indexes is not None else None
        for row in grid:
            frame = int(row['frame'])
            for item in row['cameras']:
                index = int(item['camera_index'])
                if (selected_cameras is not None and index not in selected_cameras) or (frame, index) in existing or not item.get('review_auto_allowed'):
                    continue
                action = item['review_action']
                if action == 'hide_2d' and payload.action_filter in ('all', 'outside'):
                    actions.append({'frame': frame, 'camera_index': index,
                                    'visibility': 0, 'x': 0.0, 'y': 0.0,
                                    'action': action})
                elif action == 'move_to_3d' and payload.action_filter in ('all', 'position'):
                    xy = item.get('review_candidate_2d')
                    if xy is not None:
                        actions.append({'frame': frame, 'camera_index': index,
                                        'visibility': 1, 'x': float(xy['x']), 'y': float(xy['y']),
                                        'action': action})
        by_frame = defaultdict(list)
        for action in actions:
            by_frame[action['frame']].append(action)
        blue = sum(item['action'] == 'hide_2d' for item in actions)
        red = len(actions) - blue
        common = {
            'ok': True, 'mode': payload.mode, 'action_filter': payload.action_filter,
            'start_frame': start, 'end_frame': end,
            'detected_bad_frames': len(by_frame),
            'candidate_points': len(actions),
            'outside_points': blue, 'position_points': red,
            'preview': actions[:100],
        }
        if payload.mode == 'preview':
            return {**common, 'dry_run': True, 'repaired_frames': 0,
                    'repaired_2d_points': 0, 'skipped_frames': 0,
                    'repair_ids': [], 'frames': [], 'ball_2d_points': []}

        batch = make_batch(db, match_id) if actions else None
        history_ids = []
        result_frames = []
        repaired = []
        for frame, frame_actions in sorted(by_frame.items()):
            old = []
            new = []
            for action in frame_actions:
                index = int(action['camera_index'])
                # 所有已存在的修正（人工或先前批次）一律不碰。
                old.append(snapshot(None, index, frame))
                replacement = {'frame': frame, 'camera_index': index,
                               'visibility': action['visibility'],
                               'x': action['x'], 'y': action['y']}
                new.append({**replacement, 'existed': True})
                repaired.append(replacement)
                db.add(BallPosition2DCorrection(
                    match_id=match_id, camera_index=index, frame=frame,
                    visibility=action['visibility'], x=action['x'], y=action['y'],
                    created_at=datetime.utcnow(), updated_at=datetime.utcnow(),
                ))
            history = add_history(db, match_id, frame, old, new, batch,
                                  '紅色 3D 投影位置修正', source='auto_2d_overlay')
            db.flush()
            history_ids.append(int(history.id))
            result_frames.append({'frame': frame, 'status': 'repaired',
                                  'repair_id': int(history.id),
                                  'repaired_camera_indices': [a['camera_index'] for a in frame_actions]})
        db.commit()
        return {**common, 'dry_run': False, 'repair_ids': history_ids,
                'repaired_frames': len(result_frames),
                'repaired_2d_points': len(repaired), 'skipped_frames': 0,
                'ball_2d_points': repaired, 'frames': result_frames}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


class ManualBlueHidePayload(BaseModel):
    camera_index: int = Field(ge=0)
    frames: list[int] = Field(min_length=1, max_length=MAX_FRAMES)


@router.post('/matches/{match_id}/traj2d/review-hide')
def hide_blue_2d_labels(match_id: int, payload: ManualBlueHidePayload,
                        db: Session = Depends(get_db)):
    """人工點藍格／長按藍色連續段，只在修正層標記不可見。整批要嘛全成功，要嘛全取消。"""
    frames = sorted(set(payload.frames))
    if any(frame < 0 for frame in frames):
        raise HTTPException(400, detail='frame 不可小於零')
    if len(frames) > 1 and (frames[-1] - frames[0] + 1 != len(frames)):
        raise HTTPException(400, detail='只能移除同一視角連續影格的藍色')

    try:
        match = db.query(Match).filter(Match.id == match_id).with_for_update().first()
        if match is None:
            raise HTTPException(404, detail='找不到資料集')
        if frames[-1] > match.duration_frame:
            raise HTTPException(400, detail='frame 超出資料集範圍')
        cameras = cameras_by_index_for_match(match)
        camera = cameras.get(payload.camera_index)
        if camera is None:
            raise HTTPException(404, detail='找不到攝影機')

        # 只查指定相機的有效 2D，避免每點重跑整個 Rally 的品質格。
        visible = {
            int(row['frame']): row
            for row in load_ball_2d_rows(db, match_id, frames[0], frames[-1],
                                         camera_index=payload.camera_index,
                                         source='corrected', visible_only=True)
        }
        points3d = {
            int(row.frame): {'x': row.x, 'y': row.y, 'z': row.z}
            for row in db.query(BallTraj).filter(
                BallTraj.match_id == match_id,
                BallTraj.frame >= frames[0],
                BallTraj.frame <= frames[-1],
            )
        }
        for frame in frames:
            # 要由後端再次檢查，不能只相信前端傳來的藍格。
            projection = view_projection(points3d.get(frame), camera)
            if blue_review_issue(projection, visible.get(frame)) is None:
                raise HTTPException(409, detail=f'Frame {frame} 已不是藍色，請重新載入品質檢查')

        previous = {
            int(row.frame): row
            for row in db.query(BallPosition2DCorrection).filter(
                BallPosition2DCorrection.match_id == match_id,
                BallPosition2DCorrection.camera_index == payload.camera_index,
                BallPosition2DCorrection.frame >= frames[0],
                BallPosition2DCorrection.frame <= frames[-1],
            ).with_for_update()
        }
        now = datetime.utcnow()
        batch = make_batch(db, match_id)
        histories = []
        hidden_points = []
        for frame in frames:
            correction = previous.get(frame)
            old = snapshot(correction, payload.camera_index, frame)
            if correction is None:
                correction = BallPosition2DCorrection(
                    match_id=match_id, camera_index=payload.camera_index,
                    frame=frame, created_at=now,
                )
                db.add(correction)
            correction.visibility = 0
            correction.x = 0.0
            correction.y = 0.0
            correction.updated_at = now
            new = {'camera_index': payload.camera_index, 'frame': frame,
                   'existed': True, 'visibility': 0, 'x': 0.0, 'y': 0.0}
            history = add_history(db, match_id, frame, [old], [new], batch,
                                  '藍色異常標註人工移除', source='auto_2d_overlay')
            histories.append(history)
            hidden_points.append(new)
        db.flush()
        repair_ids = [int(history.id) for history in histories]
        db.commit()
        return {
            'ok': True, 'camera_index': payload.camera_index,
            'start_frame': frames[0], 'end_frame': frames[-1],
            'hidden_points': len(hidden_points), 'repair_ids': repair_ids,
            'ball_2d_points': hidden_points,
        }
    except Exception:
        db.rollback()
        raise


class AllBlueHidePayload(BaseModel):
    start_frame: int = Field(ge=0)
    end_frame: int = Field(ge=0)


@router.post('/matches/{match_id}/traj2d/review-hide-all')
def hide_all_blue_2d_labels(match_id: int, payload: AllBlueHidePayload,
                            db: Session = Depends(get_db)):
    """一鍵清除目前 Rally 全部藍格。一次交易、同一批操作歷史，原始標註不動。"""
    start, end = payload.start_frame, payload.end_frame
    if end < start or end - start + 1 > MAX_FRAMES:
        raise HTTPException(400, detail='影格範圍無效或超過 6000 幀')

    try:
        match = db.query(Match).filter(Match.id == match_id).with_for_update().first()
        if match is None:
            raise HTTPException(404, detail='找不到資料集')
        if end > match.duration_frame:
            raise HTTPException(400, detail='frame 超出資料集範圍')
        cameras = cameras_by_index_for_match(match)
        visible = load_ball_2d_rows(db, match_id, start, end,
                                    source='corrected', visible_only=True)
        points3d = {
            int(row.frame): {'x': row.x, 'y': row.y, 'z': row.z}
            for row in db.query(BallTraj).filter(
                BallTraj.match_id == match_id,
                BallTraj.frame >= start,
                BallTraj.frame <= end,
            )
        }

        # 藍格的唯一判斷來源是 blue_review_issue：和品質格保持一致。
        selected = []
        for row in visible:
            index = int(row['camera_index'])
            camera = cameras.get(index)
            if camera is None:
                continue
            frame = int(row['frame'])
            if blue_review_issue(view_projection(points3d.get(frame), camera), row):
                selected.append((frame, index))
        if not selected:
            return {'ok': True, 'hidden_points': 0, 'affected_frames': 0,
                    'repair_ids': [], 'ball_2d_points': []}

        previous = {
            (int(row.frame), int(row.camera_index)): row
            for row in db.query(BallPosition2DCorrection).filter(
                BallPosition2DCorrection.match_id == match_id,
                BallPosition2DCorrection.frame >= start,
                BallPosition2DCorrection.frame <= end,
            ).with_for_update()
        }
        batch = make_batch(db, match_id)
        now = datetime.utcnow()
        by_frame = defaultdict(list)
        for frame, index in selected:
            old_record = previous.get((frame, index))
            old = snapshot(old_record, index, frame)
            if old_record is None:
                old_record = BallPosition2DCorrection(
                    match_id=match_id, camera_index=index, frame=frame, created_at=now,
                )
                db.add(old_record)
            old_record.visibility = 0
            old_record.x = 0.0
            old_record.y = 0.0
            old_record.updated_at = now
            new = {'camera_index': index, 'frame': frame, 'existed': True,
                   'visibility': 0, 'x': 0.0, 'y': 0.0}
            by_frame[frame].append((old, new))

        history_rows = []
        for frame, entries in sorted(by_frame.items()):
            old = [item[0] for item in entries]
            new = [item[1] for item in entries]
            history_rows.append(add_history(
                db, match_id, frame, old, new, batch,
                '一鍵消除藍色 2D 標註', source='manual_2d_overlay',
            ))
        db.flush()
        repair_ids = [int(row.id) for row in history_rows]
        db.commit()
        return {'ok': True, 'hidden_points': len(selected),
                'affected_frames': len(by_frame), 'repair_ids': repair_ids,
                'ball_2d_points': [new for entries in by_frame.values()
                                   for _, new in entries]}
    except Exception:
        db.rollback()
        raise
