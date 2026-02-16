from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy import ForeignKey, String, Float, Integer, BigInteger, DateTime, JSON, Index
from datetime import datetime

class Base(DeclarativeBase):
    pass

class Match(Base):
    __tablename__ = "matches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(120), default="Demo Match")
    fps: Mapped[float] = mapped_column(Float, default=60.0)
    duration_sec: Mapped[float] = mapped_column(Float, default=60.0)
    cameras: Mapped[dict] = mapped_column(JSON, default=list)  # [{"id":"cam1","label":"CAM 1","url":"..."}]
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Rally(Base):
    __tablename__ = "rallies"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    rally_index: Mapped[int] = mapped_column(Integer, index=True)
    start_frame: Mapped[int] = mapped_column(Integer)
    end_frame: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="unchecked")  # unchecked|reviewing|verified|needs_fix

class Hit(Base):
    __tablename__ = "hits"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    rally_id: Mapped[int] = mapped_column(ForeignKey("rallies.id", ondelete="CASCADE"), index=True)
    ball_round: Mapped[int] = mapped_column(Integer)  # 1..N inside rally
    player: Mapped[str] = mapped_column(String(10), default="Up")  # Up/Down
    hit_frame: Mapped[int] = mapped_column(Integer)
    new_hit_frame: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shot_type: Mapped[str] = mapped_column(String(30), default="Unknown")
    hand: Mapped[str] = mapped_column(String(10), default="Unknown")
    note: Mapped[str] = mapped_column(String(400), default="")
    confidence: Mapped[float] = mapped_column(Float, default=1.0)

class BallTraj(Base):
    __tablename__ = "ball_traj"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    frame: Mapped[int] = mapped_column(Integer, index=True)
    t_sec: Mapped[float] = mapped_column(Float, index=True)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    z: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)

Index("idx_ball_match_frame", BallTraj.match_id, BallTraj.frame)

class Anomaly(Base):
    __tablename__ = "anomalies"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    start_frame: Mapped[int] = mapped_column(Integer)
    end_frame: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(30), default="low_confidence")  # spike|gap|drift|out_of_court...
    severity: Mapped[int] = mapped_column(Integer, default=3)  # 1..5
    status: Mapped[str] = mapped_column(String(20), default="open")  # open|fixed|false_positive|needs_rebuild
    comment: Mapped[str] = mapped_column(String(400), default="")
