import { API_BASE } from '../config.js';

async function readResponse(response) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : data;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return data;
}

// 新修正規則：outside=藍色(隱藏)、position=紅色(投影座標)。
// dryRun=true 只取得候選數，不會修改資料庫。
export async function autoRepairBad2DFrames({
  matchId, startFrame, endFrame, onProgress, onConfirmed,
  dryRun = false, source = 'corrected', actionFilter = 'all', cameraIndexes = null,
}) {
  if (matchId == null || startFrame == null || endFrame == null) {
    throw new Error('缺少自動修正範圍');
  }
  onProgress?.({ current: 0, total: 1, frame: startFrame });
  const response = await fetch(`${API_BASE}/matches/${matchId}/traj2d/review-repair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start_frame: Number(startFrame), end_frame: Number(endFrame),
      mode: dryRun ? 'preview' : 'apply', action_filter: actionFilter, source,
      camera_indexes: cameraIndexes,
    }),
  });
  const data = await readResponse(response);
  if (!dryRun) {
    onConfirmed?.({ confirmed: true, ball_2d_points: data.ball_2d_points || [] });
  }
  onProgress?.({ current: 1, total: 1, frame: endFrame });
  return {
    preview: data.preview || [],
    candidatePoints: Number(data.candidate_points || 0),
    outsidePoints: Number(data.outside_points || 0),
    positionPoints: Number(data.position_points || 0),
    detectedFrames: Number(data.detected_bad_frames || 0),
    repairedFrames: Number(data.repaired_frames || 0),
    repairedPoints: Number(data.repaired_2d_points || 0),
    skippedFrames: Number(data.skipped_frames || 0),
    repairIds: data.repair_ids || [],
    frames: data.frames || [],
    dryRun: Boolean(data.dry_run),
  };
}
