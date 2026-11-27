"""3D 只作為有條件的 2D 標註參考；不可代替真實影像標註。"""

import unittest

def camera(index, translation_x):
    return {
        "id": f"cam{index}", "index": index,
        "projection": {
            "intrinsic": [1000., 1000., 320., 240., 0., 0., 0., 0., 0.],
            "extrinsic": [[1., 0., 0., translation_x], [0., 1., 0., 0.], [0., 0., 1., 0.]],
            "coordinateMode": "raw", "useLensDistortion": False, "uOffset": 0., "vOffset": 0.,
        },
    }

from app.ball2d_reference import attach_reference_3d, reference_evidence
from app.triangulation import project_raw_point


class Ball2DReferenceTest(unittest.TestCase):
    def setUp(self):
        self.cameras = [camera(i, -(i % 2)) for i in range(4)]
        for i in (2, 3):
            self.cameras[i]["projection"]["extrinsic"][1][3] = -1.0
        self.by_index = {c["index"]: c for c in self.cameras}
        self.target = {"x": 0.5, "y": 0.2, "z": 5.0}
        self.points = [
            {
                "camera_index": cam["index"],
                "x": project_raw_point(self.target, cam)["x"],
                "y": project_raw_point(self.target, cam)["y"],
            }
            for cam in self.cameras
        ]

    def test_3d_reference_corroborated_and_detects_shifted_2d(self):
        labels = [dict(p) for p in self.points]
        labels[2]["x"] += 100
        evidence = reference_evidence(self.by_index, labels, self.target)
        self.assertEqual(evidence["trust"], "corroborated")
        self.assertEqual(evidence["support_count"], 3)
        grid = [{"frame": 10, "cameras": [
            {"camera_index": p["camera_index"], "status": "ok", "reason": "original"}
            for p in labels
        ]}]
        result = attach_reference_3d(grid, self.by_index, {10: labels}, {10: self.target})
        self.assertEqual(result[0]["cameras"][2]["reference_3d_status"], "disagrees")
        self.assertTrue(result[0]["cameras"][2]["reference_3d_corroborated"])
        # 經其他 3 視角獨立佐證的 3D 權重更高，應影響最終偵測狀態。
        candidate = result[0]["cameras"][2]
        self.assertEqual(candidate["geometry_status"], "ok")
        self.assertEqual(candidate["status"], "bad")
        self.assertEqual(candidate["detection_source"], "original_3d_primary_bad")
        self.assertEqual(candidate["detection_score"], 1.0)
        self.assertTrue(candidate["reference_3d_independently_supported"])
        self.assertTrue(candidate["detection_conflict"])

    def test_unverified_projection_cannot_override_2d(self):
        labels = [dict(p) for p in self.points]
        labels[1]["x"] += 120
        bad_3d = {"x": 3, "y": 4, "z": 5}
        grid = [{"frame": 11, "cameras": [
            {"camera_index": p["camera_index"], "status": "ok", "reason": "2D ok"}
            for p in labels
        ]}]
        result = attach_reference_3d(grid, self.by_index, {11: labels}, {11: bad_3d})
        self.assertEqual(result[0]["cameras"][1]["status"], "ok")
        self.assertEqual(result[0]["cameras"][1]["detection_source"], "2d_only")

    def test_3d_cannot_rescue_out_of_image_label(self):
        labels = [dict(p) for p in self.points]
        grid = [{"frame": 12, "cameras": [
            {"camera_index": p["camera_index"],
             "status": "bad" if p["camera_index"] == 2 else "ok",
             "reason": "球點超出影像範圍" if p["camera_index"] == 2 else "2D ok"}
            for p in labels
        ]}]
        result = attach_reference_3d(grid, self.by_index, {12: labels}, {12: self.target})
        self.assertEqual(result[0]["cameras"][2]["status"], "bad")
        self.assertEqual(result[0]["cameras"][2]["detection_source"], "2d_only")

    def test_3d_weight_is_larger_than_2d(self):
        from app.ball2d_reference import WEIGHT_MULTIVIEW_2D, WEIGHT_VALIDATED_3D
        self.assertEqual(WEIGHT_MULTIVIEW_2D, 1.0)
        self.assertEqual(WEIGHT_VALIDATED_3D, 1.25)

    def test_incorrect_original_3d_never_becomes_authority(self):
        invalid_reference = {"x": 3.0, "y": 2.0, "z": 5.0}
        evidence = reference_evidence(self.by_index, self.points, invalid_reference)
        self.assertEqual(evidence["trust"], "unverified")
        self.assertLess(evidence["support_count"], 3)

    def test_two_views_not_enough_to_validate_original_3d(self):
        evidence = reference_evidence(self.by_index, self.points[:2], self.target)
        self.assertEqual(evidence["trust"], "unverified")
        self.assertEqual(evidence["support_count"], 2)

    def test_missing_original_3d_does_not_affect_labels(self):
        grid = [{"frame": 10, "cameras": [
            {"camera_index": 0, "status": "bad", "reason": "original"}
        ]}]
        result = attach_reference_3d(grid, self.by_index, {10: self.points}, {})
        self.assertEqual(result[0]["reference_3d"]["trust"], "unavailable")
        self.assertEqual(result[0]["cameras"][0]["status"], "bad")
        self.assertIsNone(result[0]["cameras"][0]["reference_3d_error_px"])

    def test_non_finite_reference_not_trusted(self):
        evidence = reference_evidence(self.by_index, self.points, {"x": float("nan"), "y": 0, "z": 1})
        self.assertFalse(evidence["available"])
        self.assertEqual(evidence["trust"], "unavailable")

if __name__ == '__main__':
    unittest.main()


class Ball2DReferenceEndpointTest(unittest.TestCase):
    def test_camera_grid_includes_weighted_original_3d_projection(self):
        from sqlalchemy import BigInteger, create_engine
        from sqlalchemy.ext.compiler import compiles
        from sqlalchemy.orm import sessionmaker
        from app.models import Base, Match, BallPosition2D, BallTraj
        from app.main import get_traj_2d_camera_grid

        @compiles(BigInteger, "sqlite")
        def compile_bigint(_type, _compiler, **_kw):
            return "INTEGER"

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine)()
        try:
            cams = [camera(i, -(i % 2)) for i in range(4)]
            for i in (2, 3):
                cams[i]["projection"]["extrinsic"][1][3] = -1.0
            db.add(Match(id=34, title="2d ref", fps=50, duration_frame=200, cameras=cams))
            point = {"x": 0.5, "y": 0.2, "z": 5.0}
            db.add(BallTraj(id=1, match_id=34, frame=100, t_sec=2.0,
                            x=point["x"], y=point["y"], z=point["z"], confidence=1.0))
            for i, cam in enumerate(cams):
                observed = project_raw_point(point, cam)
                db.add(BallPosition2D(id=10+i, match_id=34, frame=100, camera_index=i,
                                      x=observed["x"]+(100 if i == 2 else 0),
                                      y=observed["y"], visibility=1))
            db.commit()
            grid = get_traj_2d_camera_grid(34, 100, 100, db, "original")
            self.assertEqual(len(grid), 1)
            self.assertEqual(grid[0]["reference_3d"]["trust"], "corroborated")
            self.assertEqual(grid[0]["reference_3d"]["support_count"], 3)
            self.assertEqual(grid[0]["cameras"][2]["reference_3d_status"], "disagrees")
            self.assertGreater(grid[0]["cameras"][2]["reference_3d_error_px"], 90)
            self.assertEqual(grid[0]["cameras"][2]["status"], "bad")
            self.assertEqual(grid[0]["cameras"][2]["detection_source"], "original_3d_primary_bad")
        finally:
            db.close()

class ForceCorrectWhen3DProjectionMatchesTest(unittest.TestCase):
    """3px 內的強制 OK 只適用經其他相機佐證的 3D 投影。"""

    def setUp(self):
        self.cameras = [camera(i, -(i % 2)) for i in range(4)]
        for i in (2, 3):
            self.cameras[i]["projection"]["extrinsic"][1][3] = -1.0
        self.by_index = {c["index"]: c for c in self.cameras}
        self.point = {"x": 0.5, "y": 0.2, "z": 5.0}
        self.labels = [
            {
                "camera_index": c["index"],
                **{key: project_raw_point(self.point, c)[key] for key in ("x", "y")},
            }
            for c in self.cameras
        ]

    def _fused(self, *, shift=0.0, status="bad", reason="兩兩重建不一致", labels=None):
        observations = [dict(p) for p in (self.labels if labels is None else labels)]
        observations[0]["x"] += shift
        grid = [{"frame": 10, "cameras": [
            {"camera_index": 0, "status": status, "reason": reason},
            {"camera_index": 1, "status": "ok", "reason": "原判定正常"},
            {"camera_index": 2, "status": "ok", "reason": "原判定正常"},
            {"camera_index": 3, "status": "ok", "reason": "原判定正常"},
        ]}]
        return attach_reference_3d(grid, self.by_index, {10: observations}, {10: self.point})[0]

    def test_almost_zero_error_forces_bad_to_ok(self):
        result = self._fused(shift=2.8)
        item = result["cameras"][0]
        self.assertEqual(item["geometry_status"], "bad")
        self.assertEqual(item["status"], "ok")
        self.assertTrue(item["reference_3d_forced_ok"])
        self.assertEqual(item["detection_source"], "3d_near_match_override")
        self.assertTrue(item["detection_conflict"])
        self.assertEqual(result["ok_camera_count"], 4)
        self.assertFalse(result["needs_review"])
        self.assertIn("強制正確", item["reason"])
        self.assertEqual(result["reference_3d"]["force_ok_threshold_px"], 15.0)

    def test_equal_threshold_is_included(self):
        result = self._fused(shift=15.0)
        self.assertEqual(result["cameras"][0]["status"], "ok")

    def test_just_outside_threshold_no_forced_correct(self):
        result = self._fused(shift=15.01)
        item = result["cameras"][0]
        self.assertNotEqual(item["status"], "ok")
        self.assertFalse(item["reference_3d_forced_ok"])

    def test_suspect_also_forces_correct_if_reprojection_near_zero(self):
        item = self._fused(shift=0.5, status="suspect")["cameras"][0]
        self.assertEqual(item["status"], "ok")
        self.assertTrue(item["reference_3d_forced_ok"])

    def test_two_verified_2d_anchors_can_override_when_original_3d_unverified(self):
        result = self._fused(labels=self.labels[:3])
        item = result["cameras"][0]
        # Original-3D forced OK still requires 3 OTHER cameras; however
        # two native 2D OK labels now provide an independent stereo check.
        self.assertFalse(item["reference_3d_forced_ok"])
        self.assertIsNotNone(result["two_view_3d"])
        self.assertEqual(item["status"], "ok")
        self.assertEqual(item["detection_source"], "two_view_3d_near_match")

    def test_invalid_image_coordinate_remains_bad(self):
        item = self._fused(shift=0, reason="球點超出影像範圍")["cameras"][0]
        self.assertEqual(item["status"], "bad")
        self.assertFalse(item["reference_3d_forced_ok"])

    def test_unreliable_3d_cannot_override(self):
        bad_3d = {"x": 2.0, "y": 0.2, "z": 5.0}
        grid = [{"frame": 10, "cameras": [{"camera_index": 0, "status": "bad", "reason": "不一致"}]}]
        result = attach_reference_3d(grid, self.by_index, {10: self.labels}, {10: bad_3d})
        self.assertEqual(result[0]["cameras"][0]["status"], "bad")
        self.assertFalse(result[0]["cameras"][0]["reference_3d_forced_ok"])

    def test_no_data_stays_no_data_even_if_projection_matches(self):
        item = self._fused(shift=0, status="no_data")["cameras"][0]
        self.assertEqual(item["status"], "no_data")
        self.assertFalse(item["reference_3d_forced_ok"])
