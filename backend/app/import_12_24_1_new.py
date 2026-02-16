from __future__ import annotations

import os
import math
import pandas as pd

from app.db import SessionLocal
from app.models import Match, Rally, Hit

# ✅ Docker container 內 dataset 確切位置
DATA_ROOT = "/app/app/datasets/12_24_1_new"

# ✅ 這份資料是 frame-based；Match.fps 會用來在 API 回傳時計算秒
FPS = 60.0


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


def import_set(db, match_id: int, set_dir: str, rally_index_offset: int = 0) -> int:
    rally_csv = os.path.join(set_dir, "RallySeg.csv")
    if not os.path.exists(rally_csv):
        raise FileNotFoundError(f"Missing {rally_csv}")

    rally_df = pd.read_csv(rally_csv)
    rally_df = rally_df.sort_values(by=["Start", "End"]).reset_index(drop=True)

    score_to_rally_id: dict[str, int] = {}

    # ---- rallies ----
    for i, row in rally_df.iterrows():
        score = _safe_str(row.get("Score"), default=f"rally_{i}")
        start_f = _safe_int(row.get("Start"), 0)
        end_f = _safe_int(row.get("End"), start_f)

        r = Rally(
            match_id=match_id,
            rally_index=rally_index_offset + i + 1,
            start_frame=start_f,
            end_frame=end_f,
            status="unchecked",
        )
        db.add(r)
        db.flush()
        score_to_rally_id[score] = r.id

    # ---- hits ----
    shot_csv = os.path.join(set_dir, "shot_annotated.csv")
    if os.path.exists(shot_csv):
        shot_df = pd.read_csv(shot_csv)

        for _, row in shot_df.iterrows():
            rally_key = _safe_str(row.get("Rally"), "")
            rally_id = score_to_rally_id.get(rally_key)
            if rally_id is None:
                continue

            h = Hit(
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
            db.add(h)

    return len(rally_df)


def main():
    db = SessionLocal()
    try:
        m = Match(
            title="12_24_1_new",
            fps=FPS,
            duration_sec=0.0,
            cameras=[],
        )
        db.add(m)
        db.commit()
        db.refresh(m)

        off = 0

        set1_dir = os.path.join(DATA_ROOT, "12_24_1_set1")
        off += import_set(db, m.id, set1_dir, rally_index_offset=off)
        db.commit()

        set2_dir = os.path.join(DATA_ROOT, "12_24_1_set2")
        off += import_set(db, m.id, set2_dir, rally_index_offset=off)
        db.commit()

        print(f"✅ Imported match_id={m.id}, rallies_total={off}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
