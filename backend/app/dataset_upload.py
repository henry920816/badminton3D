from __future__ import annotations

import json
import math
import os
import re
import shutil
import tempfile
import time
import uuid
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np
import pandas as pd
from fastapi import HTTPException
from sqlalchemy import insert
from sqlalchemy.orm import Session

from .dataset_originals import safe_path
from .dataset_helpers import (
    safe_int, safe_float, safe_str, safe_bool, positive_float,
    positive_int, record_file_path,
)
from .dataset_cameras import (
    CAMERA_PATTERN, DEFAULT_COURT_TRANSFORM, ALLOWED_COORDINATE_MODES,
    camera_record_map, load_intrinsic, load_extrinsic, inspect_cameras,
    camera_pose, court_transform, camera_setting, load_cameras,
)
from .models import BallPosition2D, BallTraj, Hit, Match, Rally
from .players import (
    apply_match_gender,
    build_match_roster,
    parse_score_label,
    resolve_up_team,
)
from .reconstruction_assets import (
    import_reconstruction_assets,
    inspect_reconstruction_records,
)


MAX_SESSION_BYTES = int(
    os.getenv(
        "MAX_DATASET_UPLOAD_BYTES",
        str(2 * 1024**3),
    )
)

UPLOAD_SESSION_TTL_SECONDS = int(
    os.getenv(
        "DATASET_UPLOAD_SESSION_TTL_SECONDS",
        str(6 * 60 * 60),
    )
)

UPLOAD_SESSION_ROOT = Path(
    os.getenv(
        "DATASET_UPLOAD_SESSION_DIR",
        str(
            Path(tempfile.gettempdir())
            / "badminton-dataset-upload-sessions"
        ),
    )
)

UPLOAD_SESSION_ROOT.mkdir(
    parents=True,
    exist_ok=True,
)


CATEGORY_NAMES = {
    "cameras": "相機參數",
    "rally-data": "Rally 與擊球標註",
    "ball": "球軌跡",
    "ball-mask": "球軌跡 Mask",
    "ball-2d": "2D 羽球位置",
    "human-racket": "人體與球拍重建",
}

CATEGORY_EXTENSIONS = {
    "cameras": {".npy"},
    "rally-data": {".csv"},
    "ball": {".npy"},
    "ball-mask": {".npy"},
    "ball-2d": {".csv"},
    "human-racket": {".pth", ".npz", ".csv"},
}

REQUIRED_RALLY_COLUMNS = {
    "Score",
    "Start",
    "End",
}


BALL_2D_FILENAME_PATTERN = re.compile(
    r"^match(?P<match>\d+)_(?P<rally>\d+)_"
    r"(?P<start>\d+)_(?P<end>\d+)_view(?P<camera>\d+)"
    r"(?:_calib)?_ball\.csv$",
    re.IGNORECASE,
)

BALL_2D_PATH_PATTERN = re.compile(
    r"(?:^|/)rally(?P<rally>\d+)/view(?P<camera>\d+)/v3/[^/]+$",
    re.IGNORECASE,
)

REQUIRED_BALL_2D_COLUMNS = {
    "Frame",
    "Visibility",
    "X",
    "Y",
}

TOKEN_PATTERN = re.compile(
    r"^[0-9a-f]{32}$"
)

PLAIN_NUMBER_PATTERN = re.compile(
    r"^[+-]?(?:\d+|\d+\.0+)$"
)


# -----------------------------------------------------------------------------
# 資料集欄位處理
# -----------------------------------------------------------------------------


def normalize_key(
    value: Any,
) -> str:
    text = safe_str(value)

    if not text:
        return ""

    # 1_01_00 是檔案名稱，不該被 float 當成 10100。
    if not PLAIN_NUMBER_PATTERN.fullmatch(text):
        return text

    try:
        number = float(text)

        if number.is_integer():
            return str(int(number))

    except ValueError:
        return text

    return text


# -----------------------------------------------------------------------------
# 分批上傳暫存資料
# -----------------------------------------------------------------------------


def clean_expired_sessions() -> None:
    now = time.time()

    try:
        entries = list(
            UPLOAD_SESSION_ROOT.iterdir()
        )

    except OSError:
        return

    for entry in entries:
        if not entry.is_dir():
            continue

        try:
            expired = (
                now
                - entry.stat().st_mtime
                > UPLOAD_SESSION_TTL_SECONDS
            )

        except OSError:
            continue

        if expired:
            shutil.rmtree(
                entry,
                ignore_errors=True,
            )


def validate_token(
    token: str,
) -> str:
    value = str(
        token or ""
    ).strip().lower()

    if not TOKEN_PATTERN.fullmatch(value):
        raise HTTPException(
            status_code=400,
            detail=(
                "上傳工作階段代碼無效，"
                "請重新建立資料集"
            ),
        )

    return value


def session_dir(
    token: str,
) -> Path:
    return (
        UPLOAD_SESSION_ROOT
        / validate_token(token)
    )


def default_manifest(
    token: str,
) -> dict:
    now = time.time()

    return {
        "token": token,
        "created_at": now,
        "updated_at": now,
        "categories": {
            category: []
            for category in CATEGORY_NAMES
        },
    }


def manifest_path(
    base: Path,
) -> Path:
    return base / "manifest.json"


def save_manifest(
    base: Path,
    manifest: dict,
) -> None:
    manifest["updated_at"] = time.time()

    manifest_path(base).write_text(
        json.dumps(
            manifest,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    os.utime(
        base,
        None,
    )


def load_session(
    token: str,
) -> tuple[Path, dict]:
    base = session_dir(token)
    path = manifest_path(base)

    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail=(
                "上傳工作階段不存在或已過期，"
                "請重新建立資料集"
            ),
        )

    try:
        manifest = json.loads(
            path.read_text(
                encoding="utf-8",
            )
        )

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="上傳工作階段資料損壞",
        ) from exc

    categories = manifest.get(
        "categories"
    )

    if not isinstance(
        categories,
        dict,
    ):
        raise HTTPException(
            status_code=500,
            detail="上傳工作階段格式錯誤",
        )

    legacy_rallies = (
        categories.pop("rallies", [])
        if isinstance(categories.get("rallies"), list)
        else []
    )

    legacy_shots = (
        categories.pop("shots", [])
        if isinstance(categories.get("shots"), list)
        else []
    )

    if not isinstance(
        categories.get("rally-data"),
        list,
    ):
        categories["rally-data"] = []

    existing_ids = {
        str(record.get("id"))
        for record in categories["rally-data"]
        if isinstance(record, dict)
    }

    for record in [
        *legacy_rallies,
        *legacy_shots,
    ]:
        if not isinstance(record, dict):
            continue

        record_id = str(record.get("id"))

        if record_id in existing_ids:
            continue

        categories["rally-data"].append(record)
        existing_ids.add(record_id)

    for category in CATEGORY_NAMES:
        if not isinstance(
            categories.get(category),
            list,
        ):
            categories[category] = []

    return base, manifest


def validate_category(
    category: str,
) -> str:
    value = str(
        category or ""
    ).strip().lower()

    if value not in CATEGORY_NAMES:
        raise HTTPException(
            status_code=404,
            detail="不支援的資料類型",
        )

    return value


def safe_basename(
    filename: str,
) -> str:
    value = Path(
        str(filename or "")
        .replace("\\", "/")
    ).name.strip()

    if not value:
        return "unnamed"

    value = re.sub(
        r"[^0-9A-Za-z._()\-\u4e00-\u9fff]",
        "_",
        value,
    )

    return value[:240]


def normalize_relative_path(
    value: str | None,
    fallback_name: str,
) -> str:
    text = str(
        value or fallback_name
    ).replace("\\", "/").strip()

    parts = []

    for part in PurePosixPath(text).parts:
        if part in {
            "",
            ".",
            "..",
            "/",
        }:
            continue

        parts.append(
            safe_basename(part)
        )

    if not parts:
        return safe_basename(fallback_name)

    return "/".join(parts)


def category_dir(
    base: Path,
    category: str,
) -> Path:
    path = base / "files" / category
    path.mkdir(
        parents=True,
        exist_ok=True,
    )
    return path


def current_session_size(
    manifest: dict,
) -> int:
    total = 0

    for records in manifest[
        "categories"
    ].values():
        for record in records:
            total += int(
                record.get("size", 0)
                or 0
            )

    return total


def category_filename_allowed(
    category: str,
    filename: str,
) -> bool:
    lower_name = filename.lower()

    if category == "cameras":
        return CAMERA_PATTERN.fullmatch(
            filename
        ) is not None

    if category == "rally-data":
        return lower_name in {
            "rallyseg.csv",
            "shot_annotated.csv",
        }

    if category in {
        "ball",
        "ball-mask",
    }:
        return lower_name.endswith(".npy")

    if category == "ball-2d":
        return BALL_2D_FILENAME_PATTERN.fullmatch(
            filename
        ) is not None

    if category == "human-racket":
        return (
            lower_name == "gender.csv"
            or lower_name.endswith(".pth")
            or lower_name.endswith(".npz")
        )

    return False


def find_replacement_record(
    category: str,
    records: list[dict],
    original_name: str,
    relative_path: str,
) -> dict | None:
    for record in records:
        if category == "ball-2d":
            # 檔案改從不同資料夾補傳時，依 Rally/視角/Frame 範圍辨認同一份 CSV。
            # 不要只比路徑，否則舊檔與新檔會重複匯入。
            previous = BALL_2D_FILENAME_PATTERN.fullmatch(str(record.get("original_name", "")))
            incoming = BALL_2D_FILENAME_PATTERN.fullmatch(original_name)
            if previous and incoming and all(
                previous.group(key) == incoming.group(key)
                for key in ("rally", "start", "end", "camera")
            ):
                return record
        elif category in {"rally-data", "human-racket"}:
            existing_key = str(record.get("relative_path", "")).replace("\\", "/").lower()
            if existing_key == relative_path.lower():
                return record

        elif category in {
            "cameras",
            "ball",
            "ball-mask",
        }:
            existing_name = str(
                record.get("original_name", "")
            ).lower()

            if existing_name == original_name.lower():
                return record

    return None

def remove_record_file(
    base: Path,
    record: dict,
) -> None:
    try:
        record_file_path(
            base,
            record,
        ).unlink(
            missing_ok=True
        )

    except OSError:
        pass


def next_record_order(
    records: list[dict],
) -> int:
    if not records:
        return 0

    return max(
        int(record.get("order", 0))
        for record in records
    ) + 1


async def store_uploaded_files(
    base: Path,
    manifest: dict,
    category: str,
    files: list[UploadFile],
    relative_paths: list[str] | None,
) -> None:
    if not files:
        raise HTTPException(
            status_code=400,
            detail=(
                f"請選擇{CATEGORY_NAMES[category]}檔案"
            ),
        )

    paths = list(
        relative_paths or []
    )

    if paths and len(paths) != len(files):
        raise HTTPException(
            status_code=400,
            detail="檔案與路徑數量不一致",
        )

    records = manifest[
        "categories"
    ][category]

    extensions = CATEGORY_EXTENSIONS[
        category
    ]

    session_size = current_session_size(
        manifest
    )

    for index, upload in enumerate(files):
        original_name = safe_basename(
            upload.filename or ""
        )

        extension = Path(
            original_name
        ).suffix.lower()

        if extension not in extensions:
            allowed = ", ".join(
                sorted(extensions)
            )

            raise HTTPException(
                status_code=400,
                detail=(
                    f"{CATEGORY_NAMES[category]}只接受 "
                    f"{allowed}，目前檔案為 {original_name}"
                ),
            )

        if not category_filename_allowed(
            category,
            original_name,
        ):
            if category == "rally-data":
                expected = (
                    "RallySeg.csv 或 "
                    "shot_annotated.csv"
                )
            elif category == "human-racket":
                expected = (
                    "{Score}_0.pth、{Score}_1.pth、"
                    "對應 .npz 或 gender.csv"
                )
            elif category == "ball-2d":
                expected = (
                    "match2_1_3162_3778_view3_ball.csv 或 "
                    "match2_1_3162_3778_view3_calib_ball.csv"
                )
            elif category == "cameras":
                expected = (
                    "Cam_0_intrinsic.npy、"
                    "Cam_0_extrinsic.npy 等相機檔案"
                )
            else:
                expected = ".npy 檔案"

            raise HTTPException(
                status_code=400,
                detail=(
                    f"{original_name} 不是可辨識的"
                    f"{CATEGORY_NAMES[category]}檔案；"
                    f"預期為 {expected}"
                ),
            )

        original_relative_path = safe_path(paths[index] if index < len(paths) else original_name)
        relative_path = normalize_relative_path(
            original_relative_path,
            original_name,
        )

        # 單檔補傳時，瀏覽器沒有原本的資料夾路徑；同名只出現一次才允許自動配回。
        # 多個 Set 都有 RallySeg.csv 時不猜測，請使用資料夾上傳保留路徑。
        if category in {"rally-data", "human-racket"} and relative_path == original_name:
            name_matches = [record for record in records
                            if str(record.get("original_name", "")).lower() == original_name.lower()]
            if len(name_matches) == 1:
                relative_path = str(name_matches[0].get("relative_path", relative_path))
            elif len(name_matches) > 1:
                raise HTTPException(
                    status_code=400,
                    detail=f"{original_name} 在多個資料夾有同名檔案，請使用『選擇資料夾』保留原路徑",
                )

        replace_record = find_replacement_record(
            category,
            records,
            original_name,
            relative_path,
        )

        if replace_record is not None:
            order = int(replace_record.get("order", 0))
            old_size = int(replace_record.get("size", 0) or 0)
        else:
            order = next_record_order(records)
            old_size = 0

        stored_name = (
            f"{order:05d}_"
            f"{uuid.uuid4().hex[:10]}_"
            f"{original_name}"
        )

        destination = (
            category_dir(
                base,
                category,
            )
            / stored_name
        )

        file_size = 0

        try:
            with destination.open(
                "wb"
            ) as output:
                while True:
                    chunk = await upload.read(
                        1024 * 1024
                    )

                    if not chunk:
                        break

                    file_size += len(chunk)
                    if session_size - old_size + file_size > MAX_SESSION_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail=(
                                "這個資料集上傳的檔案總量"
                                "超過大小限制"
                            ),
                        )

                    output.write(chunk)

        except Exception:
            destination.unlink(
                missing_ok=True
            )
            raise

        finally:
            await upload.close()

        if file_size == 0:
            destination.unlink(
                missing_ok=True
            )

            raise HTTPException(
                status_code=400,
                detail=f"{original_name} 是空檔案",
            )

        # 新檔完整寫入後，才替換先前的檔案；失敗時舊檔不會先被刪掉。
        if replace_record is not None:
            records.remove(replace_record)
            remove_record_file(base, replace_record)
        session_size = session_size - old_size + file_size
        records.append(
            {
                "id": uuid.uuid4().hex,
                "order": order,
                "original_name": original_name,
                "relative_path": relative_path,
                "original_relative_path": original_relative_path,
                "stored_path": str(
                    destination.relative_to(base)
                ).replace("\\", "/"),
                "size": file_size,
                "uploaded_at": time.time(),
            }
        )
        # 多檔上傳中途失敗時，前面已成功的檔案仍然有完整 manifest。
        save_manifest(base, manifest)

    records.sort(
        key=lambda record: int(
            record.get("order", 0)
        )
    )

    save_manifest(
        base,
        manifest,
    )


# -----------------------------------------------------------------------------
# Camera validation and conversion
# -----------------------------------------------------------------------------


# -----------------------------------------------------------------------------
# Rally, shot, ball and mask inspection
# -----------------------------------------------------------------------------


def ordered_records(
    manifest: dict,
    category: str,
) -> list[dict]:
    return sorted(
        manifest[
            "categories"
        ][category],
        key=lambda record: int(
            record.get("order", 0)
        ),
    )


def validate_rally_dataframe(
    path: Path,
    frame: pd.DataFrame,
) -> pd.DataFrame:
    missing = (
        REQUIRED_RALLY_COLUMNS
        - set(frame.columns)
    )

    if missing:
        raise ValueError(
            f"{path.name} 缺少必要欄位："
            + ", ".join(
                sorted(missing)
            )
        )

    result = (
        frame
        .sort_values(
            [
                "Start",
                "End",
            ]
        )
        .reset_index(
            drop=True
        )
    )

    for row_index, row in result.iterrows():
        start = safe_int(
            row.get("Start")
        )
        end = safe_int(
            row.get("End")
        )

        if start is None or end is None:
            raise ValueError(
                f"{path.name} 第 {row_index + 2} 列 "
                "Start 或 End 無效"
            )

        if start < 0 or end < 0:
            raise ValueError(
                f"{path.name} 第 {row_index + 2} 列 "
                "frame 不可為負數"
            )

        if start > end:
            raise ValueError(
                f"{path.name} 第 {row_index + 2} 列 "
                "Start 不可大於 End"
            )

    return result


def rally_data_group_key(
    record: dict,
) -> str:
    relative_path = str(
        record.get(
            "relative_path",
            record.get("original_name", ""),
        )
    ).replace("\\", "/")

    parent = str(
        PurePosixPath(relative_path).parent
    ).replace("\\", "/").strip()

    if parent in {
        "",
        ".",
        "/",
    }:
        return "__root__"

    return parent.lower()


def rally_data_group_label(
    key: str,
) -> str:
    if key == "__root__":
        return "根目錄"

    return key


def natural_sort_key(
    text: str,
) -> list:
    return [
        int(chunk) if chunk.isdigit() else chunk
        for chunk in re.split(r"(\d+)", str(text).lower())
    ]


def split_rally_data_records(
    manifest: dict,
) -> tuple[list[dict], list[dict]]:
    records = ordered_records(
        manifest,
        "rally-data",
    )

    rallies_by_group: dict[str, list[dict]] = {}
    shots = []

    for record in records:
        name = str(
            record.get("original_name", "")
        ).lower()

        if name == "rallyseg.csv":
            rallies_by_group.setdefault(
                rally_data_group_key(record),
                [],
            ).append(record)

        elif name == "shot_annotated.csv":
            shots.append(record)

    # Set 資料夾的實際上傳順序（browser 目錄列舉順序）不可靠，
    # 依資料夾名稱自然排序，確保 Rally 編號依照 Set 順序遞增。
    rallies = [
        record
        for key in sorted(
            rallies_by_group,
            key=natural_sort_key,
        )
        for record in rallies_by_group[key]
    ]

    return rallies, shots


def inspect_rally_data(
    base: Path,
    manifest: dict,
) -> dict:
    records = ordered_records(
        manifest,
        "rally-data",
    )

    errors: list[str] = []
    warnings: list[str] = []
    items: list[dict] = []

    rally_records, shot_records = (
        split_rally_data_records(
            manifest
        )
    )

    if not rally_records:
        errors.append(
            "尚未找到 RallySeg.csv。"
            "請選擇同時包含 RallySeg.csv 與 "
            "shot_annotated.csv 的 Rally 資料夾"
        )

    grouped: dict[
        str,
        dict[str, list[dict]],
    ] = {}

    for record in records:
        key = rally_data_group_key(record)
        group = grouped.setdefault(
            key,
            {
                "rallies": [],
                "shots": [],
            },
        )

        name = str(
            record.get("original_name", "")
        ).lower()

        if name == "rallyseg.csv":
            group["rallies"].append(record)

        elif name == "shot_annotated.csv":
            group["shots"].append(record)

    ordered_groups = sorted(
        grouped.items(),
        key=lambda pair: natural_sort_key(pair[0]),
    )

    total_rally_rows = 0
    total_shot_rows = 0

    for key, group in ordered_groups:
        label = rally_data_group_label(key)
        item_errors: list[str] = []
        item_warnings: list[str] = []

        rallies = group["rallies"]
        shots = group["shots"]

        if len(rallies) == 0:
            item_errors.append(
                f"{label} 有 shot_annotated.csv，"
                "但缺少 RallySeg.csv"
            )

        if len(rallies) > 1:
            item_errors.append(
                f"{label} 有多個 RallySeg.csv；"
                "每個 Set 資料夾只能有一個"
            )

        if len(shots) > 1:
            item_errors.append(
                f"{label} 有多個 shot_annotated.csv；"
                "每個 Set 資料夾只能有一個"
            )

        rally_record = (
            rallies[0]
            if len(rallies) == 1
            else None
        )

        shot_record = (
            shots[0]
            if len(shots) == 1
            else None
        )

        rally_rows = 0
        shot_rows = 0
        rally_keys: set[str] = set()

        if rally_record is not None:
            rally_path = record_file_path(
                base,
                rally_record,
            )

            try:
                rally_frame = (
                    validate_rally_dataframe(
                        rally_path,
                        pd.read_csv(rally_path),
                    )
                )

                rally_rows = len(rally_frame)
                total_rally_rows += rally_rows

                rally_keys = {
                    normalize_key(value)
                    for value in rally_frame["Score"]
                    if normalize_key(value)
                }

            except Exception as exc:
                item_errors.append(
                    f"{label}/RallySeg.csv：{exc}"
                )

        if shot_record is None:
            if rally_record is not None:
                item_warnings.append(
                    f"{label} 沒有 shot_annotated.csv；"
                    "此 Set 仍可匯入，但不會有 Hit 標註"
                )

        else:
            shot_path = record_file_path(
                base,
                shot_record,
            )

            try:
                shot_frame = pd.read_csv(
                    shot_path
                )

                if "Rally" not in shot_frame.columns:
                    item_errors.append(
                        f"{label}/shot_annotated.csv "
                        "缺少 Rally 欄位"
                    )

                else:
                    shot_rows = len(shot_frame)
                    total_shot_rows += shot_rows

                    if rally_keys:
                        unmatched_count = sum(
                            1
                            for value in shot_frame["Rally"]
                            if normalize_key(value)
                            not in rally_keys
                        )

                        if unmatched_count > 0:
                            item_warnings.append(
                                f"{label}/shot_annotated.csv 有 "
                                f"{unmatched_count} 筆 Rally "
                                "在 RallySeg.csv 中找不到，"
                                "匯入時會略過"
                            )

            except Exception as exc:
                item_errors.append(
                    f"{label}/shot_annotated.csv "
                    f"無法讀取：{exc}"
                )

        item = {
            "id": key,
            "name": label,
            "label": label,
            "relative_path": label,
            "rally_name": (
                rally_record.get("original_name")
                if rally_record is not None
                else None
            ),
            "shot_name": (
                shot_record.get("original_name")
                if shot_record is not None
                else None
            ),
            "rally_row_count": rally_rows,
            "shot_row_count": shot_rows,
            "row_count": rally_rows,
            "valid": not item_errors,
            "errors": item_errors,
            "warnings": item_warnings,
        }

        items.append(item)
        errors.extend(item_errors)
        warnings.extend(item_warnings)

    return {
        "file_count": len(records),
        "folder_count": len(grouped),
        "rally_file_count": len(rally_records),
        "shot_file_count": len(shot_records),
        "rally_row_count": total_rally_rows,
        "shot_row_count": total_shot_rows,
        "row_count": total_rally_rows,
        "valid": not errors,
        "items": items,
        "errors": errors,
        "warnings": warnings,
    }

def npy_record_map(
    base: Path,
    manifest: dict,
    category: str,
) -> dict[str, dict]:
    result: dict[str, dict] = {}

    for record in ordered_records(
        manifest,
        category,
    ):
        stem = Path(
            str(record.get("original_name", ""))
        ).stem

        if not stem:
            continue

        result[stem.lower()] = {
            **record,
            "stem": stem,
            "path": record_file_path(
                base,
                record,
            ),
        }

    return result


def inspect_ball_file(
    path: Path,
    name: str,
) -> tuple[list[int] | None, list[str]]:
    errors: list[str] = []
    shape = None

    try:
        value = np.load(
            path,
            allow_pickle=False,
        )
        shape = list(value.shape)

        if not np.issubdtype(
            value.dtype,
            np.number,
        ):
            errors.append(
                f"{name} 必須是數字陣列"
            )

        elif (
            value.ndim != 2
            or value.shape[1] != 3
        ):
            errors.append(
                f"{name} shape 必須是 [N, 3]，"
                f"目前為 {shape}"
            )

    except Exception as exc:
        errors.append(
            f"{name} 無法載入：{exc}"
        )

    return shape, errors


def inspect_mask_file(
    path: Path,
    name: str,
) -> tuple[list[int] | None, list[str]]:
    errors: list[str] = []
    shape = None

    try:
        value = np.load(
            path,
            allow_pickle=False,
        )
        shape = list(value.shape)

        if not np.issubdtype(
            value.dtype,
            np.number,
        ):
            errors.append(
                f"{name} 必須是數字陣列"
            )

        elif value.ndim != 1:
            errors.append(
                f"{name} shape 必須是 [N]，"
                f"目前為 {shape}"
            )

    except Exception as exc:
        errors.append(
            f"{name} 無法載入：{exc}"
        )

    return shape, errors


def inspect_trajectory_files(
    base: Path,
    manifest: dict,
) -> tuple[dict, dict, list[str], list[str]]:
    ball_records = ordered_records(
        manifest,
        "ball",
    )
    mask_records = ordered_records(
        manifest,
        "ball-mask",
    )

    ball_map = npy_record_map(
        base,
        manifest,
        "ball",
    )
    mask_map = npy_record_map(
        base,
        manifest,
        "ball-mask",
    )

    ball_items = []
    mask_items = []
    errors: list[str] = []
    warnings: list[str] = []

    ball_shapes: dict[str, list[int] | None] = {}
    mask_shapes: dict[str, list[int] | None] = {}

    for record in ball_records:
        name = str(
            record.get("original_name", "")
        )
        key = Path(name).stem.lower()
        shape, item_errors = inspect_ball_file(
            record_file_path(base, record),
            name,
        )
        ball_shapes[key] = shape

        ball_items.append(
            {
                "id": record.get("id"),
                "name": name,
                "shape": shape,
                "valid": not item_errors,
                "errors": item_errors,
            }
        )

        errors.extend(item_errors)

    for record in mask_records:
        name = str(
            record.get("original_name", "")
        )
        key = Path(name).stem.lower()
        shape, item_errors = inspect_mask_file(
            record_file_path(base, record),
            name,
        )
        mask_shapes[key] = shape

        mask_items.append(
            {
                "id": record.get("id"),
                "name": name,
                "shape": shape,
                "valid": not item_errors,
                "errors": item_errors,
            }
        )

        errors.extend(item_errors)

    ball_keys = set(ball_map)
    mask_keys = set(mask_map)

    missing_masks = sorted(
        ball_keys - mask_keys
    )
    missing_balls = sorted(
        mask_keys - ball_keys
    )

    if missing_masks:
        warnings.append(
            "以下球軌跡缺少 Mask，匯入時會略過："
            + ", ".join(missing_masks[:20])
        )

    if missing_balls:
        warnings.append(
            "以下 Mask 缺少球軌跡，匯入時會略過："
            + ", ".join(missing_balls[:20])
        )

    paired_keys = sorted(
        ball_keys & mask_keys
    )

    for key in paired_keys:
        ball_shape = ball_shapes.get(key)
        mask_shape = mask_shapes.get(key)

        if (
            ball_shape
            and mask_shape
            and len(ball_shape) >= 1
            and len(mask_shape) >= 1
            and ball_shape[0] != mask_shape[0]
        ):
            errors.append(
                f"{key}.npy 的 ball 與 mask 長度不同 "
                f"({ball_shape[0]} != {mask_shape[0]})"
            )

    if not ball_records:
        warnings.append(
            "尚未上傳球軌跡 NPY；"
            "仍可建立資料集，但 3D 球軌跡會是空的"
        )

    if not mask_records:
        warnings.append(
            "尚未上傳球軌跡 Mask；"
            "仍可建立資料集，但 3D 球軌跡會是空的"
        )

    ball_result = {
        "file_count": len(ball_records),
        "paired_count": len(paired_keys),
        "valid": not any(
            item["errors"]
            for item in ball_items
        ),
        "items": ball_items,
        "errors": [
            error
            for item in ball_items
            for error in item["errors"]
        ],
        "warnings": [],
    }

    mask_result = {
        "file_count": len(mask_records),
        "paired_count": len(paired_keys),
        "valid": not any(
            item["errors"]
            for item in mask_items
        ),
        "items": mask_items,
        "errors": [
            error
            for item in mask_items
            for error in item["errors"]
        ],
        "warnings": [],
    }

    return (
        ball_result,
        mask_result,
        errors,
        warnings,
    )


def read_ball_2d_record(
    base: Path,
    record: dict,
) -> tuple[dict | None, pd.DataFrame | None, list[str]]:
    name = str(
        record.get("original_name", "")
    )
    relative_path = str(
        record.get("relative_path", name)
    ).replace("\\", "/")
    errors: list[str] = []

    filename_match = BALL_2D_FILENAME_PATTERN.fullmatch(
        name
    )
    path_match = BALL_2D_PATH_PATTERN.search(
        relative_path
    )

    if filename_match is None:
        return None, None, [
            f"{name}: 檔名不符合 match/rally/frame/view 規則"
        ]

    metadata = {
        key: int(value)
        for key, value in filename_match.groupdict().items()
    }

    if path_match is None:
        errors.append(
            f"{name}: 必須位於 rally*/view*/v3 資料夾"
        )
    else:
        path_rally = int(
            path_match.group("rally")
        )
        path_camera = int(
            path_match.group("camera")
        )

        if path_rally != metadata["rally"]:
            errors.append(
                f"{name}: 資料夾 rally{path_rally} 與檔名 rally{metadata['rally']} 不一致"
            )

        if path_camera != metadata["camera"]:
            errors.append(
                f"{name}: 資料夾 view{path_camera} 與檔名 view{metadata['camera']} 不一致"
            )

    if metadata["end"] <= metadata["start"]:
        errors.append(
            f"{name}: end frame 必須大於 start frame"
        )

    try:
        source = pd.read_csv(
            record_file_path(base, record)
        )
    except Exception as exc:
        errors.append(
            f"{name}: CSV 讀取失敗：{exc}"
        )
        return metadata, None, errors

    missing_columns = sorted(
        REQUIRED_BALL_2D_COLUMNS
        - set(source.columns)
    )

    if missing_columns:
        errors.append(
            f"{name}: 缺少欄位 {', '.join(missing_columns)}"
        )
        return metadata, None, errors

    if source.empty:
        errors.append(
            f"{name}: CSV 沒有資料列"
        )
        return metadata, None, errors

    numeric: dict[str, pd.Series] = {}

    for column in REQUIRED_BALL_2D_COLUMNS:
        numeric[column] = pd.to_numeric(
            source[column],
            errors="coerce",
        )

        if not np.isfinite(
            numeric[column].to_numpy(
                dtype=float,
                na_value=np.nan,
            )
        ).all():
            errors.append(
                f"{name}: {column} 必須全部是有限數值"
            )

    if errors:
        return metadata, None, errors

    frame_values = numeric["Frame"].to_numpy(
        dtype=float
    )
    visibility_values = numeric["Visibility"].to_numpy(
        dtype=float
    )

    if not np.equal(
        frame_values,
        np.floor(frame_values),
    ).all():
        errors.append(
            f"{name}: Frame 必須是整數"
        )

    if not np.isin(
        visibility_values,
        [0, 1],
    ).all():
        errors.append(
            f"{name}: Visibility 只能是 0 或 1"
        )

    frame_span = (
        metadata["end"]
        - metadata["start"]
    )

    if (
        (frame_values < 0).any()
        or (frame_values >= frame_span).any()
    ):
        errors.append(
            f"{name}: Frame 必須介於 0（含）與 {frame_span}（不含）之間"
        )

    if pd.Series(frame_values).duplicated().any():
        errors.append(
            f"{name}: Frame 不可重複"
        )

    if errors:
        return metadata, None, errors

    normalized = pd.DataFrame(
        {
            "frame": frame_values.astype(np.int64),
            "visibility": visibility_values.astype(np.int64),
            "x": numeric["X"].to_numpy(dtype=float),
            "y": numeric["Y"].to_numpy(dtype=float),
        }
    )

    return metadata, normalized, errors


def inspect_ball_2d_files(
    base: Path,
    manifest: dict,
) -> tuple[dict, list[str], list[str]]:
    records = ordered_records(
        manifest,
        "ball-2d",
    )
    items: list[dict] = []
    errors: list[str] = []
    warnings: list[str] = []
    match_numbers: set[int] = set()
    camera_indices: set[int] = set()
    occupied_frames: set[tuple[int, int]] = set()
    total_rows = 0
    visible_rows = 0
    maximum_end_frame = 0

    for record in records:
        metadata, frame, item_errors = read_ball_2d_record(
            base,
            record,
        )
        name = str(
            record.get("original_name", "")
        )

        if metadata is not None:
            match_numbers.add(
                metadata["match"]
            )
            camera_indices.add(
                metadata["camera"]
            )
            maximum_end_frame = max(
                maximum_end_frame,
                metadata["end"],
            )

        if frame is not None and metadata is not None:
            for local_frame in frame["frame"]:
                global_frame = (
                    metadata["start"]
                    + int(local_frame)
                )
                key = (
                    metadata["camera"],
                    global_frame,
                )

                if key in occupied_frames:
                    item_errors.append(
                        f"{name}: view{key[0]} 的 global frame {key[1]} 與其他檔案重複"
                    )
                    break

                occupied_frames.add(key)

            total_rows += len(frame)
            visible_rows += int(
                (frame["visibility"] == 1).sum()
            )

        item = {
            "id": record.get("id"),
            "name": name,
            "relative_path": record.get("relative_path"),
            "valid": not item_errors,
            "errors": item_errors,
            "row_count": len(frame) if frame is not None else 0,
            "visible_count": (
                int((frame["visibility"] == 1).sum())
                if frame is not None
                else 0
            ),
        }

        if metadata is not None:
            item.update(
                {
                    "match_number": metadata["match"],
                    "rally_index": metadata["rally"],
                    "start_frame": metadata["start"],
                    "end_frame": metadata["end"],
                    "camera_index": metadata["camera"],
                }
            )

        items.append(item)
        errors.extend(item_errors)

    if len(match_numbers) > 1:
        error = (
            "2D 羽球位置不可混用不同 match："
            + ", ".join(
                f"match{number}"
                for number in sorted(match_numbers)
            )
        )
        errors.append(error)

    if not records:
        warnings.append(
            "未上傳 2D 羽球位置；Video Panel 將只顯示既有 3D 投影"
        )

    result = {
        "file_count": len(records),
        "camera_count": len(camera_indices),
        "camera_indices": sorted(camera_indices),
        "row_count": total_rows,
        "visible_count": visible_rows,
        "maximum_end_frame": maximum_end_frame,
        "valid": not errors,
        "items": items,
        "errors": errors,
        "warnings": warnings,
    }

    return result, errors, warnings


def uploaded_rally_scores(
    base: Path,
    manifest: dict,
) -> set[str]:
    scores: set[str] = set()
    rally_records, _ = split_rally_data_records(manifest)

    for record in rally_records:
        path = record_file_path(base, record)
        try:
            frame = pd.read_csv(path)
        except Exception:
            continue

        if "Score" not in frame.columns:
            continue

        for value in frame["Score"]:
            key = normalize_key(value)
            if key:
                scores.add(key)

    return scores


def resolved_category_records(
    base: Path,
    manifest: dict,
    category: str,
) -> list[dict]:
    return [
        {
            **record,
            "path": record_file_path(base, record),
        }
        for record in ordered_records(manifest, category)
    ]


def inspect_upload_session(
    base: Path,
    manifest: dict,
) -> dict:
    cameras = inspect_cameras(
        base,
        manifest,
    )

    rally_data = inspect_rally_data(
        base,
        manifest,
    )

    (
        ball,
        ball_mask,
        trajectory_errors,
        trajectory_warnings,
    ) = inspect_trajectory_files(
        base,
        manifest,
    )

    (
        ball_2d,
        ball_2d_errors,
        ball_2d_warnings,
    ) = inspect_ball_2d_files(
        base,
        manifest,
    )

    human_racket = inspect_reconstruction_records(
        resolved_category_records(
            base,
            manifest,
            "human-racket",
        ),
        rally_scores=uploaded_rally_scores(base, manifest),
    )

    uploaded_camera_indices = {
        int(item["index"])
        for item in cameras.get("items", [])
        if "index" in item
    }
    missing_ball_2d_cameras = sorted(
        set(ball_2d.get("camera_indices", []))
        - uploaded_camera_indices
    )

    if missing_ball_2d_cameras:
        error = (
            "2D 羽球位置找不到對應的相機參數："
            + ", ".join(
                f"Cam {index}"
                for index in missing_ball_2d_cameras
            )
        )
        ball_2d_errors.append(error)
        ball_2d["errors"].append(error)
        ball_2d["valid"] = False

    errors = [
        *cameras["errors"],
        *rally_data["errors"],
        *trajectory_errors,
        *ball_2d_errors,
        *human_racket["errors"],
    ]

    warnings = [
        *cameras["warnings"],
        *rally_data["warnings"],
        *trajectory_warnings,
        *ball_2d_warnings,
        *human_racket["warnings"],
    ]

    return {
        "ok": True,
        "session_token": manifest["token"],
        "created_at": manifest.get("created_at"),
        "updated_at": manifest.get("updated_at"),
        "total_size": current_session_size(manifest),
        "can_finalize": not errors,
        "categories": {
            "cameras": cameras,
            "rally-data": rally_data,
            "ball": ball,
            "ball-mask": ball_mask,
            "ball-2d": ball_2d,
            "human-racket": human_racket,
        },
        "errors": errors,
        "warnings": warnings,
    }


# -----------------------------------------------------------------------------
# Import helpers
# -----------------------------------------------------------------------------


def pair_shot_records(
    rally_records: list[dict],
    shot_records: list[dict],
) -> dict[str, dict]:
    result: dict[str, dict] = {}
    shots_by_group: dict[str, dict] = {}

    for record in shot_records:
        key = rally_data_group_key(record)

        if key not in shots_by_group:
            shots_by_group[key] = record

    for rally_record in rally_records:
        rally_id = str(
            rally_record.get("id")
        )

        key = rally_data_group_key(
            rally_record
        )

        shot_record = shots_by_group.get(
            key
        )

        if shot_record is not None:
            result[rally_id] = shot_record

    return result

def trajectory_rows(
    match_id: int,
    score: str,
    start_frame: int,
    fps: float,
    ball_map: dict[str, dict],
    mask_map: dict[str, dict],
    warnings: list[str],
) -> list[dict]:
    key = score.lower()
    ball_record = ball_map.get(key)
    mask_record = mask_map.get(key)

    if (
        ball_record is None
        or mask_record is None
    ):
        warnings.append(
            f"{score}: 找不到 ball 或 mask，"
            "已略過球軌跡"
        )
        return []

    try:
        ball = np.load(
            ball_record["path"],
            allow_pickle=False,
        )
        mask = np.load(
            mask_record["path"],
            allow_pickle=False,
        )

    except Exception as exc:
        warnings.append(
            f"{score}: NPY 無法載入：{exc}"
        )
        return []

    if (
        ball.ndim != 2
        or ball.shape[1] != 3
    ):
        warnings.append(
            f"{score}: ball shape 必須是 [N,3]，"
            f"目前為 {list(ball.shape)}"
        )
        return []

    if mask.ndim != 1:
        warnings.append(
            f"{score}: mask shape 必須是 [N]，"
            f"目前為 {list(mask.shape)}"
        )
        return []

    if len(ball) != len(mask):
        warnings.append(
            f"{score}: ball/mask 長度不同 "
            f"({len(ball)} != {len(mask)})"
        )
        return []

    rows: list[dict] = []

    for local_value in np.flatnonzero(
        mask == 1
    ):
        local_frame = int(local_value)
        xyz = [
            float(value)
            for value in ball[local_frame]
        ]

        if not all(
            math.isfinite(value)
            for value in xyz
        ):
            continue

        global_frame = (
            start_frame
            + local_frame
        )

        rows.append(
            {
                "match_id": match_id,
                "frame": global_frame,
                "t_sec": global_frame / fps,
                "x": xyz[0],
                "y": xyz[1],
                "z": xyz[2],
                "confidence": 1.0,
            }
        )

    return rows


def import_ball_2d_rows(
    db: Session,
    match_id: int,
    base: Path,
    manifest: dict,
) -> tuple[int, int]:
    pending_rows: list[dict] = []
    point_count = 0
    visible_count = 0

    def flush_rows() -> None:
        nonlocal pending_rows

        if not pending_rows:
            return

        db.execute(
            insert(BallPosition2D),
            pending_rows,
        )
        pending_rows = []

    for record in ordered_records(
        manifest,
        "ball-2d",
    ):
        metadata, frame, errors = read_ball_2d_record(
            base,
            record,
        )

        if errors or metadata is None or frame is None:
            raise ValueError(
                "；".join(errors)
                or "2D 羽球位置資料無法解析"
            )

        for row in frame.itertuples(index=False):
            pending_rows.append(
                {
                    "match_id": match_id,
                    "camera_index": metadata["camera"],
                    "frame": metadata["start"] + int(row.frame),
                    "visibility": int(row.visibility),
                    "x": float(row.x),
                    "y": float(row.y),
                }
            )
            point_count += 1
            visible_count += int(
                row.visibility == 1
            )

            if len(pending_rows) >= 5000:
                flush_rows()

    flush_rows()

    return point_count, visible_count


def import_dataset_from_session(
    db: Session,
    base: Path,
    manifest: dict,
    settings: dict,
) -> dict:
    title = (
        safe_str(
            settings.get("title"),
            "Uploaded dataset",
        )
        or "Uploaded dataset"
    )

    fps = positive_float(
        settings.get("fps", 50),
        "FPS",
    )

    rally_records, shot_records = (
        split_rally_data_records(
            manifest
        )
    )

    if not rally_records:
        raise ValueError(
            "尚未上傳 RallySeg.csv"
        )

    parsed_rallies: list[
        tuple[dict, pd.DataFrame]
    ] = []
    duration_frame = 0

    for record in rally_records:
        path = record_file_path(
            base,
            record,
        )

        try:
            frame = validate_rally_dataframe(
                path,
                pd.read_csv(path),
            )

        except Exception as exc:
            if isinstance(exc, ValueError):
                raise

            raise ValueError(
                f"{record.get('original_name')} 無法讀取：{exc}"
            ) from exc

        duration_frame = max(
            duration_frame,
            max(
                (
                    safe_int(value, 0)
                    or 0
                    for value in frame["End"]
                ),
                default=0,
            ),
        )

        parsed_rallies.append(
            (record, frame)
        )

    (
        ball_2d_inspection,
        ball_2d_errors,
        _,
    ) = inspect_ball_2d_files(
        base,
        manifest,
    )

    if ball_2d_errors:
        raise ValueError(
            "；".join(ball_2d_errors)
        )

    duration_frame = max(
        duration_frame,
        int(
            ball_2d_inspection.get(
                "maximum_end_frame",
                0,
            )
            or 0
        ),
    )

    cameras = load_cameras(
        base,
        manifest,
        settings,
        fps,
    )

    ball_2d_camera_indices = set(
        ball_2d_inspection.get(
            "camera_indices",
            [],
        )
    )
    ball_2d_files_by_camera: dict[int, int] = {}

    for item in ball_2d_inspection.get(
        "items",
        [],
    ):
        camera_index = safe_int(
            item.get("camera_index")
        )

        if camera_index is None:
            continue

        ball_2d_files_by_camera[camera_index] = (
            ball_2d_files_by_camera.get(
                camera_index,
                0,
            )
            + 1
        )

    for camera in cameras:
        camera_index = safe_int(
            camera.get("index"),
            -1,
        )
        camera["has_ball_2d"] = (
            camera_index in ball_2d_camera_indices
        )
        camera["ball_2d_file_count"] = (
            ball_2d_files_by_camera.get(
                camera_index,
                0,
            )
        )

    ball_map = npy_record_map(
        base,
        manifest,
        "ball",
    )
    mask_map = npy_record_map(
        base,
        manifest,
        "ball-mask",
    )

    shot_pairs = pair_shot_records(
        rally_records,
        shot_records,
    )

    match = Match(
        title=title[:120],
        fps=fps,
        duration_frame=duration_frame,
        cameras=cameras,
    )

    db.add(match)
    db.flush()

    (
        ball_2d_point_count,
        ball_2d_visible_count,
    ) = import_ball_2d_rows(
        db,
        match.id,
        base,
        manifest,
    )

    warnings: list[str] = []
    rally_count = 0
    hit_count = 0
    trajectory_count = 0
    rally_index = 0
    rally_asset_rows: list[dict] = []

    # 名單要在建立 rally 之前就決定，因為每一球都要標記哪一隊在上半場。
    roster_rows = [
        {
            "up_court": safe_str(row.get("UpCourt")),
            "down_court": safe_str(row.get("DownCourt")),
        }
        for _, rally_frame in parsed_rallies
        for _, row in rally_frame.iterrows()
    ]

    roster = build_match_roster(
        db,
        match_id=match.id,
        rally_rows=roster_rows,
        gender="unknown",
    )
    warnings.extend(roster["warnings"])

    team_of = roster["team_of"]

    # 每一局各隊目前的分數，用來確認比分連續並算出這一球的勝方
    game_scores: dict[int, list[int]] = {}

    for rally_record, rally_frame in parsed_rallies:
        score_to_rally_id: dict[str, int] = {}

        for _, row in rally_frame.iterrows():
            rally_index += 1

            score = (
                normalize_key(
                    row.get("Score")
                )
                or f"rally_{rally_index}"
            )

            start_frame = (
                safe_int(
                    row.get("Start"),
                    0,
                )
                or 0
            )

            end_frame = safe_int(
                row.get("End"),
                start_frame,
            )

            if end_frame is None:
                end_frame = start_frame

            court_row = {
                "up_court": safe_str(row.get("UpCourt")),
                "down_court": safe_str(row.get("DownCourt")),
            }

            up_team = resolve_up_team(court_row, team_of)

            if up_team is None:
                warnings.append(
                    f"{score}：無法判斷哪一隊在上半場，先當成 team 0"
                )
                up_team = 0

            parsed_score = parse_score_label(score)

            if parsed_score is None:
                game_index, up_score, down_score = 1, 0, 0

                warnings.append(
                    f"{score}：Score 不是 局_上半場_下半場 的格式，無法讀出比分"
                )

            else:
                game_index, up_score, down_score = parsed_score

            # Score 記的是這一球打完之後的分數，所以拿它跟同一局上一球比，
            # 分數多 1 的那一隊就是這一球的勝方。
            winner_team = None

            if parsed_score is not None:
                previous = game_scores.setdefault(game_index, [0, 0])

                current = [0, 0]
                current[up_team] = up_score
                current[1 - up_team] = down_score

                gained = [
                    team
                    for team in (0, 1)
                    if current[team] - previous[team] == 1
                ]

                held = [
                    team
                    for team in (0, 1)
                    if current[team] == previous[team]
                ]

                if len(gained) == 1 and len(held) == 1:
                    winner_team = gained[0]

                else:
                    warnings.append(
                        f"{score}：比分和上一球接不起來"
                        f"（{previous[0]}:{previous[1]} -> {current[0]}:{current[1]}）"
                    )

                game_scores[game_index] = current

            rally = Rally(
                match_id=match.id,
                rally_index=rally_index,
                start_frame=start_frame,
                end_frame=end_frame,
                status="unchecked",
                game_index=game_index,
                score_label=score[:20],
                up_team=up_team,
                up_score=up_score,
                down_score=down_score,
                winner_team=winner_team,
            )

            db.add(rally)
            db.flush()

            score_to_rally_id[score] = rally.id
            rally_count += 1

            rally_asset_rows.append(
                {
                    "rally_id": rally.id,
                    "rally_index": rally_index,
                    "score": score,
                    "start_frame": start_frame,
                    "end_frame": end_frame,
                }
            )

            rows = trajectory_rows(
                match.id,
                score,
                start_frame,
                fps,
                ball_map,
                mask_map,
                warnings,
            )

            if rows:
                db.execute(
                    insert(BallTraj),
                    rows,
                )
                trajectory_count += len(rows)

        shot_record = shot_pairs.get(
            str(rally_record.get("id"))
        )

        if shot_record is None:
            continue

        shot_path = record_file_path(
            base,
            shot_record,
        )

        try:
            shots = pd.read_csv(
                shot_path
            )

        except Exception as exc:
            raise ValueError(
                f"{shot_record.get('original_name')} 無法讀取：{exc}"
            ) from exc

        for _, row in shots.iterrows():
            rally_key = normalize_key(
                row.get("Rally")
            )

            rally_id = score_to_rally_id.get(
                rally_key
            )

            if rally_id is None:
                warnings.append(
                    f"{shot_record.get('original_name')}: "
                    f"找不到 Rally={rally_key}，"
                    "已略過該筆 Hit"
                )
                continue

            player = safe_str(
                row.get(
                    "player",
                    row.get(
                        "Player",
                        "Up",
                    ),
                ),
                "Up",
            )

            db.add(
                Hit(
                    match_id=match.id,
                    rally_id=rally_id,
                    ball_round=(
                        safe_int(
                            row.get("Ball Round"),
                            1,
                        )
                        or 1
                    ),
                    player=player[:10],
                    hit_frame=(
                        safe_int(
                            row.get("Hit Frame"),
                            0,
                        )
                        or 0
                    ),
                    new_hit_frame=safe_int(
                        row.get("New Hit Frame")
                    ),
                    shot_type=safe_str(
                        row.get("Shot Type"),
                        "Unknown",
                    )[:30],
                    hand=safe_str(
                        row.get("Hand"),
                        "Unknown",
                    )[:10],
                    note=safe_str(
                        row.get("Note"),
                        "",
                    )[:400],
                    confidence=1.0,
                )
            )

            hit_count += 1

    reconstruction = import_reconstruction_assets(
        match_id=match.id,
        title=match.title,
        records=resolved_category_records(
            base,
            manifest,
            "human-racket",
        ),
        settings=settings,
        rallies=rally_asset_rows,
    )
    warnings.extend(reconstruction.get("warnings", []))

    apply_match_gender(
        db,
        match.id,
        reconstruction.get("gender") or "unknown",
    )

    if rally_count and not roster["player_count"]:
        warnings.append(
            "RallySeg.csv 沒有讀到任何選手名字，"
            "請確認欄位名稱是 UpCourt 與 DownCourt"
        )

    db.flush()

    return {
        "ok": True,
        "match_id": match.id,
        "title": match.title,
        "fps": match.fps,
        "duration_frame": match.duration_frame,
        "rally_count": rally_count,
        "hit_count": hit_count,
        "trajectory_count": trajectory_count,
        "ball_2d_file_count": ball_2d_inspection["file_count"],
        "ball_2d_point_count": ball_2d_point_count,
        "ball_2d_visible_count": ball_2d_visible_count,
        "camera_count": len(cameras),
        "reconstruction_competition": reconstruction.get("competition"),
        "reconstruction_gender": reconstruction.get("gender"),
        "reconstruction_motion_count": reconstruction.get("motion_file_count", 0),
        "reconstruction_score_count": reconstruction.get("score_count", 0),
        "player_count": roster["player_count"],
        "warnings": warnings,
    }


# -----------------------------------------------------------------------------
# Upload-session API
# -----------------------------------------------------------------------------


# -----------------------------------------------------------------------------
# Dataset list and delete API
# -----------------------------------------------------------------------------


