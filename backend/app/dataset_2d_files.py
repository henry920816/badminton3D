"""既有資料集的部分 2D CSV 重傳。

同一次可上傳多個 Rally／相機檔案，只替換對應的原始 2D 資料。
所有檔案先通過檢查才動資料庫；既有修正層另行保留。
"""

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import insert
from sqlalchemy.orm import Session

from .dataset_upload import BALL_2D_FILENAME_PATTERN, read_ball_2d_record
from .db import get_db
from .dataset_originals import StagedSourceReplacement, rows_fingerprint, _source_key, safe_path
from .models import (BallPosition2D, BallPosition2DCorrection,
                     TrajectoryRepairHistory, Match, Rally)
from .repair_geometry import cameras_by_index_for_match

router = APIRouter()
MAX_FILES = 300
MAX_FILE_BYTES = 24 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024


async def parse_files(files, rallies, cameras, relative_paths=None):
    """檔名決定 Rally/視角；檢查全部通過後才回傳待匯入列。"""
    lookup = {(int(r.rally_index), int(r.start_frame), int(r.end_frame)): r for r in rallies}
    seen = set()
    parsed = []
    total_bytes = 0
    relative_paths = list(relative_paths or [])
    if relative_paths and len(relative_paths) != len(files):
        raise HTTPException(400, detail='檔案與路徑數量不同')
    with tempfile.TemporaryDirectory(prefix='badminton-2d-reupload-') as folder:
        base = Path(folder)
        for index, upload in enumerate(files):
            name = Path(upload.filename or '').name
            parts = BALL_2D_FILENAME_PATTERN.fullmatch(name)
            if parts is None:
                raise HTTPException(400, detail=f'{name}：檔名須為 matchN_R_START_END_viewC_ball.csv')
            meta = {key: int(value) for key, value in parts.groupdict().items()}
            key = (meta['rally'], meta['start'], meta['end'])
            if key not in lookup:
                raise HTTPException(400, detail=f'{name}：找不到相同編號與影格範圍的 Rally')
            if meta['camera'] not in cameras:
                raise HTTPException(400, detail=f'{name}：Cam {meta["camera"]} 不在這份資料集')
            unique = (lookup[key].id, meta['camera'])
            if unique in seen:
                raise HTTPException(400, detail=f'{name}：同一批檔案不能重複指定相同 Rally/相機')
            seen.add(unique)

            path = base / f'{index}.csv'
            size = 0
            try:
                with path.open('wb') as output:
                    while chunk := await upload.read(1024 * 1024):
                        size += len(chunk)
                        total_bytes += len(chunk)
                        if size > MAX_FILE_BYTES or total_bytes > MAX_TOTAL_BYTES:
                            raise HTTPException(413, detail='單檔最多 24 MB，單次上傳最多 256 MB')
                        output.write(chunk)
                if size == 0:
                    raise HTTPException(400, detail=f'{name} 是空檔案')
            finally:
                await upload.close()

            record = {
                'original_name': name,
                'relative_path': f'rally{meta["rally"]}/view{meta["camera"]}/v3/{name}',
                'stored_path': path.name,
            }
            metadata, data, errors = read_ball_2d_record(base, record)
            if errors or data is None:
                raise HTTPException(400, detail='；'.join(errors) or f'{name} 解析失敗')
            rows = [{
                'camera_index': meta['camera'],
                'frame': meta['start'] + int(row.frame),
                'visibility': int(row.visibility),
                'x': float(row.x), 'y': float(row.y),
            } for row in data.itertuples(index=False)]
            rel = (relative_paths[index] if relative_paths else
                   f'rally{meta["rally"]}/view{meta["camera"]}/v3/{name}')
            rel = safe_path(rel)
            if Path(rel).name != name:
                raise HTTPException(400, detail=f'{name}：相對路徑與檔名不符')
            parsed.append((meta, rows, name, rel, path.read_bytes()))
    return parsed


@router.post('/matches/{match_id}/traj2d/replace-files')
async def replace_dataset_2d_files(
    match_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    relative_paths: list[str] | None = Form(default=None),
):
    """只覆蓋指定的 Rally×Cam 原始標註，其餘 Rally/視角及人工修正不變。"""
    if not files or len(files) > MAX_FILES:
        raise HTTPException(400, detail=f'一次請選擇 1～{MAX_FILES} 個 2D CSV')

    match = db.query(Match).filter(Match.id == match_id).with_for_update().first()
    if match is None:
        raise HTTPException(404, detail='找不到資料集')
    rallies = db.query(Rally).filter(Rally.match_id == match_id).all()
    cameras = cameras_by_index_for_match(match)
    provided_paths = relative_paths if isinstance(relative_paths, (list, tuple)) else None
    parsed = await parse_files(files, rallies, cameras, provided_paths)

    staged = None
    try:
        total_rows = 0
        invalidated = []
        changed_keys = set()
        new_files = {}
        # 同一交易完成全部檔案替換，遇到錯誤時全數復原。
        for metadata, rows, name, _, _ in parsed:
            new_points = {row['frame']: row for row in rows}
            old_points = {int(row.frame): row for row in db.query(BallPosition2D).filter(
                BallPosition2D.match_id == match_id,
                BallPosition2D.camera_index == metadata['camera'],
                BallPosition2D.frame >= metadata['start'],
                BallPosition2D.frame < metadata['end'],
            ).all()}
            # A correction belongs to an old source point. Keep it only when
            # that source point is unchanged, otherwise quarantine its values
            # in an immutable non-undoable audit record before removing it.
            for correction in db.query(BallPosition2DCorrection).filter(
                BallPosition2DCorrection.match_id == match_id,
                BallPosition2DCorrection.camera_index == metadata['camera'],
                BallPosition2DCorrection.frame >= metadata['start'],
                BallPosition2DCorrection.frame < metadata['end'],
            ).all():
                before, after = old_points.get(correction.frame), new_points.get(correction.frame)
                same = (before is not None and after is not None and
                        int(before.visibility) == int(after['visibility']) and
                        float(before.x) == float(after['x']) and
                        float(before.y) == float(after['y']))
                if same:
                    continue
                changed_keys.add((int(correction.camera_index), int(correction.frame)))
                invalidated.append({
                    'camera_index': int(correction.camera_index),
                    'frame': int(correction.frame),
                    'visibility': int(correction.visibility),
                    'x': float(correction.x), 'y': float(correction.y),
                    'previous_original': None if before is None else {
                        'visibility': int(before.visibility),
                        'x': float(before.x), 'y': float(before.y),
                    },
                })
                db.delete(correction)
            old_rows = db.query(BallPosition2D.id).filter(
                BallPosition2D.match_id == match_id,
                BallPosition2D.camera_index == metadata['camera'],
                BallPosition2D.frame >= metadata['start'],
                BallPosition2D.frame < metadata['end'],
            ).first()
            if old_rows is None:
                index = metadata['camera']
                new_files[index] = new_files.get(index, 0) + 1
            db.query(BallPosition2D).filter(
                BallPosition2D.match_id == match_id,
                BallPosition2D.camera_index == metadata['camera'],
                BallPosition2D.frame >= metadata['start'],
                BallPosition2D.frame < metadata['end'],
            ).delete(synchronize_session=False)
            for start in range(0, len(rows), 3000):
                values = [{**row, 'match_id': match_id} for row in rows[start:start + 3000]]
                db.execute(insert(BallPosition2D), values)
            total_rows += len(rows)
        # 新補進來的視角也要讓影片面板知道，否則畫面仍把它當成沒有 2D。
        camera_list = [dict(item) if isinstance(item, dict) else item
                       for item in (match.cameras or [])]
        for item in camera_list:
            if not isinstance(item, dict):
                continue
            index = item.get('index')
            try:
                index = int(index)
            except (ValueError, TypeError):
                continue
            if any(metadata['camera'] == index for metadata, _, _, _, _ in parsed):
                item['has_ball_2d'] = True
                item['ball_2d_file_count'] = int(item.get('ball_2d_file_count') or 0) + new_files.get(index, 0)
        match.cameras = camera_list
        if invalidated:
            # Audit remains in DB, while stale correction values stop overriding
            # new originals. Invalidate touching undo batches to prevent redo.
            from .edit_history import EDIT_SOURCES
            for history in db.query(TrajectoryRepairHistory).filter(
                TrajectoryRepairHistory.match_id == match_id,
                TrajectoryRepairHistory.source.in_(EDIT_SOURCES),
            ).all():
                points = (history.original_2d or []) + (history.repaired_2d or [])
                if any((int(pt.get('camera_index', -1)), int(pt.get('frame', -1))) in changed_keys
                       for pt in points):
                    meta = history.reprojection or {}
                    batch = meta.get('edit_batch')
                    if batch:
                        for related in db.query(TrajectoryRepairHistory).filter(
                            TrajectoryRepairHistory.match_id == match_id,
                            TrajectoryRepairHistory.source.in_(EDIT_SOURCES),
                        ).all():
                            if (related.reprojection or {}).get('edit_batch') == batch:
                                related.reprojection = {**(related.reprojection or {}),
                                                        'source_data_invalidated': True}
            db.add(TrajectoryRepairHistory(
                match_id=match_id, frame=invalidated[0]['frame'],
                source='source_2d_reupload', original_point=None, repaired_point={},
                original_2d=invalidated, repaired_2d=[],
                reprojection={'event': 'invalidated_stale_corrections',
                              'count': len(invalidated)},
            ))
        # The source manifest becomes visible before commit, but both the index
        # and new blobs can be restored if the database transaction fails.
        staged = StagedSourceReplacement(match_id, [
            ('ball-2d', rel, content) for _, _, _, rel, content in parsed
        ])
        db.flush()
        # Attach a DB checksum to each source index entry. Export can detect
        # out-of-band DB edits or a mismatched manifest before returning a ZIP.
        for _, rows, _, rel, _ in parsed:
            key = _source_key('ball-2d', rel)
            staged.updated[key]['db_rows_sha256'] = rows_fingerprint(rows)
        staged.publish()
        db.commit()
        staged.finish()
        return {
            'ok': True, 'replaced_files': len(parsed), 'imported_rows': total_rows,
            'camera_indices': sorted({meta['camera'] for meta, _, _, _, _ in parsed}),
            'files': [name for _, _, name, _, _ in parsed],
            'corrections_preserved': not bool(invalidated),
            'invalidated_corrections': len(invalidated),
            'source_backup_saved': True, 'source_warning': None,
        }
    except Exception:
        db.rollback()
        if staged is not None:
            staged.rollback()
        raise
