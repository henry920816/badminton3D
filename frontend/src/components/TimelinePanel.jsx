import React, { useEffect, useMemo, useRef, useState } from 'react'
import { DataSet } from 'vis-data'
import { Timeline } from 'vis-timeline/standalone'
import 'vis-timeline/styles/vis-timeline-graph2d.min.css'

import { api } from '../api.js'
import { useAppStore } from '../store.js'

// helpers
function secToDate(sec) { return new Date(sec * 1000) }
function dateToSec(d) { return d.getTime() / 1000 }

export default function TimelinePanel() {
  const containerRef = useRef(null)
  const overlayRef = useRef(null)
  const timelineRef = useRef(null)
  const itemsRef = useRef(null)

  const matchId = useAppStore(s => s.matchId)
  const fps = useAppStore(s => s.fps)
  const fpsRef = useRef(fps)
  const durationSec = useAppStore(s => s.durationSec)

  useEffect(() => { fpsRef.current = fps }, [fps])

  const currentTime = useAppStore(s => s.currentTime)
  const setCurrentTime = useAppStore(s => s.setCurrentTime)
  const selection = useAppStore(s => s.selection)
  const setSelectionRange = useAppStore(s => s.setSelectionRange)
  const setSelectionIn = useAppStore(s => s.setSelectionIn)
  const setSelectionOut = useAppStore(s => s.setSelectionOut)
  const clearSelection = useAppStore(s => s.clearSelection)

  const rallies = useAppStore(s => s.rallies)
  const hits = useAppStore(s => s.hits)
  const anomalies = useAppStore(s => s.anomalies)

  const trajMap = useAppStore(s => s.trajByFrame)
  const upsertTrajPoints = useAppStore(s => s.upsertTrajPoints)

  const setActiveItem = useAppStore(s => s.setActiveItem)
  const activeItem = useAppStore(s => s.activeItem)

  // --- Drag HUD: 即時顯示拖曳中的 frame ---
  const dragHudRef = useRef(null)
  const lastDragRef = useRef({ key: null, frame: null })
  const showHud = (key, text, frame) => {
    const el = dragHudRef.current
    if (!el) return
    const last = lastDragRef.current
    if (last.key === key && last.frame === frame) return
    lastDragRef.current = { key, frame }
    el.style.display = 'inline-flex'
    el.textContent = text
  }
  const showDragHud = (hitId, frame) => {
    showHud(`hit:${hitId}`, `dragging hit#${hitId} → frame ${frame}`, frame)
  }
  const showCursorHud = (frame) => {
    showHud('cursor', `dragging cursor → frame ${frame}`, frame)
  }
  const showWindowHud = (frame) => {
    showHud('window', `dragging window → frame ${frame}`, frame)
  }
  const hideDragHud = () => {
    const el = dragHudRef.current
    if (!el) return
    el.style.display = 'none'
    el.textContent = ''
    lastDragRef.current = { key: null, frame: null }
  }

  // Build timeline items
  const visItems = useMemo(() => {
    const arr = []

    // Rallies: range
    for (const r of rallies || []) {
      const start = r.start_frame / fps
      const end = r.end_frame / fps
      const cls = r.status === 'verified' ? 'bg-emerald-600' :
        r.status === 'needs_fix' ? 'bg-rose-600' :
          r.status === 'reviewing' ? 'bg-sky-600' : 'bg-zinc-700'
      arr.push({
        id: `rally:${r.id}`,
        group: 'rally',
        content: `R${r.rally_index}`,
        start: secToDate(start),
        end: secToDate(end),
        type: 'range',
        className: `rounded ${cls} text-xs`,
      })
    }

    // Hits: point
    for (const h of hits || []) {
      const t = (h.new_hit_frame ?? h.hit_frame) / fps
      const conf = h.confidence ?? 1.0
      const isLow = conf < 0.5
      arr.push({
        id: `hit:${h.id}`,
        group: 'hit',
        content: `${h.shot_type || 'Hit'} (${h.player})`,
        start: secToDate(t),
        type: 'point',
        className: `text-xs ${isLow ? 'text-rose-300' : 'text-zinc-100'}`,
      })
    }

    // Anomalies: range
    for (const a of anomalies || []) {
      const start = a.start_frame / fps
      const end = a.end_frame / fps
      const sev = a.severity ?? 3
      const opacity = Math.min(0.65, 0.18 + sev * 0.08)
      arr.push({
        id: `anomaly:${a.id}`,
        group: 'anomaly',
        content: `${a.kind || 'anomaly'}·S${sev}`,
        start: secToDate(start),
        end: secToDate(end),
        type: 'range',
        style: `background: rgba(244,63,94,${opacity}); border: 1px solid rgba(244,63,94,0.9); color: #fff;`,
      })
    }

    // Selection overlay item
    if (selection.inTime != null && selection.outTime != null) {
      const start = Math.min(selection.inTime, selection.outTime)
      const end = Math.max(selection.inTime, selection.outTime)
      arr.push({
        id: `sel:range`,
        group: 'selection',
        content: 'Selection',
        start: secToDate(start),
        end: secToDate(end),
        type: 'range',
        style: 'background: rgba(34,197,94,0.12); border: 1px dashed rgba(34,197,94,0.8); color: rgba(34,197,94,0.9);',
      })
    }

    return arr
  }, [rallies, hits, anomalies, selection.inTime, selection.outTime, fps])

  // Initialize timeline
  useEffect(() => {
    if (!containerRef.current) return

    const items = new DataSet(visItems)
    itemsRef.current = items

    const groups = new DataSet([
      { id: 'rally', content: 'Rally' },
      { id: 'hit', content: 'Hit' },
      { id: 'anomaly', content: 'Anomaly' },
      { id: 'selection', content: ' ' },
    ])

    const options = {
      height: '100%',
      stack: false,
      orientation: 'top',
      selectable: true,
      multiselect: false,
      zoomKey: 'ctrlKey',
      zoomMin: 0.5 * 1000,     // 0.5s
      zoomMax: 120 * 1000,     // 120s
      margin: { item: 6, axis: 6 },
      groupHeightMode: 'fixed',

      // Snap dragging to frame (1/fps sec)
      snap: (date, scale, step) => {
        const fps = fpsRef.current || 60
        const sec = date.getTime() / 1000
        const frame = Math.max(0, Math.round(sec * fps))
        return new Date((frame / fps) * 1000)
      },

      editable: {
        updateTime: true,
        remove: false,
        add: false,
      },

      // ✅ 拖曳中即時回呼：更新 HUD + 讓點位固定在 frame 上
      onMoving: (item, callback) => {
        if (!String(item.id).startsWith('hit:')) {
          callback(item)
          return
        }
        const hitId = parseInt(String(item.id).split(':')[1], 10)
        const fps = fpsRef.current || 60
        const sec = dateToSec(item.start)
        const frame = Math.max(0, Math.round(sec * fps))
        showDragHud(hitId, frame)

        const snappedStart = secToDate(frame / fps)
        callback({ ...item, start: snappedStart })
      },

      // ✅ 放開滑鼠才會進來：做 PATCH + 收掉 HUD
      onMove: (item, callback) => {
        if (!String(item.id).startsWith('hit:')) {
          callback(item)
          hideDragHud()
          return
        }

        const hitId = parseInt(String(item.id).split(':')[1], 10)
        const fps = fpsRef.current || 60
        const sec = dateToSec(item.start)
        const frame = Math.max(0, Math.round(sec * fps))
        const snappedStart = secToDate(frame / fps)

        const moved = { ...item, start: snappedStart }
        callback(moved)

        hideDragHud()

        api.patchHit(hitId, { new_hit_frame: frame }).catch((e) => {
          console.error(e)
          alert('更新失敗：' + String(e))
        })
      },
    }

    const tl = new Timeline(containerRef.current, items, groups, options)
    timelineRef.current = tl

    // cursor custom time
    tl.addCustomTime(secToDate(0), 'cursor')

    // ✅ 拖藍色 cursor 線：即時顯示 frame（拖曳中）
    tl.on('timechange', (props) => {
      if (!props || props.id !== 'cursor' || !props.time) return
      const fps = fpsRef.current || 60
      const sec = dateToSec(props.time)
      const frame = Math.max(0, Math.round(sec * fps))
      showCursorHud(frame)
    })
    // ✅ 放開 cursor：收 HUD（不動你原本的其他行為）
    tl.on('timechanged', (props) => {
      if (!props || props.id !== 'cursor' || !props.time) return
      hideDragHud()
    })

    // click background -> move cursor
    tl.on('click', (props) => {
      // ✅ 只針對 hit：點選 hit item 時，游標跳到 hit 的 start（最前面）
      if (props.item) {
        const [type, idStr] = String(props.item).split(':')
        const id = parseInt(idStr, 10)
        setActiveItem(type, id)

        if (type === 'hit') {
          const ds = itemsRef.current
          const it = ds ? ds.get(`hit:${id}`) : null
          const t = it?.start
          if (t) {
            const sec = dateToSec(t)
            tl.setCustomTime(t, 'cursor')
            setCurrentTime(sec)
          }
          return
        }
      }

      // 原本行為：點空白或點非 hit 時，用 props.time 當時間
      if (props.time) {
        const sec = dateToSec(props.time)
        tl.setCustomTime(props.time, 'cursor')
        setCurrentTime(sec)
      }
      if (props.item) {
        const [type, idStr] = String(props.item).split(':')
        setActiveItem(type, parseInt(idStr, 10))
      } else {
        setActiveItem(null, null)
      }
    })

    // range selection by Shift+drag
    let dragging = false
    let dragStartSec = null

    tl.on('mouseDown', (props) => {
      if (!props.time) return
      if (!props.event || !props.event.shiftKey) return
      dragging = true
      dragStartSec = dateToSec(props.time)
      setSelectionRange(dragStartSec, dragStartSec)
    })

    tl.on('mouseMove', (props) => {
      if (!dragging) return
      if (!props.time) return
      const sec = dateToSec(props.time)
      setSelectionRange(dragStartSec, sec)
    })

    tl.on('mouseUp', () => {
      dragging = false
      dragStartSec = null
      // 保險：不管是框選或拖 item，滑鼠放開就收 HUD
      hideDragHud()
    })

    // Keep overlay in sync with timeline window changes
    const redrawOverlay = () => {
      requestAnimationFrame(() => drawOverlay())
    }

    // ✅ 拖底部藍色 window bar：即時顯示 frame（用視窗中心點）
    tl.on('rangechange', (props) => {
      redrawOverlay()
      if (!props || !props.start) return
      const fps = fpsRef.current || 60
      const sSec = dateToSec(props.start)
      const eSec = props.end ? dateToSec(props.end) : sSec
      const midSec = (sSec + eSec) / 2
      const frame = Math.max(0, Math.round(midSec * fps))
      showWindowHud(frame)
    })
    tl.on('rangechanged', (props) => {
      redrawOverlay()
      hideDragHud()
    })

    // initial window
    const start = secToDate(0)
    const end = secToDate(Math.min(20, durationSec || 20))
    tl.setWindow(start, end, { animation: false })

    return () => {
      hideDragHud()
      tl.destroy()
    }
  }, []) // once

  // Update items when store changes
  useEffect(() => {
    const ds = itemsRef.current
    if (!ds) return
    ds.clear()
    ds.add(visItems)
    requestAnimationFrame(() => drawOverlay())
  }, [visItems])

  // Sync: store currentTime -> timeline cursor
  useEffect(() => {
    const tl = timelineRef.current
    if (!tl) return
    tl.setCustomTime(secToDate(currentTime), 'cursor')
  }, [currentTime])

  // Load trajectory for current window (lazy)
  async function ensureTrajForWindow() {
    const tl = timelineRef.current
    if (!tl) return
    const w = tl.getWindow()
    const sSec = dateToSec(w.start)
    const eSec = dateToSec(w.end)
    const sF = Math.max(0, Math.floor(sSec * fps))
    const eF = Math.max(0, Math.ceil(eSec * fps))

    let missing = 0
    for (let f = sF; f <= eF; f += 10) {
      if (!trajMap.has(f)) missing++
      if (missing > 15) break
    }
    if (missing > 0) {
      const pts = await api.getTraj(matchId, sF, eF)
      upsertTrajPoints(pts)
    }
  }

  // Draw overlay: x/y polylines for current window
  async function drawOverlay() {
    const canvas = overlayRef.current
    const tl = timelineRef.current
    if (!canvas || !tl) return

    await ensureTrajForWindow()

    const w = tl.getWindow()
    const sSec = dateToSec(w.start)
    const eSec = dateToSec(w.end)
    const sF = Math.max(0, Math.floor(sSec * fps))
    const eF = Math.max(0, Math.ceil(eSec * fps))

    const rect = containerRef.current.getBoundingClientRect()
    canvas.width = Math.max(1, Math.floor(rect.width))
    canvas.height = 140

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // background grid
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(63,63,70,0.6)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 10; i++) {
      const y = (canvas.height * i) / 10
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(canvas.width, y)
      ctx.stroke()
    }

    // gather points (downsample if window too large)
    const spanF = Math.max(1, eF - sF)
    const step = spanF > 6000 ? 20 : spanF > 3000 ? 10 : spanF > 1500 ? 5 : 1

    const pts = []
    for (let f = sF; f <= eF; f += step) {
      const p = trajMap.get(f)
      if (p) pts.push(p)
    }
    if (pts.length < 2) return

    // normalize x/y to fit
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
    const pad = 0.05
    const rx = (maxX - minX) || 1
    const ry = (maxY - minY) || 1
    minX -= rx * pad; maxX += rx * pad
    minY -= ry * pad; maxY += ry * pad

    function xPixel(frame) {
      return ((frame - sF) / (eF - sF)) * canvas.width
    }
    function yPixel(val, minV, maxV) {
      const t = (val - minV) / (maxV - minV)
      return canvas.height - t * canvas.height
    }

    // draw polyline X(t)
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(250,204,21,0.85)'
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const px = xPixel(pts[i].frame)
      const py = yPixel(pts[i].x, minX, maxX)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()

    // draw polyline Y(t)
    ctx.strokeStyle = 'rgba(56,189,248,0.85)'
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const px = xPixel(pts[i].frame)
      const py = yPixel(pts[i].y, minY, maxY)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()

    // annotate labels
    ctx.fillStyle = 'rgba(244,244,245,0.8)'
    ctx.font = '12px ui-sans-serif'
    ctx.fillText('X(t)', 8, 16)
    ctx.fillText('Y(t)', 50, 16)
  }

  // Redraw overlay when window size changes
  useEffect(() => {
    const onResize = () => drawOverlay()
    window.addEventListener('resize', onResize)
    const id = setInterval(() => drawOverlay(), 600)
    drawOverlay()
    return () => {
      window.removeEventListener('resize', onResize)
      clearInterval(id)
    }
  }, [fps])

  // Keyboard shortcuts for selection + anomaly nav
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return

      if (e.key === 'i' || e.key === 'I') setSelectionIn()
      if (e.key === 'o' || e.key === 'O') setSelectionOut()
      if (e.key === 'Escape') clearSelection()

      if ((e.shiftKey && (e.key === 'N' || e.key === 'n')) || (e.shiftKey && (e.key === 'P' || e.key === 'p'))) {
        const forward = (e.key === 'N' || e.key === 'n')
        const list = (anomalies || []).slice().sort((a, b) => a.start_frame - b.start_frame)
        if (!list.length) return
        const curF = Math.round(currentTime * fps)
        let target = null
        if (forward) {
          target = list.find(a => a.start_frame > curF) || list[0]
        } else {
          target = [...list].reverse().find(a => a.end_frame < curF) || list[list.length_toggleMe]
        }
        if (target) {
          const s = target.start_frame / fps
          const t = target.end_frame / fps
          setSelectionRange(s, t)
          setCurrentTime(s)
          const tl = timelineRef.current
          if (tl) {
            tl.setCustomTime(secToDate(s), 'cursor')
            tl.setSelection([`anomaly:${target.id}`])
            tl.moveTo(secToDate(s), { animation: false })
          }
          setActiveItem('anomaly', target.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anomalies, currentTime, fps])

  return (
    <div className="h-full w-full relative">
      {/* toolbar */}
      <div className="h-[42px] px-3 flex items-center gap-2 border-b border-zinc-800 bg-zinc-950">
        <div className="text-xs text-zinc-300 font-semibold">Timeline</div>
        <div className="text-xs text-zinc-500">Shift+拖曳框選；I/O 設 In/Out；Shift+N/P 跳異常</div>

        {/* ✅ 即時 frame 顯示（拖曳時才出現） */}
        <div
          ref={dragHudRef}
          className="ml-3 text-xs text-amber-300 font-semibold"
          style={{ display: 'none' }}
        />

        <div className="ml-auto text-xs text-zinc-400">
          {activeItem?.type ? `selected: ${activeItem.type} #${activeItem.id}` : 'selected: -'}
        </div>
      </div>

      {/* overlay chart */}
      <div className="absolute left-0 right-0 top-[42px] h-[140px] pointer-events-none">
        <canvas ref={overlayRef} className="w-full h-full opacity-90" />
      </div>

      {/* timeline container */}
      <div className="h-full pt-[42px]">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  )
}


