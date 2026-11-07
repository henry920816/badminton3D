import { multiViewConsistency, prepareReferences } from './epipolarGuide.js'

// 少於這麼多台有標註的格子不算：兩台只有一個交會點，談不上集中或分散
export const CONSISTENCY_MIN_VIEWS = 3


/**
 * 每一格的一致程度，[{ frame, value, viewCount }]。labels 是 rally 範圍的
 * 標註（只有看得見的），corrections 是 store 的 ball2DCorrections：
 * Map(cameraIndex → Map(frame → 修正))，修正成看不見的那台那格不算。
 */
export function computeConsistencyRows({
  labels,
  corrections,
  cameras,
  startFrame,
  endFrame,
}) {
  const paramsByCamera = new Map(
    (cameras || [])
      .filter(camera => camera?.projection?.intrinsic && camera?.projection?.extrinsic)
      .map(camera => [Number(camera.index), camera.projection]),
  )

  // frame → Map(cameraIndex → { u, v })
  const viewsByFrame = new Map()
  const viewsAt = frame => {
    if (!viewsByFrame.has(frame)) viewsByFrame.set(frame, new Map())
    return viewsByFrame.get(frame)
  }

  for (const label of labels) {
    viewsAt(label.frame).set(Number(label.camera_index), { u: Number(label.x), v: Number(label.y) })
  }

  for (const [cameraIndex, cameraCorrections] of corrections) {
    for (const correction of cameraCorrections.values()) {
      if (correction.frame < startFrame || correction.frame > endFrame) continue

      if (Number(correction.visibility) === 1) {
        viewsAt(correction.frame).set(cameraIndex, { u: Number(correction.x), v: Number(correction.y) })
      } else {
        viewsAt(correction.frame).delete(cameraIndex)
      }
    }
  }

  const rows = []

  for (const [frame, views] of viewsByFrame) {
    const prepared = prepareReferences(
      [...views]
        .filter(([cameraIndex]) => paramsByCamera.has(cameraIndex))
        .map(([cameraIndex, point]) => ({ cameraIndex, params: paramsByCamera.get(cameraIndex), ...point })),
    )

    if (prepared.length < CONSISTENCY_MIN_VIEWS) continue

    const value = multiViewConsistency(prepared)

    if (Number.isFinite(value)) rows.push({ frame, value, viewCount: prepared.length })
  }

  rows.sort((a, b) => a.frame - b.frame)

  return rows
}
