import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import engine
from .dataset_upload import router as dataset_upload_router
from .auto_repair import router as auto_repair_router
from .ball2d_corrections import router as ball2d_corrections_router
from .models import Base
# 各 router 依原本的路由順序 include（FastAPI 依註冊順序比對路徑）
from .routers import (
    annotations,
    export,
    matches,
    traj2d,
    traj2d_repair,
    traj_repair,
)


app = FastAPI(
    title="Badminton 3D Debugger MVP",
    version="0.1.0",
)

app.include_router(
    dataset_upload_router
)

app.include_router(
    auto_repair_router
)

app.include_router(
    ball2d_corrections_router
)

app.include_router(
    matches.router
)

app.include_router(
    traj2d.router
)

app.include_router(
    traj2d_repair.router
)

app.include_router(
    annotations.router
)

app.include_router(
    traj_repair.router
)

app.include_router(
    export.router
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
