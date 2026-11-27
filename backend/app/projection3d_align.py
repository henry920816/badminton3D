"""Align one 3D trajectory point with a real 2D observation at fixed camera depth."""
import math
from datetime import datetime

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .ball2d_corrections import load_ball_2d_rows
from .db import get_db
from .models import BallTraj, Match, TrajectoryRepairHistory
from .repair_geometry import cameras_by_index_for_match
from .quality_review import image_size
from .trajectory3d_core import reconstruct_frame
from .triangulation import _projection_from_camera, _undistort_normalized, project_raw_point

router = APIRouter()
MAX_SHIFT_M = 3.0


class AlignPayload(BaseModel):
    frame: int = Field(ge=0)
    camera_index: int = Field(ge=0)
    source_2d: str = 'corrected'
    confirm: bool = False
    direct: bool = False
    expected_point: dict[str, float] | None = None
    expected_observation: dict[str, float] | None = None


def align_at_depth(original, camera, observation):
    proj = _projection_from_camera(camera)
    ext = proj['raw_extrinsic']
    world = np.array([original['x'], original['y'], original['z'], 1.0], dtype=float)
    old_cam = ext @ world
    depth = float(old_cam[2])
    if not math.isfinite(depth) or depth <= 1e-6:
        raise ValueError('原 3D 點不在相機前方，無法沿用原深度')
    k = proj['intrinsic']
    x = (float(observation['x']) - float(k[2]) - proj['u_offset']) / float(k[0])
    y = (float(observation['y']) - float(k[3]) - proj['v_offset']) / float(k[1])
    x, y = _undistort_normalized(x, y, k, proj['use_distortion'])
    candidate = np.linalg.solve(ext[:, :3], np.array([x * depth, y * depth, depth]) - ext[:, 3])
    if not np.isfinite(candidate).all():
        raise ValueError('新 3D 座標無效')
    point = dict(zip(('x', 'y', 'z'), (float(v) for v in candidate)))
    projected = project_raw_point(point, camera)
    if projected is None or math.hypot(projected['x'] - observation['x'], projected['y'] - observation['y']) > 2.0:
        raise ValueError('重新投影仍無法對齊 2D 標註')
    return point, math.dist(tuple(original[k] for k in ('x','y','z')), tuple(point[k] for k in ('x','y','z')))


def _matches(actual, expected):
    return all(k in expected and abs(float(actual[k])-float(expected[k])) < 1e-6 for k in ('x','y','z'))


@router.post('/matches/{match_id}/traj3d/align-2d')
def align_projection_to_2d(match_id: int, payload: AlignPayload, db: Session = Depends(get_db)):
    if payload.source_2d not in ('original', 'corrected'):
        raise HTTPException(400, '2D 資料來源不正確')
    try:
        query = db.query(Match).filter(Match.id == match_id)
        match = query.with_for_update().first() if payload.confirm else query.first()
        if match is None:
            raise HTTPException(404, '找不到資料集')
        if payload.frame > match.duration_frame:
            raise HTTPException(400, '影格超過資料集範圍')
        camera = cameras_by_index_for_match(match).get(payload.camera_index)
        if camera is None or image_size(camera) is None:
            raise HTTPException(400, '找不到有效的相機標定或影像尺寸')
        row_query = db.query(BallTraj).filter_by(match_id=match_id, frame=payload.frame)
        row = row_query.with_for_update().first() if payload.confirm else row_query.first()
        if row is None:
            raise HTTPException(400, '此影格沒有原 3D 點，無法保留深度')
        original = {'x':row.x, 'y':row.y, 'z':row.z}
        if payload.confirm and not payload.direct and (payload.expected_point is None or not _matches(original, payload.expected_point)):
            raise HTTPException(409, '3D 軌跡已更新，請重新預覽後再確認')
        observations = load_ball_2d_rows(db, match_id, payload.frame, payload.frame,
                                          camera_index=payload.camera_index, source=payload.source_2d,
                                          visible_only=True)
        if len(observations) != 1:
            raise HTTPException(400, '此相機影格缺少唯一有效的 2D 標註')
        obs = observations[0]
        if payload.confirm and not payload.direct and (payload.expected_observation is None or
                                not all(k in payload.expected_observation and
                                abs(float(obs[k]) - float(payload.expected_observation[k])) < 1e-6 for k in ('x', 'y'))):
            raise HTTPException(409, '2D 標註已更新，請重新預覽')
        width, height = image_size(camera)
        if not (0 <= obs['x'] < width and 0 <= obs['y'] < height):
            raise HTTPException(400, '2D 標註不在相機影像內')
        candidate, shift = align_at_depth(original, camera, obs)
        if shift > MAX_SHIFT_M:
            raise HTTPException(422, f'3D 位移 {shift:.2f} m 超過 {MAX_SHIFT_M} m 安全門檻，請改用多視角 3D 修正')
        result = {'frame':payload.frame, 'camera_index':payload.camera_index,
                  'original':original, 'point':candidate, 'source_2d':payload.source_2d, 'observed_2d':{'x':obs['x'], 'y':obs['y']},
                  'shift_m':round(shift, 5), 'method':'same_camera_depth', 'confirmed':False}
        if not payload.confirm:
            return result
        history = TrajectoryRepairHistory(match_id=match_id, frame=payload.frame,
            source='projection3d_align', original_point=original, repaired_point=candidate,
            original_2d=[], repaired_2d=[],
            reprojection={'method':'same_camera_depth','camera_index':payload.camera_index,
                          'source_2d':payload.source_2d,'observed_2d':result['observed_2d'],
                          'shift_m':shift})
        db.add(history)
        db.flush()
        row.x, row.y, row.z = candidate['x'], candidate['y'], candidate['z']
        db.commit()
        return {**result, 'confirmed':True, 'version_id':history.id}
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, np.linalg.LinAlgError) as exc:
        db.rollback()
        raise HTTPException(422, str(exc))
    except Exception:
        db.rollback()
        raise


class FillPayload(BaseModel):
    frame: int = Field(ge=0)
    source_2d: str = 'corrected'
    allow_short_interpolation: bool = True


def _short_gap_candidate(db, match_id, frame, fps):
    # Only bridge a very short, observed-on-both-sides gap.
    left = db.query(BallTraj).filter(BallTraj.match_id == match_id, BallTraj.frame < frame).order_by(BallTraj.frame.desc()).first()
    right = db.query(BallTraj).filter(BallTraj.match_id == match_id, BallTraj.frame > frame).order_by(BallTraj.frame.asc()).first()
    if left is None or right is None or right.frame - left.frame > 4:
        return None
    ratio = (frame-left.frame)/(right.frame-left.frame)
    point = {k: float(getattr(left,k))*(1-ratio)+float(getattr(right,k))*ratio for k in ('x','y','z')}
    speed = math.dist((left.x,left.y,left.z),(right.x,right.y,right.z))*fps/(right.frame-left.frame)
    if not all(math.isfinite(v) for v in point.values()) or speed > 170:
        return None
    return point


@router.post('/matches/{match_id}/traj3d/fill-missing')
def fill_missing_3d(match_id: int, payload: FillPayload, db: Session = Depends(get_db)):
    if payload.source_2d not in ('original', 'corrected'):
        raise HTTPException(400, '2D 資料來源不正確')
    try:
        match = db.query(Match).filter_by(id=match_id).with_for_update().first()
        if match is None:
            raise HTTPException(404, '找不到資料集')
        if payload.frame > match.duration_frame:
            raise HTTPException(400, '影格超出資料集')
        if db.query(BallTraj).filter_by(match_id=match_id, frame=payload.frame).first():
            raise HTTPException(409, '這個 Frame 已有 3D 座標，不能覆蓋')
        cameras = cameras_by_index_for_match(match)
        observations = load_ball_2d_rows(db, match_id, payload.frame, payload.frame,
                                         source=payload.source_2d, visible_only=True)
        observations = [obs for obs in observations if obs['camera_index'] in cameras
                        and image_size(cameras[obs['camera_index']]) is not None
                        and 0 <= obs['x'] < image_size(cameras[obs['camera_index']])[0]
                        and 0 <= obs['y'] < image_size(cameras[obs['camera_index']])[1]]
        candidate = None
        method = None
        details = {}
        if len(observations) >= 2:
            reconstruction = reconstruct_frame(cameras, observations)
            # Explicitly reject weak multi-view consensus rather than inserting an untrustworthy point.
            if reconstruction.get('status') in ('auto', 'review'):
                if (reconstruction.get('inlier_views', 0) >= 2
                    and reconstruction.get('rms_px', float('inf')) <= 6.0
                    and reconstruction.get('max_px', float('inf')) <= 12.0
                    and reconstruction.get('angle_degrees', 0) >= 3.0):
                    candidate = reconstruction['point']
                    method = 'multi_view'
                    details = {k: reconstruction.get(k) for k in ('inlier_views','rms_px','max_px','angle_degrees','status')}
            if candidate is None:
                raise HTTPException(422, '多視角資料不一致，為避免錯誤補點，請先修正 2D 標註')
        if candidate is None and payload.allow_short_interpolation:
            # Do not interpolate across a known hit frame.
            left = db.query(BallTraj).filter(BallTraj.match_id == match_id, BallTraj.frame < payload.frame).order_by(BallTraj.frame.desc()).first()
            right = db.query(BallTraj).filter(BallTraj.match_id == match_id, BallTraj.frame > payload.frame).order_by(BallTraj.frame.asc()).first()
            if left is not None and right is not None:
                from .models import Hit
                if db.query(Hit).filter(Hit.match_id == match_id, Hit.hit_frame >= left.frame, Hit.hit_frame <= right.frame).first() is None:
                    candidate = _short_gap_candidate(db, match_id, payload.frame, match.fps or 50)
                    if candidate is not None:
                        method = 'short_interpolation'
                        if len(observations) == 1:
                            camera = cameras[observations[0]['camera_index']]
                            try:
                                aligned, shift = align_at_depth(candidate, camera, observations[0])
                                if shift <= 0.75:
                                    candidate = aligned
                                    method = 'single_view_depth'
                                    details = {'shift_from_interpolation_m': round(shift, 5)}
                                else:
                                    candidate = None
                            except (ValueError, np.linalg.LinAlgError):
                                candidate = None
        if candidate is None:
            raise HTTPException(422, '觀測不足且沒有安全的短區段補點條件，請人工檢查')
        history = TrajectoryRepairHistory(match_id=match_id,frame=payload.frame,
            source='projection3d_align',original_point=None,repaired_point=candidate,
            original_2d=[],repaired_2d=[],
            reprojection={'method':method,'created_missing_point':True,'details':details})
        db.add(BallTraj(match_id=match_id,frame=payload.frame,t_sec=payload.frame/(match.fps or 50),
                        x=candidate['x'],y=candidate['y'],z=candidate['z'],confidence=0.5))
        db.add(history)
        db.flush()
        db.commit()
        return {'frame':payload.frame,'point':candidate,'method':method,'version_id':history.id,
                'confirmed':True,'created':True}
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, TypeError, np.linalg.LinAlgError) as exc:
        db.rollback()
        raise HTTPException(422, str(exc))
    except Exception:
        db.rollback()
        raise


@router.post('/matches/{match_id}/traj3d/align-2d/{version_id}/undo')
def undo_projection_alignment(match_id: int, version_id: int, db: Session = Depends(get_db)):
    try:
        match = db.query(Match).filter_by(id=match_id).with_for_update().first()
        if match is None:
            raise HTTPException(404, '找不到資料集')
        history = db.get(TrajectoryRepairHistory, version_id)
        if history is None or history.match_id != match_id or history.source != 'projection3d_align':
            raise HTTPException(404, '找不到可復原的 3D 對齊紀錄')
        if history.reverted_at is not None:
            raise HTTPException(409, '這次修改已復原')
        row = db.query(BallTraj).filter_by(match_id=match_id, frame=history.frame).with_for_update().first()
        if row is None or not _matches({'x':row.x,'y':row.y,'z':row.z}, history.repaired_point):
            raise HTTPException(409, '3D 點已被再次修改，為避免覆蓋新資料，無法復原')
        previous = history.original_point
        if not previous and (history.reprojection or {}).get('created_missing_point'):
            db.delete(row)
            history.reverted_at = datetime.utcnow()
            db.commit()
            return {'frame':history.frame,'point':None,'deleted':True,'undone':True}
        if not previous:
            raise HTTPException(409, '缺少原始 3D 座標，無法復原')
        row.x, row.y, row.z = previous['x'], previous['y'], previous['z']
        history.reverted_at = datetime.utcnow()
        db.commit()
        return {'frame':history.frame, 'point':previous, 'undone':True}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.post('/matches/{match_id}/traj3d/align-2d/{version_id}/redo')
def redo_projection_alignment(match_id: int, version_id: int, db: Session = Depends(get_db)):
    try:
        match = db.query(Match).filter_by(id=match_id).with_for_update().first()
        if match is None:
            raise HTTPException(404, '找不到資料集')
        history = db.get(TrajectoryRepairHistory, version_id)
        if history is None or history.match_id != match_id or history.source != 'projection3d_align':
            raise HTTPException(404, '找不到可重做的 3D 修改紀錄')
        if history.reverted_at is None:
            raise HTTPException(409, '這次修改尚未撤銷，不能重做')
        row = db.query(BallTraj).filter_by(match_id=match_id, frame=history.frame).with_for_update().first()
        created = (history.reprojection or {}).get('created_missing_point')
        if created:
            if row is not None:
                raise HTTPException(409, '此 Frame 已有 3D 座標，無法重做補點')
            point = history.repaired_point
            db.add(BallTraj(match_id=match_id,frame=history.frame,
                t_sec=history.frame/(match.fps or 50), x=point['x'], y=point['y'],
                z=point['z'],confidence=0.5))
            history.reverted_at = None
            db.commit()
            return {'frame':history.frame,'point':point,'created':True,'redone':True}
        if row is None or not history.original_point or not history.repaired_point or not _matches(
                {'x': row.x, 'y': row.y, 'z': row.z}, history.original_point):
            raise HTTPException(409, '3D 點已再次變動，為避免覆蓋新資料，無法重做')
        point = history.repaired_point
        row.x, row.y, row.z = point['x'], point['y'], point['z']
        history.reverted_at = None
        db.commit()
        return {'frame': history.frame, 'point': point, 'redone': True}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
