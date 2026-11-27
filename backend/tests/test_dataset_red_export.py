"""整場紅色批次修正與勾選類別匯出測試。"""

import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

from app.dataset_red_cleanup import repair_all_red_dataset
from app.dataset_export import export_dataset_categories
from app.edit_history import undo_2d_edit, redo_2d_edit
from app.models import Base, Match, Rally, BallTraj, BallPosition2D, BallPosition2DCorrection, Hit
from app.triangulation import project_raw_point


@compiles(BigInteger, 'sqlite')
def sqlite_bigint(_type, _compiler, **kwargs):
    return 'INTEGER'


def camera(index, tx):
    return {
        'id': f'cam{index}', 'index': index,
        'projection': {
            'intrinsic': [1000., 1000., 320., 240., 0., 0., 0., 0., 0.],
            'extrinsic': [[1., 0., 0., tx], [0., 1., 0., 0.], [0., 0., 1., 0.]],
            'imageWidth': 640, 'imageHeight': 480,
            'useLensDistortion': False, 'coordinateMode': 'raw',
            'uOffset': 0., 'vOffset': 0.,
        },
    }


class RedDatasetAndExportTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine('sqlite+pysqlite:///:memory:')
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.cams = [camera(i, tx) for i, tx in enumerate((0., -1., 0.7))]
        self.point = {'x': 0.1, 'y': 0.2, 'z': 5.}
        match = Match(title='export-test', fps=50, duration_frame=10000, cameras=self.cams)
        self.db.add(match)
        self.db.flush()
        self.mid = match.id
        for rid, frame in enumerate((100, 9100), 1):
            rally = Rally(match_id=self.mid, rally_index=rid, start_frame=frame,
                          end_frame=frame + 5, game_index=1,
                          score_label=f'1_0{rid}_00')
            self.db.add(rally)
            self.db.flush()
            self.db.add(Hit(match_id=self.mid, rally_id=rally.id,
                            ball_round=1, player='Up', hit_frame=frame + 100))
            self.db.add(BallTraj(match_id=self.mid, frame=frame, t_sec=frame / 50,
                                 x=self.point['x'], y=self.point['y'], z=self.point['z']))
            for index, cam in enumerate(self.cams):
                xy = project_raw_point(self.point, cam)
                self.db.add(BallPosition2D(match_id=self.mid, camera_index=index,
                    frame=frame, visibility=1, x=xy['x'] + (70 if index == 2 else 0),
                    y=xy['y']))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_all_rallies_red_and_one_undo(self):
        result = repair_all_red_dataset(self.mid, self.db)
        self.assertEqual(result['repaired_points'], 2)
        self.assertEqual(result['affected_rallies'], 2)
        self.assertEqual({row.camera_index for row in self.db.query(BallPosition2DCorrection)}, {2})
        self.assertEqual(undo_2d_edit(self.mid, self.db)['updated_points'], 2)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)
        self.assertEqual(redo_2d_edit(self.mid, self.db)['updated_points'], 2)
        self.assertEqual(repair_all_red_dataset(self.mid, self.db)['repaired_points'], 0)

    def test_old_dataset_export_rejects_fabricated_original_files(self):
        repair_all_red_dataset(self.mid, self.db)
        with self.assertRaises(HTTPException) as context:
            export_dataset_categories(self.mid, BackgroundTasks(),
                                      categories='ball-2d,cameras', db=self.db)
        self.assertEqual(context.exception.status_code, 409)
        self.assertIn('原始', context.exception.detail)

    def test_export_rejects_bad_categories(self):
        with self.assertRaises(HTTPException) as context:
            export_dataset_categories(self.mid, BackgroundTasks(), categories='bad-cat', db=self.db)
        self.assertEqual(context.exception.status_code, 400)


if __name__ == '__main__':
    unittest.main()
