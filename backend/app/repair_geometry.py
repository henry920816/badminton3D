"""2D 修復候選的幾何運算。

只計算候選與誤差，不碰資料庫；真正寫入與復原由 auto_repair.py 負責。
"""

import math
from itertools import combinations

import numpy as np

from .models import BallPosition2D, Match
from .triangulation import project_raw_point, scan_2d_camera_grid, triangulate_observations
from .ball2d_reference import attach_reference_3d

PAIR_INLIER_THRESHOLD_PX = 30.0
LOO_BASE_THRESHOLD_PX = 45.0

def cameras_by_index_for_match(match: Match) -> dict[int, dict]:
    cameras = match.cameras if isinstance(match.cameras, list) else []
    result = {}

    for fallback_index, camera in enumerate(cameras):
        if not isinstance(camera, dict):
            continue
        try:
            result[int(camera.get("index", fallback_index))] = camera
        except (TypeError, ValueError):
            continue

    return result


def observation_dict(row: BallPosition2D) -> dict:
    return {
        "camera_index": int(row.camera_index),
        "x": float(row.x),
        "y": float(row.y),
    }


def status_map(grid_frame: dict) -> dict[int, str]:
    return {
        int(item["camera_index"]): str(item["status"])
        for item in (grid_frame.get("cameras") or [])
    }


def bad_count(statuses: dict[int, str]) -> int:
    return sum(1 for status in statuses.values() if status == "bad")


def single_frame_grid(
    cameras_by_index: dict[int, dict],
    observations: list[dict],
    frame: int,
    original_3d_point: dict | None = None,
) -> dict:
    grid = scan_2d_camera_grid(
        cameras_by_index,
        {frame: observations},
        frame,
        frame,
    )
    return attach_reference_3d(
        grid, cameras_by_index, {frame: observations},
        {frame: original_3d_point} if original_3d_point is not None else {},
    )[0]


def projection_error(point: dict, camera: dict, observation: dict) -> float | None:
    projected = project_raw_point(point, camera)

    if projected is None:
        return None

    dx = float(projected["x"]) - float(observation["x"])
    dy = float(projected["y"]) - float(observation["y"])
    error = math.sqrt(dx * dx + dy * dy)

    return float(error) if math.isfinite(error) else None


def camera_image_bounds(camera: dict) -> tuple[float, float]:
    projection = camera.get("projection") if isinstance(camera, dict) else None

    if not isinstance(projection, dict):
        return 1920.0, 1200.0

    width = projection.get("imageWidth", projection.get("image_width", 1920.0))
    height = projection.get("imageHeight", projection.get("image_height", 1200.0))

    try:
        width = float(width)
        height = float(height)
    except (TypeError, ValueError):
        return 1920.0, 1200.0

    if (
        width <= 0
        or height <= 0
        or not math.isfinite(width)
        or not math.isfinite(height)
    ):
        return 1920.0, 1200.0

    return width, height


def project_inside_image(point: dict, camera: dict) -> dict | None:
    projected = project_raw_point(point, camera)

    if projected is None:
        return None

    x = float(projected["x"])
    y = float(projected["y"])
    width, height = camera_image_bounds(camera)

    if (
        not math.isfinite(x)
        or not math.isfinite(y)
        or x < 0
        or x > width
        or y < 0
        or y > height
    ):
        return None

    return {
        "x": x,
        "y": y,
        "depth": float(projected["depth"]),
    }


def robust_threshold(errors: list[float], minimum: float) -> float:
    if not errors:
        return minimum

    values = np.asarray(errors, dtype=np.float64)
    median = float(np.median(values))
    mad = float(np.median(np.abs(values - median)))
    robust_sigma = 1.4826 * mad

    return float(max(minimum, median + 4.0 * robust_sigma))


def leave_one_out_errors(
    cameras_by_index: dict[int, dict],
    observations: list[dict],
) -> list[dict]:
    if len(observations) < 3:
        return []

    by_camera = {
        int(item["camera_index"]): item
        for item in observations
    }
    results = []

    for camera_index in sorted(by_camera):
        others = [
            observation
            for other_index, observation in by_camera.items()
            if other_index != camera_index
        ]

        if len(others) < 2:
            continue

        try:
            reconstruction = triangulate_observations(cameras_by_index, others)
        except ValueError:
            continue

        camera = cameras_by_index.get(camera_index)
        if camera is None:
            continue

        error = projection_error(
            reconstruction["point"],
            camera,
            by_camera[camera_index],
        )

        if error is not None:
            results.append(
                {
                    "camera_index": camera_index,
                    "pixel_error": error,
                }
            )

    return results


def ransac_consensus_observations(
    cameras_by_index: dict[int, dict],
    observations: list[dict],
) -> tuple[list[dict], dict | None]:
    if len(observations) < 3:
        return observations, None

    by_camera = {
        int(item["camera_index"]): item
        for item in observations
    }
    best = None

    for first_index, second_index in combinations(sorted(by_camera), 2):
        pair = [by_camera[first_index], by_camera[second_index]]

        try:
            result = triangulate_observations(cameras_by_index, pair)
        except ValueError:
            continue

        errors = {}

        for camera_index in sorted(by_camera):
            camera = cameras_by_index.get(camera_index)
            if camera is None:
                continue

            error = projection_error(
                result["point"],
                camera,
                by_camera[camera_index],
            )

            if error is not None:
                errors[camera_index] = error

        inliers = [
            camera_index
            for camera_index, error in errors.items()
            if error <= PAIR_INLIER_THRESHOLD_PX
        ]

        if len(inliers) < 3:
            continue

        median_error = float(
            np.median([errors[camera_index] for camera_index in inliers])
        )

        candidate = {
            "pair": [first_index, second_index],
            "inlier_indices": inliers,
            "inlier_count": len(inliers),
            "median_inlier_error": median_error,
        }

        if (
            best is None
            or candidate["inlier_count"] > best["inlier_count"]
            or (
                candidate["inlier_count"] == best["inlier_count"]
                and candidate["median_inlier_error"] < best["median_inlier_error"]
            )
        ):
            best = candidate

    if best is None:
        return observations, None

    return [by_camera[index] for index in best["inlier_indices"]], best


def robust_multiview_candidate(
    cameras_by_index: dict[int, dict],
    observations: list[dict],
) -> dict | None:
    if len(observations) < 3:
        return None

    selected, ransac = ransac_consensus_observations(
        cameras_by_index,
        observations,
    )

    if len(selected) < 3:
        return None

    working = [dict(item) for item in selected]
    removed = []

    while len(working) > 3:
        loo = leave_one_out_errors(cameras_by_index, working)

        if len(loo) != len(working):
            break

        threshold = robust_threshold(
            [float(item["pixel_error"]) for item in loo],
            LOO_BASE_THRESHOLD_PX,
        )
        worst = max(loo, key=lambda item: item["pixel_error"])

        if float(worst["pixel_error"]) <= threshold:
            break

        worst_index = int(worst["camera_index"])
        working = [
            item
            for item in working
            if int(item["camera_index"]) != worst_index
        ]
        removed.append(
            {
                "camera_index": worst_index,
                "pixel_error": float(worst["pixel_error"]),
                "threshold": threshold,
            }
        )

    final_loo = leave_one_out_errors(cameras_by_index, working)

    if len(final_loo) != len(working):
        return None

    final_errors = [float(item["pixel_error"]) for item in final_loo]
    final_threshold = robust_threshold(final_errors, LOO_BASE_THRESHOLD_PX)

    # 只擋明顯崩掉，不把它當一般 RMS 生死線。
    if final_errors and max(final_errors) > max(90.0, final_threshold):
        return None

    try:
        reconstruction = triangulate_observations(
            cameras_by_index,
            working,
        )
    except ValueError:
        return None

    return {
        "mode": "multiview",
        "point": reconstruction["point"],
        "reliable_camera_indices": [
            int(item["camera_index"])
            for item in working
        ],
        "rms_error": float(reconstruction["rms_error"]),
        "max_error": float(reconstruction["max_error"]),
        "condition_ratio": float(reconstruction["condition_ratio"]),
        "loo": final_loo,
        "ransac": ransac,
        "removed_cameras": removed,
    }


def best_safe_replacement_subset(
    cameras_by_index: dict[int, dict],
    frame: int,
    frame_observations: dict[int, dict],
    candidate_bad_points: dict[int, dict],
    original_ok_indices: set[int],
    original_3d_point: dict | None = None,
) -> dict | None:
    candidate_indices = sorted(candidate_bad_points)

    if not candidate_indices:
        return None

    baseline_statuses = status_map(
        single_frame_grid(
            cameras_by_index,
            list(frame_observations.values()),
            frame,
            original_3d_point,
        )
    )
    baseline_bad_count = bad_count(baseline_statuses)
    best = None

    # 從一次修最多支 bad camera 的組合開始找。
    for subset_size in range(len(candidate_indices), 0, -1):
        for subset in combinations(candidate_indices, subset_size):
            trial_observations = {
                camera_index: dict(observation)
                for camera_index, observation in frame_observations.items()
            }

            for camera_index in subset:
                trial_observations[camera_index] = dict(
                    candidate_bad_points[camera_index]
                )

            trial_grid = single_frame_grid(
                cameras_by_index,
                list(trial_observations.values()),
                frame,
                original_3d_point,
            )
            trial_statuses = status_map(trial_grid)
            trial_bad_count = bad_count(trial_statuses)

            new_bad_on_original_ok = [
                camera_index
                for camera_index in original_ok_indices
                if trial_statuses.get(camera_index) != "ok"
            ]
            repaired_still_bad = [
                camera_index
                for camera_index in subset
                if trial_statuses.get(camera_index) != "ok"
            ]

            if new_bad_on_original_ok or repaired_still_bad:
                continue

            if trial_bad_count >= baseline_bad_count:
                continue

            candidate = {
                "camera_indices": list(subset),
                "observations": trial_observations,
                "statuses": trial_statuses,
                "bad_count": trial_bad_count,
            }

            if (
                best is None
                or len(candidate["camera_indices"]) > len(best["camera_indices"])
                or (
                    len(candidate["camera_indices"]) == len(best["camera_indices"])
                    and candidate["bad_count"] < best["bad_count"]
                )
            ):
                best = candidate

        if best is not None:
            break

    return best

