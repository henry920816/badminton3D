"""整場藍格清除與部分 CSV 重傳測試，不依賴正式 PostgreSQL。"""

import asyncio
import io
import unittest

from fastapi import HTTPException, UploadFile
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

from app.dataset_2d_files import replace_dataset_2d_files
from app.dataset_blue_cleanup import hide_blue_for_dataset
from app.edit_history import undo_2d_edit, redo_2d_edit
from app.models import Base, Match, Rally, BallTraj, BallPosition2D, BallPosition2DCorrection


@compiles(BigInteger, 'sqlite')
def sqlite_bigint(_type, _compiler, **kwargs):
    return 'INTEGER'


def cam():
    return {
        'id': 'cam0', 'index': 0,
        'projection': {
            'intrinsic': [1000., 1000., 320., 240., 0., 0., 0., 0., 0.],
            'extrinsic': [[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]],
            'coordinateMode': 'raw', 'useLensDistortion': False,
            'imageWidth': 640, 'imageHeight': 480,
        }
    }


def upload(name, content):
    return UploadFile(filename=name, file=io.BytesIO(content.encode('utf-8')))


class DatasetToolsTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine('sqlite+pysqlite:///:memory:')
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        match = Match(title='測試', fps=50, duration_frame=9500, cameras=[cam()])
        self.db.add(match)
        self.db.flush()
        self.mid = match.id
        self.db.add_all([
            Rally(match_id=self.mid, rally_index=1, start_frame=100, end_frame=110),
            Rally(match_id=self.mid, rally_index=2, start_frame=9000, end_frame=9010),
        ])
        self.db.add_all([
            BallPosition2D(match_id=self.mid, camera_index=0, frame=101, visibility=1, x=200., y=100.),
            BallPosition2D(match_id=self.mid, camera_index=0, frame=9001, visibility=1, x=210., y=110.),
            BallPosition2D(match_id=self.mid, camera_index=0, frame=9500, visibility=1, x=220., y=100.),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_all_rallies_are_scanned_and_one_undo_restores_both(self):
        result = hide_blue_for_dataset(self.mid, self.db)
        self.assertEqual(result['hidden_points'], 2)
        self.assertEqual(result['affected_rallies'], 2)
        self.assertEqual(result['total_rallies'], 2)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 2)
        self.assertEqual(self.db.query(BallPosition2D).filter_by(visibility=1).count(), 3)
        undone = undo_2d_edit(self.mid, self.db)
        self.assertEqual(undone['updated_points'], 2)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)
        redone = redo_2d_edit(self.mid, self.db)
        self.assertEqual(redone['updated_points'], 2)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 2)
        repeat = hide_blue_for_dataset(self.mid, self.db)
        self.assertEqual(repeat['hidden_points'], 0)

    def test_restore_earlier_visible_overlay(self):
        self.db.add(BallPosition2DCorrection(match_id=self.mid, camera_index=0,
                                             frame=101, visibility=1, x=330., y=220.))
        self.db.commit()
        self.assertEqual(hide_blue_for_dataset(self.mid, self.db)['hidden_points'], 2)
        undo_2d_edit(self.mid, self.db)
        corrected = self.db.query(BallPosition2DCorrection).filter_by(frame=101).one()
        self.assertEqual((corrected.visibility, corrected.x, corrected.y), (1, 330, 220))

    def test_replace_multiple_files_keeps_unselected_and_corrections(self):
        self.db.add(BallPosition2DCorrection(match_id=self.mid, camera_index=0,
                                             frame=101, visibility=0, x=0., y=0.))
        self.db.commit()
        original_first = self.db.query(BallPosition2D).filter_by(frame=101).one()
        files = [
            upload('match2_1_100_110_view0_ball.csv', 'Frame,Visibility,X,Y\n1,1,401,402\n2,0,0,0\n'),
            upload('match2_2_9000_9010_view0_ball.csv', 'Frame,Visibility,X,Y\n1,1,501,502\n'),
        ]
        result = asyncio.run(replace_dataset_2d_files(self.mid, files, self.db))
        self.assertEqual(result['replaced_files'], 2)
        self.assertEqual(result['imported_rows'], 3)
        self.assertEqual(self.db.query(BallPosition2D).filter_by(frame=101).one().x, 401.)
        self.assertEqual(self.db.query(BallPosition2D).filter_by(frame=9001).one().x, 501.)
        self.assertEqual(self.db.query(BallPosition2D).filter_by(frame=9500).one().x, 220.)
        self.assertEqual(result['invalidated_corrections'], 1)
        self.assertIsNone(self.db.query(BallPosition2DCorrection).filter_by(frame=101).first())
        from app.models import TrajectoryRepairHistory
        self.assertEqual(self.db.query(TrajectoryRepairHistory).filter_by(source='source_2d_reupload').count(), 1)

    def test_malformed_second_file_aborts_all_replacement(self):
        files = [
            upload('match2_1_100_110_view0_ball.csv', 'Frame,Visibility,X,Y\n1,1,401,402\n'),
            upload('match2_2_9000_9010_view0_ball.csv', 'Frame,Visibility,X\n1,1,501\n'),
        ]
        with self.assertRaises(HTTPException):
            asyncio.run(replace_dataset_2d_files(self.mid, files, self.db))
        self.assertEqual(self.db.query(BallPosition2D).filter_by(frame=101).one().x, 200.)
        self.assertEqual(self.db.query(BallPosition2D).filter_by(frame=9001).one().x, 210.)

    def test_long_one_click_batch_undo(self):
        # 超過一個 history chunk，也跨越傳統 6000 frame 的處理上限。
        rally = self.db.query(Rally).filter_by(rally_index=1).one()
        rally.end_frame = 500
        self.db.add_all([
            BallPosition2D(match_id=self.mid, camera_index=0, frame=frame,
                           visibility=1, x=200., y=100.)
            for frame in range(200, 500)
        ])
        self.db.commit()
        result = hide_blue_for_dataset(self.mid, self.db)
        self.assertEqual(result['hidden_points'], 302)
        self.assertGreater(len(result['repair_ids']), 1)
        self.assertEqual(undo_2d_edit(self.mid, self.db)['updated_points'], 302)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)

    def test_export_after_partial_import_includes_corrected_data(self):
        from app.ball2d_corrections import export_corrected_ball_2d
        import zipfile
        original = self.db.query(BallPosition2D).filter_by(frame=101).one()
        original.x = 321.
        self.db.commit()
        exported = export_corrected_ball_2d(self.mid, match_number=2, db=self.db)
        with zipfile.ZipFile(io.BytesIO(exported.body)) as zipped:
            names = zipped.namelist()
            self.assertIn('rally1/view0/v3/match2_1_100_110_view0_ball.csv', names)
            body = zipped.read('rally1/view0/v3/match2_1_100_110_view0_ball.csv').decode('utf-8')
            self.assertIn('1,1,321', body)
            self.assertIn('corrections.csv', names)

    def test_staging_reupload_failure_keeps_previous_file(self):
        from app.dataset_upload import default_manifest, store_uploaded_files, record_file_path
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            manifest = default_manifest('testtoken')
            name = 'match2_1_100_110_view0_ball.csv'
            path = f'rally1/view0/v3/{name}'
            good = upload(name, 'Frame,Visibility,X,Y\n1,1,100,200\n')
            asyncio.run(store_uploaded_files(base, manifest, 'ball-2d', [good], [path]))
            before = manifest['categories']['ball-2d'][0]
            content = record_file_path(base, before).read_text()
            with self.assertRaises(HTTPException):
                asyncio.run(store_uploaded_files(base, manifest, 'ball-2d',
                                                [upload(name, '')], [path]))
            self.assertEqual(len(manifest['categories']['ball-2d']), 1)
            self.assertEqual(record_file_path(base, before).read_text(), content)
            # 用不同來源資料夾補傳，仍然替換同一個 Rally/Cam，不新增重複檔。
            updated = upload(name, 'Frame,Visibility,X,Y\n1,1,300,400\n')
            asyncio.run(store_uploaded_files(base, manifest, 'ball-2d', [updated],
                                             ['newfolder/' + path]))
            self.assertEqual(len(manifest['categories']['ball-2d']), 1)
            self.assertIn('300,400', record_file_path(base, manifest['categories']['ball-2d'][0]).read_text())

    def test_staging_single_rally_file_keeps_original_folder_path(self):
        from app.dataset_upload import default_manifest, store_uploaded_files
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            manifest = default_manifest('testtoken')
            old = upload('RallySeg.csv', 'Score,Start,End\n1_1_0,1,2\n')
            asyncio.run(store_uploaded_files(base, manifest, 'rally-data',
                                             [old], ['Set1/RallySeg.csv']))
            new = upload('RallySeg.csv', 'Score,Start,End\n1_2_0,3,4\n')
            asyncio.run(store_uploaded_files(base, manifest, 'rally-data', [new], ['RallySeg.csv']))
            records = manifest['categories']['rally-data']
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]['relative_path'], 'Set1/RallySeg.csv')

    def test_duplicate_rally_camera_is_rejected(self):
        files = [
            upload('match2_1_100_110_view0_ball.csv', 'Frame,Visibility,X,Y\n1,1,401,402\n'),
            upload('match3_1_100_110_view0_ball.csv', 'Frame,Visibility,X,Y\n1,1,405,406\n'),
        ]
        with self.assertRaises(HTTPException):
            asyncio.run(replace_dataset_2d_files(self.mid, files, self.db))
        self.assertEqual(self.db.query(BallPosition2D).filter_by(frame=101).one().x, 200.)


if __name__ == '__main__':
    unittest.main()
