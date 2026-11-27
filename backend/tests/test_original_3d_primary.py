"""Trusted original 3D always wins; stereo fallback is used only without reliable evidence."""
import copy
import unittest
from unittest.mock import patch

from app.auto_repair import AutoRepair2DPayload, auto_repair_traj_2d
from app.ball2d_reference import attach_reference_3d, _apply_two_view_reference
from app.models import Base, Match, BallTraj, BallPosition2D, BallPosition2DCorrection
from app.triangulation import project_raw_point


def camera(index, tx, ty=0.0):
    return {
        "id": f"camera-{index}", "index": index,
        "projection": {
            "intrinsic": [1050.0, 1050.0, 640.0, 380.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            "extrinsic": [[1.0, 0.0, 0.0, tx], [0.0, 1.0, 0.0, ty], [0.0, 0.0, 1.0, 0.0]],
            "coordinateMode": "raw", "useLensDistortion": False,
            "imageWidth": 1400, "imageHeight": 900,
        },
    }


class Original3DPrimaryDetectorTest(unittest.TestCase):
    def setUp(self):
        self.cameras = {
            i: cam for i, cam in enumerate((camera(0, 0, 0), camera(1, -1.5, 0),
                                            camera(2, 0.1, -1), camera(3, -1.2, -.8),
                                            camera(4, -0.6, 0.7)))
        }
        self.point = {"x": .6, "y": .2, "z": 6.0}
        self.labels = [
            {"camera_index": i, "x": project_raw_point(self.point, cam)["x"],
             "y": project_raw_point(self.point, cam)["y"]}
            for i, cam in self.cameras.items()
        ]

    def make_grid(self, statuses, labels=None, original_3d=None):
        observations = copy.deepcopy(labels if labels is not None else self.labels)
        grid = [{"frame": 21, "cameras": [
            {"camera_index": i, "status": status, "reason": "init"}
            for i, status in enumerate(statuses)
        ]}]
        return attach_reference_3d(
            grid, self.cameras, {21: observations},
            {21: original_3d} if original_3d is not None else {},
        )[0]

    def test_original_three_px_ok_cannot_be_reversed_by_two_view(self):
        grid = self.make_grid(["bad", "ok", "ok", "ok", "ok"])
        item = grid["cameras"][0]
        self.assertEqual(item["status"], "ok")  # fallback stereo: no stored 3D
        self.assertEqual(item["detection_source"], "two_view_3d_near_match")

        grid = self.make_grid(["bad", "ok", "ok", "ok", "ok"], original_3d=self.point)
        item = grid["cameras"][0]
        self.assertTrue(item["original_3d_primary"])
        self.assertEqual(item["status"], "ok")
        self.assertEqual(grid["detection_priority"], ["original_3d", "two_view_3d", "multiview_2d"])
        # Even a separately generated contradictory stereo hypothesis cannot overrule it.
        hypothetical = {
            "point": self.point, "trusted_cameras": [1, 2],
            "anchor_cameras": [1, 2], "ray_angle_degrees": 6.0,
            "by_camera": {0: 90.0, 1: 0.0, 2: 0.0},
            "bad_threshold_px": 30.0, "near_match_threshold_px": 3.0,
            "provisional": True,
        }
        with patch("app.ball2d_reference.two_view_reference", return_value=hypothetical):
            _apply_two_view_reference(grid, self.cameras, self.labels)
        self.assertEqual(item["status"], "ok")
        self.assertFalse(item["two_view_3d_bad_override"])
        self.assertTrue(item["two_view_3d_deferred_to_original"])

    def test_original_3d_large_error_is_primary_even_if_2d_geometry_ok(self):
        labels = copy.deepcopy(self.labels)
        labels[4]["x"] += 110.0
        grid = self.make_grid(["ok"] * 5, labels=labels, original_3d=self.point)
        self.assertEqual(grid["cameras"][4]["status"], "bad")
        self.assertEqual(grid["cameras"][4]["detection_source"], "original_3d_primary_bad")
        self.assertTrue(grid["cameras"][4]["original_3d_primary"])

    def test_unverified_original_3d_does_not_overwrite_two_view(self):
        labels = copy.deepcopy(self.labels)
        labels[2]["x"] += 110.0
        grid = self.make_grid(["ok", "ok", "unknown", "unknown", "unknown"],
                              labels=labels, original_3d={"x": 5, "y": 4, "z": 6})
        self.assertNotEqual(grid["reference_3d"]["trust"], "corroborated")
        self.assertEqual(grid["cameras"][2]["status"], "bad")
        self.assertEqual(grid["cameras"][2]["detection_source"], "two_view_3d_reprojection")
        self.assertFalse(grid["cameras"][2]["original_3d_primary"])

    def test_unknown_geometry_but_reliable_original_3d_can_flag_bad(self):
        labels = copy.deepcopy(self.labels)
        labels[4]["x"] += 100
        grid = self.make_grid(["ok", "ok", "ok", "ok", "unknown"],
                              labels=labels, original_3d=self.point)
        self.assertEqual(grid["cameras"][4]["status"], "bad")
        self.assertEqual(grid["cameras"][4]["detection_source"], "original_3d_primary_bad")


class Original3DPrimaryRepairTest(unittest.TestCase):
    def test_preview_uses_original_3d_as_first_repair_source(self):
        from sqlalchemy import BigInteger, create_engine
        from sqlalchemy.ext.compiler import compiles
        from sqlalchemy.orm import sessionmaker

        @compiles(BigInteger, "sqlite")
        def _bigint(_type, _compiler, **_kw):
            return "INTEGER"

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine)()
        try:
            cams = [camera(0, 0), camera(1, -1.5), camera(2, .1, -1),
                    camera(3, -1.2, -.8), camera(4, -.6, .7)]
            p = {"x": .6, "y": .2, "z": 6.0}
            db.add(Match(id=88, title="primary 3d test", fps=50, duration_frame=50, cameras=cams))
            db.add(BallTraj(id=99, match_id=88, frame=10, t_sec=.2,
                            x=p["x"], y=p["y"], z=p["z"], confidence=1))
            for i, cam in enumerate(cams):
                pixel = project_raw_point(p, cam)
                db.add(BallPosition2D(match_id=88, camera_index=i, frame=10,
                                      visibility=1, x=pixel["x"]+(90 if i == 4 else 0),
                                      y=pixel["y"]))
            db.commit()
            initial = db.query(BallPosition2D).filter_by(match_id=88, camera_index=4).one().x
            result = auto_repair_traj_2d(88, AutoRepair2DPayload(start_frame=10, end_frame=10,
                                                                  dry_run=True), db)
            self.assertEqual(result["detected_bad_frames"], 1)
            self.assertEqual(result["repaired_frames"], 1)
            repaired = [x for x in result["frames"] if x["status"] == "would_repair"][0]
            self.assertEqual(repaired["mode"], "original_3d_primary")
            self.assertEqual(repaired["replacement_sources"][4], "original_3d_primary")
            self.assertEqual(db.query(BallPosition2D).filter_by(match_id=88, camera_index=4).one().x, initial)
            self.assertEqual(db.query(BallTraj).filter_by(match_id=88, frame=10).one().z, 6.0)
            # Apply and undo must preserve the original 3D and exactly restore 2D.
            from app.auto_repair import UndoAutoRepairPayload, undo_auto_repair_traj_2d
            applied = auto_repair_traj_2d(
                88, AutoRepair2DPayload(start_frame=10, end_frame=10, dry_run=False), db,
            )
            self.assertEqual(applied["repaired_frames"], 1)
            projected = project_raw_point(p, cams[4])
            self.assertAlmostEqual(db.query(BallPosition2DCorrection).filter_by(match_id=88, camera_index=4).one().x,
                                   projected["x"], places=5)
            self.assertAlmostEqual(db.query(BallPosition2D).filter_by(match_id=88, camera_index=4).one().x,
                                   initial, places=5)
            self.assertEqual(db.query(BallTraj).filter_by(match_id=88, frame=10).one().z, 6.0)
            undo = undo_auto_repair_traj_2d(88, UndoAutoRepairPayload(repair_ids=applied["repair_ids"]), db)
            self.assertTrue(undo["ok"])
            self.assertEqual(db.query(BallPosition2DCorrection).filter_by(match_id=88, camera_index=4).count(), 0)
            self.assertAlmostEqual(db.query(BallPosition2D).filter_by(match_id=88, camera_index=4).one().x,
                                   initial, places=5)
            self.assertEqual(db.query(BallTraj).filter_by(match_id=88, frame=10).one().z, 6.0)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
