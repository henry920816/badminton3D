"""2D 品質檢查：可信原始 3D 優先、雙可信 2D 重建其次、2D 幾何保底。

原始 3D 需經至少三台「排除待檢視角」的有效相機支持，且視角幾何
穩定才享有第一優先權。它不是影像真值：不能以自己驗證自己，
沒有足夠佐證時不可覆蓋 2D 判斷。此模組只回傳狀態，不改資料庫。
"""

import math

from itertools import combinations

import numpy as np

from .triangulation import (
    _normalized_observation,
    _projection_from_camera,
    _quality_pair_stable,
    project_raw_point,
    triangulate_observations,
)

REFERENCE_AGREE_PX = 12.0
REFERENCE_DISAGREE_PX = 30.0
MIN_CORROBORATING_VIEWS = 3

# 其他視角已確認原始 3D 可信時，15 px 以內視為一致；
# 這與品質檢查的綠色門檻相同，避免畫面綠色、後端卻判 Bad。
FORCE_OK_REPROJECTION_THRESHOLD_PX = 15.0

# 依需求：已被其他視角幾何驗證的 3D 投影，偵測權重略高於 2D。
WEIGHT_MULTIVIEW_2D = 1.0
WEIGHT_VALIDATED_3D = 1.25

# 兩個高可信 2D 點即可建立當幀「品質檢查用」3D 參考，不會寫進 BallTraj。
# 注意：兩視角不等於真實 3D 地面真值，故加上視線角、錨點重投影及相互一致檢查。
TWO_VIEW_BAD_THRESHOLD_PX = 30.0
TWO_VIEW_NEAR_MATCH_PX = 3.0
TWO_VIEW_ANCHOR_MAX_ERROR_PX = 3.0
TWO_VIEW_MIN_RAY_ANGLE_DEG = 3.0
TWO_VIEW_OTHER_ANCHOR_THRESHOLD_PX = 12.0


def _stable_support_geometry(cameras_by_index: dict, observations: list[dict]) -> bool:
    """避免所有支持 3D 的相機方向相同，導致深度不可靠。"""
    for pair in combinations(observations, 2):
        try:
            if _quality_pair_stable(cameras_by_index, pair):
                return True
        except (KeyError, ValueError, ArithmeticError):
            continue
    return False


def _fusion_score(status_2d: str, status_3d: str) -> float | None:
    """0=正常、1=異常，3D 只在 agree/disagree 有明確證據時加權。"""
    geometry = {"ok": 0.0, "suspect": 0.5, "bad": 1.0}.get(status_2d)
    prediction = {"agrees": 0.0, "disagrees": 1.0}.get(status_3d)
    if geometry is None or prediction is None:
        return None
    return (WEIGHT_MULTIVIEW_2D * geometry + WEIGHT_VALIDATED_3D * prediction) / (
        WEIGHT_MULTIVIEW_2D + WEIGHT_VALIDATED_3D
    )


def _fuse_detection_status(status_2d: str, status_3d: str, score: float) -> str:
    # 已被 2D 幾何判 bad 的相機，即使 3D 與它吻合也不可直接放行。
    if status_2d == "bad" and status_3d == "agrees":
        return "suspect"
    # 0.5 為衝突中立點；3D 權重 1.25 使互相矛盾時略偏向 3D。
    return "bad" if score > 0.5 else "ok" if score < 0.5 else "suspect"


def reference_evidence(cameras_by_index: dict, observations: list[dict], point: dict | None) -> dict:
    """計算投影像素誤差與對每台相機獨立的（不含自身）3D 支持證據。"""
    try:
        valid_point = bool(point) and all(
            math.isfinite(float(point.get(k, math.nan))) for k in ("x", "y", "z")
        )
    except (TypeError, ValueError, OverflowError):
        valid_point = False
    if not valid_point:
        return {"available": False, "trust": "unavailable", "support_count": 0,
                "evaluated_count": 0, "by_camera": {}, "independent_by_camera": {}, "projected_by_camera": {}}

    errors = {}
    projected_by_camera = {}
    valid_observations = {}
    for item in observations:
        try:
            camera_index = int(item["camera_index"])
            camera = cameras_by_index.get(camera_index)
            if camera is None or item.get("visibility", 1) <= 0:
                continue
            x = float(item["x"])
            y = float(item["y"])
            if not math.isfinite(x) or not math.isfinite(y):
                continue
            projected = project_raw_point(point, camera)
            if projected is None:
                continue
            if not (math.isfinite(float(projected["x"])) and math.isfinite(float(projected["y"]))):
                continue
            projected_by_camera[camera_index] = {"x": float(projected["x"]), "y": float(projected["y"])}
            error = math.hypot(float(projected["x"]) - x, float(projected["y"]) - y)
            if math.isfinite(error):
                errors[camera_index] = float(error)
                valid_observations[camera_index] = {"camera_index": camera_index, "x": x, "y": y}
        except (ValueError, TypeError, KeyError, OverflowError, ZeroDivisionError):
            continue

    # Preserve the original-3D projected track through 2D visibility gaps.
    # Missing observed pixels must NOT be counted as supporters or errors.
    for index, camera in cameras_by_index.items():
        if index in projected_by_camera:
            continue
        try:
            projected = project_raw_point(point, camera)
            if projected is not None:
                px, py = float(projected["x"]), float(projected["y"])
                if math.isfinite(px) and math.isfinite(py):
                    projected_by_camera[index] = {"x": px, "y": py}
        except (ValueError, TypeError, KeyError, OverflowError, ZeroDivisionError):
            continue

    count = len(errors)
    supports = sum(error <= REFERENCE_AGREE_PX for error in errors.values())
    corroborated = supports >= MIN_CORROBORATING_VIEWS and supports * 2 > count
    independent_by_camera = {}
    for camera_index in errors:
        # 同一個 2D 標註不可以用來證明自己的 3D 參考可靠。

        peers = {idx: err for idx, err in errors.items() if idx != camera_index}
        peers_supported = [valid_observations[idx] for idx, err in peers.items()
                           if err <= REFERENCE_AGREE_PX]
        independent = (
            len(peers_supported) >= MIN_CORROBORATING_VIEWS
            and len(peers_supported) * 2 > len(peers)
            and _stable_support_geometry(cameras_by_index, peers_supported)
        )
        independent_by_camera[camera_index] = {
            "supported": bool(independent),
            "other_support_count": len(peers_supported),
            "other_evaluated_count": len(peers),
        }

    return {
        "available": True,
        "trust": "corroborated" if corroborated else "unverified",
        "support_count": supports,
        "evaluated_count": count,
        "by_camera": errors,
        "independent_by_camera": independent_by_camera,
        "projected_by_camera": projected_by_camera,
        "agree_threshold_px": REFERENCE_AGREE_PX,
        "force_ok_threshold_px": FORCE_OK_REPROJECTION_THRESHOLD_PX,
        "disagree_threshold_px": REFERENCE_DISAGREE_PX,
    }


def _usable_observations(cameras_by_index: dict, observations: list[dict]) -> dict[int, dict]:
    """Avoid invalid, out-of-image, invisible or uncalibrated anchor pixels."""
    result = {}
    for obs in observations:
        try:
            index = int(obs['camera_index'])
            cam = cameras_by_index[index]
            if obs.get('visibility', 1) <= 0:
                continue
            x, y = float(obs['x']), float(obs['y'])
            if not (math.isfinite(x) and math.isfinite(y)) or min(x, y) < 0:
                continue
            projection = cam.get('projection') or {}
            for value, axis in ((x, 'imageWidth'), (y, 'imageHeight')):
                bound = projection.get(axis, projection.get('image_width' if axis == 'imageWidth' else 'image_height'))
                if bound is not None and math.isfinite(float(bound)) and float(bound) > 0 and value >= float(bound):
                    raise ValueError('out of image')
            _projection_from_camera(cam)
            result[index] = {'camera_index': index, 'x': x, 'y': y,
                             'corrected': bool(obs.get('corrected', False))}
        except (KeyError, ValueError, TypeError, OverflowError, np.linalg.LinAlgError):
            continue
    return result


def _ray_angle_deg(cameras: dict, a: dict, b: dict) -> float:
    """World-space acute ray angle. Pairs with near-parallel rays are rejected."""
    rays = []
    for obs in (a, b):
        proj = _projection_from_camera(cameras[obs['camera_index']])
        x, y = _normalized_observation(obs, proj)
        ray = np.linalg.solve(proj['raw_extrinsic'][:, :3], np.asarray([x, y, 1.0]))
        ray /= np.linalg.norm(ray)
        rays.append(ray)
    return math.degrees(math.acos(float(np.clip(abs(np.dot(rays[0], rays[1])), 0.0, 1.0))))


def two_view_reference(cameras_by_index: dict, observations: list[dict],
                       camera_items: list[dict]) -> dict | None:
    """Triangulate from any two verified 2D anchors and assess all other views.

    Eligible anchors: native multiview OK, near-perfect 3D-validated OK,
    or an explicit correction saved by a user (when corrected source selected).
    A weighted-3D-only OK is NOT sufficient to bootstrap an anchor.
    """
    usable = _usable_observations(cameras_by_index, observations)
    entries = {int(item['camera_index']): item for item in camera_items}
    anchors = [obs for index, obs in sorted(usable.items())
               if index in entries
               # 已被可信原始 3D 判為偏離的 2D，不可反過來當成雙錨點基準。
               and not (entries[index].get('original_3d_primary')
                        and entries[index].get('reference_3d_status') == 'disagrees')
               and (
                   (entries[index].get('geometry_status', entries[index].get('status')) == 'ok')
                   or entries[index].get('reference_3d_forced_ok')
                   or obs.get('corrected')
               )]
    if len(anchors) < 2:
        return None

    candidates = []
    for a, b in combinations(anchors, 2):
        try:
            if not _quality_pair_stable(cameras_by_index, [a, b]):
                continue
            angle = _ray_angle_deg(cameras_by_index, a, b)
            if angle < TWO_VIEW_MIN_RAY_ANGLE_DEG:
                continue
            reconstruction = triangulate_observations(cameras_by_index, [a, b])
            if reconstruction['max_error'] > TWO_VIEW_ANCHOR_MAX_ERROR_PX:
                continue
            point = reconstruction['point']
            errors = {}
            for index, obs in usable.items():
                projected = project_raw_point(point, cameras_by_index[index])
                errors[index] = (math.hypot(projected['x'] - obs['x'], projected['y'] - obs['y'])
                                 if projected is not None else math.inf)
            anchor_ids = {item['camera_index'] for item in anchors}
            # Do not arbitrarily pick two OK anchors if any *other* vetted OK anchor
            # strongly contradicts their point. The frame then needs review.
            if any(errors[i] > TWO_VIEW_OTHER_ANCHOR_THRESHOLD_PX for i in anchor_ids):
                continue
            candidates.append((sum(errors[i] <= TWO_VIEW_OTHER_ANCHOR_THRESHOLD_PX for i in anchor_ids),
                               sum(errors[i] for i in anchor_ids), -angle,
                               (a['camera_index'], b['camera_index']), point, errors))
        except (ValueError, KeyError, OverflowError, ZeroDivisionError,
                np.linalg.LinAlgError, FloatingPointError):
            continue
    if not candidates:
        return None

    # Prioritize consensus among independently trusted anchors, then lowest
    # trusted reprojection residual, then stereo ray separation.
    best = min(candidates, key=lambda v: (-v[0], v[1], v[2], v[3]))
    pair_ids, point, errors = best[3], best[4], best[5]
    return {
        'point': point,
        'anchor_cameras': list(pair_ids),
        'trusted_cameras': sorted(int(p['camera_index']) for p in anchors),
        'ray_angle_degrees': round(float(-best[2]), 3),
        'by_camera': errors,
        'bad_threshold_px': TWO_VIEW_BAD_THRESHOLD_PX,
        'near_match_threshold_px': TWO_VIEW_NEAR_MATCH_PX,
        'provisional': True,  # Geometric hypothesis, not independently measured truth.
    }


def _apply_two_view_reference(row: dict, cameras_by_index: dict, observations: list[dict]) -> None:
    """Mark non-anchor labels Bad if they strongly disagree with trusted stereo."""
    items = row.get('cameras', [])
    result = two_view_reference(cameras_by_index, observations, items)
    row['two_view_3d'] = (
        {k: v for k, v in result.items() if k != 'by_camera'} if result else None
    )
    if result is None:
        return
    anchor_ids = set(result['trusted_cameras'])
    usable = _usable_observations(cameras_by_index, observations)
    for item in items:
        index = int(item['camera_index'])
        error = result['by_camera'].get(index)
        item['two_view_3d_error_px'] = round(float(error), 3) if error is not None and math.isfinite(error) else None
        item['two_view_3d_anchor'] = index in anchor_ids
        item['two_view_3d_bad_override'] = False
        if index not in usable or error is None or not math.isfinite(error):
            continue
        if item.get('geometry_status') == 'no_data':
            continue
        # 原始 3D 有獨立多視角佐證時，雙視角假設僅供比對，
        # 絕不可改寫原始 3D 第一順位的 OK / Bad / Suspect。
        if item.get('original_3d_primary'):
            item['two_view_3d_deferred_to_original'] = True
            continue
        # If the base scan explicitly found invalid/out-of-frame data, a
        # geometric prediction must not change that certain Bad status.
        if (item.get('geometry_status') == 'bad'
                and ('不是有效數字' in str(item.get('reason', ''))
                     or '超出影像範圍' in str(item.get('reason', '')))):
            continue
        if index in anchor_ids:
            # An explicitly corrected annotation may previously have been
            # marked Suspect/Bad by an ambiguous multiview model. Two user
            # corrected points with sound geometry are allowed to anchor.
            if usable[index].get('corrected') and error <= TWO_VIEW_ANCHOR_MAX_ERROR_PX:
                item['status'] = 'ok'
                item['detection_source'] = 'two_view_manual_anchor'
                item['reason'] = f'人工修正的 2D 錨點，雙視角 3D 回投誤差 {error:.2f} px；仍須影像核對。'
            continue
        if error > TWO_VIEW_BAD_THRESHOLD_PX + 1e-6:
            item['two_view_3d_bad_override'] = True
            if item.get('status') != 'bad':
                item['status'] = 'bad'
                item['detection_source'] = 'two_view_3d_reprojection'
                item['reason'] = (
                    f'Bad：兩個可信 2D 錨點 Cam {result["anchor_cameras"][0]} / '
                    f'Cam {result["anchor_cameras"][1]} 重建的 3D 回投偏差 {error:.1f} px '
                    f'(> {TWO_VIEW_BAD_THRESHOLD_PX:g} px)。此為品質判斷，非絕對真值。'
                )
        elif error <= TWO_VIEW_NEAR_MATCH_PX:
            item['status'] = 'ok'
            item['detection_source'] = 'two_view_3d_near_match'
            item['reason'] = f'符合雙視角 3D 回投，誤差 {error:.2f} px (<= 3 px)。'


def attach_reference_3d(grid: list[dict], cameras_by_index: dict,
                        observations_by_frame: dict[int, list[dict]],
                        original_3d_by_frame: dict[int, dict]) -> list[dict]:
    """回傳融合後 2D 偵測狀態；未獲獨立支持的 3D 不得影響原偵測。

    只修改回傳的品質網格，不會改動 2D、3D 座標或資料庫。
    """
    for row in grid:
        frame = int(row["frame"])
        evidence = reference_evidence(
            cameras_by_index,
            observations_by_frame.get(frame, []),
            original_3d_by_frame.get(frame),
        )
        row["reference_3d"] = {key: value for key, value in evidence.items()
                               if key not in ("by_camera", "independent_by_camera", "projected_by_camera")}
        # Supply actual observed pixels and per-camera projection directly to
        # the time-track UI; never derive these from a triangulated 3D candidate.
        raw_by_camera = {}
        for obs in observations_by_frame.get(frame, []):
            try:
                if obs.get("visibility", 1) <= 0:
                    continue
                idx = int(obs["camera_index"])
                x, y = float(obs["x"]), float(obs["y"])
                if math.isfinite(x) and math.isfinite(y):
                    raw_by_camera[idx] = {"x": x, "y": y}
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
        row["detection_weights"] = {
            "multiview_2d": WEIGHT_MULTIVIEW_2D,
            "validated_3d": WEIGHT_VALIDATED_3D,
        }
        row["detection_priority"] = ["original_3d", "two_view_3d", "multiview_2d"]
        for item in row.get("cameras", []):
            index = int(item["camera_index"])
            # None means genuinely missing; preserve the distinction between
            # zero coordinate, missing observation, and unusable projection.
            item["track_observed_2d"] = raw_by_camera.get(index)
            item["track_original_3d_projected_2d"] = evidence["projected_by_camera"].get(index)
            status_2d = str(item["status"])
            error = evidence["by_camera"].get(index)
            status_3d = (
                "unavailable" if error is None else
                "agrees" if error <= REFERENCE_AGREE_PX else
                "disagrees" if error > REFERENCE_DISAGREE_PX else "uncertain"
            )
            independent = evidence["independent_by_camera"].get(index, {})
            supported = bool(independent.get("supported", False))
            item["reference_3d_error_px"] = error
            item["reference_3d_status"] = status_3d
            item["reference_3d_corroborated"] = evidence["trust"] == "corroborated"
            item["reference_3d_independently_supported"] = supported
            item["reference_3d_other_support_count"] = independent.get("other_support_count", 0)
            item["geometry_status"] = status_2d
            item["detection_source"] = "2d_only"
            item["detection_score"] = None
            item["reference_3d_forced_ok"] = False
            # 原始 3D 只有在真正取得明確且獨立的其他視角支持時才有第一順位。
            item["original_3d_primary"] = False
            # 無資料、校正不完整或沒有獨立相機支持，則交給 2D 重建判斷。
            if not supported or status_2d == "no_data":
                continue
            # Invalid or out-of-image labels must not be reclassified by a 3D projection.
            # These statuses were determined without triangulation and are certain.
            if status_2d == "bad" and (
                "不是有效數字" in str(item.get("reason", ""))
                or "超出影像範圍" in str(item.get("reason", ""))
            ):
                continue
            # 近乎重合時使用更明確的優先規則：在排除目前相機之後，
            # 仍有至少三個幾何穩定的其他視角支持原始 3D，才可強制 OK。
            # status_2d 的 invalid/out-of-image 例外已在上方排除。
            if error is not None and error <= FORCE_OK_REPROJECTION_THRESHOLD_PX:
                item["original_3d_primary"] = True
                item["status"] = "ok"
                item["reference_3d_forced_ok"] = True
                item["detection_source"] = "3d_near_match_override"
                item["detection_score"] = 0.0
                item["detection_conflict"] = status_2d != "ok"
                if status_2d != "ok":
                    item["reason"] = (
                        f"強制正確：2D 與 3D 同幀投影僅差 {error:.2f} px "
                        f"(<= {FORCE_OK_REPROJECTION_THRESHOLD_PX:g} px)，"
                        f"另有 {independent['other_support_count']} 台相機支持該 3D；"
                        f"原 2D 幾何狀態 {status_2d}。此為幾何判斷，非影像真值。"
                    )
                continue
            if status_3d == "disagrees":
                # 可信原始 3D 回投 >30px，直接 Bad；
                # 雙 2D 錨點即使與其衝突也不可翻案。
                item["original_3d_primary"] = True
                item["status"] = "bad"
                item["detection_source"] = "original_3d_primary_bad"
                item["detection_score"] = 1.0
                item["detection_conflict"] = status_2d != "bad"
                item["reason"] = (
                    f"原始 3D 第一順位：同幀重投影偏差 {error:.1f} px "
                    f"(> {REFERENCE_DISAGREE_PX:g} px)；"
                    f"另有 {independent['other_support_count']} 台相機支持該 3D，標為 Bad。"
                )
                continue
            if status_3d == "agrees":
                # 3~12px 維持原有 1.25 加權與衝突留疑；
                # 但已取得原始 3D 證據，雙視角重建無權覆蓋其結果。
                item["original_3d_primary"] = True
            score = _fusion_score(status_2d, status_3d)
            if score is None:
                continue
            status = _fuse_detection_status(status_2d, status_3d, score)
            item["detection_source"] = "2d_3d_weighted"
            item["detection_score"] = round(float(score), 4)
            item["status"] = status
            if status != status_2d:
                item["reason"] = (
                    f"2D 原判定 {status_2d}；3D 重投影 {status_3d}；"
                    "2D 權重 1.00、經其他至少三視角佐證的 3D 權重 1.25。"
                    "若兩者衝突，須人工核對影片，不代表已確認真值"
                )
            item["detection_conflict"] = (
                (status_2d == "ok" and status_3d == "disagrees")
                or (status_2d == "bad" and status_3d == "agrees")
            )
        # Once at least two trusted 2D pixels exist, use their stereo 3D
        # for a second pass over every other available camera.
        _apply_two_view_reference(row, cameras_by_index, observations_by_frame.get(frame, []))
        row["ok_camera_count"] = sum(c["status"] == "ok" for c in row.get("cameras", []))
        row["low_coverage"] = row["ok_camera_count"] < 3
        row["needs_review"] = any(c["status"] in ("bad", "suspect", "unknown")
                                  for c in row.get("cameras", []))
    return grid
