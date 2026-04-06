import React, { useEffect } from 'react'
import { api } from './api.js'
import { useAppStore } from './store.js'
import TopBar from './components/TopBar.jsx'
import Scene3D from './components/Scene3D.jsx'
import VideoPanel from './components/VideoPanel.jsx'
import TimelinePanel from './components/TimelinePanel.jsx'
import RightDock from './components/RightDock.jsx'

export default function App() {
  const matchId = useAppStore(s => s.matchId)
  const setMatchMeta = useAppStore(s => s.setMatchMeta)
  const setTimelineData = useAppStore(s => s.setTimelineData)
  const upsertTrajPoints = useAppStore(s => s.upsertTrajPoints)
  const fps = useAppStore(s => s.fps)

  useEffect(() => {
    (async () => {
      const m = await api.getMatch(matchId)
      setMatchMeta(m)

      const tl = await api.getTimeline(matchId)
      setTimelineData(tl)

      const start = 0
      const end = m.duration_frame
      const pts = await api.getTraj(matchId, start, end)
      upsertTrajPoints(pts)
    })().catch(err => {
      console.error(err)
      alert('Backend 連不上或資料載入失敗。請先啟動 docker-compose。\n' + String(err))
    })
  }, [matchId])

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <TopBar />
      <div className="flex h-[calc(100vh-44px)]">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex h-[45%] border-b border-zinc-800">
            <div className="w-1/2 border-r border-zinc-800 relative">
              <div className="absolute z-10 top-2 left-2 text-xs font-semibold px-2 py-1 rounded bg-zinc-900/70 border border-zinc-800">
                3D Replay (raw points)
              </div>
              <Scene3D />
            </div>
            <div className="w-1/2 relative">
              <div className="absolute z-10 top-2 left-2 text-xs font-semibold px-2 py-1 rounded bg-zinc-900/70 border border-zinc-800">
                Source Video
              </div>
              <VideoPanel />
            </div>
          </div>

          <div className="h-[55%] min-h-0">
            <TimelinePanel />
          </div>
        </div>

        <RightDock />
      </div>
    </div>
  )
}
