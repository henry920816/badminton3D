from __future__ import annotations

import argparse
import json
import pickle
import sys
from pathlib import Path
from typing import Any

import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT_DIR = Path("backend/app/datasets/new_racket/241224_1")
DEFAULT_OUTPUT_DIR = Path("backend/app/datasets/new_racket_npz/241224_1")

DEFAULT_SMPL_MODEL = REPO_ROOT / "body_models" / "human_model_files" / "smpl" / "SMPL_NEUTRAL.pkl"
DEFAULT_SMPLX_SUBMODULE = REPO_ROOT / "submodules"


def import_torch():
    try:
        import torch
    except Exception as exc:
        raise RuntimeError(
            "This converter needs PyTorch to read .pth files. "
            "Install/fix torch in the Python environment, then run again."
        ) from exc
    return torch


def to_numpy(value: Any) -> np.ndarray | None:
    if hasattr(value, "detach") and hasattr(value, "cpu"):
        return value.detach().cpu().numpy()
    if isinstance(value, np.ndarray):
        return value
    if isinstance(value, (bool, int, float, complex, np.number)):
        return np.asarray(value)
    if isinstance(value, str):
        return np.asarray(value)
    if isinstance(value, (list, tuple)):
        try:
            return np.asarray(value)
        except Exception:
            return None
    return None


def jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, np.ndarray):
        return {
            "type": "ndarray",
            "shape": list(value.shape),
            "dtype": str(value.dtype),
        }
    if hasattr(value, "shape") and hasattr(value, "dtype"):
        return {
            "type": type(value).__name__,
            "shape": list(value.shape),
            "dtype": str(value.dtype),
        }
    if isinstance(value, (str, bool, int, float)) or value is None:
        return value
    if isinstance(value, np.generic):
        return value.item()
    return repr(value)


def safe_key(part: Any) -> str:
    text = str(part).replace("\\", "/").strip("/")
    return text or "value"


def add_pickle_payload(out: dict[str, np.ndarray], key: str, value: Any) -> None:
    payload = pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL)
    out[f"__pickle__/{key}"] = np.frombuffer(payload, dtype=np.uint8)


def flatten_value(
    value: Any,
    key: str,
    out: dict[str, np.ndarray],
    manifest: dict[str, Any],
) -> None:
    if isinstance(value, dict):
        manifest[key] = {
            "kind": "dict",
            "children": [safe_key(k) for k in value.keys()],
        }
        for child_key, child_value in value.items():
            flatten_value(child_value, f"{key}/{safe_key(child_key)}", out, manifest)
        return

    if isinstance(value, (list, tuple)):
        array = to_numpy(value)
        if array is not None and array.dtype != object:
            out[key] = array
            manifest[key] = {
                "kind": type(value).__name__,
                "stored_as": "array",
                "shape": list(array.shape),
                "dtype": str(array.dtype),
            }
            return

        manifest[key] = {
            "kind": type(value).__name__,
            "stored_as": "children_and_pickle",
            "length": len(value),
        }
        for index, child_value in enumerate(value):
            flatten_value(child_value, f"{key}/{index}", out, manifest)
        add_pickle_payload(out, key, value)
        return

    array = to_numpy(value)
    if array is not None and array.dtype != object:
        out[key] = array
        manifest[key] = {
            "kind": type(value).__name__,
            "stored_as": "array",
            "shape": list(array.shape),
            "dtype": str(array.dtype),
        }
        return

    add_pickle_payload(out, key, value)
    manifest[key] = {
        "kind": type(value).__name__,
        "stored_as": "pickle_bytes",
    }


def convert_one(torch: Any, src: Path, dst: Path) -> None:
    loaded = torch.load(src, map_location="cpu")
    arrays: dict[str, np.ndarray] = {}
    manifest: dict[str, Any] = {}

    flatten_value(loaded, "data", arrays, manifest)

    metadata = {
        "source_file": str(src),
        "source_name": src.name,
        "format": "pth-to-npz-full",
        "note": (
            "Regular entries are stored as .npy arrays inside this .npz. "
            "Entries under __pickle__/ are pickled bytes for values that "
            "cannot be represented losslessly as numeric/string arrays."
        ),
        "manifest": manifest,
        "summary": jsonable(loaded),
    }
    arrays["__metadata_json__"] = np.asarray(
        json.dumps(metadata, ensure_ascii=False, indent=2)
    )

    dst.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(dst, **arrays)


def npz_array(data: Any, *names: str) -> np.ndarray:
    for name in names:
        if name in data.files:
            return data[name]
    raise KeyError(f"missing arrays: {' or '.join(names)}")


def normalize_motion_from_npz(path: Path) -> dict[str, np.ndarray]:
    with np.load(path, allow_pickle=False) as data:
        body_pose_raw = npz_array(data, "body_pose", "data/body_pose").astype(np.float32)
        beta = npz_array(data, "beta", "betas", "data/beta", "data/betas").astype(np.float32)
        trans = npz_array(data, "trans", "transl", "data/trans", "data/transl").astype(np.float32)
        racket_pose = npz_array(data, "racket_pose", "data/racket_pose").astype(np.float32)
        mask = data["mask"] if "mask" in data.files else data["data/mask"] if "data/mask" in data.files else None

    if body_pose_raw.ndim != 2 or body_pose_raw.shape[1] not in (69, 72):
        raise ValueError(f"{path.name}: body_pose must be [N,69] or [N,72]")
    if trans.ndim != 2 or trans.shape[1] != 3:
        raise ValueError(f"{path.name}: trans must be [N,3]")
    if racket_pose.ndim != 2 or racket_pose.shape[1] != 3:
        raise ValueError(f"{path.name}: racket_pose must be [N,3]")
    if len(body_pose_raw) != len(trans) or len(body_pose_raw) != len(racket_pose):
        raise ValueError(f"{path.name}: body_pose, trans, and racket_pose frame counts must match")

    if beta.ndim == 1:
        beta = beta[None, :]
    if beta.ndim != 2 or beta.shape[1] < 10:
        raise ValueError(f"{path.name}: beta must be [10] or [N,10]")
    beta = beta[:, :10]

    if body_pose_raw.shape[1] == 72:
        global_orient = body_pose_raw[:, :3]
        body_pose = body_pose_raw[:, 3:]
    else:
        global_orient = np.zeros((len(body_pose_raw), 3), dtype=np.float32)
        body_pose = body_pose_raw

    if mask is None:
        mask_array = np.ones((len(body_pose_raw),), dtype=bool)
    else:
        mask_array = np.asarray(mask).reshape(-1).astype(bool)

    return {
        "global_orient": global_orient.astype(np.float32, copy=False),
        "body_pose": body_pose.astype(np.float32, copy=False),
        "beta": beta.astype(np.float32, copy=False),
        "trans": trans.astype(np.float32, copy=False),
        "mask": mask_array,
        "racket_pose": racket_pose.astype(np.float32, copy=False),
    }


def compute_smpl_vertices(
    motion: dict[str, np.ndarray],
    *,
    smpl_model: Path,
    smplx_submodule: Path,
    batch_size: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray | None, np.ndarray | None]:
    if str(smplx_submodule) not in sys.path:
        sys.path.insert(0, str(smplx_submodule))

    import torch
    from smplx import SMPL

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = SMPL(
        str(smpl_model),
        gender="neutral",
        num_betas=10,
        batch_size=1,
        create_betas=False,
        create_body_pose=False,
        create_global_orient=False,
        create_transl=False,
    ).to(device)
    model.eval()

    beta = torch.as_tensor(motion["beta"], dtype=torch.float32, device=device)
    if beta.shape[0] == 1:
        beta = beta.expand(len(motion["body_pose"]), -1)

    vertices: list[np.ndarray] = []
    racket_transforms: list[np.ndarray] = []
    racket_frame_offsets: list[np.ndarray] = []
    with torch.no_grad():
        for start in range(0, len(motion["body_pose"]), batch_size):
            end = min(start + batch_size, len(motion["body_pose"]))
            racket_pose = motion.get("racket_pose")
            racket_pose_tensor = None
            if racket_pose is not None:
                racket_pose_tensor = torch.as_tensor(
                    racket_pose[start:end],
                    dtype=torch.float32,
                    device=device,
                )

            output = model(
                betas=beta[start:end],
                global_orient=torch.as_tensor(
                    motion["global_orient"][start:end],
                    dtype=torch.float32,
                    device=device,
                ),
                body_pose=torch.as_tensor(
                    motion["body_pose"][start:end],
                    dtype=torch.float32,
                    device=device,
                ),
                transl=torch.as_tensor(
                    motion["trans"][start:end],
                    dtype=torch.float32,
                    device=device,
                ),
                return_verts=True,
                racket_pose=racket_pose_tensor,
            )
            vertices.append(output.vertices.detach().cpu().numpy().astype(np.float32))

            if racket_pose_tensor is not None:
                if not hasattr(output, "A") or output.A is None:
                    raise RuntimeError("SMPL output did not include affine matrices for racket export.")
                racket_transforms.append(output.A[:, -1].detach().cpu().numpy().astype(np.float32))

                batch_count = end - start
                canonical_output = model(
                    betas=beta[start:end],
                    global_orient=torch.zeros((batch_count, 3), dtype=torch.float32, device=device),
                    body_pose=torch.zeros((batch_count, 69), dtype=torch.float32, device=device),
                    return_verts=False,
                )
                racket_frame_offsets.append(
                    canonical_output.joints[:, 23].detach().cpu().numpy().astype(np.float32)
                )

    return (
        np.concatenate(vertices, axis=0),
        np.asarray(model.faces, dtype=np.uint32),
        np.concatenate(racket_transforms, axis=0) if racket_transforms else None,
        np.concatenate(racket_frame_offsets, axis=0) if racket_frame_offsets else None,
    )


def add_racket_transforms_to_npz(
    path: Path,
    *,
    smpl_model: Path,
    smplx_submodule: Path,
    batch_size: int,
    overwrite: bool,
) -> bool:
    with np.load(path, allow_pickle=False) as data:
        if "racket_transform" in data.files and "racket_frame_offset" in data.files and not overwrite:
            print(f"skip existing racket transforms: {path}")
            return False

    motion = normalize_motion_from_npz(path)
    _, _, racket_transform, racket_frame_offset = compute_smpl_vertices(
        motion,
        smpl_model=smpl_model,
        smplx_submodule=smplx_submodule,
        batch_size=batch_size,
    )
    if racket_transform is None or racket_frame_offset is None:
        raise RuntimeError(f"{path.name}: compute_smpl_vertices did not produce racket transforms")

    with np.load(path, allow_pickle=False) as data:
        arrays = {name: data[name] for name in data.files}
    arrays["racket_transform"] = racket_transform.astype(np.float32, copy=False)
    arrays["racket_frame_offset"] = racket_frame_offset.astype(np.float32, copy=False)
    np.savez_compressed(path, **arrays)
    print(f"wrote racket transforms: {path} shape={racket_transform.shape}")
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert every .pth file under new_racket/241224_1 into .npz."
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=DEFAULT_INPUT_DIR,
        help=f"Folder containing .pth files. Default: {DEFAULT_INPUT_DIR}",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Folder to write .npz files. Default: {DEFAULT_OUTPUT_DIR}",
    )
    parser.add_argument(
        "--overwrite",
        default=True,
        help="Overwrite existing .npz files.",
    )
    parser.add_argument(
        "--skip-racket-transforms",
        action="store_true",
        help="Only convert .pth to .npz; do not add SMPL-computed racket transforms.",
    )
    parser.add_argument(
        "--enrich-existing",
        action="store_true",
        help="When the target .npz already exists, add missing racket transforms instead of only skipping it.",
    )
    parser.add_argument("--smpl-model", type=Path, default=DEFAULT_SMPL_MODEL)
    parser.add_argument("--smplx-submodule", type=Path, default=DEFAULT_SMPLX_SUBMODULE)
    parser.add_argument("--batch-size", type=int, default=64)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_dir = args.input_dir
    output_dir = args.output_dir

    if not input_dir.exists():
        raise FileNotFoundError(f"Input folder not found: {input_dir}")

    pth_files = sorted(input_dir.glob("*.pth"))
    if not pth_files:
        raise FileNotFoundError(f"No .pth files found in: {input_dir}")

    torch = import_torch()

    converted = 0
    enriched = 0
    skipped = 0
    failed: list[tuple[Path, str]] = []

    for src in pth_files:
        dst = output_dir / src.with_suffix(".npz").name
        if dst.exists() and not args.overwrite:
            if args.enrich_existing and not args.skip_racket_transforms:
                try:
                    if add_racket_transforms_to_npz(
                        dst,
                        smpl_model=args.smpl_model,
                        smplx_submodule=args.smplx_submodule,
                        batch_size=args.batch_size,
                        overwrite=False,
                    ):
                        enriched += 1
                except Exception as exc:
                    failed.append((src, str(exc)))
                    print(f"fail enrich existing: {dst} -> {exc}")
                    continue
            skipped += 1
            print(f"skip existing: {dst}")
            continue

        try:
            convert_one(torch, src, dst)
            if not args.skip_racket_transforms:
                if add_racket_transforms_to_npz(
                    dst,
                    smpl_model=args.smpl_model,
                    smplx_submodule=args.smplx_submodule,
                    batch_size=args.batch_size,
                    overwrite=True,
                ):
                    enriched += 1
        except Exception as exc:
            failed.append((src, str(exc)))
            print(f"fail: {src} -> {exc}")
            continue

        converted += 1
        print(f"converted: {src} -> {dst}")

    print(
        f"done: converted={converted}, enriched={enriched}, skipped={skipped}, failed={len(failed)}, "
        f"output_dir={output_dir}"
    )

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
