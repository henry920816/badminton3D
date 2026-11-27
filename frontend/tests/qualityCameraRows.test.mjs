import test from 'node:test';
import assert from 'node:assert/strict';
import { getQualityCameraRows, qualityGridHit } from '../src/utils/qualityCameraRows.js';

test('品質列永遠對應相機 index，不受傳入順序和舊 label 影響', () => {
  const rows = getQualityCameraRows([
    { id: 'cam4', index: 4, label: '舊 Cam 1' },
    { id: 'cam0', index: 0, label: '舊 Cam 5' },
    { id: 'cam2', index: 2 },
  ]);
  assert.deepEqual(rows.map(row => row.index), [0, 2, 4]);
  assert.deepEqual(rows.map(row => row.id), ['cam0', 'cam2', 'cam4']);
});

test('縮放後點各列都正確對應；靠近最底下是最後一列', () => {
  const rect = { left: 100, top: 50, width: 800, height: 143 };
  assert.deepEqual(qualityGridHit(500, 51, rect, 10, 1000, 100), { rowIndex: 0, frame: 1050 });
  assert.deepEqual(qualityGridHit(500, 51 + 143 * 0.49, rect, 10, 1000, 100), { rowIndex: 4, frame: 1050 });
  assert.deepEqual(qualityGridHit(500, 192, rect, 10, 1000, 100), { rowIndex: 9, frame: 1050 });
  assert.equal(qualityGridHit(500, 193, rect, 10, 1000, 100), null);
});
