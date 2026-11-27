"""上傳檔案的欄位轉型、數值檢查及暫存路徑保護。"""

import math
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import HTTPException


def safe_int(value: Any, default: int | None = None) -> int | None:
    try:
        if value is None or pd.isna(value):
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def safe_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        if pd.isna(value):
            return default
    except (TypeError, ValueError):
        pass
    return str(value).strip()


def safe_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"true", "1", "yes", "on"}:
        return True
    if text in {"false", "0", "no", "off"}:
        return False
    return default


def positive_float(value: Any, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} 必須是數字") from exc
    if not math.isfinite(number) or number <= 0:
        raise ValueError(f"{name} 必須大於 0")
    return number


def positive_int(value: Any, name: str) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} 必須是整數") from exc
    if number <= 0:
        raise ValueError(f"{name} 必須大於 0")
    return number


def record_file_path(base: Path, record: dict) -> Path:
    # 不能讓上傳紀錄中的相對路徑跳出暫存資料夾。
    path = (base / str(record.get("stored_path", ""))).resolve()
    try:
        path.relative_to(base.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="暫存檔案路徑無效") from exc
    return path
