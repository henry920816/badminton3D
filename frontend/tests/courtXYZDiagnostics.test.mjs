import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCourtXYZData,
  findCourtXYZReviewFrames,
  groupCourtXYZWarnings,
  xyzAxisBounds,
} from '../src/utils/courtXYZDiagnostics.js'

function point(x, y = 0, z = 0) { return { x, y, z } }

test('original trajectory and provisional two-view reconstruction are distinct data sources', () => {
  const traj = new Map([[10, point(1)], [11, point(2)]])
  const grid = [{ frame: 10, two_view_3d: { point: point(3) } }, { frame: 11, two_view_3d: null }]
  const rows = buildCourtXYZData(traj, grid, 10, 11)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].separation, 2)
  assert.equal(rows[1].stereo, null)
  assert.deepEqual(rows[0].original, point(1))
})

test('missing 3D does not invent any line position', () => {
  const rows = buildCourtXYZData(new Map(), [{ frame: 20, two_view_3d: null }], 20, 20)
  assert.deepEqual(rows, [])
})

test('detects isolated large position jump and subsequent return', () => {
  const traj = new Map([
    [10, point(0)], [11, point(0.1)], [12, point(8)],
    [13, point(0.3)], [14, point(0.4)],
  ])
  const rows = buildCourtXYZData(traj, [], 10, 14)
  assert.deepEqual(findCourtXYZReviewFrames(rows).map(i => i.frame), [12, 13])
})

test('detects two-view disagreement even if original 3D is smooth', () => {
  const traj = new Map([[0, point(0)], [1, point(0.1)], [2, point(0.2)]])
  const rows = buildCourtXYZData(traj, [{ frame: 1, two_view_3d: { point: point(5) } }], 0, 2)
  assert.deepEqual(findCourtXYZReviewFrames(rows).map(i => i.frame), [1])
})

test('missing adjacent frame must not be treated as one-frame jump', () => {
  const traj = new Map([[0, point(0)], [8, point(10)]])
  const rows = buildCourtXYZData(traj, [], 0, 8)
  assert.equal(findCourtXYZReviewFrames(rows).length, 0)
})

test('invalid nonfinite candidates are ignored', () => {
  const rows = buildCourtXYZData(new Map([[2, point(2)]]), [{ frame: 2, two_view_3d: { point: point(Infinity) } }], 2, 2)
  assert.equal(rows[0].stereo, null)
})

test('axis bounds include excursions', () => {
  const rows = [{ frame: 0, original: point(0), stereo: point(15) }]
  const [min, max] = xyzAxisBounds(rows, 'x')
  assert.ok(min < 0)
  assert.ok(max > 15)
})

test('review threshold is configurable and does not override status', () => {
  const rows = [{ frame: 1, original: point(0), stereo: point(0.7), separation: 0.7 }]
  assert.equal(findCourtXYZReviewFrames(rows).length, 0)
  assert.equal(findCourtXYZReviewFrames(rows, { disagreementM: 0.5 })[0].frame, 1)
  assert.ok(!Object.hasOwn(rows[0], 'status'))
})


test('consecutive suspicious frames are one review segment', () => {
  assert.deepEqual(groupCourtXYZWarnings([
    { frame: 5 }, { frame: 3 }, { frame: 4 }, { frame: 11 },
  ]), [
    { start: 3, end: 5, count: 3 },
    { start: 11, end: 11, count: 1 },
  ])
})
