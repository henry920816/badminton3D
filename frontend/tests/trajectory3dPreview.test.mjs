import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSafePreviewSegments } from '../src/utils/trajectory3dPreview.js'

const p = (frame, x, status = 'auto') => ({ frame, x, y: 0, z: 2, status })

test('uncertain review points are NEVER part of green polylines', () => {
  const report = buildSafePreviewSegments([p(1, 0), p(2, 0.1, 'review'), p(3, 0.2)])
  assert.equal(report.segments.length, 0)
})

test('consecutive verified candidates make one green segment', () => {
  const report = buildSafePreviewSegments([p(1, 0), p(2, 0.1), p(3, 0.2)])
  assert.deepEqual(report.segments.map(s => s.map(p => p.frame)), [[1, 2, 3]])
})

test('missing frames break candidate paths rather than bridging occlusions', () => {
  const report = buildSafePreviewSegments([p(1, 0), p(2, 0.1), p(5, 0.2), p(6, 0.3)])
  assert.deepEqual(report.segments.map(s => s.map(p => p.frame)), [[1, 2], [5, 6]])
})

test('hit frames break candidate paths', () => {
  const report = buildSafePreviewSegments([
    p(1, 0), p(2, 0.1), p(3, 0.2), p(4, 0.3), p(5, 0.4), p(6, 0.5), p(7, 0.6), p(8, 0.7)
  ], [{ hit_frame: 5 }])
  assert.deepEqual(report.segments.map(s => s.map(p => p.frame)), [[1, 2]])
})

test('unphysically large point jumps do not form green lines', () => {
  const report = buildSafePreviewSegments([p(1, 0), p(2, 4.5), p(3, 4.6)], [], 50)
  assert.equal(report.segments.length, 0)
})

test('one-frame sharp zigzags are not connected', () => {
  const report = buildSafePreviewSegments([
    p(1, 0), p(2, 0.1), p(3, 0.9), p(4, 0.3), p(5, 0.4),
  ])
  assert.equal(report.excludedFrames.has(3), true)
  assert.equal(report.segments.flat().some(p => p.frame === 3), false)
})
