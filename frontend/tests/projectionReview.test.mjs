import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectionIssues } from '../src/utils/projectionReview.js';
const cell = (frame, extra) => ({ frame, cameras: [{ camera_index: 3, review_projection_kind: 'inside', review_observed_2d: {x:10,y:20}, review_projected_2d: {x: 90, y:20}, review_error_px: 80, ...extra }] });
test('only differences above threshold are returned', () => {
  assert.equal(buildProjectionIssues([cell(10)], 80).length, 0);
  assert.equal(buildProjectionIssues([cell(10)], 50)[0].type, 'large_error');
});
test('missing projection is visible without numeric distance', () => {
  const row = cell(11, {review_projection_kind: 'unavailable', review_projected_2d: null, review_error_px:null});
  assert.equal(buildProjectionIssues([row])[0].type, 'missing_projection');
});
test('no 2D point is not a difference', () => {
  assert.equal(buildProjectionIssues([cell(12, {review_observed_2d:null})]).length, 0);
});
test('outside projection is ranked before pixel discrepancies', () => {
  const outside = cell(13, {review_projection_kind:'outside',review_issue_kind:'outside_view'});
  assert.equal(buildProjectionIssues([cell(12),outside])[0].frame, 13);
});
