"""Convert a fine-tune per-frame JSON export to the legacy dataset uploader format.

The output intentionally contains only cameras, RallySeg, and 3D ball
trajectories. SMPL, racket, and 2D files are not copied.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from pathlib import Path

import numpy as np

try:
    import ujson as fast_json
except ImportError:  # pragma: no cover - stdlib fallback
    fast_json = json


def natural_key(value: str) -> tuple:
    return tuple(int(part) if part.isdigit() else part for part in value.split("_"))


def read_frames(source: Path) -> dict[str, list[dict]]:
    if not source.is_dir():
        raise ValueError(f"Source directory does not exist: {source}")
    rallies: dict[str, list[dict]] = defaultdict(list)
    seen: set[tuple[str, int]] = set()
    paths = list(source.rglob("frame_*.json"))
    total = len(paths)
    rally_pattern = re.compile(rb'"rally_id"\s*:\s*"([^"]+)"')
    frame_pattern = re.compile(rb'"frame_num"\s*:\s*(-?\d+)')
    ball_pattern = re.compile(rb'"ball_3d"\s*:\s*\[([^\]]+)\]')

    camera_path: Path | None = None
    camera_payload: dict | None = None
    for candidate in paths:
        raw = candidate.read_bytes()
        if not raw:
            continue
        try:
            candidate_payload = fast_json.loads(raw)
        except Exception:
            continue
        if all(key in candidate_payload for key in ("cam_ids", "intrinsics", "extrinsics", "image_hw")):
            camera_path, camera_payload = candidate, candidate_payload
            break

    missing_ball_count = 0
    skipped_count = 0
    for index, path in enumerate(paths, start=1):
        raw = path.read_bytes()
        if path == camera_path and camera_payload is not None:
            payload = camera_payload
            ball_valid = True
        else:
            rally_match = rally_pattern.search(raw)
            frame_match = frame_pattern.search(raw)
            ball_match = ball_pattern.search(raw)
            parts = path.relative_to(source).parts
            rally_value = rally_match.group(1) if rally_match else (parts[0].encode("utf-8") if parts else None)
            frame_value = frame_match or re.search(rb"frame_(\d+)\.json$", path.name.encode("utf-8"))
            if rally_value is None or frame_value is None:
                skipped_count += 1
                print(f"Warning: skipped file without rally/frame: {path}", flush=True)
                continue
            if ball_match is None:
                missing_ball_count += 1
                ball_values = [0.0, 0.0, 0.0]
                ball_valid = False
            else:
                ball_values = [float(item) for item in ball_match.group(1).split(b",")]
                ball_valid = len(ball_values) == 3
            payload = {
                "rally_id": rally_value.decode("utf-8"),
                "frame_num": int(frame_value.group(1)),
                "ball_3d": ball_values,
                "cam_ids": [], "intrinsics": [], "extrinsics": [], "image_hw": [1, 1],
            }
        if index == 1 or index % 500 == 0 or index == total:
            print(f"Reading JSON: {index}/{total}", flush=True)
        rally_id = str(payload["rally_id"])
        frame = int(payload["frame_num"])
        key = rally_id, frame
        if key in seen:
            raise ValueError(f"Duplicate source frame: {rally_id}/{frame}")
        seen.add(key)
        ball = np.asarray(payload["ball_3d"], dtype=np.float64)
        camera_ids = [int(item) for item in payload["cam_ids"]]
        intrinsics = np.asarray(payload["intrinsics"], dtype=np.float64)
        extrinsics = np.asarray(payload["extrinsics"], dtype=np.float64)
        height, width = (int(item) for item in payload["image_hw"])
        if ball.shape != (3,) or (path == camera_path and (intrinsics.shape != (len(camera_ids), 3, 3) or extrinsics.shape != (len(camera_ids), 3, 4))):
            raise ValueError(f"Unexpected shapes in {path}")
        rallies[rally_id].append({
            "frame": frame, "ball": ball, "camera_ids": camera_ids,
            "intrinsics": intrinsics, "extrinsics": extrinsics,
            "height": height, "width": width, "valid": ball_valid and ball.shape == (3,),
        })
    if not rallies:
        raise ValueError("No usable frame_*.json files found")
    if missing_ball_count or skipped_count:
        print(f"Warning: {missing_ball_count} frame(s) filled as empty; {skipped_count} file(s) skipped.", flush=True)
    return rallies


def convert(source: Path, destination: Path, fps: float, match_folder: str) -> None:
    if destination.exists():
        raise FileExistsError(f"Destination already exists: {destination}")
    rallies = read_frames(source)
    destination.mkdir(parents=True)
    camera_dir = destination / "cameras"
    rally_dir = destination / "rally-data"
    ball_dir = destination / "ball"
    mask_dir = destination / "ball-mask"
    for directory in (camera_dir, rally_dir, ball_dir, mask_dir):
        directory.mkdir()

    first = next(
        (item for rally_rows in rallies.values() for item in rally_rows if item["camera_ids"]),
        None,
    )
    if first is None:
        raise ValueError("No valid camera calibration found in the JSON export")
    for offset, camera_id in enumerate(first["camera_ids"]):
        np.save(camera_dir / f"Cam_{camera_id}_intrinsic.npy", first["intrinsics"][offset])
        np.save(camera_dir / f"Cam_{camera_id}_extrinsic.npy", first["extrinsics"][offset])

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

    match_rally_dir = rally_dir / match_folder
    match_rally_dir.mkdir()
    with (match_rally_dir / "RallySeg.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["Score", "Start", "End", "SourceStart", "SourceEnd"])
        writer.writeheader()
        writer.writerows(rally_rows)
    (destination / "IMPORT_INSTRUCTIONS.txt").write_text(
        "Upload cameras, rally-data, ball, and ball-mask to the matching legacy categories.\n"
        f"Use FPS={fps:g}. NPY indices preserve each local JSON frame_num with leading empty frames.\n"
        "Rally Start/End are concatenated global timeline ranges. 2D, human, and racket files are absent.\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--fps", type=float, default=50.0)
    parser.add_argument("--match-folder", default="match17")
    args = parser.parse_args()
    convert(args.source, args.destination, args.fps, args.match_folder)


if __name__ == "__main__":
    main()

# python badminton3D\backend\tools\convert_finetune_json.py `
#   "0807_finetune150_3_18000_all\0807_finetune150_3_18000_all\250108_5" `
#   "250108_5_legacy_upload_v3" `
#   --fps 50
