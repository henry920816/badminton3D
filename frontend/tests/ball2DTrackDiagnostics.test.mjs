import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBall2DTrackRows,
  detectBall2DTrackReviewSegments,
  ball2DTrackAxisBounds,
} from '../src/utils/ball2DTrackDiagnostics.js'

const row = (frame, observedX, projectedX, opts = {}) => ({
  frame,
  cameras: [{ camera_index: 2, status: 'ok',
    track_observed_2d: observedX === null ? null : { x: observedX, y: 10 },
    track_original_3d_projected_2d: projectedX === null ? null : { x: projectedX, y: 10 },
    reference_3d_independently_supported: opts.supported ?? true,
    reference_3d_other_support_count: opts.count ?? 3,
  }],
})

function series(errors, opts = {}) {
  return buildBall2DTrackRows(errors.map((value, index) =>
    row(index, value === null ? null : 100 + value, 100, opts),
  ), 2)
}

test('actual camera 2D XY coordinates and original 3D projected XY are separated', () => {
  const rows = buildBall2DTrackRows([row(20, 123, 100)], 2)
  assert.deepEqual(rows[0].observed, { x: 123, y: 10 })
  assert.deepEqual(rows[0].projected, { x: 100, y: 10 })
  assert.equal(rows[0].errorPx, 23)
})

test('smooth but WRONG tracking over 20 frames is identified as sustained deviation', () => {
  const rows = series(Array(20).fill(75))
  const segments = detectBall2DTrackReviewSegments(rows)
  assert.equal(segments.length, 1)
  assert.equal(segments[0].kind, 'sustained_disagreement')
  assert.equal(segments[0].endFrame, 19)
})

test('correct track followed by several frames of wrong-ball labels is possible switch', () => {
  const rows = series([1, 2, 2, 3, 110, 112, 115, 120, 2])
  const segments = detectBall2DTrackReviewSegments(rows)
  assert.equal(segments.length, 1)
  assert.equal(segments[0].kind, 'possible_track_switch')
  assert.equal(segments[0].startFrame, 4)
  assert.equal(segments[0].endFrame, 7)
})

test('without independent peer cameras, high pixel mismatch cannot claim target-switch evidence', () => {
  assert.deepEqual(detectBall2DTrackReviewSegments(series(Array(20).fill(500), { supported: false })), [])
})

test('only 2 peer cameras is insufficient for high-priority warning', () => {
  assert.deepEqual(detectBall2DTrackReviewSegments(series(Array(10).fill(80), { count: 2 })), [])
})

test('one gigantic isolated error may be reviewed; small isolated noise ignored', () => {
  assert.equal(detectBall2DTrackReviewSegments(series([2, 3, 102, 2]))[0].kind, 'isolated_outlier')
  assert.deepEqual(detectBall2DTrackReviewSegments(series([2, 3, 42, 2])), [])
})

test('missing projection and missing observation are not interchangeable with zero pixels', () => {
  const rows = buildBall2DTrackRows([row(0, 0, null), row(1, null, 0), row(2, 0, 0)], 2)
  assert.equal(rows[0].projected, null)
  assert.equal(rows[1].observed, null)
  assert.equal(rows[2].errorPx, 0)
  assert.deepEqual(detectBall2DTrackReviewSegments(rows), [])
})

test('loss of independently supported projection breaks consecutive run', () => {
  const rows = series([75, 75, 75, 75, 75])
  rows[2].projected = null
  rows[2].errorPx = null
  assert.deepEqual(detectBall2DTrackReviewSegments(rows), [])
})

test('50-frame gap in input does not invent a continuous review period', () => {
  const rows = series([50, 50, 50, 50])
  rows[2].frame = 55
  rows[3].frame = 56
  assert.deepEqual(detectBall2DTrackReviewSegments(rows), [])
})

test('axis bounds support negative coordinates and completely missing data', () => {
  const rows = [{ frame: 0, observed: { x: -10, y: 3 }, projected: { x: 20, y: 4 } }]
  assert.ok(ball2DTrackAxisBounds(rows, 'x')[0] < -10)
  assert.ok(ball2DTrackAxisBounds(rows, 'x')[1] > 20)
  assert.deepEqual(ball2DTrackAxisBounds([], 'x'), [0, 1])
})
