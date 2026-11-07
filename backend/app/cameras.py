from .models import Match


def cameras_by_index_for_match(match: Match) -> dict[int, dict]:
    """match.cameras 依相機編號（camera["index"]，沒有就用在列表裡的位置）整理成 dict。"""
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
