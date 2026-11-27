// 全覽色塊整理同一視角、時間接近的異常；逐幀品質結果不受影響。
// 合併間隔不代表那些影格已被修正，也不會用合併結果判斷能否自動套用。
const TYPES = ['outside_view', 'auto_fix', 'manual_review'];

export function isMissingReview(cell) {
  return cell?.review_status === 'manual_review' && (
    cell?.review_issue_kind === 'missing_2d' ||
    (cell?.review_issue_kind == null && cell?.status === 'no_data')
  );
}

function priority(event) {
  if (event.outside > 0) return 0;
  if (event.autoPosition > 0) return 1;
  return 2;
}

function addCell(event, cell, frame) {
  const type = cell.review_status;
  event.end = frame;
  event.lastIssueFrame = frame;
  event.issueFrames++;
  if (type === 'outside_view') {
    event.outside++;
  } else if (type === 'auto_fix') {
    event.position++;
    if (cell.review_auto_allowed === true) event.autoPosition++;
  } else {
    event.manual++;
  }
  if (Number.isFinite(cell.review_error_px)) {
    event.maxError = Math.max(event.maxError, cell.review_error_px);
  }
}

export function buildReviewQueue(grid, cameras, {
  gapFrames = 5, maxSpanFrames = 180, includeMissing = false,
} = {}) {
  const camRows = new Map((cameras || []).map(camera => [Number(camera.index), []]));
  let hiddenMissing = 0;
  for (const row of grid || []) {
    const frame = Number(row.frame);
    if (!Number.isFinite(frame)) continue;
    for (const cell of row.cameras || []) {
      if (!TYPES.includes(cell.review_status)) continue;
      if (isMissingReview(cell) && !includeMissing) {
        hiddenMissing++;
        continue;
      }
      const index = Number(cell.camera_index);
      if (!camRows.has(index)) continue;
      camRows.get(index).push({ frame, cell });
    }
  }
  const result = [];
  for (const camera of cameras || []) {
    const index = Number(camera.index);
    const items = camRows.get(index) || [];
    items.sort((a, b) => a.frame - b.frame);
    let pending = null;
    for (const { frame, cell } of items) {
      if (!pending || frame - pending.lastIssueFrame > gapFrames + 1 ||
        frame - pending.start + 1 > maxSpanFrames) {
        if (pending) result.push(pending);
        pending = {
          cameraIndex: index, cameraId: camera.id, start: frame, end: frame,
          lastIssueFrame: frame, issueFrames: 0, outside: 0, position: 0,
          manual: 0, autoPosition: 0, maxError: 0,
        };
      }
      addCell(pending, cell, frame);
    }
    if (pending) result.push(pending);
  }
  for (const event of result) {
    event.id = `${event.cameraIndex}:${event.start}:${event.end}`;
    event.primaryState = event.outside > 0 ? 'outside_view' :
      event.position > 0 ? 'auto_fix' : 'manual_review';
    event.autoCount = event.autoPosition;
    event.priority = priority(event);
    event.isFocus = event.outside > 0 || event.autoCount > 0 || event.issueFrames >= 3;
    event.span = event.end - event.start + 1;
  }
  result.sort((a, b) => a.priority - b.priority ||
    b.issueFrames - a.issueFrames || b.autoCount - a.autoCount ||
    a.start - b.start || a.cameraIndex - b.cameraIndex);
  return { events: result, hiddenMissing };
}

