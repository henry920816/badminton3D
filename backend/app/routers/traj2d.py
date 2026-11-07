"""2D 羽球標註的讀取：原始 / 修正後的標註、品質格子、兩兩重建"""

import math

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..ball2d_corrections import (
    Ball2DSource,
    load_ball_2d_rows,
)
from ..cameras import cameras_by_index_for_match
from ..db import get_db
from ..models import Match
from ..schemas import BallPosition2DPoint
from ..triangulation import (
    QUALITY_REPROJECTION_THRESHOLD_PX,
    explain_pairwise_frame,
    pairwise_consensus_point,
    per_view_pairwise_points,
    scan_2d_camera_grid,
)


router = APIRouter()


@router.get(
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


MAX_CAMERA_GRID_FRAMES = 6000


@router.get(
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

    return scan_2d_camera_grid(
        cameras_by_index,
        observations_by_frame,
        start_frame,
        end_frame,
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
            }
        )

    return cameras_by_index, observations_by_frame


def parse_reprojection_threshold(value: float) -> float:
    if not math.isfinite(value) or value <= 0:
        raise HTTPException(
            status_code=400,
            detail="reprojection_threshold_px 必須大於 0",
        )
    return float(value)


def parse_camera_max_distance(text: str) -> dict[int, float]:
    """「相機編號:公尺」逗號分隔，例如 "3:7,4:5"。"""
    try:
        max_distance = {}

        for item in text.split(","):
            if not item.strip():
                continue
            camera_text, distance_text = item.split(":")
            distance = float(distance_text)
            if not math.isfinite(distance) or distance <= 0:
                raise ValueError
            max_distance[int(camera_text)] = distance
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="camera_max_distance 必須是逗號分隔的「相機編號:公尺」",
        )

    return max_distance


@router.get(
    "/matches/{match_id}/traj2d/pairwise/explain"
)
def explain_traj_2d_pairwise(
    match_id: int,
    frame: int,
    db: Session = Depends(get_db),
    source: Ball2DSource = "original",
    camera_max_distance: str = "",
    reprojection_threshold_px: float = QUALITY_REPROJECTION_THRESHOLD_PX,
):
    """說明某一格的兩兩重建：哪幾台有標註、每組配對通過與否與原因、
    受距離限制的相機有沒有被拿掉、最後用了哪些相機（見
    explain_pairwise_frame）。前端說明列解釋「為什麼這格沒有重建點」用。"""
    cameras_by_index, observations_by_frame = load_pairwise_inputs(
        match_id,
        frame,
        frame,
        db,
        source,
    )

    return {
        "frame": frame,
        **explain_pairwise_frame(
            cameras_by_index,
            observations_by_frame.get(frame, []),
            reprojection_threshold_px=parse_reprojection_threshold(reprojection_threshold_px),
            camera_max_distance=parse_camera_max_distance(camera_max_distance),
        ),
    }


@router.get(
    "/matches/{match_id}/traj2d/pairwise"
)
def get_traj_2d_pairwise(
    match_id: int,
    start_frame: int,
    end_frame: int,
    db: Session = Depends(get_db),
    source: Ball2DSource = "original",
    exclude_cameras: str = "",
    camera_max_distance: str = "",
    reprojection_threshold_px: float = QUALITY_REPROJECTION_THRESHOLD_PX,
):
    """每個 frame 用 2D 羽球位置兩兩重建，回傳各組 3D 點的中位數。

    前端拿這串點來偵測擊球，擊球前最後一格的點也是球拍拍面中心要對準的
    位置。沒有可用相機組合的 frame 不會出現在結果裡。

    exclude_cameras 是逗號分隔的相機編號，這些相機的標註不拿來重建
    （camera_count 也不算它們）。

    camera_max_distance 是「相機編號:公尺」逗號分隔，例如 "3:7,4:5"：
    這些相機只在球離它不超過那個距離時才拿來重建（見
    pairwise_consensus_point）。

    reprojection_threshold_px 是「同意」的像素門檻：配對重建點投影回各台，
    和標註差在這個距離內才算同意（預設 QUALITY_REPROJECTION_THRESHOLD_PX）。

    每一格另外回傳 used_cameras（實際拿來重建的相機）。
    """
    try:
        excluded = {
            int(item)
            for item in exclude_cameras.split(",")
            if item.strip()
        }
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="exclude_cameras 必須是逗號分隔的相機編號",
        )

    max_distance = parse_camera_max_distance(camera_max_distance)
    threshold = parse_reprojection_threshold(reprojection_threshold_px)

    cameras_by_index, observations_by_frame = (
        load_pairwise_inputs(
            match_id,
            start_frame,
            end_frame,
            db,
            source,
        )
    )

    if excluded:
        observations_by_frame = {
            frame: [
                observation
                for observation in observations
                if int(observation["camera_index"]) not in excluded
            ]
            for frame, observations in observations_by_frame.items()
        }

    results = []

    for frame in sorted(observations_by_frame):
        consensus = pairwise_consensus_point(
            cameras_by_index,
            observations_by_frame.get(
                frame,
                [],
            ),
            reprojection_threshold_px=threshold,
            camera_max_distance=max_distance,
        )

        if consensus is None:
            continue

        results.append(
            {
                "frame": frame,
                **consensus["point"],
                "pair_count":
                    consensus["pair_count"],
                "camera_count":
                    consensus["camera_count"],
                "used_cameras":
                    consensus["used_cameras"],
            }
        )

    return results


@router.get(
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


@router.get(
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
