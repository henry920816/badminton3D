"""Non-destructive multi-view reconstruction for one rally.

All coordinates use the raw camera/ball coordinate system. Predicted pixels are
never fed back as independent observations; only saved/observed 2D labels count.
No artificial smoothing is performed through a hit or a missing interval.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from itertools import combinations

import numpy as np
from scipy.optimize import least_squares

from .triangulation import (
    _normalized_observation,
    _projection_from_camera,
    project_raw_point,
    triangulate_observations,
)

MAX_RALLY_FRAMES = 1500
MAX_PAIR_SEEDS = 30
INLIER_PX = 12.0
AUTO_RMS_PX = 6.0
AUTO_MAX_PX = 12.0
AUTO_STD_METERS = 0.08
AUTO_ANGLE_DEGREES = 3.0
MAX_AUTOMATIC_SHIFT_METERS = 0.75
SPIKE_THRESHOLD_METERS = 0.32
# Strictly a safety bound, NOT a smoothing model. Dataset positions are metres.
MAX_PLAUSIBLE_SHUTTLE_SPEED_MPS = 170.0


def fingerprint(cameras, observations, originals, hit_frames, fps):
    """Reject a save if any input used by the preview has since changed."""
    blob = json.dumps(
        {"cameras": cameras, "observations": observations,
         "originals": originals, "hits": hit_frames, "fps": fps},
        sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _point_array(p):
    return np.asarray([p["x"], p["y"], p["z"]], dtype=np.float64)


def _pixels(point, cameras, observations):
    residuals = []
    for obs in observations:
        c = cameras[obs["camera_index"]]
        try:
            projected = project_raw_point(point, c)
        except (ValueError, np.linalg.LinAlgError, OverflowError):
            projected = None
        if projected is None:
            residuals.append((obs, None, float("inf")))
        else:
            d = math.hypot(projected["x"] - obs["x"], projected["y"] - obs["y"])
            residuals.append((obs, projected, d))
    return residuals


def _rays(cameras, observations):
    rays = []
    for obs in observations:
        try:
            p = _projection_from_camera(cameras[obs["camera_index"]])
            x, y = _normalized_observation(obs, p)
            ext = p["raw_extrinsic"]
            direction = np.linalg.solve(ext[:, :3], np.array([x, y, 1.0]))
            norm = np.linalg.norm(direction)
            if norm <= 1e-12:
                continue
            rays.append((obs["camera_index"], direction / norm,
                         np.linalg.solve(ext[:, :3], -ext[:, 3])))
        except (ValueError, np.linalg.LinAlgError, OverflowError):
            continue
    return rays


def _max_ray_angle(rays):
    return max((math.degrees(math.acos(float(np.clip(
        abs(np.dot(a[1], b[1])), 0.0, 1.0
    )))) for a, b in combinations(rays, 2)), default=0.0)


def _optimize(initial, cameras, observations):
    """Robust nonlinear reprojection adjustment, using real detected 2D only."""
    x0 = _point_array(initial)

    def residual(x):
        p = {"x": float(x[0]), "y": float(x[1]), "z": float(x[2])}
        result = []
        for obs in observations:
            projected = project_raw_point(p, cameras[obs["camera_index"]])
            if projected is None:
                # Stay finite on the wrong side of any camera.
                result.extend((1e4, 1e4))
            else:
                result.extend((projected["x"] - obs["x"],
                               projected["y"] - obs["y"]))
        return np.asarray(result, dtype=np.float64)

    result = least_squares(residual, x0, loss="huber", f_scale=4.0,
                           max_nfev=60, x_scale="jac")
    if not result.success and np.linalg.norm(result.fun) > 50:
        return None
    if not np.isfinite(result.x).all():
        return None
    fitted = dict(zip(("x", "y", "z"), (float(v) for v in result.x)))
    # An indication of triangulation precision rather than calibrated uncertainty.
    try:
        j = result.jac
        normal = j.T @ j
        if np.linalg.cond(normal) > 1e10:
            std = float("inf")
        else:
            eigenvalues = np.linalg.eigvalsh(np.linalg.inv(normal))
            std = float(3.0 * math.sqrt(max(float(eigenvalues[-1]), 0.0)))
    except (ValueError, np.linalg.LinAlgError):
        std = float("inf")
    return fitted, std



def _independent_holdout_errors(point, cameras, selected):
    """Validate a subset of inlier cameras by reconstructing WITHOUT their 2D.

    The held-out pixel is never included in the fit being evaluated. It is an
    internal consistency check, not a ground-truth accuracy guarantee. Limit
    work to four well-spread views so a ten-camera rally stays interactive.
    """
    if len(selected) < 4:
        return {}
    choices = np.linspace(0, len(selected) - 1, min(4, len(selected)), dtype=int)
    errors = {}
    for position in dict.fromkeys(int(index) for index in choices):
        heldout = selected[position]
        fit = [obs for index, obs in enumerate(selected) if index != position]
        try:
            solution = _optimize(point, cameras, fit)
            if solution is None:
                continue
            prediction = project_raw_point(solution[0], cameras[heldout["camera_index"]])
            if prediction is None:
                continue
            err = math.hypot(prediction["x"] - heldout["x"],
                             prediction["y"] - heldout["y"])
            if math.isfinite(err):
                errors[heldout["camera_index"]] = float(err)
        except (ValueError, np.linalg.LinAlgError, OverflowError, FloatingPointError):
            continue
    return errors


def reconstruct_frame(cameras: dict, observations: list, original=None):
    """Return a reviewable candidate and cross-view diagnostics for one frame."""
    valid = {}
    for item in observations:
        try:
            index = int(item["camera_index"])
            x, y = float(item["x"]), float(item["y"])
            if index not in cameras or not math.isfinite(x) or not math.isfinite(y):
                continue
            _projection_from_camera(cameras[index])
            valid[index] = {"camera_index": index, "x": x, "y": y,
                            "corrected": bool(item.get("corrected"))}
        except (TypeError, ValueError, np.linalg.LinAlgError):
            continue

    observations = [valid[i] for i in sorted(valid)]
    if len(observations) < 2:
        return {"status": "insufficient_views", "reason": "少於兩個有效 2D 視角",
                "observed_views": len(observations), "view_diagnostics": []}

    camera_rays = _rays(cameras, observations)
    rays = {r[0]: r for r in camera_rays}
    seeds = []
    for pair in combinations(observations, 2):
        a, b = pair
        if a["camera_index"] not in rays or b["camera_index"] not in rays:
            continue
        angle = _max_ray_angle([rays[a["camera_index"]], rays[b["camera_index"]]])
        if angle < 1.0:
            continue
        seeds.append((angle, pair))
    seeds.sort(key=lambda entry: -entry[0])
    if not seeds:
        return {"status": "weak_geometry", "reason": "相機視線夾角不足",
                "observed_views": len(observations), "view_diagnostics": []}

    best = None
    for _, pair in seeds[:MAX_PAIR_SEEDS]:
        try:
            tri = triangulate_observations(cameras, list(pair))
        except (ValueError, np.linalg.LinAlgError, FloatingPointError, OverflowError):
            continue
        if tri["max_error"] > INLIER_PX:
            continue
        err = _pixels(tri["point"], cameras, observations)
        inliers = [obs for obs, _, e in err if e <= INLIER_PX]
        if len(inliers) < 2:
            continue
        score = (len(inliers), -sum(e for _, _, e in err if e <= INLIER_PX))
        if best is None or score > best[0]:
            best = (score, tri["point"], inliers)

    if best is None:
        return {"status": "no_consensus", "reason": "沒有幾何一致的相機組合",
                "observed_views": len(observations), "view_diagnostics": []}

    selected = best[2]
    fitted = _optimize(best[1], cameras, selected)
    if fitted is None:
        return {"status": "solver_failed", "reason": "聯合最佳化未收斂",
                "observed_views": len(observations), "view_diagnostics": []}
    point, std = fitted

    # A secondary robust inlier pass catches points shifted by the refit.
    refined = [obs for obs, _, error in _pixels(point, cameras, observations)
               if error <= INLIER_PX]
    if set(o["camera_index"] for o in refined) != set(o["camera_index"] for o in selected):
        again = _optimize(point, cameras, refined) if len(refined) >= 2 else None
        if again is not None:
            point, std = again
            selected = refined

    inlier_ids = {obs["camera_index"] for obs in selected}
    holdout = _independent_holdout_errors(point, cameras, selected)
    holdout_max = max(holdout.values(), default=None)
    holdout_rms = (math.sqrt(sum(e * e for e in holdout.values()) / len(holdout))
                   if holdout else None)
    diagnostics = []
    for obs, projected, err in _pixels(point, cameras, observations):
        diagnostics.append({
            "camera_index": obs["camera_index"],
            "observed": [obs["x"], obs["y"]],
            "projected": [projected["x"], projected["y"]] if projected else None,
            "residual_px": round(err, 3) if math.isfinite(err) else None,
            "inlier": obs["camera_index"] in inlier_ids,
            "corrected": obs.get("corrected", False),
            "prediction_is_observation": False,
            "heldout_residual_px": round(holdout[obs["camera_index"]], 3)
            if obs["camera_index"] in holdout else None,
        })

    # Independent view predictions are *diagnostics*, never written as 2D labels.
    ray_angle = _max_ray_angle([rays[i] for i in inlier_ids if i in rays])
    chosen_errors = [d["residual_px"] for d in diagnostics
                     if d["inlier"] and d["residual_px"] is not None]
    rms = float(math.sqrt(sum(e * e for e in chosen_errors) / len(chosen_errors)))
    max_error = max(chosen_errors)
    independent = [d for d in diagnostics if not d["inlier"]]
    recommendation = max(independent, key=lambda d: d["residual_px"] or -1,
                         default=None)
    # Missing views are candidates for *manual/image-based* verification,
    # especially when their new ray would improve depth geometry. A predicted
    # pixel coordinate is never converted into an independent observation.
    suggested_views = []
    for index, camera in cameras.items():
        if index in valid:
            continue
        try:
            projected = project_raw_point(point, camera)
            if projected is None:
                continue
            params = camera.get("projection", {})
            width = params.get("imageWidth", params.get("image_width", 1920))
            height = params.get("imageHeight", params.get("image_height", 1200))
            if not 0 <= projected["x"] < float(width) or not 0 <= projected["y"] < float(height):
                continue
            p = _projection_from_camera(camera)["raw_extrinsic"]
            origin = np.linalg.solve(p[:, :3], -p[:, 3])
            direction = _point_array(point) - origin
            direction /= np.linalg.norm(direction)
            angles = [math.degrees(math.acos(float(np.clip(abs(np.dot(direction, ray[1])), 0., 1.))))
                      for ray in camera_rays if ray[0] in inlier_ids]
            gain = max(angles, default=0.)
            suggested_views.append({"camera_index": index,
                                    "pixel": [round(projected["x"], 2), round(projected["y"], 2)],
                                    "max_ray_angle_degrees": round(gain, 2),
                                    "prediction_is_observation": False})
        except (TypeError, ValueError, np.linalg.LinAlgError):
            continue
    suggested_views.sort(key=lambda r: -r["max_ray_angle_degrees"])
    if recommendation is None and suggested_views:
        recommendation = suggested_views[0]
    status = "review"
    reason = "可重建，但證據不足以自動採用"
    if (len(selected) >= 4 and rms <= AUTO_RMS_PX
            and max_error <= AUTO_MAX_PX and std <= AUTO_STD_METERS
            and ray_angle >= AUTO_ANGLE_DEGREES
            and len(holdout) >= min(4, len(selected))
            and holdout_max is not None and holdout_max <= AUTO_MAX_PX
            and holdout_rms is not None and holdout_rms <= AUTO_RMS_PX):
        status = "auto"
        reason = "至少四個幾何可靠的視角支持，重投影與不確定性通過門檻"

    # A large deviation from existing 3D is worth showing to a human first.
    shift = None
    if original is not None:
        shift = float(np.linalg.norm(_point_array(point) - _point_array(original)))
        original_errors = [e for _, _, e in _pixels(original, cameras, selected)
                           if math.isfinite(e)]
        original_rms = math.sqrt(sum(v * v for v in original_errors) / len(original_errors)) \
            if original_errors else float("inf")
        # If existing 3D already agrees with all selected camera observations,
        # do not replace it merely to chase a slightly smaller fitting residual.
        # This avoids needless changes to a physically smooth source track.
        if original_rms <= AUTO_RMS_PX and max(original_errors, default=float("inf")) <= AUTO_MAX_PX:
            status = "keep"
            reason = "原始 3D 投影已符合可靠的 2D 觀測，優先保留原始軌跡"
        elif shift > MAX_AUTOMATIC_SHIFT_METERS and status == "auto":
            status = "review"
            reason = "與原始 3D 偏差超過自動修正的安全範圍"

    return {
        "status": status, "reason": reason, "point": point,
        "observed_views": len(observations), "inlier_views": len(inlier_ids),
        "rms_px": round(rms, 4), "max_px": round(max_error, 4),
        "angle_degrees": round(ray_angle, 3),
        "estimated_sigma_m": round(std, 5) if math.isfinite(std) else None,
        "heldout_rms_px": round(holdout_rms, 4) if holdout_rms is not None else None,
        "heldout_max_px": round(holdout_max, 4) if holdout_max is not None else None,
        "heldout_views": len(holdout),
        "shift_from_original_m": round(shift, 4) if shift is not None else None,
        "view_diagnostics": diagnostics,
        "suggested_views": suggested_views,
        "recommended_camera": recommendation["camera_index"] if recommendation else None,
    }


def analyze_range(cameras, observations, originals, hits, start, end, fps):
    """Batch per-frame solve, followed by temporal safeguards within a flight."""
    by_frame = defaultdict(list)
    for row in observations:
        by_frame[int(row["frame"])].append(row)
    results = []
    by_frame_result = {}
    for frame in range(start, end + 1):
        result = reconstruct_frame(cameras, by_frame.get(frame, []), originals.get(frame))
        result["frame"] = frame
        results.append(result)
        by_frame_result[frame] = result

    # Never temporal-interpolate or smooth through a hit; reject suspicious
    # second differences rather than inventing positions in empty frames.
    hit_set = set(int(h) for h in hits)
    for r in results:
        if r["status"] != "auto":
            continue
        frame = r["frame"]
        if any(abs(frame - h) <= 2 for h in hit_set):
            r["status"] = "review"
            r["reason"] = "靠近擊球位置，需確認是否有急遽速度變化"
            continue
        prev = by_frame_result.get(frame - 1, {})
        nxt = by_frame_result.get(frame + 1, {})
        if "point" not in prev or "point" not in nxt:
            continue
        if prev.get("inlier_views", 0) < 3 or nxt.get("inlier_views", 0) < 3:
            continue
        if any(abs(h - frame) <= 3 for h in hit_set):
            continue
        spike = np.linalg.norm(
            _point_array(prev["point"]) - 2 * _point_array(r["point"]) +
            _point_array(nxt["point"])
        )
        if spike > SPIKE_THRESHOLD_METERS:
            r["status"] = "review"
            r["reason"] = "相鄰三幀的 3D 軌跡出現不合理跳動"

    # Screen impossible jumps even for high-view-count solutions. A set of
    # mutually consistent 2D outliers can still produce a bad 3D point.
    # Unlike interpolation this never overwrites or invents coordinates.
    if fps and fps > 0:
        for left, right in zip(results, results[1:]):
            if (right["frame"] != left["frame"] + 1
                    or "point" not in left or "point" not in right):
                continue
            speed = float(np.linalg.norm(
                _point_array(right["point"]) - _point_array(left["point"])
            ) * fps)
            if not math.isfinite(speed) or speed > MAX_PLAUSIBLE_SHUTTLE_SPEED_MPS:
                for candidate in (left, right):
                    if candidate["status"] == "auto":
                        candidate["status"] = "review"
                        candidate["reason"] = (
                            "與相鄰幀的候選形成不合理的高速跳躍，禁止自動儲存"
                        )
                        candidate["temporal_speed_mps"] = round(speed, 2)

    counters = defaultdict(int)
    for r in results:
        counters[r["status"]] += 1
    return {"frames": results, "summary": dict(counters),
            "total_frames": end - start + 1,
            "auto_frames": counters["auto"],
            "review_frames": counters["review"]}
