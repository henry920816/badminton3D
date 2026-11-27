// 找同一台相機真正「逐幀連續」的藍色。不要套用品質總覽的缺幀合併。
export function isBlueCell(cell) {
  return cell?.review_status === 'outside_view';
}

export function findBlueRun(cellsByFrame, cameraIndex, frame, minFrame, maxFrame) {
  const isBlue = value => isBlueCell(cellsByFrame.get(value)?.get(cameraIndex));
  if (!isBlue(frame)) return [];
  let first = frame;
  let last = frame;
  while (first > minFrame && isBlue(first - 1)) first -= 1;
  while (last < maxFrame && isBlue(last + 1)) last += 1;
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}
