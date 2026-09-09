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
    duration_frame: Mapped[int] = mapped_column(Integer, default=3600)
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

    # RallySeg.csv 的 Score 欄位是 {局}_{上半場}_{下半場}，記的是這一球「打完
    # 之後」的比分，而且是相對於場地半邊。換邊可能發生在一局中間，所以哪一隊
    # 在上半場必須逐球記錄。
    game_index: Mapped[int] = mapped_column(Integer, default=1, index=True)
    score_label: Mapped[str] = mapped_column(String(20), default="")  # 原字串，重建檔案靠它定位
    up_team: Mapped[int] = mapped_column(Integer, default=0)
    up_score: Mapped[int] = mapped_column(Integer, default=0)
    down_score: Mapped[int] = mapped_column(Integer, default=0)
    winner_team: Mapped[int | None] = mapped_column(Integer, nullable=True)

class Player(Base):
    """一位選手。

    名字只出現在 RallySeg.csv 的 UpCourt / DownCourt 欄位裡，過去只被寫進
    資料集的 manifest.json，查詢與修正都很難。這張表讓選手變成真正的實體。
    目前假設不同的人名字一定不同，所以 key 直接全域唯一。
    """

    __tablename__ = "players"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(80), unique=True, index=True)  # 正規化比對鍵
    name: Mapped[str] = mapped_column(String(80))  # CSV 上的原字串
    display_name: Mapped[str] = mapped_column(String(120), default="")  # 可編輯的全名
    gender: Mapped[str] = mapped_column(String(10), default="unknown")  # male|female|unknown
    note: Mapped[str] = mapped_column(String(400), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MatchPlayer(Base):
    """一場比賽的出賽名單。

    誰對誰是整場固定的，跟站在哪一邊無關，所以名單記在比賽層級；每一球是
    哪一隊在上半場則記在 Rally.up_team。team 讓雙打的搭檔關係表達得出來。
    """

    __tablename__ = "match_players"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    team: Mapped[int] = mapped_column(Integer, default=0)  # 0 / 1，同隊兩人共用
    seat: Mapped[int] = mapped_column(Integer, default=0)  # 隊內第幾人，單打固定 0
    source_name: Mapped[str] = mapped_column(String(80), default="")  # CSV 原始寫法


Index(
    "uq_match_player",
    MatchPlayer.match_id,
    MatchPlayer.player_id,
    unique=True,
)

Index(
    "uq_match_team_seat",
    MatchPlayer.match_id,
    MatchPlayer.team,
    MatchPlayer.seat,
    unique=True,
)


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
    speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)

Index("idx_ball_match_frame", BallTraj.match_id, BallTraj.frame)


class BallPosition2D(Base):
    __tablename__ = "ball_positions_2d"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    camera_index: Mapped[int] = mapped_column(Integer, index=True)
    frame: Mapped[int] = mapped_column(Integer, index=True)
    visibility: Mapped[int] = mapped_column(Integer, default=0)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)


Index(
    "uq_ball_2d_match_camera_frame",
    BallPosition2D.match_id,
    BallPosition2D.camera_index,
    BallPosition2D.frame,
    unique=True,
)


class TrajectoryRepairHistory(Base):
    __tablename__ = "trajectory_repair_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    frame: Mapped[int] = mapped_column(Integer, index=True)
    source: Mapped[str] = mapped_column(String(30), default="manual_2d")
    original_point: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    repaired_point: Mapped[dict] = mapped_column(JSON)
    original_2d: Mapped[list] = mapped_column(JSON, default=list)
    repaired_2d: Mapped[list] = mapped_column(JSON, default=list)
    reprojection: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reverted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


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
