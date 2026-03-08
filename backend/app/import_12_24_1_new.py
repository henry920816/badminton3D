from __future__ import annotations

import os
import math
import pandas as pd
import numpy as np
from sqlalchemy import insert

from app.db import SessionLocal
from app.models import Match, Rally, Hit, BallTraj

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


def import_ball_trajectory_for_rally(db, match_id: int, score: str, start_frame: int, set_name: str):
    """
    從 .npy 檔案中批量匯入 (Bulk Insert) 有效的 3D 軌跡點。
    - 這裡假設檔案都在 DATA_ROOT/ball_new/... 與 DATA_ROOT/ball_final_mask_new/... 資料夾中
    - 僅取出 mask == 1 的座標
    """
    # 根據 set_name 找出實際要裝載的 npy 資料夾 (對應到您的目錄結構 "12_24_1_setX")
    # 注意: .ipynb 中提到的資料名稱為 "241217_1" 或 "241224_1"，您可以根據實際放 dataset 的位置做微調
    # DATA_ROOT 為 /app/app/datasets/12_24_1_new，但軌跡可能放在 /app/app/datasets/ball_new/241224_1
    dataset_base = os.path.dirname(DATA_ROOT)  # 等於 /app/app/datasets
    
    # 這裡資料夾都放在 241224_1 裡面
    npy_folder = "241224_1"
    
    file_name = f"{score}.npy"
    ball_path = os.path.join(dataset_base, "ball_new", npy_folder, file_name)
    mask_path = os.path.join(dataset_base, "ball_final_mask_new", npy_folder, file_name)
    speed_path = os.path.join(dataset_base, "ball_speed", npy_folder, file_name)

    if not (os.path.exists(ball_path) and os.path.exists(mask_path)):
        # print(f"Warning: Missing trajectory or mask file for {score}")
        return

    try:
        ball_data = np.load(ball_path)
        mask_data = np.load(mask_path)
        if os.path.exists(speed_path):
            speed_data = np.load(speed_path)
        else:
            speed_data = None
    except Exception as e:
        print(f"Error loading {file_name}: {e}")
        return

    # 找出所有 mask_data == 1 的索引位置陣列 -> (0, 3, 4, ...)
    valid_indices = np.where(mask_data == 1)[0]
    
    if len(valid_indices) == 0:
        return

    bulk_data = []
    
    # 依序計算每一個有效點位對應哪一個全域影格，並整理成 dict 將被 insert
    for idx_val in valid_indices:
        i = int(idx_val)
        g_frame = start_frame + i
        t_s = float(g_frame / FPS)
        
        x, y, z = ball_data[i]
        
        # 讀取球速
        speed = None
        if speed_data is not None and i < len(speed_data):
            s_val = speed_data[i]
            if not math.isnan(s_val):
                speed = float(s_val)

        # 過濾不合理的 nan 或極端值如果需要，亦可略過
        if math.isnan(x) or math.isnan(y) or math.isnan(z):
            continue

        bulk_data.append({
            "match_id": match_id,
            "frame": g_frame,
            "t_sec": t_s,
            "x": float(x),
            "y": float(y),
            "z": float(z),
            "speed": speed,
            "confidence": 1.0
        })

    # 使用 SQLAlchemy 批量插入功能，可以一次幾以千計地寫入 db！大大提升效能。
    if bulk_data:
        db.execute(insert(BallTraj), bulk_data)


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
        
        # ✅ 從這裡呼叫匯入軌跡的副程式！
        # set_dir 最後一個部位名稱剛好對應到像 "12_24_1_set1" (os.path.basename)
        set_name = os.path.basename(os.path.normpath(set_dir))
        import_ball_trajectory_for_rally(db, match_id, score, start_f, set_name)

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
            duration_frame=26296,
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
