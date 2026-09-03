"""Convert a fine-tune per-frame JSON export to the legacy dataset uploader format.

The output contains cameras, RallySeg, 3D ball trajectories, and per-person
SMPL body/racket pose (written as new_racket_npz-style .npz files, one per
rally per person). 2D files are not copied.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

try:
    import ujson as fast_json
except ImportError:  # pragma: no cover - stdlib fallback
    fast_json = json


def natural_key(value: str) -> tuple:
    return tuple(int(part) if part.isdigit() else part for part in value.split("_"))


def _read_smpl_people(payload: dict, path: Path) -> list[dict[str, np.ndarray]]:
    pose_list = payload.get("smpl_pose")
    if not pose_list:
        return []
    beta_list = payload.get("smpl_beta")
    trans_list = payload.get("smpl_trans")
    if beta_list is None or trans_list is None or len(beta_list) != len(pose_list) or len(trans_list) != len(pose_list):
        raise ValueError(f"{path}: smpl_pose/smpl_beta/smpl_trans person count mismatch")
    people = []
    for pose, beta, trans in zip(pose_list, beta_list, trans_list):
        if len(pose) != 75:
            raise ValueError(f"{path}: smpl_pose must have 75 values (72 body + 3 racket), got {len(pose)}")
        if len(beta) != 10:
            raise ValueError(f"{path}: smpl_beta must have 10 values, got {len(beta)}")
        if len(trans) != 3:
            raise ValueError(f"{path}: smpl_trans must have 3 values, got {len(trans)}")
        people.append({
            "body_pose": np.asarray(pose[:72], dtype=np.float32),
            "racket_pose": np.asarray(pose[72:75], dtype=np.float32),
            "beta": np.asarray(beta, dtype=np.float32),
            "trans": np.asarray(trans, dtype=np.float32),
        })
    return people


def read_frames(source: Path) -> tuple[dict[str, list[dict]], dict]:
    if not source.is_dir():
        raise ValueError(f"Source directory does not exist: {source}")
    rallies: dict[str, list[dict]] = defaultdict(list)
    seen: set[tuple[str, int]] = set()
    paths = list(source.rglob("frame_*.json"))
    total = len(paths)
    frame_name_pattern = re.compile(r"frame_(\d+)\.json$")

    camera_row: dict | None = None
    missing_ball_count = 0
    missing_smpl_count = 0
    skipped_count = 0
    for index, path in enumerate(paths, start=1):
        raw = path.read_bytes()
        if not raw:
            skipped_count += 1
            continue
        try:
            payload = fast_json.loads(raw)
        except Exception:
            skipped_count += 1
            print(f"Warning: skipped unparsable file: {path}", flush=True)
            continue
        if index == 1 or index % 500 == 0 or index == total:
            print(f"Reading JSON: {index}/{total}", flush=True)

        parts = path.relative_to(source).parts
        rally_id = payload.get("rally_id") or (parts[0] if parts else None)
        name_match = frame_name_pattern.search(path.name)
        frame_value = payload.get("frame_num")
        frame = int(frame_value) if frame_value is not None else (int(name_match.group(1)) if name_match else None)
        if rally_id is None or frame is None:
            skipped_count += 1
            print(f"Warning: skipped file without rally/frame: {path}", flush=True)
            continue
        rally_id = str(rally_id)
        key = rally_id, frame
        if key in seen:
            raise ValueError(f"Duplicate source frame: {rally_id}/{frame}")
        seen.add(key)

        ball_raw = payload.get("ball_3d")
        if ball_raw is None or len(ball_raw) != 3:
            missing_ball_count += 1
            ball = np.zeros(3, dtype=np.float64)
            ball_valid = False
        else:
            ball = np.asarray(ball_raw, dtype=np.float64)
            ball_valid = True

        camera_ids = [int(item) for item in payload.get("cam_ids", [])]
        if camera_row is None and camera_ids and "intrinsics" in payload and "extrinsics" in payload:
            intrinsics = np.asarray(payload["intrinsics"], dtype=np.float64)
            extrinsics = np.asarray(payload["extrinsics"], dtype=np.float64)
            height, width = (int(item) for item in payload["image_hw"])
            if intrinsics.shape == (len(camera_ids), 3, 3) and extrinsics.shape == (len(camera_ids), 3, 4):
                camera_row = {
                    "camera_ids": camera_ids, "intrinsics": intrinsics,
                    "extrinsics": extrinsics, "height": height, "width": width,
                }

        smpl_people = _read_smpl_people(payload, path)
        if not smpl_people:
            missing_smpl_count += 1

        rallies[rally_id].append({
            "frame": frame, "ball": ball, "valid": ball_valid and ball.shape == (3,),
            "camera_ids": camera_ids, "smpl_people": smpl_people,
            "match_id": payload.get("match_id"),
        })
    if not rallies:
        raise ValueError("No usable frame_*.json files found")
    if camera_row is None:
        raise ValueError("No valid camera calibration found in the JSON export")
    if missing_ball_count or missing_smpl_count or skipped_count:
        print(
            f"Warning: {missing_ball_count} frame(s) missing ball, "
            f"{missing_smpl_count} frame(s) missing smpl, "
            f"{skipped_count} file(s) skipped.",
            flush=True,
        )
    return rallies, camera_row


_SMPL_MODEL_CACHE: dict[str, object] = {}


def _load_smpl_model(dataset_root: Path, gender: str):
    """Load (and cache) a badminton_dataset submodules.smplx SMPL model.

    dataset_root must be the badminton_dataset checkout that ships the
    racket_pose-aware smplx fork (submodules/smplx) and the SMPL .pkl files
    (body_models/human_model_files/smpl). This is a sibling project to
    badminton3D, not part of this repo.
    """
    if gender in _SMPL_MODEL_CACHE:
        return _SMPL_MODEL_CACHE[gender]

    import torch

    smplx_pkg_dir = dataset_root / "submodules" / "smplx"
    body_model_dir = dataset_root / "body_models" / "human_model_files" / "smpl"
    if not smplx_pkg_dir.is_dir():
        raise FileNotFoundError(
            f"Missing {smplx_pkg_dir} (expected the racket_pose-aware smplx fork "
            "under <dataset_root>/submodules/smplx; pass --dataset-root)"
        )
    if not body_model_dir.is_dir():
        raise FileNotFoundError(
            f"Missing {body_model_dir} (expected SMPL_*.pkl under "
            "<dataset_root>/body_models/human_model_files/smpl; pass --dataset-root)"
        )

    dataset_root_str = str(dataset_root)
    if dataset_root_str not in sys.path:
        sys.path.insert(0, dataset_root_str)
    from submodules import smplx  # noqa: E402 (import depends on sys.path patch above)

    model = smplx.SMPL(model_path=str(body_model_dir), gender=gender, batch_size=1).eval()
    _SMPL_MODEL_CACHE[gender] = model
    return model


def compute_racket_transform(
    dataset_root: Path,
    gender: str,
    body_pose: np.ndarray,
    beta: np.ndarray,
    trans: np.ndarray,
    racket_pose: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Reproduce badminton_dataset/recover_racket_pose.py's racket placement.

    That script drives an SMPL fork (submodules/smplx) that treats racket_pose
    as a 25th joint hanging off the wrist and returns its global affine
    transform; this has been verified (against 12_24_1_actual/new_racket_npz)
    to match that script's output to floating-point precision. Reproducing it
    here means converted rallies place the racket the same way the real
    captured matches do, instead of relying on the frontend's client-side FK
    approximation (which is what happens when these two arrays are absent,
    and is the actual cause of the racket appearing detached from the hand).
    """
    import torch

    model = _load_smpl_model(dataset_root, gender)
    length = body_pose.shape[0]

    with torch.no_grad():
        betas = torch.from_numpy(beta[None, :]).expand(length, -1)
        live = model.forward(
            betas=betas,
            global_orient=torch.from_numpy(body_pose[:, :3]),
            body_pose=torch.from_numpy(body_pose[:, 3:]),
            transl=torch.from_numpy(trans),
            racket_pose=torch.from_numpy(racket_pose),
        )
        racket_transform = live.A[:, -1, :, :].cpu().numpy()

        # recover_racket_pose.py computes the canonical wrist position via
        # `smpl_model.forward(beta=beta)` -- `beta` (singular) is not a real
        # forward() argument, so it is silently swallowed by **kwargs and the
        # model's default zero shape is used instead of the person's actual
        # beta. That is reproduced as-is (not "fixed") so racket_frame_offset
        # stays numerically identical to the real captured-match npz files,
        # which were generated by the same script with the same quirk.
        canonical = model.forward()
        wrist_position = canonical.joints[0, 21].cpu().numpy()

    racket_frame_offset = np.tile(wrist_position, (length, 1))
    return (
        racket_transform.astype(np.float32),
        racket_frame_offset.astype(np.float32),
    )


def write_smpl_racket_npz(
    smpl_dir: Path,
    rally_id: str,
    frames: list[dict],
    length: int,
    dataset_root: Path | None,
    gender: str,
) -> None:
    """Write one new_racket_npz-style .npz per person, matching the layout of
    12_24_1_actual/new_racket_npz/<match_id>/<rally_id>_<person_index>.npz.

    When dataset_root is given, racket_transform/racket_frame_offset are
    computed via compute_racket_transform() and written as top-level keys
    (matching the real npz layout) so the racket renders the same way it does
    for captured matches. When dataset_root is None, they are omitted, and
    the frontend falls back to its own (less accurate) client-side FK guess --
    the downstream loader (reconstruction_assets.normalize_motion_source)
    already treats both as optional.
    """
    person_count = max((len(item["smpl_people"]) for item in frames), default=0)
    if person_count == 0:
        return
    match_ids = {item["match_id"] for item in frames if item.get("match_id")}
    if len(match_ids) > 1:
        raise ValueError(f"Rally {rally_id} has inconsistent match_id values: {sorted(match_ids)}")
    match_id = next(iter(match_ids), rally_id.split("_")[0])
    rally_smpl_dir = smpl_dir / match_id
    rally_smpl_dir.mkdir(parents=True, exist_ok=True)

    for person_index in range(person_count):
        body_pose = np.zeros((length, 72), dtype=np.float32)
        racket_pose = np.zeros((length, 3), dtype=np.float32)
        trans = np.zeros((length, 3), dtype=np.float32)
        mask = np.zeros(length, dtype=np.float64)
        betas: list[np.ndarray] = []
        for item in frames:
            people = item["smpl_people"]
            if person_index >= len(people):
                continue
            person = people[person_index]
            local_frame = item["frame"]
            body_pose[local_frame] = person["body_pose"]
            racket_pose[local_frame] = person["racket_pose"]
            trans[local_frame] = person["trans"]
            mask[local_frame] = 1.0
            betas.append(person["beta"])
        # beta is near-constant per person across a rally; the JSON re-estimates it
        # every frame, so the mean over detected frames is used as the single
        # representative shape vector (matching the npz's fixed (1, 10) layout).
        beta = (
            np.mean(betas, axis=0).astype(np.float32)
            if betas
            else np.zeros(10, dtype=np.float32)
        )
        payload = {
            "data/body_pose": body_pose,
            "data/beta": beta[None, :],
            "data/trans": trans,
            "data/racket_pose": racket_pose,
            "data/mask": mask,
        }
        has_racket_transform = dataset_root is not None
        if has_racket_transform:
            racket_transform, racket_frame_offset = compute_racket_transform(
                dataset_root, gender, body_pose, beta, trans, racket_pose
            )
            payload["racket_transform"] = racket_transform
            payload["racket_frame_offset"] = racket_frame_offset
        metadata = {
            "source": "convert_finetune_json.py",
            "rally_id": rally_id,
            "match_id": match_id,
            "person_index": person_index,
            "format": "finetune-json-to-npz-v1",
            "frame_count": length,
            "valid_frame_count": int(mask.sum()),
            "has_racket_transform": has_racket_transform,
            "note": (
                "Converted from per-frame finetune JSON. smpl_pose[:72] is body_pose "
                "(24 joints axis-angle incl. global orient); smpl_pose[72:75] is "
                "racket_pose. beta is the mean over frames where this person was "
                "detected. Frames absent from the JSON export are zero-filled with "
                "mask=0. " + (
                    "racket_transform/racket_frame_offset were computed via "
                    "compute_racket_transform() (badminton_dataset's racket_pose-aware "
                    "SMPL forward kinematics), matching the real captured-match npz "
                    "layout."
                    if has_racket_transform
                    else "racket_transform/racket_frame_offset were not computed "
                    "(--dataset-root not given); the frontend falls back to its own "
                    "client-side FK approximation."
                )
            ),
        }
        payload["__metadata_json__"] = np.asarray(json.dumps(metadata, ensure_ascii=False))
        np.savez_compressed(rally_smpl_dir / f"{rally_id}_{person_index}.npz", **payload)


def convert(
    source: Path,
    destination: Path,
    fps: float,
    match_folder: str,
    dataset_root: Path | None = None,
    gender: str = "neutral",
) -> None:
    if destination.exists():
        raise FileExistsError(f"Destination already exists: {destination}")
    rallies, camera_row = read_frames(source)
    destination.mkdir(parents=True)
    camera_dir = destination / "cameras"
    rally_dir = destination / "rally-data"
    ball_dir = destination / "ball"
    mask_dir = destination / "ball-mask"
    smpl_dir = destination / "new_racket_npz"
    for directory in (camera_dir, rally_dir, ball_dir, mask_dir, smpl_dir):
        directory.mkdir()

    for offset, camera_id in enumerate(camera_row["camera_ids"]):
        np.save(camera_dir / f"Cam_{camera_id}_intrinsic.npy", camera_row["intrinsics"][offset])
        np.save(camera_dir / f"Cam_{camera_id}_extrinsic.npy", camera_row["extrinsics"][offset])

    rally_rows: list[dict[str, str | int]] = []
    global_cursor = 0
    for rally_id in sorted(rallies, key=natural_key):
        frames = sorted(rallies[rally_id], key=lambda item: item["frame"])
        source_start = frames[0]["frame"]
        source_end = frames[-1]["frame"]
        # frame_num is local to a Rally. Preserve it as the NPY index so
        # frame 57 produces 57 leading empty frames (0..56).
        length = source_end + 1
        global_start = global_cursor
        global_end = global_start + length
        ball = np.zeros((length, 3), dtype=np.float32)
        mask = np.zeros(length, dtype=np.uint8)
        for item in frames:
            local_frame = item["frame"]
            if item["valid"]:
                ball[local_frame] = item["ball"]
                mask[local_frame] = 1
        np.save(ball_dir / f"{rally_id}.npy", ball)
        np.save(mask_dir / f"{rally_id}.npy", mask)
        rally_rows.append({
            "Score": rally_id,
            "Start": global_start,
            "End": global_end,
            "SourceStart": source_start,
            "SourceEnd": source_end,
        })
        global_cursor = global_end

        write_smpl_racket_npz(smpl_dir, rally_id, frames, length, dataset_root, gender)

    match_rally_dir = rally_dir / match_folder
    match_rally_dir.mkdir()
    with (match_rally_dir / "RallySeg.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["Score", "Start", "End", "SourceStart", "SourceEnd"])
        writer.writeheader()
        writer.writerows(rally_rows)
    racket_note = (
        "racket_pose, racket_transform, and racket_frame_offset (matching the real "
        "captured-match layout)."
        if dataset_root is not None
        else "racket_pose (racket_transform/racket_frame_offset were not computed; "
        "rerun with --dataset-root to include them)."
    )
    (destination / "IMPORT_INSTRUCTIONS.txt").write_text(
        "Upload cameras, rally-data, ball, and ball-mask to the matching legacy categories.\n"
        f"Use FPS={fps:g}. NPY indices preserve each local JSON frame_num with leading empty frames.\n"
        "Rally Start/End are concatenated global timeline ranges. 2D and human (skeleton) files are absent.\n"
        "new_racket_npz/<match_id>/<rally_id>_<person_index>.npz holds SMPL body_pose/beta/trans and "
        f"{racket_note}\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--fps", type=float, default=50.0)
    parser.add_argument("--match-folder", default="match17")
    parser.add_argument(
        "--dataset-root",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "badminton_dataset",
        help="Path to the badminton_dataset checkout providing submodules/smplx and "
        "body_models/human_model_files/smpl, used to compute racket_transform/"
        "racket_frame_offset (default: ../../../badminton_dataset next to this repo)",
    )
    parser.add_argument(
        "--no-racket-transform",
        action="store_true",
        help="Skip computing racket_transform/racket_frame_offset (no torch/smplx "
        "required); only racket_pose is written, and the frontend falls back to its "
        "own client-side FK approximation for racket placement.",
    )
    parser.add_argument("--gender", default="neutral", choices=["male", "female", "neutral"])
    args = parser.parse_args()
    dataset_root = None if args.no_racket_transform else args.dataset_root
    convert(args.source, args.destination, args.fps, args.match_folder, dataset_root, args.gender)


if __name__ == "__main__":
    main()

# python badminton3D\backend\tools\convert_finetune_json.py `
#   "0807_finetune150_3_18000_all\0807_finetune150_3_18000_all\250108_5" `
#   "250108_5_legacy_upload_v3" `
#   --fps 50
