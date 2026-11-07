/*
 * 用物理模型把一段飛行的前後接起來。
 *
 * 2D 標註通常只拍到擊球前後，中間飛行是黑盒子。羽球飛行只受重力和沿
 * 速度反方向的空氣阻力（約與速度平方成正比），沒有側向的力：
 *
 *   a = g − k·|v|·v
 *
 * 所以只要知道某一格的位置、速度和阻力係數 k，整段飛行就決定了，而且
 * 自動落在一個鉛直面上。拿這段前後拍到的點去擬合這 7 個參數，擬合得
 * 好（前後接得起來）就用擬合出來的弧補中間。
 *
 * 座標同 ball_traj 的 raw：y 朝下（地板 y = 0.5），所以重力是 +y。
 */

const GRAVITY = 9.81

// 每一格再細分幾步積分（RK4）。50 fps 一格 20 ms，比阻力的時間常數（約
// 0.1 秒）小很多，一步就夠；兩步的結果一樣、慢一倍
const SUBSTEPS = 1

// 阻力係數 k（1/m）的範圍。終端速度 vt = sqrt(g / k)，羽球約 6.5~7 m/s，
// 對應 k ≈ 0.2；放寬到 vt 3~22 m/s
const MIN_DRAG = 0.02
const MAX_DRAG = 1.0
const INITIAL_DRAG = 0.2

// Levenberg–Marquardt
const MAX_ITERATIONS = 30
const INITIAL_DAMPING = 1e-3


function acceleration(velocity, drag) {
  const speed = Math.hypot(velocity[0], velocity[1], velocity[2])

  return [
    -drag * speed * velocity[0],
    GRAVITY - drag * speed * velocity[1],
    -drag * speed * velocity[2],
  ]
}


// RK4 一步，state = [px, py, pz, vx, vy, vz]
function step(state, drag, dt) {
  const derivative = (s) => {
    const a = acceleration([s[3], s[4], s[5]], drag)
    return [s[3], s[4], s[5], a[0], a[1], a[2]]
  }
  const add = (s, d, h) => s.map((value, i) => value + d[i] * h)

  const k1 = derivative(state)
  const k2 = derivative(add(state, k1, dt / 2))
  const k3 = derivative(add(state, k2, dt / 2))
  const k4 = derivative(add(state, k3, dt))

  return state.map((value, i) => value + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
}


/**
 * 從 startFrame 的位置 / 速度開始積分到 endFrame，回傳 Map(frame → [x, y, z])
 * params = [px, py, pz, vx, vy, vz, logDrag]
 */
function simulate(params, startFrame, endFrame, fps) {
  const drag = Math.exp(params[6])
  const dt = 1 / fps / SUBSTEPS
  const positions = new Map()
  let state = params.slice(0, 6)

  positions.set(startFrame, state.slice(0, 3))

  for (let frame = startFrame + 1; frame <= endFrame; frame += 1) {
    for (let sub = 0; sub < SUBSTEPS; sub += 1) state = step(state, drag, dt)
    if (!state.every(Number.isFinite)) return null
    positions.set(frame, state.slice(0, 3))
  }

  return positions
}


// 從 startFrame 的狀態積分到 targetFrame（可以往前，也可以往回），回傳 [x, y, z]
function positionFrom(params, startFrame, targetFrame, fps) {
  const drag = Math.exp(params[6])
  const steps = Math.abs(targetFrame - startFrame) * SUBSTEPS
  const dt = Math.sign(targetFrame - startFrame) / fps / SUBSTEPS
  let state = params.slice(0, 6)

  for (let i = 0; i < steps; i += 1) state = step(state, drag, dt)

  return state.every(Number.isFinite) ? state.slice(0, 3) : null
}


function residuals(params, observations, startFrame, endFrame, fps) {
  const positions = simulate(params, startFrame, endFrame, fps)
  if (!positions) return null

  const values = []

  for (const point of observations) {
    const p = positions.get(point.frame)
    values.push(p[0] - point.x, p[1] - point.y, p[2] - point.z)
  }

  return values
}


const sumSquares = values => values.reduce((sum, value) => sum + value * value, 0)


// n×n 線性系統（高斯消去，部分選主元）
function solve(matrix, rhs) {
  const n = rhs.length
  const a = matrix.map((row, i) => [...row, rhs[i]])

  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    if (Math.abs(a[pivot][col]) < 1e-14) return null
    ;[a[col], a[pivot]] = [a[pivot], a[col]]

    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row][col] / a[col][col]
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k]
    }
  }

  const x = new Array(n).fill(0)
  for (let row = n - 1; row >= 0; row -= 1) {
    let value = a[row][n]
    for (let k = row + 1; k < n; k += 1) value -= a[row][k] * x[k]
    x[row] = value / a[row][row]
  }

  return x
}


const clampDrag = params => {
  params[6] = Math.min(Math.log(MAX_DRAG), Math.max(Math.log(MIN_DRAG), params[6]))
  return params
}


// Levenberg–Marquardt，Jacobian 用數值差分
function levenbergMarquardt(initial, observations, startFrame, endFrame, fps) {
  let params = clampDrag(initial.slice())
  let current = residuals(params, observations, startFrame, endFrame, fps)
  if (!current) return null

  let cost = sumSquares(current)
  let damping = INITIAL_DAMPING

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const jacobian = params.map((value, j) => {
      const h = j === 6 ? 1e-4 : 1e-5 * Math.max(1, Math.abs(value))
      const shifted = params.slice()
      shifted[j] += h
      const moved = residuals(shifted, observations, startFrame, endFrame, fps)
      return moved ? moved.map((r, i) => (r - current[i]) / h) : null
    })

    if (jacobian.some(column => !column)) return null

    const size = params.length
    const normal = Array.from({ length: size }, (_, a) => (
      Array.from({ length: size }, (__, b) => jacobian[a].reduce((sum, value, i) => sum + value * jacobian[b][i], 0))
    ))
    const gradient = jacobian.map(column => column.reduce((sum, value, i) => sum + value * current[i], 0))

    let improved = false

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const damped = normal.map((row, a) => row.map((value, b) => (a === b ? value * (1 + damping) + 1e-12 : value)))
      const delta = solve(damped, gradient.map(value => -value))
      if (!delta) { damping *= 10; continue }

      const candidate = clampDrag(params.map((value, j) => value + delta[j]))
      const next = residuals(candidate, observations, startFrame, endFrame, fps)
      const nextCost = next ? sumSquares(next) : Infinity

      if (nextCost < cost) {
        const gain = cost - nextCost
        params = candidate
        current = next
        cost = nextCost
        damping = Math.max(damping / 10, 1e-9)
        improved = gain > 1e-12 * Math.max(1, cost)
        break
      }

      damping *= 10
    }

    if (!improved) break
  }

  return { params, cost }
}


// 擬合的起點：初速分別用「頭尾兩點的拋物線」和「頭幾點的差分」估，取
// 殘差最小的結果。阻力也試過 0.1 / 0.2 / 0.5 三個起點，match 1 實測結果
// 完全一樣，只是慢三倍，所以只用 INITIAL_DRAG
const INITIAL_DRAGS = [INITIAL_DRAG]

function initialGuesses(observations, fps) {
  const first = observations[0]
  const last = observations[observations.length - 1]
  const duration = (last.frame - first.frame) / fps
  const early = observations.find(point => point.frame - first.frame >= 3) || last
  const earlyDuration = (early.frame - first.frame) / fps

  const velocities = [
    [
      (last.x - first.x) / duration,
      (last.y - first.y) / duration - 0.5 * GRAVITY * duration,
      (last.z - first.z) / duration,
    ],
    [
      (early.x - first.x) / earlyDuration,
      (early.y - first.y) / earlyDuration - 0.5 * GRAVITY * earlyDuration,
      (early.z - first.z) / earlyDuration,
    ],
  ]

  return velocities.flatMap(velocity => INITIAL_DRAGS.map(drag => [
    first.x,
    first.y,
    first.z,
    ...velocity,
    Math.log(drag),
  ]))
}


function bestFit(observations, startFrame, endFrame, fps) {
  let best = null

  for (const guess of initialGuesses(observations, fps)) {
    const fit = levenbergMarquardt(guess, observations, startFrame, endFrame, fps)
    if (fit && (!best || fit.cost < best.cost)) best = fit
  }

  return best
}


/**
 * 用一段飛行裡 2D 標註來的點（observations：[{ frame, x, y, z }]，依
 * frame 排序）擬合 a = g − k|v|v 的軌跡。
 *
 * 錯點的處理：擬合後離軌跡超過 outlierDistance 的點剔除再擬合，最多
 * 幾輪；這取代了「離前後鄰點擬合的弧超過 0.5 m 就剔除」的檢查 —— 能
 * 不能接起來由整段的物理軌跡判斷，不再只看前後幾格。
 *
 * 回傳 null 表示接不起來（點太少、擬合發散、剔除太多、或剩下的點離
 * 軌跡的 RMS 超過 maxRms）。成功時回傳：
 *   { startFrame, endFrame, drag, rms, inliers: Set(frame), outliers: Set(frame),
 *     positionAt(frame) → { x, y, z } | null }
 * positionAt 只回傳 startFrame ~ endFrame（第一個到最後一個觀測點）之間；
 * extrapolateTo 可以推到範圍外（往前或往回積分），推越遠越不準。
 */
// 同一批點、同樣條件的擬合結果留著：補空檔的幾個步驟會對同一段重複擬合
const fitCache = new Map()
const FIT_CACHE_SIZE = 2000

export function fitPhysicalFlight(observations, fps, options = {}) {
  if (!observations?.length) return null

  const key = [
    fps,
    JSON.stringify(options),
    ...observations.map(point => `${point.frame}:${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)}`),
  ].join('|')

  if (fitCache.has(key)) return fitCache.get(key)

  const result = fitPhysicalFlightUncached(observations, fps, options)

  if (fitCache.size >= FIT_CACHE_SIZE) fitCache.clear()
  fitCache.set(key, result)

  return result
}


function fitPhysicalFlightUncached(observations, fps, {
  minPoints = 6,
  outlierDistance = 0.3,
  maxRms = 0.1,
  minInlierRatio = 0.7,
  rounds = 3,
} = {}) {
  if (!observations || observations.length < minPoints) return null

  let kept = observations

  for (let round = 0; round <= rounds; round += 1) {
    if (kept.length < minPoints) return null

    const startFrame = kept[0].frame
    const endFrame = kept[kept.length - 1].frame
    if (endFrame - startFrame < 2) return null

    const fit = bestFit(kept, startFrame, endFrame, fps)
    if (!fit) return null

    // 所有觀測點（含先前剔除的）重新判斷：每一輪都可能把好點找回來
    const span = simulate(fit.params, startFrame, endFrame, fps)
    const distanceOf = (point) => {
      const p = span?.get(point.frame)
      return p ? Math.hypot(p[0] - point.x, p[1] - point.y, p[2] - point.z) : Infinity
    }
    const next = observations.filter(point => distanceOf(point) <= outlierDistance)
    const sameSet = next.length === kept.length && next.every((point, i) => point.frame === kept[i].frame)

    if (sameSet || round === rounds) {
      const distances = kept.map(distanceOf)
      const rms = Math.sqrt(distances.reduce((sum, d) => sum + d * d, 0) / distances.length)

      if (rms > maxRms || kept.length < observations.length * minInlierRatio) return null

      const inliers = new Set(kept.map(point => point.frame))

      return {
        startFrame,
        endFrame,
        drag: Math.exp(fit.params[6]),
        rms,
        inliers,
        outliers: new Set(observations.filter(point => !inliers.has(point.frame)).map(point => point.frame)),
        positionAt: (frame) => {
          const p = span.get(frame)
          return p ? { x: p[0], y: p[1], z: p[2] } : null
        },
        // 觀測範圍外：沿著擬合的物理軌跡往前或往回推（只該推幾格）
        extrapolateTo: (frame) => {
          const p = span.get(frame) || positionFrom(fit.params, startFrame, frame, fps)
          return p ? { x: p[0], y: p[1], z: p[2] } : null
        },
      }
    }

    kept = next
  }

  return null
}
