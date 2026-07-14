from __future__ import annotations

import json
import math
import os
import re
import shutil
import tempfile
import uuid
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .db import get_db
from .models import Anomaly, Hit, Match, Rally


reconstruction_router = APIRouter()

DATASET_ASSET_ROOT = Path(
    os.getenv(
        "DATASET_ASSET_ROOT",
        "/app/data/datasets",
    )
)

RECONSTRUCTION_FILE_PATTERN = re.compile(
    r"^(?P<score>.+)_(?P<player>[01])\.(?P<extension>pth|npz)$",
    re.IGNORECASE,
)

VALID_GENDERS = {"male", "female", "neutral"}


def match_asset_dir(match_id: int) -> Path:
    return DATASET_ASSET_ROOT / f"match_{int(match_id)}"


def match_manifest_path(match_id: int) -> Path:
    return match_asset_dir(match_id) / "manifest.json"


def read_match_asset_manifest(match_id: int) -> dict | None:
    path = match_manifest_path(match_id)

    if not path.is_file():
        return None

    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None

    return value if isinstance(value, dict) else None


def remove_match_assets(match_id: int) -> bool:
    path = match_asset_dir(match_id)
    existed = path.exists()
    shutil.rmtree(path, ignore_errors=True)
    return existed


def _record_path(record: dict) -> Path:
    path = record.get("path")

    if isinstance(path, Path):
        return path

    return Path(str(path or ""))


def _record_relative_path(record: dict) -> str:
    return str(
        record.get(
            "relative_path",
            record.get("original_name", ""),
        )
    ).replace("\\", "/")


def _competition_from_record(record: dict) -> str:
    relative_path = _record_relative_path(record)
    parts = [
        part
        for part in PurePosixPath(relative_path).parts
        if part not in {"", ".", "..", "/"}
    ]

    lowered = [part.lower() for part in parts]

    if "new_racket" in lowered:
        index = lowered.index("new_racket")
        if index + 1 < len(parts) - 1:
            return parts[index + 1]

    if len(parts) >= 2:
        return parts[-2]

    return "__root__"


def _safe_gender(value: Any) -> str:
    text = str(value or "").strip().lower()
    return text if text in VALID_GENDERS else "neutral"


def _read_gender_csv(path: Path, result: dict[str, str]) -> None:
    try:
        frame = pd.read_csv(path)
    except Exception:
        return

    normalized_columns = {
        str(column).strip().lower(): column
        for column in frame.columns
    }

    competition_column = (
        normalized_columns.get("comp_name")
        or normalized_columns.get("competition")
        or normalized_columns.get("match")
    )
    gender_column = normalized_columns.get("gender")

    if competition_column is None or gender_column is None:
        return

    for _, row in frame.iterrows():
        competition = str(row.get(competition_column, "")).strip()
        if not competition:
            continue
        result[competition.lower()] = _safe_gender(row.get(gender_column))


def _load_gender_map(records: list[dict]) -> dict[str, str]:
    result: dict[str, str] = {}

    default_gender_csv = Path(
        os.getenv(
            "RECONSTRUCTION_GENDER_CSV",
            str(Path(__file__).with_name("reconstruction_gender.csv")),
        )
    )

    if default_gender_csv.is_file():
        _read_gender_csv(default_gender_csv, result)

    # 上傳的 gender.csv 優先於後端內建對照表。
    for record in records:
        if str(record.get("original_name", "")).lower() != "gender.csv":
            continue
        _read_gender_csv(_record_path(record), result)

    return result


def reconstruction_file_info(record: dict) -> dict | None:
    original_name = str(record.get("original_name", ""))
    match = RECONSTRUCTION_FILE_PATTERN.fullmatch(original_name)

    if match is None:
        return None

    return {
        "competition": _competition_from_record(record),
        "score": match.group("score"),
        "player_index": int(match.group("player")),
        "extension": match.group("extension").lower(),
        "record": record,
    }


def _candidate_map(records: list[dict]) -> dict[str, dict]:
    gender_map = _load_gender_map(records)
    candidates: dict[str, dict] = {}

    for record in records:
        info = reconstruction_file_info(record)
        if info is None:
            continue

        competition = info["competition"]
        candidate = candidates.setdefault(
            competition,
            {
                "competition": competition,
                "gender": gender_map.get(competition.lower(), "neutral"),
                "files": {},
                "scores": {},
            },
        )

        score = info["score"]
        player_index = info["player_index"]
        key = f"{score}_{player_index}"
        candidate["files"][key] = info
        candidate["scores"].setdefault(score, set()).add(player_index)

    return candidates


def _normalized_hint(value: str) -> str:
    return re.sub(r"[^0-9a-z]+", "", str(value or "").lower())


def _select_reconstruction_competition(
    candidates: dict[str, dict],
    rally_scores: set[str],
    explicit: str | None,
    title: str,
    *,
    strict: bool,
) -> str | None:
    if not candidates:
        return None

    if explicit:
        requested = str(explicit).strip()
        if requested in candidates:
            return requested

        lower_lookup = {
            key.lower(): key
            for key in candidates
        }
        found = lower_lookup.get(requested.lower())
        if found is not None:
            return found

        if strict:
            raise ValueError(
                "找不到選擇的人體與球拍比賽資料夾："
                f"{requested}"
            )

    if len(candidates) == 1:
        return next(iter(candidates))

    ranked = []
    title_hint = _normalized_hint(title)

    for competition, candidate in candidates.items():
        candidate_scores = set(candidate["scores"])
        overlap = len(candidate_scores & rally_scores)
        full_pairs = sum(
            1
            for score in rally_scores
            if candidate["scores"].get(score) == {0, 1}
        )
        competition_hint = _normalized_hint(competition)
        title_match = int(
            bool(competition_hint)
            and (
                competition_hint in title_hint
                or title_hint in competition_hint
            )
        )
        ranked.append(
            (
                overlap,
                full_pairs,
                title_match,
                competition,
            )
        )

    ranked.sort(reverse=True)
    best = ranked[0]
    tied = [
        item
        for item in ranked
        if item[:3] == best[:3]
    ]

    if len(tied) == 1 and best[0] > 0:
        return best[3]

    if strict:
        names = ", ".join(sorted(candidates))
        raise ValueError(
            "人體與球拍資料中有多個比賽資料夾，"
            "請在上傳視窗選擇正確的比賽代碼。"
            f"可選：{names}"
        )

    return None


def inspect_reconstruction_records(
    records: list[dict],
    rally_scores: set[str] | None = None,
    title: str = "",
) -> dict:
    rally_scores = set(rally_scores or set())
    candidates = _candidate_map(records)
    warnings: list[str] = []
    errors: list[str] = []
    items: list[dict] = []

    invalid_files = []
    gender_files = 0

    for record in records:
        name = str(record.get("original_name", ""))
        lower_name = name.lower()

        if lower_name == "gender.csv":
            gender_files += 1
            continue

        if reconstruction_file_info(record) is None:
            invalid_files.append(name)

    if invalid_files:
        errors.append(
            "以下人體重建檔名不符合 {Score}_{0或1}.pth/.npz："
            + ", ".join(invalid_files[:20])
        )

    for competition in sorted(candidates):
        candidate = candidates[competition]
        scores = candidate["scores"]
        missing_players = []

        for score in sorted(scores):
            players = scores[score]
            if players != {0, 1}:
                missing = sorted({0, 1} - set(players))
                missing_players.append(
                    f"{score} 缺少 player {','.join(map(str, missing))}"
                )

        candidate_scores = set(scores)
        matched_scores = candidate_scores & rally_scores
        extra_scores = candidate_scores - rally_scores if rally_scores else set()
        missing_rally_scores = rally_scores - candidate_scores if rally_scores else set()

        item_warnings = []

        if missing_players:
            item_warnings.append(
                f"有 {len(missing_players)} 個 Rally 缺少其中一位球員；"
                "仍會匯入存在的那一位"
            )

        if rally_scores and not matched_scores:
            item_warnings.append(
                "此資料夾的 Score 與目前 RallySeg.csv 沒有交集"
            )

        items.append(
            {
                "id": competition,
                "name": competition,
                "competition": competition,
                "gender": candidate["gender"],
                "file_count": len(candidate["files"]),
                "score_count": len(candidate_scores),
                "paired_count": sum(
                    1
                    for players in scores.values()
                    if players == {0, 1}
                ),
                "unpaired_count": len(missing_players),
                "matched_score_count": len(matched_scores),
                "missing_rally_score_count": len(missing_rally_scores),
                "extra_score_count": len(extra_scores),
                "valid": True,
                "errors": [],
                "warnings": item_warnings,
            }
        )

        warnings.extend(
            f"{competition}: {message}"
            for message in item_warnings
        )

    recommended = _select_reconstruction_competition(
        candidates,
        rally_scores,
        explicit=None,
        title=title,
        strict=False,
    )

    if records and not candidates and not errors:
        warnings.append(
            "沒有找到 {Score}_0.pth 與 {Score}_1.pth 人體重建檔案"
        )

    return {
        "file_count": len(records),
        "motion_file_count": sum(
            len(candidate["files"])
            for candidate in candidates.values()
        ),
        "gender_file_count": gender_files,
        "competition_count": len(candidates),
        "recommended_competition": recommended,
        "requires_competition_selection": (
            len(candidates) > 1 and recommended is None
        ),
        "valid": not errors,
        "items": items,
        "errors": errors,
        "warnings": warnings,
    }


def _import_torch():
    try:
        import torch
    except Exception as exc:
        raise RuntimeError(
            "後端尚未安裝 PyTorch，無法讀取 .pth。"
            "請確認 backend/requirements.txt 已加入 torch，"
            "並重新執行 docker compose up --build。"
        ) from exc

    return torch


def _to_numpy(value: Any, name: str) -> np.ndarray:
    if hasattr(value, "detach") and hasattr(value, "cpu"):
        value = value.detach().cpu().numpy()

    try:
        return np.asarray(value)
    except Exception as exc:
        raise ValueError(f"{name} 無法轉成 NumPy 陣列") from exc


def _read_motion_source(path: Path) -> dict[str, Any]:
    if path.suffix.lower() == ".pth":
        torch = _import_torch()
        try:
            value = torch.load(
                path,
                map_location="cpu",
                weights_only=True,
            )
        except TypeError:
            value = torch.load(
                path,
                map_location="cpu",
            )
        except Exception as exc:
            raise ValueError(f"{path.name} 無法讀取：{exc}") from exc

        if not isinstance(value, dict):
            raise ValueError(f"{path.name} 內容必須是 dict")

        return value

    if path.suffix.lower() == ".npz":
        try:
            with np.load(path, allow_pickle=False) as data:
                return {
                    name: data[name]
                    for name in data.files
                }
        except Exception as exc:
            raise ValueError(f"{path.name} 無法讀取：{exc}") from exc

    raise ValueError(f"不支援的重建檔案：{path.name}")


def _first_value(source: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in source:
            return source[name]
    return None


def normalize_motion_source(path: Path) -> dict[str, np.ndarray]:
    source = _read_motion_source(path)

    body_pose_raw = _first_value(
        source,
        "body_pose",
        "data/body_pose",
    )
    beta_raw = _first_value(
        source,
        "beta",
        "betas",
        "data/beta",
        "data/betas",
    )
    trans_raw = _first_value(
        source,
        "trans",
        "transl",
        "data/trans",
        "data/transl",
    )

    if body_pose_raw is None:
        raise ValueError(f"{path.name} 缺少 body_pose")
    if beta_raw is None:
        raise ValueError(f"{path.name} 缺少 beta")
    if trans_raw is None:
        raise ValueError(f"{path.name} 缺少 trans")

    body_pose_raw = _to_numpy(body_pose_raw, "body_pose").astype(
        np.float32,
        copy=False,
    )
    beta = _to_numpy(beta_raw, "beta").astype(
        np.float32,
        copy=False,
    )
    trans = _to_numpy(trans_raw, "trans").astype(
        np.float32,
        copy=False,
    )

    if body_pose_raw.ndim == 2 and body_pose_raw.shape[1] == 72:
        global_orient = body_pose_raw[:, :3]
        body_pose = body_pose_raw[:, 3:]
    elif body_pose_raw.ndim == 2 and body_pose_raw.shape[1] == 69:
        global_raw = _first_value(
            source,
            "global_orient",
            "data/global_orient",
        )
        if global_raw is None:
            global_orient = np.zeros(
                (len(body_pose_raw), 3),
                dtype=np.float32,
            )
        else:
            global_orient = _to_numpy(
                global_raw,
                "global_orient",
            ).astype(np.float32, copy=False)
        body_pose = body_pose_raw
    elif body_pose_raw.ndim == 3 and body_pose_raw.shape[1:] == (23, 3):
        global_raw = _first_value(
            source,
            "global_orient",
            "data/global_orient",
        )
        if global_raw is None:
            global_orient = np.zeros(
                (len(body_pose_raw), 3),
                dtype=np.float32,
            )
        else:
            global_orient = _to_numpy(
                global_raw,
                "global_orient",
            ).astype(np.float32, copy=False)
        body_pose = body_pose_raw.reshape(len(body_pose_raw), 69)
    else:
        raise ValueError(
            f"{path.name} body_pose 必須是 [T,72]、[T,69] 或 [T,23,3]，"
            f"目前為 {list(body_pose_raw.shape)}"
        )

    frame_count = len(body_pose)

    if trans.ndim != 2 or trans.shape != (frame_count, 3):
        raise ValueError(
            f"{path.name} trans 必須是 [T,3]，"
            f"目前為 {list(trans.shape)}"
        )

    if global_orient.ndim != 2 or global_orient.shape != (frame_count, 3):
        raise ValueError(
            f"{path.name} global_orient 必須是 [T,3]"
        )

    if beta.ndim == 1:
        beta = beta[None, :]

    if beta.ndim != 2 or beta.shape[1] < 10:
        raise ValueError(
            f"{path.name} beta 必須是 [10]、[1,10] 或 [T,10]"
        )

    beta = beta[:, :10]

    if beta.shape[0] not in {1, frame_count}:
        raise ValueError(
            f"{path.name} beta 第一維必須是 1 或 T"
        )

    mask_raw = _first_value(
        source,
        "mask",
        "data/mask",
    )

    if mask_raw is None:
        mask = np.ones((frame_count,), dtype=np.uint8)
    else:
        mask_array = _to_numpy(mask_raw, "mask").reshape(-1)
        if len(mask_array) != frame_count:
            raise ValueError(
                f"{path.name} mask 長度必須是 T，"
                f"目前為 {len(mask_array)}，T={frame_count}"
            )
        # 實際資料同時存在 -1、0、1；只有大於 0 的 frame 視為有效。
        mask = (mask_array > 0).astype(np.uint8)

    racket_pose_raw = _first_value(
        source,
        "racket_pose",
        "data/racket_pose",
    )
    racket_pose = None

    if racket_pose_raw is not None:
        racket_pose = _to_numpy(
            racket_pose_raw,
            "racket_pose",
        ).astype(np.float32, copy=False)
        if racket_pose.ndim != 2 or racket_pose.shape != (frame_count, 3):
            raise ValueError(
                f"{path.name} racket_pose 必須是 [T,3]，"
                f"目前為 {list(racket_pose.shape)}"
            )

    racket_transform_raw = _first_value(
        source,
        "racket_transform",
        "data/racket_transform",
    )
    racket_transform = None

    if racket_transform_raw is not None:
        racket_transform = _to_numpy(
            racket_transform_raw,
            "racket_transform",
        ).astype(np.float32, copy=False)
        if racket_transform.shape != (frame_count, 4, 4):
            raise ValueError(
                f"{path.name} racket_transform 必須是 [T,4,4]"
            )

    racket_frame_offset_raw = _first_value(
        source,
        "racket_frame_offset",
        "data/racket_frame_offset",
    )
    racket_frame_offset = None

    if racket_frame_offset_raw is not None:
        racket_frame_offset = _to_numpy(
            racket_frame_offset_raw,
            "racket_frame_offset",
        ).astype(np.float32, copy=False)
        if racket_frame_offset.shape != (frame_count, 3):
            raise ValueError(
                f"{path.name} racket_frame_offset 必須是 [T,3]"
            )

    for name, array in (
        ("global_orient", global_orient),
        ("body_pose", body_pose),
        ("beta", beta),
        ("trans", trans),
    ):
        if not np.isfinite(array).all():
            raise ValueError(f"{path.name} 的 {name} 包含 NaN 或 Infinity")

    result = {
        "global_orient": np.ascontiguousarray(global_orient, dtype=np.float32),
        "body_pose": np.ascontiguousarray(body_pose, dtype=np.float32),
        "beta": np.ascontiguousarray(beta, dtype=np.float32),
        "trans": np.ascontiguousarray(trans, dtype=np.float32),
        "mask": np.ascontiguousarray(mask, dtype=np.uint8),
    }

    if racket_pose is not None:
        result["racket_pose"] = np.ascontiguousarray(
            racket_pose,
            dtype=np.float32,
        )
    if racket_transform is not None:
        result["racket_transform"] = np.ascontiguousarray(
            racket_transform,
            dtype=np.float32,
        )
    if racket_frame_offset is not None:
        result["racket_frame_offset"] = np.ascontiguousarray(
            racket_frame_offset,
            dtype=np.float32,
        )

    return result


def _write_motion_npz(source_path: Path, destination: Path) -> dict:
    motion = normalize_motion_source(source_path)
    payload: dict[str, Any] = dict(motion)
    payload["__metadata_json__"] = np.asarray(
        json.dumps(
            {
                "source_name": source_path.name,
                "format": "badminton-smpl-motion-v1",
                "frame_count": int(len(motion["trans"])),
                "mask_rule": "valid when original mask > 0",
                "has_racket_pose": "racket_pose" in motion,
            },
            ensure_ascii=False,
        )
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(destination, **payload)

    return {
        "frame_count": int(len(motion["trans"])),
        "valid_frame_count": int(np.count_nonzero(motion["mask"])),
        "has_racket_pose": "racket_pose" in motion,
    }


def import_reconstruction_assets(
    *,
    match_id: int,
    title: str,
    records: list[dict],
    settings: dict,
    rallies: list[dict],
) -> dict:
    rally_scores = {
        str(item.get("score", "")).strip()
        for item in rallies
        if str(item.get("score", "")).strip()
    }
    candidates = _candidate_map(records)
    selected = _select_reconstruction_competition(
        candidates,
        rally_scores,
        explicit=settings.get("reconstructionCompetition"),
        title=title,
        strict=bool(candidates),
    )

    final_dir = match_asset_dir(match_id)
    DATASET_ASSET_ROOT.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(
        tempfile.mkdtemp(
            prefix=f"match_{match_id}_",
            dir=DATASET_ASSET_ROOT,
        )
    )

    warnings: list[str] = []
    motion_count = 0
    score_count = 0
    gender = "neutral"
    selected_candidate = candidates.get(selected) if selected else None

    if selected_candidate is not None:
        gender = _safe_gender(selected_candidate.get("gender"))

    rally_manifest: dict[str, dict] = {}

    try:
        selected_scores = (
            selected_candidate["scores"]
            if selected_candidate is not None
            else {}
        )

        for rally in rallies:
            rally_id = int(rally["rally_id"])
            score = str(rally.get("score", "")).strip()
            players: dict[str, dict] = {}

            if selected_candidate is not None and score:
                for player_index in (0, 1):
                    key = f"{score}_{player_index}"
                    info = selected_candidate["files"].get(key)
                    if info is None:
                        continue

                    source_path = _record_path(info["record"])
                    relative_output = f"smpl/{score}_{player_index}.npz"
                    destination = temp_dir / relative_output
                    summary = _write_motion_npz(source_path, destination)
                    players[str(player_index)] = {
                        "path": relative_output,
                        "source_name": source_path.name,
                        **summary,
                    }
                    motion_count += 1

            if selected_candidate is not None and score and score not in selected_scores:
                warnings.append(
                    f"{score}: 人體與球拍資料中沒有對應檔案"
                )

            if selected_candidate is not None and score:
                existing_players = set(selected_scores.get(score, set()))
                missing_players = {0, 1} - existing_players
                if missing_players and existing_players:
                    warnings.append(
                        f"{score}: 缺少 player "
                        + ",".join(map(str, sorted(missing_players)))
                    )

            if players:
                score_count += 1

            rally_manifest[str(rally_id)] = {
                "rally_id": rally_id,
                "rally_index": int(rally["rally_index"]),
                "score": score,
                "start_frame": int(rally["start_frame"]),
                "end_frame": int(rally["end_frame"]),
                "up_court": str(rally.get("up_court", "") or ""),
                "down_court": str(rally.get("down_court", "") or ""),
                "players": players,
            }

        manifest = {
            "version": 1,
            "match_id": int(match_id),
            "title": title,
            "reconstruction": {
                "competition": selected,
                "gender": gender,
                "motion_file_count": motion_count,
                "score_count": score_count,
            },
            "rallies": rally_manifest,
        }

        (temp_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        if final_dir.exists():
            shutil.rmtree(final_dir)
        os.replace(temp_dir, final_dir)

    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise

    return {
        "competition": selected,
        "gender": gender,
        "motion_file_count": motion_count,
        "score_count": score_count,
        "warnings": warnings,
    }


def reconstruction_summary(match_id: int) -> dict:
    manifest = read_match_asset_manifest(match_id)

    if not manifest:
        return {
            "competition": None,
            "gender": None,
            "motion_file_count": 0,
            "score_count": 0,
        }

    value = manifest.get("reconstruction")
    return value if isinstance(value, dict) else {}


def _smpl_forward_model(gender: str) -> dict:
    gender = _safe_gender(gender)
    prefix = f"SMPL_FORWARD_{gender.upper()}"

    shared_url = os.getenv(
        f"{prefix}_SHARED_URL",
        os.getenv(
            "SMPL_FORWARD_SHARED_URL",
            "/models/smpl/forward/shared.json",
        ),
    )
    player_url = os.getenv(
        f"{prefix}_PLAYER_URL",
        os.getenv(
            "SMPL_FORWARD_PLAYER_URL",
            "/models/smpl/forward/players/neutral.json",
        ),
    )

    return {
        "shared_url": shared_url,
        "player_url": player_url,
        "gender": gender,
    }


def _npz_array(data: Any, *names: str):
    for name in names:
        if name in data.files:
            return data[name]
    raise KeyError(f"missing arrays: {' or '.join(names)}")


def _load_motion_window(
    path: Path,
    *,
    player_id: str,
    player_index: int,
    court: str,
    name: str | None,
    rally_start_frame: int,
    request_start_frame: int,
    request_end_frame: int,
    fps: float,
    gender: str,
    source_path: str,
) -> dict | None:
    if not path.is_file():
        return None

    try:
        with np.load(path, allow_pickle=False) as data:
            body_pose_raw = _npz_array(
                data,
                "body_pose",
                "data/body_pose",
            ).astype(np.float32)
            trans = _npz_array(
                data,
                "trans",
                "transl",
                "data/trans",
                "data/transl",
            ).astype(np.float32)
            beta = _npz_array(
                data,
                "beta",
                "betas",
                "data/beta",
                "data/betas",
            ).astype(np.float32)
            mask = (
                data["mask"]
                if "mask" in data.files
                else data["data/mask"]
                if "data/mask" in data.files
                else None
            )
            global_orient_raw = (
                data["global_orient"]
                if "global_orient" in data.files
                else data["data/global_orient"]
                if "data/global_orient" in data.files
                else None
            )
            racket_pose = (
                data["racket_pose"]
                if "racket_pose" in data.files
                else data["data/racket_pose"]
                if "data/racket_pose" in data.files
                else None
            )
            racket_transform = (
                data["racket_transform"]
                if "racket_transform" in data.files
                else data["data/racket_transform"]
                if "data/racket_transform" in data.files
                else None
            )
            racket_frame_offset = (
                data["racket_frame_offset"]
                if "racket_frame_offset" in data.files
                else data["data/racket_frame_offset"]
                if "data/racket_frame_offset" in data.files
                else None
            )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"failed to load {path.name}: {exc}",
        ) from exc

    body_pose_raw = np.asarray(body_pose_raw, dtype=np.float32)

    if trans.ndim != 2 or trans.shape[1] != 3:
        raise HTTPException(
            status_code=500,
            detail=f"{path.name} trans must be [N,3]",
        )

    frame_count = int(trans.shape[0])

    if body_pose_raw.ndim == 2 and body_pose_raw.shape[1] == 72:
        global_orient = body_pose_raw[:, :3]
        body_pose = body_pose_raw[:, 3:].reshape(frame_count, 23, 3)
    elif body_pose_raw.ndim == 2 and body_pose_raw.shape[1] == 69:
        global_orient = (
            np.zeros((frame_count, 3), dtype=np.float32)
            if global_orient_raw is None
            else np.asarray(global_orient_raw, dtype=np.float32)
        )
        body_pose = body_pose_raw.reshape(frame_count, 23, 3)
    elif body_pose_raw.ndim == 3 and body_pose_raw.shape[1:] == (23, 3):
        global_orient = (
            np.zeros((frame_count, 3), dtype=np.float32)
            if global_orient_raw is None
            else np.asarray(global_orient_raw, dtype=np.float32)
        )
        body_pose = body_pose_raw
    else:
        raise HTTPException(
            status_code=500,
            detail=(
                f"{path.name} body_pose must be "
                "[N,72], [N,69], or [N,23,3]"
            ),
        )

    if len(body_pose) != frame_count:
        raise HTTPException(
            status_code=500,
            detail=f"{path.name} body_pose/trans frame counts differ",
        )

    if beta.ndim == 1:
        beta = beta[None, :]
    if beta.ndim != 2 or beta.shape[1] < 10:
        raise HTTPException(
            status_code=500,
            detail=f"{path.name} beta must be [10] or [N,10]",
        )
    beta = beta[:, :10]

    if mask is None:
        mask_array = np.ones((frame_count,), dtype=bool)
    else:
        mask_array = np.asarray(mask).reshape(-1) > 0
        if len(mask_array) != frame_count:
            raise HTTPException(
                status_code=500,
                detail=f"{path.name} mask must have N elements",
            )

    if racket_pose is not None:
        racket_pose = np.asarray(racket_pose, dtype=np.float32)
        if racket_pose.shape != (frame_count, 3):
            raise HTTPException(
                status_code=500,
                detail=f"{path.name} racket_pose must be [N,3]",
            )

    if racket_transform is not None:
        racket_transform = np.asarray(racket_transform, dtype=np.float32)
        if racket_transform.shape != (frame_count, 4, 4):
            raise HTTPException(
                status_code=500,
                detail=f"{path.name} racket_transform must be [N,4,4]",
            )

    if racket_frame_offset is not None:
        racket_frame_offset = np.asarray(
            racket_frame_offset,
            dtype=np.float32,
        )
        if racket_frame_offset.shape != (frame_count, 3):
            raise HTTPException(
                status_code=500,
                detail=f"{path.name} racket_frame_offset must be [N,3]",
            )

    local_start = max(0, request_start_frame - rally_start_frame)
    local_end = min(frame_count - 1, request_end_frame - rally_start_frame)

    if local_start > local_end:
        return None

    frames = []

    for index in range(local_start, local_end + 1):
        frame = rally_start_frame + index
        frames.append(
            {
                "frame": frame,
                "local_frame": index,
                "t_sec": frame / fps if fps > 0 else 0.0,
                "valid": bool(mask_array[index]),
                "global_orient": global_orient[index].astype(float).tolist(),
                "body_pose": body_pose[index].astype(float).tolist(),
                "trans": trans[index].astype(float).tolist(),
                "racket_pose": (
                    racket_pose[index].astype(float).tolist()
                    if racket_pose is not None
                    else None
                ),
                "racket_transform": (
                    racket_transform[index].astype(float).tolist()
                    if racket_transform is not None
                    else None
                ),
                "racket_frame_offset": (
                    racket_frame_offset[index].astype(float).tolist()
                    if racket_frame_offset is not None
                    else None
                ),
            }
        )

    return {
        "id": player_id,
        "player_index": player_index,
        "court": court,
        "name": name,
        "start_frame": rally_start_frame,
        "frame_count": frame_count,
        "fps": fps,
        "beta": beta[0].astype(float).tolist(),
        "source_path": source_path,
        "smpl_forward_model": _smpl_forward_model(gender),
        "frames": frames,
    }


def _manifest_rallies(manifest: dict | None) -> dict[str, dict]:
    if not manifest:
        return {}
    rallies = manifest.get("rallies")
    return rallies if isinstance(rallies, dict) else {}


@reconstruction_router.get("/matches/{match_id}/dataset-timeline")
def get_dataset_timeline(
    match_id: int,
    db: Session = Depends(get_db),
):
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="match not found")

    manifest = read_match_asset_manifest(match_id)
    metadata = _manifest_rallies(manifest)
    gender = _safe_gender(
        (manifest or {}).get("reconstruction", {}).get("gender")
        if isinstance((manifest or {}).get("reconstruction"), dict)
        else "neutral"
    )

    rallies = (
        db.query(Rally)
        .filter(Rally.match_id == match_id)
        .order_by(Rally.rally_index)
        .all()
    )
    hits = (
        db.query(Hit)
        .filter(Hit.match_id == match_id)
        .order_by(Hit.rally_id, Hit.ball_round)
        .all()
    )
    anomalies = (
        db.query(Anomaly)
        .filter(Anomaly.match_id == match_id)
        .order_by(Anomaly.start_frame)
        .all()
    )

    rally_values = []

    for rally in rallies:
        item = metadata.get(str(rally.id), {})
        players = item.get("players") if isinstance(item.get("players"), dict) else {}
        rally_values.append(
            {
                "id": rally.id,
                "rally_index": rally.rally_index,
                "start_frame": rally.start_frame,
                "end_frame": rally.end_frame,
                "status": rally.status,
                "score": item.get("score"),
                "up_court": item.get("up_court"),
                "down_court": item.get("down_court"),
                "players": [
                    {
                        "court": "up",
                        "player_index": 0,
                        "name": item.get("up_court"),
                        "available": "0" in players,
                        "smpl_forward_model": _smpl_forward_model(gender),
                    },
                    {
                        "court": "down",
                        "player_index": 1,
                        "name": item.get("down_court"),
                        "available": "1" in players,
                        "smpl_forward_model": _smpl_forward_model(gender),
                    },
                ],
            }
        )

    return {
        "rallies": rally_values,
        "hits": [
            {
                "id": hit.id,
                "rally_id": hit.rally_id,
                "ball_round": hit.ball_round,
                "player": hit.player,
                "hit_frame": hit.hit_frame,
                "new_hit_frame": hit.new_hit_frame,
                "shot_type": hit.shot_type,
                "hand": hit.hand,
                "note": hit.note,
                "confidence": hit.confidence,
            }
            for hit in hits
        ],
        "anomalies": [
            {
                "id": anomaly.id,
                "start_frame": anomaly.start_frame,
                "end_frame": anomaly.end_frame,
                "kind": anomaly.kind,
                "severity": anomaly.severity,
                "status": anomaly.status,
                "comment": anomaly.comment,
            }
            for anomaly in anomalies
        ],
    }


@reconstruction_router.get("/matches/{match_id}/dataset-smpl-replay")
def get_dataset_smpl_replay(
    match_id: int,
    start: int,
    end: int,
    db: Session = Depends(get_db),
):
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="match not found")

    manifest = read_match_asset_manifest(match_id)
    if manifest is None:
        raise HTTPException(
            status_code=404,
            detail="this match has no uploaded reconstruction manifest",
        )

    metadata = _manifest_rallies(manifest)
    matching = [
        item
        for item in metadata.values()
        if int(item.get("start_frame", 0)) <= end
        and int(item.get("end_frame", 0)) >= start
    ]

    if not matching:
        raise HTTPException(
            status_code=404,
            detail="rally not found for requested range",
        )

    matching.sort(key=lambda item: int(item.get("start_frame", 0)))
    rally = matching[0]
    players_data = rally.get("players")
    players_data = players_data if isinstance(players_data, dict) else {}
    reconstruction = manifest.get("reconstruction")
    reconstruction = reconstruction if isinstance(reconstruction, dict) else {}
    gender = _safe_gender(reconstruction.get("gender"))
    players = []
    checked_paths = []

    player_specs = [
        (0, "up", rally.get("up_court")),
        (1, "down", rally.get("down_court")),
    ]

    for player_index, court, player_name in player_specs:
        player_info = players_data.get(str(player_index))
        if not isinstance(player_info, dict):
            continue

        relative_path = str(player_info.get("path", ""))
        path = (match_asset_dir(match_id) / relative_path).resolve()

        try:
            path.relative_to(match_asset_dir(match_id).resolve())
        except ValueError:
            continue

        checked_paths.append(relative_path)
        player = _load_motion_window(
            path,
            player_id=f"player_{player_index}",
            player_index=player_index,
            court=court,
            name=player_name,
            rally_start_frame=int(rally.get("start_frame", 0)),
            request_start_frame=start,
            request_end_frame=end,
            fps=float(match.fps),
            gender=gender,
            source_path=relative_path,
        )

        if player:
            players.append(player)

    if not players:
        raise HTTPException(
            status_code=404,
            detail={
                "message": "SMPL replay pose chunks not found",
                "score": rally.get("score"),
                "checked_paths": checked_paths,
            },
        )

    return {
        "match_id": match_id,
        "rally_id": rally.get("rally_id"),
        "rally_index": rally.get("rally_index"),
        "score": rally.get("score"),
        "start_frame": rally.get("start_frame"),
        "end_frame": rally.get("end_frame"),
        "fps": match.fps,
        "competition": reconstruction.get("competition"),
        "gender": gender,
        "players": players,
    }
