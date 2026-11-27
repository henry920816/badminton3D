"""兩個高可信 2D 錨點 -> 三角測量 3D -> 投影其他視角判錯。"""
import unittest

from app.ball2d_reference import attach_reference_3d, two_view_reference
from app.triangulation import project_raw_point, scan_2d_camera_grid


def cam(i, tx, ty):
    return {
        'index': i,
        'projection': {
            'intrinsic': [1050., 1050., 640., 380., 0., 0., 0., 0., 0.],
            'extrinsic': [[1., 0., 0., tx], [0., 1., 0., ty], [0., 0., 1., 0.]],
            'coordinateMode': 'raw', 'useLensDistortion': False,
            'imageWidth': 1400, 'imageHeight': 900,
        },
    }


class TwoAnchorTest(unittest.TestCase):
    def setUp(self):
        self.cams = {i: c for i, c in enumerate((cam(0, 0., 0.), cam(1, -1.4, 0.),
                                                   cam(2, 0.1, -0.8), cam(3, -1.4, -0.8)))}
        self.point = {'x': 0.8, 'y': 0.5, 'z': 6.0}
        self.obs = [{'camera_index': i, **{axis: project_raw_point(self.point, c)[axis]
                 for axis in ('x', 'y')}} for i, c in self.cams.items()]

    def run_grid(self, labels, forced_status=None, point=None):
        if forced_status is None:
            grid = scan_2d_camera_grid(self.cams, {11: labels}, 11, 11)
        else:
            grid = [{'frame': 11, 'cameras': [
                {'camera_index': i, 'status': forced_status.get(i, 'suspect'),
                 'reason': 'ambiguous'} for i in range(4)]}]
        return attach_reference_3d(grid, self.cams, {11: labels},
                                   {11: point} if point is not None else {})[0]

    def test_two_native_ok_labels_create_3d_and_make_far_other_bad(self):
        obs = [dict(o) for o in self.obs]
        obs[3]['x'] += 95
        # Source OK: a pair that has been previously verified; no stored 3D required.
        row = self.run_grid(obs, {0: 'ok', 1: 'ok', 2: 'unknown', 3: 'unknown'})
        self.assertIsNotNone(row['two_view_3d'])
        self.assertEqual(row['two_view_3d']['anchor_cameras'], [0, 1])
        self.assertEqual(row['cameras'][3]['status'], 'bad')
        self.assertEqual(row['cameras'][3]['detection_source'], 'two_view_3d_reprojection')
        self.assertTrue(row['cameras'][3]['two_view_3d_bad_override'])
        self.assertAlmostEqual(row['two_view_3d']['point']['z'], 6., places=5)
        self.assertEqual(row['cameras'][2]['status'], 'ok')
        self.assertGreater(row['cameras'][3]['two_view_3d_error_px'], 30)

    def test_only_two_manual_2d_edits_are_enough(self):
        obs = [dict(o) for o in self.obs]
        obs[0]['corrected'] = True
        obs[1]['corrected'] = True
        obs[2]['x'] += 65
        row = self.run_grid(obs, {0: 'suspect', 1: 'suspect', 2: 'suspect', 3: 'suspect'})
        self.assertEqual([row['cameras'][i]['status'] for i in (0, 1)], ['ok', 'ok'])
        self.assertEqual(row['cameras'][2]['status'], 'bad')
        self.assertEqual(row['cameras'][0]['detection_source'], 'two_view_manual_anchor')

    def test_an_unverified_2d_label_cannot_be_used_as_anchor(self):
        obs = [dict(o) for o in self.obs]
        obs[2]['x'] += 95
        row = self.run_grid(obs, {0: 'ok', 1: 'suspect', 2: 'suspect', 3: 'unknown'})
        self.assertIsNone(row['two_view_3d'])
        self.assertEqual(row['cameras'][2]['status'], 'suspect')

    def test_near_parallel_anchors_are_rejected(self):
        cams = {0: cam(0, 0, 0), 1: cam(1, -0.0001, 0), 2: cam(2, -1.4, 0)}
        point = self.point
        obs = [{'camera_index': i, **{axis: project_raw_point(point, c)[axis]
             for axis in ('x', 'y')}} for i, c in cams.items()]
        rows = [{'camera_index': 0, 'status': 'ok'}, {'camera_index': 1, 'status': 'ok'},
                {'camera_index': 2, 'status': 'unknown'}]
        self.assertIsNone(two_view_reference(cams, obs, rows))

    def test_out_of_image_label_never_forced_ok(self):
        obs = [dict(o) for o in self.obs]
        obs[2]['x'] = 9000
        row = self.run_grid(obs, {0: 'ok', 1: 'ok', 2: 'bad', 3: 'suspect'})
        self.assertEqual(row['cameras'][2]['status'], 'bad')
        self.assertIsNone(row['cameras'][2]['two_view_3d_error_px'])

    def test_two_anchor_only_has_no_database_or_trajectory_mutation(self):
        obs = [dict(o) for o in self.obs]
        before = [dict(x) for x in obs]
        row = self.run_grid(obs, {0: 'ok', 1: 'ok'})
        self.assertEqual(obs, before)
        self.assertTrue(row['two_view_3d']['provisional'])
        self.assertFalse(hasattr(row, 'commit'))

    def test_multiview_conflicting_anchors_do_not_override(self):
        obs = [dict(o) for o in self.obs]
        obs[2]['x'] += 110
        row = self.run_grid(obs, {0: 'ok', 1: 'ok', 2: 'ok', 3: 'unknown'})
        self.assertIsNone(row['two_view_3d'])
        self.assertEqual(row['cameras'][3]['status'], 'unknown')

    def test_30px_boundary_is_not_bad(self):
        obs = [dict(o) for o in self.obs]
        obs[2]['x'] += 30.0
        row = self.run_grid(obs, {0: 'ok', 1: 'ok', 2: 'suspect', 3: 'unknown'})
        self.assertNotEqual(row['cameras'][2]['status'], 'bad')

if __name__ == '__main__':
    unittest.main()

class TwoAnchorEndpointTest(unittest.TestCase):
    def test_two_saved_manual_corrections_drive_grid_even_without_original_3d(self):
        from sqlalchemy import BigInteger, create_engine
        from sqlalchemy.ext.compiler import compiles
        from sqlalchemy.orm import sessionmaker
        from app.models import Base, Match, BallPosition2D, BallPosition2DCorrection
        from app.main import get_traj_2d_camera_grid

        @compiles(BigInteger, 'sqlite')
        def compile_bigint(_type, _compiler, **_kw):
            return 'INTEGER'

        engine = create_engine('sqlite+pysqlite:///:memory:')
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine)()
        try:
            cams = [cam(0, 0, 0), cam(1, -1.4, 0), cam(2, 0, -0.8)]
            p = {'x': 0.8, 'y': 0.5, 'z': 6.0}
            db.add(Match(id=52, title='two-view', fps=50, duration_frame=20, cameras=cams))
            for i, c in enumerate(cams):
                u = project_raw_point(p, c)
                db.add(BallPosition2D(id=100 + i, match_id=52, camera_index=i,
                                      frame=7, visibility=1, x=u['x'] + (96 if i == 2 else 45), y=u['y']))
                if i < 2:
                    db.add(BallPosition2DCorrection(match_id=52, camera_index=i,
                                                   frame=7, visibility=1, x=u['x'], y=u['y']))
            db.commit()
            # Corrected source contains two trusted user-edited labels.
            grid = get_traj_2d_camera_grid(52, 7, 7, db, 'corrected')
            self.assertEqual(grid[0]['cameras'][0]['status'], 'ok')
            self.assertEqual(grid[0]['cameras'][1]['status'], 'ok')
            self.assertEqual(grid[0]['cameras'][2]['status'], 'bad')
            self.assertEqual(grid[0]['cameras'][2]['detection_source'], 'two_view_3d_reprojection')
            self.assertIsNotNone(grid[0]['two_view_3d'])
            self.assertIsNone(grid[0]['reference_3d']['by_camera'] if 'by_camera' in grid[0]['reference_3d'] else None)
            # Original DB label must remain unchanged.
            self.assertGreater(db.query(BallPosition2D).filter_by(match_id=52, camera_index=0).one().x,
                               project_raw_point(p, cams[0])['x'] + 40)
        finally:
            db.close()
