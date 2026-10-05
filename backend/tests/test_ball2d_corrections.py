import csv
import io
import unittest
import zipfile

from fastapi import HTTPException
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

from app.ball2d_corrections import (
    Ball2DCorrectionPayload,
    delete_ball_2d_correction,
    export_corrected_ball_2d,
    list_ball_2d_corrections,
    load_ball_2d_rows,
    save_ball_2d_correction,
)
from app.main import get_traj_2d, get_traj_2d_visible
from app.models import BallPosition2D, Base, Match, Rally


@compiles(BigInteger, "sqlite")
def compile_big_integer_for_sqlite(_type, _compiler, **_kwargs):
    return "INTEGER"


class Ball2DCorrectionTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()

        match = Match(title="corrections", fps=50.0, duration_frame=1000, cameras=[])
        self.db.add(match)
        self.db.flush()
        self.match_id = match.id

        self.db.add(Rally(match_id=self.match_id, rally_index=1, start_frame=100, end_frame=104))
        self.db.add_all([
            BallPosition2D(match_id=self.match_id, camera_index=0, frame=100, visibility=1, x=10.0, y=20.0),
            BallPosition2D(match_id=self.match_id, camera_index=0, frame=101, visibility=1, x=11.0, y=21.0),
            BallPosition2D(match_id=self.match_id, camera_index=0, frame=102, visibility=0, x=0.0, y=0.0),
            BallPosition2D(match_id=self.match_id, camera_index=1, frame=100, visibility=1, x=30.0, y=40.0),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def original_rows(self):
        return [
            (row.camera_index, row.frame, row.visibility, row.x, row.y)
            for row in self.db.query(BallPosition2D).order_by(
                BallPosition2D.camera_index, BallPosition2D.frame,
            )
        ]

    def save(self, **fields):
        return save_ball_2d_correction(
            self.match_id, Ball2DCorrectionPayload(**fields), db=self.db,
        )

    def test_corrections_leave_original_rows_untouched(self):
        before = self.original_rows()

        self.save(camera_index=0, frame=101, visibility=1, x=55.0, y=66.0)
        self.save(camera_index=0, frame=102, visibility=1, x=12.0, y=22.0)
        self.save(camera_index=1, frame=100, visibility=0)
        self.save(camera_index=0, frame=101, visibility=1, x=56.0, y=67.0)

        self.assertEqual(self.original_rows(), before)

        corrections = list_ball_2d_corrections(self.match_id, db=self.db)
        self.assertEqual(len(corrections), 3)
        first = corrections[0]
        self.assertEqual((first["frame"], first["x"], first["y"]), (101, 56.0, 67.0))
        self.assertEqual(first["original"], {"visibility": 1, "x": 11.0, "y": 21.0})

    def test_source_switches_between_original_and_corrected(self):
        self.save(camera_index=0, frame=101, visibility=1, x=55.0, y=66.0)
        self.save(camera_index=0, frame=102, visibility=1, x=12.0, y=22.0)
        self.save(camera_index=1, frame=100, visibility=0)

        original = load_ball_2d_rows(self.db, self.match_id, 0, 999, visible_only=True)
        self.assertEqual(
            [(row["camera_index"], row["frame"]) for row in original],
            [(0, 100), (1, 100), (0, 101)],
        )

        corrected = load_ball_2d_rows(
            self.db, self.match_id, 0, 999, source="corrected", visible_only=True,
        )
        # Cam 1 改成看不見後消失；原本看不見的 frame 102 修正後出現
        self.assertEqual(
            [(row["camera_index"], row["frame"], row["x"], row["corrected"]) for row in corrected],
            [(0, 100, 10.0, False), (0, 101, 55.0, True), (0, 102, 12.0, True)],
        )

        points = get_traj_2d(self.match_id, camera_index=0, source="corrected", db=self.db)
        self.assertEqual([point.corrected for point in points], [False, True, True])

    def test_visible_frames_follow_source(self):
        self.save(camera_index=0, frame=102, visibility=1, x=12.0, y=22.0)
        self.save(camera_index=1, frame=100, visibility=0)

        def pairs(source):
            return [
                (row["frame"], row["camera_index"])
                for row in get_traj_2d_visible(self.match_id, 100, 103, self.db, source)
            ]

        self.assertEqual(pairs("original"), [(100, 0), (100, 1), (101, 0)])
        self.assertEqual(pairs("corrected"), [(100, 0), (101, 0), (102, 0)])

    def test_delete_returns_to_original(self):
        self.save(camera_index=0, frame=101, visibility=1, x=55.0, y=66.0)

        result = delete_ball_2d_correction(self.match_id, camera_index=0, frame=101, db=self.db)
        self.assertEqual(result["original"], {"visibility": 1, "x": 11.0, "y": 21.0})

        corrected = load_ball_2d_rows(self.db, self.match_id, 101, 101, source="corrected")
        self.assertEqual((corrected[0]["x"], corrected[0]["corrected"]), (11.0, False))

        with self.assertRaises(HTTPException):
            delete_ball_2d_correction(self.match_id, camera_index=0, frame=101, db=self.db)

    def test_rejects_frame_beyond_match(self):
        with self.assertRaises(HTTPException):
            self.save(camera_index=0, frame=5000, visibility=1, x=1.0, y=1.0)

    def test_export_writes_upload_format_with_corrections(self):
        self.save(camera_index=0, frame=101, visibility=1, x=55.0, y=66.0)
        self.save(camera_index=0, frame=103, visibility=1, x=13.0, y=23.0)

        response = export_corrected_ball_2d(self.match_id, match_number=2, db=self.db)
        archive = zipfile.ZipFile(io.BytesIO(response.body))

        path = "rally1/view0/v3/match2_1_100_104_view0_ball.csv"
        self.assertIn(path, archive.namelist())
        rows = list(csv.DictReader(io.StringIO(archive.read(path).decode())))
        self.assertEqual(
            [(row["Frame"], row["Visibility"], row["X"]) for row in rows],
            [("0", "1", "10"), ("1", "1", "55"), ("2", "0", "0"), ("3", "1", "13")],
        )

        log = list(csv.DictReader(io.StringIO(archive.read("corrections.csv").decode())))
        self.assertEqual([row["Frame"] for row in log], ["101", "103"])
        self.assertEqual(log[1]["OriginalVisibility"], "")


if __name__ == "__main__":
    unittest.main()
