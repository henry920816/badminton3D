"""相機內外參讀取與檢查。

相機檔案格式統一由這裡處理，避免上傳 API 和匯入流程各自解析一遍。
"""

import math
import re
from pathlib import Path

import numpy as np

from .dataset_helpers import (
    record_file_path, safe_int, safe_float, safe_str, safe_bool,
    positive_float, positive_int,
)

CAMERA_PATTERN = re.compile(
    r"^(?:cam(?:era)?[_-]?)?(\d+)[_-](intrinsic|extrinsic)\.npy$",
    re.IGNORECASE,
)


DEFAULT_COURT_TRANSFORM = {
    "xOffset": 0.0,
    "zOffset": 0.0,
    "rotateDeg": 0.0,
    "xScale": 1.0,
    "zScale": 1.0,
    "yOffset": 0.0,
}


ALLOWED_COORDINATE_MODES = {
    "raw",
    "scene",
    "flipX",
    "flipY",
    "flipZ",
    "flipXFlipZ",
    "flipXFlipYFlipZ",
}



def camera_record_map(
    base: Path,
    manifest: dict,
) -> dict[int, dict[str, dict]]:
    result: dict[
        int,
        dict[str, dict],
    ] = {}

    for record in manifest[
        "categories"
    ]["cameras"]:
        filename = str(
            record.get("original_name", "")
        )

        match = CAMERA_PATTERN.fullmatch(
            filename
        )

        if not match:
            continue

        index = int(
            match.group(1)
        )

        kind = match.group(2).lower()

        result.setdefault(
            index,
            {},
        )[kind] = {
            **record,
            "path": record_file_path(
                base,
                record,
            ),
        }

    return result


def load_intrinsic(
    path: Path,
    camera_id: str,
) -> np.ndarray:
    try:
        raw = np.load(
            path,
            allow_pickle=False,
        )

    except Exception as exc:
        raise ValueError(
            f"{camera_id} intrinsic 無法載入：{exc}"
        ) from exc

    if not np.issubdtype(
        raw.dtype,
        np.number,
    ):
        raise ValueError(
            f"{camera_id} intrinsic 必須是數字陣列"
        )

    raw64 = np.asarray(raw, dtype=np.float64)
    if raw64.shape == (3, 3):
        # A classic intrinsic matrix K differs from the repository's
        # nine-parameter [fx,fy,cx,cy,k1,k2,p1,p2,k3] encoding.
        if (not np.isfinite(raw64).all()
                or not np.allclose(raw64[2], [0, 0, 1], atol=1e-6)
                or abs(raw64[0, 1]) > 1e-6
                or abs(raw64[1, 0]) > 1e-6):
            raise ValueError(f"{camera_id} 3x3 K 不符合零 skew 的標準內參格式")
        value = np.array([
            raw64[0, 0], raw64[1, 1], raw64[0, 2], raw64[1, 2],
            0.0, 0.0, 0.0, 0.0, 0.0,
        ], dtype=np.float64)
    elif raw64.ndim == 1 and raw64.size == 9:
        value = raw64
    else:
        raise ValueError(f"{camera_id} intrinsic 必須為 9-vector 或 3x3 K，實際 shape {list(raw.shape)}")

    if not np.isfinite(value).all() or value[0] <= 0 or value[1] <= 0:
        raise ValueError(f"{camera_id} intrinsic 焦距無效")
    return value


def load_extrinsic(
    path: Path,
    camera_id: str,
) -> np.ndarray:
    try:
        raw = np.load(
            path,
            allow_pickle=False,
        )

    except Exception as exc:
        raise ValueError(
            f"{camera_id} extrinsic 無法載入：{exc}"
        ) from exc

    if not np.issubdtype(
        raw.dtype,
        np.number,
    ):
        raise ValueError(
            f"{camera_id} extrinsic 必須是數字陣列"
        )

    value = np.asarray(
        raw,
        dtype=np.float64,
    )

    if value.shape != (3, 4):
        raise ValueError(
            f"{camera_id} extrinsic shape 必須是 (3, 4)，"
            f"目前為 {list(raw.shape)}"
        )

    if not np.isfinite(value).all():
        raise ValueError(
            f"{camera_id} extrinsic 包含 NaN 或 Infinity"
        )

    return value


def inspect_cameras(
    base: Path,
    manifest: dict,
) -> dict:
    records = manifest[
        "categories"
    ]["cameras"]

    errors: list[str] = []
    warnings: list[str] = []
    cameras: list[dict] = []

    invalid_names = []

    for record in records:
        filename = str(
            record.get("original_name", "")
        )

        if not CAMERA_PATTERN.fullmatch(filename):
            invalid_names.append(filename)

    if invalid_names:
        errors.append(
            "以下相機檔名無法辨識："
            + ", ".join(invalid_names[:10])
        )

    files = camera_record_map(
        base,
        manifest,
    )

    if not files:
        errors.append(
            "尚未上傳相機參數。"
            "請選擇 Cam_0_intrinsic.npy、"
            "Cam_0_extrinsic.npy 等檔案"
        )

    for index in sorted(files):
        pair = files[index]
        camera_id = f"cam{index}"
        item_errors: list[str] = []
        intrinsic_shape = None
        extrinsic_shape = None

        intrinsic_record = pair.get(
            "intrinsic"
        )
        extrinsic_record = pair.get(
            "extrinsic"
        )

        if intrinsic_record is None:
            item_errors.append(
                f"缺少 Cam_{index}_intrinsic.npy"
            )

        else:
            try:
                raw = np.load(
                    intrinsic_record["path"],
                    allow_pickle=False,
                )
                intrinsic_shape = list(raw.shape)
                load_intrinsic(
                    intrinsic_record["path"],
                    camera_id,
                )

            except Exception as exc:
                item_errors.append(str(exc))

        if extrinsic_record is None:
            item_errors.append(
                f"缺少 Cam_{index}_extrinsic.npy"
            )

        else:
            try:
                raw = np.load(
                    extrinsic_record["path"],
                    allow_pickle=False,
                )
                extrinsic_shape = list(raw.shape)
                load_extrinsic(
                    extrinsic_record["path"],
                    camera_id,
                )

            except Exception as exc:
                item_errors.append(str(exc))

        cameras.append(
            {
                "id": camera_id,
                "index": index,
                "valid": not item_errors,
                "intrinsic_shape": intrinsic_shape,
                "extrinsic_shape": extrinsic_shape,
                "errors": item_errors,
            }
        )

        errors.extend(item_errors)

    indices = [
        camera["index"]
        for camera in cameras
    ]

    if indices:
        missing_indices = [
            index
            for index in range(
                min(indices),
                max(indices) + 1,
            )
            if index not in indices
        ]

        if missing_indices:
            errors.append(
                "相機編號不連續，缺少："
                + ", ".join(
                    f"Cam {index}"
                    for index in missing_indices
                )
            )

        if min(indices) != 0:
            warnings.append(
                "相機編號不是從 Cam 0 開始"
            )

    return {
        "file_count": len(records),
        "camera_count": len(cameras),
        "valid": not errors,
        "items": cameras,
        "errors": errors,
        "warnings": warnings,
    }


def camera_pose(
    extrinsic: list[list[float]],
    distance: float = 4.0,
) -> dict:
    rotation = np.asarray(
        [
            row[:3]
            for row in extrinsic
        ],
        dtype=np.float64,
    )

    translation = np.asarray(
        [
            row[3]
            for row in extrinsic
        ],
        dtype=np.float64,
    )

    center = -(
        rotation.T
        @ translation
    )

    forward = (
        rotation.T
        @ np.asarray(
            [
                0.0,
                0.0,
                1.0,
            ]
        )
    )

    target = center + forward * distance

    return {
        "position": [
            float(center[0]),
            float(-center[1]),
            float(-center[2]),
        ],
        "target": [
            float(target[0]),
            float(-target[1]),
            float(-target[2]),
        ],
    }


def court_transform(
    settings: dict,
) -> dict:
    raw = (
        settings.get(
            "courtWorldTransform"
        )
        or {}
    )

    if not isinstance(raw, dict):
        raise ValueError(
            "球場座標設定格式錯誤"
        )

    result: dict[str, float] = {}

    for key, default in DEFAULT_COURT_TRANSFORM.items():
        try:
            value = float(
                raw.get(
                    key,
                    default,
                )
            )

        except (
            TypeError,
            ValueError,
        ) as exc:
            raise ValueError(
                f"球場設定 {key} 必須是數字"
            ) from exc

        if not math.isfinite(value):
            raise ValueError(
                f"球場設定 {key} 必須是有效數字"
            )

        result[key] = value

    return result


def camera_setting(
    settings: dict,
    index: int,
) -> dict:
    all_settings = (
        settings.get(
            "cameraSettings"
        )
        or {}
    )

    if not isinstance(
        all_settings,
        dict,
    ):
        raise ValueError(
            "各相機設定格式錯誤"
        )

    for key in (
        f"cam{index}",
        f"Cam_{index}",
        f"cam_{index}",
        str(index),
    ):
        value = all_settings.get(key)

        if value is None:
            continue

        if not isinstance(
            value,
            dict,
        ):
            raise ValueError(
                f"Cam {index} 設定格式錯誤"
            )

        return value

    return {}


def load_cameras(
    base: Path,
    manifest: dict,
    settings: dict,
    fps: float,
) -> list[dict]:
    files = camera_record_map(
        base,
        manifest,
    )

    if not files:
        raise ValueError(
            "尚未上傳相機參數"
        )

    width = positive_int(
        settings.get(
            "imageWidth",
            1920,
        ),
        "影片寬度",
    )

    height = positive_int(
        settings.get(
            "imageHeight",
            1200,
        ),
        "影片高度",
    )

    mode = safe_str(
        settings.get(
            "coordinateMode"
        ),
        "raw",
    )

    if mode not in ALLOWED_COORDINATE_MODES:
        raise ValueError(
            "座標模式無效"
        )

    distortion = safe_bool(
        settings.get(
            "useLensDistortion"
        ),
        True,
    )

    transform = court_transform(settings)
    result: list[dict] = []

    for index in sorted(files):
        pair = files[index]

        if "intrinsic" not in pair:
            raise ValueError(
                f"缺少 Cam_{index}_intrinsic.npy"
            )

        if "extrinsic" not in pair:
            raise ValueError(
                f"缺少 Cam_{index}_extrinsic.npy"
            )

        intrinsic = load_intrinsic(
            pair["intrinsic"]["path"],
            f"cam{index}",
        ).tolist()

        extrinsic = load_extrinsic(
            pair["extrinsic"]["path"],
            f"cam{index}",
        ).tolist()

        current = camera_setting(
            settings,
            index,
        )

        camera_width = positive_int(
            current.get(
                "imageWidth",
                width,
            ),
            f"Cam {index} 影片寬度",
        )

        camera_height = positive_int(
            current.get(
                "imageHeight",
                height,
            ),
            f"Cam {index} 影片高度",
        )

        camera_fps = positive_float(
            current.get(
                "fps",
                fps,
            ),
            f"Cam {index} FPS",
        )

        pose = camera_pose(extrinsic)

        result.append(
            {
                "id": f"cam{index}",
                "index": index,
                "label": safe_str(
                    current.get("label"),
                    f"Cam {index}",
                ),
                "fileName": safe_str(
                    current.get("fileName"),
                    f"{index}.mp4",
                ),
                "description": (
                    "Uploaded NPY parameters "
                    f"cam{index}"
                ),
                "video_url": None,
                "fps": camera_fps,
                "offset_frame": (
                    safe_int(
                        current.get("offsetFrame"),
                        0,
                    )
                    or 0
                ),
                "position": pose["position"],
                "target": pose["target"],
                "enabled": safe_bool(
                    current.get("enabled"),
                    True,
                ),
                "projection": {
                    "imageWidth": camera_width,
                    "imageHeight": camera_height,
                    "uOffset": safe_float(
                        current.get("uOffset"),
                        0.0,
                    ),
                    "vOffset": safe_float(
                        current.get("vOffset"),
                        0.0,
                    ),
                    "intrinsic": intrinsic,
                    "extrinsic": extrinsic,
                    "coordinateMode": safe_str(
                        current.get("coordinateMode"),
                        mode,
                    ),
                    "useLensDistortion": safe_bool(
                        current.get("useLensDistortion"),
                        distortion,
                    ),
                    "courtWorldTransform": transform,
                },
            }
        )

    return result

