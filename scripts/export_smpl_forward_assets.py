#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import pickle
import sys
import types
from pathlib import Path
from typing import Any

import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = (
    REPO_ROOT / "body_models" / "human_model_files" / "smpl" / "SMPL_NEUTRAL.pkl"
)
DEFAULT_OUTPUT_DIR = REPO_ROOT / "frontend" / "public" / "models" / "smpl" / "forward"
REQUIRED_MODEL_KEYS = (
    "v_template",
    "shapedirs",
    "posedirs",
    "J_regressor",
    "kintree_table",
    "weights",
    "f",
)


class ChumpyStub:
    """Enough of chumpy.ch.Ch for pickle.load to reconstruct old SMPL files."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.__dict__.update(kwargs)

    def __setstate__(self, state: Any) -> None:
        if isinstance(state, dict):
            self.__dict__.update(state)
        else:
            self.state = state

    @property
    def r(self) -> np.ndarray:
        for key in ("_value", "x", "data", "array", "v"):
            if key in self.__dict__:
                return np.asarray(self.__dict__[key])
        raise TypeError("ChumpyStub object does not contain an array-like value.")

    def __array__(self, dtype: np.dtype | None = None) -> np.ndarray:
        array = self.r
        return array.astype(dtype, copy=False) if dtype is not None else array


def install_chumpy_stub() -> None:
    chumpy_module = types.ModuleType("chumpy")
    chumpy_ch_module = types.ModuleType("chumpy.ch")
    chumpy_ch_module.Ch = ChumpyStub
    chumpy_module.ch = chumpy_ch_module
    chumpy_module.Ch = ChumpyStub
    sys.modules.setdefault("chumpy", chumpy_module)
    sys.modules.setdefault("chumpy.ch", chumpy_ch_module)


def to_numpy(value: Any, *, dtype: np.dtype | None = None) -> np.ndarray:
    if hasattr(value, "toarray"):
        array = value.toarray()
    elif hasattr(value, "r"):
        array = value.r
    else:
        array = np.asarray(value)

    if dtype is not None:
        return np.ascontiguousarray(array, dtype=dtype)
    return np.ascontiguousarray(array)


def load_smpl_pickle(path: Path) -> dict[str, Any]:
    install_chumpy_stub()
    with path.open("rb") as file:
        data = pickle.load(file, encoding="latin1")
    if not isinstance(data, dict):
        raise TypeError(f"{path} did not load as a dict.")
    return data


def arrays_from_model_dict(data: dict[str, Any]) -> dict[str, np.ndarray]:
    missing = [key for key in REQUIRED_MODEL_KEYS if key not in data]
    if missing:
        raise KeyError(f"Missing required SMPL keys: {missing}")

    return {
        "v_template": to_numpy(data["v_template"], dtype=np.float32),
        "shapedirs": to_numpy(data["shapedirs"], dtype=np.float32),
        "posedirs": to_numpy(data["posedirs"], dtype=np.float32),
        "J_regressor": to_numpy(data["J_regressor"], dtype=np.float32),
        "kintree_table": to_numpy(data["kintree_table"], dtype=np.int32),
        "weights": to_numpy(data["weights"], dtype=np.float32),
        "f": to_numpy(data["f"], dtype=np.uint32),
    }


def load_model_arrays(path: Path) -> dict[str, np.ndarray]:
    if path.suffix.lower() == ".pkl":
        return arrays_from_model_dict(load_smpl_pickle(path))

    if path.suffix.lower() != ".npz":
        raise ValueError(f"SMPL model must be .pkl or .npz: {path}")

    with np.load(path) as data:
        missing = [key for key in REQUIRED_MODEL_KEYS if key not in data.files]
        if missing:
            raise KeyError(f"Missing required SMPL arrays in {path}: {missing}")
        return {
            "v_template": np.ascontiguousarray(data["v_template"], dtype=np.float32),
            "shapedirs": np.ascontiguousarray(data["shapedirs"], dtype=np.float32),
            "posedirs": np.ascontiguousarray(data["posedirs"], dtype=np.float32),
            "J_regressor": np.ascontiguousarray(data["J_regressor"], dtype=np.float32),
            "kintree_table": np.ascontiguousarray(data["kintree_table"], dtype=np.int32),
            "weights": np.ascontiguousarray(data["weights"], dtype=np.float32),
            "f": np.ascontiguousarray(data["f"], dtype=np.uint32),
        }


def write_model_npz(path: Path, source_path: Path, arrays: dict[str, np.ndarray], *, overwrite: bool) -> None:
    if path.exists() and not overwrite:
        raise FileExistsError(f"Output model .npz already exists, pass --overwrite-model-npz: {path}")

    payload = {key: arrays[key] for key in REQUIRED_MODEL_KEYS}
    metadata = {
        "source": str(source_path),
        "format": "smpl-model-to-npz",
        "arrays": {
            key: {"shape": list(value.shape), "dtype": str(value.dtype)}
            for key, value in payload.items()
        },
    }
    payload["__metadata_json__"] = np.asarray(json.dumps(metadata, ensure_ascii=False, indent=2))

    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, **payload)
    print(f"wrote model npz {path}")


def parse_parents(kintree_table: np.ndarray) -> np.ndarray:
    kintree_table = np.asarray(kintree_table, dtype=np.int32)
    parent_ids = kintree_table[0]
    ids = kintree_table[1]
    parents = np.full((len(ids),), -1, dtype=np.int32)
    for i, parent_id in enumerate(parent_ids):
        if i == 0:
            continue
        matches = np.where(ids == parent_id)[0]
        parents[i] = int(matches[0]) if len(matches) else -1
    return parents


def write_bin(base_dir: Path, name: str, array: np.ndarray) -> dict:
    array = np.ascontiguousarray(array)
    path = base_dir / f"{name}.bin"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(array.tobytes(order="C"))
    print(f"wrote {path} ({path.stat().st_size / (1024 * 1024):.1f} MB)")
    return {
        "url": f"{name}.bin",
        "dtype": str(array.dtype),
        "shape": list(array.shape),
    }


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path} ({path.stat().st_size / (1024 * 1024):.3f} MB)")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export browser SMPL forward assets from an SMPL .pkl or .npz model."
    )
    parser.add_argument(
        "--model",
        type=Path,
        default=DEFAULT_MODEL,
        help=f"SMPL model .pkl or .npz. Default: {DEFAULT_MODEL}",
    )
    parser.add_argument(
        "--model-npz",
        type=Path,
        help="Deprecated alias for --model, kept for old commands.",
    )
    parser.add_argument(
        "--write-model-npz",
        type=Path,
        help="Optionally write the numeric SMPL model arrays to this .npz path.",
    )
    parser.add_argument(
        "--overwrite-model-npz",
        action="store_true",
        help="Allow overwriting --write-model-npz.",
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()

    model_path = args.model_npz or args.model
    if not model_path.exists():
        raise FileNotFoundError(f"SMPL model not found: {model_path}")

    model_arrays = load_model_arrays(model_path)
    if args.write_model_npz:
        write_model_npz(
            args.write_model_npz,
            model_path,
            model_arrays,
            overwrite=args.overwrite_model_npz,
        )

    v_template = np.ascontiguousarray(model_arrays["v_template"], dtype=np.float32)
    shapedirs = np.ascontiguousarray(model_arrays["shapedirs"][:, :, :10], dtype=np.float32)
    posedirs_raw = np.ascontiguousarray(model_arrays["posedirs"], dtype=np.float32)
    j_regressor = np.ascontiguousarray(model_arrays["J_regressor"], dtype=np.float32)
    weights = np.ascontiguousarray(model_arrays["weights"], dtype=np.float32)
    faces = np.ascontiguousarray(model_arrays["f"], dtype=np.uint32)
    parents = parse_parents(model_arrays["kintree_table"])

    if posedirs_raw.ndim == 3:
        posedirs = posedirs_raw.reshape(-1, posedirs_raw.shape[-1]).T
    elif posedirs_raw.shape[0] == 207:
        posedirs = posedirs_raw
    else:
        posedirs = posedirs_raw.T
    posedirs = np.ascontiguousarray(posedirs, dtype=np.float32)

    shared = {
        "meta": {
            "source": str(model_path),
            "vertexCount": int(v_template.shape[0]),
            "jointCount": int(j_regressor.shape[0]),
            "shapeCount": int(shapedirs.shape[2]),
            "poseFeatureSize": int(posedirs.shape[0]),
        },
        "arrays": {
            "faces": write_bin(args.output_dir, "faces.uint32", faces.reshape(-1).astype(np.uint32)),
            "parents": write_bin(args.output_dir, "parents.int32", parents.astype(np.int32)),
            "v_template": write_bin(args.output_dir, "v_template.float32", v_template.reshape(-1).astype(np.float32)),
            "shapedirs": write_bin(args.output_dir, "shapedirs.float32", shapedirs.reshape(-1).astype(np.float32)),
            "J_regressor": write_bin(args.output_dir, "J_regressor.float32", j_regressor.reshape(-1).astype(np.float32)),
            "lbs_weights": write_bin(args.output_dir, "lbs_weights.float32", weights.reshape(-1).astype(np.float32)),
            "posedirs": write_bin(args.output_dir, "posedirs.float32", posedirs.reshape(-1).astype(np.float32)),
        },
    }

    neutral_player = {
        "meta": {
            "name": "neutral",
            "vertexCount": int(v_template.shape[0]),
            "jointCount": int(j_regressor.shape[0]),
        },
        "arrays": {},
    }

    write_json(args.output_dir / "shared.json", shared)
    write_json(args.output_dir / "players" / "neutral.json", neutral_player)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
