import { useEffect } from 'react'
import { api } from '../api.js'
import { useAppStore } from '../store.js'

// 切換資料集時，把時間軸和球軌跡一起換掉。舊請求晚回來也不能蓋掉新資料。
export function useMatchBootstrap(matchId) {
  const setMatchMeta = useAppStore(state => state.setMatchMeta)
  const setTimelineData = useAppStore(state => state.setTimelineData)
  const setReplaySegments = useAppStore(state => state.setReplaySegments)
  const upsertTrajPoints = useAppStore(state => state.upsertTrajPoints)
  const resetTrajCache = useAppStore(state => state.resetTrajCache)

  useEffect(() => {
    let cancelled = false
    resetTrajCache()

    if (matchId == null) {
      setMatchMeta({ fps: 50, duration_frame: 0, cameras: [] })
      setTimelineData({ rallies: [], hits: [], anomalies: [] })
      setReplaySegments([])
      return () => { cancelled = true }
    }

    const load = async () => {
      try {
        const match = await api.getMatch(matchId)
        if (cancelled) return
        setMatchMeta(match)

        const timeline = await api.getTimeline(matchId)
        if (cancelled) return
        setTimelineData(timeline)
        setReplaySegments((timeline.rallies || []).map(rally => ({
          id: `rally-${rally.id}`,
          rally_id: rally.id,
          rally_index: rally.rally_index,
          start_frame: rally.start_frame,
          end_frame: rally.end_frame,
          score: rally.score,
          up_court: rally.up_court,
          down_court: rally.down_court,
          players: rally.players || [],
          fps: match.fps,
          duration_sec: (rally.end_frame - rally.start_frame + 1) / (match.fps || 50),
        })))

        const points = await api.getTraj(matchId, 0, match.duration_frame)
        if (!cancelled) upsertTrajPoints(points)
      } catch (error) {
        if (cancelled) return
        console.error('資料集載入失敗:', error)
        alert('後端連線或資料載入失敗，請確認 Docker 已啟動。\n' + String(error))
      }
    }

    void load()
    return () => { cancelled = true }
  }, [matchId, resetTrajCache, setMatchMeta, setTimelineData, setReplaySegments, upsertTrajPoints])
}
