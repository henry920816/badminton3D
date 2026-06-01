import React, { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { useAppStore } from './store.js'
import TopBar from './components/TopBar.jsx'
import Scene3D from './components/Scene3D.jsx'
import VideoPanel from './components/VideoPanel.jsx'
import TimelinePanel from './components/TimelinePanel.jsx'
import Projection2DPanel from './components/Projection2DPanel.jsx'
import RightDock from './components/RightDock.jsx'

const PRELOAD_RADIUS_FRAMES = 300

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export default function App() {
  const matchId = useAppStore(s => s.matchId)
  const setMatchMeta = useAppStore(s => s.setMatchMeta)
  const setTimelineData = useAppStore(s => s.setTimelineData)
  const upsertTrajPoints = useAppStore(s => s.upsertTrajPoints)
  const markTrajRangeLoaded = useAppStore(s => s.markTrajRangeLoaded)
  const hasTrajRangeLoaded = useAppStore(s => s.hasTrajRangeLoaded)
  const resetTrajCache = useAppStore(s => s.resetTrajCache)
  const currentFrame = useAppStore(s => s.currentFrame)
  const fps = useAppStore(s => s.fps)
  const durationSec = useAppStore(s => s.durationSec)
  const activeItem = useAppStore(s => s.activeItem)
  const bottomView = useAppStore(s => s.bottomView)

  const bootstrapDoneRef = useRef(false)
  const inflightRef = useRef(new Set())

  const mainWrapRef = useRef(null)
  const centerWrapRef = useRef(null)
  const topAreaRef = useRef(null)

  const [topHeightPct, setTopHeightPct] = useState(58)
  const [leftTopWidthPct, setLeftTopWidthPct] = useState(50)
  const [rightPanelWidth, setRightPanelWidth] = useState(360)

  const showRightDock = Boolean(activeItem?.type)

  useEffect(() => {
    bootstrapDoneRef.current = false
    inflightRef.current = new Set()
    resetTrajCache()

    ;(async () => {
      const match = await api.getMatch(matchId)
      setMatchMeta(match)

      const timeline = await api.getTimeline(matchId)
      setTimelineData(timeline)

      const preloadStart = 0
      const preloadEnd = match.duration_frame
      const points = await api.getTraj(matchId, preloadStart, preloadEnd)

      upsertTrajPoints(points)
      markTrajRangeLoaded(preloadStart, preloadEnd)

      bootstrapDoneRef.current = true
    })().catch(err => {
      console.error(err)
      alert('Backend 連不上或資料載入失敗。請先啟動 docker-compose。\n' + String(err))
    })
  }, [matchId, resetTrajCache, setMatchMeta, setTimelineData, upsertTrajPoints, markTrajRangeLoaded])

  useEffect(() => {
    if (!bootstrapDoneRef.current) return

    const durationFrame = Math.max(0, Math.round((durationSec || 0) * (fps || 0)))
    const start = Math.max(0, currentFrame - PRELOAD_RADIUS_FRAMES)
    const end = durationFrame > 0
      ? Math.min(durationFrame, currentFrame + PRELOAD_RADIUS_FRAMES)
      : currentFrame + PRELOAD_RADIUS_FRAMES

    if (hasTrajRangeLoaded(start, end)) return

    const key = `${start}-${end}`
    if (inflightRef.current.has(key)) return
    inflightRef.current.add(key)

    ;(async () => {
      try {
        const points = await api.getTraj(matchId, start, end)
        upsertTrajPoints(points)
        markTrajRangeLoaded(start, end)
      } catch (err) {
        console.error(err)
      } finally {
        inflightRef.current.delete(key)
      }
    })()
  }, [matchId, currentFrame, fps, durationSec, hasTrajRangeLoaded, upsertTrajPoints, markTrajRangeLoaded])

  const startResizeTopBottom = (e) => {
    e.preventDefault()
    const wrap = centerWrapRef.current
    if (!wrap) return

    const rect = wrap.getBoundingClientRect()

    const onMove = (ev) => {
      const y = ev.clientY - rect.top
      const pct = (y / rect.height) * 100
      setTopHeightPct(clamp(pct, 42, 72))
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startResizeLeftRightTop = (e) => {
    e.preventDefault()
    const wrap = topAreaRef.current
    if (!wrap) return

    const rect = wrap.getBoundingClientRect()

    const onMove = (ev) => {
      const x = ev.clientX - rect.left
      const pct = (x / rect.width) * 100
      setLeftTopWidthPct(clamp(pct, 20, 80))
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startResizeMainAndDock = (e) => {
    e.preventDefault()
    const wrap = mainWrapRef.current
    if (!wrap) return

    const rect = wrap.getBoundingClientRect()

    const onMove = (ev) => {
      const nextWidth = rect.right - ev.clientX
      setRightPanelWidth(clamp(nextWidth, 260, 700))
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const bottomHeightPct = 100 - topHeightPct
  const rightDockPx = `${rightPanelWidth}px`

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <TopBar />

      <div
        ref={mainWrapRef}
        className="flex h-[calc(100vh-44px)] min-h-0 w-full"
      >
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div
            ref={centerWrapRef}
            className="flex-1 min-h-0 flex flex-col"
          >
            <div
              ref={topAreaRef}
              className="flex min-h-0 border-b border-zinc-800 relative"
              style={{ height: `${topHeightPct}%` }}
            >
              <div
                className="min-w-0 min-h-0 border-r border-zinc-800 relative"
                style={{ width: `${leftTopWidthPct}%` }}
              >
                <div className="absolute z-10 top-2 left-2 text-xs font-semibold px-2 py-1 rounded bg-zinc-900/70 border border-zinc-800">
                  3D Replay (raw points)
                </div>
                <Scene3D />
              </div>

              <div
                onMouseDown={startResizeLeftRightTop}
                className="w-[4px] shrink-0 cursor-col-resize bg-zinc-950 hover:bg-zinc-900 active:bg-zinc-800 transition-colors relative z-20"
                title="拖拉調整 3D / 影片 寬度"
              >
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1px] bg-zinc-800" />
              </div>

              <div className="flex-1 min-w-0 min-h-0 relative">
                <div className="absolute z-10 top-2 left-2 text-xs font-semibold px-2 py-1 rounded bg-zinc-900/70 border border-zinc-800">
                  Source Video
                </div>
                <VideoPanel />
              </div>
            </div>

            <div
              onMouseDown={startResizeTopBottom}
              className="h-[4px] shrink-0 cursor-row-resize bg-zinc-950 hover:bg-zinc-900 active:bg-zinc-800 transition-colors relative z-20"
              title="拖拉調整 上方 / Timeline 高度"
            >
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-zinc-800" />
            </div>

            <div
              className="min-h-0"
              style={{ height: `${bottomHeightPct}%` }}
            >
              {bottomView === 'projection2d' ? <Projection2DPanel /> : <TimelinePanel />}
            </div>
          </div>
        </div>

        {showRightDock && (
          <>
            <div
              onMouseDown={startResizeMainAndDock}
              className="w-[4px] shrink-0 cursor-col-resize bg-zinc-950 hover:bg-zinc-900 active:bg-zinc-800 transition-colors relative z-20"
              title="拖拉調整 主畫面 / 右側 Panel 寬度"
            >
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1px] bg-zinc-800" />
            </div>

            <div
              className="shrink-0 min-h-0"
              style={{ width: rightDockPx }}
            >
              <RightDock />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
