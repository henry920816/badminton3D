import unittest

from app.triangulation import (
    project_raw_point,
    triangulate_observations,
)


def camera(
    index,
    translation_x,
    use_distortion=False,
):
    return {
        "index": index,
        "projection": {
            "intrinsic": [
                1000.0,
                1000.0,
                320.0,
                240.0,
                0.01,
                -0.005,
                0.001,
                -0.001,
                0.0001,
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
            "useLensDistortion": (
                use_distortion
            ),
            "uOffset": 0.0,
            "vOffset": 0.0,
        },
    }


def scene_camera(
    index,
    translation_x,
):
    item = camera(
        index,
        translation_x,
    )
    item["projection"][
        "coordinateMode"
    ] = "scene"
    item["projection"]["extrinsic"] = [
        [
            1.0,
            0.0,
            0.0,
            translation_x,
        ],
        [
            0.0,
            -1.0,
            0.0,
            0.0,
        ],
        [
            0.0,
            0.0,
            -1.0,
            0.0,
        ],
    ]
    return item


class TriangulationTest(unittest.TestCase):
    def assert_point_close(
        self,
        actual,
        expected,
        places=6,
    ):
        for key in (
            "x",
            "y",
            "z",
        ):
            self.assertAlmostEqual(
                actual[key],
                expected[key],
                places=places,
            )

    def test_two_camera_reconstruction(self):
        cameras = {
            0: camera(0, 0.0),
            1: camera(1, -1.0),
        }
        expected = {
            "x": 0.5,
            "y": 0.2,
            "z": 5.0,
        }
        observations = []

        for camera_index, item in cameras.items():
            projected = project_raw_point(
                expected,
                item,
            )
            observations.append(
                {
                    "camera_index": (
                        camera_index
                    ),
                    "x": projected["x"],
                    "y": projected["y"],
                }
            )

        result = triangulate_observations(
            cameras,
            observations,
        )

        self.assert_point_close(
            result["point"],
            expected,
        )
        self.assertLess(
            result["rms_error"],
            1e-6,
        )

    def test_lens_distortion_round_trip(self):
        cameras = {
            0: camera(
                0,
                0.0,
                use_distortion=True,
            ),
            1: camera(
                1,
                -1.0,
                use_distortion=True,
            ),
            2: camera(
                2,
                0.4,
                use_distortion=True,
            ),
        }
        expected = {
            "x": 0.35,
            "y": -0.15,
            "z": 4.5,
        }
        observations = []

        for camera_index, item in cameras.items():
            projected = project_raw_point(
                expected,
                item,
            )
            observations.append(
                {
                    "camera_index": (
                        camera_index
                    ),
                    "x": projected["x"],
                    "y": projected["y"],
                }
            )

        result = triangulate_observations(
            cameras,
            observations,
        )

        self.assert_point_close(
            result["point"],
            expected,
            places=5,
        )
        self.assertLess(
            result["max_error"],
            1e-4,
        )

    def test_mixed_coordinate_modes(self):
        cameras = {
            0: camera(0, 0.0),
            1: scene_camera(
                1,
                -1.0,
            ),
        }
        expected = {
            "x": 0.4,
            "y": 0.3,
            "z": 6.0,
        }
        observations = []

        for camera_index, item in cameras.items():
            projected = project_raw_point(
                expected,
                item,
            )
            observations.append(
                {
                    "camera_index": (
                        camera_index
                    ),
                    "x": projected["x"],
                    "y": projected["y"],
                }
            )

        result = triangulate_observations(
            cameras,
            observations,
        )

        self.assert_point_close(
            result["point"],
            expected,
        )

    def test_requires_two_distinct_cameras(self):
        cameras = {
            0: camera(0, 0.0),
        }

        with self.assertRaisesRegex(
            ValueError,
            "至少需要兩個",
        ):
            triangulate_observations(
                cameras,
                [
                    {
                        "camera_index": 0,
                        "x": 100.0,
                        "y": 100.0,
                    },
                ],
            )


if __name__ == "__main__":
    unittest.main()
