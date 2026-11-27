"""2D 人工修正、藍色長按、紅色批次都能上一步／下一步。"""
import unittest
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from app.models import Base, Match, BallPosition2D, BallPosition2DCorrection, BallTraj
from app.ball2d_corrections import save_ball_2d_correction, delete_ball_2d_correction, Ball2DCorrectionPayload
from app.review_repair_routes import hide_blue_2d_labels, ManualBlueHidePayload, review_repair_traj_2d, ReviewRepairPayload
from app.edit_history import undo_2d_edit, redo_2d_edit, get_2d_edit_history
from app.triangulation import project_raw_point

@compiles(BigInteger, 'sqlite')
def sqlite_int(_type, _compiler, **_kwargs):
    return 'INTEGER'

def cam(index, tx):
    return {'id': f'cam{index}', 'index': index, 'projection': {
        'intrinsic': [1000., 1000., 320., 240., 0., 0., 0., 0., 0.],
        'extrinsic': [[1., 0., 0., tx], [0., 1., 0., 0.], [0., 0., 1., 0.]],
        'coordinateMode': 'raw', 'useLensDistortion': False,
        'uOffset': 0., 'vOffset': 0., 'imageWidth': 640, 'imageHeight': 480}}

class HistoryTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine('sqlite+pysqlite:///:memory:')
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.cameras = [cam(i, tx) for i, tx in enumerate((0., -1., 0.7, -4.))]
        self.point = {'x': .1, 'y': .2, 'z': 5.}
        m = Match(title='history', cameras=self.cameras, fps=50, duration_frame=1000)
        self.db.add(m)
        self.db.flush()
        self.match_id = m.id
        for frame in (100,101,102):
            self.db.add(BallTraj(match_id=m.id, frame=frame, t_sec=frame/50., **self.point))
            for i, camera in enumerate(self.cameras):
                xy = project_raw_point(self.point, camera)
                if i == 2: xy['x'] += 180
                if i == 3: xy = {'x':300., 'y':200.}
                self.db.add(BallPosition2D(match_id=m.id, frame=frame, camera_index=i,
                                           visibility=1, x=xy['x'], y=xy['y']))
        self.db.commit()

    def tearDown(self): self.db.close()

    def correction(self, camera, frame=100):
        return self.db.query(BallPosition2DCorrection).filter_by(match_id=self.match_id,
            camera_index=camera, frame=frame).one_or_none()

    def history(self): return get_2d_edit_history(self.match_id, self.db)
    def undo(self): return undo_2d_edit(self.match_id, self.db)
    def redo(self): return redo_2d_edit(self.match_id, self.db)

    def test_manual_save_undo_redo(self):
        save_ball_2d_correction(self.match_id,
            Ball2DCorrectionPayload(camera_index=1, frame=100, visibility=1, x=15, y=16), self.db)
        self.assertTrue(self.history()['can_undo'])
        self.assertFalse(self.history()['can_redo'])
        self.assertEqual(self.correction(1).x, 15.)
        self.undo()
        self.assertIsNone(self.correction(1))
        self.assertTrue(self.history()['can_redo'])
        self.redo()
        self.assertEqual(self.correction(1).x, 15.)

    def test_manual_overwrite_restores_previous_overlay(self):
        for x in (15, 55):
            save_ball_2d_correction(self.match_id,
                Ball2DCorrectionPayload(camera_index=1, frame=100, visibility=1, x=x, y=16), self.db)
        self.undo()
        self.assertEqual(self.correction(1).x, 15.)
        self.undo()
        self.assertIsNone(self.correction(1))
        self.redo()
        self.assertEqual(self.correction(1).x, 15.)
        self.redo()
        self.assertEqual(self.correction(1).x, 55.)

    def test_clear_manual_correction_undo_redo(self):
        save_ball_2d_correction(self.match_id,
            Ball2DCorrectionPayload(camera_index=1, frame=100, visibility=1, x=15, y=16), self.db)
        delete_ball_2d_correction(self.match_id, 1, 100, self.db)
        self.assertIsNone(self.correction(1))
        self.undo()
        self.assertEqual(self.correction(1).x, 15.)
        self.redo()
        self.assertIsNone(self.correction(1))

    def test_blue_long_press_one_step_undo_redo(self):
        hide_blue_2d_labels(self.match_id,
            ManualBlueHidePayload(camera_index=3, frames=[100,101,102]), self.db)
        self.assertEqual(self.db.query(BallPosition2DCorrection).filter_by(match_id=self.match_id).count(), 3)
        response = self.undo()
        self.assertEqual(response['updated_points'], 3)
        self.assertEqual(self.db.query(BallPosition2DCorrection).filter_by(match_id=self.match_id).count(), 0)
        self.redo()
        self.assertEqual(self.db.query(BallPosition2DCorrection).filter_by(match_id=self.match_id,visibility=0).count(), 3)
        self.assertIsNone(self.correction(0))

    def test_red_batch_one_step_undo_redo(self):
        applied = review_repair_traj_2d(self.match_id, ReviewRepairPayload(start_frame=100,end_frame=102,
                                mode='apply',camera_indexes=[2],action_filter='position'), self.db)
        self.assertEqual(applied['repaired_2d_points'], 3)
        self.undo()
        self.assertEqual(self.db.query(BallPosition2DCorrection).filter_by(match_id=self.match_id).count(), 0)
        self.redo()
        self.assertEqual(self.db.query(BallPosition2DCorrection).filter_by(match_id=self.match_id).count(), 3)

    def test_new_action_discards_redo(self):
        hide_blue_2d_labels(self.match_id,
            ManualBlueHidePayload(camera_index=3, frames=[100]), self.db)
        self.undo()
        self.assertTrue(self.history()['can_redo'])
        save_ball_2d_correction(self.match_id,
            Ball2DCorrectionPayload(camera_index=1, frame=100, visibility=1, x=15, y=16), self.db)
        self.assertFalse(self.history()['can_redo'])

if __name__ == '__main__': unittest.main()
