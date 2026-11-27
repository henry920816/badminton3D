// 品質格從相機的真正 index 建立列順序，不用陣列位置或顯示名稱推算。
export function getQualityCameraRows(cameras) {
  const used = new Set();
  return (cameras || []).filter(camera => {
    const index = Number(camera?.index);
    if (!Number.isInteger(index) || index < 0 || used.has(index)) return false;
    used.add(index);
    return true;
  }).sort((a, b) => Number(a.index) - Number(b.index));
}

// 繪圖區可能被 CSS 縮放，滑鼠座標以實際畫面高度計算。
export function qualityGridHit(clientX, clientY, rect, rowCount, startFrame, frameCount) {
  if (!rect || rect.width <= 0 || rect.height <= 0 || rowCount <= 0 || frameCount <= 0) return null;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
  const rowIndex = Math.min(rowCount - 1, Math.floor(y / rect.height * rowCount));
  const frame = startFrame + Math.min(frameCount - 1, Math.floor(x / rect.width * frameCount));
  return { rowIndex, frame };
}
