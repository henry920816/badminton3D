import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupContinuousTrackSegments } from '../src/utils/ball2DTrackDiagnostics.js'

const p = (x, y) => ({ x, y })
const row = (frame, observed, projected = null) => ({ frame, observed, projected })

test('相鄰影格連線，缺一格也要斷開（維持使用者要求的舊版行為）', () => {
  const result = groupContinuousTrackSegments([
    row(10, p(5, 6)), row(11, p(6, 7)), row(13, p(8, 9)), row(20, p(20, 30)),
  ])
  assert.deepEqual(result.map(group => group.map(item => item.frame)), [[10, 11], [13], [20]])
})

test('2D 無標註時斷線，不拿下一幀補畫', () => {
  const result = groupContinuousTrackSegments([
    row(1, p(2, 3)), row(2, null), row(3, p(6, 7)),
  ])
  assert.deepEqual(result.map(group => group.map(item => item.frame)), [[1], [3]])
})

test('原始 3D 投影和 2D 標註不混用', () => {
  const rows = [row(1, p(2, 3), p(10, 11)), row(2, null, p(12, 13))]
  assert.deepEqual(groupContinuousTrackSegments(rows, 'observed').map(x => x.length), [1])
  assert.deepEqual(groupContinuousTrackSegments(rows, 'projected').map(x => x.length), [2])
})

test('座標 0 可以畫，NaN 不可畫', () => {
  const result = groupContinuousTrackSegments([
    row(4, p(0, 0)), row(5, p(NaN, 1)), row(6, p(1, 2)),
  ])
  assert.deepEqual(result.map(x => x[0].frame), [4, 6])
})

test('空資料和錯誤的資料來源不會造成錯誤', () => {
  assert.deepEqual(groupContinuousTrackSegments([]), [])
  assert.deepEqual(groupContinuousTrackSegments([row(1, p(1, 2))], 'invalid'), [])
})
