import unittest

from app.triangulation import (
    explain_pairwise_frame,
    pairwise_consensus_point,
    per_view_pairwise_points,
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

    def test_pairwise_consensus_ignores_one_bad_view(self):
        cameras = {
            index: camera(index, offset)
            for index, offset in enumerate(
                (0.0, -1.0, 0.8, -1.8, 1.5)
            )
        }
        expected = {
            "x": 0.3,
            "y": -0.2,
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

        # 其中一台的標註偏了 40 px
        observations[2]["x"] += 40.0

        result = pairwise_consensus_point(
            cameras,
            observations,
        )

        self.assertEqual(
            result["pair_count"],
            6,
        )
        self.assert_point_close(
            result["point"],
            expected,
            places=2,
        )

    def test_pairwise_consensus_rejects_ambiguous_three_view_outlier(self):
        cameras = {
            index: camera(index, offset)
            for index, offset in enumerate((0.0, -1.0, 0.8))
        }
        expected = {"x": 0.3, "y": -0.2, "z": 5.0}
        observations = [
            {"camera_index": index, **project_raw_point(expected, item)}
            for index, item in cameras.items()
        ]
        observations[2]["x"] += 40.0

        self.assertIsNone(pairwise_consensus_point(cameras, observations))

    def test_pairwise_consensus_camera_max_distance(self):
        cameras = {
            index: camera(index, offset)
            for index, offset in enumerate((0.0, -1.0, 0.8))
        }
        expected = {"x": 0.3, "y": -0.2, "z": 5.0}
        observations = [
            {"camera_index": index, **project_raw_point(expected, item)}
            for index, item in cameras.items()
        ]

        # 球離 cam 2 約 5 公尺：上限 10 公尺時照用
        near = pairwise_consensus_point(cameras, observations, camera_max_distance={2: 10.0})
        self.assertEqual(near["used_cameras"], [0, 1, 2])
        self.assertEqual(near["camera_count"], 3)

        # 上限 1 公尺時拿掉 cam 2 再重建
        far = pairwise_consensus_point(cameras, observations, camera_max_distance={2: 1.0})
        self.assertEqual(far["used_cameras"], [0, 1])
        self.assertEqual(far["camera_count"], 2)
        self.assert_point_close(far["point"], expected, places=4)

        # 受限的相機標錯、讓三台都通不過時，不用它再試一次
        observations[2]["x"] += 40.0
        blocked = pairwise_consensus_point(cameras, observations, camera_max_distance={2: 10.0})
        self.assertEqual(blocked["used_cameras"], [0, 1])
        self.assert_point_close(blocked["point"], expected, places=4)

    def test_explain_pairwise_frame(self):
        cameras = {
            index: camera(index, offset)
            for index, offset in enumerate((0.0, -1.0, 0.8))
        }
        expected = {"x": 0.3, "y": -0.2, "z": 5.0}
        observations = [
            {"camera_index": index, **project_raw_point(expected, item)}
            for index, item in cameras.items()
        ]
        # cam 2 標錯 40 px：三組都通不過（含 cam 2 的重建點投影誤差太大，
        # 0-1 那組只有兩台同意，不到要求的 3 台）
        observations[2]["x"] += 40.0

        explained = explain_pairwise_frame(cameras, observations)

        self.assertEqual(explained["cameras"], [0, 1, 2])
        self.assertEqual(explained["required_support"], 3)
        self.assertIsNone(explained["result"])
        statuses = {tuple(pair["cameras"]): pair["status"] for pair in explained["pairs"]}
        self.assertEqual(statuses[(0, 1)], "support")
        self.assertEqual(
            next(pair for pair in explained["pairs"] if pair["cameras"] == [0, 1])["supporters"],
            [0, 1],
        )
        self.assertIn(statuses[(0, 2)], ("reprojection", "support"))
        self.assertNotIn("point", explained["pairs"][0])

        # cam 2 受距離限制時，拿掉它重試會成功，並記在 retry
        limited = explain_pairwise_frame(cameras, observations, camera_max_distance={2: 10.0})
        self.assertEqual(limited["retry"]["reason"], "blocked")
        self.assertEqual(limited["result"]["used_cameras"], [0, 1])

    def test_pairwise_consensus_without_pairs(self):
        cameras = {
            0: camera(0, 0.0),
        }

        self.assertIsNone(
            pairwise_consensus_point(
                cameras,
                [
                    {
                        "camera_index": 0,
                        "x": 100.0,
                        "y": 100.0,
                    },
                ],
            )
        )

    def test_per_view_points_isolate_bad_view(self):
        cameras = {
            index: camera(index, offset)
            for index, offset in enumerate((0.0, -1.0, 0.8, -1.8))
        }
        expected = {"x": 0.3, "y": -0.2, "z": 5.0}
        observations = [
            {"camera_index": index, **project_raw_point(expected, item)}
            for index, item in cameras.items()
        ]
        observations[2]["x"] += 40.0

        views = per_view_pairwise_points(cameras, observations)

        self.assertEqual(sorted(views), [0, 1, 2, 3])
        for view in views.values():
            self.assertEqual(view["pair_count"], 3)
        # 不含 Cam 2 的組合各有兩組準確，中位數仍落在真值附近
        for index in (0, 1, 3):
            self.assert_point_close(views[index], expected, places=6)
        self.assertGreater(
            abs(views[2]["distance"] - views[0]["distance"]),
            0.05,
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
