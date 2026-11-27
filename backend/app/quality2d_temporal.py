"""Independent 2D time-continuity evidence for quality checks and safe auto repair.

Per-camera, same-rally neighboring observations only. A temporal residual alone
never certifies a true shuttle position; especially avoid forcing an auto fix
at hit points or with unavailable neighbors. No source data is mutated.
"""

import math


def _observed_points(observations_by_frame: dict, frame: int, camera_index: int) -> dict:
    points = {}
    for f in range(frame - 2, frame + 3):
        for observation in observations_by_frame.get(f, []):
            if int(observation.get("camera_index", -1)) != camera_index:
                continue
            try:
                x = float(observation["x"])
                y = float(observation["y"])
                if observation.get("visibility", 1) > 0 and math.isfinite(x) and math.isfinite(y):
                    points[f] = (x, y)
            except (KeyError, ValueError, TypeError):
                pass
    return points


def _interpolation(points: dict, frame: int):
    before = [f for f in points if f < frame]
    after = [f for f in points if f > frame]
    if not before or not after:
        return None
    left = max(before)
    right = min(after)
    if right - left > 4:
        return None
    x1, y1 = points[left]
    x2, y2 = points[right]
    fraction = (frame - left) / (right - left)
    px = x1 + (x2 - x1) * fraction
    py = y1 + (y2 - y1) * fraction
    travel = math.hypot(x2 - x1, y2 - y1)
    # Faster shuttle movement must be allowed a larger predicted deviation;
    # this is a conservative warning guard, not a motion physics model.
    threshold = max(50.0, travel * 1.5)
    return px, py, threshold, (left, right)


def assess_temporal_candidate(observations_by_frame: dict, frame: int,
                              camera_index: int, candidate: dict) -> dict:
    points = _observed_points(observations_by_frame, frame, camera_index)
    interpolation = _interpolation(points, frame)
    if interpolation is None:
        return {"status": "insufficient", "reason": "缺少前後影格，無法獨立驗證"}
    px, py, threshold, neighbors = interpolation
    new_error = math.hypot(float(candidate["x"]) - px, float(candidate["y"]) - py)
    original = points.get(frame)
    old_error = math.hypot(original[0] - px, original[1] - py) if original else None
    if new_error > threshold and (old_error is None or new_error > old_error + 15.0):
        status, reason = "review", "幾何修正候選與前後影格強烈衝突，需人工檢查影片"
    else:
        status, reason = "pass", "候選未與前後影格明顯衝突"
    return {
        "status": status, "reason": reason, "estimated_x": round(px, 2),
        "estimated_y": round(py, 2), "candidate_error_px": round(new_error, 2),
        "original_error_px": round(old_error, 2) if old_error is not None else None,
        "threshold_px": round(threshold, 2), "neighbor_frames": list(neighbors),
    }


def attach_temporal_evidence(grid: list[dict], observations_by_frame: dict) -> list[dict]:
    """Annotate grid with independent temporal warnings without overriding trusted 3D.

    Single-frame spikes may downgrade `ok` to `suspect`; they never force Bad
    or claim a precise new shuttle position.
    """
    for frame_row in grid:
        frame = int(frame_row["frame"])
        for item in frame_row.get("cameras", []):
            if item.get("status") == "no_data":
                continue
            camera_index = int(item["camera_index"])
            points = _observed_points(observations_by_frame, frame, camera_index)
            interpolation = _interpolation(points, frame)
            if interpolation is None or frame not in points:
                item["temporal_status"] = "insufficient"
                item["temporal_error_px"] = None
                continue
            px, py, threshold, neighbors = interpolation
            x, y = points[frame]
            error = math.hypot(x - px, y - py)
            item["temporal_error_px"] = round(error, 3)
            item["temporal_neighbor_frames"] = list(neighbors)
            if error > max(100.0, threshold * 2.0):
                item["temporal_status"] = "spike"
                if item["status"] == "ok" and not item.get("original_3d_primary"):
                    item["status"] = "suspect"
                    item["detection_source"] = "temporal_cross_check"
                    item["reason"] = f"前後影格顯示孤立跳點（{error:.1f} px）；需核對是否為擊球或漏標。"
            else:
                item["temporal_status"] = "consistent"
        frame_row["ok_camera_count"] = sum(c.get("status") == "ok" for c in frame_row.get("cameras", []))
        frame_row["needs_review"] = any(c.get("status") in ("bad", "suspect", "unknown") for c in frame_row.get("cameras", []))
    return grid
