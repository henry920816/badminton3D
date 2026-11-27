export function buildProjectionIssues(grid, minimumError = 50) {
  const result = [];
  for (const row of grid || []) {
    for (const cell of row.cameras || []) {
      const observed = cell.review_observed_2d;
      const projection = cell.review_projected_2d;
      const kind = cell.review_projection_kind;
      const error = Number(cell.review_error_px);
      const hasError = cell.review_error_px != null && Number.isFinite(error);
      let type = null;
      if (observed && kind === 'unavailable') type = 'missing_projection';
      else if (observed && kind === 'outside' && cell.review_issue_kind === 'outside_view') type = 'outside_view';
      else if (observed && kind === 'outside' && cell.review_issue_kind === 'missing_projection') type = 'missing_projection';
      else if (observed && kind === 'outside' && (!projection || (hasError && error >= 50))) type = 'outside_view';
      else if (observed && projection && hasError && error > minimumError) type = 'large_error';
      if (!type) continue;
      result.push({
        frame: Number(row.frame), cameraIndex: Number(cell.camera_index),
        error: hasError ? error : null, type, observed, projection,
        projectionKind: kind, reason: cell.review_reason || '',
        status: cell.review_status || '',
      });
    }
  }
  const rank = { missing_projection: 0, outside_view: 1, large_error: 2 };
  return result.sort((a, b) => rank[a.type] - rank[b.type] || (b.error ?? -1) - (a.error ?? -1) || a.frame - b.frame || a.cameraIndex - b.cameraIndex);
}
export const projectionIssueLabel = type => ({ missing_projection: '無有效投影、有 2D', outside_view: '3D 投影在視野外', large_error: '像素距離過大' }[type] || type);
