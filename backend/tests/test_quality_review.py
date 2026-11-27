"""新版品質狀態與藍／紅批次修正，使用小型合成相機資料測試。"""

import unittest

from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException

from app.auto_repair import UndoAutoRepairPayload, undo_auto_repair_traj_2d
from app.models import Base, BallPosition2D, BallPosition2DCorrection, BallTraj, Match
from app.quality_review import attach_review_quality, view_projection
from app.review_repair_routes import (
    AllBlueHidePayload, ManualBlueHidePayload, ReviewRepairPayload,
    hide_all_blue_2d_labels, hide_blue_2d_labels, review_repair_traj_2d,
)
from app.triangulation import project_raw_point


@compiles(BigInteger, 'sqlite')
def sqlite_bigint(_type, _compiler, **_kwargs):
    return 'INTEGER'


def cam(index, tx):
    return {
        'id': f'cam{index}', 'index': index,
        'projection': {
            'intrinsic': [1000., 1000., 320., 240., 0., 0., 0., 0., 0.],
            'extrinsic': [[1., 0., 0., tx], [0., 1., 0., 0.], [0., 0., 1., 0.]],
            'coordinateMode': 'raw', 'useLensDistortion': False,
            'uOffset': 0., 'vOffset': 0., 'imageWidth': 640, 'imageHeight': 480,
        },
    }


class QualityReviewTest(unittest.TestCase):
    def setUp(self):
        self.cameras = {i: cam(i, tx) for i, tx in enumerate((0., -1., 0.7, -4., 0.3))}
        self.point = {'x': 0.1, 'y': 0.2, 'z': 5.}
        self.observations = []
        for index in (0, 1, 2, 3):
            xy = project_raw_point(self.point, self.cameras[index])
            if index == 2:
                xy = {'x': xy['x'] + 180, 'y': xy['y']}
            if index == 3:
                xy = {'x': 300, 'y': 200}
            self.observations.append({'camera_index': index, 'x': xy['x'], 'y': xy['y']})

    def row(self, observations=None, hits=()):
        obs = observations if observations is not None else self.observations
        grid = [{'frame': 100, 'cameras': [
            {'camera_index': i, 'status': 'unknown' if any(o['camera_index'] == i for o in obs) else 'no_data'}
            for i in self.cameras
        ]}]
        return attach_review_quality(grid, self.cameras, {100: obs}, {100: self.point}, hits)[0]

    def test_projection_review_exports_observed_2d_without_modifying_input(self):
        row = self.row()
        cells = {c['camera_index']: c for c in row['cameras']}
        self.assertIsNotNone(cells[0]['review_observed_2d'])
        self.assertIsNotNone(cells[0]['review_projected_2d'])
        self.assertIsNone(cells[4]['review_observed_2d'])

    def test_blue_priority_and_red_from_two_supporters(self):
        cells = {c['camera_index']: c for c in self.row()['cameras']}
        self.assertEqual(cells[0]['review_status'], 'normal')
        self.assertEqual(cells[1]['review_status'], 'normal')
        self.assertEqual(cells[2]['review_status'], 'auto_fix')
        self.assertEqual(cells[2]['review_action'], 'move_to_3d')
        self.assertEqual(cells[3]['review_status'], 'outside_view')
        self.assertEqual(cells[3]['review_action'], 'review')
        self.assertFalse(cells[3]['review_auto_allowed'])
        self.assertEqual(cells[4]['review_status'], 'manual_review')

    def test_above_50_px_is_red_with_two_other_views(self):
        # 60 px 以前是紫色，現在兩個其他視角支持時應該是紅色。
        obs = [dict(item) for item in self.observations]
        observed = next(item for item in obs if item['camera_index'] == 2)
        expected = project_raw_point(self.point, self.cameras[2])
        observed['x'], observed['y'] = expected['x'] + 60, expected['y']
        cell = self.row(obs)['cameras'][2]
        self.assertEqual(cell['review_status'], 'auto_fix')
        self.assertTrue(cell['review_auto_allowed'])
        self.assertEqual(cell['review_action'], 'move_to_3d')
        self.assertEqual(cell['review_candidate_2d'], {'x': expected['x'], 'y': expected['y']})
        self.assertEqual(cell['review_other_support_count'], 2)

    def test_exactly_50_px_is_still_yellow(self):
        obs = [dict(item) for item in self.observations]
        observed = next(item for item in obs if item['camera_index'] == 2)
        expected = project_raw_point(self.point, self.cameras[2])
        observed['x'], observed['y'] = expected['x'] + 50, expected['y']
        cell = self.row(obs)['cameras'][2]
        self.assertEqual(cell['review_status'], 'minor')
        self.assertFalse(cell['review_auto_allowed'])

    def test_50_to_100_px_without_support_is_yellow(self):
        obs = [dict(item) for item in self.observations if item['camera_index'] != 1]
        observed = next(item for item in obs if item['camera_index'] == 2)
        expected = project_raw_point(self.point, self.cameras[2])
        observed['x'], observed['y'] = expected['x'] + 60, expected['y']
        cell = self.row(obs)['cameras'][2]
        self.assertEqual(cell['review_status'], 'minor')
        self.assertFalse(cell['review_auto_allowed'])

    def test_50_to_100_px_in_hit_guard_is_yellow(self):
        obs = [dict(item) for item in self.observations]
        observed = next(item for item in obs if item['camera_index'] == 2)
        expected = project_raw_point(self.point, self.cameras[2])
        observed['x'], observed['y'] = expected['x'] + 60, expected['y']
        cell = self.row(obs, hits=(95,))['cameras'][2]
        self.assertEqual(cell['review_status'], 'minor')
        self.assertFalse(cell['review_auto_allowed'])

    def test_corrected_position_is_not_repeatedly_purple(self):
        obs = [dict(item) for item in self.observations]
        observed = next(item for item in obs if item['camera_index'] == 2)
        expected = project_raw_point(self.point, self.cameras[2])
        observed['x'], observed['y'] = expected['x'] + 60, expected['y']
        observed['corrected'] = True
        cell = self.row(obs)['cameras'][2]
        self.assertEqual(cell['review_status'], 'normal')
        self.assertFalse(cell['review_auto_allowed'])

    def test_hit_guard_stops_red_but_outside_stays_blue(self):
        cells = {c['camera_index']: c for c in self.row(hits=[98])['cameras']}
        self.assertEqual(cells[2]['review_status'], 'manual_review')
        self.assertEqual(cells[3]['review_status'], 'outside_view')
        self.assertEqual(cells[3]['review_issue_kind'], 'outside_view')
        self.assertFalse(cells[3]['review_auto_allowed'])

    def test_prior_correction_is_protected(self):
        obs = [dict(o) for o in self.observations]
        obs[2]['corrected'] = True
        cells = {c['camera_index']: c for c in self.row(obs)['cameras']}
        self.assertEqual(cells[2]['review_status'], 'normal')
        self.assertFalse(cells[2]['review_auto_allowed'])

    def test_no_3d_projection_with_visible_2d_is_blue(self):
        row = [{'frame': 100, 'cameras': [{'camera_index': 3, 'status': 'bad'}]}]
        result = attach_review_quality(row, self.cameras, {100: self.observations}, {}, [])
        cell = result[0]['cameras'][0]
        self.assertEqual(cell['review_status'], 'outside_view')
        self.assertEqual(cell['review_issue_kind'], 'missing_projection')
        self.assertEqual(cell['review_projection_kind'], 'unavailable')
        self.assertEqual(cell['review_action'], 'review')
        self.assertFalse(cell['review_auto_allowed'])

    def test_no_3d_projection_even_without_other_warnings_is_blue(self):
        obs = [{'camera_index': 2, 'x': 200, 'y': 100, 'visibility': 1}]
        row = [{'frame': 100, 'cameras': [{'camera_index': 2, 'status': 'ok'}]}]
        cell = attach_review_quality(row, self.cameras, {100: obs}, {}, [100])[0]['cameras'][0]
        self.assertEqual(cell['review_status'], 'outside_view')
        self.assertEqual(cell['review_issue_kind'], 'missing_projection')

    def test_no_3d_projection_without_visible_2d_not_blue(self):
        row = [{'frame': 100, 'cameras': [{'camera_index': 3, 'status': 'no_data'}]}]
        cell = attach_review_quality(row, self.cameras, {}, {}, [])[0]['cameras'][0]
        self.assertEqual(cell['review_status'], 'normal')

    def test_missing_camera_parameters_with_visible_2d_is_blue(self):
        self.cameras[3]['projection'] = {}
        row = [{'frame': 100, 'cameras': [{'camera_index': 3, 'status': 'ok'}]}]
        cell = attach_review_quality(row, self.cameras, {100: self.observations}, {100: self.point})[0]['cameras'][0]
        self.assertEqual(cell['review_projection_kind'], 'unavailable')
        self.assertEqual(cell['review_status'], 'outside_view')
        self.assertEqual(cell['review_issue_kind'], 'missing_projection')

    def test_edge_case_near_border_is_still_blue(self):
        self.cameras[3] = cam(3, -1.8)
        cells = {c['camera_index']: c for c in self.row()['cameras']}
        self.assertEqual(cells[3]['review_status'], 'outside_view')
        self.assertEqual(cells[3]['review_issue_kind'], 'outside_view')
        self.assertFalse(cells[3]['review_auto_allowed'])

    def test_even_tiny_outside_border_is_blue_without_margin(self):
        # 只超出 0.1 px，一樣是藍色，交由人工判定是否移除。
        self.cameras[3] = cam(3, -1.7005)
        cell = self.row()['cameras'][3]
        self.assertEqual(cell['review_status'], 'outside_view')
        self.assertFalse(cell['review_auto_allowed'])

    def test_inside_border_is_not_blue(self):
        self.cameras[3] = cam(3, -1.6995)
        cell = self.row()['cameras'][3]
        self.assertNotEqual(cell['review_status'], 'outside_view')

    def test_outside_but_2d_within_50px_not_blue(self):
        self.cameras[3] = cam(3, -1.8)
        xy = project_raw_point(self.point, self.cameras[3])
        obs = [dict(item) for item in self.observations]
        item = next(entry for entry in obs if entry['camera_index'] == 3)
        item['x'], item['y'] = xy['x'] + 40, xy['y']
        cell = self.row(obs)['cameras'][3]
        self.assertEqual(cell['review_projection_kind'], 'outside')
        self.assertEqual(cell['review_status'], 'minor')
        self.assertAlmostEqual(cell['review_error_px'], 40)
        self.assertNotEqual(cell['review_issue_kind'], 'outside_view')

    def test_outside_but_2d_within_20px_is_normal(self):
        self.cameras[3] = cam(3, -1.8)
        xy = project_raw_point(self.point, self.cameras[3])
        obs = [dict(item) for item in self.observations]
        item = next(entry for entry in obs if entry['camera_index'] == 3)
        item['x'], item['y'] = xy['x'] + 20, xy['y']
        cell = self.row(obs)['cameras'][3]
        self.assertEqual(cell['review_status'], 'normal')

    def test_outside_exactly_50px_is_blue(self):
        self.cameras[3] = cam(3, -1.8)
        xy = project_raw_point(self.point, self.cameras[3])
        obs = [dict(item) for item in self.observations]
        item = next(entry for entry in obs if entry['camera_index'] == 3)
        item['x'], item['y'] = xy['x'] + 50, xy['y']
        cell = self.row(obs)['cameras'][3]
        self.assertEqual(cell['review_status'], 'outside_view')
        self.assertAlmostEqual(cell['review_error_px'], 50)

    def test_above_100_without_support_remains_purple(self):
        obs = [dict(item) for item in self.observations if item['camera_index'] != 1]
        cell = self.row(obs)['cameras'][2]
        self.assertEqual(cell['review_status'], 'manual_review')
        self.assertEqual(cell['review_action'], 'review')

    def test_above_100_in_hit_guard_remains_purple(self):
        cell = self.row(hits=(100,))['cameras'][2]
        self.assertEqual(cell['review_status'], 'manual_review')
        self.assertFalse(cell['review_auto_allowed'])

    def test_corrected_180px_does_not_rewarn(self):
        obs = [dict(item) for item in self.observations]
        obs[2]['corrected'] = True
        cell = self.row(obs)['cameras'][2]
        self.assertEqual(cell['review_status'], 'normal')
        self.assertFalse(cell['review_auto_allowed'])
        self.assertTrue(cell['review_manual_protected'])

    def test_clear_outside_without_two_other_supporters_is_blue(self):
        # 原始 3D 已被使用者確認整體可信，明確視野外不用等別台相機。
        obs = [item for item in self.observations if item['camera_index'] == 3]
        cells = {c['camera_index']: c for c in self.row(obs)['cameras']}
        self.assertEqual(cells[3]['review_other_support_count'], 0)
        self.assertEqual(cells[3]['review_status'], 'outside_view')
        self.assertFalse(cells[3]['review_auto_allowed'])
        self.assertEqual(cells[3]['review_action'], 'review')

    def test_visible_existing_correction_is_still_blue(self):
        obs = [dict(item) for item in self.observations]
        for item in obs:
            if item['camera_index'] == 3:
                item['corrected'] = True
        cells = {c['camera_index']: c for c in self.row(obs)['cameras']}
        self.assertEqual(cells[3]['review_status'], 'outside_view')
        self.assertEqual(cells[3]['review_issue_kind'], 'outside_view')
        self.assertFalse(cells[3]['review_auto_allowed'])

    def test_bad_camera_bounds_cannot_claim_outside(self):
        self.cameras[3]['projection'].pop('imageWidth')
        self.cameras[3]['projection'].pop('imageHeight')
        self.assertEqual(view_projection(self.point, self.cameras[3])['kind'], 'bounds_unknown')


class QualityReviewRepairTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine('sqlite+pysqlite:///:memory:')
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.cameras = [cam(i, x) for i, x in enumerate((0., -1., 0.7, -4.))]
        self.point = {'x': 0.1, 'y': 0.2, 'z': 5.}
        match = Match(title='review', fps=50, duration_frame=300, cameras=self.cameras)
        self.db.add(match)
        self.db.flush()
        self.match_id = match.id
        self.db.add(BallTraj(match_id=self.match_id, frame=100, t_sec=2.,
                             x=self.point['x'], y=self.point['y'], z=self.point['z']))
        for i, camera in enumerate(self.cameras):
            xy = project_raw_point(self.point, camera)
            if i == 2:
                xy['x'] += 180
            if i == 3:
                xy = {'x': 300., 'y': 200.}
            self.db.add(BallPosition2D(match_id=self.match_id, camera_index=i, frame=100,
                                       x=xy['x'], y=xy['y'], visibility=1))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_selected_camera_scope_does_not_touch_other_views(self):
        payload = ReviewRepairPayload(start_frame=100, end_frame=100,
                                      mode='preview', camera_indexes=[2])
        preview = review_repair_traj_2d(self.match_id, payload, self.db)
        self.assertEqual(preview['candidate_points'], 1)
        self.assertEqual(preview['position_points'], 1)
        self.assertEqual(preview['outside_points'], 0)
        self.assertEqual(preview['preview'][0]['camera_index'], 2)
        payload.mode = 'apply'
        applied = review_repair_traj_2d(self.match_id, payload, self.db)
        self.assertEqual(applied['repaired_2d_points'], 1)
        self.assertEqual({item.camera_index for item in self.db.query(BallPosition2DCorrection)}, {2})

    def test_60_px_candidate_can_preview_and_apply(self):
        row = self.db.query(BallPosition2D).filter_by(match_id=self.match_id, camera_index=2, frame=100).one()
        expected = project_raw_point(self.point, self.cameras[2])
        row.x = expected['x'] + 60
        row.y = expected['y']
        self.db.commit()
        payload = ReviewRepairPayload(start_frame=100, end_frame=100,
                                      mode='preview', action_filter='position', camera_indexes=[2])
        preview = review_repair_traj_2d(self.match_id, payload, self.db)
        self.assertEqual(preview['candidate_points'], 1)
        self.assertEqual(preview['position_points'], 1)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)
        payload.mode = 'apply'
        applied = review_repair_traj_2d(self.match_id, payload, self.db)
        self.assertEqual(applied['repaired_2d_points'], 1)
        corrected = self.db.query(BallPosition2DCorrection).filter_by(
            match_id=self.match_id, camera_index=2, frame=100).one()
        self.assertAlmostEqual(corrected.x, expected['x'])
        self.assertAlmostEqual(corrected.y, expected['y'])
        self.assertAlmostEqual(row.x, expected['x'] + 60)

    def test_auto_repair_only_moves_red_and_never_hides_blue(self):
        payload = ReviewRepairPayload(start_frame=100, end_frame=100, mode='preview')
        preview = review_repair_traj_2d(self.match_id, payload, self.db)
        self.assertEqual(preview['outside_points'], 0)
        self.assertEqual(preview['position_points'], 1)
        payload.mode = 'apply'
        applied = review_repair_traj_2d(self.match_id, payload, self.db)
        self.assertEqual(applied['repaired_2d_points'], 1)
        self.assertEqual({c.camera_index for c in self.db.query(BallPosition2DCorrection)}, {2})
        undo_auto_repair_traj_2d(self.match_id,
                                 UndoAutoRepairPayload(repair_ids=applied['repair_ids']), self.db)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)

    def test_old_blue_auto_api_cannot_hide_labels(self):
        payload = ReviewRepairPayload(start_frame=100, end_frame=100,
                                      mode='apply', action_filter='outside')
        result = review_repair_traj_2d(self.match_id, payload, self.db)
        self.assertEqual(result['repaired_2d_points'], 0)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)

    def test_nearby_projection_is_not_deletable_as_blue(self):
        match = self.db.query(Match).filter_by(id=self.match_id).one()
        cams = list(self.cameras)
        cams[3] = cam(3, -1.8)
        match.cameras = cams
        xy = project_raw_point(self.point, cams[3])
        observed = self.db.query(BallPosition2D).filter_by(
            match_id=self.match_id, camera_index=3, frame=100).one()
        observed.x, observed.y = xy['x'] + 30, xy['y']
        self.db.commit()
        from app.review_repair_routes import _get_inputs
        actual = next(cell for cell in _get_inputs(self.db, match, 100, 100)[0]['cameras']
                      if cell['camera_index'] == 3)
        self.assertNotEqual(actual['review_status'], 'outside_view')
        with self.assertRaises(HTTPException) as caught:
            hide_blue_2d_labels(self.match_id,
                                ManualBlueHidePayload(camera_index=3, frames=[100]), self.db)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)

    def test_exactly_50px_outside_can_be_manually_hidden(self):
        match = self.db.query(Match).filter_by(id=self.match_id).one()
        cams = list(self.cameras)
        cams[3] = cam(3, -1.8)
        match.cameras = cams
        xy = project_raw_point(self.point, cams[3])
        observed = self.db.query(BallPosition2D).filter_by(
            match_id=self.match_id, camera_index=3, frame=100).one()
        observed.x, observed.y = xy['x'] + 50, xy['y']
        self.db.commit()
        result = hide_blue_2d_labels(self.match_id,
                                     ManualBlueHidePayload(camera_index=3, frames=[100]), self.db)
        self.assertEqual(result['hidden_points'], 1)

    def test_manual_single_blue_click_and_undo(self):
        result = hide_blue_2d_labels(self.match_id,
                                     ManualBlueHidePayload(camera_index=3, frames=[100]), self.db)
        self.assertEqual(result['hidden_points'], 1)
        overlay = self.db.query(BallPosition2DCorrection).filter_by(
            match_id=self.match_id, camera_index=3, frame=100).one()
        self.assertEqual(overlay.visibility, 0)
        raw = self.db.query(BallPosition2D).filter_by(
            match_id=self.match_id, camera_index=3, frame=100).one()
        self.assertEqual(raw.visibility, 1)
        from app.review_repair_routes import _get_inputs
        match = self.db.query(Match).filter_by(id=self.match_id).one()
        cell = next(c for c in _get_inputs(self.db, match, 100, 100)[0]['cameras']
                    if c['camera_index'] == 3)
        self.assertEqual(cell['review_status'], 'normal')
        undo_auto_repair_traj_2d(self.match_id,
                                 UndoAutoRepairPayload(repair_ids=result['repair_ids']), self.db)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)

    def test_manual_hide_existing_visible_correction_and_undo(self):
        self.db.add(BallPosition2DCorrection(
            match_id=self.match_id, camera_index=3, frame=100,
            visibility=1, x=123., y=222.))
        self.db.commit()
        result = hide_blue_2d_labels(self.match_id,
                                     ManualBlueHidePayload(camera_index=3, frames=[100]), self.db)
        undo_auto_repair_traj_2d(self.match_id,
                                 UndoAutoRepairPayload(repair_ids=result['repair_ids']), self.db)
        overlay = self.db.query(BallPosition2DCorrection).filter_by(
            match_id=self.match_id, camera_index=3, frame=100).one()
        self.assertEqual(overlay.visibility, 1)
        self.assertEqual((overlay.x, overlay.y), (123., 222.))

    def test_manual_hide_continuous_blue_segment(self):
        for frame in (101, 102):
            self.db.add(BallTraj(match_id=self.match_id, frame=frame,
                                 t_sec=frame / 50, **self.point))
            self.db.add(BallPosition2D(match_id=self.match_id, camera_index=3,
                                       frame=frame, visibility=1, x=300., y=200.))
        self.db.commit()
        result = hide_blue_2d_labels(self.match_id,
                                     ManualBlueHidePayload(camera_index=3,
                                                           frames=[100, 101, 102]), self.db)
        self.assertEqual(result['hidden_points'], 3)
        self.assertEqual(len(result['repair_ids']), 3)
        self.assertEqual(self.db.query(BallPosition2DCorrection).filter_by(
            match_id=self.match_id, camera_index=3, visibility=0).count(), 3)
        undo_auto_repair_traj_2d(self.match_id,
                                 UndoAutoRepairPayload(repair_ids=result['repair_ids']), self.db)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)

    def test_missing_3d_blue_can_be_hidden_and_undone(self):
        self.db.query(BallTraj).filter_by(match_id=self.match_id, frame=100).delete()
        self.db.commit()
        match = self.db.query(Match).filter_by(id=self.match_id).one()
        from app.review_repair_routes import _get_inputs
        cell = next(c for c in _get_inputs(self.db, match, 100, 100)[0]['cameras']
                    if c['camera_index'] == 3)
        self.assertEqual(cell['review_status'], 'outside_view')
        self.assertEqual(cell['review_issue_kind'], 'missing_projection')
        result = hide_blue_2d_labels(self.match_id,
                                     ManualBlueHidePayload(camera_index=3, frames=[100]), self.db)
        self.assertEqual(result['hidden_points'], 1)
        self.assertEqual(self.db.query(BallPosition2DCorrection).filter_by(
            match_id=self.match_id, camera_index=3, frame=100).one().visibility, 0)
        self.assertEqual(self.db.query(BallPosition2D).filter_by(
            match_id=self.match_id, camera_index=3, frame=100).one().visibility, 1)
        undo_auto_repair_traj_2d(self.match_id,
                                 UndoAutoRepairPayload(repair_ids=result['repair_ids']), self.db)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)

    def test_long_press_can_hide_continuous_outside_and_missing_3d(self):
        self.db.add(BallPosition2D(match_id=self.match_id, camera_index=3,
                                   frame=101, visibility=1, x=300., y=200.))
        self.db.commit()
        result = hide_blue_2d_labels(self.match_id,
                                     ManualBlueHidePayload(camera_index=3, frames=[100, 101]), self.db)
        self.assertEqual(result['hidden_points'], 2)
        self.assertEqual(self.db.query(BallPosition2DCorrection).filter_by(
            match_id=self.match_id, camera_index=3, visibility=0).count(), 2)
        undo_auto_repair_traj_2d(self.match_id,
                                 UndoAutoRepairPayload(repair_ids=result['repair_ids']), self.db)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)

    def test_manual_hide_rejects_non_blue_and_keeps_transaction_clean(self):
        self.db.add(BallTraj(match_id=self.match_id, frame=101,
                             t_sec=101 / 50, **self.point))
        self.db.add(BallPosition2D(match_id=self.match_id, camera_index=3,
                                   frame=101, visibility=0, x=0., y=0.))
        self.db.commit()
        with self.assertRaises(HTTPException) as ctx:
            hide_blue_2d_labels(self.match_id,
                                ManualBlueHidePayload(camera_index=3, frames=[100, 101]), self.db)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)

    def test_manual_hide_does_not_rewrite_another_camera(self):
        hide_blue_2d_labels(self.match_id,
                            ManualBlueHidePayload(camera_index=3, frames=[100]), self.db)
        self.assertEqual({c.camera_index for c in self.db.query(BallPosition2DCorrection)}, {3})


    def test_one_click_hides_all_blue_across_cameras_as_one_history_step(self):
        from app.edit_history import get_2d_edit_history, undo_2d_edit, redo_2d_edit
        # 第 100 幀 Cam 3 在畫面外；第 101 幀沒有 3D，但 Cam 0/1 有 2D。
        for index in (0, 1):
            self.db.add(BallPosition2D(match_id=self.match_id, camera_index=index,
                                       frame=101, visibility=1, x=100., y=200.))
        self.db.commit()
        result = hide_all_blue_2d_labels(
            self.match_id, AllBlueHidePayload(start_frame=100, end_frame=101), self.db)
        self.assertEqual(result['hidden_points'], 3)
        self.assertEqual(result['affected_frames'], 2)
        self.assertEqual(len(result['repair_ids']), 2)
        self.assertEqual({(p.camera_index, p.frame) for p in self.db.query(BallPosition2DCorrection)},
                         {(3, 100), (0, 101), (1, 101)})
        self.assertEqual(self.db.query(BallPosition2D).filter_by(
            match_id=self.match_id, camera_index=3, frame=100).one().visibility, 1)
        self.assertTrue(get_2d_edit_history(self.match_id, self.db)['can_undo'])
        restored = undo_2d_edit(self.match_id, self.db)
        self.assertEqual(restored['updated_points'], 3)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)
        repeated = redo_2d_edit(self.match_id, self.db)
        self.assertEqual(repeated['updated_points'], 3)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 3)

    def test_one_click_never_deletes_non_blue_or_repeats_previous_hidden_points(self):
        from app.edit_history import get_2d_edit_history
        payload = AllBlueHidePayload(start_frame=100, end_frame=100)
        first = hide_all_blue_2d_labels(self.match_id, payload, self.db)
        self.assertEqual(first['hidden_points'], 1)
        self.assertEqual(self.db.query(BallPosition2DCorrection).filter_by(
            match_id=self.match_id, camera_index=2).count(), 0)
        undo_label = get_2d_edit_history(self.match_id, self.db)['undo_label']
        second = hide_all_blue_2d_labels(self.match_id, payload, self.db)
        self.assertEqual(second['hidden_points'], 0)
        self.assertEqual(second['repair_ids'], [])
        self.assertEqual(get_2d_edit_history(self.match_id, self.db)['undo_label'], undo_label)

    def test_one_click_obeys_blue_50px_exception(self):
        match = self.db.query(Match).filter_by(id=self.match_id).one()
        cams = list(self.cameras)
        cams[3] = cam(3, -1.8)
        match.cameras = cams
        xy = project_raw_point(self.point, cams[3])
        marked = self.db.query(BallPosition2D).filter_by(
            match_id=self.match_id, camera_index=3, frame=100).one()
        marked.x, marked.y = xy['x'] + 30, xy['y']
        self.db.commit()
        result = hide_all_blue_2d_labels(
            self.match_id, AllBlueHidePayload(start_frame=100, end_frame=100), self.db)
        self.assertEqual(result['hidden_points'], 0)
        self.assertEqual(self.db.query(BallPosition2DCorrection).count(), 0)

    def test_one_click_validates_rally_boundaries(self):
        with self.assertRaises(HTTPException) as invalid:
            hide_all_blue_2d_labels(self.match_id,
                                    AllBlueHidePayload(start_frame=100, end_frame=99), self.db)
        self.assertEqual(invalid.exception.status_code, 400)
        with self.assertRaises(HTTPException) as outside:
            hide_all_blue_2d_labels(self.match_id,
                                    AllBlueHidePayload(start_frame=100, end_frame=301), self.db)
        self.assertEqual(outside.exception.status_code, 400)


if __name__ == '__main__':
    unittest.main()
