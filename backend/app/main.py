import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .db import engine, get_db
from .dataset_routes import router as dataset_upload_router
from .dataset_blue_cleanup import router as dataset_blue_cleanup_router
from .dataset_red_cleanup import router as dataset_red_cleanup_router
from .dataset_2d_files import router as dataset_2d_files_router
from .dataset_export import router as dataset_export_router
from .reconstruction_assets import reconstruction_router
from .auto_repair import router as auto_repair_router
from .review_repair_routes import router as review_repair_router
from .edit_history import router as edit_history_router
from .trajectory3d_api import router as trajectory3d_router
from .projection3d_align import router as projection3d_align_router
from .ball2d_reference import attach_reference_3d
from .ball2d_corrections import (
    Ball2DSource,
    load_ball_2d_rows,
    router as ball2d_corrections_router,
)
from .models import (
    Anomaly,
    BallPosition2D,
    BallTraj,
    Base,
    Hit,
    Match,
    Rally,
)
from .schemas import (
    BallPosition2DPoint,
    MatchOut,
    TimelineOut,
    TrajPoint,
)
from .legacy_traj_repairs import (
    router as legacy_traj_router,
    repair_traj_from_2d,  # 舊測試和工具仍從 main 匯入
    undo_traj_2d_repair,
)
from .editing_routes import router as editing_router
from .triangulation import (
    pairwise_consensus_point,
    per_view_pairwise_points,
    scan_2d_camera_grid,
)


app = FastAPI(
    title="Badminton 3D Debugger MVP",
    version="0.1.0",
)

app.include_router(
    dataset_upload_router
)
app.include_router(reconstruction_router)

app.include_router(
    auto_repair_router
)

app.include_router(review_repair_router)
app.include_router(dataset_blue_cleanup_router)
app.include_router(dataset_red_cleanup_router)
app.include_router(dataset_2d_files_router)
app.include_router(dataset_export_router)
app.include_router(edit_history_router)
app.include_router(trajectory3d_router)
app.include_router(projection3d_align_router)
app.include_router(legacy_traj_router)
app.include_router(editing_router)

app.include_router(
    ball2d_corrections_router
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
    source: Ball2DSource = "original",
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

    rows = load_ball_2d_rows(
        db,
        match_id,
        start,
        end,
        camera_index=camera_index,
        source=source,
    )

    return [
        BallPosition2DPoint(
            **row
        )
        for row in rows
    ]


def cameras_by_index_for_match(
    match: Match,
) -> dict[int, dict]:
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
            continue

        cameras_by_index[
            camera_index
        ] = camera

    return cameras_by_index


MAX_CAMERA_GRID_FRAMES = 6000


@app.get(
    "/matches/{match_id}/traj2d/camera-grid"
)
def get_traj_2d_camera_grid(
    match_id: int,
    start_frame: int,
    end_frame: int,
    db: Session = Depends(get_db),
    source: Ball2DSource = "original",
):
    cameras_by_index, observations_by_frame = (
        load_pairwise_inputs(
            match_id,
            start_frame,
            end_frame,
            db,
            source,
            max_frames=MAX_CAMERA_GRID_FRAMES,
        )
    )

    grid = scan_2d_camera_grid(
        cameras_by_index,
        observations_by_frame,
        start_frame,
        end_frame,
    )
    # 可信原始 3D 優先；沒有獨立視角支持時退回雙錨點與多視角 2D。
    original_3d = {
        int(row.frame): {"x": row.x, "y": row.y, "z": row.z}
        for row in db.query(BallTraj).filter(
            BallTraj.match_id == match_id,
            BallTraj.frame >= start_frame,
            BallTraj.frame <= end_frame,
        )
    }
    from .quality2d_temporal import attach_temporal_evidence
    from .quality_review import attach_review_quality
    hit_frames = {
        int(hit.new_hit_frame if hit.new_hit_frame is not None else hit.hit_frame)
        for hit in db.query(Hit).filter(Hit.match_id == match_id)
    }
    return attach_review_quality(
        attach_temporal_evidence(attach_reference_3d(
            grid, cameras_by_index, observations_by_frame, original_3d,
        ), observations_by_frame),
        cameras_by_index, observations_by_frame, original_3d, hit_frames,
    )


MAX_PAIRWISE_FRAMES = 6000


def require_match_frame_range(
    match_id: int,
    start_frame: int,
    end_frame: int,
    db: Session,
    max_frames: int,
) -> Match:
    """依 frame 範圍讀 2D 資料的 API 共用的檢查。"""
    match = db.get(
        Match,
        match_id,
    )

    if match is None:
        raise HTTPException(
            status_code=404,
            detail="match not found",
        )

    if end_frame < start_frame:
        raise HTTPException(
            status_code=400,
            detail=(
                "end_frame must be greater "
                "than or equal to start_frame"
            ),
        )

    if (
        end_frame
        - start_frame
        > max_frames
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"range too large "
                f"(max {max_frames} frames)"
            ),
        )

    return match


def load_pairwise_inputs(
    match_id: int,
    start_frame: int,
    end_frame: int,
    db: Session,
    source: Ball2DSource = "original",
    max_frames: int = MAX_PAIRWISE_FRAMES,
) -> tuple[dict[int, dict], dict[int, list[dict]]]:
    """重建共用的檢查與讀取：回傳相機參數，以及每個 frame 的 2D 羽球點。

    沒有相機參數的視角無法重建，直接略過。
    """
    match = require_match_frame_range(
        match_id,
        start_frame,
        end_frame,
        db,
        max_frames,
    )

    cameras_by_index = (
        cameras_by_index_for_match(
            match
        )
    )

    rows = load_ball_2d_rows(
        db,
        match_id,
        start_frame,
        end_frame,
        source=source,
        visible_only=True,
    )

    observations_by_frame = {}

    for row in rows:
        if (
            row["camera_index"]
            not in cameras_by_index
        ):
            continue

        observations_by_frame.setdefault(
            row["frame"],
            [],
        ).append(
            {
                "camera_index":
                    row["camera_index"],

                "x":
                    row["x"],

                "y":
                    row["y"],

                "corrected":
                    bool(row.get("corrected", False)),
            }
        )

    return cameras_by_index, observations_by_frame


@app.get(
    "/matches/{match_id}/traj2d/pairwise"
)
def get_traj_2d_pairwise(
    match_id: int,
    start_frame: int,
    end_frame: int,
    db: Session = Depends(get_db),
    source: Ball2DSource = "original",
):
    """每個 frame 用 2D 羽球位置兩兩重建，回傳各組 3D 點的中位數。

    前端拿這串點來偵測擊球，擊球前最後一格的點也是球拍拍面中心要對準的
    位置。沒有可用相機組合的 frame 不會出現在結果裡。
    """
    cameras_by_index, observations_by_frame = (
        load_pairwise_inputs(
            match_id,
            start_frame,
            end_frame,
            db,
            source,
        )
    )

    results = []

    for frame in sorted(observations_by_frame):
        consensus = pairwise_consensus_point(
            cameras_by_index,
            observations_by_frame.get(
                frame,
                [],
            ),
        )

        if consensus is None:
            continue

        results.append(
            {
                "frame": frame,
                **consensus["point"],
                "pair_count":
                    consensus["pair_count"],
            }
        )

    return results


@app.get(
    "/matches/{match_id}/traj2d/visible"
)
def get_traj_2d_visible(
    match_id: int,
    start_frame: int,
    end_frame: int,
    db: Session = Depends(get_db),
    source: Ball2DSource = "original",
):
    """每一格有哪些相機看得見羽球（有 2D 標註），回傳 [{frame, camera_index}]。

    影片面板用來在相機按鈕上標示目前這格哪些視角有 2D 標註，
    只回傳 frame 與相機，不帶座標，一個 rally 的量很小。
    """
    # 只看有沒有標註，用不到相機參數，沒有參數的視角也要列出來
    require_match_frame_range(
        match_id,
        start_frame,
        end_frame,
        db,
        MAX_PAIRWISE_FRAMES,
    )

    rows = load_ball_2d_rows(
        db,
        match_id,
        start_frame,
        end_frame,
        source=source,
        visible_only=True,
    )

    return [
        {
            "frame": row["frame"],
            "camera_index": row["camera_index"],
        }
        for row in rows
    ]


@app.get("/matches/{match_id}/traj2d/labels")
def get_traj_2d_labels(
    match_id: int,
    start_frame: int,
    end_frame: int,
    db: Session = Depends(get_db),
    source: Ball2DSource = "original",
):
    """回傳區段內的可見 2D 座標，供跨視角幾何輔助使用。"""
    require_match_frame_range(match_id, start_frame, end_frame, db, MAX_PAIRWISE_FRAMES)
    return load_ball_2d_rows(db, match_id, start_frame, end_frame, source=source, visible_only=True)


@app.get(
    "/matches/{match_id}/traj2d/pairwise/views"
)
def get_traj_2d_pairwise_views(
    match_id: int,
    start_frame: int,
    end_frame: int,
    db: Session = Depends(get_db),
    source: Ball2DSource = "original",
):
    """每個 frame、每個相機視角各給一個兩兩重建的 3D 點。

    做法同 triangulation_3Dline.py：一個視角的點是所有包含它的相機組合
    重建點的中位數，distance 是這些點到原點距離的中位數。時間軸用來畫
    各視角的距離與速度曲線，哪個視角的標註歪掉會直接看出來。
    """
    cameras_by_index, observations_by_frame = (
        load_pairwise_inputs(
            match_id,
            start_frame,
            end_frame,
            db,
            source,
        )
    )

    results = []

    for frame in sorted(observations_by_frame):
        views = per_view_pairwise_points(
            cameras_by_index,
            observations_by_frame[frame],
        )

        for camera_index in sorted(views):
            results.append(
                {
                    "frame": frame,
                    "camera_index": camera_index,
                    **views[camera_index],
                }
            )

    return results


