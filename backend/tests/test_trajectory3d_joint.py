"""Synthetic geometry + isolated sqlite integration for the new safe 3D pipeline."""
import unittest

import numpy as np
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from fastapi import HTTPException

from app.models import Base, BallTraj, BallPosition2D, Match, Hit, Rally, Trajectory3DVersion
from app.trajectory3d_core import reconstruct_frame, analyze_range
from app.trajectory3d_api import (
    AnalyzeRequest, SaveRequest, analyze_trajectory_3d,
    save_trajectory_3d_version, get_trajectory_3d, list_trajectory_3d_versions,
)
from app.triangulation import project_raw_point


def camera(index, tx, ty):
    return dict(index=index, projection=dict(
        intrinsic=[1000., 1000., 640., 400., 0., 0., 0., 0., 0.],
        extrinsic=[[1., 0., 0., tx], [0., 1., 0., ty], [0., 0., 1., 0.]],
        useLensDistortion=False, coordinateMode="raw", uOffset=0., vOffset=0.,
    ))


CAMERAS = {i: camera(i, (i - 2) * 1.6, (i % 2) * 0.9) for i in range(5)}
TRUE_POINT = {"x": 0.23, "y": -0.31, "z": 7.0}


def observations(frame=5, corrupt_index=None, indices=(0, 1, 2, 3, 4)):
    rows = []
    for i in indices:
        px = project_raw_point(TRUE_POINT, CAMERAS[i])
        x, y = px["x"], px["y"]
        if corrupt_index == i:
            x += 100
            y -= 100
        rows.append(dict(frame=frame, camera_index=i, x=x, y=y,
                         corrected=False, visibility=1))
    return rows


class JointCoreTest(unittest.TestCase):
    def test_all_valid_views_auto(self):
        result = reconstruct_frame(CAMERAS, observations(), {"x": 0.13, "y": -0.1, "z": 7.5})
        self.assertEqual(result["status"], "auto")
        self.assertEqual(result["inlier_views"], 5)
        self.assertLess(np.linalg.norm(np.array(list(result["point"].values())) -
                                       np.array(list(TRUE_POINT.values()))), .001)

    def test_bad_camera_is_rejected_and_suggested(self):
        result = reconstruct_frame(CAMERAS, observations(corrupt_index=4),
                                   {"x": 0.13, "y": -0.1, "z": 7.5})
        self.assertEqual(result["status"], "auto")
        self.assertEqual(result["inlier_views"], 4)
        self.assertEqual(result["recommended_camera"], 4)
        self.assertFalse([v for v in result["view_diagnostics"] if v["camera_index"] == 4][0]["inlier"])

    def test_two_camera_reconstruction_is_not_automatically_saved(self):
        result = reconstruct_frame(CAMERAS, observations(indices=(0, 3)))
        self.assertNotEqual(result["status"], "auto")

    def test_auto_requires_independent_holdout_consistency(self):
        result = reconstruct_frame(CAMERAS, observations(), {"x": 0.13, "y": -0.1, "z": 7.5})
        self.assertEqual(result["status"], "auto")
        self.assertEqual(result["heldout_views"], 4)
        self.assertLess(result["heldout_rms_px"], .1)
        self.assertTrue(any(v["heldout_residual_px"] is not None
                            for v in result["view_diagnostics"]))

    def test_invalid_view_does_not_become_independent_observation(self):
        result = reconstruct_frame(CAMERAS, observations(corrupt_index=4),
                                   {"x": 0.13, "y": -0.1, "z": 7.5})
        bad = next(v for v in result["view_diagnostics"] if v["camera_index"] == 4)
        self.assertIsNone(bad["heldout_residual_px"])
        self.assertFalse(bad["prediction_is_observation"])

    def test_current_good_3d_is_never_automatically_replaced(self):
        result = reconstruct_frame(CAMERAS, observations(), TRUE_POINT)
        self.assertEqual(result["status"], "keep")

    def test_temporal_hit_guard(self):
        samples = []
        for f in (3, 4, 5, 6, 7):
            samples.extend(observations(frame=f))
        originals = {f: {"x": 0.13, "y": -0.1, "z": 7.5} for f in range(3, 8)}
        result = analyze_range(CAMERAS, samples, originals, [5], 3, 7, 50.0)
        self.assertEqual(next(r for r in result["frames"] if r["frame"] == 5)["status"], "review")

    def test_existing_projection_consistent_3d_is_preserved(self):
        original = {"x": TRUE_POINT["x"] + 0.035,
                    "y": TRUE_POINT["y"], "z": TRUE_POINT["z"]}
        result = reconstruct_frame(CAMERAS, observations(), original)
        self.assertEqual(result["status"], "keep")

    def test_multiview_consistent_impossible_3d_jump_needs_review(self):
        first = {"x": 0.0, "y": -0.3, "z": 7.0}
        second = {"x": 4.0, "y": -0.3, "z": 7.0}
        rows = []
        for f, true_point in ((9, first), (10, second)):
            for index, camera_params in CAMERAS.items():
                pixel = project_raw_point(true_point, camera_params)
                rows.append({"frame": f, "camera_index": index,
                             "x": pixel["x"], "y": pixel["y"],
                             "visibility": 1})
        result = analyze_range(CAMERAS, rows, {}, [], 9, 10, 50.0)
        self.assertTrue(all(r["status"] != "auto" for r in result["frames"]))
        self.assertIn("高速跳躍", result["frames"][0]["reason"])


class IntrinsicImportTest(unittest.TestCase):
    def test_matrix_intrinsic_is_not_flattened_wrongly(self):
        import tempfile
        from pathlib import Path
        from app.dataset_upload import load_intrinsic
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'K.npy'
            np.save(path, np.array([[1100., 0., 640.], [0., 1000., 360.], [0., 0., 1.]]))
            value = load_intrinsic(path, 'cam0')
            self.assertEqual(value[:4].tolist(), [1100., 1000., 640., 360.])
            self.assertTrue(np.all(value[4:] == 0))

    def test_vector_intrinsic_preserves_distortion(self):
        import tempfile
        from pathlib import Path
        from app.dataset_upload import load_intrinsic
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'intrinsic.npy'
            raw = np.array([1200., 1190., 600., 350., 0.12, -0.05, 0.01, 0.02, 0.03])
            np.save(path, raw)
            np.testing.assert_allclose(load_intrinsic(path, 'cam0'), raw)


class JointApiTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False},
                                    poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.db.add(Match(id=1, fps=50.0, duration_frame=20,
                          cameras=[CAMERAS[i] for i in sorted(CAMERAS)]))
        self.db.add(Rally(id=1, match_id=1, rally_index=1, start_frame=0, end_frame=20))
        for i in range(5):
            for row in observations():
                if row["camera_index"] != i:
                    continue
                self.db.add(BallPosition2D(id=i+1, match_id=1, camera_index=i, frame=5,
                                           visibility=1, x=row["x"], y=row["y"]))
        self.db.add(BallTraj(id=1, match_id=1, frame=5, t_sec=0.1,
                             x=0.13, y=-0.1, z=7.5, confidence=0.6))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_preview_save_switch_and_original_data_is_untouched(self):
        request = AnalyzeRequest(start_frame=5, end_frame=5)
        analysis = analyze_trajectory_3d(1, request, self.db)
        self.assertEqual(analysis["frames"][0]["status"], "auto")
        self.assertEqual(len(list_trajectory_3d_versions(1, self.db)), 0)
        saved = save_trajectory_3d_version(1, SaveRequest(
            start_frame=5, end_frame=5, source_fingerprint=analysis["source_fingerprint"]), self.db)
        self.assertEqual(saved["saved"], 1)
        self.assertEqual(len(list_trajectory_3d_versions(1, self.db)), 1)
        original = get_trajectory_3d(1, None, 5, 5, self.db)[0]
        merged = get_trajectory_3d(1, saved["id"], 5, 5, self.db)[0]
        self.assertEqual(original["x"], 0.13)
        self.assertAlmostEqual(merged["x"], TRUE_POINT["x"], places=3)
        self.assertEqual(self.db.query(BallTraj).first().x, 0.13)
        self.assertEqual(self.db.query(BallPosition2D).count(), 5)

    def test_http_api_preview_save_and_version_selection(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db import get_db

        def override_db():
            yield self.db

        app.dependency_overrides[get_db] = override_db
        try:
            with TestClient(app) as client:
                r = client.post('/matches/1/traj3d/analyze', json={
                    'start_frame': 5, 'end_frame': 5, 'source_2d': 'corrected',
                })
                self.assertEqual(r.status_code, 200, r.text)
                report = r.json()
                self.assertEqual(report['frames'][0]['status'], 'auto')
                r = client.post('/matches/1/traj3d/versions', json={
                    'start_frame': 5, 'end_frame': 5, 'source_2d': 'corrected',
                    'source_fingerprint': report['source_fingerprint'],
                })
                self.assertEqual(r.status_code, 200, r.text)
                version = r.json()['id']
                r = client.get('/matches/1/traj3d/trajectory',
                               params={'version_id': version, 'start': 5, 'end': 5})
                self.assertEqual(r.status_code, 200, r.text)
                self.assertAlmostEqual(r.json()[0]['x'], TRUE_POINT['x'], places=3)
                r = client.get(f'/matches/1/traj3d/versions/{version}/export')
                self.assertEqual(r.status_code, 200)
                self.assertIn('Frame,Time,X,Y,Z,Confidence,Speed', r.text)
        finally:
            app.dependency_overrides.pop(get_db, None)

    def test_changed_source_cannot_save_stale_preview(self):
        analysis = analyze_trajectory_3d(1, AnalyzeRequest(start_frame=5, end_frame=5), self.db)
        self.db.query(BallPosition2D).filter_by(camera_index=1).first().x += 1.2
        self.db.commit()
        with self.assertRaises(HTTPException) as ctx:
            save_trajectory_3d_version(1, SaveRequest(
                start_frame=5, end_frame=5, source_fingerprint=analysis["source_fingerprint"]), self.db)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(self.db.query(Trajectory3DVersion).count(), 0)


if __name__ == "__main__":
    unittest.main()
