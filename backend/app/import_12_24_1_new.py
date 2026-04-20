from __future__ import annotations

import math
import os

import numpy as np
import pandas as pd
from sqlalchemy import insert

from app.db import SessionLocal
from app.models import BallTraj, Hit, Match, Rally

DATA_ROOT = "/app/app/datasets/12_24_1_new"
FPS = 50.0
NYP_FOLDER = "241224_1"


def _safe_int(x, default=None):
    try:
        if x is None or (isinstance(x, float) and math.isnan(x)):
            return default
        return int(float(x))
    except Exception:
        return default


def _safe_str(x, default=""):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return default
    return str(x)


def get_set_dirs(data_root: str) -> list[str]:
    out = []
    for name in sorted(os.listdir(data_root)):
        set_dir = os.path.join(data_root, name)
        if not os.path.isdir(set_dir):
            continue
        if "_set" not in name:
            continue
        if os.path.isfile(os.path.join(set_dir, "RallySeg.csv")):
            out.append(set_dir)
    return out


def get_match_duration_frame(set_dirs: list[str]) -> int:
    max_end = 0
    for set_dir in set_dirs:
        rally_csv = os.path.join(set_dir, "RallySeg.csv")
        if not os.path.isfile(rally_csv):
            continue
        rally_df = pd.read_csv(rally_csv)
        if "End" not in rally_df.columns or len(rally_df) == 0:
            continue
        cur = int(rally_df["End"].max())
        if cur > max_end:
            max_end = cur
    return max_end


def import_ball_trajectory_for_rally(db, match_id: int, score: str, start_frame: int):
    dataset_base = os.path.dirname(DATA_ROOT)

    file_name = f"{score}.npy"
    ball_path = os.path.join(dataset_base, "ball_new", NYP_FOLDER, file_name)
    mask_path = os.path.join(dataset_base, "ball_final_mask_new", NYP_FOLDER, file_name)
    speed_path = os.path.join(dataset_base, "ball_speed", NYP_FOLDER, file_name)

    if not (os.path.exists(ball_path) and os.path.exists(mask_path)):
        return

    try:
        ball_data = np.load(ball_path)
        mask_data = np.load(mask_path)
        speed_data = np.load(speed_path) if os.path.exists(speed_path) else None
    except Exception as e:
        print(f"Error loading {file_name}: {e}")
        return

    valid_indices = np.where(mask_data == 1)[0]
    if len(valid_indices) == 0:
        return

    bulk_data = []
    for idx_val in valid_indices:
        i = int(idx_val)
        g_frame = start_frame + i
        t_s = float(g_frame / FPS)

        x, y, z = ball_data[i]
        if math.isnan(x) or math.isnan(y) or math.isnan(z):
            continue

        speed = None
        if speed_data is not None and i < len(speed_data):
            s_val = speed_data[i]
            if not math.isnan(s_val):
                speed = float(s_val)

        bulk_data.append({
            "match_id": match_id,
            "frame": g_frame,
            "t_sec": t_s,
            "x": float(x),
            "y": float(y),
            "z": float(z),
            "speed": speed,
            "confidence": 1.0,
        })

    if bulk_data:
        db.execute(insert(BallTraj), bulk_data)


def import_set(db, match_id: int, set_dir: str, rally_index_offset: int = 0) -> int:
    rally_csv = os.path.join(set_dir, "RallySeg.csv")
    if not os.path.exists(rally_csv):
        raise FileNotFoundError(f"Missing {rally_csv}")

    rally_df = pd.read_csv(rally_csv)
    rally_df = rally_df.sort_values(by=["Start", "End"]).reset_index(drop=True)

    score_to_rally_id: dict[str, int] = {}

    for i, row in rally_df.iterrows():
        score = _safe_str(row.get("Score"), default=f"rally_{i}")
        start_f = _safe_int(row.get("Start"), 0)
        end_f = _safe_int(row.get("End"), start_f)

        rally = Rally(
            match_id=match_id,
            rally_index=rally_index_offset + i + 1,
            start_frame=start_f,
            end_frame=end_f,
            status="unchecked",
        )
        db.add(rally)
        db.flush()
        score_to_rally_id[score] = rally.id

        import_ball_trajectory_for_rally(db, match_id, score, start_f)

    shot_csv = os.path.join(set_dir, "shot_annotated.csv")
    if os.path.exists(shot_csv):
        shot_df = pd.read_csv(shot_csv)
        for _, row in shot_df.iterrows():
            rally_key = _safe_str(row.get("Rally"), "")
            rally_id = score_to_rally_id.get(rally_key)
            if rally_id is None:
                continue

            hit = Hit(
                match_id=match_id,
                rally_id=rally_id,
                ball_round=_safe_int(row.get("Ball Round"), 1),
                player=_safe_str(row.get("player"), "Up"),
                hit_frame=_safe_int(row.get("Hit Frame"), 0),
                new_hit_frame=_safe_int(row.get("New Hit Frame")),
                shot_type=_safe_str(row.get("Shot Type"), "Unknown"),
                hand=_safe_str(row.get("Hand"), "Unknown"),
                note=_safe_str(row.get("Note"), ""),
                confidence=1.0,
            )
            db.add(hit)

    return len(rally_df)


def main():
    db = SessionLocal()
    try:
        set_dirs = get_set_dirs(DATA_ROOT)
        if not set_dirs:
            raise FileNotFoundError(f"No valid set folder found under {DATA_ROOT}")

        duration_frame = get_match_duration_frame(set_dirs)

        match = Match(
            title="12_24_1_new",
            fps=FPS,
            duration_frame=duration_frame,
            cameras=[],
        )
        db.add(match)
        db.commit()
        db.refresh(match)

        offset = 0
        for set_dir in set_dirs:
            offset += import_set(db, match.id, set_dir, rally_index_offset=offset)
            db.commit()

        print(f"✅ Imported match_id={match.id}, rallies_total={offset}, duration_frame={duration_frame}")
    finally:
        db.close()


if __name__ == "__main__":
    main()

