// 每台相機的 2D 標註對照同幀原始 3D 投影。
// 連續偏離只能提示追蹤可能出錯，不能直接證明是隔壁場的球。
const goodPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function buildBall2DTrackRows(grid, cameraIndex) {
  const camera = Number(cameraIndex);
  if (!Number.isInteger(camera) || camera < 0) return [];
  const rows = [];
  for (const entry of grid || []) {
    const frame = Number(entry?.frame);
    if (!Number.isInteger(frame)) continue;
    const cell = (entry?.cameras || []).find(item => Number(item.camera_index) === camera);
    if (!cell) continue;
    const observed = goodPoint(cell.track_observed_2d) ? cell.track_observed_2d : null;
    const predicted = goodPoint(cell.track_original_3d_projected_2d) ? cell.track_original_3d_projected_2d : null;
    const error = observed && predicted ? distance(observed, predicted) : null;
    const peerCount = Number(cell.reference_3d_other_support_count) || 0;
    rows.push({
      frame,
      observed: observed ? {
        x: observed.x,
        y: observed.y
      } : null,
      projected: predicted ? {
        x: predicted.x,
        y: predicted.y
      } : null,
      errorPx: error,
      peerCount,
      independentlySupported: cell.reference_3d_independently_supported === true && peerCount >= 3,
      status: cell.status || 'unknown'
    });
  }
  return rows.sort((a, b) => a.frame - b.frame);
}

// 只有其他相機支持 3D 時，才把連續偏離列為待檢查。
// 一直偏離也可能是同步或校正問題，不能直接當成換球。
export function detectBall2DTrackReviewSegments(rows, options = {}) {
  const threshold = Number.isFinite(options.thresholdPx) && options.thresholdPx > 0 ? options.thresholdPx : 30;
  const matchThreshold = Number.isFinite(options.matchPx) && options.matchPx >= 0 ? options.matchPx : 15;
  const minRun = Number.isInteger(options.minRunFrames) && options.minRunFrames > 0 ? options.minRunFrames : 3;
  const ordered = [...(rows || [])].sort((a, b) => a.frame - b.frame);
  const segments = [];
  let start = -1;
  const flush = endIndex => {
    if (start < 0 || endIndex < start) return;
    const length = endIndex - start + 1;
    const run = ordered.slice(start, endIndex + 1);
    const maxErrorPx = Math.max(...run.map(r => r.errorPx));
    // 一般偏離要連續出現；單幀超大誤差也值得人工檢查。
    if (length < minRun && maxErrorPx < 100) return;
    const before = ordered.slice(Math.max(0, start - 6), start);
    const recentlyMatched = before.some(r => r.observed && r.projected && r.independentlySupported && r.errorPx <= matchThreshold && ordered[start].frame - r.frame <= 6);
    const lastMatching = [...before].reverse().find(r => r.independentlySupported && r.errorPx !== null && r.errorPx <= matchThreshold);
    const first = run[0];
    const prev = ordered[start - 1];
    const abruptJump = Boolean(prev && prev.frame === first.frame - 1 && prev.observed && first.observed && prev.projected && first.projected && distance(first.observed, prev.observed) > Math.max(55, 3 * distance(first.projected, prev.projected) + 25));
    const kind = length < minRun ? 'isolated_outlier' : recentlyMatched ? 'possible_track_switch' : 'sustained_disagreement';
    segments.push({
      startFrame: first.frame,
      endFrame: run[run.length - 1].frame,
      frames: length,
      maxErrorPx,
      peakFrame: run.reduce((best, row) => row.errorPx > best.errorPx ? row : best).frame,
      kind,
      abruptJump,
      previousMatchFrame: lastMatching?.frame ?? null,
      minOtherCameras: Math.min(...run.map(r => r.peerCount)),
      label: kind === 'possible_track_switch' ? '疑似追蹤切換' : kind === 'sustained_disagreement' ? '持續偏離（追錯球／校正待查）' : '單幀明顯偏離'
    });
  };
  for (let i = 0; i <= ordered.length; i++) {
    const row = ordered[i];
    const previous = ordered[i - 1];
    const contiguous = start >= 0 && row && previous && row.frame === previous.frame + 1;
    const bad = row && row.observed && row.projected && row.independentlySupported && row.errorPx !== null && row.errorPx > threshold;
    if (start >= 0 && (!contiguous || !bad)) {
      flush(i - 1);
      start = -1;
    }
    if (bad && start < 0) start = i;
  }
  return segments;
}
export function ball2DTrackAxisBounds(rows, axis) {
  const values = [];
  for (const row of rows || []) {
    for (const point of [row.observed, row.projected]) {
      if (Number.isFinite(point?.[axis])) values.push(point[axis]);
    }
  }
  if (!values.length) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(12, (max - min) * 0.08);
  return [min - pad, max + pad];
}

// 繪圖只連相鄰幀；缺幀就分段，不補線也不補標註。
export function groupContinuousTrackSegments(rows, source = 'observed') {
  if (source !== 'observed' && source !== 'projected') return [];
  const groups = [];
  let current = [];
  for (const row of [...(rows || [])].sort((a, b) => a.frame - b.frame)) {
    const point = row?.[source];
    if (!goodPoint(point) || !Number.isInteger(row.frame)) {
      current = [];
      continue;
    }
    const last = current[current.length - 1];
    if (!last || row.frame !== last.frame + 1) {
      current = [];
      groups.push(current);
    }
    current.push({
      frame: row.frame,
      x: point.x,
      y: point.y
    });
  }
  return groups;
}
