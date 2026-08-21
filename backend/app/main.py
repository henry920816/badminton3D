import csv
import os
from datetime import datetime
from io import StringIO

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .db import engine, get_db
from .dataset_upload import router as dataset_upload_router
from .models import (
    Anomaly,
    BallPosition2D,
    BallTraj,
    Base,
    Hit,
    Match,
    Rally,
    TrajectoryRepairHistory,
)
from .schemas import (
    AnomalyPatch,
    BallPosition2DPoint,
    HitPatch,
    MatchOut,
    TimelineOut,
    Traj2DRepairPayload,
    TrajPoint,
    TrajRepairPayload,
)
from .triangulation import (
    pairwise_triangulation_diagnostics,
    scan_2d_camera_grid,
    triangulate_observations,
)


app = FastAPI(
    title="Badminton 3D Debugger MVP",
    version="0.1.0",
)

app.include_router(
    dataset_upload_router
)


CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173",
)

origins = [
    origin.strip()
    for origin in CORS_ORIGINS.split(",")
    if origin.strip()
]


app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(
        bind=engine
    )


@app.get("/health")
def health():
    return {
        "ok": True,
    }


@app.get(
    "/matches/{match_id}",
    response_model=MatchOut,
)
def get_match(
    match_id: int,
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

    return MatchOut(
        id=match.id,
        title=match.title,
        fps=match.fps,
        duration_frame=match.duration_frame,
        cameras=match.cameras or [],
    )


@app.get(
    "/matches/{match_id}/timeline",
    response_model=TimelineOut,
)
def get_timeline(
    match_id: int,
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

    rallies = (
        db.query(Rally)
        .filter(
            Rally.match_id == match_id
        )
        .order_by(
            Rally.rally_index
        )
        .all()
    )

    hits = (
        db.query(Hit)
        .join(
            Rally,
            Hit.rally_id == Rally.id,
        )
        .filter(
            Hit.match_id == match_id
        )
        .order_by(
            Hit.rally_id,
            Hit.ball_round,
        )
        .all()
    )

    anomalies = (
        db.query(Anomaly)
        .filter(
            Anomaly.match_id == match_id
        )
        .order_by(
            Anomaly.start_frame
        )
        .all()
    )

    return TimelineOut(
        rallies=[
            {
                "id": rally.id,
                "rally_index": rally.rally_index,
                "start_frame": rally.start_frame,
                "end_frame": rally.end_frame,
                "status": rally.status,
            }
            for rally in rallies
        ],
        hits=[
            {
                "id": hit.id,
                "rally_id": hit.rally_id,
                "ball_round": hit.ball_round,
                "player": hit.player,
                "hit_frame": hit.hit_frame,
                "new_hit_frame": hit.new_hit_frame,
                "shot_type": hit.shot_type,
                "hand": hit.hand,
                "note": hit.note,
                "confidence": hit.confidence,
            }
            for hit in hits
        ],
        anomalies=[
            {
                "id": anomaly.id,
                "start_frame": anomaly.start_frame,
                "end_frame": anomaly.end_frame,
                "kind": anomaly.kind,
                "severity": anomaly.severity,
                "status": anomaly.status,
                "comment": anomaly.comment,
            }
            for anomaly in anomalies
        ],
    )


@app.get(
    "/matches/{match_id}/traj",
    response_model=list[TrajPoint],
)
def get_traj(
    match_id: int,
    start: int = 0,
    end: int = 999999999,
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

    rows = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame >= start,
            BallTraj.frame <= end,
        )
        .order_by(
            BallTraj.frame
        )
        .all()
    )

    results = []

    for index, row in enumerate(rows):
        speed = None

        if index > 0:
            previous = rows[index - 1]

            time_difference = (
                row.t_sec
                - previous.t_sec
            )

            if time_difference > 0:
                distance = (
                    (
                        row.x
                        - previous.x
                    ) ** 2
                    + (
                        row.y
                        - previous.y
                    ) ** 2
                    + (
                        row.z
                        - previous.z
                    ) ** 2
                ) ** 0.5

                speed = (
                    distance
                    / time_difference
                )

        results.append(
            TrajPoint(
                frame=row.frame,
                t_sec=row.t_sec,
                x=row.x,
                y=row.y,
                z=row.z,
                speed=speed,
                confidence=row.confidence,
            )
        )

    return results


@app.get(
    "/matches/{match_id}/traj2d",
    response_model=list[BallPosition2DPoint],
)
def get_traj_2d(
    match_id: int,
    camera_index: int,
    start: int = 0,
    end: int = 999999999,
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

    if camera_index < 0:
        raise HTTPException(
            status_code=400,
            detail="camera_index must be non-negative",
        )

    if end < start:
        raise HTTPException(
            status_code=400,
            detail="end must be greater than or equal to start",
        )

    rows = (
        db.query(BallPosition2D)
        .filter(
            BallPosition2D.match_id == match_id,
            BallPosition2D.camera_index == camera_index,
            BallPosition2D.frame >= start,
            BallPosition2D.frame <= end,
        )
        .order_by(
            BallPosition2D.frame
        )
        .all()
    )

    return [
        BallPosition2DPoint(
            frame=row.frame,
            camera_index=row.camera_index,
            visibility=row.visibility,
            x=row.x,
            y=row.y,
        )
        for row in rows
    ]


def cameras_by_index_for_match(match: Match) -> dict[int, dict]:
    cameras = match.cameras if isinstance(match.cameras, list) else []
    cameras_by_index: dict[int, dict] = {}

    for fallback_index, camera in enumerate(cameras):
        if not isinstance(camera, dict):
            continue
        try:
            cameras_by_index[int(camera.get("index", fallback_index))] = camera
        except (TypeError, ValueError):
            continue

    return cameras_by_index

MAX_CAMERA_GRID_FRAMES = 6000

@app.get("/matches/{match_id}/traj2d/camera-grid")
def get_traj_2d_camera_grid(
    match_id: int,
    start_frame: int,
    end_frame: int,
    db: Session = Depends(get_db),
):
    """Classify every camera at every frame in a range as ok / bad / no_data.

    Powers the per-rally, per-camera quality grid: one row per camera, one
    column per frame, so a user can see at a glance which view is missing
    or disagreeing with the rest.
    """
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="match not found")
    if end_frame < start_frame:
        raise HTTPException(
            status_code=400,
            detail="end_frame must be greater than or equal to start_frame",
        )
    if end_frame - start_frame > MAX_CAMERA_GRID_FRAMES:
        raise HTTPException(
            status_code=400,
            detail=f"range too large (max {MAX_CAMERA_GRID_FRAMES} frames)",
        )

    cameras_by_index = cameras_by_index_for_match(match)

    rows = (
        db.query(BallPosition2D)
        .filter(
            BallPosition2D.match_id == match_id,
            BallPosition2D.frame >= start_frame,
            BallPosition2D.frame <= end_frame,
            BallPosition2D.visibility > 0,
        )
        .order_by(BallPosition2D.frame, BallPosition2D.camera_index)
        .all()
    )

    observations_by_frame: dict[int, list[dict]] = {}
    for row in rows:
        if row.camera_index not in cameras_by_index:
            continue
        observations_by_frame.setdefault(row.frame, []).append(
            {"camera_index": row.camera_index, "x": row.x, "y": row.y}
        )

    return scan_2d_camera_grid(
        cameras_by_index,
        observations_by_frame,
        start_frame,
        end_frame,
    )


def trajectory_point_dict(
    point: BallTraj,
) -> dict:
    return {
        "frame": point.frame,
        "t_sec": point.t_sec,
        "x": point.x,
        "y": point.y,
        "z": point.z,
        "speed": point.speed,
        "confidence": (
            point.confidence
        ),
    }


@app.post(
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
        for observation in (
            payload.observations
        )
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
        "frame": payload.frame,
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
        "x": triangulation[
            "point"
        ]["x"],
        "y": triangulation[
            "point"
        ]["y"],
        "z": triangulation[
            "point"
        ]["z"],
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
        "ok": True,
        "confirmed": False,
        "repair_id": None,
        "frame": payload.frame,
        "previous_point": (
            previous_point
        ),
        "trajectory_point": (
            repaired_point
        ),
        "observations": (
            triangulation[
                "observations"
            ]
        ),
        "reprojection": (
            triangulation[
                "reprojection"
            ]
        ),
        "rms_error": (
            triangulation[
                "rms_error"
            ]
        ),
        "max_error": (
            triangulation[
                "max_error"
            ]
        ),
        "warnings": warnings,
        "ball_2d_points": [],
    }

    if not payload.confirm:
        return result

    original_2d = []
    repaired_2d = []

    try:
        if existing_point is None:
            existing_point = BallTraj(
                match_id=match_id,
                frame=payload.frame,
                t_sec=(
                    repaired_point[
                        "t_sec"
                    ]
                ),
                x=(
                    repaired_point["x"]
                ),
                y=(
                    repaired_point["y"]
                ),
                z=(
                    repaired_point["z"]
                ),
                speed=None,
                confidence=1.0,
            )
            db.add(existing_point)
        else:
            existing_point.x = (
                repaired_point["x"]
            )
            existing_point.y = (
                repaired_point["y"]
            )
            existing_point.z = (
                repaired_point["z"]
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
                    "camera_index": (
                        observation[
                            "camera_index"
                        ]
                    ),
                    "existed": (
                        row is not None
                    ),
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
                row = BallPosition2D(
                    match_id=match_id,
                    camera_index=(
                        observation[
                            "camera_index"
                        ]
                    ),
                    frame=payload.frame,
                    visibility=1,
                    x=observation["x"],
                    y=observation["y"],
                )
                db.add(row)
            else:
                row.visibility = 1
                row.x = observation["x"]
                row.y = observation["y"]

            repaired_2d.append(
                {
                    "camera_index": (
                        observation[
                            "camera_index"
                        ]
                    ),
                    "frame": (
                        payload.frame
                    ),
                    "visibility": 1,
                    "x": observation["x"],
                    "y": observation["y"],
                }
            )

        repaired_camera_indices = {
            int(
                observation[
                    "camera_index"
                ]
            )
            for observation in (
                triangulation[
                    "observations"
                ]
            )
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

        match.cameras = next_cameras

        history = (
            TrajectoryRepairHistory(
                match_id=match_id,
                frame=payload.frame,
                source="manual_2d",
                original_point=(
                    previous_point
                ),
                repaired_point=(
                    repaired_point
                ),
                original_2d=(
                    original_2d
                ),
                repaired_2d=(
                    repaired_2d
                ),
                reprojection={
                    "rms_error": (
                        triangulation[
                            "rms_error"
                        ]
                    ),
                    "max_error": (
                        triangulation[
                            "max_error"
                        ]
                    ),
                    "by_camera": (
                        triangulation[
                            "reprojection"
                        ]
                    ),
                },
            )
        )
        db.add(history)
        db.flush()
        db.commit()

    except Exception:
        db.rollback()
        raise

    result["confirmed"] = True
    result["repair_id"] = history.id
    result["ball_2d_points"] = (
        repaired_2d
    )

    return result


@app.post(
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

    if history.reverted_at is not None:
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
        if history.original_point is None:
            db.delete(
                current_point
            )
        else:
            original = (
                history.original_point
            )
            current_point.t_sec = (
                original["t_sec"]
            )
            current_point.x = (
                original["x"]
            )
            current_point.y = (
                original["y"]
            )
            current_point.z = (
                original["z"]
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
                if row is not None:
                    db.delete(row)

                restored_2d.append(
                    {
                        "camera_index": (
                            camera_index
                        ),
                        "frame": (
                            history.frame
                        ),
                        "deleted": True,
                    }
                )
                continue

            if row is None:
                row = BallPosition2D(
                    match_id=match_id,
                    camera_index=(
                        camera_index
                    ),
                    frame=history.frame,
                    visibility=int(
                        original[
                            "visibility"
                        ]
                    ),
                    x=float(
                        original["x"]
                    ),
                    y=float(
                        original["y"]
                    ),
                )
                db.add(row)
            else:
                row.visibility = int(
                    original[
                        "visibility"
                    ]
                )
                row.x = float(
                    original["x"]
                )
                row.y = float(
                    original["y"]
                )

            restored_2d.append(
                {
                    "camera_index": (
                        camera_index
                    ),
                    "frame": (
                        history.frame
                    ),
                    "visibility": (
                        row.visibility
                    ),
                    "x": row.x,
                    "y": row.y,
                    "deleted": False,
                }
            )

        db.flush()

        restored_camera_indices = {
            int(
                item[
                    "camera_index"
                ]
            )
            for item in restored_2d
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
            for camera_index in (
                restored_camera_indices
            )
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

        match.cameras = next_cameras

        for item in restored_2d:
            item[
                "has_ball_2d"
            ] = camera_2d_status[
                int(
                    item[
                        "camera_index"
                    ]
                )
            ]

        history.reverted_at = (
            datetime.utcnow()
        )
        db.commit()

    except Exception:
        db.rollback()
        raise

    return {
        "ok": True,
        "repair_id": history.id,
        "frame": history.frame,
        "trajectory_point": (
            restored_point
        ),
        "trajectory_deleted": (
            restored_point is None
        ),
        "ball_2d_points": (
            restored_2d
        ),
    }


@app.patch("/hits/{hit_id}")
def patch_hit(
    hit_id: int,
    payload: HitPatch,
    db: Session = Depends(get_db),
):
    hit = db.get(
        Hit,
        hit_id,
    )

    if hit is None:
        raise HTTPException(
            status_code=404,
            detail="hit not found",
        )

    update_data = payload.model_dump(
        exclude_unset=True
    )

    for key, value in update_data.items():
        setattr(
            hit,
            key,
            value,
        )

    db.commit()
    db.refresh(hit)

    return {
        "ok": True,
        "hit": {
            "id": hit.id,
            "rally_id": hit.rally_id,
            "ball_round": hit.ball_round,
            "player": hit.player,
            "hit_frame": hit.hit_frame,
            "new_hit_frame": hit.new_hit_frame,
            "shot_type": hit.shot_type,
            "hand": hit.hand,
            "note": hit.note,
            "confidence": hit.confidence,
        },
    }


@app.patch(
    "/anomalies/{anomaly_id}"
)
def patch_anomaly(
    anomaly_id: int,
    payload: AnomalyPatch,
    db: Session = Depends(get_db),
):
    anomaly = db.get(
        Anomaly,
        anomaly_id,
    )

    if anomaly is None:
        raise HTTPException(
            status_code=404,
            detail="anomaly not found",
        )

    update_data = payload.model_dump(
        exclude_unset=True
    )

    for key, value in update_data.items():
        setattr(
            anomaly,
            key,
            value,
        )

    db.commit()
    db.refresh(anomaly)

    return {
        "ok": True,
        "anomaly": {
            "id": anomaly.id,
            "start_frame": anomaly.start_frame,
            "end_frame": anomaly.end_frame,
            "kind": anomaly.kind,
            "severity": anomaly.severity,
            "status": anomaly.status,
            "comment": anomaly.comment,
        },
    }


@app.patch(
    "/matches/{match_id}/traj/repair"
)
def repair_traj(
    match_id: int,
    payload: TrajRepairPayload,
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

    start_frame = min(
        payload.start_frame,
        payload.end_frame,
    )

    end_frame = max(
        payload.start_frame,
        payload.end_frame,
    )

    if start_frame == end_frame:
        return {
            "ok": True,
            "count": 0,
        }

    start_point = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame == start_frame,
        )
        .first()
    )

    end_point = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame == end_frame,
        )
        .first()
    )

    if (
        start_point is None
        or end_point is None
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Start or end frame not found "
                "in trajectory data"
            ),
        )

    points = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame > start_frame,
            BallTraj.frame < end_frame,
        )
        .all()
    )

    frame_difference = (
        end_frame
        - start_frame
    )

    previous_point = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame < start_frame,
        )
        .order_by(
            BallTraj.frame.desc()
        )
        .first()
    )

    next_point = (
        db.query(BallTraj)
        .filter(
            BallTraj.match_id == match_id,
            BallTraj.frame > end_frame,
        )
        .order_by(
            BallTraj.frame.asc()
        )
        .first()
    )

    start_velocity_x = (
        end_point.x
        - start_point.x
    )

    start_velocity_y = (
        end_point.y
        - start_point.y
    )

    start_velocity_z = (
        end_point.z
        - start_point.z
    )

    if previous_point is not None:
        time_difference = (
            end_frame
            - previous_point.frame
        )

        start_velocity_x = (
            (
                end_point.x
                - previous_point.x
            )
            / time_difference
            * frame_difference
        )

        start_velocity_y = (
            (
                end_point.y
                - previous_point.y
            )
            / time_difference
            * frame_difference
        )

        start_velocity_z = (
            (
                end_point.z
                - previous_point.z
            )
            / time_difference
            * frame_difference
        )

    end_velocity_x = (
        end_point.x
        - start_point.x
    )

    end_velocity_y = (
        end_point.y
        - start_point.y
    )

    end_velocity_z = (
        end_point.z
        - start_point.z
    )

    if next_point is not None:
        time_difference = (
            next_point.frame
            - start_frame
        )

        end_velocity_x = (
            (
                next_point.x
                - start_point.x
            )
            / time_difference
            * frame_difference
        )

        end_velocity_y = (
            (
                next_point.y
                - start_point.y
            )
            / time_difference
            * frame_difference
        )

        end_velocity_z = (
            (
                next_point.z
                - start_point.z
            )
            / time_difference
            * frame_difference
        )

    count = 0

    for point in points:
        time_ratio = (
            point.frame
            - start_frame
        ) / frame_difference

        time_ratio_squared = (
            time_ratio
            * time_ratio
        )

        time_ratio_cubed = (
            time_ratio_squared
            * time_ratio
        )

        h00 = (
            2
            * time_ratio_cubed
            - 3
            * time_ratio_squared
            + 1
        )

        h10 = (
            time_ratio_cubed
            - 2
            * time_ratio_squared
            + time_ratio
        )

        h01 = (
            -2
            * time_ratio_cubed
            + 3
            * time_ratio_squared
        )

        h11 = (
            time_ratio_cubed
            - time_ratio_squared
        )

        point.x = (
            h00 * start_point.x
            + h10 * start_velocity_x
            + h01 * end_point.x
            + h11 * end_velocity_x
        )

        point.y = (
            h00 * start_point.y
            + h10 * start_velocity_y
            + h01 * end_point.y
            + h11 * end_velocity_y
        )

        point.z = (
            h00 * start_point.z
            + h10 * start_velocity_z
            + h01 * end_point.z
            + h11 * end_velocity_z
        )

        count += 1

    db.commit()

    return {
        "ok": True,
        "count": count,
    }


@app.get("/export/csv")
def export_csv(
    match_id: int,
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

    hits = (
        db.query(Hit)
        .join(
            Rally,
            Hit.rally_id == Rally.id,
        )
        .filter(
            Hit.match_id == match_id
        )
        .order_by(
            Hit.rally_id,
            Hit.ball_round,
        )
        .all()
    )

    output = StringIO()
    writer = csv.writer(output)

    writer.writerow(
        [
            "HitID",
            "RallyID",
            "BallRound",
            "Player",
            "HitFrame",
            "NewHitFrame",
            "ShotType",
            "Hand",
            "Note",
            "Confidence",
        ]
    )

    for hit in hits:
        writer.writerow(
            [
                hit.id,
                hit.rally_id,
                hit.ball_round,
                hit.player,
                hit.hit_frame,
                (
                    hit.new_hit_frame
                    if hit.new_hit_frame is not None
                    else ""
                ),
                hit.shot_type,
                hit.hand,
                hit.note,
                f"{hit.confidence:.3f}",
            ]
        )

    csv_text = output.getvalue()

    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                "attachment; "
                f'filename="shot_annotated_match_{match_id}.csv"'
            )
        },
    )
