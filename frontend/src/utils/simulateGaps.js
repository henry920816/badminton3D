/*
 * 純 2D 模式最後一步：把還空著的格子盡量模擬出來。
 *
 * 前面的步驟（重建點、接得起來的段用物理擬合補中間、往外推 5 格、10 格
 * 以內的短空檔內插）只補「有把握」的格子。這裡不管把握多少，能推就推：
 *
 *   1. 每段飛行（以擊球切段）的重建點擬合物理軌跡；接不起來的段先試著
 *      拆成兩段飛行（多半是段內漏抓了一次擊球），再不行就放寬條件擬合
 *   2. 相鄰兩段飛行之間：各自沿著物理軌跡往對方推，在擊球那一格交接；
 *      漏抓的擊球不知道在哪一格，就取兩條軌跡最靠近的那一格。兩邊在
 *      交接處對不上的差距，平均分給兩邊往外推的格子，交接處就接得上
 *   3. 最後一段之後：往外推到球落地或出界為止。第一個重建點之前是發球前，
 *      球還拿在發球員手上，不是在飛：不往回推（往回推會變成一條憑空飛起
 *      來的拋物線），固定在第一個重建點的位置
 *
 *      match 1 前 20 個 rally：第一次擊球前多半有 5~9 個重建點，速度約
 *      3 m/s、離地從 1.0 掉到 0.75 公尺 —— 發球員放開球、球往下掉；
 *      再之前（rally 開始到第一個重建點，20~60 格）沒有標註，球在手上
 *   4. 還剩的空檔：兩側的點之間接一條只受重力的拋物線（等加速度、不計
 *      阻力）。只用兩端的位置，不用速度 —— 用相鄰兩格差分出來的速度有
 *      雜訊，乘上很長的空檔會讓曲線鼓出去好幾公尺
 *
 * 補出來的點 source 都是 'simulated'，method 說明是哪一種：
 *   split    拆成兩段後的物理擬合（段內）
 *   relaxed  放寬條件的物理擬合（段內）
 *   bridge   往擊球推、在擊球處交接
 *   extend   最後一段之後往外推
 *   hold     發球前，固定在第一個重建點的位置
 *   arc      兩側的點之間接一條重力拋物線
 * 越後面的越不可靠。
 *
 * match 1 前 15 個 rally：rally 格數 5863，顯示 5514（94%），第一個到最後
 * 一個重建點之間全部補滿。藏掉連續 10 / 20 格真的重建點、看補回來差多少
 * （中位數 / p90，公分）：
 *   split    20 格  3.4 / 5.4
 *   arc      10 格  7.9 / 19      20 格 23.5 / 59
 *   extend   10 格 20.5 / 45      20 格 18.7 / 51
 * （bridge 在這個測試裡沒有樣本：藏起來的格子都不在擊球附近。）
 * 每個 rally 計算約 0.6 秒（最久 1.2 秒），之後同一批點的擬合有快取。
 */
import { fitPhysicalFlight } from './physicsFlight.js'

const FLOOR_Y = 0.5

// 物理擬合拆段時，兩邊各至少要有幾個點
const SPLIT_MIN_POINTS = 6
const SPLIT_MAX_CANDIDATES = 8

// 最後一段飛行的結尾離 rally 最後一個點不超過這麼多格，才從它往後推
const LAST_FLIGHT_SLACK = 5

// 放寬條件的擬合
const RELAXED_OPTIONS = { maxRms: 0.25, minInlierRatio: 0.5, outlierDistance: 0.5 }

// 往外推時，交接處兩邊差超過這個距離（公尺）就不信推出來的結果，改用
// 重力拋物線接
const MAX_BRIDGE_MISMATCH = 1.5

// 往外推的軌跡要留在這個範圍內（比球場大一些），出去就停
const WORLD_LIMIT = { x: 6, z: 9, minY: -14 }

const insideWorld = p => (
  Math.abs(p.x) <= WORLD_LIMIT.x
  && Math.abs(p.z) <= WORLD_LIMIT.z
  && p.y >= WORLD_LIMIT.minY
  && p.y <= FLOOR_Y
)

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)


// 一段觀測點擬合物理軌跡；接不起來就試拆兩段、再試放寬條件。
// 回傳 [{ fit, method }]（依時間排序），全失敗回傳 []
function fitSegment(observations, fps) {
  const strict = fitPhysicalFlight(observations, fps)
  if (strict) return [{ fit: strict, method: 'physics' }]

  let best = null
  // 每個切點要擬合兩次（各試多個起點），最多試 SPLIT_MAX_CANDIDATES 個切點
  const cuts = observations.length - 2 * SPLIT_MIN_POINTS + 1
  const stride = Math.max(1, Math.ceil(cuts / SPLIT_MAX_CANDIDATES))

  for (let cut = SPLIT_MIN_POINTS; cut <= observations.length - SPLIT_MIN_POINTS; cut += stride) {
    const left = fitPhysicalFlight(observations.slice(0, cut), fps)
    if (!left) continue
    const right = fitPhysicalFlight(observations.slice(cut), fps)
    if (!right) continue

    const cost = left.rms * left.inliers.size + right.rms * right.inliers.size
    if (!best || cost < best.cost) best = { cost, flights: [left, right] }
  }

  if (best) return best.flights.map(fit => ({ fit, method: 'split' }))

  const relaxed = fitPhysicalFlight(observations, fps, RELAXED_OPTIONS)

  return relaxed ? [{ fit: relaxed, method: 'relaxed' }] : []
}


const GRAVITY = 9.81


// 從 p0（第 0 格）到 p1（第 span 格）只受重力的拋物線，在第 k 格的位置。
// raw 座標 y 朝下，重力是 +y
function gravityArcPoint(p0, p1, k, span, fps) {
  const t = k / fps
  const duration = span / fps
  const vx = (p1.x - p0.x) / duration
  const vy = (p1.y - p0.y) / duration - 0.5 * GRAVITY * duration
  const vz = (p1.z - p0.z) / duration

  return {
    x: p0.x + vx * t,
    y: p0.y + vy * t + 0.5 * GRAVITY * t * t,
    z: p0.z + vz * t,
  }
}


/**
 * points：前面步驟的結果（依 frame 排序）。observations：重建點。
 * contacts：重建點偵測到的擊球。rangeStart / rangeEnd：rally 範圍。
 * 回傳補完的點（依 frame 排序）。
 */
export function simulateMissingFrames({ points, observations, contacts, fps, rangeStart, rangeEnd }) {
  if (!observations?.length || rangeStart == null || rangeEnd == null) return points

  const byFrame = new Map(points.map(point => [point.frame, point]))
  const setIfEmpty = (frame, position, method) => {
    if (byFrame.has(frame) || frame < rangeStart || frame > rangeEnd) return
    if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return
    byFrame.set(frame, { frame, x: position.x, y: position.y, z: position.z, source: 'simulated', method })
  }

  // 1. 每段飛行擬合（含拆段、放寬）
  const breakFrames = (contacts || []).map(contact => contact.frame).sort((a, b) => a - b)
  const segmentOf = frame => breakFrames.filter(breakFrame => breakFrame <= frame).length
  const groups = new Map()

  for (const point of [...observations].sort((a, b) => a.frame - b.frame)) {
    const segment = segmentOf(point.frame)
    if (!groups.has(segment)) groups.set(segment, [])
    groups.get(segment).push(point)
  }

  const flights = [...groups.values()]
    .flatMap(group => fitSegment(group, fps))
    .sort((a, b) => a.fit.startFrame - b.fit.startFrame)

  // 段內：拆段或放寬擬合的飛行，補自己範圍內還空著的格子
  for (const { fit, method } of flights) {
    if (method === 'physics') continue
    for (let frame = fit.startFrame; frame <= fit.endFrame; frame += 1) setIfEmpty(frame, fit.positionAt(frame), method)
  }

  // 2. 相鄰兩段飛行之間：往擊球推、交接
  for (let i = 0; i + 1 < flights.length; i += 1) {
    const before = flights[i].fit
    const after = flights[i + 1].fit
    const gapStart = before.endFrame + 1
    const gapEnd = after.startFrame - 1
    if (gapEnd < gapStart) continue

    // 空檔裡還有別的點（例如擬合不起來那段的重建點）就不推：推出來的格子
    // 會和真的點一格一格交錯，變成閃電。那些小空檔留給後面的拋物線接
    let occupied = false
    for (let frame = gapStart; frame <= gapEnd; frame += 1) if (byFrame.has(frame)) { occupied = true; break }
    if (occupied) continue

    const contact = breakFrames.find(frame => frame > before.endFrame && frame <= after.startFrame)
    let switchFrame

    if (contact != null) {
      switchFrame = Math.ceil(contact)
    } else {
      // 漏抓的擊球：兩條軌跡最靠近的那一格
      let closest = Infinity
      for (let frame = gapStart; frame <= gapEnd + 1; frame += 1) {
        const a = before.extrapolateTo(frame)
        const b = after.extrapolateTo(frame)
        if (!a || !b) continue
        const d = distance(a, b)
        if (d < closest) {
          closest = d
          switchFrame = frame
        }
      }
    }

    if (switchFrame == null) continue

    const a = before.extrapolateTo(switchFrame)
    const b = after.extrapolateTo(switchFrame)
    if (!a || !b) continue

    const mismatch = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
    if (Math.hypot(mismatch.x, mismatch.y, mismatch.z) > MAX_BRIDGE_MISMATCH) continue

    // 差距平均分給兩邊：前段往後推的格子加上 +一半（越接近交接越多），
    // 後段往回推的格子減掉一半
    const filled = []
    let valid = true

    for (let frame = gapStart; frame <= gapEnd; frame += 1) {
      const useBefore = frame < switchFrame
      const raw = useBefore ? before.extrapolateTo(frame) : after.extrapolateTo(frame)
      if (!raw || !insideWorld(raw)) { valid = false; break }

      const weight = useBefore
        ? (frame - before.endFrame) / (switchFrame - before.endFrame)
        : (after.startFrame - frame) / (after.startFrame - switchFrame)
      const sign = useBefore ? 0.5 : -0.5

      filled.push([frame, {
        x: raw.x + sign * weight * mismatch.x,
        y: raw.y + sign * weight * mismatch.y,
        z: raw.z + sign * weight * mismatch.z,
      }])
    }

    if (valid) for (const [frame, position] of filled) setIfEmpty(frame, position, 'bridge')
  }

  // 3. 發球前固定在第一個重建點；最後一段之後推到落地或出界
  const firstFrame = Math.min(...byFrame.keys())

  if (Number.isFinite(firstFrame)) {
    const held = byFrame.get(firstFrame)
    for (let frame = rangeStart; frame < firstFrame; frame += 1) setIfEmpty(frame, held, 'hold')
  }

  if (flights.length) {
    const last = flights[flights.length - 1].fit
    const lastShown = Math.max(...byFrame.keys())

    // 只在 rally 最後一個點之後推，而且最後這段飛行要真的是資料的最後一段
    // （之後還有擬合不起來的點時，從前一段往後推會和那些點交錯成閃電）
    if (lastShown - last.endFrame <= LAST_FLIGHT_SLACK) {
      for (let frame = lastShown + 1; frame <= rangeEnd; frame += 1) {
        const position = last.extrapolateTo(frame)
        if (!position || !insideWorld(position)) break
        setIfEmpty(frame, position, 'extend')
      }
    }
  }

  // 4. 還剩的空檔：兩側的點之間接重力拋物線
  const frames = [...byFrame.keys()].sort((a, b) => a - b)

  for (let i = 0; i + 1 < frames.length; i += 1) {
    const start = frames[i]
    const end = frames[i + 1]
    if (end - start < 2) continue

    const p0 = byFrame.get(start)
    const p1 = byFrame.get(end)
    const span = end - start

    for (let frame = start + 1; frame < end; frame += 1) {
      setIfEmpty(frame, gravityArcPoint(p0, p1, frame - start, span, fps), 'arc')
    }
  }

  return [...byFrame.values()].sort((a, b) => a.frame - b.frame)
}
