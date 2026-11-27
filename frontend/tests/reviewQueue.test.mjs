import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewQueue, isMissingReview } from '../src/utils/reviewQueue.js';

const cameras = [{ id: 'c1', index: 1 }, { id: 'c2', index: 2 }];
function row(frame, state, extra = {}, camera = 1) {
  return { frame, cameras: [{ camera_index: camera, review_status: state, ...extra }] };
}

test('相鄰異常跨少量空檔合併，但逐幀修正條件仍獨立', () => {
  const grid = [row(100, 'outside_view', { review_auto_allowed: true }),
    row(102, 'manual_review'), row(106, 'auto_fix', { review_auto_allowed: true })];
  const { events } = buildReviewQueue(grid, cameras);
  assert.equal(events.length, 1);
  assert.equal(events[0].span, 7);
  assert.equal(events[0].issueFrames, 3);
  assert.equal(events[0].autoCount, 1);
  assert.equal(events[0].outside, 1);
  assert.equal(events[0].position, 1);
  assert.equal(events[0].manual, 1);
});

test('不將跨越過長空檔與不同攝影機的異常合併', () => {
  const grid = [row(100, 'manual_review'), row(107, 'manual_review'),
    row(100, 'auto_fix', { review_auto_allowed: true }, 2)];
  assert.equal(buildReviewQueue(grid, cameras).events.length, 3);
});

test('預設清單隱藏可能漏標，但不丟失完整資料', () => {
  const grid = [row(100, 'manual_review', { status: 'no_data', review_issue_kind: 'missing_2d' }),
    row(101, 'manual_review', { status: 'bad' })];
  const hidden = buildReviewQueue(grid, cameras);
  assert.equal(hidden.hiddenMissing, 1);
  assert.equal(hidden.events[0].issueFrames, 1);
  const visible = buildReviewQueue(grid, cameras, { includeMissing: true });
  assert.equal(visible.events[0].issueFrames, 2);
  assert.equal(isMissingReview(grid[0].cameras[0]), true);
});

test('全覽保留可修正單點，略過零星人工提示', () => {
  const grid = [row(100, 'manual_review'), row(200, 'auto_fix', { review_auto_allowed: true })];
  const events = buildReviewQueue(grid, cameras).events;
  assert.equal(events.length, 2);
  assert.equal(events.filter(event => event.isFocus).length, 1);
  assert.equal(events.find(event => event.isFocus).start, 200);
});

test('長區段拆開，避免一個事件跨越整個 Rally', () => {
  const grid = Array.from({ length: 230 }, (_, i) => row(i, 'manual_review'));
  const events = buildReviewQueue(grid, cameras).events;
  assert.equal(events.length, 2);
  assert.equal(events[0].issueFrames + events[1].issueFrames, 230);
  assert.ok(events.every(event => event.span <= 180));
});


test('只剩單幀藍色，區段總覽仍必須顯示，才能讓使用者點選', () => {
  const queue = buildReviewQueue([row(100, 'outside_view', { review_auto_allowed: false })], cameras);
  assert.equal(queue.events.length, 1);
  assert.equal(queue.events[0].isFocus, true);
  assert.equal(queue.events[0].autoCount, 0);
});
