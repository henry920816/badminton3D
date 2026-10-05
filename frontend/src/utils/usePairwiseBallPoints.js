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
const consensusCache = createCache(api.getPairwiseBallPoints)
const viewCache = createCache(api.getPairwiseViewPoints)
const visibleCache = createCache(api.getBall2DVisibleRows)


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
