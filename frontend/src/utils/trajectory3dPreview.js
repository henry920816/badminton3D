/**
 * Display-only safety checks for candidate 3D paths.
 *
 * A 3D point triangulated from 2D is not necessarily a physically valid
 * neighbour of another independently triangulated point. Never connect review
 * points, discontinuities, hits, implausible speeds or obvious one-frame kinks.
 * Keeping the preview broken is deliberate; it does NOT fabricate a smooth path.
 */
export const PREVIEW_MAX_SPEED_MPS = 170;
export const PREVIEW_MAX_SECOND_DIFFERENCE_M = 0.4;
const finite = value => typeof value === 'number' && Number.isFinite(value);
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
export function buildSafePreviewSegments(points, hits = [], fps = 50) {
  const byFrame = new Map();
  for (const point of points || []) {
    if (point?.status === 'auto' && Number.isInteger(point.frame) && finite(point.x) && finite(point.y) && finite(point.z)) {
      byFrame.set(point.frame, {
        ...point,
        x: Number(point.x),
        y: Number(point.y),
        z: Number(point.z)
      });
    }
  }
  const sorted = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  const knownHits = new Set((hits || []).map(hit => typeof hit === 'number' ? hit : hit?.new_hit_frame ?? hit?.hit_frame).filter(Number.isInteger));
  const validFps = finite(fps) && Number(fps) > 0 ? Number(fps) : 50;
  const maxStep = PREVIEW_MAX_SPEED_MPS / validFps;
  const excludedFrames = new Set();
  const crossesHit = (a, b) => {
    for (const hit of knownHits) {
      if (a <= hit + 2 && b >= hit - 2) return true;
    }
    return false;
  };

  // Mark only the middle of a sharp isolated turn, not the whole flight.
  for (let index = 1; index + 1 < sorted.length; index += 1) {
    const prev = sorted[index - 1];
    const current = sorted[index];
    const next = sorted[index + 1];
    if (prev.frame + 1 !== current.frame || current.frame + 1 !== next.frame) continue;
    if (crossesHit(prev.frame, next.frame)) continue;
    const curvature = Math.hypot(prev.x - 2 * current.x + next.x, prev.y - 2 * current.y + next.y, prev.z - 2 * current.z + next.z);
    if (curvature > PREVIEW_MAX_SECOND_DIFFERENCE_M) excludedFrames.add(current.frame);
  }
  const segments = [];
  let currentSegment = [];
  const finish = () => {
    if (currentSegment.length >= 2) segments.push(currentSegment);
    currentSegment = [];
  };
  for (const point of sorted) {
    if (excludedFrames.has(point.frame)) {
      finish();
      continue;
    }
    const previous = currentSegment[currentSegment.length - 1];
    if (previous && (point.frame !== previous.frame + 1 || crossesHit(previous.frame, point.frame) || distance(previous, point) > maxStep)) {
      finish();
    }
    currentSegment.push(point);
  }
  finish();
  return {
    segments,
    excludedFrames
  };
}
