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
DEFAULT_MODEL = REPO_ROOT / "body_models" / "human_model_files" / "smpl" / "SMPL_NEUTRAL.pkl"
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
        raise TypeError("ChumpyStub object does not contain an array-like value")

    def __array__(self, dtype: np.dtype | None = None) -> np.ndarray:
        value = self.r
        return value.astype(dtype, copy=False) if dtype is not None else value


def install_chumpy_stub() -> None:
    chumpy_module = types.ModuleType("chumpy")
    chumpy_ch_module = types.ModuleType("chumpy.ch")
    chumpy_ch_module.Ch = ChumpyStub
    chumpy_module.ch = chumpy_ch_module
    chumpy_module.Ch = ChumpyStub
    sys.modules.setdefault("chumpy", chumpy_module)
    sys.modules.setdefault("chumpy.ch", chumpy_ch_module)


def to_numpy(value: Any, dtype: np.dtype) -> np.ndarray:
    if hasattr(value, "toarray"):
        array = value.toarray()
    elif hasattr(value, "r"):
        array = value.r
    else:
        array = np.asarray(value)
    return np.ascontiguousarray(array, dtype=dtype)


def load_model(path: Path) -> dict[str, np.ndarray]:
    if path.suffix.lower() == ".pkl":
        install_chumpy_stub()
        with path.open("rb") as handle:
            raw = pickle.load(handle, encoding="latin1")
        missing = [key for key in REQUIRED_MODEL_KEYS if key not in raw]
        if missing:
            raise KeyError(f"Missing SMPL keys: {missing}")
        return {
            "v_template": to_numpy(raw["v_template"], np.float32),
            "shapedirs": to_numpy(raw["shapedirs"], np.float32),
            "posedirs": to_numpy(raw["posedirs"], np.float32),
            "J_regressor": to_numpy(raw["J_regressor"], np.float32),
            "kintree_table": to_numpy(raw["kintree_table"], np.int32),
            "weights": to_numpy(raw["weights"], np.float32),
            "f": to_numpy(raw["f"], np.uint32),
        }

    if path.suffix.lower() == ".npz":
        with np.load(path, allow_pickle=False) as raw:
            missing = [key for key in REQUIRED_MODEL_KEYS if key not in raw.files]
            if missing:
                raise KeyError(f"Missing SMPL arrays: {missing}")
            return {
                "v_template": np.ascontiguousarray(raw["v_template"], dtype=np.float32),
                "shapedirs": np.ascontiguousarray(raw["shapedirs"], dtype=np.float32),
                "posedirs": np.ascontiguousarray(raw["posedirs"], dtype=np.float32),
                "J_regressor": np.ascontiguousarray(raw["J_regressor"], dtype=np.float32),
                "kintree_table": np.ascontiguousarray(raw["kintree_table"], dtype=np.int32),
                "weights": np.ascontiguousarray(raw["weights"], dtype=np.float32),
                "f": np.ascontiguousarray(raw["f"], dtype=np.uint32),
            }

    raise ValueError(f"SMPL model must be .pkl or .npz: {path}")


def parse_parents(kintree_table: np.ndarray) -> np.ndarray:
    parent_ids = np.asarray(kintree_table, dtype=np.int32)[0]
    ids = np.asarray(kintree_table, dtype=np.int32)[1]
    parents = np.full((len(ids),), -1, dtype=np.int32)
    for index, parent_id in enumerate(parent_ids):
        if index == 0:
            continue
        matches = np.where(ids == parent_id)[0]
        parents[index] = int(matches[0]) if len(matches) else -1
    return parents


def write_binary(output_dir: Path, name: str, array: np.ndarray) -> dict[str, Any]:
    array = np.ascontiguousarray(array)
    path = output_dir / f"{name}.bin"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(array.tobytes(order="C"))
    return {
        "url": f"{name}.bin",
        "dtype": str(array.dtype),
        "shape": list(array.shape),
    }


def export_assets(model_path: Path, output_dir: Path) -> None:
    model = load_model(model_path)
    v_template = np.ascontiguousarray(model["v_template"], dtype=np.float32)
    shapedirs = np.ascontiguousarray(model["shapedirs"][:, :, :10], dtype=np.float32)
    posedirs_raw = np.ascontiguousarray(model["posedirs"], dtype=np.float32)
    j_regressor = np.ascontiguousarray(model["J_regressor"], dtype=np.float32)
    weights = np.ascontiguousarray(model["weights"], dtype=np.float32)
    faces = np.ascontiguousarray(model["f"], dtype=np.uint32)
    parents = parse_parents(model["kintree_table"])

    if posedirs_raw.ndim == 3:
        posedirs = posedirs_raw.reshape(-1, posedirs_raw.shape[-1]).T
    elif posedirs_raw.shape[0] == 207:
        posedirs = posedirs_raw
    else:
        posedirs = posedirs_raw.T
    posedirs = np.ascontiguousarray(posedirs, dtype=np.float32)

    shared = {
        "meta": {
            "source": model_path.name,
            "vertexCount": int(v_template.shape[0]),
            "jointCount": int(j_regressor.shape[0]),
            "shapeCount": int(shapedirs.shape[2]),
            "poseFeatureSize": int(posedirs.shape[0]),
        },
        "arrays": {
            "faces": write_binary(output_dir, "faces.uint32", faces.reshape(-1).astype(np.uint32)),
            "parents": write_binary(output_dir, "parents.int32", parents.astype(np.int32)),
            "v_template": write_binary(output_dir, "v_template.float32", v_template.reshape(-1).astype(np.float32)),
            "shapedirs": write_binary(output_dir, "shapedirs.float32", shapedirs.reshape(-1).astype(np.float32)),
            "J_regressor": write_binary(output_dir, "J_regressor.float32", j_regressor.reshape(-1).astype(np.float32)),
            "lbs_weights": write_binary(output_dir, "lbs_weights.float32", weights.reshape(-1).astype(np.float32)),
            "posedirs": write_binary(output_dir, "posedirs.float32", posedirs.reshape(-1).astype(np.float32)),
        },
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "shared.json").write_text(
        json.dumps(shared, separators=(",", ":")),
        encoding="utf-8",
    )
    player_dir = output_dir / "players"
    player_dir.mkdir(parents=True, exist_ok=True)
    (player_dir / "neutral.json").write_text(
        json.dumps(
            {
                "meta": {
                    "name": "neutral",
                    "vertexCount": int(v_template.shape[0]),
                    "jointCount": int(j_regressor.shape[0]),
                },
                "arrays": {},
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()
    export_assets(args.model, args.output_dir)
    print(f"SMPL forward assets written to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
