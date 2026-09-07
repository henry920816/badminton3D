import unittest

from fastapi import HTTPException
from sqlalchemy import (
    BigInteger,
    create_engine,
)
from sqlalchemy.ext.compiler import (
    compiles,
)
from sqlalchemy.orm import sessionmaker

from app.auto_repair import AutoRepair2DPayload, auto_repair_traj_2d, UndoAutoRepairPayload, undo_auto_repair_traj_2d

from app.main import (
    repair_traj_from_2d,
    undo_traj_2d_repair,
)
from app.models import (
    BallPosition2D,
    BallTraj,
    Base,
    Match,
    TrajectoryRepairHistory,
)
from app.schemas import (
    Traj2DObservation,
    Traj2DRepairPayload,
)
from app.triangulation import (
    pairwise_triangulation_diagnostics,
    project_raw_point,
    scan_2d_camera_grid,
)


@compiles(
    BigInteger,
    "sqlite",
)
def compile_big_integer_for_sqlite(
    _type,
    _compiler,
    **_kwargs,
):
    return "INTEGER"


def camera(
    index,
    translation_x,
):
    return {
        "id": f"cam{index}",
        "index": index,
        "projection": {
            "intrinsic": [
                1000.0,
                1000.0,
                320.0,
                240.0,
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
            ],
            "extrinsic": [
                [
                    1.0,
                    0.0,
                    0.0,
                    translation_x,
                ],
                [
                    0.0,
                    1.0,
                    0.0,
                    0.0,
                ],
                [
                    0.0,
                    0.0,
                    1.0,
                    0.0,
                ],
            ],
            "coordinateMode": "raw",
            "useLensDistortion": False,
            "uOffset": 0.0,
            "vOffset": 0.0,
        },
    }


class Repair2DApiTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite+pysqlite:///:memory:"
        )
        Base.metadata.create_all(
            engine
        )
        session_factory = sessionmaker(
            bind=engine
        )
        self.db = session_factory()
        self.cameras = [
            camera(0, 0.0),
            camera(1, -1.0),
        ]
        match = Match(
            title="2D repair test",
            fps=50.0,
            duration_frame=1000,
            cameras=self.cameras,
        )
        self.db.add(match)
        self.db.flush()
        self.match_id = match.id
        self.db.add(
            BallTraj(
                id=1,
                match_id=self.match_id,
                frame=100,
                t_sec=2.0,
                x=0.0,
                y=0.0,
                z=5.0,
                speed=None,
                confidence=1.0,
            )
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def payload(
        self,
        confirm,
    ):
        target = {
            "x": 0.5,
            "y": 0.2,
            "z": 5.0,
        }
        observations = []

        for item in self.cameras:
            projected = project_raw_point(
                target,
                item,
            )
            observations.append(
                Traj2DObservation(
                    camera_index=(
                        item["index"]
                    ),
                    x=projected["x"],
                    y=projected["y"],
                )
            )

        return Traj2DRepairPayload(
            frame=100,
            observations=observations,
            confirm=confirm,
        )

    def test_preview_does_not_write(self):
        result = repair_traj_from_2d(
            self.match_id,
            self.payload(False),
            self.db,
        )
        current = (
            self.db.query(BallTraj)
            .filter(
                BallTraj.match_id
                == self.match_id,
                BallTraj.frame == 100,
            )
            .one()
        )

        self.assertFalse(
            result["confirmed"]
        )
        self.assertAlmostEqual(
            result[
                "trajectory_point"
            ]["x"],
            0.5,
            places=6,
        )
        self.assertEqual(
            current.x,
            0.0,
        )
        self.assertEqual(
            self.db.query(
                TrajectoryRepairHistory
            ).count(),
            0,
        )

    def test_confirm_and_undo(self):
        result = repair_traj_from_2d(
            self.match_id,
            self.payload(True),
            self.db,
        )
        current = (
            self.db.query(BallTraj)
            .filter(
                BallTraj.match_id
                == self.match_id,
                BallTraj.frame == 100,
            )
            .one()
        )

        self.assertTrue(
            result["confirmed"]
        )
        self.assertAlmostEqual(
            current.x,
            0.5,
            places=6,
        )
        self.assertEqual(
            self.db.query(
                BallPosition2D
            ).count(),
            2,
        )
        confirmed_match = self.db.get(
            Match,
            self.match_id,
        )
        self.assertTrue(
            confirmed_match.cameras[0][
                "has_ball_2d"
            ]
        )

        undo_result = (
            undo_traj_2d_repair(
                self.match_id,
                result["repair_id"],
                self.db,
            )
        )
        restored = (
            self.db.query(BallTraj)
            .filter(
                BallTraj.match_id
                == self.match_id,
                BallTraj.frame == 100,
            )
            .one()
        )

        self.assertTrue(
            undo_result["ok"]
        )
        self.assertEqual(
            restored.x,
            0.0,
        )
        self.assertEqual(
            self.db.query(
                BallPosition2D
            ).count(),
            0,
        )
        restored_match = self.db.get(
            Match,
            self.match_id,
        )
        self.assertFalse(
            restored_match.cameras[0][
                "has_ball_2d"
            ]
        )
        history = self.db.get(
            TrajectoryRepairHistory,
            result["repair_id"],
        )
        self.assertIsNotNone(
            history.reverted_at
        )

    def test_undo_refuses_newer_changes(self):
        result = repair_traj_from_2d(
            self.match_id,
            self.payload(True),
            self.db,
        )
        current = (
            self.db.query(BallTraj)
            .filter(
                BallTraj.match_id
                == self.match_id,
                BallTraj.frame == 100,
            )
            .one()
        )
        current.x = 9.0
        self.db.commit()

        with self.assertRaises(
            HTTPException
        ) as context:
            undo_traj_2d_repair(
                self.match_id,
                result["repair_id"],
                self.db,
            )

        self.assertEqual(
            context.exception.status_code,
            409,
        )

    def make_auto_batch(self):
        ids = []
        for frame in (101, 102):
            original = dict(frame=frame, t_sec=frame/50, x=1.0, y=2.0, z=3.0, speed=None, confidence=1.0)
            repaired = dict(original, x=1.5)
            self.db.add(BallTraj(match_id=self.match_id, **repaired))
            self.db.add(BallPosition2D(match_id=self.match_id, frame=frame, camera_index=0, x=120, y=200, visibility=1))
            history = TrajectoryRepairHistory(match_id=self.match_id, frame=frame, source='auto_2d_only',
                original_point=None, repaired_point={},
                original_2d=[dict(camera_index=0, existed=True, x=100, y=200, visibility=1)],
                repaired_2d=[dict(camera_index=0, frame=frame, x=120, y=200, visibility=1)])
            self.db.add(history)
            self.db.flush()
            ids.append(history.id)
        self.db.commit()
        return ids

    def test_batch_undo_restores_both_frames_and_rejects_repeat(self):
        ids = self.make_auto_batch()
        result = undo_auto_repair_traj_2d(self.match_id, UndoAutoRepairPayload(repair_ids=ids), self.db)
        self.assertEqual(result['reverted_frames'], 2)
        for frame in (101, 102):
            self.assertEqual(self.db.query(BallTraj).filter_by(match_id=self.match_id, frame=frame).one().x, 1.5)
            self.assertEqual(self.db.query(BallPosition2D).filter_by(match_id=self.match_id, frame=frame).one().x, 100)
        with self.assertRaises(HTTPException):
            undo_auto_repair_traj_2d(self.match_id, UndoAutoRepairPayload(repair_ids=ids), self.db)

    def test_batch_undo_rolls_back_entire_batch_on_2d_conflict(self):
        ids = self.make_auto_batch()
        point = self.db.query(BallPosition2D).filter_by(match_id=self.match_id, frame=101).one()
        point.x = 130
        self.db.commit()
        with self.assertRaises(HTTPException):
            undo_auto_repair_traj_2d(self.match_id, UndoAutoRepairPayload(repair_ids=ids), self.db)
        for frame in (101, 102):
            self.assertEqual(self.db.query(BallTraj).filter_by(match_id=self.match_id, frame=frame).one().x, 1.5)
        self.assertEqual(self.db.query(BallPosition2D).filter_by(match_id=self.match_id, frame=102).one().x, 120)
        self.assertTrue(all(self.db.get(TrajectoryRepairHistory, i).reverted_at is None for i in ids))

    def test_batch_undo_never_deletes_3d_point(self):
        ids = self.make_auto_batch()
        history = self.db.get(TrajectoryRepairHistory, ids[0])
        history.original_point = None
        self.db.commit()
        result = undo_auto_repair_traj_2d(self.match_id, UndoAutoRepairPayload(repair_ids=ids), self.db)
        self.assertEqual(result['deleted_frames'], [])
        self.assertIsNotNone(self.db.query(BallTraj).filter_by(match_id=self.match_id, frame=101).first())

    def trajectory_snapshot(self):
        return [tuple(getattr(row, c.name) for c in BallTraj.__table__.columns)
                for row in self.db.query(BallTraj).order_by(BallTraj.id).all()]

    def test_auto_repair_with_new_detector_preview_apply_and_undo(self):
        self.run_2d_roundtrip()

    def test_auto_repair_without_any_3d_data(self):
        self.db.query(BallTraj).delete()
        self.db.commit()
        self.run_2d_roundtrip()
        self.assertEqual(self.db.query(BallTraj).count(), 0)

    def test_batch_undo_rejects_legacy_3d_repair(self):
        ids = self.make_auto_batch()
        self.db.get(TrajectoryRepairHistory, ids[0]).source = 'auto_2d_safe'
        self.db.commit()
        before = self.trajectory_snapshot()
        with self.assertRaises(HTTPException):
            undo_auto_repair_traj_2d(self.match_id, UndoAutoRepairPayload(repair_ids=ids), self.db)
        self.assertEqual(self.trajectory_snapshot(), before)
        self.assertTrue(all(self.db.get(TrajectoryRepairHistory, i).reverted_at is None for i in ids))

    def test_single_3d_undo_rejects_2d_only_history(self):
        ids = self.make_auto_batch()
        before = self.trajectory_snapshot()
        with self.assertRaises(HTTPException):
            undo_traj_2d_repair(self.match_id, ids[0], self.db)
        self.assertEqual(self.trajectory_snapshot(), before)

    def run_2d_roundtrip(self):
        cameras = [camera(i, -(i % 2)) for i in range(4)]
        for i in (2, 3):
            cameras[i]["projection"]["extrinsic"][1][3] = -1.0
        match = self.db.get(Match, self.match_id)
        match.cameras = cameras
        target = {"x": 0.5, "y": 0.2, "z": 5.0}
        for item in cameras:
            point = project_raw_point(target, item)
            self.db.add(BallPosition2D(
                match_id=self.match_id, camera_index=item["index"], frame=100,
                visibility=1, x=point["x"] + (120 if item["index"] == 2 else 0), y=point["y"],
            ))
        self.db.commit()
        row = self.db.query(BallPosition2D).filter_by(match_id=self.match_id, camera_index=2, frame=100).one()
        original_x = row.x
        before3d = self.trajectory_snapshot()
        before2d = {p.camera_index: (p.x, p.y, p.visibility) for p in self.db.query(BallPosition2D).all()}
        preview = auto_repair_traj_2d(self.match_id, AutoRepair2DPayload(start_frame=100, end_frame=100, dry_run=True), self.db)
        self.assertEqual(preview["repaired_frames"], 1)
        self.assertEqual(row.x, original_x)
        self.assertEqual(self.trajectory_snapshot(), before3d)
        applied = auto_repair_traj_2d(self.match_id, AutoRepair2DPayload(start_frame=100, end_frame=100), self.db)
        self.assertEqual(applied["repaired_frames"], 1)
        self.assertAlmostEqual(row.x, original_x - 120, places=5)
        self.assertTrue(all(c["status"] == "ok" for c in applied["grid"][0]["cameras"]))
        self.assertEqual(self.trajectory_snapshot(), before3d)
        self.assertEqual(applied['trajectory_points'], [])
        for point in self.db.query(BallPosition2D).all():
            if point.camera_index != 2:
                self.assertEqual((point.x, point.y, point.visibility), before2d[point.camera_index])
        undo_auto_repair_traj_2d(self.match_id, UndoAutoRepairPayload(repair_ids=applied['repair_ids']), self.db)
        self.assertAlmostEqual(row.x, original_x)
        self.assertEqual(self.trajectory_snapshot(), before3d)
        self.assertEqual({p.camera_index: (p.x, p.y, p.visibility) for p in self.db.query(BallPosition2D).all()}, before2d)

    def test_pairwise_diagnostics_ranks_shifted_camera_first(self):
        cameras = [
            camera(0, 0.0),
            camera(1, -1.0),
            camera(2, 0.0),
            camera(3, -1.0),
        ]
        # Give cameras 2 and 3 a vertical baseline as well, avoiding the
        # degenerate same-pose setup used by the repair tests above.
        cameras[2]["projection"]["extrinsic"][1][3] = -1.0
        cameras[3]["projection"]["extrinsic"][1][3] = -1.0
        target = {"x": 0.5, "y": 0.2, "z": 5.0}
        observations = []

        for item in cameras:
            projected = project_raw_point(target, item)
            observations.append({
                "camera_index": item["index"],
                "x": projected["x"],
                "y": projected["y"],
            })

        observations[2]["x"] += 120.0
        result = pairwise_triangulation_diagnostics(
            {item["index"]: item for item in cameras},
            observations,
        )

        self.assertEqual(result["suspected_camera_index"], 2)
        self.assertEqual(result["camera_scores"][0]["camera_index"], 2)
        self.assertEqual(len(result["pair_reconstructions"]), 6)

    def test_scan_2d_camera_grid_flags_no_data_and_bad_camera(self):
        cameras = [
            camera(0, 0.0),
            camera(1, -1.0),
            camera(2, 0.0),
            camera(3, -1.0),
        ]
        cameras[2]["projection"]["extrinsic"][1][3] = -1.0
        cameras[3]["projection"]["extrinsic"][1][3] = -1.0
        cameras_by_index = {item["index"]: item for item in cameras}
        target = {"x": 0.5, "y": 0.2, "z": 5.0}

        def observations_for(target_point, shift_camera=None, shift_x=0.0):
            observations = []
            for item in cameras:
                projected = project_raw_point(target_point, item)
                x = projected["x"]
                if shift_camera == item["index"]:
                    x += shift_x
                observations.append({
                    "camera_index": item["index"],
                    "x": x,
                    "y": projected["y"],
                })
            return observations

        observations_by_frame = {
            10: observations_for(target)[:2],
            20: observations_for(target, shift_camera=2, shift_x=120.0),
            30: observations_for(target),
        }

        results = scan_2d_camera_grid(
            cameras_by_index,
            observations_by_frame,
            start_frame=10,
            end_frame=30,
        )

        self.assertEqual([item["frame"] for item in results], list(range(10, 31)))

        by_frame = {item["frame"]: item["cameras"] for item in results}

        def status_of(frame, camera_index):
            return next(
                entry["status"]
                for entry in by_frame[frame]
                if entry["camera_index"] == camera_index
            )

        # Frame 15 has no observations at all -> every camera is no_data.
        self.assertTrue(
            all(entry["status"] == "no_data" for entry in by_frame[15])
        )

        # Frame 10 only has cameras 0 and 1 -> the other two are no_data,
        # and with fewer than three views nothing can be cross-checked.
        self.assertEqual(status_of(10, 0), "unknown")
        self.assertEqual(status_of(10, 1), "unknown")
        self.assertEqual(status_of(10, 2), "no_data")
        self.assertEqual(status_of(10, 3), "no_data")

        # Frame 20 shifts camera 2 far enough to flag it as bad.
        self.assertEqual(status_of(20, 2), "bad")
        self.assertEqual(status_of(20, 0), "ok")
        self.assertEqual(status_of(20, 1), "ok")
        self.assertEqual(status_of(20, 3), "ok")

        # Frame 30 is fully consistent.
        self.assertTrue(
            all(entry["status"] == "ok" for entry in by_frame[30])
        )


if __name__ == "__main__":
    unittest.main()
