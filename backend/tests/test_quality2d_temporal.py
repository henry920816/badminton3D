from app.quality2d_temporal import assess_temporal_candidate, attach_temporal_evidence


def samples(xs, camera_index=1):
    return {frame: [{"camera_index": camera_index, "x": x, "y": 200.0}]
            for frame, x in enumerate(xs, start=100)}


def test_temporal_guard_accepts_candidate_improving_isolated_bad_label():
    data = samples([100, 110, 700, 130, 140])
    result = assess_temporal_candidate(data, 102, 1, {"x": 120, "y": 200})
    assert result["status"] == "pass"
    assert result["candidate_error_px"] == 0.0
    assert result["original_error_px"] == 580.0


def test_temporal_guard_flags_worse_candidate_not_autosaved():
    data = samples([100, 110, 120, 130, 140])
    result = assess_temporal_candidate(data, 102, 1, {"x": 700, "y": 200})
    assert result["status"] == "review"
    assert result["candidate_error_px"] > result["threshold_px"]


def test_temporal_absence_is_not_a_false_green_vote():
    result = assess_temporal_candidate({102: [{"camera_index": 1, "x": 120, "y": 200}]},
                                      102, 1, {"x": 130, "y": 200})
    assert result["status"] == "insufficient"


def test_temporal_spike_changes_only_unverified_ok_to_suspect():
    observations = samples([100, 110, 900, 130, 140])
    grid = [{"frame": 102, "cameras": [{"camera_index": 1, "status": "ok", "original_3d_primary": False}]}]
    attach_temporal_evidence(grid, observations)
    assert grid[0]["cameras"][0]["status"] == "suspect"
    assert grid[0]["cameras"][0]["temporal_status"] == "spike"
    assert grid[0]["needs_review"]


def test_temporal_spike_never_overrides_validated_original_3d():
    observations = samples([100, 110, 900, 130, 140])
    grid = [{"frame": 102, "cameras": [{"camera_index": 1, "status": "ok", "original_3d_primary": True}]}]
    attach_temporal_evidence(grid, observations)
    assert grid[0]["cameras"][0]["status"] == "ok"
    assert grid[0]["cameras"][0]["temporal_status"] == "spike"
