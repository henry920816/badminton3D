import math
import pytest
from app.projection3d_align import align_at_depth, _matches
from app.triangulation import project_raw_point


def camera():
    return {'projection': {'intrinsic': [1000,1000,320,240,0,0,0,0,0],
        'extrinsic': [[1,0,0,0],[0,1,0,0],[0,0,1,0]],
        'useLensDistortion': False, 'imageWidth':640, 'imageHeight':480}}


def test_align_changes_3d_and_reprojects_to_2d():
    before = {'x':0., 'y':0., 'z':5.}
    observed = {'x':370., 'y':260.}
    result, shift = align_at_depth(before, camera(), observed)
    assert result['z'] == pytest.approx(5.)
    assert result['x'] == pytest.approx(.25)
    assert result['y'] == pytest.approx(.1)
    projected = project_raw_point(result, camera())
    assert projected['x'] == pytest.approx(observed['x'])
    assert projected['y'] == pytest.approx(observed['y'])
    assert shift == pytest.approx(math.hypot(.25,.1))


def test_align_rejects_behind_camera():
    with pytest.raises(ValueError):
        align_at_depth({'x':0.,'y':0.,'z':-5.}, camera(), {'x':320,'y':240})


def test_expected_point_rejects_stale_position():
    assert _matches({'x':0.,'y':0.,'z':5.}, {'x':0.,'y':0.,'z':5.})
    assert not _matches({'x':0.1,'y':0.,'z':5.}, {'x':0.,'y':0.,'z':5.})


def test_preview_confirm_and_undo_with_database():
    from sqlalchemy import BigInteger, create_engine
    from sqlalchemy.ext.compiler import compiles
    from sqlalchemy.orm import sessionmaker
    from app.models import Base, Match, BallTraj, BallPosition2D
    from app.projection3d_align import AlignPayload, align_projection_to_2d, undo_projection_alignment, redo_projection_alignment
    from fastapi import HTTPException
    @compiles(BigInteger, 'sqlite')
    def bigint_sqlite(type_, compiler, **kw):
        return 'INTEGER'
    engine = create_engine('sqlite+pysqlite:///:memory:')
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    camera0 = dict(camera(), index=0)
    match = Match(title='align', fps=50, duration_frame=300, cameras=[camera0])
    db.add(match)
    db.flush()
    db.add(BallTraj(match_id=match.id, frame=20, t_sec=.4, x=0, y=0, z=5, confidence=1))
    db.add(BallPosition2D(match_id=match.id, frame=20, camera_index=0, x=370, y=260, visibility=1))
    db.commit()
    match_id = match.id
    preview = align_projection_to_2d(match_id, AlignPayload(frame=20, camera_index=0), db)
    assert not preview['confirmed']
    assert db.query(BallTraj).first().x == 0
    with pytest.raises(HTTPException) as error:
        align_projection_to_2d(match_id, AlignPayload(frame=20,camera_index=0,confirm=True,
            expected_point=preview['original'], expected_observation={'x':999,'y':999}), db)
    assert error.value.status_code == 409
    applied = align_projection_to_2d(match_id, AlignPayload(frame=20,camera_index=0,confirm=True,
        expected_point=preview['original'], expected_observation=preview['observed_2d']), db)
    assert applied['confirmed']
    assert db.query(BallTraj).first().x == pytest.approx(.25)
    undone = undo_projection_alignment(match_id, applied['version_id'], db)
    assert undone['undone']
    assert db.query(BallTraj).first().x == 0
    with pytest.raises(HTTPException) as error:
        undo_projection_alignment(match_id, applied['version_id'], db)
    assert error.value.status_code == 409
    redone = redo_projection_alignment(match_id, applied['version_id'], db)
    assert redone['redone']
    assert db.query(BallTraj).first().x == pytest.approx(.25)
    with pytest.raises(HTTPException) as error:
        redo_projection_alignment(match_id, applied['version_id'], db)
    assert error.value.status_code == 409
    undone_again = undo_projection_alignment(match_id, applied['version_id'], db)
    assert undone_again['undone']
    db.query(BallTraj).first().x = .125
    db.commit()
    with pytest.raises(HTTPException) as error:
        redo_projection_alignment(match_id, applied['version_id'], db)
    assert error.value.status_code == 409
    db.close()
