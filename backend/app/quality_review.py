"""2D 品質檢查分類。

藍色：沒有可用 3D 投影卻有 2D，或 3D 在畫面外且相差至少 50px。
位置接近投影的畫面邊緣點不算藍色；紫色只保留明顯而不能自動處理的異常。
"""

import math
from bisect import bisect_left

from .ball2d_reference import _stable_support_geometry
from .triangulation import _projection_from_camera, project_raw_point

AGREE_PX = 20.0
MIN_SUPPORT_VIEWS = 2
# 小於等於 50 px 保留；超過 50 px 才檢查能否自動修正。
MINOR_PX = 50.0
AUTO_MOVE_PX = MINOR_PX
BLUE_MIN_ERROR_PX = 50.0
MANUAL_REVIEW_PX = 100.0
HIT_GUARD_FRAMES = 5


def image_size(camera):
    """尺寸沒有明確寫在相機設定時，不猜成 1920×1200。"""
    projection = camera.get('projection') or {}
    try:
        w = float(projection.get('imageWidth', projection.get('image_width')))
        h = float(projection.get('imageHeight', projection.get('image_height')))
        if math.isfinite(w) and math.isfinite(h) and w > 0 and h > 0:
            return w, h
    except (TypeError, ValueError, OverflowError):
        pass
    return None


def view_projection(point, camera):
    """將畫面外、相機背後、投影失敗三種狀況分開。"""
    if point is None or camera is None:
        return {'kind': 'unavailable', 'xy': None, 'outside_px': None}
    try:
        if not all(math.isfinite(float(point[k])) for k in ('x', 'y', 'z')):
            return {'kind': 'unavailable', 'xy': None, 'outside_px': None}
        _projection_from_camera(camera)
        projected = project_raw_point(point, camera)
        if projected is None:
            return {'kind': 'outside', 'xy': None, 'outside_px': math.inf}
        x, y = float(projected['x']), float(projected['y'])
        if not math.isfinite(x) or not math.isfinite(y):
            return {'kind': 'unavailable', 'xy': None, 'outside_px': None}
        xy = {'x': x, 'y': y}
        bounds = image_size(camera)
        if bounds is None:
            return {'kind': 'bounds_unknown', 'xy': xy, 'outside_px': None}
        w, h = bounds
        outside = max(0.0, -x, x - (w - 1), -y, y - (h - 1))
        is_outside = x < 0 or x >= w or y < 0 or y >= h
        return {'kind': 'outside' if is_outside else 'inside', 'xy': xy,
                'outside_px': outside if is_outside else 0.0}
    except (KeyError, ValueError, TypeError, ArithmeticError, OverflowError):
        return {'kind': 'unavailable', 'xy': None, 'outside_px': None}


def valid_observations(observations):
    result = {}
    for item in observations:
        try:
            if int(item.get('visibility', 1)) <= 0:
                continue
            index = int(item['camera_index'])
            x, y = float(item['x']), float(item['y'])
            if math.isfinite(x) and math.isfinite(y):
                result[index] = {'camera_index': index, 'x': x, 'y': y,
                                 'corrected': bool(item.get('corrected'))}
        except (KeyError, ValueError, TypeError, OverflowError):
            continue
    return result



def blue_review_issue(proj, obs):
    """同一套藍格條件供品質顯示與人工移除 API 使用。"""
    if obs is None:
        return None
    kind = proj.get('kind')
    if kind == 'unavailable':
        return 'missing_projection'
    if kind != 'outside':
        return None
    xy = proj.get('xy')
    if xy is not None and math.hypot(
        float(obs['x']) - float(xy['x']),
        float(obs['y']) - float(xy['y']),
    ) < BLUE_MIN_ERROR_PX:
        return None
    return 'outside_view'


def _fill(item, status, reason, action='none', allowed=False, point=None):
    item['review_status'] = status
    item['review_issue_kind'] = None
    item['review_reason'] = reason
    item['review_action'] = action
    item['review_auto_allowed'] = bool(allowed)
    item['review_candidate_2d'] = point if allowed and action == 'move_to_3d' else None


def attach_review_quality(grid, cameras_by_index, observations_by_frame,
                          original_3d_by_frame, hit_frames=()):
    """給每格加上新分類；原有 2D 幾何診斷欄位保持不變。"""
    hits = sorted({int(value) for value in hit_frames})
    for row in grid:
        frame = int(row['frame'])
        point = original_3d_by_frame.get(frame)
        observed = valid_observations(observations_by_frame.get(frame, []))
        projected = {idx: view_projection(point, cam)
                     for idx, cam in cameras_by_index.items()}
        errors = {}
        supporters = []
        for index, obs in observed.items():
            proj = projected.get(index, {})
            if proj.get('kind') not in ('inside', 'bounds_unknown') or not proj.get('xy'):
                continue
            xy = proj['xy']
            err = math.hypot(obs['x'] - xy['x'], obs['y'] - xy['y'])
            errors[index] = err
            # 畫面尺寸不確定時不能提供支持證據，以免錯誤視角認證 3D。
            if proj['kind'] == 'inside' and err <= AGREE_PX:
                supporters.append(obs)
        # 只找附近的擊球點，不要每一格重新掃過整場所有擊球紀錄。
        next_hit = bisect_left(hits, frame - HIT_GUARD_FRAMES)
        protected = next_hit < len(hits) and hits[next_hit] <= frame + HIT_GUARD_FRAMES
        safe_supporters = {}
        for index in cameras_by_index:
            peers = [obs for obs in supporters if obs['camera_index'] != index]
            safe_supporters[index] = (
                len(peers) >= MIN_SUPPORT_VIEWS and
                _stable_support_geometry(cameras_by_index, peers)
            )
        row['review_support_count'] = len(supporters)
        row['review_hit_guard'] = protected
        for item in row.get('cameras', []):
            index = int(item['camera_index'])
            obs = observed.get(index)
            proj = projected.get(index, {'kind': 'unavailable', 'xy': None, 'outside_px': None})
            kind = proj['kind']
            supported = safe_supporters.get(index, False)
            corrected = bool(obs and obs.get('corrected'))
            item['review_projection_kind'] = kind
            item['review_outside_px'] = (
                round(proj['outside_px'], 2)
                if proj['outside_px'] is not None and math.isfinite(proj['outside_px']) else None
            )
            item['review_error_px'] = round(errors[index], 3) if index in errors else None
            item['review_other_support_count'] = sum(
                peer['camera_index'] != index for peer in supporters
            )
            item['review_independent_support'] = supported
            item['review_hit_guard'] = protected
            item['review_manual_protected'] = corrected
            item['review_projected_2d'] = proj['xy']
            item['review_observed_2d'] = (
                {'x': obs['x'], 'y': obs['y']} if obs is not None else None
            )

            # 藍色先判斷，但後端真正刪除前也會使用相同函式重算一次。
            blue_issue = blue_review_issue(proj, obs)
            if blue_issue:
                reason = ('沒有可用的 3D 投影，但有可見 2D' if blue_issue == 'missing_projection'
                          else '3D 在視野外，且與 2D 相差至少 50px')
                _fill(item, 'outside_view', f'{reason}；請人工判斷是否移除', 'review')
                item['review_issue_kind'] = blue_issue
                if proj['xy'] is not None:
                    item['review_error_px'] = round(math.hypot(
                        obs['x'] - proj['xy']['x'], obs['y'] - proj['xy']['y']), 3)
                continue

            if kind in ('unavailable', 'outside'):
                if obs is None:
                    _fill(item, 'normal', '沒有可見的 2D 標註')
                else:
                    # 只有實際存在投影座標、且距離小於 50px 才會落在這裡。
                    xy = proj['xy']
                    distance = math.hypot(obs['x'] - xy['x'], obs['y'] - xy['y'])
                    item['review_error_px'] = round(distance, 3)
                    if distance <= AGREE_PX:
                        _fill(item, 'normal',
                              f'3D 投影略超出畫面，與 2D 相差 {distance:.1f} px，保留標註')
                    else:
                        _fill(item, 'minor',
                              f'投影在畫面邊緣，與 2D 相差 {distance:.1f} px（<50px），不標藍色')
                continue

            if kind == 'bounds_unknown':
                if obs is None:
                    _fill(item, 'normal', '沒有可見 2D，且相機影像尺寸未知')
                else:
                    # 有投影座標就使用座標誤差，不把「不知道影像邊界」當成沒有投影。
                    distance = errors.get(index)
                    if distance is None:
                        _fill(item, 'manual_review', '投影座標無法比對', 'review')
                    elif distance <= AGREE_PX:
                        _fill(item, 'normal', f'與 3D 投影相差 {distance:.1f} px；影像邊界未知')
                    elif distance <= MANUAL_REVIEW_PX:
                        _fill(item, 'minor', f'與 3D 投影相差 {distance:.1f} px；影像邊界未知，先保留')
                    elif corrected:
                        _fill(item, 'normal', '已有 2D 修正，保留人工／既有結果，不重複提醒')
                    else:
                        _fill(item, 'manual_review',
                              f'與 3D 投影相差 {distance:.1f} px，影像尺寸未知，需要人工確認', 'review')
                continue

            # 以下都是確定投影在畫面內的情況。
            if obs is None:
                if supported:
                    _fill(item, 'manual_review', '3D 預測在畫面內，但沒有 2D 標註；可能是遮擋或漏標', 'review')
                    item['review_issue_kind'] = 'missing_2d'
                else:
                    _fill(item, 'normal', '沒有 2D 標註，且目前缺少佐證')
                continue

            error = errors.get(index)
            if error is None:
                _fill(item, 'manual_review', '無法計算同幀投影誤差', 'review')
            elif error <= AGREE_PX:
                _fill(item, 'normal', f'與原始 3D 相差 {error:.1f} px，不改動 2D')
            elif error <= MINOR_PX:
                _fill(item, 'minor', f'與原始 3D 相差 {error:.1f} px，暫時保留原標註')
            elif corrected:
                # 使用者或先前修正流程已處理，不要在每次掃描時重複標紫色。
                _fill(item, 'normal',
                      f'已有 2D 修正，與 3D 相差 {error:.1f} px；保留現有位置，不自動覆蓋')
            elif error > AUTO_MOVE_PX and supported and not protected:
                _fill(item, 'auto_fix', f'其他至少兩視角支持原始 3D，相差 {error:.1f} px',
                      'move_to_3d', True, proj['xy'])
            elif error <= MANUAL_REVIEW_PX:
                # 擊球附近及支持不足的中等偏差先用黃色提醒，避免紫色塞滿畫面。
                # 真正明顯而無法安全自動處理（>100px）的才排入人工檢視。
                _fill(item, 'minor',
                      f'與 3D 相差 {error:.1f} px，未達高優先人工檢視門檻；先保留原標註')
            else:
                reason = f'與 3D 相差 {error:.1f} px，'
                reason += '擊球點附近，暫不自動修改' if protected else '缺少兩台其他視角支持，暫不自動修改'
                _fill(item, 'manual_review', reason, 'review')
        row['review_counts'] = {
            state: sum(cell.get('review_status') == state for cell in row.get('cameras', []))
            for state in ('outside_view', 'auto_fix', 'manual_review', 'minor')
        }
    return grid
