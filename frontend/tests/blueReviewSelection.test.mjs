import test from 'node:test';
import assert from 'node:assert/strict';
import { findBlueRun, isBlueCell } from '../src/utils/blueReviewSelection.js';

function byFrame(data) {
  return new Map(data.map(([frame, c0, c1]) => [frame, new Map([
    [0, { review_status: c0 }], [1, { review_status: c1 }],
  ])]));
}

test('長按只取同一相機真正連續的藍色 frame', () => {
  const map = byFrame([[100, 'outside_view', 'outside_view'],
    [101, 'outside_view', 'normal'],
    [102, 'outside_view', 'outside_view'],
    [103, 'normal', 'outside_view'],
    [104, 'outside_view', 'outside_view']]);
  assert.deepEqual(findBlueRun(map, 0, 101, 100, 104), [100, 101, 102]);
  assert.deepEqual(findBlueRun(map, 1, 102, 100, 104), [102, 103, 104]);
  assert.deepEqual(findBlueRun(map, 0, 104, 100, 104), [104]);
});

test('缺幀不能跨越；總覽的 5 幀合併與長按刪除無關', () => {
  const map = byFrame([[100, 'outside_view', 'normal'],
    [102, 'outside_view', 'normal']]);
  assert.deepEqual(findBlueRun(map, 0, 100, 100, 105), [100]);
  assert.deepEqual(findBlueRun(map, 0, 102, 100, 105), [102]);
});

test('非藍色、未載入或無 2D 不執行刪除', () => {
  const map = byFrame([[100, 'normal', 'manual_review']]);
  assert.equal(isBlueCell(map.get(100).get(0)), false);
  assert.deepEqual(findBlueRun(map, 0, 100, 100, 102), []);
  assert.deepEqual(findBlueRun(map, 1, 101, 100, 102), []);
});

test('區段完整涵蓋可見範圍外的藍格，但不越過 Rally 邊界', () => {
  const map = byFrame(Array.from({ length: 7 }, (_, i) => [i + 100, 'outside_view', 'normal']));
  assert.deepEqual(findBlueRun(map, 0, 102, 101, 104), [101, 102, 103, 104]);
});

test('視野外和無投影的藍色可視為同一個連續人工處理區段', () => {
  const map = new Map([
    [100, new Map([[3, { review_status: 'outside_view', review_issue_kind: 'outside_view' }]])],
    [101, new Map([[3, { review_status: 'outside_view', review_issue_kind: 'missing_projection' }]])],
    [102, new Map([[3, { review_status: 'outside_view', review_issue_kind: 'missing_projection' }]])],
    [103, new Map([[3, { review_status: 'normal' }]])],
  ]);
  assert.deepEqual(findBlueRun(map, 3, 101, 100, 103), [100, 101, 102]);
});
