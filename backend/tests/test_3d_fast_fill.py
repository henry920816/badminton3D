import pytest
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException
from app.models import Base, Match, BallTraj, BallPosition2D, TrajectoryRepairHistory
from app.projection3d_align import (FillPayload, AlignPayload, fill_missing_3d,
    undo_projection_alignment, redo_projection_alignment, align_projection_to_2d)

@compiles(BigInteger, 'sqlite')
def sqlite_bigint(type_, compiler, **kw):
    return 'INTEGER'

def setup():
    engine = create_engine('sqlite+pysqlite:///:memory:')
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    camera = {'index':0,'projection':{'intrinsic':[1000,1000,320,240,0,0,0,0,0],
        'extrinsic':[[1,0,0,0],[0,1,0,0],[0,0,1,0]],
        'useLensDistortion':False,'imageWidth':640,'imageHeight':480}}
    session.add(Match(title='test',fps=50,duration_frame=100,cameras=[camera]))
    session.commit()
    return session, session.query(Match).first().id

def test_direct_single_request_and_undo():
    db, match_id = setup()
    db.add(BallTraj(match_id=match_id,frame=10,t_sec=.2,x=0,y=0,z=5,confidence=1))
    db.add(BallPosition2D(match_id=match_id,frame=10,camera_index=0,x=370,y=260,visibility=1))
    db.commit()
    result = align_projection_to_2d(match_id,AlignPayload(frame=10,camera_index=0,direct=True,confirm=True),db)
    assert result['confirmed'] and result['point']['x'] == pytest.approx(.25)
    assert undo_projection_alignment(match_id,result['version_id'],db)['undone']
    db.close()

def test_fill_short_gap_undo_redo():
    db, match_id = setup()
    for frame, x in [(10,0),(13,.3)]:
        db.add(BallTraj(match_id=match_id,frame=frame,t_sec=frame/50,x=x,y=0,z=5,confidence=1))
    db.commit()
    result = fill_missing_3d(match_id, FillPayload(frame=11),db)
    assert result['created'] and result['method']=='short_interpolation'
    assert result['point']['x']==pytest.approx(.1)
    assert db.query(BallTraj).filter_by(match_id=match_id,frame=11).count()==1
    undone=undo_projection_alignment(match_id,result['version_id'],db)
    assert undone['deleted'] and db.query(BallTraj).filter_by(match_id=match_id,frame=11).count()==0
    redone=redo_projection_alignment(match_id,result['version_id'],db)
    assert redone['created'] and db.query(BallTraj).filter_by(match_id=match_id,frame=11).count()==1
    db.close()

def test_fill_rejects_existing_and_long_gap():
    db, match_id=setup()
    for frame in (10,20):
        db.add(BallTraj(match_id=match_id,frame=frame,t_sec=frame/50,x=0,y=0,z=5,confidence=1))
    db.commit()
    with pytest.raises(HTTPException) as exc:
        fill_missing_3d(match_id,FillPayload(frame=10),db)
    assert exc.value.status_code==409
    with pytest.raises(HTTPException) as exc:
        fill_missing_3d(match_id,FillPayload(frame=15),db)
    assert exc.value.status_code==422
    db.close()

def test_fill_redo_rejects_conflicting_new_point():
    db, match_id=setup()
    for frame in (10,12):
        db.add(BallTraj(match_id=match_id,frame=frame,t_sec=frame/50,x=0,y=0,z=5,confidence=1))
    db.commit()
    result=fill_missing_3d(match_id,FillPayload(frame=11),db)
    undo_projection_alignment(match_id,result['version_id'],db)
    db.add(BallTraj(match_id=match_id,frame=11,t_sec=.22,x=9,y=0,z=5,confidence=1))
    db.commit()
    with pytest.raises(HTTPException) as exc:
        redo_projection_alignment(match_id,result['version_id'],db)
    assert exc.value.status_code==409
    db.close()

def test_fill_multiview_from_2d_and_undo():
    from app.triangulation import project_raw_point
    db, match_id = setup()
    match=db.query(Match).first()
    cameras=[]
    for index, tx in enumerate([0,-1,1]):
        camera={'index':index,'projection':{'intrinsic':[1000,1000,320,240,0,0,0,0,0],
            'extrinsic':[[1,0,0,tx],[0,1,0,0],[0,0,1,0]],
            'useLensDistortion':False,'imageWidth':640,'imageHeight':480}}
        cameras.append(camera)
    match.cameras=cameras
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(match, 'cameras')
    real={'x':.2,'y':.1,'z':5.}
    for camera in cameras:
        pixel=project_raw_point(real,camera)
        db.add(BallPosition2D(match_id=match_id,frame=15,camera_index=camera['index'],
            x=pixel['x'],y=pixel['y'],visibility=1))
    db.commit()
    result=fill_missing_3d(match_id,FillPayload(frame=15),db)
    assert result['method']=='multi_view'
    assert result['point']['z']==pytest.approx(5.,abs=.001)
    undo_projection_alignment(match_id,result['version_id'],db)
    assert db.query(BallTraj).filter_by(match_id=match_id,frame=15).count()==0
    db.close()


def test_fill_single_view_estimated_depth():
    db, match_id=setup()
    db.add(BallTraj(match_id=match_id,frame=10,t_sec=.2,x=0,y=0,z=5,confidence=1))
    db.add(BallTraj(match_id=match_id,frame=12,t_sec=.24,x=.2,y=0,z=5,confidence=1))
    db.add(BallPosition2D(match_id=match_id,frame=11,camera_index=0,x=350,y=240,visibility=1))
    db.commit()
    result=fill_missing_3d(match_id,FillPayload(frame=11),db)
    assert result['method']=='single_view_depth'
    assert result['point']['x']==pytest.approx(.15)
    db.close()
