from pydantic import BaseModel
from typing import Any, Optional, List

class MatchOut(BaseModel):
    id: int
    title: str
    fps: float
    duration_sec: float
    cameras: list

class TimelineOut(BaseModel):
    rallies: list[dict]
    hits: list[dict]
    anomalies: list[dict]

class TrajPoint(BaseModel):
    frame: int
    t_sec: float
    x: float
    y: float
    z: float
    confidence: float

class HitPatch(BaseModel):
    new_hit_frame: Optional[int] = None
    shot_type: Optional[str] = None
    hand: Optional[str] = None
    note: Optional[str] = None
    confidence: Optional[float] = None

class AnomalyPatch(BaseModel):
    status: Optional[str] = None
    comment: Optional[str] = None
    severity: Optional[int] = None
    kind: Optional[str] = None
