"""手動 2D 修復（在影片上點選標註）與復原"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    BallPosition2D,
    BallTraj,
    Match,
    TrajectoryRepairHistory,
)
from ..schemas import Traj2DRepairPayload
from ..triangulation import triangulate_observations


router = APIRouter()


def trajectory_point_dict(
    point: BallTraj,
) -> dict:
    return {
        "frame":
            point.frame,

        "t_sec":
            point.t_sec,

        "x":
            point.x,

        "y":
            point.y,

        "z":
            point.z,

        "speed":
            point.speed,

        "confidence":
            point.confidence,
    }


@router.post(
    "/matches/{match_id}/traj2d/repair"
)
def repair_traj_from_2d(
    match_id: int,
    payload: Traj2DRepairPayload,
    db: Session = Depends(get_db),
):
    match = db.get(
        Match,
        match_id,
    )

    if match is None:
        raise HTTPException(
            status_code=404,
            detail="match not found",
        )

    if (
        payload.frame < 0
        or payload.frame
        > match.duration_frame
    ):
        raise HTTPException(
            status_code=400,
            detail="frame 超出資料集範圍",
        )

    cameras = (
        match.cameras
        if isinstance(
            match.cameras,
            list,
        )
        else []
    )

    cameras_by_index = {}

    for fallback_index, camera in enumerate(
        cameras
    ):
        if not isinstance(
            camera,
            dict,
        ):
            continue

        camera_index = camera.get(
            "index",
            fallback_index,
        )

        try:
            camera_index = int(
                camera_index
            )
        except (
            TypeError,
            ValueError,
        ):
            continue

        cameras_by_index[
            camera_index
        ] = camera

    observations = [
        observation.model_dump()
        for observation
        in payload.observations
    ]

    try:
        triangulation = (
            triangulate_observations(
                cameras_by_index,
                observations,
            )
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    existing_point = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id
            == match_id,
            BallTraj.frame
            == payload.frame,
        )
        .first()
    )

    previous_point = (
        trajectory_point_dict(
            existing_point
        )
        if existing_point
        else None
    )

    repaired_point = {
        "frame":
            payload.frame,

        "t_sec": (
            existing_point.t_sec
            if existing_point
            else (
                payload.frame
                / (
                    match.fps
                    or 50.0
                )
            )
        ),

        "x":
            triangulation[
                "point"
            ][
                "x"
            ],

        "y":
            triangulation[
                "point"
            ][
                "y"
            ],

        "z":
            triangulation[
                "point"
            ][
                "z"
            ],

        "speed": (
            existing_point.speed
            if existing_point
            else None
        ),

        "confidence": (
            existing_point.confidence
            if existing_point
            else 1.0
        ),
    }

    warnings = []

    if (
        triangulation[
            "rms_error"
        ] > 10.0
    ):
        warnings.append(
            "2D 點的重投影 RMS 誤差超過 10 px，"
            "建議重新點選後再確認"
        )

    if (
        triangulation[
            "condition_ratio"
        ] > 0.1
    ):
        warnings.append(
            "目前相機組合的三角化條件較差，"
            "建議改用視角差異較大的相機"
        )

    result = {
        "ok":
            True,

        "confirmed":
            False,

        "repair_id":
            None,

        "frame":
            payload.frame,

        "previous_point":
            previous_point,

        "trajectory_point":
            repaired_point,

        "observations":
            triangulation[
                "observations"
            ],

        "reprojection":
            triangulation[
                "reprojection"
            ],

        "rms_error":
            triangulation[
                "rms_error"
            ],

        "max_error":
            triangulation[
                "max_error"
            ],

        "condition_ratio":
            triangulation[
                "condition_ratio"
            ],

        "warnings":
            warnings,

        "ball_2d_points":
            [],
    }

    if not payload.confirm:
        return result

    original_2d = []
    repaired_2d = []

    try:
        if existing_point is None:
            existing_point = BallTraj(
                match_id=
                    match_id,

                frame=
                    payload.frame,

                t_sec=
                    repaired_point[
                        "t_sec"
                    ],

                x=
                    repaired_point[
                        "x"
                    ],

                y=
                    repaired_point[
                        "y"
                    ],

                z=
                    repaired_point[
                        "z"
                    ],

                speed=
                    None,

                confidence=
                    1.0,
            )

            db.add(
                existing_point
            )

        else:
            existing_point.x = (
                repaired_point[
                    "x"
                ]
            )

            existing_point.y = (
                repaired_point[
                    "y"
                ]
            )

            existing_point.z = (
                repaired_point[
                    "z"
                ]
            )

        for observation in (
            triangulation[
                "observations"
            ]
        ):
            row = (
                db.query(
                    BallPosition2D
                )
                .filter(
                    BallPosition2D.match_id
                    == match_id,

                    BallPosition2D.camera_index
                    == observation[
                        "camera_index"
                    ],

                    BallPosition2D.frame
                    == payload.frame,
                )
                .first()
            )

            original_2d.append(
                {
                    "camera_index":
                        observation[
                            "camera_index"
                        ],

                    "existed":
                        row
                        is not None,

                    "visibility": (
                        row.visibility
                        if row
                        else None
                    ),

                    "x": (
                        row.x
                        if row
                        else None
                    ),

                    "y": (
                        row.y
                        if row
                        else None
                    ),
                }
            )

            if row is None:
                row = (
                    BallPosition2D(
                        match_id=
                            match_id,

                        camera_index=
                            observation[
                                "camera_index"
                            ],

                        frame=
                            payload.frame,

                        visibility=
                            1,

                        x=
                            observation[
                                "x"
                            ],

                        y=
                            observation[
                                "y"
                            ],
                    )
                )

                db.add(
                    row
                )

            else:
                row.visibility = 1

                row.x = (
                    observation[
                        "x"
                    ]
                )

                row.y = (
                    observation[
                        "y"
                    ]
                )

            repaired_2d.append(
                {
                    "camera_index":
                        observation[
                            "camera_index"
                        ],

                    "frame":
                        payload.frame,

                    "visibility":
                        1,

                    "x":
                        observation[
                            "x"
                        ],

                    "y":
                        observation[
                            "y"
                        ],
                }
            )

        repaired_camera_indices = {
            int(
                observation[
                    "camera_index"
                ]
            )
            for observation
            in triangulation[
                "observations"
            ]
        }

        next_cameras = []

        for fallback_index, camera in enumerate(
            cameras
        ):
            if not isinstance(
                camera,
                dict,
            ):
                next_cameras.append(
                    camera
                )

                continue

            try:
                camera_index = int(
                    camera.get(
                        "index",
                        fallback_index,
                    )
                )
            except (
                TypeError,
                ValueError,
            ):
                camera_index = (
                    fallback_index
                )

            next_cameras.append(
                {
                    **camera,

                    "has_ball_2d": (
                        True
                        if camera_index
                        in repaired_camera_indices
                        else camera.get(
                            "has_ball_2d",
                            False,
                        )
                    ),
                }
            )

        match.cameras = (
            next_cameras
        )

        history = (
            TrajectoryRepairHistory(
                match_id=
                    match_id,

                frame=
                    payload.frame,

                source=
                    "manual_2d",

                original_point=
                    previous_point,

                repaired_point=
                    repaired_point,

                original_2d=
                    original_2d,

                repaired_2d=
                    repaired_2d,

                reprojection={
                    "rms_error":
                        triangulation[
                            "rms_error"
                        ],

                    "max_error":
                        triangulation[
                            "max_error"
                        ],

                    "by_camera":
                        triangulation[
                            "reprojection"
                        ],
                },
            )
        )

        db.add(
            history
        )

        db.flush()

        db.commit()

    except Exception:
        db.rollback()
        raise

    result[
        "confirmed"
    ] = True

    result[
        "repair_id"
    ] = history.id

    result[
        "ball_2d_points"
    ] = repaired_2d

    return result


@router.post(
    (
        "/matches/{match_id}/traj2d/"
        "repairs/{repair_id}/undo"
    )
)
def undo_traj_2d_repair(
    match_id: int,
    repair_id: int,
    db: Session = Depends(get_db),
):
    history = db.get(
        TrajectoryRepairHistory,
        repair_id,
    )

    if (
        history is None
        or history.match_id
        != match_id
    ):
        raise HTTPException(
            status_code=404,
            detail="找不到指定的 2D 修復紀錄",
        )

    if history.source == "auto_2d_only":
        raise HTTPException(status_code=409, detail="此紀錄為純 2D 修復，請使用品質檢查的復原按鈕")

    if (
        history.reverted_at
        is not None
    ):
        raise HTTPException(
            status_code=409,
            detail="此修復已經復原",
        )

    match = db.get(
        Match,
        match_id,
    )

    if match is None:
        raise HTTPException(
            status_code=404,
            detail="match not found",
        )

    current_point = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id
            == match_id,

            BallTraj.frame
            == history.frame,
        )
        .first()
    )

    repaired_point = (
        history.repaired_point
        or {}
    )

    if current_point is None:
        raise HTTPException(
            status_code=409,
            detail=(
                "目前軌跡已被其他操作修改，"
                "無法安全復原"
            ),
        )

    for key in (
        "x",
        "y",
        "z",
    ):
        if abs(
            float(
                getattr(
                    current_point,
                    key,
                )
            )
            - float(
                repaired_point[
                    key
                ]
            )
        ) > 1e-7:
            raise HTTPException(
                status_code=409,
                detail=(
                    "目前軌跡已被其他操作修改，"
                    "無法安全復原"
                ),
            )

    restored_point = None
    restored_2d = []

    try:
        if (
            history.original_point
            is None
        ):
            db.delete(
                current_point
            )

        else:
            original = (
                history.original_point
            )

            current_point.t_sec = (
                original[
                    "t_sec"
                ]
            )

            current_point.x = (
                original[
                    "x"
                ]
            )

            current_point.y = (
                original[
                    "y"
                ]
            )

            current_point.z = (
                original[
                    "z"
                ]
            )

            current_point.speed = (
                original.get(
                    "speed"
                )
            )

            current_point.confidence = (
                original.get(
                    "confidence",
                    1.0,
                )
            )

            restored_point = (
                trajectory_point_dict(
                    current_point
                )
            )

        for original in (
            history.original_2d
            or []
        ):
            camera_index = int(
                original[
                    "camera_index"
                ]
            )

            row = (
                db.query(
                    BallPosition2D
                )
                .filter(
                    BallPosition2D.match_id
                    == match_id,

                    BallPosition2D.camera_index
                    == camera_index,

                    BallPosition2D.frame
                    == history.frame,
                )
                .first()
            )

            if not original.get(
                "existed"
            ):
                if (
                    row is not None
                ):
                    db.delete(
                        row
                    )

                restored_2d.append(
                    {
                        "camera_index":
                            camera_index,

                        "frame":
                            history.frame,

                        "deleted":
                            True,
                    }
                )

                continue

            if row is None:
                row = (
                    BallPosition2D(
                        match_id=
                            match_id,

                        camera_index=
                            camera_index,

                        frame=
                            history.frame,

                        visibility=
                            int(
                                original[
                                    "visibility"
                                ]
                            ),

                        x=
                            float(
                                original[
                                    "x"
                                ]
                            ),

                        y=
                            float(
                                original[
                                    "y"
                                ]
                            ),
                    )
                )

                db.add(
                    row
                )

            else:
                row.visibility = int(
                    original[
                        "visibility"
                    ]
                )

                row.x = float(
                    original[
                        "x"
                    ]
                )

                row.y = float(
                    original[
                        "y"
                    ]
                )

            restored_2d.append(
                {
                    "camera_index":
                        camera_index,

                    "frame":
                        history.frame,

                    "visibility":
                        row.visibility,

                    "x":
                        row.x,

                    "y":
                        row.y,

                    "deleted":
                        False,
                }
            )

        db.flush()

        restored_camera_indices = {
            int(
                item[
                    "camera_index"
                ]
            )
            for item
            in restored_2d
        }

        camera_2d_status = {
            camera_index: (
                db.query(
                    BallPosition2D
                )
                .filter(
                    BallPosition2D.match_id
                    == match_id,

                    BallPosition2D.camera_index
                    == camera_index,
                )
                .count()
                > 0
            )
            for camera_index
            in restored_camera_indices
        }

        cameras = (
            match.cameras
            if isinstance(
                match.cameras,
                list,
            )
            else []
        )

        next_cameras = []

        for fallback_index, camera in enumerate(
            cameras
        ):
            if not isinstance(
                camera,
                dict,
            ):
                next_cameras.append(
                    camera
                )

                continue

            try:
                camera_index = int(
                    camera.get(
                        "index",
                        fallback_index,
                    )
                )
            except (
                TypeError,
                ValueError,
            ):
                camera_index = (
                    fallback_index
                )

            next_cameras.append(
                {
                    **camera,

                    "has_ball_2d": (
                        camera_2d_status.get(
                            camera_index,
                            camera.get(
                                "has_ball_2d",
                                False,
                            ),
                        )
                    ),
                }
            )

        match.cameras = (
            next_cameras
        )

        for item in restored_2d:
            item[
                "has_ball_2d"
            ] = (
                camera_2d_status[
                    int(
                        item[
                            "camera_index"
                        ]
                    )
                ]
            )

        history.reverted_at = (
            datetime.utcnow()
        )

        db.commit()

    except Exception:
        db.rollback()
        raise

    return {
        "ok":
            True,

        "repair_id":
            history.id,

        "frame":
            history.frame,

        "trajectory_point":
            restored_point,

        "trajectory_deleted": (
            restored_point
            is None
        ),

        "ball_2d_points":
            restored_2d,
    }
