import { imagePointToRay, project3DToImage } from './cameraProjection.js'

/*
 * 2D 修正的參考視角導引：其他相機在這格的標註，各自的視線投影到目前
 * 這台就是一條極線，羽球應該落在線上；幾條線的交會處就是和所有參考
 * 都合得來的位置。
 *
 * 只有一台參考時，畫面上任何一點只要落在極線上，和它三角化的誤差都
 * 是 0，沒有單一最低點；兩台以上，參考視線彼此三角化出的 3D 點投影到
 * 這台就是誤差最低點。
 *
 * 誤差是「這一點的視線加上所有參考視線」三角化（離所有視線距離平方和
 * 最小的點）後，投影回每一台（含這台）和該台點位差距的 RMS，單位 px。
 */

// 極線只畫在球可能出現的範圍。座標同 ball_traj 的 raw：y 朝下、地板
// 約在 y = 0.5，x 是球場寬（半寬 3.05 m）、z 是球場長（半長 6.7 m），
// 四周多留一點界外
const VOLUME = {
  minX: -5, maxX: 5,
  minY: -10, maxY: 1,
  minZ: -9, maxZ: 9,
}

// 極線沿參考視線取樣的距離（公尺）與間隔：鏡頭畸變讓極線是曲線，
// 用折線近似
const RAY_NEAR = 0.5
const RAY_FAR = 40
const RAY_STEP = 0.05


function imageSize(params) {
  return {
    width: Number(params?.imageWidth) || 1920,
    height: Number(params?.imageHeight) || 1200,
  }
}


function insideVolume([x, y, z]) {
  return (
    x >= VOLUME.minX && x <= VOLUME.maxX
    && y >= VOLUME.minY && y <= VOLUME.maxY
    && z >= VOLUME.minZ && z <= VOLUME.maxZ
  )
}


// 離所有視線距離平方和最小的點：Σ(I − ddᵀ) p = Σ(I − ddᵀ) o
function triangulateRays(rays) {
  const a = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const b = [0, 0, 0]

  for (const { origin, direction } of rays) {
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const value = (row === column ? 1 : 0) - direction[row] * direction[column]
        a[row * 3 + column] += value
        b[row] += value * origin[column]
      }
    }
  }

  const determinant = (
    a[0] * (a[4] * a[8] - a[5] * a[7])
    - a[1] * (a[3] * a[8] - a[5] * a[6])
    + a[2] * (a[3] * a[7] - a[4] * a[6])
  )

  // 視線幾乎平行時沒有交會點
  if (!(Math.abs(determinant) > 1e-9)) return null

  const solve = column => {
    const m = a.slice()
    for (let row = 0; row < 3; row += 1) m[row * 3 + column] = b[row]
    return (
      m[0] * (m[4] * m[8] - m[5] * m[7])
      - m[1] * (m[3] * m[8] - m[5] * m[6])
      + m[2] * (m[3] * m[7] - m[4] * m[6])
    ) / determinant
  }

  return [solve(0), solve(1), solve(2)]
}


function reprojectionRms(point, views) {
  let sum = 0

  for (const view of views) {
    const projection = project3DToImage(point, view.params)
    if (!projection) return Infinity
    sum += (projection.u - view.u) ** 2 + (projection.v - view.v) ** 2
  }

  return Math.sqrt(sum / views.length)
}


/**
 * 參考視角整理成 { cameraIndex, params, u, v, ray }，反算不出視線的丟掉。
 */
export function prepareReferences(references) {
  return (references || [])
    .map(reference => {
      const u = Number(reference.u)
      const v = Number(reference.v)
      const ray = imagePointToRay(u, v, reference.params)
      return ray ? { ...reference, u, v, ray } : null
    })
    .filter(Boolean)
}


/**
 * 在目前這台的 (u, v) 點下去，和參考視角一起三角化的誤差。
 * 回傳 { error, point }，算不出來時 error 是 Infinity。
 */
export function evaluateGuideError(targetParams, references, u, v) {
  const ray = imagePointToRay(u, v, targetParams)

  if (!ray || references.length === 0) return { error: Infinity, point: null }

  const point = triangulateRays([ray, ...references.map(reference => reference.ray)])

  if (!point) return { error: Infinity, point: null }

  return {
    error: reprojectionRms(point, [{ params: targetParams, u, v }, ...references]),
    point,
  }
}


/**
 * 這一格所有視角的標註合不合得來：全部視線一起三角化，投影回每一台
 * 和標註差距的 RMS（px）。各台的極線都交在同一點時接近 0，有一台
 * 標錯就會被拉高。views 是 prepareReferences 整理過的。
 */
export function multiViewConsistency(views) {
  if (views.length < 2) return null

  const point = triangulateRays(views.map(view => view.ray))

  return point ? reprojectionRms(point, views) : null
}


/**
 * 一台參考視角的極線投影到目前這台：只取球可能出現的範圍、而且投影
 * 落在畫面內的部分，回傳折線陣列 [[{u, v}, ...], ...]。
 */
export function epipolarPolylines(targetParams, reference) {
  const { width, height } = imageSize(targetParams)
  const { origin, direction } = reference.ray
  const polylines = []
  let current = []

  for (let distance = RAY_NEAR; distance <= RAY_FAR; distance += RAY_STEP) {
    const point = origin.map((value, axis) => value + direction[axis] * distance)
    const projection = insideVolume(point) ? project3DToImage(point, targetParams) : null
    const visible = (
      projection
      && projection.u >= 0 && projection.u <= width
      && projection.v >= 0 && projection.v <= height
    )

    if (visible) {
      current.push({ u: projection.u, v: projection.v })
    } else if (current.length > 0) {
      if (current.length > 1) polylines.push(current)
      current = []
    }
  }

  if (current.length > 1) polylines.push(current)

  return polylines
}


/**
 * 目前這台相機的導引：
 *   lines：[{ cameraIndex, points: [{u, v}, ...] }]，每台參考視角的極線
 *     （可能斷成好幾段，每段一筆）
 *   minimum：{ u, v, error }，兩台以上參考才有（參考視線三角化的點投影到這台）
 */
export function computeEpipolarGuide({
  targetParams,
  references,
}) {
  const prepared = prepareReferences(references)

  const guide = {
    references: prepared,
    lines: prepared.flatMap(reference => (
      epipolarPolylines(targetParams, reference)
        .map(points => ({ cameraIndex: reference.cameraIndex, points }))
    )),
    minimum: null,
  }

  if (!targetParams || prepared.length < 2) return guide

  const point = triangulateRays(prepared.map(reference => reference.ray))
  const projection = point ? project3DToImage(point, targetParams) : null

  if (projection) {
    guide.minimum = {
      u: projection.u,
      v: projection.v,
      // 參考視角彼此之間的不一致，就是這台點得再準也降不下去的誤差
      error: reprojectionRms(point, [{ params: targetParams, ...projection }, ...prepared]),
    }
  }

  return guide
}
