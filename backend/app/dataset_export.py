"""匯出與匯入相同的來源檔案格式；2D 只覆寫實際修正過的格子。"""

from __future__ import annotations

import csv
import io
import tempfile
import zipfile
from collections import defaultdict
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.background import BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .dataset_originals import checked_original_file, source_records, rows_fingerprint
from .dataset_upload import BALL_2D_FILENAME_PATTERN, CATEGORY_NAMES
from .db import get_db
from .models import BallPosition2DCorrection, BallPosition2D, Match, Rally

router = APIRouter()


def _coordinate(number):
    return format(float(number), '.15g')


def _csv_with_2d_corrections(raw, relative_path, changes):
    """維持來源的欄位名稱與排列；沒有變更的 CSV 完全不重寫。"""
    parts = BALL_2D_FILENAME_PATTERN.fullmatch(Path(relative_path).name)
    if parts is None:
        raise HTTPException(409, detail=f'原始 2D 檔名無法辨認：{relative_path}')
    camera, start, end = (int(parts[k]) for k in ('camera', 'start', 'end'))
    patch = {frame: correction for (cam, frame), correction in changes.items()
             if cam == camera and start <= frame < end}
    if not patch:
        return raw

    encoding = 'utf-8-sig' if raw.startswith(b'\xef\xbb\xbf') else 'utf-8'
    try:
        text = raw.decode(encoding)
        newline = '\r\n' if '\r\n' in text else ('\r' if '\r' in text else '\n')
        reader = csv.DictReader(io.StringIO(text, newline=''))
        columns = reader.fieldnames or []
        required = {'Frame', 'Visibility', 'X', 'Y'}
        if not required.issubset(columns):
            raise ValueError('缺少 Frame、Visibility、X、Y')
        rows = list(reader)
    except (UnicodeDecodeError, csv.Error, ValueError) as exc:
        raise HTTPException(409, detail=f'{relative_path} 原始 CSV 解析失敗：{exc}') from exc

    seen = set()
    for row in rows:
        try:
            frame = start + int(float(row['Frame']))
        except (TypeError, ValueError) as exc:
            raise HTTPException(409, detail=f'{relative_path} 的 Frame 欄位格式不正確') from exc
        if frame not in patch:
            continue
        point = patch[frame]
        row['Visibility'] = str(int(point.visibility))
        row['X'] = _coordinate(point.x) if point.visibility else '0'
        row['Y'] = _coordinate(point.y) if point.visibility else '0'
        seen.add(frame)

    # 允許人工補上來源 CSV 中原本沒有的一幀；格式仍沿用原始欄位。
    for frame in sorted(patch.keys() - seen):
        point = patch[frame]
        row = dict.fromkeys(columns, '')
        row.update({
            'Frame': str(frame - start),
            'Visibility': str(int(point.visibility)),
            'X': _coordinate(point.x) if point.visibility else '0',
            'Y': _coordinate(point.y) if point.visibility else '0',
        })
        rows.append(row)

    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=columns, lineterminator=newline,
                            extrasaction='ignore')
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode(encoding)


def _all_2d_corrections(db, match_id):
    return {(int(item.camera_index), int(item.frame)): item for item in
            db.query(BallPosition2DCorrection).filter(
                BallPosition2DCorrection.match_id == match_id).all()}


def _require_originals(match_id, selected):
    records = source_records(match_id)
    if records is None:
        raise HTTPException(409, detail=(
            '這份資料集是在保留原始檔功能推出前匯入的，伺服器沒有原始 CSV/NPY/PTH。'
            '請到 Update Dataset 補傳需要匯出的原始檔，或重新匯入資料集；'
            '不能拿資料庫重新合成的內容冒充原始格式。'))
    grouped = defaultdict(list)
    for entry in records:
        grouped[entry['category']].append(entry)
    missing = [CATEGORY_NAMES[key] for key in selected if not grouped[key]]
    if missing:
        raise HTTPException(409, detail=(
            '找不到以下類別的上傳原檔：' + '、'.join(missing) +
            '。請在 Update Dataset 補傳原始檔；未曾上傳的類別請取消勾選。'))
    return grouped


@router.get('/matches/{match_id}/dataset-export/sources')
def export_sources_status(match_id: int, db: Session = Depends(get_db)):
    if db.get(Match, match_id) is None:
        raise HTTPException(404, detail='找不到資料集')
    records = source_records(match_id)
    counts = {key: 0 for key in CATEGORY_NAMES}
    for entry in records or []:
        if entry.get('category') in counts:
            counts[entry['category']] += 1
    return {'has_originals': records is not None, 'counts': counts}


@router.get('/matches/{match_id}/dataset-export')
def export_dataset_categories(
    match_id: int,
    background_tasks: BackgroundTasks,
    categories: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    selected = [item.strip() for item in categories.split(',')]
    if (not selected or any(key not in CATEGORY_NAMES for key in selected) or
            len(selected) != len(set(selected))):
        raise HTTPException(400, detail='匯出類別無效或重複')
    if db.get(Match, match_id) is None:
        raise HTTPException(404, detail='找不到資料集')

    grouped = _require_originals(match_id, selected)
    # 先確認整份匯出需要的檔案都存在，避免下載出只有一半內容的 ZIP。
    originals = []
    names = set()
    for category in selected:
        for item in grouped[category]:
            source = checked_original_file(match_id, item)
            rel = item['relative_path']
            expected = item.get('db_rows_sha256')
            if category == 'ball-2d' and expected:
                match = BALL_2D_FILENAME_PATTERN.fullmatch(Path(rel).name)
                if match is None:
                    raise HTTPException(409, detail=f'無法驗證來源版本：{rel}')
                camera, start, end = (int(match[k]) for k in ('camera', 'start', 'end'))
                rows = db.query(BallPosition2D).filter(
                    BallPosition2D.match_id == match_id,
                    BallPosition2D.camera_index == camera,
                    BallPosition2D.frame >= start,
                    BallPosition2D.frame < end,
                ).all()
                actual = rows_fingerprint([{
                    'frame': row.frame, 'visibility': row.visibility,
                    'x': row.x, 'y': row.y,
                } for row in rows])
                if actual != expected:
                    raise HTTPException(409, detail=(
                        f'{rel} 的資料庫原始標註與來源 CSV 版本不一致，已停止匯出，'
                        '請檢查 Update Dataset 的重傳紀錄。'))
            zip_name = f'{category}/{rel}'
            if zip_name.casefold() in names:
                raise HTTPException(409, detail=f'原始檔案重複：{zip_name}')
            names.add(zip_name.casefold())
            originals.append((category, rel, source, zip_name))

    changes = _all_2d_corrections(db, match_id) if 'ball-2d' in selected else {}
    covered = set()
    for category, rel, _, _ in originals:
        if category == 'ball-2d':
            match = BALL_2D_FILENAME_PATTERN.fullmatch(Path(rel).name)
            if match:
                cam, start, end = (int(match[key]) for key in ('camera', 'start', 'end'))
                covered.update((cam, frame) for c, frame in changes if c == cam and start <= frame < end)
    # 若人工在原本沒有 2D CSV 的相機補上球點，建立格式相同的新 CSV。
    # 已存在對應 CSV、卻有不屬於其影格範圍的修正，仍報錯避免重複配對。
    added = defaultdict(list)
    missing_corrections = set(changes) - covered
    if missing_corrections:
        rallies = db.query(Rally).filter(Rally.match_id == match_id).all()
        raw_match_number = None
        source_prefix = ''
        existing_pairs = set()
        for category, rel, _, _ in originals:
            if category != 'ball-2d':
                continue
            p = BALL_2D_FILENAME_PATTERN.fullmatch(Path(rel).name)
            if p is None:
                continue
            if raw_match_number is None:
                raw_match_number = p['match']
                marker = f'rally{p["rally"]}/view'
                cut = rel.lower().find(marker.lower())
                source_prefix = rel[:cut] if cut >= 0 else ''
            existing_pairs.add((int(p['rally']), int(p['camera'])))

        for camera, frame in sorted(missing_corrections):
            rally = next((r for r in rallies
                          if int(r.start_frame) <= frame < int(r.end_frame)), None)
            if rally is None or (int(rally.rally_index), camera) in existing_pairs:
                raise HTTPException(409, detail=(
                    f'Cam {camera} Frame {frame} 的 2D 修正找不到適合的來源檔影格範圍。'
                    '請在 Update Dataset 補傳對應 CSV，避免匯出錯誤位置。'))
            added[(int(rally.rally_index), int(rally.start_frame),
                   int(rally.end_frame), camera)].append(frame)

        for (rally_index, start, end, camera), frames in added.items():
            number = raw_match_number or str(match_id)
            name = (f'{source_prefix}rally{rally_index}/view{camera}/v3/'
                    f'match{number}_{rally_index}_{start}_{end}_view{camera}_ball.csv')
            zipname = f'ball-2d/{name}'
            if zipname.casefold() in names:
                raise HTTPException(409, detail=f'輸出檔名衝突：{zipname}')
            names.add(zipname.casefold())
            data = io.StringIO(newline='')
            writer = csv.writer(data, lineterminator='\n')
            writer.writerow(['Frame', 'Visibility', 'X', 'Y'])
            for frame in frames:
                point = changes[(camera, frame)]
                writer.writerow([frame - start, point.visibility,
                                 _coordinate(point.x) if point.visibility else '0',
                                 _coordinate(point.y) if point.visibility else '0'])
            added[(rally_index, start, end, camera)] = (zipname, data.getvalue().encode('utf-8'))

    file = tempfile.NamedTemporaryFile(prefix='badminton_exact_export_', suffix='.zip', delete=False)
    filename = file.name
    file.close()
    try:
        with zipfile.ZipFile(filename, 'w', zipfile.ZIP_DEFLATED, compresslevel=5,
                             allowZip64=True) as archive:
            for category, rel, path, zip_name in originals:
                if category == 'ball-2d' and changes:
                    original_bytes = path.read_bytes()
                    modified = _csv_with_2d_corrections(original_bytes, rel, changes)
                    if modified == original_bytes:
                        archive.write(path, zip_name)
                    else:
                        archive.writestr(zip_name, modified)
                else:
                    archive.write(path, zip_name)
            for zipname, data in added.values():
                archive.writestr(zipname, data)
    except Exception:
        Path(filename).unlink(missing_ok=True)
        raise
    background_tasks.add_task(Path(filename).unlink, missing_ok=True)
    return FileResponse(filename, media_type='application/zip',
                        filename=f'badminton_dataset_{match_id}_same_as_input.zip',
                        background=background_tasks)
