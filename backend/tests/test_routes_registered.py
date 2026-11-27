"""拆路由後，前端常用的網址不能變。"""

from app.main import app


def test_main_routes_still_registered():
    registered = {
        (method, route.path)
        for route in app.routes
        for method in (getattr(route, "methods", None) or set())
    }
    expected = {
        ("GET", "/health"),
        ("GET", "/matches/{match_id}"),
        ("GET", "/matches/{match_id}/timeline"),
        ("GET", "/matches/{match_id}/traj"),
        ("GET", "/matches/{match_id}/traj2d/camera-grid"),
        ("POST", "/matches/{match_id}/traj2d/auto-repair"),
        ("GET", "/datasets"),
        ("POST", "/datasets/upload-sessions"),
        ("PATCH", "/hits/{hit_id}"),
        ("PATCH", "/anomalies/{anomaly_id}"),
        ("GET", "/export/csv"),
        ("POST", "/matches/{match_id}/traj2d/review-hide-dataset"),
        ("POST", "/matches/{match_id}/traj2d/review-repair-dataset"),
        ("GET", "/matches/{match_id}/dataset-export"),
        ("POST", "/matches/{match_id}/traj2d/replace-files"),
    }
    assert expected <= registered
