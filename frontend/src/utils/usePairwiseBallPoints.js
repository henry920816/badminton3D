import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAppStore } from '../store.js'


// 一個 rally 要算 0.4~3.6 秒，來回切換 rally 時不要重算
const cache = new Map()


function loadPairwiseBallPoints(matchId, startFrame, endFrame, revision) {
  const key = `${matchId}:${startFrame}:${endFrame}:${revision}`

  // 修復多次後，已失效的版本不應永久留在記憶體。
  if (cache.size > 100) cache.clear()

  if (!cache.has(key)) {
    const request = api.getPairwiseBallPoints(matchId, startFrame, endFrame)
      .catch((err) => {
        cache.delete(key)
        throw err
      })

    cache.set(key, request)
  }

  return cache.get(key)
}


/**
 * 這段範圍裡每一格用 2D 羽球標註兩兩重建的 3D 點（各相機組合的中位數），
 * 座標和 ball_traj 相同。
 *
 * status：'idle' 沒有範圍、'loading'、'ready'、'error'。
 */
export function usePairwiseBallPoints(matchId, startFrame, endFrame) {
  const revision = useAppStore(state => state.pairwiseRevision)
  const key = matchId != null && startFrame != null && endFrame != null
    ? `${matchId}:${startFrame}:${endFrame}:${revision}`
    : null

  const [loaded, setLoaded] = useState({ key: null, status: 'idle', points: null })

  useEffect(() => {
    if (!key) return undefined

    let cancelled = false

    setLoaded({ key, status: 'loading', points: null })

    loadPairwiseBallPoints(matchId, startFrame, endFrame, revision)
      .then((points) => {
        if (!cancelled) setLoaded({ key, status: 'ready', points: points || [] })
      })
      .catch((err) => {
        console.warn('Pairwise ball reconstruction unavailable:', err)
        if (!cancelled) setLoaded({ key, status: 'error', points: null })
      })

    return () => {
      cancelled = true
    }
  }, [key])

  // 換範圍後、新結果回來前，舊的點屬於別的 rally，不能沿用
  if (!key) return { status: 'idle', points: null }
  if (loaded.key !== key) return { status: 'loading', points: null }

  return loaded
}
