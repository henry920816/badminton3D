import unittest

from app.triangulation import project_raw_point, scan_2d_camera_grid
from test_triangulation import camera


class QualityDetectionTest(unittest.TestCase):
    def setUp(self):
        self.cameras = {i: camera(i, -(i % 2)) for i in range(4)}
        for i in (2, 3):
            self.cameras[i]['projection']['extrinsic'][1][3] = -1.0
        self.point = {'x': 0.5, 'y': 0.2, 'z': 5.0}
        self.observations = []
        for i, item in self.cameras.items():
            p = project_raw_point(self.point, item)
            self.observations.append({'camera_index': i, 'x': p['x'], 'y': p['y']})

    def scan(self, observations=None):
        result = scan_2d_camera_grid(
            self.cameras, {10: self.observations if observations is None else observations}, 10, 10,
        )[0]
        return {item['camera_index']: item for item in result['cameras']}

    def test_clean_observations_pass(self):
        self.assertTrue(all(item['status'] == 'ok' for item in self.scan().values()))

    def test_large_outlier_identified_without_blaming_good_cameras(self):
        self.observations[2]['x'] += 120
        result = self.scan()
        self.assertEqual(result[2]['status'], 'bad')
        for i in (0, 1, 3):
            self.assertEqual(result[i]['status'], 'ok')
        self.assertGreater(result[2]['reprojection_error_px'], 100)

    def test_persistent_large_offset_detected_every_frame(self):
        self.observations[2]['y'] += 180
        result = scan_2d_camera_grid(self.cameras, {i: self.observations for i in range(20)}, 0, 19)
        self.assertTrue(all(next(c for c in f['cameras'] if c['camera_index'] == 2)['status'] == 'bad' for f in result))

    def test_two_views_not_pass(self):
        result = self.scan(self.observations[:2])
        self.assertEqual(result[0]['status'], 'unknown')
        self.assertEqual(result[2]['status'], 'no_data')

    def test_three_view_conflict_is_visible(self):
        self.observations[2]['y'] += 180
        result = self.scan(self.observations[:3])
        self.assertTrue(all(result[i]['status'] == 'suspect' for i in range(3)))

    def test_invalid_number_and_out_of_bounds_are_bad(self):
        self.observations[0]['x'] = float('nan')
        self.observations[1]['x'] = -10
        result = self.scan()
        self.assertEqual(result[0]['status'], 'bad')
        self.assertEqual(result[1]['status'], 'bad')

    def test_known_image_bounds(self):
        self.cameras[0]['projection']['imageWidth'] = 640
        self.observations[0]['x'] = 640
        self.assertEqual(self.scan()[0]['status'], 'bad')

    def test_missing_calibration_never_passes(self):
        self.cameras[0]['projection'] = {}
        self.assertEqual(self.scan()[0]['status'], 'unknown')

    def test_same_pose_never_passes(self):
        for i in range(4):
            self.cameras[i] = camera(i, 0)
            self.observations[i] = dict(self.observations[0], camera_index=i)
        self.assertTrue(all(item['status'] == 'unknown' for item in self.scan().values()))

    def test_pixel_noise_remains_pass(self):
        for i, observation in enumerate(self.observations):
            observation['x'] += (i - 1.5) * 0.5
            observation['y'] += (i % 2 - 0.5) * 0.5
        self.assertTrue(all(item['status'] == 'ok' for item in self.scan().values()))


if __name__ == '__main__':
    unittest.main()
