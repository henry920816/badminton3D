import React, { useEffect, useRef } from 'react'
import Split from 'react-split'
import { api } from './api.js'
import { useAppStore } from './store.js'
import TopBar from './components/TopBar.jsx'
import Scene3D from './components/Scene3D.jsx'
import VideoPanel from './components/VideoPanel.jsx'
import TimelinePanel from './components/TimelinePanel.jsx'
import RightDock from './components/RightDock.jsx'

import './styles.css'

export default function App() {
  const matchId = useAppStore(s => s.matchId)
  const setMatchMeta = useAppStore(s => s.setMatchMeta)
  const setTimelineData = useAppStore(s => s.setTimelineData)
  const upsertTrajPoints = useAppStore(s => s.upsertTrajPoints)
  const fps = useAppStore(s => s.fps)

  const verticalSplitRef = useRef(null)

  // load match + timeline, preload a window of trajectory
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
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden flex flex-col">
      <TopBar />
      <Split 
        sizes={[80, 20]} 
        minSize={[250, 0]}
        expandToMin={false}
        gutterSize={8}
        gutterAlign="center"
        snapOffset={30}
        dragInterval={1}
        direction="horizontal"
        className="flex flex-row flex-1 min-h-0 overflow-hidden"
      >
        <Split 
          sizes={[50, 50]} 
          minSize={[200, 0]}
          maxSize={[Infinity, 350]}
          direction="vertical" 
          gutterSize={8}
          snapOffset={30}
          className="flex flex-col flex-1 min-w-0"
        >
          {/* top: 3D + Video */}
          <Split 
            sizes={[50, 50]} 
            minSize={[200, 0]}
            direction="horizontal" 
            gutterSize={8}
            snapOffset={30}
            className="flex flex-row flex-1"
          >
            <div className="relative">
              <div className="absolute z-10 top-2 left-2 text-xs font-semibold px-2 py-1 rounded bg-zinc-900/70 border border-zinc-800">
                3D Replay (raw points)
              </div>
              <Scene3D />
            </div>
            <div className="relative overflow-hidden">
              <div className="absolute z-10 top-2 left-2 text-xs font-semibold px-2 py-1 rounded bg-zinc-900/70 border border-zinc-800">
                Source Video
              </div>
              <VideoPanel />
            </div>
          </Split>

          {/* bottom: timeline */}
          <div className="min-h-0 relative overflow-hidden">
            <TimelinePanel />
          </div>
        </Split>

        {/* right dock */}
        <div className="h-full overflow-hidden">
          <RightDock />
        </div>
      </Split>
    </div>
  )
}
