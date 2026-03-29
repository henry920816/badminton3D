import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useAppStore } from '../store.js'

function PlaybackUI() {
  const playing = useAppStore(s => s.playing)
  const togglePlaying = useAppStore(s => s.togglePlaying)
  const playbackRate = useAppStore(s => s.playbackRate)
  const setPlaybackRate = useAppStore(s => s.setPlaybackRate)
  const selection = useAppStore(s => s.selection)
  const setCurrentTime = useAppStore(s => s.setCurrentTime)
  const currentTime = useAppStore(s => s.currentTime)
  const fps = useAppStore(s => s.fps) || 60

  const holdTimerRef = useRef(null)
  const holdIntervalRef = useRef(null)

  const stepSmall = 1 / fps
  const stepBig = 5 / fps

  const stopHold = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current)
      holdIntervalRef.current = null
    }
  }

  const startHold = (delta) => {
    stopHold()
    holdTimerRef.current = setTimeout(() => {
      holdIntervalRef.current = setInterval(() => {
        const now = useAppStore.getState().currentTime
        useAppStore.getState().setCurrentTime(Math.max(0, now + delta))
      }, 40)
    }, 220)
  }

  useEffect(() => {
    return () => stopHold()
  }, [])

  const holdEvents = (delta) => ({
    onPointerDown: () => startHold(delta),
    onPointerUp: stopHold,
    onPointerLeave: stopHold,
    onPointerCancel: stopHold,
  })

  return (
    <div className="flex items-center gap-3 ml-6 transition-opacity duration-300 opacity-100">
      <button
        onClick={() => setCurrentTime(Math.max(0, currentTime - stepBig))}
        {...holdEvents(-stepBig)}
        className="w-7 h-7 flex items-center justify-center text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors rounded-md"
        title="Backward"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11 18V6L2.5 12 11 18zm10 0V6l-8.5 6 8.5 6z" />
        </svg>
      </button>

      <button
        onClick={() => setCurrentTime(Math.max(0, currentTime - stepSmall))}
        {...holdEvents(-stepSmall)}
        className="w-7 h-7 flex items-center justify-center text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors rounded-md"
        title="Prev frame"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15 18V6l-8.5 6L15 18zm2-12h2v12h-2z" />
        </svg>
      </button>

      <button
        onClick={() => setCurrentTime(selection.inTime || 0)}
        className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors rounded-md"
        title="Replay from start"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>

      <button
        onClick={togglePlaying}
        className="w-8 h-8 flex items-center justify-center bg-cyan-600 hover:bg-cyan-500 rounded-md text-white shadow-[0_0_10px_rgba(8,145,178,0.3)] transition-transform active:scale-95"
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5">
            <path d="M5 3l14 9-14 9V3z" />
          </svg>
        )}
      </button>

      <button
        onClick={() => setCurrentTime(currentTime + stepSmall)}
        {...holdEvents(stepSmall)}
        className="w-7 h-7 flex items-center justify-center text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors rounded-md"
        title="Next frame"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 6v12l8.5-6L9 6zm-4 0h2v12H5z" />
        </svg>
      </button>

      <button
        onClick={() => setCurrentTime(currentTime + stepBig)}
        {...holdEvents(stepBig)}
        className="w-7 h-7 flex items-center justify-center text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors rounded-md"
        title="Forward"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 6v12l8.5-6L13 6zM3 6v12l8.5-6L3 6z" />
        </svg>
      </button>

      <div className="flex bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden">
        {[0.5, 1, 2].map(speed => (
          <button
            key={speed}
            onClick={() => setPlaybackRate(speed)}
            className={`px-2 py-1 text-[10px] font-bold transition-colors ${
              playbackRate === speed
                ? 'bg-cyan-600 text-white'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {speed}x
          </button>
        ))}
      </div>
    </div>
  )
}

export default function TimelinePanel() {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const scrollBarRef = useRef(null)

  const matchId = useAppStore(s => s.matchId)
  const fps = useAppStore(s => s.fps) || 60
  const durationSec = useAppStore(s => s.durationSec) || 60
  const currentTime = useAppStore(s => s.currentTime)
  const setCurrentTime = useAppStore(s => s.setCurrentTime)

  const rallies = useAppStore(s => s.rallies) || []
  const hits = useAppStore(s => s.hits) || []
  const anomalies = useAppStore(s => s.anomalies) || []
  const updateHit = useAppStore(s => s.updateHit)
  const trajMap = useAppStore(s => s.trajByFrame)
  const upsertTrajPoints = useAppStore(s => s.upsertTrajPoints)

  const activeItem = useAppStore(s => s.activeItem)
  const setActiveItem = useAppStore(s => s.setActiveItem)

  const pxPerSec = useAppStore(s => s.pxPerSec) || 100
  const setZoom = useAppStore(s => s.setZoom)
  const scrollLeft = useAppStore(s => s.scrollLeft) || 0
  const setScrollLeft = useAppStore(s => s.setScrollLeft)

  const selection = useAppStore(s => s.selection)
  const setSelectionIn = useAppStore(s => s.setSelectionIn)
  const setSelectionOut = useAppStore(s => s.setSelectionOut)
  const setSelectionRange = useAppStore(s => s.setSelectionRange)
  const clearSelection = useAppStore(s => s.clearSelection)

  const playing = useAppStore(s => s.playing)

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [hoveredHit, setHoveredHit] = useState(null)
  const [draggingHit, setDraggingHit] = useState(null)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [isPanning, setIsPanning] = useState(false)

  const TRACK_LABELS_WIDTH = 100
  const RULER_HEIGHT = 30
  const PLAYHEAD_GRAB_PX = 10
  const AUTO_SCROLL_EDGE_PX = 50
  const AUTO_SCROLL_KEEP_PX = 90
  const AUTO_SCROLL_SMOOTH_FACTOR = 0.18

  const TRACKS = [
    { id: 'rally', label: 'Rally', height: 30, bg: '#18181b' },
    { id: 'speed_hit', label: 'SPEED / HIT', height: 120, bg: '#09090b', valueFn: p => p.speed, color: '#fcd34d', fill: 'rgba(252,211,77,0.1)' },
    { id: 'pos_x', label: 'X (t)', height: 75, bg: '#18181b', valueFn: p => p.x, color: '#38bdf8' },
    { id: 'pos_y', label: 'Y (t)', height: 75, bg: '#09090b', valueFn: p => p.y, color: '#fb923c' },
    { id: 'pos_z', label: 'Z (t)', height: 75, bg: '#18181b', valueFn: p => p.z, color: '#34d399' },
    { id: 'anomaly', label: 'Anomaly', height: 40, bg: '#09090b' },
  ]
  const TOTAL_TRACKS_HEIGHT = TRACKS.reduce((s, t) => s + t.height, 0)

  const maxScrollLeft = Math.max(
    0,
    durationSec * pxPerSec - Math.max(0, dimensions.width - TRACK_LABELS_WIDTH)
  )

  const clampScroll = (value) => Math.max(0, Math.min(value, maxScrollLeft))

  const smoothMoveScroll = (targetScroll) => {
    const clamped = clampScroll(targetScroll)
    const next = scrollLeft + (clamped - scrollLeft) * AUTO_SCROLL_SMOOTH_FACTOR
    if (Math.abs(next - scrollLeft) > 0.5) {
      setScrollLeft(next)
    }
  }

  const ensureTimeVisible = (timeSec, mode = 'soft') => {
    const visibleLeft = scrollLeft
    const visibleRight = scrollLeft + Math.max(0, dimensions.width - TRACK_LABELS_WIDTH)
    const timePx = timeSec * pxPerSec

    let nextScroll = scrollLeft

    if (mode === 'center') {
      nextScroll = timePx - Math.max(0, dimensions.width - TRACK_LABELS_WIDTH) / 2
    } else {
      const leftBound = visibleLeft + AUTO_SCROLL_KEEP_PX
      const rightBound = visibleRight - AUTO_SCROLL_KEEP_PX

      if (timePx < leftBound) {
        nextScroll = timePx - AUTO_SCROLL_KEEP_PX
      } else if (timePx > rightBound) {
        nextScroll = timePx - Math.max(0, dimensions.width - TRACK_LABELS_WIDTH) + AUTO_SCROLL_KEEP_PX
      }
    }

    nextScroll = clampScroll(nextScroll)
    if (Math.abs(nextScroll - scrollLeft) > 1) {
      setScrollLeft(nextScroll)
    }
  }

  const autoScrollDuringPointer = (x, timeSec) => {
    const usableWidth = Math.max(0, dimensions.width - TRACK_LABELS_WIDTH)
    if (usableWidth <= 0) return

    const rightEdge = dimensions.width - AUTO_SCROLL_EDGE_PX
    const leftEdge = TRACK_LABELS_WIDTH + AUTO_SCROLL_EDGE_PX

    if (x >= rightEdge) {
      const target = timeSec * pxPerSec - (usableWidth - AUTO_SCROLL_KEEP_PX)
      smoothMoveScroll(target)
    } else if (x <= leftEdge) {
      const target = timeSec * pxPerSec - AUTO_SCROLL_KEEP_PX
      smoothMoveScroll(target)
    }
  }

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDimensions({ width, height })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const isProgrammaticScrollRef = useRef(false)
  useEffect(() => {
    if (scrollBarRef.current && Math.abs(scrollBarRef.current.scrollLeft - scrollLeft) > 1) {
      isProgrammaticScrollRef.current = true
      scrollBarRef.current.scrollLeft = scrollLeft
    }
  }, [scrollLeft])

  const fetchLockRef = useRef(false)
  useEffect(() => {
    if (dimensions.width === 0) return
    const startSec = Math.max(0, scrollLeft / pxPerSec)
    const endSec = (scrollLeft + dimensions.width - TRACK_LABELS_WIDTH) / pxPerSec
    const sF = Math.floor(startSec * fps) - 30
    const eF = Math.ceil(endSec * fps) + 30

    let missing = 0
    for (let f = sF; f <= eF; f++) {
      if (!trajMap.has(f)) missing++
    }

    if (missing > 20 && !fetchLockRef.current) {
      fetchLockRef.current = true
      api.getTraj(matchId, Math.max(0, sF), eF).then(pts => {
        if (pts && pts.length > 0) upsertTrajPoints(pts)
      }).catch(console.error)
        .finally(() => {
          setTimeout(() => {
            fetchLockRef.current = false
          }, 300)
        })
    }
  }, [scrollLeft, pxPerSec, dimensions.width, fps, matchId, trajMap, upsertTrajPoints])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return

      if (e.key === 'i' || e.key === 'I') setSelectionIn()
      if (e.key === 'o' || e.key === 'O') setSelectionOut()
      if (e.key === 'Escape') {
        clearSelection()
        setActiveItem(null, null)
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const isRight = e.key === 'ArrowRight'
        if (activeItem?.type === 'rally') {
          e.preventDefault()
          const sorted = [...rallies].sort((a, b) => a.start_frame - b.start_frame)
          const idx = sorted.findIndex(r => r.id === activeItem.id)
          if (idx !== -1) {
            const nextIdx = idx + (isRight ? 1 : -1)
            if (nextIdx >= 0 && nextIdx < sorted.length) {
              const r = sorted[nextIdx]
              const s = r.start_frame / fps
              setSelectionRange(s, r.end_frame / fps)
              setCurrentTime(s)
              setActiveItem('rally', r.id)
              ensureTimeVisible(s, 'center')
            }
          }
        } else if (activeItem?.type === 'hit') {
          e.preventDefault()
          const hit = hits.find(h => h.id === activeItem.id)
          if (hit) {
            const frame = hit.new_hit_frame ?? hit.hit_frame
            const newFrame = frame + (isRight ? 1 : -1)
            updateHit(hit.id, { new_hit_frame: newFrame })
            setCurrentTime(newFrame / fps)
          }
        } else {
          // Default: Move timeline by 1 frame
          e.preventDefault()
          const step = 1 / fps
          setCurrentTime(Math.max(0, currentTime + (isRight ? step : -step)))
        }
      }

      if ((e.shiftKey && (e.key === 'N' || e.key === 'n')) || (e.shiftKey && (e.key === 'P' || e.key === 'p'))) {
        const forward = (e.key === 'N' || e.key === 'n')
        const list = [...anomalies].sort((a, b) => a.start_frame - b.start_frame)
        if (!list.length) return
        const curF = Math.round(currentTime * fps)
        let target = null
        if (forward) {
          target = list.find(a => a.start_frame > curF) || list[0]
        } else {
          target = [...list].reverse().find(a => a.end_frame < curF) || list[list.length - 1]
        }
        if (target) {
          const s = target.start_frame / fps
          setSelectionRange(s, target.end_frame / fps)
          setCurrentTime(s)
          setActiveItem('anomaly', target.id)
          setScrollLeft(clampScroll(s * pxPerSec - dimensions.width / 2 + TRACK_LABELS_WIDTH))
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anomalies, currentTime, fps, pxPerSec, dimensions.width, setActiveItem, setCurrentTime, setSelectionRange, setSelectionIn, setSelectionOut, clearSelection, setScrollLeft])

  useEffect(() => {
    if (!isScrubbing && !draggingHit && !isPanning && playing) {
      ensureTimeVisible(currentTime, 'soft')
    }
  }, [currentTime, playing, isScrubbing, draggingHit, isPanning, scrollLeft, pxPerSec, dimensions.width])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || dimensions.width === 0 || dimensions.height === 0) return

    const ctx = canvas.getContext('2d')
    const scale = window.devicePixelRatio || 1
    canvas.width = dimensions.width * scale
    canvas.height = Math.max(dimensions.height, TOTAL_TRACKS_HEIGHT + RULER_HEIGHT) * scale
    ctx.scale(scale, scale)

    const w = dimensions.width
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const timeToX = (t) => t * pxPerSec - scrollLeft + TRACK_LABELS_WIDTH
    const xToTime = (x) => (x - TRACK_LABELS_WIDTH + scrollLeft) / pxPerSec

    const sSec = xToTime(TRACK_LABELS_WIDTH)
    const eSec = xToTime(w)
    const sF = Math.max(0, Math.floor(sSec * fps))
    const eF = Math.max(0, Math.ceil(eSec * fps))

    const pts = []
    const step = Math.max(1, Math.floor((eF - sF) / 1000))
    for (let f = sF; f <= eF; f += step) {
      const p = trajMap.get(f)
      if (p) pts.push(p)
    }

    ctx.save()
    let currentY = RULER_HEIGHT
    for (const track of TRACKS) {
      ctx.fillStyle = track.bg
      ctx.fillRect(0, currentY, w, track.height)
      ctx.strokeStyle = '#27272a'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, currentY + track.height)
      ctx.lineTo(w, currentY + track.height)
      ctx.stroke()
      currentY += track.height
    }
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.rect(TRACK_LABELS_WIDTH, RULER_HEIGHT, w - TRACK_LABELS_WIDTH, TOTAL_TRACKS_HEIGHT)
    ctx.clip()

    currentY = RULER_HEIGHT

    for (const track of TRACKS) {
      const trackTop = currentY
      const trackBot = currentY + track.height

      if (track.id === 'rally') {
        const rowH = track.height
        for (const r of rallies) {
          const sx = timeToX(r.start_frame / fps)
          const ex = timeToX(r.end_frame / fps)
          if (ex < TRACK_LABELS_WIDTH || sx > w) continue

          let color = 'rgba(63,63,70,0.5)'
          if (r.status === 'verified') color = 'rgba(5,150,105,0.5)'
          else if (r.status === 'needs_fix') color = 'rgba(225,29,72,0.5)'
          else if (r.status === 'reviewing') color = 'rgba(2,132,199,0.5)'

          const barY = trackTop + 4
          const barH = rowH - 8
          const rectW = Math.max(1, ex - sx)

          ctx.fillStyle = color
          ctx.beginPath()
          ctx.roundRect(sx, barY, rectW, barH, 4)
          ctx.fill()

          ctx.fillStyle = '#f4f4f5'
          ctx.font = '10px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const text = `R${r.rally_index}`
          const m = ctx.measureText(text)
          if (m.width < rectW - 4) {
            ctx.fillText(text, sx + rectW / 2, barY + barH / 2)
          }
        }
      }

      if (track.valueFn && pts.length > 1) {
        let minV = Infinity
        let maxV = -Infinity
        for (const p of pts) {
          const v = track.valueFn(p)
          if (v == null) continue
          if (v < minV) minV = v
          if (v > maxV) maxV = v
        }

        if (minV !== Infinity) {
          const pad = (maxV - minV) * 0.1 || 1
          const drawMin = minV - pad
          const drawMax = maxV + pad

          ctx.strokeStyle = 'rgba(63,63,70,0.5)'
          ctx.setLineDash([4, 4])
          ctx.beginPath()
          ctx.moveTo(TRACK_LABELS_WIDTH, trackTop + track.height / 2)
          ctx.lineTo(w, trackTop + track.height / 2)
          ctx.stroke()
          ctx.setLineDash([])

          ctx.strokeStyle = track.color
          ctx.lineWidth = 1.5
          ctx.lineJoin = 'round'
          ctx.beginPath()

          let first = true
          const pxs = []
          const pys = []
          const segments = []

          for (let i = 0; i < pts.length; i++) {
            const val = track.valueFn(pts[i])
            if (val == null) continue

            if (!first && (pts[i].frame - pts[i - 1].frame > step * 2 + 10)) {
              ctx.stroke()
              if (pxs.length > 0) segments.push({ pxs: [...pxs], pys: [...pys] })
              pxs.length = 0
              pys.length = 0
              first = true
              ctx.beginPath()
            }

            const px = timeToX(pts[i].frame / fps)
            const py = trackTop + track.height - ((val - drawMin) / (drawMax - drawMin)) * track.height
            if (first) {
              ctx.moveTo(px, py)
              first = false
            } else {
              ctx.lineTo(px, py)
            }
            pxs.push(px)
            pys.push(py)
          }
          ctx.stroke()

          if (pxs.length > 0) segments.push({ pxs: [...pxs], pys: [...pys] })

          if (track.fill) {
            for (const seg of segments) {
              if (seg.pxs.length < 2) continue
              ctx.beginPath()
              ctx.moveTo(seg.pxs[0], seg.pys[0])
              for (let i = 1; i < seg.pxs.length; i++) {
                ctx.lineTo(seg.pxs[i], seg.pys[i])
              }
              ctx.lineTo(seg.pxs[seg.pxs.length - 1], trackBot)
              ctx.lineTo(seg.pxs[0], trackBot)
              ctx.closePath()
              const grad = ctx.createLinearGradient(0, trackTop, 0, trackBot)
              grad.addColorStop(0, track.fill)
              grad.addColorStop(1, 'rgba(0,0,0,0)')
              ctx.fillStyle = grad
              ctx.fill()
            }
          }
        }
      }

      if (track.id === 'speed_hit') {
        for (const h of hits) {
          const isDragging = draggingHit?.id === h.id
          const frame = isDragging && draggingHit.currentFrame !== undefined
            ? draggingHit.currentFrame
            : (h.new_hit_frame ?? h.hit_frame)

          const t = frame / fps
          const hx = timeToX(t)
          if (hx < TRACK_LABELS_WIDTH || hx > w) continue

          const conf = h.confidence ?? 1.0
          const isLow = conf < 0.5
          const isHovered = hoveredHit === h.id || isDragging

          // Color logic: Default white, Hover Cyan (diff from speed line)
          ctx.fillStyle = isHovered ? '#22d3ee' : isLow ? '#f43f5e' : '#d4d4d8'
          ctx.fillRect(hx - 1, trackTop, 2, track.height)

          ctx.fillStyle = isHovered ? '#083344' : 'rgba(39,39,42,0.9)'
          ctx.strokeStyle = isLow ? '#f43f5e' : isHovered ? '#22d3ee' : '#52525b'
          ctx.lineWidth = 1

          const text = h.shot_type || 'Hit'
          ctx.font = '10px sans-serif'
          const tw = ctx.measureText(text).width
          const bw = Math.max(40, tw + 8)

          ctx.beginPath()
          ctx.roundRect(hx - bw / 2, trackTop + 4, bw, 24, 4)
          ctx.fill()
          ctx.stroke()

          ctx.fillStyle = isLow ? '#fda4af' : isHovered ? '#67e8f9' : '#d4d4d8'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillText(text, hx, trackTop + 8)
        }
      }

      if (track.id === 'anomaly') {
        for (const a of anomalies) {
          const sx = timeToX(a.start_frame / fps)
          const ex = timeToX(a.end_frame / fps)
          if (ex < TRACK_LABELS_WIDTH || sx > w) continue

          const sev = a.severity ?? 3
          const opacity = Math.min(0.85, 0.3 + sev * 0.1)
          const rectW = Math.max(2, ex - sx)

          ctx.fillStyle = `rgba(244,63,94,${opacity})`
          ctx.beginPath()
          ctx.roundRect(sx, trackTop + 10, rectW, 20, 2)
          ctx.fill()
        }
      }

      currentY += track.height
    }

    if (selection.inTime != null && selection.outTime != null) {
      const s = Math.min(selection.inTime, selection.outTime)
      const e = Math.max(selection.inTime, selection.outTime)
      const sx = Math.max(TRACK_LABELS_WIDTH, timeToX(s))
      const ex = Math.min(w, timeToX(e))
      if (sx < w && ex > TRACK_LABELS_WIDTH) {
        ctx.fillStyle = 'rgba(167, 139, 250, 0.15)'
        ctx.fillRect(sx, RULER_HEIGHT, ex - sx, TOTAL_TRACKS_HEIGHT)

        ctx.strokeStyle = 'rgba(167, 139, 250, 0.8)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(sx, RULER_HEIGHT)
        ctx.lineTo(sx, canvas.height)
        ctx.moveTo(ex, RULER_HEIGHT)
        ctx.lineTo(ex, canvas.height)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    const cx = timeToX(currentTime)
    if (cx >= TRACK_LABELS_WIDTH && cx <= w) {
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(cx, 0)
      ctx.lineTo(cx, canvas.height)
      ctx.stroke()

      ctx.fillStyle = '#38bdf8'
      ctx.beginPath()
      ctx.moveTo(cx - 6, 0)
      ctx.lineTo(cx + 6, 0)
      ctx.lineTo(cx + 6, Math.max(10, RULER_HEIGHT - 10))
      ctx.lineTo(cx, RULER_HEIGHT)
      ctx.lineTo(cx - 6, Math.max(10, RULER_HEIGHT - 10))
      ctx.closePath()
      ctx.fill()
    }

    ctx.restore()

    ctx.fillStyle = 'rgba(9, 9, 11, 0.9)'
    ctx.fillRect(TRACK_LABELS_WIDTH, 0, w - TRACK_LABELS_WIDTH, RULER_HEIGHT)
    ctx.strokeStyle = '#27272a'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(TRACK_LABELS_WIDTH, RULER_HEIGHT)
    ctx.lineTo(w, RULER_HEIGHT)
    ctx.stroke()

    ctx.fillStyle = '#a1a1aa'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'

    let tickSpacingSec = 1
    if (pxPerSec < 20) tickSpacingSec = 10
    else if (pxPerSec < 50) tickSpacingSec = 5
    else if (pxPerSec > 200) tickSpacingSec = 0.5

    const firstTick = Math.floor(sSec / tickSpacingSec) * tickSpacingSec
    for (let t = firstTick; t <= eSec; t += tickSpacingSec) {
      if (t < 0) continue
      const tx = timeToX(t)
      if (tx < TRACK_LABELS_WIDTH) continue

      ctx.beginPath()
      ctx.moveTo(tx, RULER_HEIGHT - 6)
      ctx.lineTo(tx, RULER_HEIGHT)
      ctx.stroke()

      const m = Math.floor(t / 60)
      const s = Math.floor(t % 60)
      const ms = Math.round((t % 1) * 10)
      let text = m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`
      if (tickSpacingSec < 1 && ms > 0) text += `.${ms}`

      ctx.fillText(text, tx, RULER_HEIGHT - 8)
    }

    ctx.fillStyle = '#09090b'
    ctx.fillRect(0, 0, TRACK_LABELS_WIDTH, canvas.height)
    ctx.strokeStyle = '#27272a'
    ctx.beginPath()
    ctx.moveTo(TRACK_LABELS_WIDTH, 0)
    ctx.lineTo(TRACK_LABELS_WIDTH, canvas.height)
    ctx.stroke()

    ctx.fillStyle = '#52525b'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = '10px sans-serif'

    currentY = RULER_HEIGHT
    for (const track of TRACKS) {
      ctx.fillText(track.label, 12, currentY + track.height / 2)
      ctx.beginPath()
      ctx.moveTo(0, currentY + track.height)
      ctx.lineTo(TRACK_LABELS_WIDTH, currentY + track.height)
      ctx.stroke()
      currentY += track.height
    }
  }, [dimensions, scrollLeft, pxPerSec, trajMap, rallies, hits, anomalies, currentTime, hoveredHit, draggingHit, fps, selection])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleWheel = (e) => {
      e.preventDefault()
      if (e.shiftKey) {
        const mouseX = e.offsetX
        if (mouseX < TRACK_LABELS_WIDTH) return

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
        const targetTime = (mouseX - TRACK_LABELS_WIDTH + scrollLeft) / pxPerSec

        let newPx = pxPerSec * zoomFactor
        newPx = Math.max(5, Math.min(newPx, 1000))

        const newScroll = targetTime * newPx - (mouseX - TRACK_LABELS_WIDTH)
        setZoom(newPx)
        setScrollLeft(clampScroll(newScroll))
      } else {
        const deltaX = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.ctrlKey || e.metaKey ? e.deltaY : e.deltaY)
        setScrollLeft(clampScroll(scrollLeft + deltaX))
      }
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [scrollLeft, pxPerSec, setZoom, setScrollLeft, maxScrollLeft])

  const getHitAtX = (x) => {
    const t = (x - TRACK_LABELS_WIDTH + scrollLeft) / pxPerSec
    // Increase click zone/radius (e.g. 25px in seconds) for easier selection
    const clickZoneSec = 5 / pxPerSec 
    
    let bestHit = null
    let minDist = Infinity

    for (const h of hits) {
      const ht = (h.new_hit_frame ?? h.hit_frame) / fps
      const dist = Math.abs(ht - t)
      
      // Find the closest hit within the click zone
      if (dist < clickZoneSec && dist < minDist) {
        minDist = dist
        bestHit = h
      }
    }
    return bestHit
  }

  const getPlayheadX = () => currentTime * pxPerSec - scrollLeft + TRACK_LABELS_WIDTH
  const isNearPlayhead = (x) => Math.abs(x - getPlayheadX()) <= PLAYHEAD_GRAB_PX

  const handlePointerDown = (e) => {
    e.target.setPointerCapture(e.pointerId)
    const x = e.nativeEvent.offsetX
    const y = e.nativeEvent.offsetY

    if (x < TRACK_LABELS_WIDTH) return

    const t = Math.max(0, (x - TRACK_LABELS_WIDTH + scrollLeft) / pxPerSec)

    if (isNearPlayhead(x) || y < RULER_HEIGHT) {
      setIsScrubbing(true)
      setCurrentTime(t)
      autoScrollDuringPointer(x, t)
      return
    }

    let currentYOffset = RULER_HEIGHT
    for (const track of TRACKS) {
      if (y >= currentYOffset && y <= currentYOffset + track.height) {
        if (track.id === 'speed_hit') {
          const hit = getHitAtX(x)
          if (hit) {
            setDraggingHit({
              id: hit.id,
              startX: x,
              frameOffset: hit.new_hit_frame ?? hit.hit_frame
            })
            setActiveItem('hit', hit.id)
            
            // Snap current time to the hit's exact frame to "see" it immediately
            const frame = hit.new_hit_frame ?? hit.hit_frame
            setCurrentTime(frame / fps)
            return
          }
        } else if (track.id === 'rally') {
          for (const r of rallies) {
            const startSec = r.start_frame / fps
            const endSec = r.end_frame / fps
            if (t >= startSec && t <= endSec) {
              setSelectionRange(startSec, endSec)
              setCurrentTime(startSec)
              setActiveItem('rally', r.id)
              ensureTimeVisible(startSec, 'center')
              return
            }
          }
        }
        break
      }
      currentYOffset += track.height
    }

    clearSelection()
    setActiveItem(null, null) // Clear active item when clicking empty space
    setCurrentTime(t)
    ensureTimeVisible(t, 'soft')
  }

  const handlePointerMove = (e) => {
    const x = e.nativeEvent.offsetX
    const y = e.nativeEvent.offsetY
    const canvas = canvasRef.current

    if (isScrubbing) {
      const t = Math.max(0, (x - TRACK_LABELS_WIDTH + scrollLeft) / pxPerSec)
      setCurrentTime(t)
      autoScrollDuringPointer(x, t)
      if (canvas) canvas.style.cursor = 'ew-resize'
      return
    }

    if (isPanning) {
      const dx = x - isPanning.startX
      setScrollLeft(clampScroll(isPanning.startScroll - dx))
      if (canvas) canvas.style.cursor = 'grabbing'
      return
    }

    if (draggingHit) {
      const dx = x - draggingHit.startX
      const dxSec = dx / pxPerSec
      const newFrame = Math.max(0, Math.round(draggingHit.frameOffset + dxSec * fps))
      const t = newFrame / fps

      setDraggingHit(prev => ({ ...prev, currentFrame: newFrame }))
      setCurrentTime(t)
      autoScrollDuringPointer(x, t)

      if (canvas) canvas.style.cursor = 'ew-resize'
      return
    }

    if (x > TRACK_LABELS_WIDTH && isNearPlayhead(x)) {
      if (canvas) canvas.style.cursor = 'ew-resize'
      if (hoveredHit) setHoveredHit(null)
      return
    }

    if (x > TRACK_LABELS_WIDTH && y > RULER_HEIGHT && y < RULER_HEIGHT + 30 + 120) {
      const hit = getHitAtX(x)
      if (hit && hoveredHit !== hit.id) {
        setHoveredHit(hit.id)
        if (canvas) canvas.style.cursor = 'ew-resize'
      } else if (!hit && hoveredHit) {
        setHoveredHit(null)
        if (canvas) canvas.style.cursor = 'default'
      } else if (!hit && canvas) {
        canvas.style.cursor = 'default'
      }
    } else {
      if (hoveredHit) setHoveredHit(null)
      if (canvas) canvas.style.cursor = 'default'
    }
  }

  const handlePointerUp = (e) => {
    e.target.releasePointerCapture(e.pointerId)
    setIsScrubbing(false)
    setIsPanning(false)
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'

    if (draggingHit) {
      const hitId = draggingHit.id
      const newFrame = draggingHit.currentFrame

      if (newFrame !== undefined) {
        updateHit(hitId, { new_hit_frame: newFrame })
        api.patchHit(hitId, { new_hit_frame: newFrame }).catch(err => {
          console.error(err)
          alert('Hit 更新失敗: ' + err)
        })
      }
      setDraggingHit(null)
    }
  }

  return (
    <div className="h-[350px] w-full relative flex flex-col bg-[#09090b] select-none text-left">
      <div className="h-[42px] shrink-0 px-4 flex items-center gap-4 border-b border-zinc-800 bg-zinc-950 shadow-sm z-20">
        <div className="text-xs text-zinc-200 font-bold bg-zinc-800/80 px-2 py-1 rounded tracking-wider border border-zinc-700">
          TIMELINE
        </div>
        <div className="text-xs text-zinc-500 font-mono">
          <span className="text-zinc-300">Click</span> Jump | <span className="text-zinc-300">Drag blue line</span> Auto-scroll | <span className="text-zinc-300">Empty click</span> Clear selection
        </div>
        <PlaybackUI />
        {(draggingHit?.currentFrame !== undefined) && (
          <div className="ml-3 text-xs text-amber-300 font-semibold px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 rounded">
            Hit #{draggingHit.id} → Frame {draggingHit.currentFrame}
          </div>
        )}
      </div>

      <div className="flex-1 relative overflow-hidden bg-[#09090b]" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full block"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={(e) => {
            e.preventDefault()
            clearSelection()
          }}
          style={{ touchAction: 'none' }}
        />
      </div>

      <div
        ref={scrollBarRef}
        className="h-[14px] w-full shrink-0 overflow-x-scroll overflow-y-hidden bg-zinc-950 border-t border-zinc-800"
        onScroll={(e) => {
          if (isProgrammaticScrollRef.current) {
            isProgrammaticScrollRef.current = false
            return
          }
          setScrollLeft(clampScroll(e.target.scrollLeft))
        }}
      >
        <div style={{ width: `${(durationSec * pxPerSec) + TRACK_LABELS_WIDTH}px`, height: '1px' }} />
      </div>
    </div>
  )
}
