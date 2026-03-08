import math, random
from sqlalchemy.orm import Session
from .models import Match, Rally, Hit, BallTraj, Anomaly

def seed_demo(db: Session):
    # If already seeded, do nothing
    if db.query(Match).count() > 0:
        return

    fps = 60.0
    duration = 90.0  # seconds
    total_frames = int(duration * fps)

    match = Match(
        title="Demo - Badminton 3D Debugger MVP",
        fps=fps,
        duration_sec=duration,
        cameras=[
            {"id": "cam1", "label": "CAM 1", "url": "sample_cam1.mp4"},
            {"id": "cam2", "label": "CAM 2", "url": "sample_cam2.mp4"},
        ],
    )
    db.add(match)
    db.flush()

    # Create rallies
    rallies = []
    cursor = 0
    rally_len_frames = int(6.0 * fps)
    for i in range(10):
        start = cursor
        end = min(cursor + rally_len_frames - 1, total_frames - 1)
        status = "unchecked"
        r = Rally(match_id=match.id, rally_index=i+1, start_frame=start, end_frame=end, status=status)
        rallies.append(r)
        db.add(r)
        cursor = end + int(1.5 * fps)

    db.flush()

    # Ball trajectory: a rough parabola + jitter + occasional spikes/gaps
    traj = []
    for f in range(total_frames):
        t = f / fps

        # Base "court" coordinates (meters-ish, arbitrary)
        x = 3.0 * math.sin(t * 0.8) + (random.random() - 0.5) * 0.08
        y = 4.0 * math.cos(t * 0.6) + (random.random() - 0.5) * 0.08

        # Parabolic-ish height
        z = max(0.0, 2.5 * math.sin(t * 1.2) + 0.8) + (random.random() - 0.5) * 0.06

        conf = max(0.0, min(1.0, 0.85 + (random.random() - 0.5) * 0.25))

        # Insert a couple of anomalies:
        # Spike region
        if 25.0 < t < 25.2:
            x += 6.0
            y -= 6.0
            conf = 0.25
        # Gap region (missing -> we still store but with low conf + zeros, frontend can treat low conf as suspicious)
        if 47.0 < t < 47.3:
            z = 0.0
            conf = 0.15

        speed = random.uniform(0.0, 150.0)

        traj.append(BallTraj(match_id=match.id, frame=f, t_sec=t, x=x, y=y, z=z, speed=speed, confidence=conf))

    db.bulk_save_objects(traj)

    # Hits: ~2-6 per rally
    shot_types = ["Smash", "Clear", "Drop", "Drive", "Net", "Lift", "Unknown"]
    hands = ["FH", "BH", "Unknown"]
    hid = 1
    for r in rallies:
        n = random.randint(3, 7)
        frames = sorted(random.sample(range(r.start_frame + int(0.5*fps), r.end_frame - int(0.5*fps)), n))
        for j, hf in enumerate(frames, start=1):
            db.add(Hit(
                match_id=match.id,
                rally_id=r.id,
                ball_round=j,
                player="Up" if j % 2 == 1 else "Down",
                hit_frame=hf,
                new_hit_frame=None,
                shot_type=random.choice(shot_types),
                hand=random.choice(hands),
                note="",
                confidence=max(0.0, min(1.0, 0.9 + (random.random()-0.5)*0.2))
            ))

    # Anomalies
    db.add(Anomaly(match_id=match.id, start_frame=int(25.0*fps), end_frame=int(25.2*fps), kind="spike", severity=5, status="open", comment="Position spike"))
    db.add(Anomaly(match_id=match.id, start_frame=int(47.0*fps), end_frame=int(47.3*fps), kind="low_confidence", severity=4, status="open", comment="Low confidence / gap-like"))
    db.commit()
