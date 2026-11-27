"""保留上傳原檔，匯出時使用原始路徑、名稱、欄位與檔案格式。"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path, PurePosixPath

from fastapi import HTTPException

from .dataset_helpers import record_file_path
from .reconstruction_assets import match_asset_dir


FOLDER = 'original_uploads'
MANIFEST = 'files.json'


def source_dir(match_id):
    return match_asset_dir(match_id) / FOLDER


def safe_path(relative_path):
    text = str(relative_path or '').replace('\\', '/')
    if (not text or text.startswith('/') or '\x00' in text or
            any(part in ('', '.', '..') for part in text.split('/')) or
            any(':' in part for part in text.split('/'))):
        raise HTTPException(400, detail='原始檔路徑不合法')
    path = PurePosixPath(text)
    if path.is_absolute():
        raise HTTPException(400, detail='原始檔路徑不得使用絕對路徑')
    return path.as_posix()


def source_records(match_id):
    manifest = source_dir(match_id) / MANIFEST
    if not manifest.is_file():
        return None
    try:
        data = json.loads(manifest.read_text(encoding='utf-8'))
        if data.get('version') != 1 or not isinstance(data.get('files'), list):
            return None
        return data['files']
    except (ValueError, OSError, TypeError):
        return None


def _digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def _entry(category, relative_path, filepath, name=None):
    return {
        'category': category,
        'relative_path': safe_path(relative_path),
        'stored_name': name or '',
        'size': filepath.stat().st_size,
        'sha256': _digest(filepath),
    }


def _write_index(root, entries):
    path = root / MANIFEST
    pending = root / (MANIFEST + '.tmp')
    pending.write_text(json.dumps({'version': 1, 'files': entries}, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(pending, path)


def save_new_dataset_sources(match_id, session_base, session_manifest):
    """匯入成功後、DB commit 前封存；匯入失敗時外層會清理整個 match 資料夾。"""
    root = source_dir(match_id)
    if root.exists():
        raise RuntimeError('資料集原始檔封存位置已存在')
    root.mkdir(parents=True, exist_ok=False)
    entries = []
    used = set()
    try:
        for category, records in session_manifest.get('categories', {}).items():
            for record in records:
                rel = safe_path(record.get('original_relative_path') or record['relative_path'])
                key = (category, rel.casefold())
                if key in used:
                    raise ValueError(f'重複的原始檔路徑：{category}/{rel}')
                used.add(key)
                source = record_file_path(session_base, record)
                filename = f'{len(entries):07d}{source.suffix.lower()}'
                target = root / filename
                shutil.copyfile(source, target)
                entries.append(_entry(category, rel, target, filename))
        _write_index(root, entries)
    except Exception:
        shutil.rmtree(root, ignore_errors=True)
        raise
    return entries


def _source_key(category, relative_path):
    if category == 'ball-2d':
        # 補傳同一 Rally／視角時，即使 match 編號或 _calib 檔名變了也算替換。
        from .dataset_upload import BALL_2D_FILENAME_PATTERN
        match = BALL_2D_FILENAME_PATTERN.fullmatch(Path(relative_path).name)
        if match is not None:
            return (category, *(match[k] for k in ('rally', 'start', 'end', 'camera')))
    return category, relative_path.casefold()


class StagedSourceReplacement:
    """Prepare immutable source blobs, publish index and restore it if DB fails.

    The caller must hold the match's DB write lock until the DB commits. Old
    blobs are kept until commit succeeds, so a rollback can restore the index.
    """

    def __init__(self, match_id, additions):
        self.root = source_dir(match_id)
        self.root.mkdir(parents=True, exist_ok=True)
        self.previous_manifest = (self.root / MANIFEST).read_bytes() if (self.root / MANIFEST).exists() else None
        previous = source_records(match_id)
        if self.previous_manifest is not None and previous is None:
            raise HTTPException(409, detail='原始檔索引損壞，禁止覆寫')
        self.previous = previous or []
        self.updated = {_source_key(e['category'], e['relative_path']): dict(e) for e in self.previous}
        self.new_names = []
        self.published = False
        try:
            for category, path, content in additions:
                rel = safe_path(path)
                filename = f'{os.urandom(12).hex()}{Path(rel).suffix.lower()}'
                target = self.root / filename
                with target.open('xb') as output:
                    output.write(content)
                    output.flush()
                    os.fsync(output.fileno())
                self.new_names.append(filename)
                self.updated[_source_key(category, rel)] = _entry(category, rel, target, filename)
        except Exception:
            self.rollback()
            raise

    def publish(self):
        # Index is atomically replaced. No database transaction has committed yet.
        _write_index(self.root, list(self.updated.values()))
        self.published = True

    def rollback(self):
        if self.published:
            if self.previous_manifest is None:
                (self.root / MANIFEST).unlink(missing_ok=True)
            else:
                pending = self.root / (MANIFEST + '.restore')
                pending.write_bytes(self.previous_manifest)
                os.replace(pending, self.root / MANIFEST)
            self.published = False
        for name in self.new_names:
            (self.root / name).unlink(missing_ok=True)

    def finish(self):
        # Cleanup only after commit; failures here do not invalidate the index.
        active = {item['stored_name'] for item in self.updated.values()}
        for item in self.previous:
            old_name = item['stored_name']
            if old_name not in active:
                try:
                    (self.root / old_name).unlink(missing_ok=True)
                except OSError:
                    pass


def replace_saved_sources(match_id, additions):
    """Legacy standalone source replacement. DB-coupled writes use staging."""
    stage = StagedSourceReplacement(match_id, additions)
    try:
        stage.publish()
    except Exception:
        stage.rollback()
        raise
    stage.finish()
    return len(additions)


def checked_original_file(match_id, entry):
    rel = safe_path(entry['relative_path'])
    name = Path(str(entry.get('stored_name', ''))).name
    if name != entry.get('stored_name') or not name or name == MANIFEST:
        raise HTTPException(409, detail=f'原始檔索引無效：{rel}')
    base = source_dir(match_id).resolve()
    candidate = (base / name).resolve()
    if not candidate.is_relative_to(base) or not candidate.is_file():
        raise HTTPException(409, detail=f'找不到原始檔：{entry["category"]}/{rel}，請到 Update Dataset 補傳')
    if candidate.stat().st_size != int(entry.get('size', -1)) or _digest(candidate) != entry.get('sha256'):
        raise HTTPException(409, detail=f'原始檔校驗不通過：{entry["category"]}/{rel}')
    return candidate


def rows_fingerprint(rows):
    """Stable checksum of database source points, excluding correction overlays."""
    content = [[int(r['frame']), int(r['visibility']), float(r['x']), float(r['y'])]
               for r in sorted(rows, key=lambda item: int(item['frame']))]
    return hashlib.sha256(json.dumps(content, separators=(',', ':'),
                                     allow_nan=False).encode('utf-8')).hexdigest()
