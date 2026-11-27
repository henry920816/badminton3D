// 顏色是「下一步怎麼處理」，不是單純拿投影誤差塗色。
// 藍色：缺少投影卻有 2D，或畫面外且離投影至少 50px。可一鍵批次消除，或雙擊／長按個別處理。
export const PROJECTION_ERROR_COLORS = Object.freeze({
  normal: 'rgba(24,24,27,0.18)',
  excellent: '#22c55e',
  moderate: '#eab308',
  warning: '#f97316',
  bad: '#ef4444',
  purple: '#a855f7',
  outside: '#38bdf8',
  missing: 'rgba(63,63,70,0.42)',
  unverified: 'rgba(113,113,122,0.62)',
});

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isError = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function hasOriginal3DFields(entry) {
  return Boolean(entry && own(entry, 'reference_3d_error_px'));
}

export function selectProjectionEvidence(entry) {
  if (!entry || !isError(entry.reference_3d_error_px)) return null;
  const supported = entry.reference_3d_independently_supported === true;
  return {
    errorPx: entry.reference_3d_error_px,
    source: 'original_3d',
    sourceLabel: supported ? '原始 3D 投影（其他視角佐證）' : '原始 3D 投影（未獲充分佐證）',
    supported,
  };
}

// 保留原工具函式供舊圖表與測試使用；品質色塊不再使用它。
export function projectionErrorColor(errorPx) {
  if (!isError(errorPx)) return PROJECTION_ERROR_COLORS.unverified;
  if (errorPx <= 20) return PROJECTION_ERROR_COLORS.normal;
  if (errorPx <= 50) return PROJECTION_ERROR_COLORS.moderate;
  if (errorPx <= 100) return PROJECTION_ERROR_COLORS.purple;
  return PROJECTION_ERROR_COLORS.bad;
}

export function qualityCellPresentation(entry) {
  const state = entry?.review_status;
  const errorPx = isError(entry?.review_error_px) ? entry.review_error_px : null;
  const supported = entry?.review_independent_support === true;
  const basic = {
    errorPx,
    source: 'original_3d',
    sourceLabel: entry?.review_reason || '',
    supported,
    isRed: state === 'auto_fix',
    isBlue: state === 'outside_view',
    isPurple: state === 'manual_review',
    noProjection: entry?.review_projection_kind === 'unavailable',
    backendMismatch: false,
    autoAllowed: entry?.review_auto_allowed === true,
    action: entry?.review_action || 'none',
    state: state || 'unknown',
  };
  if (!entry) return { ...basic, color: PROJECTION_ERROR_COLORS.missing, sourceLabel: '無資料' };
  if (!own(entry, 'review_status')) {
    return { ...basic, color: PROJECTION_ERROR_COLORS.unverified,
      backendMismatch: true, sourceLabel: '後端尚未更新新版品質檢查邏輯' };
  }
  const colors = {
    normal: entry.status === 'no_data' ? PROJECTION_ERROR_COLORS.missing : PROJECTION_ERROR_COLORS.normal,
    minor: PROJECTION_ERROR_COLORS.moderate,
    auto_fix: PROJECTION_ERROR_COLORS.bad,
    manual_review: PROJECTION_ERROR_COLORS.purple,
    outside_view: PROJECTION_ERROR_COLORS.outside,
  };
  return { ...basic, color: colors[state] || PROJECTION_ERROR_COLORS.unverified };
}
