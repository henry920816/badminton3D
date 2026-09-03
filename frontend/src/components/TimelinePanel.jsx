import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useAppStore } from '../store.js'

export function PlaybackUI({
  goPrevRally,
  goNextRally,
}) {
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
    <div className="flex items-center justify-center gap-2 transition-opacity duration-300 opacity-100 min-w-0">
      <button
        onClick={goPrevRally}
        className="w-8 h-8 flex items-center justify-center text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors rounded-md shrink-0"
        title="Previous rally"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11 18V6L2.5 12 11 18zm10 0V6l-8.5 6 8.5 6z" />
        </svg>
      </button>

      <button
        onClick={goNextRally}
        className="w-8 h-8 flex items-center justify-center text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors rounded-md shrink-0"
        title="Next rally"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 6v12l8.5-6L13 6zM3 6v12l8.5-6L3 6z" />
        </svg>
      </button>

      <button
        onClick={() => {
          setCurrentTime(Math.max(0, currentTime - stepSmall))
        }}
        {...holdEvents(-stepSmall)}
        className="w-7 h-7 flex items-center justify-center text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors rounded-md shrink-0"
        title="Prev frame"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15 18V6l-8.5 6L15 18zm2-12h2v12h-2z" />
        </svg>
      </button>

      <button
        onClick={() => {
          setCurrentTime(selection.inTime || 0)
        }}
        className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors rounded-md shrink-0"
        title="Replay from start"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>

      <button
        onClick={togglePlaying}
        className="w-8 h-8 flex items-center justify-center bg-cyan-600 hover:bg-cyan-500 rounded-md text-white shadow-[0_0_10px_rgba(8,145,178,0.3)] transition-transform active:scale-95 shrink-0"
        title="Play / Pause"
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
        onClick={() => {
          setCurrentTime(currentTime + stepSmall)
        }}
        {...holdEvents(stepSmall)}
        className="w-7 h-7 flex items-center justify-center text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors rounded-md shrink-0"
        title="Next frame"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 6v12l8.5-6L9 6zm-4 0h2v12H5z" />
        </svg>
      </button>

      <div className="flex bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden shrink-0">
        {[0.125, 0.25, 0.5, 1, 2].map(speed => (
          <button
            key={speed}
            onClick={() => setPlaybackRate(speed)}
            className={`px-2 py-1 text-[10px] font-bold transition-colors ${
              Number(playbackRate) === speed
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
  const rafPanRef = useRef(null)

  const fps = useAppStore(s => s.fps) || 60
  const durationSec = useAppStore(s => s.durationSec) || 60
  const currentTime = useAppStore(s => s.currentTime)
  const setCurrentTime = useAppStore(s => s.setCurrentTime)
  const playing = useAppStore(s => s.playing)
  const setPlaying = useAppStore(s => s.setPlaying)

  const rallies = useAppStore(s => s.rallies) || []
  const hits = useAppStore(s => s.hits) || []
  const anomalies = useAppStore(s => s.anomalies) || []
  const updateHit = useAppStore(s => s.updateHit)
  const trajMap = useAppStore(s => s.trajByFrame)

  const activeItem = useAppStore(s => s.activeItem)
  const setActiveItem = useAppStore(s => s.setActiveItem)

  const pxPerSec = useAppStore(s => s.pxPerSec) || 100
  const setZoom = useAppStore(s => s.setZoom)
  const scrollLeft = useAppStore(s => s.scrollLeft) || 0
  const setScrollLeft = useAppStore(s => s.setScrollLeft)
  const bottomView = useAppStore(s => s.bottomView)
  const setBottomView = useAppStore(s => s.setBottomView)

  const selection = useAppStore(s => s.selection)
  const setSelectionIn = useAppStore(s => s.setSelectionIn)
  const setSelectionOut = useAppStore(s => s.setSelectionOut)
  const setSelectionRange = useAppStore(s => s.setSelectionRange)
  const clearSelection = useAppStore(s => s.clearSelection)

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [hoveredHit, setHoveredHit] = useState(null)
  const [draggingHit, setDraggingHit] = useState(null)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [isPanning, setIsPanning] = useState(null)

  const TRACK_LABELS_WIDTH = 100
  const RULER_HEIGHT = 30
  const PLAYHEAD_GRAB_PX = 10

  const TRACKS = [
    { id: 'rally', label: 'Rally', height: 30, bg: '#09090b' },
    { id: 'pos_x', label: 'X (t)', height: 85, bg: '#18181b', valueFn: p => p.x, color: '#38bdf8' },
    { id: 'pos_y', label: 'Y (t)', height: 85, bg: '#09090b', valueFn: p => p.y, color: '#fb923c' },
    { id: 'pos_z', label: 'Z (t)', height: 85, bg: '#18181b', valueFn: p => p.z, color: '#34d399' },
    { id: 'anomaly', label: 'Anomaly', height: 40, bg: '#09090b' },
  ]

  const TOTAL_TRACKS_HEIGHT = TRACKS.reduce((s, t) => s + t.height, 0)

  const maxScrollLeft = Math.max(
    0,
    durationSec * pxPerSec - Math.max(0, dimensions.width - TRACK_LABELS_WIDTH)
  )

  const clampScroll = (value) => Math.max(0, Math.min(value, maxScrollLeft))
  const getUsableWidth = () => Math.max(0, dimensions.width - TRACK_LABELS_WIDTH)
  const getFixedPlayheadX = () => TRACK_LABELS_WIDTH + getUsableWidth() / 2
  const getTimeFromCanvasX = (x) => Math.max(0, (x - TRACK_LABELS_WIDTH + scrollLeft) / pxPerSec)
  const getCenterTimeFromScroll = (nextScroll) => Math.max(0, (nextScroll + getUsableWidth() / 2) / pxPerSec)

  const pauseForTimelineDrag = () => {
    setPlaying(false)
  }

  const setScrollAndCenterTime = (nextScroll) => {
    const clamped = clampScroll(nextScroll)
    setScrollLeft(clamped)
    setCurrentTime(getCenterTimeFromScroll(clamped))
  }

  const ensureTimeVisible = (timeSec) => {
    const usableWidth = getUsableWidth()
    if (usableWidth <= 0) return

    const targetScroll = clampScroll(timeSec * pxPerSec - usableWidth / 2)
    if (Math.abs(targetScroll - scrollLeft) > 0.5) {
      setScrollLeft(targetScroll)
    }
  }

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
    ensureTimeVisible(startSec)
  }

  const goPrevRally = () => {
    const sorted = [...rallies].sort((a, b) => a.start_frame - b.start_frame)
    if (!sorted.length) return

    if (activeItem?.type === 'rally') {
      const idx = sorted.findIndex(r => r.id === activeItem.id)
      if (idx > 0) {
        goToRallyByIndex(idx - 1)
        return
      }
    }

    const curFrame = Math.round(currentTime * fps)
    let targetIdx = -1

    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].start_frame < curFrame) {
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
      const idx = sorted.findIndex(r => r.id === activeItem.id)
      if (idx !== -1 && idx < sorted.length - 1) {
        goToRallyByIndex(idx + 1)
        return
      }
    }

    const curFrame = Math.round(currentTime * fps)
    let targetIdx = sorted.findIndex(r => r.start_frame > curFrame)

    if (targetIdx === -1) targetIdx = sorted.length - 1
    goToRallyByIndex(targetIdx)
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
  const isSyncingFromScrollRef = useRef(false)

  useEffect(() => {
    if (dimensions.width === 0 || isSyncingFromScrollRef.current || isPanning) return

    const targetScroll = clampScroll(currentTime * pxPerSec - getUsableWidth() / 2)
    if (Math.abs(targetScroll - scrollLeft) <= 0.5) return

    isProgrammaticScrollRef.current = true
    setScrollLeft(targetScroll)
  }, [currentTime, pxPerSec, dimensions.width, scrollLeft, isPanning])

  useEffect(() => {
    if (scrollBarRef.current && Math.abs(scrollBarRef.current.scrollLeft - scrollLeft) > 1) {
      isProgrammaticScrollRef.current = true
      scrollBarRef.current.scrollLeft = scrollLeft
    }
  }, [scrollLeft])

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
              ensureTimeVisible(s)
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
          e.preventDefault()

          const step = 1 / fps
          setCurrentTime(Math.max(0, currentTime + (isRight ? step : -step)))
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    activeItem,
    rallies,
    hits,
    currentTime,
    fps,
    clearSelection,
    setActiveItem,
    setSelectionIn,
    setSelectionOut,
    setSelectionRange,
    updateHit,
    setCurrentTime,
  ])

  useEffect(() => {
    if (!isScrubbing && !draggingHit && !isPanning && playing) {
      ensureTimeVisible(currentTime)
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
    const h = Math.max(dimensions.height, TOTAL_TRACKS_HEIGHT + RULER_HEIGHT)

    ctx.clearRect(0, 0, w, h)

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
        for (const r of rallies) {
          const sx = timeToX(r.start_frame / fps)
          const ex = timeToX(r.end_frame / fps)

          if (ex < TRACK_LABELS_WIDTH || sx > w) continue

          let color = 'rgba(63,63,70,0.5)'
          if (r.status === 'verified') color = 'rgba(5,150,105,0.5)'
          else if (r.status === 'needs_fix') color = 'rgba(225,29,72,0.5)'
          else if (r.status === 'reviewing') color = 'rgba(2,132,199,0.5)'

          const barY = trackTop + 4
          const barH = track.height - 8
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

              if (pxs.length > 0) {
                segments.push({
                  pxs: [...pxs],
                  pys: [...pys],
                })
              }

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

          if (pxs.length > 0) {
            segments.push({
              pxs: [...pxs],
              pys: [...pys],
            })
          }

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
        ctx.lineTo(sx, h)
        ctx.moveTo(ex, RULER_HEIGHT)
        ctx.lineTo(ex, h)
        ctx.stroke()

        ctx.setLineDash([])
      }
    }

    for (const hItem of hits) {
      const isDraggingThis = draggingHit?.id === hItem.id
      const frame = isDraggingThis && draggingHit.currentFrame !== undefined
        ? draggingHit.currentFrame
        : (hItem.new_hit_frame ?? hItem.hit_frame)

      const hx = timeToX(frame / fps)

      if (hx < TRACK_LABELS_WIDTH || hx > w) continue

      const conf = hItem.confidence ?? 1
      const isLow = conf < 0.5
      const isHovered = hoveredHit === hItem.id || isDraggingThis

      ctx.save()

      ctx.strokeStyle = isHovered
        ? '#22d3ee'
        : isLow
          ? '#f43f5e'
          : 'rgba(244, 244, 245, 0.65)'
      ctx.lineWidth = isHovered ? 2 : 1
      ctx.setLineDash(isHovered ? [] : [4, 4])

      ctx.beginPath()
      ctx.moveTo(hx, RULER_HEIGHT)
      ctx.lineTo(hx, RULER_HEIGHT + TOTAL_TRACKS_HEIGHT)
      ctx.stroke()

      ctx.setLineDash([])

      const label = hItem.shot_type || 'Hit'
      ctx.font = '10px sans-serif'
      const textWidth = ctx.measureText(label).width
      const boxWidth = Math.max(42, textWidth + 10)
      const boxHeight = 22
      const boxX = Math.max(
        TRACK_LABELS_WIDTH + 2,
        Math.min(w - boxWidth - 2, hx - boxWidth / 2)
      )
      const boxY = RULER_HEIGHT + 6

      ctx.fillStyle = isHovered
        ? '#083344'
        : 'rgba(39,39,42,0.9)'
      ctx.strokeStyle = isLow
        ? '#f43f5e'
        : isHovered
          ? '#22d3ee'
          : '#52525b'
      ctx.lineWidth = 1

      ctx.beginPath()
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 4)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = isLow
        ? '#fda4af'
        : isHovered
          ? '#67e8f9'
          : '#d4d4d8'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, boxX + boxWidth / 2, boxY + boxHeight / 2)

      ctx.restore()
    }

    const cx = getFixedPlayheadX()

    if (cx >= TRACK_LABELS_WIDTH && cx <= w) {
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(cx, 0)
      ctx.lineTo(cx, h)
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
    ctx.fillRect(0, 0, TRACK_LABELS_WIDTH, h)

    ctx.strokeStyle = '#27272a'
    ctx.beginPath()
    ctx.moveTo(TRACK_LABELS_WIDTH, 0)
    ctx.lineTo(TRACK_LABELS_WIDTH, h)
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
  }, [
    dimensions,
    scrollLeft,
    pxPerSec,
    trajMap,
    rallies,
    hits,
    anomalies,
    currentTime,
    hoveredHit,
    draggingHit,
    fps,
    selection,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleWheel = (e) => {
      e.preventDefault()
      pauseForTimelineDrag()

      if (e.shiftKey) {
        const mouseX = e.offsetX
        if (mouseX < TRACK_LABELS_WIDTH) return

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
        const targetTime = (mouseX - TRACK_LABELS_WIDTH + scrollLeft) / pxPerSec

        let newPx = pxPerSec * zoomFactor
        newPx = Math.max(5, Math.min(newPx, 1000))

        const newScroll = targetTime * newPx - (mouseX - TRACK_LABELS_WIDTH)

        setZoom(newPx)
        setScrollAndCenterTime(newScroll)
      } else {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        setScrollAndCenterTime(scrollLeft + delta)
      }
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [scrollLeft, pxPerSec, setZoom, setPlaying])

  const getHitAtX = (x) => {
    const t = getTimeFromCanvasX(x)
    const clickZoneSec = 5 / pxPerSec

    let bestHit = null
    let minDist = Infinity

    for (const hItem of hits) {
      const ht = (hItem.new_hit_frame ?? hItem.hit_frame) / fps
      const dist = Math.abs(ht - t)

      if (dist < clickZoneSec && dist < minDist) {
        minDist = dist
        bestHit = hItem
      }
    }

    return bestHit
  }

  const getPlayheadX = () => getFixedPlayheadX()
  const isNearPlayhead = (x) => Math.abs(x - getPlayheadX()) <= PLAYHEAD_GRAB_PX

  const handlePointerDown = (e) => {
    e.target.setPointerCapture(e.pointerId)

    const x = e.nativeEvent.offsetX
    const y = e.nativeEvent.offsetY

    if (x < TRACK_LABELS_WIDTH) return

    pauseForTimelineDrag()

    const t = getTimeFromCanvasX(x)

    if (isNearPlayhead(x) || y < RULER_HEIGHT) {
      setIsScrubbing(true)
      setCurrentTime(t)
      return
    }

    let currentYOffset = RULER_HEIGHT

    for (const track of TRACKS) {
      if (y >= currentYOffset && y <= currentYOffset + track.height) {
        if (track.id !== 'rally') {
          const hit = getHitAtX(x)

          if (hit) {
            setDraggingHit({
              id: hit.id,
              startX: x,
              frameOffset: hit.new_hit_frame ?? hit.hit_frame,
            })

            setActiveItem('hit', hit.id)

            const frame = hit.new_hit_frame ?? hit.hit_frame
            setCurrentTime(frame / fps)

            return
          }
        }

        if (track.id === 'rally') {
          for (const r of rallies) {
            const startSec = r.start_frame / fps
            const endSec = r.end_frame / fps

            if (t >= startSec && t <= endSec) {
              setSelectionRange(startSec, endSec)
              setCurrentTime(startSec)
              setActiveItem('rally', r.id)
              ensureTimeVisible(startSec)
              return
            }
          }
        }

        break
      }

      currentYOffset += track.height
    }

    const hit = getHitAtX(x)

    if (hit && y >= RULER_HEIGHT && y <= RULER_HEIGHT + TOTAL_TRACKS_HEIGHT) {
      setDraggingHit({
        id: hit.id,
        startX: x,
        frameOffset: hit.new_hit_frame ?? hit.hit_frame,
      })

      setActiveItem('hit', hit.id)

      const frame = hit.new_hit_frame ?? hit.hit_frame
      setCurrentTime(frame / fps)

      return
    }

    clearSelection()
    setActiveItem(null, null)

    setIsPanning({
      pointerId: e.pointerId,
      startX: x,
      startScroll: scrollLeft,
    })
  }

  const handlePointerMove = (e) => {
    const x = e.nativeEvent.offsetX
    const y = e.nativeEvent.offsetY
    const canvas = canvasRef.current

    if (isScrubbing) {
      pauseForTimelineDrag()

      const t = getTimeFromCanvasX(x)

      setCurrentTime(t)

      if (canvas) canvas.style.cursor = 'ew-resize'
      return
    }

    if (draggingHit) {
      pauseForTimelineDrag()

      const dx = x - draggingHit.startX
      const dxSec = dx / pxPerSec
      const newFrame = Math.max(0, Math.round(draggingHit.frameOffset + dxSec * fps))
      const t = newFrame / fps

      setDraggingHit(prev => ({
        ...prev,
        currentFrame: newFrame,
      }))

      setCurrentTime(t)

      if (canvas) canvas.style.cursor = 'ew-resize'
      return
    }

    if (isPanning) {
      pauseForTimelineDrag()

      const dx = x - isPanning.startX
      const targetScroll = isPanning.startScroll - dx

      if (rafPanRef.current) cancelAnimationFrame(rafPanRef.current)

      rafPanRef.current = requestAnimationFrame(() => {
        setScrollAndCenterTime(targetScroll)
      })

      if (canvas) canvas.style.cursor = 'grabbing'
      return
    }

    if (x > TRACK_LABELS_WIDTH && isNearPlayhead(x)) {
      if (canvas) canvas.style.cursor = 'ew-resize'
      if (hoveredHit) setHoveredHit(null)
      return
    }

    if (x > TRACK_LABELS_WIDTH && y > RULER_HEIGHT && y < RULER_HEIGHT + TOTAL_TRACKS_HEIGHT) {
      const hit = getHitAtX(x)

      if (hit && hoveredHit !== hit.id) {
        setHoveredHit(hit.id)

        if (canvas) canvas.style.cursor = 'ew-resize'
      } else if (!hit && hoveredHit) {
        setHoveredHit(null)

        if (canvas) canvas.style.cursor = 'grab'
      } else if (!hit && canvas) {
        canvas.style.cursor = 'grab'
      }
    } else {
      if (hoveredHit) setHoveredHit(null)
      if (canvas) canvas.style.cursor = 'grab'
    }
  }

  const handlePointerUp = (e) => {
    e.target.releasePointerCapture(e.pointerId)

    setIsScrubbing(false)
    setIsPanning(null)

    if (rafPanRef.current) {
      cancelAnimationFrame(rafPanRef.current)
      rafPanRef.current = null
    }

    if (canvasRef.current) canvasRef.current.style.cursor = 'grab'

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
    <div className="h-full w-full min-h-0 min-w-0 relative flex flex-col bg-[#09090b] select-none overflow-hidden">
      <div className="h-[42px] shrink-0 px-3 grid grid-cols-[auto_1fr_auto] items-center border-b border-zinc-800 bg-zinc-950 shadow-sm z-20 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
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

          {(draggingHit?.currentFrame !== undefined) && (
            <div className="hidden md:block text-xs text-amber-300 font-semibold px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 rounded shrink-0">
              Hit #{draggingHit.id} → Frame {draggingHit.currentFrame}
            </div>
          )}
        </div>

        <div className="flex justify-center min-w-0 overflow-hidden">
          <PlaybackUI
            goPrevRally={goPrevRally}
            goNextRally={goNextRally}
          />
        </div>

        <div className="flex items-center justify-end gap-2 min-w-0">
          <button
            type="button"
            className="px-2 py-1 text-xs rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 shrink-0"
            title={
              '操作說明\n' +
              '拖曳空白區域：平移 Timeline\n' +
              '拖曳藍色播放線：Scrub\n' +
              '拖曳 Hit 線：移動 Hit frame\n' +
              'Rally 按鈕：切換上一個 / 下一個 Rally\n' +
              'Space：播放 / 暫停\n' +
              '← / →：單幀移動\n' +
              'I / O：設定 In / Out\n' +
              'Esc：取消選取'
            }
          >
            快捷鍵
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 min-w-0 relative overflow-hidden bg-[#09090b]" ref={containerRef}>
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
          style={{ touchAction: 'none', cursor: 'grab' }}
        />
      </div>

      <div
        ref={scrollBarRef}
        className="h-[14px] w-full shrink-0 overflow-x-scroll overflow-y-hidden bg-zinc-950 border-t border-zinc-800"
        onScroll={(e) => {
          const nextScroll = clampScroll(e.target.scrollLeft)

          if (isProgrammaticScrollRef.current) {
            isProgrammaticScrollRef.current = false
            return
          }

          pauseForTimelineDrag()

          isSyncingFromScrollRef.current = true

          setScrollLeft(nextScroll)
          setCurrentTime(getCenterTimeFromScroll(nextScroll))

          requestAnimationFrame(() => {
            isSyncingFromScrollRef.current = false
          })
        }}
      >
        <div
          style={{
            width: `${(durationSec * pxPerSec) + TRACK_LABELS_WIDTH}px`,
            height: '1px',
          }}
        />
      </div>
    </div>
  )
}