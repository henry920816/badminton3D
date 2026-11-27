import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECTION_ERROR_COLORS, hasOriginal3DFields,
  qualityCellPresentation, selectProjectionEvidence,
} from '../src/utils/qualityProjectionColor.js';

function cell(state, options = {}) {
  return {
    status: 'unknown', review_status: state,
    review_error_px: options.errorPx ?? null,
    review_independent_support: options.supported ?? false,
    review_auto_allowed: options.auto ?? false,
    review_action: options.action ?? 'none',
    review_reason: options.reason ?? '測試訊息',
    reference_3d_error_px: options.errorPx ?? null,
  };
}

test('≤20px 正常顯示無色、不畫綠色', () => {
  const actual = qualityCellPresentation(cell('normal', { errorPx: 20 }));
  assert.equal(actual.color, PROJECTION_ERROR_COLORS.normal);
  assert.equal(actual.isRed, false);
  assert.equal(actual.isBlue, false);
});

test('20~50px 黃色', () => {
  assert.equal(qualityCellPresentation(cell('minor', { errorPx: 45 })).color,
    PROJECTION_ERROR_COLORS.moderate);
});

test('紅色代表可自動修正位置，不能只靠 pixel 大小', () => {
  const actual = qualityCellPresentation(cell('auto_fix', { errorPx: 160, auto: true, action: 'move_to_3d' }));
  assert.equal(actual.isRed, true);
  assert.equal(actual.autoAllowed, true);
  assert.equal(actual.action, 'move_to_3d');
  assert.equal(actual.color, PROJECTION_ERROR_COLORS.bad);
  assert.equal(qualityCellPresentation(cell('manual_review', { errorPx: 999 })).isRed, false);
});

test('紫色代表需要人工，不等於錯誤比較大', () => {
  const actual = qualityCellPresentation(cell('manual_review', { errorPx: 150 }));
  assert.equal(actual.color, PROJECTION_ERROR_COLORS.purple);
  assert.equal(actual.isPurple, true);
});

test('藍色代表視野外或沒有投影，操作仍由人工確認', () => {
  const safe = qualityCellPresentation(cell('outside_view', { auto: true, action: 'hide_2d' }));
  const uncertain = qualityCellPresentation(cell('outside_view', { auto: false, action: 'review' }));
  assert.equal(safe.color, PROJECTION_ERROR_COLORS.outside);
  assert.equal(safe.isBlue, true);
  assert.equal(safe.autoAllowed, true);
  assert.equal(uncertain.isBlue, true);
  assert.equal(uncertain.autoAllowed, false);
});

test('沒有 2D 標註，正常維持深灰', () => {
  assert.equal(qualityCellPresentation({ ...cell('normal'), status: 'no_data' }).color,
    PROJECTION_ERROR_COLORS.missing);
});

test('未升級的後端不可當成紫色或藍色', () => {
  const actual = qualityCellPresentation({ status: 'bad', reference_3d_error_px: null });
  assert.equal(actual.backendMismatch, true);
  assert.equal(actual.isBlue, false);
  assert.equal(actual.isPurple, false);
});

test('原始 3D 實際投影誤差仍保留在詳細檢視', () => {
  assert.equal(hasOriginal3DFields({ reference_3d_error_px: null }), true);
  assert.equal(hasOriginal3DFields({}), false);
  assert.equal(selectProjectionEvidence({ reference_3d_error_px: 0 }).errorPx, 0);
});

test('無投影仍顯示藍色，且保留無投影原因供人工辨識', () => {
  const unknown = qualityCellPresentation({ ...cell('outside_view'), review_projection_kind: 'unavailable' });
  assert.equal(unknown.isBlue, true);
  assert.equal(unknown.color, PROJECTION_ERROR_COLORS.outside);
  assert.equal(unknown.autoAllowed, false);
  assert.equal(unknown.noProjection, true);
});
