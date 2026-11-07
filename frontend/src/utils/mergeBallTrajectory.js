import * as THREE from 'three'
import { fitPhysicalFlight } from './physicsFlight.js'

// 兩點之間超過這個 frame 數就視為偵測中斷，擬合不跨過去。
// 和 ballPath 的 MAX_FRAME_GAP 一樣
const MAX_FRAME_GAP = 12

// 檢查合不合理用的擬合窗：每格前後各幾格。自由飛行在這麼短的時間裡
// 幾乎就是二次曲線
const HALF_WINDOW = 3
const FIT_DEGREE = 2

/**
 * 平滑的強度：擬合窗是前後各 halfWindow 格。窗越長抖動越少，但越長
 * 二次式越跟不上阻力造成的減速，弧會被拉直。
 *
 * match 1 前 30 個 rally 實測（50fps，單位公分）。抖動是有 2D 的區域裡
 * 相鄰三格的二階差分，分成三格同來源、和有重建點與 ball_traj 交接的：
 *
 *   半窗    抖動 同來源 med/p90   交接 med/p90   弧的偏差 med/p90/p99
 *   不平滑   4.1 / 10.8           9.3 / 22.9
 *    3      1.6 / 4.4            2.5 / 7.9      0.04 / 0.2 / 3.0
 *    6      1.0 / 2.7            1.4 / 6.1      0.13 / 0.9 / 5.4
 *   10      0.7 / 2.3            1.0 / 5.8      0.37 / 2.7 / 10.3
 *
 * 弧的偏差是拿 ball_traj（本身就平滑、接近物理）來平滑，看被移動多少。
 */
export const SMOOTHING_LEVELS = [
  { label: '關', halfWindow: 0 },
  { label: '弱', halfWindow: 3 },
  { label: '中', halfWindow: 6 },
  { label: '強', halfWindow: 10 },
]

// 重建點和「同一段裡前後鄰點擬合出來的弧」差超過這個距離(公尺)，
// 就不是合理的位置，那一格不用。
//
// match 1 前 30 個 rally 實測：留一殘差中位數 3 公分、p99 29 公分，
// 門檻 0.5 公尺剔除 3917 點裡的 25 點，包含和 ball_traj 差 5 公尺的
// 那種整個重建錯的點。飛行分析的 outlier 判定抓不到這種點：它要靠下
// 一格「回到弧上」才認定，錯點落在段尾、下一格沒有重建點時就漏掉。
//
// 不用「和 ball_traj 差多遠」：同一批資料裡也有和 ball_traj 差 1 公尺
// 以上、卻和鄰點完全接得上（殘差 3~19 公分）的重建點，那是 ball_traj 錯。
const MAX_ARC_RESIDUAL = 0.5

// 位置來自 2D 標註的點：兩兩重建（2 台以上相機）或單一相機視線上的點
const isFromLabels = point => point.source === 'pairwise' || point.source === 'single'

// 平滑時當錨點的點：2D 標註來的點，加上物理擬合、內插補出來的點
// （它本身就是由前後的重建點決定的）
const isAnchor = point => (
  isFromLabels(point)
  || point.source === 'physics'
  || point.source === 'interp'
  || point.source === 'simulated'
)


// 以 centerFrame 為原點的最小平方二次式，回傳那一格的擬合位置 [x, y, z]
function fitValueAtCenter(window, centerFrame) {
  const size = FIT_DEGREE + 1
  const normal = Array.from({ length: size }, () => new Array(size).fill(0))
  const rhs = Array.from({ length: size }, () => [0, 0, 0])

  for (const point of window) {
    const t = point.frame - centerFrame
    const powers = [1]

    for (let k = 1; k < size; k += 1) powers.push(powers[k - 1] * t)

    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) normal[row][col] += powers[row] * powers[col]

      rhs[row][0] += powers[row] * point.x
      rhs[row][1] += powers[row] * point.y
      rhs[row][2] += powers[row] * point.z
    }
  }

  // 高斯消去，三軸一起解
  for (let col = 0; col < size; col += 1) {
    let pivot = col

    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(normal[row][col]) > Math.abs(normal[pivot][col])) pivot = row
    }

    if (Math.abs(normal[pivot][col]) < 1e-12) return null

    ;[normal[col], normal[pivot]] = [normal[pivot], normal[col]]
    ;[rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]]

    for (let row = col + 1; row < size; row += 1) {
      const factor = normal[row][col] / normal[col][col]

      for (let k = col; k < size; k += 1) normal[row][k] -= factor * normal[col][k]
      for (let axis = 0; axis < 3; axis += 1) rhs[row][axis] -= factor * rhs[col][axis]
    }
  }

  const solution = new Array(size)

  for (let row = size - 1; row >= 0; row -= 1) {
    const value = [...rhs[row]]

    for (let k = row + 1; k < size; k += 1) {
      for (let axis = 0; axis < 3; axis += 1) value[axis] -= normal[row][k] * solution[k][axis]
    }

    solution[row] = value.map(v => v / normal[row][row])
  }

  return solution[0].every(Number.isFinite) ? solution[0] : null
}


/**
 * 依擊球和偵測中斷把點切段，回傳每個點的段號（和 points 同順序）。
 *
 * 擊球是速度瞬間換掉，擬合跨過去會把前後兩條弧揉在一起。接觸時刻
 * （contacts 的 frame）落在兩格之間；剛好落在整數格時，那一格已經是
 * 擊球後，歸到後一段。
 */
function segmentIds(points, contacts) {
  const contactFrames = (contacts || []).map(contact => contact.frame).sort((a, b) => a - b)
  const ids = []
  let segment = 0
  let contactIndex = 0

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const previous = points[index - 1]
    let crossesContact = false

    while (contactIndex < contactFrames.length && contactFrames[contactIndex] <= point.frame) {
      if (previous && contactFrames[contactIndex] > previous.frame) crossesContact = true
      contactIndex += 1
    }

    if (previous && (crossesContact || point.frame - previous.frame > MAX_FRAME_GAP)) segment += 1

    ids.push(segment)
  }

  return ids
}


// 同一段、前後 halfWindow 格內的點的 index（含不含自己由 includeSelf 決定）
function windowIndices(points, ids, index, includeSelf, halfWindow = HALF_WINDOW) {
  const indices = []
  const center = points[index]

  for (let k = index - 1; k >= 0 && center.frame - points[k].frame <= halfWindow; k -= 1) {
    if (ids[k] === ids[index]) indices.push(k)
  }

  if (includeSelf) indices.push(index)

  for (let k = index + 1; k < points.length && points[k].frame - center.frame <= halfWindow; k += 1) {
    if (ids[k] === ids[index]) indices.push(k)
  }

  return indices
}


// 平滑要多一點才有餘裕可以平均；檢查合不合理時，段尾只剩單側 3 點，
// 剛好定出一條二次式，往外推一格雜訊放大約 4.4 倍（約 13 公分），
// 仍遠小於 MAX_ARC_RESIDUAL，所以 3 點就檢查，段尾的錯點才抓得到
function fitAt(points, indices, frame, minPoints = FIT_DEGREE + 2) {
  if (indices.length < minPoints) return null

  return fitValueAtCenter(indices.map(k => points[k]), frame)
}


const distance = (point, value) => Math.hypot(
  point.x - value[0],
  point.y - value[1],
  point.z - value[2],
)


// 這一點和同段前後鄰點（排除自己，也排除 excluded）擬合出來的弧差多遠。
// 鄰點不夠定出弧就回傳 null，表示沒辦法檢查
function arcResidual(points, ids, index, excluded = -1) {
  const window = windowIndices(points, ids, index, false).filter(k => k !== excluded)
  const value = fitAt(points, window, points[index].frame, FIT_DEGREE + 1)

  return value ? distance(points[index], value) : null
}


/**
 * 篩出合理的 2D 重建點，不合理的那一格就空著、不內插。重建點要過這幾關：
 *   - 至少 2 組相機、位置在球場範圍內（呼叫端篩過才傳進 pairwisePoints）
 *   - 不是飛行分析判定跳出弧線的單點（outlierFrames）
 *   - 和同段前後鄰點擬合出來的弧差不到 MAX_ARC_RESIDUAL
 *
 * 最後一關要小心誰才是錯點：一個差了 5 公尺的錯點會把鄰點的擬合一起
 * 拉歪，鄰點的殘差也跟著超過門檻；錯點在段尾時，鄰點甚至比它自己還
 * 超過。所以不是剔除殘差最大的點，而是每輪試著拿掉每個超過門檻的點，
 * 看拿掉之後附近其他點的殘差剩多少，剔除「拿掉後附近最一致」的那一點，
 * 再重算。
 *
 * 回傳的點依 frame 排序，各帶 source: 'pairwise'。
 */
export function filterPairwisePoints(pairwisePoints, outlierFrames, contacts) {
  // 同一格有兩筆時留後面那筆
  const byFrame = new Map()

  for (const point of pairwisePoints || []) {
    if (outlierFrames?.has(point.frame)) continue

    byFrame.set(point.frame, {
      frame: point.frame,
      x: point.x,
      y: point.y,
      z: point.z,
      source: 'pairwise',
      cameraCount: point.camera_count,
      pairCount: point.pair_count,
      usedCameras: point.used_cameras,
    })
  }

  const points = [...byFrame.values()].sort((a, b) => a.frame - b.frame)

  return rejectOffArc(points, contacts, new Map(), point => point.source === 'pairwise')
}


/**
 * 剔除和同段前後鄰點擬合出來的弧差超過 MAX_ARC_RESIDUAL 的點，那一格
 * 換回 fallbackByFrame 裡的點（沒有就拿掉）。只檢查 isCandidate 的點，
 * 其他點只當鄰點。
 *
 * 一個差了 5 公尺的錯點會把鄰點的擬合一起拉歪，鄰點的殘差也跟著超過
 * 門檻，所以不是剔除殘差最大的點，而是每輪試著拿掉每個超過門檻的點，
 * 剔除「拿掉後附近最一致」的那一點，再重算。
 */
function rejectOffArc(inputPoints, contacts, fallbackByFrame, isCandidate) {
  let points = inputPoints

  // 每輪剔除一點，上限只是保險
  for (let round = 0; round < points.length; round += 1) {
    const ids = segmentIds(points, contacts)
    const residuals = points.map((point, index) => (
      isCandidate(point) ? arcResidual(points, ids, index) : null
    ))

    let best = null

    points.forEach((point, index) => {
      if (!(residuals[index] > MAX_ARC_RESIDUAL)) return

      // 拿掉這一點之後，受影響的鄰點（它們的擬合窗裡有這一點）最差剩多少。
      // 拿掉後鄰點剩太少點、沒辦法檢查的就不算：拿掉的若是好點，錯點
      // 還在，其他鄰點照樣被它拉歪，分數一樣會比拿掉錯點差
      let worst = 0

      for (const k of windowIndices(points, ids, index, false)) {
        if (residuals[k] == null) continue

        const residual = arcResidual(points, ids, k, index)
        if (residual != null) worst = Math.max(worst, residual)
      }

      if (
        !best
        || worst < best.worst
        || (worst === best.worst && residuals[index] > best.residual)
      ) {
        best = { frame: point.frame, worst, residual: residuals[index] }
      }
    })

    if (!best) break

    points = points.flatMap((point) => {
      if (point.frame !== best.frame) return [point]

      const fallback = fallbackByFrame.get(point.frame)

      return fallback ? [fallback] : []
    })
  }

  return points
}


/**
 * 把軌跡平滑掉抖動：每格用同段前後各 halfWindow 格擬合二次式、取那一格
 * 的值，不跨過擊球和偵測中斷（見 segmentIds）。
 *
 * 只平滑有 2D 重建結果的地方：
 *   - 錨點（2D 標註來的點、物理擬合與內插補的點，見 isAnchor）都平滑。
 *   - 其他點只有夾在重建點中間（擬合窗前後都有重建點）才平滑；只在
 *     一側碰到重建點的不動，那裡的擊球可能沒被切開，平滑下去會把擊球
 *     的轉角磨圓。
 *
 * 切段用 contacts 加上 extraBreaks（另外要切開的格子）。
 *
 * 擊球前最後一格（contacts 的 lastFrameBefore）不動：球拍拍面中心對準
 * 的就是那一格的重建點，球在那裡最慢、2D 標註最準；而且它在段尾，擬合
 * 窗只剩單側，平滑反而最不可靠。
 *
 * 只改位置，其他欄位（frame、source…）照舊。
 */
export function smoothBallTrajectory(points, contacts, { halfWindow, extraBreaks = [] }) {
  if (!points?.length || !halfWindow) return points || []

  const ids = segmentIds(points, [...(contacts || []), ...extraBreaks])
  const pinnedFrames = new Set((contacts || []).map(contact => contact.lastFrameBefore))
  const isPairwise = k => isAnchor(points[k])

  return points.map((point, index) => {
    if (pinnedFrames.has(point.frame)) return point

    const window = windowIndices(points, ids, index, true, halfWindow)

    if (
      !isAnchor(point)
      && !(window.some(k => k < index && isPairwise(k)) && window.some(k => k > index && isPairwise(k)))
    ) {
      return point
    }

    const value = fitAt(points, window, point.frame)
    if (!value) return point

    return { ...point, x: value[0], y: value[1], z: value[2] }
  })
}


// 單一相機的點：先驗位置到那條視線的距離（也就是要移動多少才會落到
// 2D 標註上）超過這個值就不用，見 fitSingleViewPoints
export const MAX_SINGLE_VIEW_CORRECTION = 0.5


// imagePointToRay 的 { origin, direction } 陣列轉成 THREE.Ray
const toThreeRay = ray => new THREE.Ray(
  new THREE.Vector3(...ray.origin),
  new THREE.Vector3(...ray.direction),
)

const toPoint = vector => ({ x: vector.x, y: vector.y, z: vector.z })


// point 投影到視線上最近的點（只取相機前方）
function closestPointOnRay(point, ray) {
  return toPoint(
    toThreeRay(ray).closestPointToPoint(new THREE.Vector3(point.x, point.y, point.z), new THREE.Vector3()),
  )
}


/**
 * 只有一台相機拍到的格子：2D 標註只決定一條視線，球在這條線上哪裡
 * 不知道。這裡拿先驗位置（priorPoints：物理擬合、內插補出來的軌跡）沿垂直
 * 視線的方向移到線上最近的點 —— 投影回那台相機剛好落在標註上，深度
 * 則沿用先驗。
 *
 * 要過這幾關才用：
 *   - 那一格先驗的來源在 priorSources 裡（物理擬合、內插）。有重建點的
 *     格子不動
 *   - 移動距離不超過 maxCorrection：離得太遠代表標註是誤偵測，或先驗
 *     本身就錯了，兩者都不能拿來修
 *   - 移完後在球場範圍內（isInside）
 *   - 和同段前後鄰點擬合出來的弧接得上（rejectOffArc，和重建點同一套）
 *
 * observations 是 [{ frame, cameraIndex, ray, maxDistance? }]，有 maxDistance
 * 的相機只在先驗位置離它不超過那個距離時才用。回傳通過的點
 * （source: 'single'，帶 cameraIndex、ray、correction），呼叫端把它們
 * 換進軌跡。
 */
export function fitSingleViewPoints(priorPoints, observations, {
  contacts,
  isInside = () => true,
  maxCorrection = MAX_SINGLE_VIEW_CORRECTION,
  planeAt = () => null,
  priorSources = ['physics', 'interp'],
} = {}) {
  if (!priorPoints?.length || !observations?.length) return []

  const priorByFrame = new Map(priorPoints.map(point => [point.frame, point]))
  const candidates = new Map()

  for (const observation of observations) {
    const prior = priorByFrame.get(observation.frame)
    if (!prior || !priorSources.includes(prior.source) || !observation.ray) continue

    // 只在球夠近時才用的相機：先驗位置離相機太遠就不用
    if (
      observation.maxDistance != null
      && Math.hypot(
        prior.x - observation.ray.origin[0],
        prior.y - observation.ray.origin[1],
        prior.z - observation.ray.origin[2],
      ) > observation.maxDistance
    ) {
      continue
    }

    // 這段飛行有鉛直面時，視線和面的交點就是完整的 3D 位置，深度不必
    // 再沿用先驗；視線和面幾乎平行（交點不穩）才退回視線上最近的點
    const plane = planeAt(observation.frame)
    const onPlane = plane ? intersectRayWithPlane(observation.ray, plane) : null
    const fitted = onPlane || closestPointOnRay(prior, observation.ray)
    const correction = Math.hypot(fitted.x - prior.x, fitted.y - prior.y, fitted.z - prior.z)

    if (correction > maxCorrection || !isInside(fitted)) continue

    candidates.set(observation.frame, {
      frame: observation.frame,
      ...fitted,
      source: 'single',
      cameraIndex: observation.cameraIndex,
      ray: observation.ray,
      plane: onPlane ? plane : null,
      correction,
    })
  }

  if (!candidates.size) return []

  const withCandidates = priorPoints.map(point => candidates.get(point.frame) || point)
  const checked = rejectOffArc(withCandidates, contacts, priorByFrame, point => point.source === 'single')

  return checked.filter(point => point.source === 'single')
}


/**
 * 平滑會把單一相機的點移開視線，平滑完再放回去，投影回那台相機才會
 * 落在 2D 標註上：有鉛直面的放回視線和面的交點，沒有的放回視線上
 * 最近的點。
 */
export function snapSingleViewPoints(points) {
  return points.map((point) => {
    if (point.source !== 'single' || !point.ray) return point

    const onPlane = point.plane ? intersectRayWithPlane(point.ray, point.plane) : null

    return { ...point, ...(onPlane || closestPointOnRay(point, point.ray)) }
  })
}


/*
 * 羽球飛行時只受重力和沿著速度方向的阻力，沒有側向的力，所以兩次擊球
 * 之間的整段飛行都落在同一個鉛直面上。
 *
 * match 1 前 30 個 rally 實測（不用 cam 3、4 時）：每段用重建點擬合鉛直面，
 * 重建點離面 med 2.4 / p90 8 公分，和重建點本身的雜訊同一個量級；
 * ball_traj 離這個面 med 4.4 / p90 15 公分，側向偏得比較多。
 */

// 一段至少要有這麼多個 2D 標註來的點才擬合鉛直面
const PLANE_MIN_POINTS = 6

// 點在水平面上沿主方向的散佈（標準差，公尺）至少要這麼大，方向才定得
// 出來；幾乎垂直上下的球（例如發球拋起）定不出面
const PLANE_MIN_EXTENT = 0.3

// 擬合時離面超過這個距離的點當成錯點剔除再擬合一次；剔除後剩不到
// PLANE_MIN_KEEP 比例的點，代表這段其實不是一次飛行（漏抓了擊球），不用
const PLANE_OUTLIER_DISTANCE = 0.15
const PLANE_MIN_KEEP = 0.7

// 投影到面上時移動超過這個距離就不移：那一點多半不屬於這段飛行
const PLANE_MAX_SHIFT = 0.5

// 視線和鉛直面的夾角小於這個角度時，交點沿視線方向的誤差會被放大
// （1 / sin 夾角），不用交點
const MIN_RAY_PLANE_ANGLE_DEGREES = 15


// 水平面（x, z）上的總最小平方直線，回傳 { cx, cz, nx, nz, extent }：
// (nx, nz) 是鉛直面的水平法向量
function fitVerticalPlane(points) {
  const count = points.length
  const cx = points.reduce((sum, point) => sum + point.x, 0) / count
  const cz = points.reduce((sum, point) => sum + point.z, 0) / count
  let sxx = 0
  let szz = 0
  let sxz = 0

  for (const point of points) {
    sxx += (point.x - cx) ** 2
    szz += (point.z - cz) ** 2
    sxz += (point.x - cx) * (point.z - cz)
  }

  const trace = sxx + szz
  const largest = trace / 2 + Math.sqrt(Math.max(0, trace * trace / 4 - (sxx * szz - sxz * sxz)))

  let dx = sxz
  let dz = largest - sxx

  if (Math.hypot(dx, dz) < 1e-12) {
    dx = sxx >= szz ? 1 : 0
    dz = sxx >= szz ? 0 : 1
  }

  const length = Math.hypot(dx, dz)

  return { cx, cz, nx: -dz / length, nz: dx / length, extent: Math.sqrt(largest / count) }
}


const planeDistance = (plane, point) => (point.x - plane.cx) * plane.nx + (point.z - plane.cz) * plane.nz


function intersectRayWithPlane(ray, plane) {
  const facing = plane.nx * ray.direction[0] + plane.nz * ray.direction[2]

  if (Math.abs(facing) < Math.sin(MIN_RAY_PLANE_ANGLE_DEGREES * Math.PI / 180)) return null

  const verticalPlane = new THREE.Plane(
    new THREE.Vector3(plane.nx, 0, plane.nz),
    -(plane.nx * plane.cx + plane.nz * plane.cz),
  )
  const hit = toThreeRay(ray).intersectPlane(verticalPlane, new THREE.Vector3())

  return hit ? toPoint(hit) : null
}


/**
 * 每段飛行（以 contacts 與 extraBreaks 切段，同 smoothBallTrajectory）
 * 用 2D 標註來的點擬合鉛直面，回傳 Map(frame → plane)，段裡每一格都
 * 查得到。定不出面的段（點太少、太集中、或其實混了兩段飛行）沒有。
 */
export function fitFlightPlanes(points, contacts, extraBreaks = []) {
  const planeByFrame = new Map()
  if (!points?.length) return planeByFrame

  const ids = segmentIds(points, [...(contacts || []), ...extraBreaks])
  const segments = new Map()

  points.forEach((point, index) => {
    if (!segments.has(ids[index])) segments.set(ids[index], [])
    segments.get(ids[index]).push(point)
  })

  for (const segment of segments.values()) {
    const labelPoints = segment.filter(isFromLabels)
    if (labelPoints.length < PLANE_MIN_POINTS) continue

    let plane = fitVerticalPlane(labelPoints)
    const kept = labelPoints.filter(point => Math.abs(planeDistance(plane, point)) <= PLANE_OUTLIER_DISTANCE)

    if (kept.length < PLANE_MIN_POINTS || kept.length < labelPoints.length * PLANE_MIN_KEEP) continue

    plane = fitVerticalPlane(kept)
    if (plane.extent < PLANE_MIN_EXTENT) continue

    for (const point of segment) planeByFrame.set(point.frame, plane)
  }

  return planeByFrame
}


/**
 * 把點沿水平法向量移到所屬那段飛行的鉛直面上，去掉側向的偏移。
 * 高度不動。離面超過 PLANE_MAX_SHIFT 的點不移。
 */
export function projectOntoFlightPlanes(points, planeByFrame) {
  return points.map((point) => {
    const plane = planeByFrame.get(point.frame)
    if (!plane) return point

    const distance = planeDistance(plane, point)
    if (Math.abs(distance) > PLANE_MAX_SHIFT) return point

    return { ...point, x: point.x - distance * plane.nx, z: point.z - distance * plane.nz }
  })
}


/*
 * 羽球不會飛到一半往回飛：水平方向只有沿著速度的阻力，會把球減慢但
 * 不會讓它倒退，重力又是鉛直的。所以兩次擊球之間，球在水平面上沿著
 * 飛行方向的位置只會往前。
 */

// 一段的水平淨位移小於這個值（幾乎垂直上下）就定不出飛行方向，不處理
const FORWARD_MIN_TRAVEL = 0.3

// 這一段往回退得比這個距離多（相對已經飛到的最遠處），就不是雜訊，
// 多半是漏抓了擊球、其實混了兩段飛行，不處理，免得把一次回擊壓平
const FORWARD_MAX_RETREAT = 0.3

// 段頭、段尾各這麼多格不處理：擊球的位置可能差一兩格，擊球後的頭幾格
// 被切進前一段時，它們的「往回」是真的被打回去，不能壓平
const FORWARD_EDGE_FRAMES = 2

// 1 台相機的點在保序迴歸裡的權重：它放在 2D 標註的視線上，移動就會
// 離開標註，所以幾乎不動，由旁邊的點讓開
const FORWARD_SINGLE_VIEW_WEIGHT = 1000


// 加權保序迴歸（pool adjacent violators）：最接近 values（依 weights
// 加權）的非遞減數列
function nonDecreasing(values, weights) {
  const blocks = []

  values.forEach((value, index) => {
    const weight = weights[index]
    blocks.push({ sum: value * weight, weight, count: 1 })

    while (
      blocks.length > 1
      && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].weight
        > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].weight
    ) {
      const last = blocks.pop()
      blocks[blocks.length - 1].sum += last.sum
      blocks[blocks.length - 1].weight += last.weight
      blocks[blocks.length - 1].count += last.count
    }
  })

  return blocks.flatMap(block => new Array(block.count).fill(block.sum / block.weight))
}


/**
 * 每段飛行（以 contacts 與 extraBreaks 切段，同 smoothBallTrajectory）
 * 讓球在水平面上沿飛行方向的位置不往回：往回的那幾格改成最接近原位置、
 * 又不往回的值（加權保序迴歸），只沿飛行方向移，高度與側向都不動。
 *
 * 飛行方向用整段點在水平面上的主方向（同 fitVerticalPlane），朝段頭
 * 指向段尾那一側；只看頭尾兩點的話，頭尾任一點偏了方向就跟著歪。
 *
 * 段頭、段尾各 FORWARD_EDGE_FRAMES 格不處理；往回退超過
 * FORWARD_MAX_RETREAT 的段不處理（見上）。被移動的點帶 forwardShift（公尺）。
 */
export function enforceForwardFlight(points, contacts, extraBreaks = [], {
  // 每個點在保序迴歸裡的權重，權重越大越不動
  weightOf = point => (point.source === 'single' ? FORWARD_SINGLE_VIEW_WEIGHT : 1),
} = {}) {
  if (!points?.length) return points || []

  const ids = segmentIds(points, [...(contacts || []), ...extraBreaks])
  const result = points.slice()
  let start = 0

  while (start < points.length) {
    let end = start

    while (end + 1 < points.length && ids[end + 1] === ids[start]) end += 1

    const first = points[start]
    const last = points[end]
    const travel = Math.hypot(last.x - first.x, last.z - first.z)

    // 只處理去掉頭尾後還有至少兩格的段
    const innerStart = start + FORWARD_EDGE_FRAMES
    const innerEnd = end - FORWARD_EDGE_FRAMES

    if (innerEnd > innerStart && travel >= FORWARD_MIN_TRAVEL) {
      const axis = fitVerticalPlane(points.slice(start, end + 1))
      // 主方向垂直於鉛直面的法向量，朝段頭指向段尾那一側
      const flip = (last.x - first.x) * axis.nz - (last.z - first.z) * axis.nx < 0 ? -1 : 1
      const dx = axis.nz * flip
      const dz = -axis.nx * flip
      const along = []
      const weights = []

      for (let index = innerStart; index <= innerEnd; index += 1) {
        along.push((points[index].x - first.x) * dx + (points[index].z - first.z) * dz)
        weights.push(weightOf(points[index]))
      }

      let farthest = -Infinity
      let retreat = 0

      for (const value of along) {
        farthest = Math.max(farthest, value)
        retreat = Math.max(retreat, farthest - value)
      }

      if (retreat > 0 && retreat <= FORWARD_MAX_RETREAT) {
        const fixed = nonDecreasing(along, weights)

        fixed.forEach((value, offset) => {
          const shift = value - along[offset]
          if (Math.abs(shift) < 1e-9) return

          const point = points[innerStart + offset]
          result[innerStart + offset] = {
            ...point,
            x: point.x + shift * dx,
            z: point.z + shift * dz,
            forwardShift: shift,
          }
        })
      }
    }

    start = end + 1
  }

  return result
}


/**
 * 用物理擬合補每段飛行的中間（見 physicsFlight.js 的 fitPhysicalFlight）。
 *
 * 每段（以 contacts 與 extraBreaks 切段）用 observations（2D 標註來的
 * 重建點，未經弧線剔除）擬合 a = g − k|v|v。前後接得起來的段，
 * 從第一個到最後一個觀測點之間、points 裡沒有 2D 標註來的點的格子
 * （中間沒拍到的部分，以及重建點被弧線檢查剔除的格子）用擬合出來的
 * 位置（source 'physics'）。有重建點的格子一律以 points 原本的結果為準
 * —— 有 2D 標註就以標註重建的結果為準，擬合只補沒有的。
 * 接不起來的段、以及觀測範圍外的格子也維持 points 原本的結果。
 *
 * 補上的點帶 physicsRms（這段擬合離觀測點的 RMS，公尺），說明位置怎麼來的。
 */
export function overlayPhysicalFlights(points, observations, fps, contacts, extraBreaks = [], {
  extrapolateFrames = 0,
  isInside = () => true,
  // 這一格之前不往外推（發球前球還拿在手上，往回推會憑空飛起來）
  noExtrapolateBefore = -Infinity,
} = {}) {
  if (!observations?.length) return points

  const breakFrames = [...(contacts || []), ...extraBreaks].map(item => item.frame).sort((a, b) => a - b)
  // 同 segmentIds：剛好落在整數格的擊球，那一格已經是擊球後
  const segmentOf = frame => breakFrames.filter(breakFrame => breakFrame <= frame).length
  const groups = new Map()

  for (const point of [...observations].sort((a, b) => a.frame - b.frame)) {
    const segment = segmentOf(point.frame)
    if (!groups.has(segment)) groups.set(segment, [])
    groups.get(segment).push(point)
  }

  const byFrame = new Map(points.map(point => [point.frame, point]))

  for (const group of groups.values()) {
    const flight = fitPhysicalFlight(group, fps)
    if (!flight) continue

    for (let frame = flight.startFrame; frame <= flight.endFrame; frame += 1) {
      // 已經有 2D 標註來的點（沒被弧線檢查剔除的重建點）就以它為準
      const existing = byFrame.get(frame)
      if (existing && isFromLabels(existing)) continue

      const fitted = flight.positionAt(frame)
      if (fitted) byFrame.set(frame, { frame, ...fitted, source: 'physics', physicsRms: flight.rms })
    }

    // 段頭、段尾：沿著擬合的軌跡往外推幾格（不跨過擊球、不出界、不穿過地板）
    const segment = segmentOf(flight.startFrame)

    for (let k = 1; k <= extrapolateFrames; k += 1) {
      for (const frame of [flight.startFrame - k, flight.endFrame + k]) {
        if (segmentOf(frame) !== segment || frame < noExtrapolateBefore) continue

        const existing = byFrame.get(frame)
        if (existing && isFromLabels(existing)) continue

        const fitted = flight.extrapolateTo(frame)
        if (!fitted || !isInside(fitted)) continue

        byFrame.set(frame, {
          frame,
          ...fitted,
          source: 'physics',
          physicsRms: flight.rms,
          extrapolated: k,
        })
      }
    }
  }

  return [...byFrame.values()].sort((a, b) => a.frame - b.frame)
}


/**
 * 補短空檔：同一段飛行裡，前後都有點、中間只空了不超過 maxGap 格的地方，
 * 用空檔兩側各最多 FILL_SIDE_POINTS 點擬合二次曲線（等加速度，短時間內
 * 就是羽球的飛行公式）取中間的值（source 'interp'）。兩側都要至少 2 點。
 * 不跨過擊球（contacts）。
 */
const FILL_SIDE_POINTS = 6
const FILL_SIDE_SPAN = 12

export function fillShortGaps(points, contacts, maxGap) {
  if (!points?.length || !maxGap) return points || []

  const sorted = [...points].sort((a, b) => a.frame - b.frame)
  const breakFrames = (contacts || []).map(contact => contact.frame).sort((a, b) => a - b)
  const segmentOf = frame => breakFrames.filter(breakFrame => breakFrame <= frame).length
  const filled = []

  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const before = sorted[i]
    const after = sorted[i + 1]
    const gap = after.frame - before.frame - 1

    if (gap < 1 || gap > maxGap || segmentOf(before.frame) !== segmentOf(after.frame)) continue

    const segment = segmentOf(before.frame)
    const left = []
    const right = []

    for (let k = i; k >= 0 && left.length < FILL_SIDE_POINTS; k -= 1) {
      if (before.frame - sorted[k].frame > FILL_SIDE_SPAN || segmentOf(sorted[k].frame) !== segment) break
      left.push(sorted[k])
    }
    for (let k = i + 1; k < sorted.length && right.length < FILL_SIDE_POINTS; k += 1) {
      if (sorted[k].frame - after.frame > FILL_SIDE_SPAN || segmentOf(sorted[k].frame) !== segment) break
      right.push(sorted[k])
    }

    if (left.length < 2 || right.length < 2) continue

    const window = [...left, ...right]

    for (let frame = before.frame + 1; frame < after.frame; frame += 1) {
      const value = fitValueAtCenter(window, frame)
      if (value) filled.push({ frame, x: value[0], y: value[1], z: value[2], source: 'interp', gap })
    }
  }

  return filled.length ? [...sorted, ...filled].sort((a, b) => a.frame - b.frame) : sorted
}


/*
 * 去掉「閃電」：軌跡在一兩格突然跳出去又回來。
 *
 * 判定：連續 1~SPIKE_MAX_BLOCK 格（block），前面 3 格和後面 3 格擬合同
 * 一條二次曲線，6 點都在曲線 SPIKE_FIT_TOLERANCE 以內（前後其實是同一
 * 條平順的軌跡），而 block 裡每一格都離曲線超過 SPIKE_THRESHOLD，就是
 * 跳出去又回來，換成曲線上的位置。
 *
 * 真的擊球是轉角：擊球前 3 格和擊球後 3 格不會落在同一條二次曲線上，
 * 不會被當成閃電，所以不需要知道擊球在哪。
 */
const SPIKE_THRESHOLD = 0.25
const SPIKE_FIT_TOLERANCE = 0.1
const SPIKE_MAX_BLOCK = 4
const SPIKE_SIDE_POINTS = 3


export function removeSpikes(points) {
  if (!points?.length) return points || []

  let result = [...points].sort((a, b) => a.frame - b.frame)

  // 換掉一段之後旁邊可能又成立，最多做幾輪
  for (let pass = 0; pass < 3; pass += 1) {
    const byFrame = new Map(result.map(point => [point.frame, point]))
    const replaced = new Map()

    for (const point of result) {
      const start = point.frame
      if (replaced.has(start)) continue

      for (let size = 1; size <= SPIKE_MAX_BLOCK; size += 1) {
        const left = []
        const right = []
        const block = []

        for (let k = SPIKE_SIDE_POINTS; k >= 1; k -= 1) left.push(byFrame.get(start - k))
        for (let k = 0; k < size; k += 1) block.push(byFrame.get(start + k))
        for (let k = 0; k < SPIKE_SIDE_POINTS; k += 1) right.push(byFrame.get(start + size + k))

        if ([...left, ...block, ...right].some(item => !item)) break

        const sides = [...left, ...right]
        const fitAtFrame = frame => fitValueAtCenter(sides, frame)
        const sidesFit = sides.every((item) => {
          const value = fitAtFrame(item.frame)
          return value && distance(item, value) <= SPIKE_FIT_TOLERANCE
        })
        if (!sidesFit) continue

        const fitted = block.map(item => fitAtFrame(item.frame))
        if (fitted.some(value => !value)) continue
        if (!block.every((item, k) => distance(item, fitted[k]) > SPIKE_THRESHOLD)) continue

        block.forEach((item, k) => {
          replaced.set(item.frame, {
            ...item,
            x: fitted[k][0],
            y: fitted[k][1],
            z: fitted[k][2],
            despiked: distance(item, fitted[k]),
          })
        })
        break
      }
    }

    if (!replaced.size) break
    result = result.map(point => replaced.get(point.frame) || point)
  }

  return result
}
