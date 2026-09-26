import math
from itertools import combinations
from typing import Any

import numpy as np


COORDINATE_SIGNS = {
    "raw": (1.0, 1.0, 1.0),
    "scene": (1.0, -1.0, -1.0),
    "flipZ": (1.0, 1.0, -1.0),
    "flipY": (1.0, -1.0, 1.0),
    "flipX": (-1.0, 1.0, 1.0),
    "flipXFlipZ": (-1.0, 1.0, -1.0),
    "flipXFlipYFlipZ": (-1.0, -1.0, -1.0),
}


def _finite_float(
    value: Any,
    label: str,
) -> float:
    try:
        result = float(value)
    except (
        TypeError,
        ValueError,
    ) as exc:
        raise ValueError(
            f"{label} 必須是數字"
        ) from exc

    if not math.isfinite(result):
        raise ValueError(
            f"{label} 必須是有效數字"
        )

    return result


def _projection_from_camera(
    camera: dict,
) -> dict:
    projection = camera.get(
        "projection"
    )

    if not isinstance(
        projection,
        dict,
    ):
        raise ValueError(
            "相機缺少 projection 參數"
        )

    try:
        intrinsic = np.asarray(
            projection.get(
                "intrinsic"
            ),
            dtype=np.float64,
        ).reshape(-1)
    except (
        TypeError,
        ValueError,
    ) as exc:
        raise ValueError(
            "相機 intrinsic 格式錯誤"
        ) from exc

    if (
        intrinsic.size != 9
        or not np.isfinite(
            intrinsic
        ).all()
    ):
        raise ValueError(
            "相機 intrinsic 必須包含 9 個有效數字"
        )

    try:
        extrinsic = np.asarray(
            projection.get(
                "extrinsic"
            ),
            dtype=np.float64,
        )
    except (
        TypeError,
        ValueError,
    ) as exc:
        raise ValueError(
            "相機 extrinsic 格式錯誤"
        ) from exc

    if (
        extrinsic.shape != (3, 4)
        or not np.isfinite(
            extrinsic
        ).all()
    ):
        raise ValueError(
            "相機 extrinsic 必須是有效的 3x4 矩陣"
        )

    focal_x = _finite_float(
        intrinsic[0],
        "focal_x",
    )
    focal_y = _finite_float(
        intrinsic[1],
        "focal_y",
    )

    if (
        abs(focal_x) <= 1e-12
        or abs(focal_y) <= 1e-12
    ):
        raise ValueError(
            "相機焦距不可為 0"
        )

    mode = str(
        projection.get(
            "coordinateMode",
            "raw",
        )
    )

    signs = COORDINATE_SIGNS.get(
        mode
    )

    if signs is None:
        raise ValueError(
            f"不支援的座標模式：{mode}"
        )

    coordinate_transform = np.diag(
        [
            signs[0],
            signs[1],
            signs[2],
            1.0,
        ]
    )

    return {
        "intrinsic": intrinsic,
        "extrinsic": extrinsic,
        "raw_extrinsic": (
            extrinsic
            @ coordinate_transform
        ),
        "u_offset": _finite_float(
            projection.get(
                "uOffset",
                0.0,
            ),
            "uOffset",
        ),
        "v_offset": _finite_float(
            projection.get(
                "vOffset",
                0.0,
            ),
            "vOffset",
        ),
        "use_distortion": bool(
            projection.get(
                "useLensDistortion",
                True,
            )
        ),
    }


def _undistort_normalized(
    distorted_x: float,
    distorted_y: float,
    intrinsic: np.ndarray,
    use_distortion: bool,
) -> tuple[float, float]:
    if not use_distortion:
        return (
            distorted_x,
            distorted_y,
        )

    (
        _,
        _,
        _,
        _,
        radial_1,
        radial_2,
        tangential_1,
        tangential_2,
        radial_3,
    ) = intrinsic.tolist()

    x = distorted_x
    y = distorted_y

    for _ in range(12):
        radius_squared = (
            x * x
            + y * y
        )
        radius_fourth = (
            radius_squared
            * radius_squared
        )
        radius_sixth = (
            radius_fourth
            * radius_squared
        )
        radial = (
            1.0
            + radial_1
            * radius_squared
            + radial_2
            * radius_fourth
            + radial_3
            * radius_sixth
        )

        if abs(radial) <= 1e-12:
            raise ValueError(
                "鏡頭畸變參數無法反算 2D 座標"
            )

        delta_x = (
            2.0
            * tangential_1
            * x
            * y
            + tangential_2
            * (
                radius_squared
                + 2.0
                * x
                * x
            )
        )
        delta_y = (
            tangential_1
            * (
                radius_squared
                + 2.0
                * y
                * y
            )
            + 2.0
            * tangential_2
            * x
            * y
        )

        next_x = (
            distorted_x
            - delta_x
        ) / radial
        next_y = (
            distorted_y
            - delta_y
        ) / radial

        if (
            abs(next_x - x)
            + abs(next_y - y)
            <= 1e-12
        ):
            x = next_x
            y = next_y
            break

        x = next_x
        y = next_y

    if (
        not math.isfinite(x)
        or not math.isfinite(y)
    ):
        raise ValueError(
            "2D 座標反畸變失敗"
        )

    return (
        x,
        y,
    )


def _normalized_observation(
    observation: dict,
    camera_projection: dict,
) -> tuple[float, float]:
    intrinsic = camera_projection[
        "intrinsic"
    ]
    focal_x = float(
        intrinsic[0]
    )
    focal_y = float(
        intrinsic[1]
    )
    center_x = float(
        intrinsic[2]
    )
    center_y = float(
        intrinsic[3]
    )

    pixel_x = _finite_float(
        observation.get("x"),
        "2D x",
    )
    pixel_y = _finite_float(
        observation.get("y"),
        "2D y",
    )

    distorted_x = (
        pixel_x
        - camera_projection["u_offset"]
        - center_x
    ) / focal_x
    distorted_y = (
        pixel_y
        - camera_projection["v_offset"]
        - center_y
    ) / focal_y

    return _undistort_normalized(
        distorted_x,
        distorted_y,
        intrinsic,
        camera_projection[
            "use_distortion"
        ],
    )


def project_raw_point(
    point: dict,
    camera: dict,
) -> dict | None:
    projection = _projection_from_camera(
        camera
    )
    raw_extrinsic = projection[
        "raw_extrinsic"
    ]
    homogeneous = np.asarray(
        [
            _finite_float(
                point.get("x"),
                "3D x",
            ),
            _finite_float(
                point.get("y"),
                "3D y",
            ),
            _finite_float(
                point.get("z"),
                "3D z",
            ),
            1.0,
        ],
        dtype=np.float64,
    )
    camera_point = (
        raw_extrinsic
        @ homogeneous
    )
    depth = float(
        camera_point[2]
    )

    if (
        not math.isfinite(depth)
        or depth <= 1e-9
    ):
        return None

    normalized_x = float(
        camera_point[0]
        / depth
    )
    normalized_y = float(
        camera_point[1]
        / depth
    )
    projected_x = normalized_x
    projected_y = normalized_y
    intrinsic = projection[
        "intrinsic"
    ]

    if projection[
        "use_distortion"
    ]:
        (
            _,
            _,
            _,
            _,
            radial_1,
            radial_2,
            tangential_1,
            tangential_2,
            radial_3,
        ) = intrinsic.tolist()
        radius_squared = (
            normalized_x
            * normalized_x
            + normalized_y
            * normalized_y
        )
        radius_fourth = (
            radius_squared
            * radius_squared
        )
        radius_sixth = (
            radius_fourth
            * radius_squared
        )
        radial = (
            1.0
            + radial_1
            * radius_squared
            + radial_2
            * radius_fourth
            + radial_3
            * radius_sixth
        )
        projected_x = (
            normalized_x
            * radial
            + 2.0
            * tangential_1
            * normalized_x
            * normalized_y
            + tangential_2
            * (
                radius_squared
                + 2.0
                * normalized_x
                * normalized_x
            )
        )
        projected_y = (
            normalized_y
            * radial
            + tangential_1
            * (
                radius_squared
                + 2.0
                * normalized_y
                * normalized_y
            )
            + 2.0
            * tangential_2
            * normalized_x
            * normalized_y
        )

    return {
        "x": (
            float(intrinsic[0])
            * projected_x
            + float(intrinsic[2])
            + projection["u_offset"]
        ),
        "y": (
            float(intrinsic[1])
            * projected_y
            + float(intrinsic[3])
            + projection["v_offset"]
        ),
        "depth": depth,
    }


def triangulate_observations(
    cameras_by_index: dict[int, dict],
    observations: list[dict],
) -> dict:
    unique_observations: dict[int, dict] = {}

    for observation in observations:
        camera_index = int(
            observation.get(
                "camera_index"
            )
        )
        unique_observations[
            camera_index
        ] = {
            "camera_index": camera_index,
            "x": _finite_float(
                observation.get("x"),
                "2D x",
            ),
            "y": _finite_float(
                observation.get("y"),
                "2D y",
            ),
        }

    if len(unique_observations) < 2:
        raise ValueError(
            "至少需要兩個不同相機的 2D 點"
        )

    equations = []
    resolved = []

    for camera_index in sorted(
        unique_observations
    ):
        camera = cameras_by_index.get(
            camera_index
        )

        if camera is None:
            raise ValueError(
                f"找不到 Cam {camera_index}"
            )

        observation = (
            unique_observations[
                camera_index
            ]
        )
        projection = (
            _projection_from_camera(
                camera
            )
        )
        normalized_x, normalized_y = (
            _normalized_observation(
                observation,
                projection,
            )
        )
        matrix = projection[
            "raw_extrinsic"
        ]

        equations.append(
            normalized_x
            * matrix[2]
            - matrix[0]
        )
        equations.append(
            normalized_y
            * matrix[2]
            - matrix[1]
        )
        resolved.append(
            (
                observation,
                camera,
            )
        )

    equation_matrix = np.asarray(
        equations,
        dtype=np.float64,
    )

    try:
        _, singular_values, vh = (
            np.linalg.svd(
                equation_matrix,
            )
        )
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            "2D 點無法進行三角化"
        ) from exc

    homogeneous = vh[-1]

    if (
        abs(float(homogeneous[3]))
        <= 1e-12
    ):
        raise ValueError(
            "相機視線幾乎平行，無法重建穩定的 3D 點"
        )

    raw_point = (
        homogeneous[:3]
        / homogeneous[3]
    )

    if not np.isfinite(
        raw_point
    ).all():
        raise ValueError(
            "三角化得到無效的 3D 座標"
        )

    point = {
        "x": float(raw_point[0]),
        "y": float(raw_point[1]),
        "z": float(raw_point[2]),
    }
    errors = []

    for observation, camera in resolved:
        projected = project_raw_point(
            point,
            camera,
        )

        if projected is None:
            raise ValueError(
                "重建點位於相機後方，請重新選取 2D 點"
            )

        error_x = (
            projected["x"]
            - observation["x"]
        )
        error_y = (
            projected["y"]
            - observation["y"]
        )
        pixel_error = math.sqrt(
            error_x * error_x
            + error_y * error_y
        )

        errors.append(
            {
                "camera_index": (
                    observation[
                        "camera_index"
                    ]
                ),
                "pixel_error": (
                    float(pixel_error)
                ),
                "projected_x": (
                    float(projected["x"])
                ),
                "projected_y": (
                    float(projected["y"])
                ),
            }
        )

    pixel_errors = [
        item["pixel_error"]
        for item in errors
    ]
    rms_error = math.sqrt(
        sum(
            value * value
            for value in pixel_errors
        )
        / len(pixel_errors)
    )

    condition_ratio = (
        float(
            singular_values[-1]
            / singular_values[-2]
        )
        if (
            len(singular_values) >= 2
            and abs(
                float(
                    singular_values[-2]
                )
            ) > 1e-12
        )
        else 1.0
    )

    return {
        "point": point,
        "reprojection": errors,
        "rms_error": float(
            rms_error
        ),
        "max_error": float(
            max(pixel_errors)
        ),
        "condition_ratio": (
            condition_ratio
        ),
        "observations": [
            unique_observations[index]
            for index in sorted(
                unique_observations
            )
        ],
    }


def pairwise_triangulation_diagnostics(
    cameras_by_index: dict[int, dict],
    observations: list[dict],
) -> dict:
    """Compare every two-camera reconstruction to identify an outlier view.

    A camera's score is the median distance between points reconstructed by
    pairs containing that camera and every other valid pair reconstruction.
    The median keeps one bad pair from making each otherwise-good camera look
    faulty.
    """
    observations_by_camera: dict[int, dict] = {}

    for observation in observations:
        camera_index = int(observation.get("camera_index"))
        observations_by_camera[camera_index] = {
            "camera_index": camera_index,
            "x": _finite_float(observation.get("x"), "2D x"),
            "y": _finite_float(observation.get("y"), "2D y"),
        }

    if len(observations_by_camera) < 3:
        raise ValueError("至少需要三個有效視角才能比較視角一致性")

    pairs = []
    skipped_pairs = []

    for first, second in combinations(sorted(observations_by_camera), 2):
        try:
            result = triangulate_observations(
                cameras_by_index,
                [observations_by_camera[first], observations_by_camera[second]],
            )
        except ValueError as exc:
            skipped_pairs.append({
                "camera_indices": [first, second],
                "reason": str(exc),
            })
            continue

        pairs.append({
            "camera_indices": [first, second],
            "point": result["point"],
            "rms_error": result["rms_error"],
            "max_error": result["max_error"],
            "condition_ratio": result["condition_ratio"],
        })

    if len(pairs) < 2:
        raise ValueError("有效的兩視角重建組合不足，無法比較 3D 位置差")

    points = np.asarray(
        [[item["point"][axis] for axis in ("x", "y", "z")] for item in pairs],
        dtype=np.float64,
    )
    consensus = np.median(points, axis=0)
    pair_distances = np.linalg.norm(points - consensus, axis=1)

    for pair, distance in zip(pairs, pair_distances):
        pair["distance_to_consensus"] = float(distance)

    camera_scores = []
    for camera_index in sorted(observations_by_camera):
        distances = [
            pair["distance_to_consensus"]
            for pair in pairs
            if camera_index in pair["camera_indices"]
        ]
        if not distances:
            continue
        camera_scores.append({
            "camera_index": camera_index,
            "pair_count": len(distances),
            "median_3d_difference": float(np.median(distances)),
            "mean_3d_difference": float(np.mean(distances)),
        })

    camera_scores.sort(
        key=lambda item: item["median_3d_difference"],
        reverse=True,
    )

    return {
        "pair_reconstructions": pairs,
        "camera_scores": camera_scores,
        "consensus_point": {
            "x": float(consensus[0]),
            "y": float(consensus[1]),
            "z": float(consensus[2]),
        },
        "suspected_camera_index": (
            camera_scores[0]["camera_index"] if camera_scores else None
        ),
        "skipped_pairs": skipped_pairs,
    }


DEFAULT_BAD_CAMERA_THRESHOLD_METERS = 0.3
MIN_AVAILABLE_CAMERAS = 3


QUALITY_REPROJECTION_THRESHOLD_PX = 12.0
QUALITY_MIN_RAY_ANGLE_DEGREES = 1.0


def _quality_pair_stable(cameras, pair):
    rays = []
    centers = []
    for observation in pair:
        projection = _projection_from_camera(cameras[observation["camera_index"]])
        x, y = _normalized_observation(observation, projection)
        matrix = projection["raw_extrinsic"]
        ray = np.linalg.solve(matrix[:, :3], np.asarray([x, y, 1.0]))
        ray /= np.linalg.norm(ray)
        rays.append(ray)
        centers.append(np.linalg.solve(matrix[:, :3], -matrix[:, 3]))
    if np.linalg.norm(centers[0] - centers[1]) < 1e-8:
        return False
    angle = math.degrees(math.acos(float(np.clip(abs(np.dot(*rays)), 0.0, 1.0))))
    return angle >= QUALITY_MIN_RAY_ANGLE_DEGREES


def pairwise_consensus_point(
    cameras_by_index: dict[int, dict],
    observations: list[dict],
    reprojection_threshold_px: float = QUALITY_REPROJECTION_THRESHOLD_PX,
) -> dict | None:
    """Reconstruct a frame from pairs supported by the other views.

    A pair containing an incorrect label can outnumber the correct pairs
    when only three cameras are available. Require a third agreeing view
    whenever there are at least three observations, and only use candidates
    with the largest camera support for the median.
    """
    observations_by_camera: dict[int, dict] = {}

    for observation in observations:
        camera_index = int(observation.get("camera_index"))
        if camera_index not in cameras_by_index:
            continue
        try:
            observations_by_camera[camera_index] = {
                "camera_index": camera_index,
                "x": _finite_float(observation.get("x"), "2D x"),
                "y": _finite_float(observation.get("y"), "2D y"),
            }
        except ValueError:
            continue

    candidates = []

    for pair in combinations(
        [observations_by_camera[index] for index in sorted(observations_by_camera)],
        2,
    ):
        try:
            # 兩條視線幾乎平行時，深度方向會被雜訊放大到幾公尺
            if not _quality_pair_stable(cameras_by_index, pair):
                continue
            result = triangulate_observations(cameras_by_index, list(pair))
        except (ValueError, np.linalg.LinAlgError, OverflowError, FloatingPointError):
            continue
        if result["max_error"] > reprojection_threshold_px:
            continue
        point = result["point"]
        support = 0
        for observation in observations_by_camera.values():
            try:
                projected = project_raw_point(
                    point,
                    cameras_by_index[observation["camera_index"]],
                )
            except (ValueError, np.linalg.LinAlgError, OverflowError):
                continue
            if projected is not None and math.hypot(
                projected["x"] - observation["x"],
                projected["y"] - observation["y"],
            ) <= reprojection_threshold_px:
                support += 1
        if support >= min(3, len(observations_by_camera)):
            candidates.append((support, [point[axis] for axis in ("x", "y", "z")]))

    if not candidates:
        return None

    strongest_support = max(support for support, _ in candidates)
    points = [point for support, point in candidates if support == strongest_support]
    consensus = np.median(np.asarray(points, dtype=np.float64), axis=0)

    return {
        "point": {
            "x": float(consensus[0]),
            "y": float(consensus[1]),
            "z": float(consensus[2]),
        },
        "pair_count": len(points),
    }


def scan_2d_camera_grid(
    cameras_by_index: dict[int, dict],
    observations_by_frame: dict[int, list[dict]],
    start_frame: int,
    end_frame: int,
    bad_threshold_meters: float = DEFAULT_BAD_CAMERA_THRESHOLD_METERS,
    min_available_cameras: int = MIN_AVAILABLE_CAMERAS,
    reprojection_threshold_px: float = QUALITY_REPROJECTION_THRESHOLD_PX,
) -> list[dict]:
    """Score pixel agreement against stable multiview hypotheses.

    Keep the legacy distance argument for caller compatibility; it is no
    longer the classification threshold. No evidence is never a pass.
    Ambiguous hypotheses flag the frame without inventing an outlier identity.
    """
    threshold = _finite_float(reprojection_threshold_px, "reprojection_threshold_px")
    if threshold <= 0:
        raise ValueError("reprojection_threshold_px 必須大於 0")
    results = []
    for frame in range(start_frame, end_frame + 1):
        entries = {
            index: {"camera_index": index, "status": "no_data", "reason": "沒有標註資料"}
            for index in sorted(cameras_by_index)
        }
        valid = {}
        for observation in observations_by_frame.get(frame, []):
            index = observation.get("camera_index")
            if index not in entries:
                continue
            entry = entries[index]
            try:
                x = _finite_float(observation.get("x"), "2D x")
                y = _finite_float(observation.get("y"), "2D y")
            except ValueError:
                entry.update(status="bad", reason="球點不是有效數字")
                continue
            projection = cameras_by_index[index].get("projection") or {}
            outside = x < 0 or y < 0
            for value, key, alternate in ((x, "imageWidth", "image_width"), (y, "imageHeight", "image_height")):
                try:
                    bound = float(projection.get(key, projection.get(alternate)))
                    outside = outside or (math.isfinite(bound) and bound > 0 and value >= bound)
                except (TypeError, ValueError):
                    pass
            if outside:
                entry.update(status="bad", reason="球點超出影像範圍")
                continue
            try:
                _projection_from_camera(cameras_by_index[index])
            except ValueError:
                entry.update(status="unknown", reason="相機參數無法使用")
                continue
            valid[index] = {"camera_index": index, "x": x, "y": y}
            entry.update(status="unknown", reason="有效視角不足或重建幾何不穩定")

        hypotheses = []
        stable_pairs = 0
        failed_pairs = 0
        for pair in combinations(valid.values(), 2):
            try:
                if not _quality_pair_stable(cameras_by_index, pair):
                    continue
                stable_pairs += 1
                reconstruction = triangulate_observations(cameras_by_index, list(pair))
                if reconstruction["max_error"] > threshold:
                    failed_pairs += 1
                    continue
                errors = {}
                for index, observation in valid.items():
                    projected = project_raw_point(reconstruction["point"], cameras_by_index[index])
                    errors[index] = (
                        math.hypot(projected["x"] - observation["x"], projected["y"] - observation["y"])
                        if projected is not None else math.inf
                    )
                supporters = frozenset(index for index, error in errors.items() if error <= threshold)
                if len(supporters) >= 3:
                    hypotheses.append((supporters, errors))
            except (ValueError, np.linalg.LinAlgError, OverflowError, FloatingPointError):
                failed_pairs += 1

        if hypotheses:
            largest = max(len(item[0]) for item in hypotheses)
            best = [item for item in hypotheses if len(item[0]) == largest]
            groups = {item[0] for item in best}
            if len(groups) == 1:
                supporters, errors = min(best, key=lambda item: sum(item[1][index] for index in item[0]))
                for index in valid:
                    error = errors[index]
                    entries[index].update(
                        status="ok" if index in supporters else "bad",
                        reason="多視角投影一致" if index in supporters else "偏離其他視角的重建投影",
                        reprojection_error_px=float(error) if math.isfinite(error) else None,
                        support_count=len(supporters),
                        threshold_px=threshold,
                    )
            else:
                for index in valid:
                    entries[index].update(status="suspect", reason="多組重建互相衝突，無法唯一定位錯誤視角")
        elif stable_pairs or failed_pairs:
            if len(valid) >= 3 or failed_pairs:
                for index in valid:
                    entries[index].update(status="suspect", reason="視角重建衝突或重投影誤差過大")
        cameras = list(entries.values())
        ok_count = sum(item["status"] == "ok" for item in cameras)
        results.append({
            "frame": frame,
            "cameras": cameras,
            "ok_camera_count": ok_count,
            "low_coverage": ok_count < min_available_cameras,
            "needs_review": any(item["status"] in ("bad", "suspect", "unknown") for item in cameras),
        })
    return results
