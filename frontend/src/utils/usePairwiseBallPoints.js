import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useAppStore } from '../store.js'


function createCache(fetcher) {
  return {
    fetcher,
    // key -> { matchId, startFrame, endFrame, source, points, request }
    entries: new Map(),
    // 單格重算的請求，同一次修正只打一次後端（多個元件都用這個 hook）
    refreshes: new Map(),
  }
}


// 一個 rally 要算 0.4~3.6 秒，來回切換 rally 時不要重算
/**
 * 只在球夠近時才拿來重建 3D 的相機：{ 相機編號: 公尺 }。
 *
 * cam 3、4 在底線後順著球場長邊看。match 1 前 30 個 rally 實測，用不含
 * 3、4 的重建點（3 台以上）當真值，標註視線到真值的距離中位數：
 *   cam 3：4 公尺內 10~11、5~7 公尺 7~8、7 公尺以外 13~21 公分
 *   cam 4：4~5 公尺 5（樣本少）、5~7 公尺 11、7 公尺以外 19~42 公分
 *   側邊相機（例如 cam 1、6）：1.3~2.4 公分，不隨距離變
 * 即使在最近的範圍，3、4 也比側邊差好幾倍，所以只取它們誤差最小的範圍。
 *
 * 和完全不用 3、4 比（前 8 個 rally，每次留一台側邊相機不參與重建，看
 * 重建點在那台的重投影）：2 組以上的重建格數 6306 → 6960（+10%），同一批
 * 格子的誤差 11.1 → 11.2 px 不變；上限放寬到兩台都 7 公尺時格數 7244、
 * 誤差也一樣，但 cam 4 自己在 5 公尺外的誤差加倍，不放寬；完全不設限
 * 時格數 8064，但誤差變 12.3 px（p90 38 → 40）。
 *
 * 兩兩重建（含只有 2 台的格子）和只有 1 台的格子都套用；時間軸的各視角
 * 距離 / 速度仍然畫全部相機，方便比對。
 */
export const RECONSTRUCTION_CAMERA_MAX_DISTANCE = { 3: 7, 4: 5 }

/**
 * 兩兩重建時「同意」的像素門檻：配對的重建點投影回某台相機，和那台的
 * 標註差在這個距離內才算那台同意。影片上 2D 標註的空心圓就畫這個半徑，
 * 3D→2D 的紅點落在圓裡就是同意。
 *
 * 羽球（裙擺半徑約 3.4 公分）在各相機畫面上的半徑約 7~9 px（中位數 8），
 * 標註落在羽球任何一處都算對，後端原本的 12 px 只比一個半徑大一點。
 * match 1 前 8 個 rally，每次留一台側邊相機不參與重建、看重建點在那台
 * 的重投影：
 *   門檻   2 組以上的重建格數   重投影 med / p90（全部格子）
 *   12 px        6960            11.3 / 29.9
 *   16 px        8371            11.3 / 29.6
 *   20 px        9358            11.2 / 29.6
 *   25 px       10186            11.6 / 31.0
 *   30 px       10753            11.7 / 31.2
 * 20 px（約一顆羽球的直徑再多一點）多重建 34% 的格子、準確度不變；
 * 再放寬，新加進來的格子開始比較差。
 */
export const RECONSTRUCTION_AGREEMENT_PX = 20

const consensusCache = createCache(
  (matchId, startFrame, endFrame, source) => api.getPairwiseBallPoints(
    matchId,
    startFrame,
    endFrame,
    source,
    RECONSTRUCTION_CAMERA_MAX_DISTANCE,
    RECONSTRUCTION_AGREEMENT_PX,
  ),
)
const viewCache = createCache(api.getPairwiseViewPoints)
const visibleCache = createCache(api.getBall2DVisibleRows)


// 這段範圍裡所有有 2D 標註的相機的標註點（[{ frame, camera_index, x, y }]，
// 只留看得見的），2D 修正的引導線和時間軸的標註一致用。單格重算時
// start = end = 那一格
async function fetchRangeLabels(matchId, startFrame, endFrame, source) {
  const cameras = (useAppStore.getState().cameras || [])
    .filter(camera => camera?.has_ball_2d && camera?.projection)

  const perCamera = await Promise.all(cameras.map(camera => (
    api.getTraj2D(matchId, camera.index, startFrame, endFrame, source)
  )))

  return perCamera
    .flat()
    .filter(row => row && row.visibility > 0)
    .map(row => ({ frame: row.frame, camera_index: row.camera_index, x: row.x, y: row.y }))
    .sort((a, b) => a.frame - b.frame || a.camera_index - b.camera_index)
}

const labelCache = createCache(fetchRangeLabels)


function loadCached(cache, matchId, startFrame, endFrame, revision, source) {
  const key = `${matchId}:${startFrame}:${endFrame}:${revision}:${source}`

  // 修復多次後，已失效的版本不應永久留在記憶體。
  if (cache.entries.size > 100) cache.entries.clear()

  if (!cache.entries.has(key)) {
    const entry = { matchId, startFrame, endFrame, source, points: null, request: null }

    entry.request = cache.fetcher(matchId, startFrame, endFrame, source)
      .then((points) => {
        entry.points = points || []
        return entry.points
      })
      .catch((err) => {
        cache.entries.delete(key)
        throw err
      })

    cache.entries.set(key, entry)
  }

  return cache.entries.get(key).request
}


/**
 * 一格的 2D 標註修正後只重算那一格：兩兩重建每一格各自獨立，
 * 不必把整個 rally 重抓一次。把結果換進所有涵蓋這一格的快取。
 */
function refreshFrame(cache, matchId, frame, source, seq) {
  const refreshKey = `${matchId}:${frame}:${source}:${seq}`

  if (!cache.refreshes.has(refreshKey)) {
    if (cache.refreshes.size > 50) cache.refreshes.clear()

    const request = cache.fetcher(matchId, frame, frame, source)
      .then((rows) => {
        for (const entry of cache.entries.values()) {
          if (
            entry.points
            && entry.matchId === matchId
            && entry.source === source
            && frame >= entry.startFrame
            && frame <= entry.endFrame
          ) {
            entry.points = [
              ...entry.points.filter(point => point.frame !== frame),
              ...(rows || []),
            ].sort(
              (a, b) => a.frame - b.frame || (a.camera_index ?? 0) - (b.camera_index ?? 0),
            )
            entry.request = Promise.resolve(entry.points)
          }
        }
      })
      .catch((err) => {
        cache.refreshes.delete(refreshKey)
        throw err
      })

    cache.refreshes.set(refreshKey, request)
  }

  return cache.refreshes.get(refreshKey)
}


function usePairwiseRequest(cache, matchId, startFrame, endFrame) {
  const revision = useAppStore(state => state.pairwiseRevision)
  // 原始或修正後的 2D 標註，兩種結果分開快取
  const source = useAppStore(state => state.ball2DSource)
  const correctionTick = useAppStore(state => state.ball2DCorrectionTick)
  const key = matchId != null && startFrame != null && endFrame != null
    ? `${matchId}:${startFrame}:${endFrame}:${revision}:${source}`
    : null

  const [loaded, setLoaded] = useState({ key: null, status: 'idle', points: null })
  const keyRef = useRef(key)
  keyRef.current = key

  useEffect(() => {
    if (!key) return undefined

    let cancelled = false

    setLoaded({ key, status: 'loading', points: null })

    loadCached(cache, matchId, startFrame, endFrame, revision, source)
      .then((points) => {
        if (!cancelled) setLoaded({ key, status: 'ready', points })
      })
      .catch((err) => {
        console.warn('Pairwise ball reconstruction unavailable:', err)
        if (!cancelled) setLoaded({ key, status: 'error', points: null })
      })

    return () => {
      cancelled = true
    }
  }, [key])

  // 修正只影響「修正後」的結果；連續修正時每一格各自補上，
  // 不取消前一個，否則先送出的那格可能補不進畫面
  useEffect(() => {
    if (
      !key
      || !correctionTick
      || source !== 'corrected'
      || correctionTick.matchId !== matchId
      || correctionTick.frame < startFrame
      || correctionTick.frame > endFrame
    ) {
      return
    }

    refreshFrame(cache, matchId, correctionTick.frame, source, correctionTick.seq)
      .then(() => {
        const entry = cache.entries.get(key)
        if (keyRef.current === key && entry?.points) {
          setLoaded({ key, status: 'ready', points: entry.points })
        }
      })
      .catch((err) => {
        console.warn('Pairwise frame refresh failed:', err)
      })
  }, [correctionTick])

  // 換範圍後、新結果回來前，舊的點屬於別的 rally，不能沿用
  if (!key) return { status: 'idle', points: null }
  if (loaded.key !== key) return { status: 'loading', points: null }

  return loaded
}


/**
 * 這段範圍裡每一格用 2D 羽球標註兩兩重建的 3D 點（各相機組合的中位數），
 * 座標和 ball_traj 相同。
 *
 * status：'idle' 沒有範圍、'loading'、'ready'、'error'。
 */
export function usePairwiseBallPoints(matchId, startFrame, endFrame) {
  return usePairwiseRequest(consensusCache, matchId, startFrame, endFrame)
}


/**
 * 同一段範圍裡每一格、每個相機視角各一個兩兩重建點
 * （{ frame, camera_index, x, y, z, distance, pair_count }），
 * 做法同 triangulation_3Dline.py，時間軸拿來畫各視角的距離與速度。
 */
export function usePairwiseViewPoints(matchId, startFrame, endFrame) {
  return usePairwiseRequest(viewCache, matchId, startFrame, endFrame)
}


/**
 * 同一段範圍裡每一格有哪些相機看得見羽球（[{ frame, camera_index }]）。
 * 不是重建結果，但同樣逐格獨立，借用同一套快取與單格重算，
 * 修正一格後只補那一格。
 */
export function useBall2DVisibleRows(matchId, startFrame, endFrame) {
  return usePairwiseRequest(visibleCache, matchId, startFrame, endFrame)
}


/**
 * 同一段範圍裡各相機的 2D 羽球標註（[{ frame, camera_index, x, y }]），
 * 2D 修正的引導線和時間軸的標註一致軌道用。同樣跟著 2D 來源與單格修正更新。
 */
export function useBall2DRangeLabels(matchId, startFrame, endFrame) {
  return usePairwiseRequest(labelCache, matchId, startFrame, endFrame)
}
