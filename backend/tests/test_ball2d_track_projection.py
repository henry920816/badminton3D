"""The 2D trajectory plot must receive actual pixels, not invented projected labels."""
from app.ball2d_reference import attach_reference_3d
from app.triangulation import project_raw_point


def camera(i):
    return {
        "id": f"cam{i}", "index": i,
        "projection": {
            "intrinsic": [1000.0, 1000.0, 320.0, 240.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            "extrinsic": [[1.0, 0.0, 0.0, -float(i % 2)],
                          [0.0, 1.0, 0.0, -float(i // 2)],
                          [0.0, 0.0, 1.0, 0.0]],
            "coordinateMode": "raw", "useLensDistortion": False,
            "uOffset": 0.0, "vOffset": 0.0,
        },
    }


def test_track_pixel_provenance_and_independent_support():
    cameras = {i: camera(i) for i in range(4)}
    point = {"x": 0.5, "y": 0.2, "z": 5.0}
    observed = []
    for i in cameras:
        pixel = project_raw_point(point, cameras[i])
        observed.append({"camera_index": i, "x": pixel["x"] + (120 if i == 2 else 0),
                         "y": pixel["y"]})
    grid = [{"frame": 9, "cameras": [
        {"camera_index": i, "status": "ok", "reason": "mock geometry"}
        for i in cameras
    ]}]
    result = attach_reference_3d(grid, cameras, {9: observed}, {9: point})
    affected = result[0]["cameras"][2]
    assert affected["track_observed_2d"]["x"] == observed[2]["x"]
    assert affected["track_original_3d_projected_2d"]["x"] == observed[2]["x"] - 120
    assert affected["reference_3d_independently_supported"] is True
    assert affected["reference_3d_other_support_count"] == 3
    assert affected["status"] == "bad"


def test_missing_original_3d_does_not_forge_projection():
    cameras = {i: camera(i) for i in range(4)}
    observed = [{"camera_index": 0, "x": 50.0, "y": 80.0}]
    grid = [{"frame": 11, "cameras": [
        {"camera_index": i, "status": "unknown", "reason": "mock"}
        for i in cameras
    ]}]
    result = attach_reference_3d(grid, cameras, {11: observed}, {})
    cell = result[0]["cameras"][0]
    assert cell["track_observed_2d"] == {"x": 50.0, "y": 80.0}
    assert cell["track_original_3d_projected_2d"] is None
    assert cell["reference_3d_independently_supported"] is False
    assert result[0]["cameras"][1]["track_observed_2d"] is None


def test_projection_continues_over_missing_observed_label():
    cameras = {i: camera(i) for i in range(4)}
    point = {"x": 0.5, "y": 0.2, "z": 5.0}
    grid = [{"frame": 12, "cameras": [
        {"camera_index": i, "status": "no_data", "reason": "mock"}
        for i in cameras
    ]}]
    result = attach_reference_3d(grid, cameras, {12: []}, {12: point})
    cell = result[0]["cameras"][0]
    assert cell["track_observed_2d"] is None
    assert cell["track_original_3d_projected_2d"] == {
        key: project_raw_point(point, cameras[0])[key] for key in ("x", "y")
    }
    assert cell["reference_3d_error_px"] is None
    assert cell["reference_3d_independently_supported"] is False
