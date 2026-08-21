import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store.js'
import { PlaybackUI } from './TimelinePanel.jsx'

const COURT_WIDTH = 6.1
const COURT_LENGTH = 13.4
const TRAIL_SEC = 0.8

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function getVisiblePoints({ selection, currentFrame, fps, rallies, trajMap }) {
  if (!trajMap || trajMap.size === 0) return []

  let startFrame = null
  let endFrame = null

  if (selection?.inTime != null && selection?.outTime != null) {
    startFrame = Math.max(0, Math.floor(Math.min(selection.inTime, selection.outTime) * fps))
    endFrame = Math.max(0, Math.ceil(Math.max(selection.inTime, selection.outTime) * fps))
  } else {
    const sorted = [...(rallies || [])].sort((a, b) => a.start_frame - b.start_frame)
    const target = sorted.find((rally) => currentFrame <= rally.end_frame)

    if (target) {
      startFrame = target.start_frame
      endFrame = target.end_frame
    }
  }

  if (startFrame == null || endFrame == null) {
    const radius = Math.max(1, Math.round(fps * 3))
    startFrame = Math.max(0, currentFrame - radius)
    endFrame = currentFrame + radius
  }

  const points = []
  for (let frame = startFrame; frame <= endFrame; frame++) {
    const point = trajMap.get(frame)
    if (point) points.push(point)
  }

  return points
}

function findNearest(items, getScore) {
  let best = null
  let bestScore = Infinity

  for (const item of items) {
    const score = getScore(item)
    if (score < bestScore) {
      best = item
      bestScore = score
    }
  }

  return best
}

function usePanelSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [ref])

  return size
}

function getAxes(view) {
  if (view === 'side') {
    return {
      title: 'Side view',
      xLabel: 'court depth z',
      yLabel: 'height -y',
      getX: (p) => p.z,
      getY: (p) => -p.y,
      minX: -COURT_LENGTH / 2,
      maxX: COURT_LENGTH / 2,
      minY: 0,
      maxY: null,
      includeDataRange: true,
      court: false,
    }
  }

  if (view === 'front') {
    return {
      title: 'Front view',
      xLabel: 'court width x',
      yLabel: 'height -y',
      getX: (p) => p.x,
      getY: (p) => -p.y,
      minX: -COURT_WIDTH / 2,
      maxX: COURT_WIDTH / 2,
      minY: 0,
      maxY: null,
      includeDataRange: true,
      court: false,
    }
  }

  return {
    title: 'Top view',
    xLabel: 'court width x',
    yLabel: 'court depth z',
    getX: (p) => p.x,
    getY: (p) => p.z,
    minX: -COURT_WIDTH / 2,
    maxX: COURT_WIDTH / 2,
    minY: -COURT_LENGTH / 2,
    maxY: COURT_LENGTH / 2,
    includeDataRange: true,
    court: true,
  }
}

function drawCourt(ctx, mapPoint) {
  const lines = [
    [[-COURT_WIDTH / 2, -COURT_LENGTH / 2], [COURT_WIDTH / 2, -COURT_LENGTH / 2]],
    [[COURT_WIDTH / 2, -COURT_LENGTH / 2], [COURT_WIDTH / 2, COURT_LENGTH / 2]],
    [[COURT_WIDTH / 2, COURT_LENGTH / 2], [-COURT_WIDTH / 2, COURT_LENGTH / 2]],
    [[-COURT_WIDTH / 2, COURT_LENGTH / 2], [-COURT_WIDTH / 2, -COURT_LENGTH / 2]],
    [[-COURT_WIDTH / 2, 0], [COURT_WIDTH / 2, 0]],
    [[-COURT_WIDTH / 2, 1.98], [COURT_WIDTH / 2, 1.98]],
    [[-COURT_WIDTH / 2, -1.98], [COURT_WIDTH / 2, -1.98]],
    [[-COURT_WIDTH / 2, COURT_LENGTH / 2 - 0.76], [COURT_WIDTH / 2, COURT_LENGTH / 2 - 0.76]],
    [[-COURT_WIDTH / 2, -(COURT_LENGTH / 2 - 0.76)], [COURT_WIDTH / 2, -(COURT_LENGTH / 2 - 0.76)]],
    [[COURT_WIDTH / 2 - 0.46, -COURT_LENGTH / 2], [COURT_WIDTH / 2 - 0.46, COURT_LENGTH / 2]],
    [[-(COURT_WIDTH / 2 - 0.46), -COURT_LENGTH / 2], [-(COURT_WIDTH / 2 - 0.46), COURT_LENGTH / 2]],
  ]

  ctx.strokeStyle = 'rgba(244, 244, 245, 0.9)'
  ctx.lineWidth = 1.3
  for (const [from, to] of lines) {
    const a = mapPoint({ x: from[0], y: from[1] })
    const b = mapPoint({ x: to[0], y: to[1] })
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  const netA = mapPoint({ x: -COURT_WIDTH / 2 - 0.18, y: 0 })
  const netB = mapPoint({ x: COURT_WIDTH / 2 + 0.18, y: 0 })
  ctx.strokeStyle = '#facc15'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(netA.x, netA.y)
  ctx.lineTo(netB.x, netB.y)
  ctx.stroke()
}

function ProjectionChart({
  view,
  points,
  hits,
  anomalies,
  currentFrame,
  fps,
  setCurrentFrame,
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const draggingRef = useRef(false)
  const pointAreasRef = useRef([])
  const size = usePanelSize(wrapRef)

  const axes = getAxes(view)
  const currentPoint = useMemo(() => {
    if (!points.length) return null
    return findNearest(points, (point) => Math.abs(point.frame - currentFrame))
  }, [points, currentFrame])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width <= 0 || size.height <= 0) return

    const ctx = canvas.getContext('2d')
    const scale = window.devicePixelRatio || 1
    canvas.width = Math.max(1, size.width * scale)
    canvas.height = Math.max(1, size.height * scale)
    ctx.setTransform(scale, 0, 0, scale, 0, 0)

    const w = size.width
    const h = size.height
    const pad = { left: 44, right: 16, top: 34, bottom: 34 }
    const chartW = Math.max(1, w - pad.left - pad.right)
    const chartH = Math.max(1, h - pad.top - pad.bottom)
    pointAreasRef.current = []

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#09090b'
    ctx.fillRect(0, 0, w, h)

    ctx.fillStyle = '#e4e4e7'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(axes.title, 12, 10)

    if (!points.length) {
      ctx.fillStyle = '#71717a'
      ctx.font = '13px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('No trajectory data', w / 2, h / 2)
      return
    }

    const valuesX = points.map(axes.getX).filter(Number.isFinite)
    const valuesY = points.map(axes.getY).filter(Number.isFinite)
    const dataMinX = valuesX.length ? Math.min(...valuesX) : 0
    const dataMaxX = valuesX.length ? Math.max(...valuesX) : 1
    const dataMinY = valuesY.length ? Math.min(...valuesY) : 0
    const dataMaxY = valuesY.length ? Math.max(...valuesY) : 1

    const baseMinX = axes.minX ?? dataMinX
    const baseMaxX = axes.maxX ?? dataMaxX
    const baseMinY = axes.minY ?? dataMinY
    const baseMaxY = axes.maxY ?? dataMaxY

    let minX = axes.includeDataRange ? Math.min(baseMinX, dataMinX) : baseMinX
    let maxX = axes.includeDataRange ? Math.max(baseMaxX, dataMaxX) : baseMaxX
    let minY = axes.includeDataRange ? Math.min(baseMinY, dataMinY) : baseMinY
    let maxY = axes.includeDataRange ? Math.max(baseMaxY, dataMaxY) : baseMaxY

    const xPad = Math.max(0.2, (maxX - minX) * 0.06)
    const yPad = Math.max(0.25, (maxY - minY) * 0.12)
    minX -= xPad
    maxX += xPad
    minY -= yPad
    maxY += yPad

    const mapPoint = ({ x, y }) => ({
      x: pad.left + ((x - minX) / Math.max(0.001, maxX - minX)) * chartW,
      y: pad.top + chartH - ((y - minY) / Math.max(0.001, maxY - minY)) * chartH,
    })
    const mapTraj = (point) => mapPoint({ x: axes.getX(point), y: axes.getY(point) })

    ctx.strokeStyle = '#27272a'
    ctx.lineWidth = 1
    ctx.strokeRect(pad.left, pad.top, chartW, chartH)

    ctx.save()
    ctx.beginPath()
    ctx.rect(pad.left, pad.top, chartW, chartH)
    ctx.clip()

    if (axes.court) {
      ctx.fillStyle = '#14532d'
      ctx.fillRect(pad.left, pad.top, chartW, chartH)
      drawCourt(ctx, mapPoint)
    } else {
      for (let i = 1; i <= 3; i++) {
        const y = pad.top + (chartH * i) / 4
        ctx.strokeStyle = 'rgba(63, 63, 70, 0.65)'
        ctx.beginPath()
        ctx.moveTo(pad.left, y)
        ctx.lineTo(pad.left + chartW, y)
        ctx.stroke()
      }
    }

    const drawPath = (pathPoints, color, width, alpha = 1) => {
      if (pathPoints.length < 2) return
      ctx.strokeStyle = color
      ctx.globalAlpha = alpha
      ctx.lineWidth = width
      ctx.lineJoin = 'round'
      ctx.beginPath()
      pathPoints.forEach((point, index) => {
        const pos = mapTraj(point)
        if (index === 0) ctx.moveTo(pos.x, pos.y)
        else ctx.lineTo(pos.x, pos.y)
      })
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    drawPath(points, axes.court ? '#cbd5e1' : '#38bdf8', 1.5, axes.court ? 0.62 : 0.82)

    const trailStartFrame = currentFrame - TRAIL_SEC * fps
    drawPath(
      points.filter((point) => point.frame >= trailStartFrame && point.frame <= currentFrame),
      '#facc15',
      3,
      1
    )

    for (const anomaly of anomalies) {
      const anomalyPoints = points.filter((point) => point.frame >= anomaly.start_frame && point.frame <= anomaly.end_frame)
      drawPath(anomalyPoints, '#fb7185', 3, 0.9)
    }

    for (const hit of hits) {
      const frame = hit.new_hit_frame ?? hit.hit_frame
      const point = points.find((item) => item.frame === frame)
      if (!point) continue
      const rawPos = mapTraj(point)
      const pos = {
        x: clamp(rawPos.x, pad.left + 5, pad.left + chartW - 5),
        y: clamp(rawPos.y, pad.top + 5, pad.top + chartH - 5),
      }
      const color = (hit.confidence ?? 1) < 0.5 ? '#fb7185' : '#67e8f9'
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2)
      ctx.fill()
    }

    if (currentPoint) {
      const rawPos = mapTraj(currentPoint)
      const pos = {
        x: clamp(rawPos.x, pad.left + 6, pad.left + chartW - 6),
        y: clamp(rawPos.y, pad.top + 6, pad.top + chartH - 6),
      }
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#facc15'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, 5.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    ctx.restore()

    ctx.fillStyle = '#a1a1aa'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(axes.xLabel, pad.left + chartW / 2, h - 22)

    ctx.save()
    ctx.translate(14, pad.top + chartH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText(axes.yLabel, 0, 0)
    ctx.restore()

    pointAreasRef.current = points.map((point) => {
      const pos = mapTraj(point)
      return { frame: point.frame, x: pos.x, y: pos.y }
    })
  }, [axes, points, hits, anomalies, currentFrame, fps, size.width, size.height, currentPoint])

  const jumpToNearest = (clientX, clientY) => {
    const canvas = canvasRef.current
    const areas = pointAreasRef.current
    if (!canvas || !areas.length) return

    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const nearest = findNearest(areas, (area) => {
      const dx = area.x - x
      const dy = area.y - y
      return dx * dx + dy * dy
    })

    if (nearest) setCurrentFrame(nearest.frame)
  }

  const handlePointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = true
    jumpToNearest(e.clientX, e.clientY)
  }

  const handlePointerMove = (e) => {
    if (draggingRef.current) jumpToNearest(e.clientX, e.clientY)
  }

  const stopDragging = (e) => {
    draggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div ref={wrapRef} className="h-full w-full min-h-0 min-w-0 relative bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full block"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        style={{ cursor: points.length ? 'crosshair' : 'default', touchAction: 'none' }}
      />
    </div>
  )
}

export default function Projection2DPanel() {
  const selection = useAppStore((s) => s.selection)
  const currentFrame = useAppStore((s) => s.currentFrame)
  const currentTime = useAppStore((s) => s.currentTime)
  const setCurrentFrame = useAppStore((s) => s.setCurrentFrame)
  const fps = useAppStore((s) => s.fps) || 50
  const rallies = useAppStore((s) => s.rallies) || []
  const hits = useAppStore((s) => s.hits) || []
  const anomalies = useAppStore((s) => s.anomalies) || []
  const trajMap = useAppStore((s) => s.trajByFrame)
  const bottomView = useAppStore((s) => s.bottomView)
  const setBottomView = useAppStore((s) => s.setBottomView)
  const activeItem = useAppStore((s) => s.activeItem)
  const setActiveItem = useAppStore((s) => s.setActiveItem)
  const setSelectionRange = useAppStore((s) => s.setSelectionRange)
  const setCurrentTime = useAppStore((s) => s.setCurrentTime)

  const points = useMemo(() => getVisiblePoints({
    selection,
    currentFrame,
    fps,
    rallies,
    trajMap,
  }), [selection, currentFrame, fps, rallies, trajMap])

  const firstFrame = points[0]?.frame
  const lastFrame = points[points.length - 1]?.frame

  const visibleHits = useMemo(() => {
    if (firstFrame == null || lastFrame == null) return []
    return hits.filter((hit) => {
      const frame = hit.new_hit_frame ?? hit.hit_frame
      return frame >= firstFrame && frame <= lastFrame
    })
  }, [hits, firstFrame, lastFrame])

  const visibleAnomalies = useMemo(() => {
    if (firstFrame == null || lastFrame == null) return []
    return anomalies.filter((anomaly) => anomaly.end_frame >= firstFrame && anomaly.start_frame <= lastFrame)
  }, [anomalies, firstFrame, lastFrame])

  const goToRallyByIndex = (targetIdx) => {
    const sorted = [...rallies].sort((a, b) => a.start_frame - b.start_frame)
    if (!sorted.length) return

    const idx = Math.max(0, Math.min(sorted.length - 1, targetIdx))
    const rally = sorted[idx]
    const startSec = rally.start_frame / fps
    const endSec = rally.end_frame / fps

    setSelectionRange(startSec, endSec)
    setCurrentTime(startSec)
    setActiveItem('rally', rally.id)
  }

  const goPrevRally = () => {
    const sorted = [...rallies].sort((a, b) => a.start_frame - b.start_frame)
    if (!sorted.length) return

    if (activeItem?.type === 'rally') {
      const idx = sorted.findIndex((rally) => rally.id === activeItem.id)
      if (idx > 0) {
        goToRallyByIndex(idx - 1)
        return
      }
    }

    let targetIdx = -1
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].start_frame < currentFrame) {
        targetIdx = i
        break
      }
    }
    if (targetIdx === -1) targetIdx = 0
    goToRallyByIndex(targetIdx)
  }

  const goNextRally = () => {
    const sorted = [...rallies].sort((a, b) => a.start_frame - b.start_frame)
    if (!sorted.length) return

    if (activeItem?.type === 'rally') {
      const idx = sorted.findIndex((rally) => rally.id === activeItem.id)
      if (idx !== -1 && idx < sorted.length - 1) {
        goToRallyByIndex(idx + 1)
        return
      }
    }

    const targetIdx = sorted.findIndex((rally) => rally.start_frame > currentFrame)
    goToRallyByIndex(targetIdx === -1 ? sorted.length - 1 : targetIdx)
  }

  return (
    <div className="h-full w-full min-h-0 min-w-0 flex flex-col bg-zinc-950">
      <div className="h-[42px] shrink-0 px-4 flex items-center gap-4 border-b border-zinc-800 bg-zinc-950 shadow-sm z-20 min-w-0 overflow-hidden">
        <div className="flex bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden shrink-0">
          {[
            ['timeline', 'TIMELINE'],
            ['projection2d', '2D'],
            ['quality2d', '品質檢查'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setBottomView(id)}
              className={`px-3 py-1 text-xs font-bold tracking-wider transition-colors ${
                bottomView === id
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/70'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="text-xs text-zinc-500 truncate min-w-0">
          {points.length
            ? `${points.length} points / frames ${firstFrame} - ${lastFrame}`
            : 'No trajectory points for the current range'}
        </div>

        <div className="ml-auto min-w-0 overflow-hidden shrink-0">
          <PlaybackUI
            goPrevRally={goPrevRally}
            goNextRally={goNextRally}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 min-w-0 flex flex-row gap-2 p-2 bg-[#09090b] overflow-hidden">
        {['top', 'side', 'front'].map((view) => (
          <div key={view} className="h-full min-h-0 min-w-0 basis-1/3 grow shrink">
            <ProjectionChart
              view={view}
              points={points}
              hits={visibleHits}
              anomalies={visibleAnomalies}
              currentFrame={currentFrame}
              fps={fps}
              setCurrentFrame={setCurrentFrame}
            />
          </div>
        ))}
      </div>
    </div>
  )
}