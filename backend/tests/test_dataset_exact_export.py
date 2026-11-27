"""匯出必須沿用原始檔案格式，不能用 DB 猜回 PTH、Mask 或多餘 CSV 欄位。"""

import asyncio
import io
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi import BackgroundTasks, UploadFile, HTTPException
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

from app import reconstruction_assets
from app.dataset_originals import (
    save_new_dataset_sources, replace_saved_sources, source_records,
)
from app.dataset_export import export_dataset_categories, _csv_with_2d_corrections
from app.dataset_upload import default_manifest
from app.dataset_2d_files import replace_dataset_2d_files
from app.models import Base, Match, Rally, BallPosition2D, BallPosition2DCorrection


@compiles(BigInteger, 'sqlite')
def sqlite_bigint(_type, _compiler, **kw):
    return 'INTEGER'


class ExactExportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_root = reconstruction_assets.DATASET_ASSET_ROOT
        reconstruction_assets.DATASET_ASSET_ROOT = Path(self.temp.name) / 'assets'
        engine = create_engine('sqlite+pysqlite:///:memory:')
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        match = Match(title='test', fps=50, duration_frame=200,
                      cameras=[{'id': 'cam3', 'index': 3}])
        self.db.add(match)
        self.db.flush()
        self.mid = match.id
        self.db.add(Rally(match_id=self.mid, rally_index=1,
                          start_frame=100, end_frame=105, game_index=1,
                          score_label='1_01_00'))
        self.db.add(BallPosition2D(match_id=self.mid, camera_index=3,
                                   frame=101, visibility=1, x=123, y=234))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        reconstruction_assets.DATASET_ASSET_ROOT = self.original_root
        self.temp.cleanup()

    def originals(self):
        buf = io.BytesIO()
        np.save(buf, np.asarray([[1, 2, 3], [111, 222, 333]], dtype=np.float32))
        ball = buf.getvalue()
        buf = io.BytesIO()
        np.save(buf, np.asarray([1, 0], dtype=np.bool_))
        mask = buf.getvalue()
        name = 'match11_1_100_105_view3_calib_ball.csv'
        csv2d = b'Frame,Visibility,X,Y,Color,Note\r\n1,1,123,234,white,unchanged\r\n2,1,200,300,white,keep\r\n'
        extras = {
            'cameras': [('Cam_3_intrinsic.npy', ball)],
            'rally-data': [('Set1/RallySeg.csv', b'Score,UpCourt,DownCourt,Start,End,Comment,Player\r\n1_01_00,A,B,100,105,0,1\r\n')],
            'ball': [('1_01_00.npy', ball)],
            'ball-mask': [('1_01_00.npy', mask)],
            'ball-2d': [(f'rally1/view3/v3/{name}', csv2d)],
            'human-racket': [('new_racket_npz/competition/1_01_00_0.pth', b'ORIGINAL PTH BINARY')],
        }
        additions = [(category, path, content)
                     for category, records in extras.items()
                     for path, content in records]
        replace_saved_sources(self.mid, additions)
        return extras

    def test_reupload_invalidates_only_stale_corrections_and_keeps_audit(self):
        from app.ball2d_corrections import load_ball_2d_rows
        from app.models import TrajectoryRepairHistory
        self.db.add(BallPosition2DCorrection(match_id=self.mid, camera_index=3,
                                             frame=101, visibility=1, x=555, y=666))
        self.db.commit()
        name = 'match11_1_100_105_view3_ball.csv'
        rows = 'Frame,Visibility,X,Y\n1,1,456,789\n2,1,200,300\n'
        result = asyncio.run(replace_dataset_2d_files(
            self.mid, [UploadFile(filename=name, file=io.BytesIO(rows.encode()))], self.db))
        self.assertEqual(result['invalidated_corrections'], 1)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)
        self.assertEqual(self.db.query(TrajectoryRepairHistory).filter_by(
            source='source_2d_reupload').one().original_2d[0]['x'], 555)
        corrected = load_ball_2d_rows(self.db, self.mid, 101, 101,
                                      camera_index=3, source='corrected')
        self.assertEqual(corrected[0]['x'], 456)

    def test_reupload_keeps_correction_if_original_point_is_identical(self):
        self.db.add(BallPosition2DCorrection(match_id=self.mid, camera_index=3,
                                             frame=101, visibility=1, x=555, y=666))
        self.db.commit()
        name = 'match11_1_100_105_view3_ball.csv'
        rows = 'Frame,Visibility,X,Y\n1,1,123,234\n'
        result = asyncio.run(replace_dataset_2d_files(
            self.mid, [UploadFile(filename=name, file=io.BytesIO(rows.encode()))], self.db))
        self.assertEqual(result['invalidated_corrections'], 0)
        self.assertEqual(self.db.query(BallPosition2DCorrection).one().x, 555)

    def test_source_publish_failure_does_not_commit_database(self):
        from app.dataset_originals import StagedSourceReplacement, source_records
        name = 'match11_1_100_105_view3_ball.csv'
        data = b'Frame,Visibility,X,Y\n1,1,999,888\n'
        with patch.object(StagedSourceReplacement, 'publish', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                asyncio.run(replace_dataset_2d_files(
                    self.mid, [UploadFile(filename=name, file=io.BytesIO(data))], self.db))
        self.assertEqual(self.db.query(BallPosition2D).filter_by(frame=101).one().x, 123)
        self.assertIsNone(source_records(self.mid))

    def test_export_detects_db_source_checksum_mismatch(self):
        name = 'match11_1_100_105_view3_ball.csv'
        data = b'Frame,Visibility,X,Y\n1,1,123,234\n'
        asyncio.run(replace_dataset_2d_files(
            self.mid, [UploadFile(filename=name, file=io.BytesIO(data))], self.db))
        self.db.query(BallPosition2D).filter_by(frame=101).one().x = 777
        self.db.commit()
        with self.assertRaises(HTTPException) as context:
            export_dataset_categories(self.mid, BackgroundTasks(),
                                      categories='ball-2d', db=self.db)
        self.assertEqual(context.exception.status_code, 409)
        self.assertIn('版本不一致', context.exception.detail)

    def test_all_categories_unedited_files_are_byte_identical(self):
        extras = self.originals()
        response = export_dataset_categories(self.mid, BackgroundTasks(),
                                              categories=','.join(extras), db=self.db)
        try:
            with zipfile.ZipFile(response.path) as archive:
                for category, records in extras.items():
                    for path, content in records:
                        self.assertEqual(archive.read(f'{category}/{path}'), content)
                self.assertNotIn('export_info.json', archive.namelist())
                self.assertNotIn('corrections.csv', archive.namelist())
        finally:
            Path(response.path).unlink(missing_ok=True)

    def test_2d_export_preserves_original_header_and_filename(self):
        self.originals()
        self.db.add(BallPosition2DCorrection(match_id=self.mid, camera_index=3,
                        frame=101, visibility=1, x=566.5, y=577.25))
        self.db.add(BallPosition2DCorrection(match_id=self.mid, camera_index=3,
                        frame=102, visibility=0, x=0, y=0))
        self.db.add(BallPosition2DCorrection(match_id=self.mid, camera_index=3,
                        frame=103, visibility=1, x=633, y=444))
        self.db.commit()
        response = export_dataset_categories(self.mid, BackgroundTasks(),
                                              categories='ball-2d', db=self.db)
        try:
            with zipfile.ZipFile(response.path) as archive:
                name = 'ball-2d/rally1/view3/v3/match11_1_100_105_view3_calib_ball.csv'
                rows = archive.read(name)
                self.assertIn(b'Frame,Visibility,X,Y,Color,Note\r\n', rows)
                self.assertIn(b'1,1,566.5,577.25,white,unchanged', rows)
                self.assertIn(b'2,0,0,0,white,keep', rows)
                self.assertIn(b'3,1,633,444,,', rows)
                self.assertEqual(len(archive.namelist()), 1)
        finally:
            Path(response.path).unlink(missing_ok=True)

    def test_without_originals_returns_409(self):
        with self.assertRaises(HTTPException) as context:
            export_dataset_categories(self.mid, BackgroundTasks(),
                                      categories='ball', db=self.db)
        self.assertEqual(context.exception.status_code, 409)

    def test_missing_2d_file_covering_correction_is_not_silently_lost(self):
        self.originals()
        self.db.add(BallPosition2DCorrection(match_id=self.mid, camera_index=3,
                                             frame=110, visibility=1, x=555, y=444))
        self.db.commit()
        with self.assertRaises(HTTPException) as context:
            export_dataset_categories(self.mid, BackgroundTasks(),
                                      categories='ball-2d', db=self.db)
        self.assertEqual(context.exception.status_code, 409)
        self.assertIn('修正', context.exception.detail)

    def test_export_creates_same_format_csv_for_manually_added_camera_frame(self):
        self.originals()
        # Cam 4 原本沒有上傳 2D，但之後人工在此 Rally 補點。
        self.db.add(BallPosition2DCorrection(match_id=self.mid, camera_index=4,
                                             frame=103, visibility=1, x=500, y=400))
        self.db.commit()
        response = export_dataset_categories(self.mid, BackgroundTasks(),
                                              categories='ball-2d', db=self.db)
        try:
            with zipfile.ZipFile(response.path) as archive:
                name = 'ball-2d/rally1/view4/v3/match11_1_100_105_view4_ball.csv'
                self.assertIn(name, archive.namelist())
                self.assertIn(b'Frame,Visibility,X,Y\n3,1,500,400\n', archive.read(name))
        finally:
            Path(response.path).unlink(missing_ok=True)

    def test_reupload_same_rally_camera_replaces_old_filename(self):
        self.originals()
        replace_saved_sources(self.mid, [
            ('ball-2d', 'rally1/view3/v3/match99_1_100_105_view3_ball.csv',
             b'Frame,Visibility,X,Y\n1,1,17,18\n')
        ])
        paths = [item['relative_path'] for item in source_records(self.mid)
                 if item['category'] == 'ball-2d']
        self.assertEqual(paths, ['rally1/view3/v3/match99_1_100_105_view3_ball.csv'])

    def test_original_folder_with_spaces_is_preserved_in_raw_manifest(self):
        from app.dataset_upload import store_uploaded_files
        base = Path(self.temp.name) / 'stage'
        base.mkdir()
        manifest = default_manifest('token')
        upload = UploadFile(filename='RallySeg.csv', file=io.BytesIO(
            b'Score,Start,End\n1_01_00,100,105\n'))
        asyncio.run(store_uploaded_files(base, manifest, 'rally-data', [upload],
                                         ['原始 資料夾/Set1/RallySeg.csv']))
        self.assertEqual(manifest['categories']['rally-data'][0]['original_relative_path'],
                         '原始 資料夾/Set1/RallySeg.csv')
        save_new_dataset_sources(self.mid, base, manifest)
        self.assertEqual(source_records(self.mid)[0]['relative_path'],
                         '原始 資料夾/Set1/RallySeg.csv')

    def test_new_session_saves_original_binary_unchanged(self):
        temp = Path(self.temp.name) / 'sessions'
        temp.mkdir()
        src = temp / 'original.npy'
        src.write_bytes(b'\x93NUMPY\x00\x01test')
        manifest = default_manifest('testtoken')
        manifest['categories']['ball'] = [{
            'relative_path': 'original.npy',
            'stored_path': src.name,
        }]
        save_new_dataset_sources(self.mid, temp, manifest)
        records = source_records(self.mid)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['relative_path'], 'original.npy')

    def test_reupload_2d_saves_source_csv_and_data(self):
        f = UploadFile(filename='match11_1_100_105_view3_calib_ball.csv',
                       file=io.BytesIO(b'Frame,Visibility,X,Y,Extra\n1,1,88,99,ok\n'))
        result = asyncio.run(replace_dataset_2d_files(self.mid, [f], self.db))
        self.assertTrue(result['source_backup_saved'])
        self.assertEqual(self.db.query(BallPosition2D).filter_by(frame=101).one().x, 88)
        response = export_dataset_categories(self.mid, BackgroundTasks(),
                                              categories='ball-2d', db=self.db)
        try:
            with zipfile.ZipFile(response.path) as archive:
                self.assertEqual(archive.read('ball-2d/rally1/view3/v3/match11_1_100_105_view3_calib_ball.csv'),
                                 b'Frame,Visibility,X,Y,Extra\n1,1,88,99,ok\n')
        finally:
            Path(response.path).unlink(missing_ok=True)


if __name__ == '__main__':
    unittest.main()
