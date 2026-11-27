"""資料集上傳、查詢與刪除的 HTTP 入口。

實際檔案檢查及匯入留在 dataset_upload.py；這裡只處理請求和回應。
"""

import json
import shutil
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .db import get_db
from .models import Anomaly, BallPosition2D, BallTraj, Hit, Match, MatchPlayer, Rally
from .reconstruction_assets import dataset_catalog_entry, remove_match_assets
from .dataset_originals import save_new_dataset_sources
from .dataset_upload import (
    CATEGORY_NAMES, clean_expired_sessions, default_manifest,
    import_dataset_from_session, inspect_upload_session, load_session,
    remove_record_file, save_manifest, session_dir,
    store_uploaded_files, validate_category,
)

router = APIRouter()

@router.post(
    "/datasets/upload-sessions"
)
def create_upload_session():
    clean_expired_sessions()

    token = uuid.uuid4().hex
    base = session_dir(token)

    base.mkdir(
        parents=True,
        exist_ok=False,
    )

    manifest = default_manifest(token)
    save_manifest(base, manifest)

    return inspect_upload_session(
        base,
        manifest,
    )


@router.get(
    "/datasets/upload-sessions/{session_token}"
)
def get_upload_session(
    session_token: str,
):
    clean_expired_sessions()
    base, manifest = load_session(
        session_token
    )

    return inspect_upload_session(
        base,
        manifest,
    )


@router.post(
    "/datasets/upload-sessions/{session_token}/categories/{category}"
)
async def upload_session_category(
    session_token: str,
    category: str,
    files: list[UploadFile] = File(...),
    relative_paths: list[str] | None = Form(
        default=None
    ),
):
    clean_expired_sessions()
    category = validate_category(category)
    base, manifest = load_session(
        session_token
    )

    try:
        await store_uploaded_files(
            base,
            manifest,
            category,
            files,
            relative_paths,
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                f"{CATEGORY_NAMES[category]}上傳失敗：{exc}"
            ),
        ) from exc

    return inspect_upload_session(
        base,
        manifest,
    )


@router.delete(
    "/datasets/upload-sessions/{session_token}/categories/{category}"
)
def clear_upload_session_category(
    session_token: str,
    category: str,
):
    clean_expired_sessions()
    category = validate_category(category)
    base, manifest = load_session(
        session_token
    )

    for record in manifest[
        "categories"
    ][category]:
        remove_record_file(
            base,
            record,
        )

    manifest[
        "categories"
    ][category] = []

    category_path = (
        base
        / "files"
        / category
    )

    shutil.rmtree(
        category_path,
        ignore_errors=True,
    )

    save_manifest(
        base,
        manifest,
    )

    return inspect_upload_session(
        base,
        manifest,
    )


@router.delete(
    "/datasets/upload-sessions/{session_token}"
)
def delete_upload_session(
    session_token: str,
):
    base = session_dir(
        session_token
    )

    existed = base.exists()

    shutil.rmtree(
        base,
        ignore_errors=True,
    )

    return {
        "ok": True,
        "deleted": existed,
    }


@router.post(
    "/datasets/upload-sessions/{session_token}/finalize"
)
def finalize_upload_session(
    session_token: str,
    settings_json: str = Form("{}"),
    db: Session = Depends(get_db),
):
    clean_expired_sessions()
    base, manifest = load_session(
        session_token
    )

    inspection = inspect_upload_session(
        base,
        manifest,
    )

    if not inspection["can_finalize"]:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "資料尚未準備完成",
                "errors": inspection["errors"],
            },
        )

    created_match_id: int | None = None

    try:
        settings = json.loads(
            settings_json
            or "{}"
        )

        if not isinstance(
            settings,
            dict,
        ):
            raise ValueError(
                "上傳設定格式錯誤"
            )

        result = import_dataset_from_session(
            db,
            base,
            manifest,
            settings,
        )
        created_match_id = int(result["match_id"])

        # 封存使用者上傳的原檔；不能再依資料庫猜原本 CSV 欄位或 NPY/PTH。
        save_new_dataset_sources(created_match_id, base, manifest)
        db.commit()

    except ValueError as exc:
        db.rollback()
        if created_match_id is not None:
            remove_match_assets(created_match_id)

        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except HTTPException:
        db.rollback()
        if created_match_id is not None:
            remove_match_assets(created_match_id)
        raise

    except Exception as exc:
        db.rollback()
        if created_match_id is not None:
            remove_match_assets(created_match_id)

        raise HTTPException(
            status_code=500,
            detail=(
                "資料集匯入失敗："
                f"{exc}"
            ),
        ) from exc

    shutil.rmtree(
        base,
        ignore_errors=True,
    )

    return result


@router.get(
    "/datasets"
)
def list_datasets(
    db: Session = Depends(get_db),
):
    matches = (
        db.query(Match)
        .order_by(
            Match.created_at.desc(),
            Match.id.desc(),
        )
        .all()
    )

    datasets = []

    for match in matches:
        cameras = (
            match.cameras
            if isinstance(
                match.cameras,
                list,
            )
            else []
        )
        catalog = dataset_catalog_entry(db, match.id)
        reconstruction = catalog["reconstruction"]

        datasets.append(
            {
                "match_id": match.id,
                "title": match.title,
                "fps": match.fps,
                "duration_frame": match.duration_frame,
                "created_at": (
                    match.created_at.isoformat()
                    if match.created_at
                    else None
                ),
                "rally_count": (
                    db.query(Rally)
                    .filter(
                        Rally.match_id
                        == match.id
                    )
                    .count()
                ),
                "hit_count": (
                    db.query(Hit)
                    .filter(
                        Hit.match_id
                        == match.id
                    )
                    .count()
                ),
                "trajectory_count": (
                    db.query(BallTraj)
                    .filter(
                        BallTraj.match_id
                        == match.id
                    )
                    .count()
                ),
                "ball_2d_point_count": (
                    db.query(BallPosition2D)
                    .filter(
                        BallPosition2D.match_id
                        == match.id
                    )
                    .count()
                ),
                "ball_2d_file_count": sum(
                    int(
                        camera.get(
                            "ball_2d_file_count",
                            0,
                        )
                        or 0
                    )
                    for camera in cameras
                ),
                "anomaly_count": (
                    db.query(Anomaly)
                    .filter(
                        Anomaly.match_id
                        == match.id
                    )
                    .count()
                ),
                "camera_count": len(cameras),
                "reconstruction_competition": reconstruction.get("competition"),
                "reconstruction_gender": reconstruction.get("gender"),
                "reconstruction_motion_count": reconstruction.get(
                    "motion_file_count",
                    0,
                ),
                "reconstruction_score_count": reconstruction.get(
                    "score_count",
                    0,
                ),
                "players": catalog["players"],
                "discipline": catalog["discipline"],
                "games": catalog["games"],
            }
        )

    return {
        "datasets": datasets,
    }


@router.delete(
    "/datasets/{match_id}"
)
def delete_dataset(
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
            detail="找不到指定的資料集",
        )

    title = match.title

    counts = {
        "hits": (
            db.query(Hit)
            .filter(
                Hit.match_id
                == match_id
            )
            .count()
        ),
        "anomalies": (
            db.query(Anomaly)
            .filter(
                Anomaly.match_id
                == match_id
            )
            .count()
        ),
        "rallies": (
            db.query(Rally)
            .filter(
                Rally.match_id
                == match_id
            )
            .count()
        ),
        "trajectories": (
            db.query(BallTraj)
            .filter(
                BallTraj.match_id
                == match_id
            )
            .count()
        ),
        "ball_2d_positions": (
            db.query(BallPosition2D)
            .filter(
                BallPosition2D.match_id
                == match_id
            )
            .count()
        ),
    }

    try:
        db.query(Hit).filter(
            Hit.match_id
            == match_id
        ).delete(
            synchronize_session=False
        )

        db.query(Anomaly).filter(
            Anomaly.match_id
            == match_id
        ).delete(
            synchronize_session=False
        )

        db.query(BallTraj).filter(
            BallTraj.match_id
            == match_id
        ).delete(
            synchronize_session=False
        )

        db.query(BallPosition2D).filter(
            BallPosition2D.match_id
            == match_id
        ).delete(
            synchronize_session=False
        )

        # 選手本身留著（同一人可能還有別場比賽，也可能已經被改過顯示名稱），
        # 只清掉這場比賽的出賽名單。
        db.query(MatchPlayer).filter(
            MatchPlayer.match_id
            == match_id
        ).delete(
            synchronize_session=False
        )

        db.query(Rally).filter(
            Rally.match_id
            == match_id
        ).delete(
            synchronize_session=False
        )

        db.delete(match)
        db.commit()

    except Exception as exc:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                "刪除資料集失敗："
                f"{exc}"
            ),
        ) from exc

    assets_deleted = remove_match_assets(match_id)

    next_match = (
        db.query(Match)
        .order_by(
            Match.created_at.desc(),
            Match.id.desc(),
        )
        .first()
    )

    return {
        "ok": True,
        "deleted_match_id": match_id,
        "deleted_title": title,
        "deleted_counts": counts,
        "assets_deleted": assets_deleted,
        "next_match_id": (
            next_match.id
            if next_match
            else None
        ),
    }



@router.post('/datasets/{match_id}/source-files/{category}')
async def restore_original_files_for_export(
    match_id: int,
    category: str,
    files: list[UploadFile] = File(...),
    relative_paths: list[str] | None = Form(default=None),
    db: Session = Depends(get_db),
):
    """舊資料集補回原始檔供匯出使用；不更動現有計算資料。"""
    from .dataset_originals import replace_saved_sources, safe_path
    from .dataset_upload import category_filename_allowed, safe_basename

    if db.get(Match, match_id) is None:
        raise HTTPException(404, detail='找不到資料集')
    category = validate_category(category)
    if category == 'ball-2d':
        raise HTTPException(400, detail='2D CSV 請用 Update Dataset 的「更新 2D」功能，以同步更新資料庫')
    if not files or len(files) > 400:
        raise HTTPException(400, detail='一次最多補傳 400 個來源檔')
    paths = list(relative_paths or [])
    if paths and len(paths) != len(files):
        raise HTTPException(400, detail='檔案與路徑數量不符')
    additions = []
    total = 0
    keys = set()
    for index, upload in enumerate(files):
        name = safe_basename(upload.filename)
        if not category_filename_allowed(category, name):
            raise HTTPException(400, detail=f'{name} 不是 {CATEGORY_NAMES[category]} 可辨識的檔案')
        rel = safe_path(paths[index] if paths else name)
        if Path(rel).name != name:
            raise HTTPException(400, detail=f'檔名與相對路徑不符：{rel}')
        if rel.casefold() in keys:
            raise HTTPException(400, detail=f'同一批重複檔案：{rel}')
        keys.add(rel.casefold())
        content = await upload.read(256 * 1024 * 1024 + 1)
        await upload.close()
        total += len(content)
        if not content or len(content) > 256 * 1024 * 1024 or total > 512 * 1024 * 1024:
            raise HTTPException(413, detail='每檔上限 256MB，單批上限 512MB；大型 PTH 請分批補傳')
        additions.append((category, rel, content))
    count = replace_saved_sources(match_id, additions)
    return {'ok': True, 'saved_files': count,
            'note': '已保存原始檔供 Export Dataset 使用。此操作不重新匯入資料庫，也不會修改目前的 3D、Rally 或人物資料。'}
