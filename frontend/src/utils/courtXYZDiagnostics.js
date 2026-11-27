/**
 * Compare the original 3D ball track with the provisional 3D triangulated
 * from two independently vetted 2D annotations by the quality-grid backend.
 * A discontinuity is evidence for review, NOT proof of a neighboring-court ball.
 */
const AXES = ['x', 'y', 'z'];
const validPoint = point => Boolean(point && AXES.every(axis => typeof point[axis] === 'number' && Number.isFinite(point[axis])));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function normalizedFrame(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}
function originalForFrame(trajByFrame, frame) {
  if (trajByFrame instanceof Map) return trajByFrame.get(frame);
  if (trajByFrame && typeof trajByFrame === 'object') return trajByFrame[frame];
  return null;
}
export function buildCourtXYZData(trajByFrame, grid, startFrame, endFrame) {
  const start = normalizedFrame(startFrame);
  const end = normalizedFrame(endFrame);
  if (start === null || end === null || end < start) return [];
  const provisional = new Map();
  for (const row of grid || []) {
    const frame = normalizedFrame(row?.frame);
    const candidate = row?.two_view_3d;
    if (frame === null || !validPoint(candidate?.point)) continue;
    // These are only geometrically plausible; they are not an image-confirmed truth.
    provisional.set(frame, candidate.point);
  }
  const result = [];
  for (let frame = start; frame <= end && result.length < 6001; frame++) {
    const old = originalForFrame(trajByFrame, frame);
    const temp = provisional.get(frame);
    if (!validPoint(old) && !validPoint(temp)) continue;
    result.push({
      frame,
      original: validPoint(old) ? {
        x: old.x,
        y: old.y,
        z: old.z
      } : null,
      stereo: validPoint(temp) ? {
        x: temp.x,
        y: temp.y,
        z: temp.z
      } : null,
      separation: validPoint(old) && validPoint(temp) ? distance(old, temp) : null
    });
  }
  return result;
}
function median(values) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * Only return review candidates: large original-track jumps, agreement gaps,
 * or disagreement with a two-view reconstruction. Real smashes/hits can also
 * create fast movement; none of these candidates should auto-change 2D labels.
 */
export function findCourtXYZReviewFrames(rows, options = {}) {
  const minJumpM = options.minJumpM ?? 1.6;
  const disagreementM = options.disagreementM ?? 1.8;
  const maxReview = options.maxReview ?? 1200;
  const ordered = [...(rows || [])].sort((a, b) => a.frame - b.frame);
  const steps = [];
  for (let i = 1; i < ordered.length; i++) {
    const before = ordered[i - 1];
    const after = ordered[i];
    if (after.frame !== before.frame + 1 || !before.original || !after.original) continue;
    steps.push(distance(before.original, after.original));
  }
  // Use the smaller half of steps as the normal-motion baseline. A short
  // neighboring-court switch can dominate the ordinary median.
  const sortedSteps = steps.slice().sort((a, b) => a - b);
  const normalSteps = sortedSteps.slice(0, Math.max(1, Math.ceil(sortedSteps.length / 2)));
  const typicalStep = median(normalSteps);
  const threshold = Math.max(minJumpM, typicalStep * 7);
  const output = [];
  for (let i = 0; i < ordered.length && output.length < maxReview; i++) {
    const row = ordered[i];
    const previous = ordered[i - 1];
    const sameStep = previous && row.frame === previous.frame + 1;
    const jump = sameStep && previous.original && row.original ? distance(previous.original, row.original) : null;
    const separation = row.separation;
    const jumpFlag = jump !== null && jump > threshold;
    const separationFlag = separation !== null && separation > disagreementM;
    if (!jumpFlag && !separationFlag) continue;
    output.push({
      frame: row.frame,
      jumpM: jumpFlag ? jump : null,
      separationM: separationFlag ? separation : null,
      reason: [...(jumpFlag ? [`原始 3D 相鄰幀跳動 ${jump.toFixed(2)} m`] : []), ...(separationFlag ? [`原始 / 雙視角 3D 分歧 ${separation.toFixed(2)} m`] : [])].join('；')
    });
  }
  return output;
}
export function xyzAxisBounds(rows, axis) {
  const values = [];
  for (const row of rows || []) {
    if (Number.isFinite(row.original?.[axis])) values.push(row.original[axis]);
    if (Number.isFinite(row.stereo?.[axis])) values.push(row.stereo[axis]);
  }
  if (!values.length) return [-1, 1];
  // Preserve even extreme jumps: the graph is for noticing abrupt excursions.
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max(0.2, (high - low) * 0.08);
  return [low - padding, high + padding];
}

/** Combine consecutive warnings so a 40-frame wrong-track segment is one review item. */
export function groupCourtXYZWarnings(warnings) {
  const sorted = [...(warnings || [])].sort((a, b) => a.frame - b.frame);
  const groups = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && item.frame <= last.end + 1) {
      last.end = Math.max(last.end, item.frame);
      last.count += 1;
      continue;
    }
    groups.push({
      start: item.frame,
      end: item.frame,
      count: 1
    });
  }
  return groups;
}
