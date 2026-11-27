"""跨視角輔助的 2D 座標查詢，確認不會污染原始標註。"""
import unittest
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from app.models import Base, Match, BallPosition2D, BallPosition2DCorrection
from app.main import get_traj_2d_labels

@compiles(BigInteger, 'sqlite')
def compile_big_integer(_type, _compiler, **kwargs):
    return 'INTEGER'


class LabelEndpointTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite+pysqlite:///:memory:')
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        match = Match(title='label', fps=50.0, duration_frame=100, cameras=[])
        self.db.add(match)
        self.db.flush()
        self.match_id = match.id
        self.db.add(BallPosition2D(match_id=match.id, camera_index=1, frame=10, visibility=1, x=200, y=100))
        self.db.add(BallPosition2DCorrection(match_id=match.id, camera_index=1, frame=10, visibility=1, x=220, y=110))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_original_and_corrected_sources(self):
        raw = get_traj_2d_labels(self.match_id, 10, 10, self.db, 'original')
        changed = get_traj_2d_labels(self.match_id, 10, 10, self.db, 'corrected')
        self.assertEqual((raw[0]['x'], raw[0]['y']), (200, 100))
        self.assertEqual((changed[0]['x'], changed[0]['y']), (220, 110))

    def test_invisible_correction_excluded(self):
        correction = self.db.query(BallPosition2DCorrection).one()
        correction.visibility = 0
        self.db.commit()
        self.assertEqual(get_traj_2d_labels(self.match_id, 10, 10, self.db, 'corrected'), [])
        self.assertEqual(len(get_traj_2d_labels(self.match_id, 10, 10, self.db, 'original')), 1)


if __name__ == '__main__':
    unittest.main()
