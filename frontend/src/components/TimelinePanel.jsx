import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { useAppStore } from '../store.js'
import { usePairwiseViewPoints } from '../utils/usePairwiseBallPoints.js'
import { useDisplayTrajectoryLookup, useRallyFrameRange } from '../utils/useRallyBallData.js'
import { useLabelConsistency } from '../utils/useLabelConsistency.js'


// matplotlib 的 tab10，和 triangulation_3Dline.py 各視角的配色一樣
const VIEW_COLORS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
]

// 同 triangulation_3Dline.py 速度點圖的 y 軸上限：只靠一組相機重建的
// 視角偶爾會跳出好幾百 m/s，不截掉整條軸都會被壓扁
const SPEED_AXIS_MAX = 50


// 依相機編號配色，距離、速度軌道裡同一台相機同一個顏色
const viewColor = cameraIndex => VIEW_COLORS[cameraIndex % VIEW_COLORS.length]


/**
 * 依相機視角整理距離與速度。速度是相鄰兩格 3D 點的位移乘上 fps，
 * 和原腳本一樣中間缺格就不算。
 */
function buildViewSeries(rows, fps) {
  const rowsByCamera = new Map()

  for (const row of rows || []) {
    if (!rowsByCamera.has(row.camera_index)) rowsByCamera.set(row.camera_index, [])
    rowsByCamera.get(row.camera_index).push(row)
  }

  return [...rowsByCamera.keys()]
    .sort((a, b) => a - b)
    .map((cameraIndex) => {
      const cameraRows = rowsByCamera.get(cameraIndex).sort((a, b) => a.frame - b.frame)
      const speed = []

      for (let i = 1; i < cameraRows.length; i++) {
        const previous = cameraRows[i - 1]
        const current = cameraRows[i]

        if (current.frame - previous.frame !== 1) continue

        speed.push({
          frame: current.frame,
          value: Math.hypot(
            current.x - previous.x,
            current.y - previous.y,
            current.z - previous.z,
          ) * fps,
        })
      }

      return {
        cameraIndex,
        color: viewColor(cameraIndex),
        distance: cameraRows.map(row => ({ frame: row.frame, value: row.distance })),
        speed,
      }
    })
}


function formatAxisValue(value) {
  return Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
}

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

const LABEL_W = 112
const RULER_H = 28
const PLAYHEAD_GRAB_PX = 10

// 曲線軌道平分剩下的高度，太矮就改成捲動
const MIN_PLOT_H = 40
const MAX_PLOT_H = 150

const RALLY_LANE = { id: 'rally', label: 'Rally', height: 24 }
const HITS_LANE = { id: 'hits', label: '擊球', height: 22 }
const ANOMALY_LANE = { id: 'anomaly', label: '異常', height: 18 }

const PLOT_TRACKS = [
  { id: 'pos_x', toggle: 'x', label: 'X', unit: 'm', valueFn: p => p.x, color: '#38bdf8' },
  // raw 座標的 y 朝下（地板 y = 0.5，越高越小），反過來畫，球飛高時曲線往上
  { id: 'pos_y', toggle: 'y', label: 'Y', unit: 'm', valueFn: p => p.y, color: '#fb923c', invert: true },
  { id: 'pos_z', toggle: 'z', label: 'Z', unit: 'm', valueFn: p => p.z, color: '#34d399' },
  // 2D 標註兩兩重建、每個視角各一條（同 triangulation_3Dline.py）
  { id: 'view_distance', toggle: 'distance', label: '距離', unit: 'm·log', metric: 'distance', log: true },
  { id: 'view_speed', toggle: 'speed', label: '速度', unit: 'm/s', metric: 'speed' },
  // 每一格所有視角的 2D 標註一起三角化、投影回各台的 RMS：各台極線交會
  // 越集中越低，越高越該回去修那一格的標註
  { id: 'label_consistency', toggle: 'consistency', label: '標註一致', unit: 'px', metric: 'consistency', log: true },
]

const TRACK_TOGGLES = [
  ['x', 'X', '#38bdf8'],
  ['y', 'Y', '#fb923c'],
  ['z', 'Z', '#34d399'],
  ['distance', '距離', '#a1a1aa'],
  ['speed', '速度', '#a1a1aa'],
  ['consistency', '標註一致', '#a1a1aa'],
  ['reference', '3D 參考', '#e4e4e7', true],
]

// 3D 軌跡的距離與速度，在距離 / 速度軌道上畫成白色虛線當參考，
// 角色同 triangulation_3Dline.py 的 Ground truth 線。用的是 3D 場景
// 顯示的那一份（純 2D 或 ball_traj），不是固定 ball_traj
const REFERENCE_COLOR = 'rgba(244,244,245,0.9)'

// 標註一致軌道只有一條線，不分相機
const CONSISTENCY_COLOR = 'rgba(244,244,245,0.85)'

const DEFAULT_VISIBLE_TRACKS = {
  x: true,
  y: true,
  z: true,
  distance: true,
  speed: true,
  consistency: true,
  reference: true,
}
const VISIBLE_TRACKS_KEY = 'badminton3d.timeline.visibleTracks'

const RALLY_STYLES = {
  verified: ['rgba(16,185,129,0.20)', '#10b981'],
  needs_fix: ['rgba(244,63,94,0.20)', '#f43f5e'],
  reviewing: ['rgba(14,165,233,0.20)', '#0ea5e9'],
  default: ['rgba(82,82,91,0.30)', '#71717a'],
}

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Consolas, monospace'

const TIMELINE_TIPS = (
  'Timeline 操作\n'
  + '拖曳空白處：平移\n'
  + '拖曳播放線或上方尺規：Scrub\n'
  + '拖曳擊球線：移動 Hit frame\n'
  + '點 Rally：選取整段\n'
  + '滾輪：平移；Shift + 滾輪：縮放\n'
  + '← / →：單幀移動\n'
  + 'I / O：設定 In / Out；Esc：取消選取'
)


function loadVisibleTracks() {
  try {
    const raw = window.localStorage.getItem(VISIBLE_TRACKS_KEY)
    if (raw) return { ...DEFAULT_VISIBLE_TRACKS, ...JSON.parse(raw) }
  } catch {
    // 無痕視窗或封鎖儲存時用預設值
  }
  return DEFAULT_VISIBLE_TRACKS
}


function saveVisibleTracks(value) {
  try {
    window.localStorage.setItem(VISIBLE_TRACKS_KEY, JSON.stringify(value))
  } catch {
    // 存不了就只在這次開啟有效
  }
}


// 主刻度間距至少 80 px
function pickTickStep(pxPerSec) {
  return TICK_STEPS.find(step => step * pxPerSec >= 80) ?? TICK_STEPS[TICK_STEPS.length - 1]
}


function formatTick(t, step) {
  const minutes = Math.floor(t / 60 + 1e-9)
  const seconds = t - minutes * 60
  const secondsText = step < 1 ? seconds.toFixed(1) : String(Math.round(seconds))

  if (minutes > 0) {
    return `${minutes}:${secondsText.padStart(step < 1 ? 4 : 2, '0')}`
  }
  return `${secondsText}s`
}


function formatClock(t) {
  const minutes = Math.floor(t / 60)
  const seconds = t - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`
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
  // 3D 參考線和 3D 場景畫同一份軌跡（可能是純 2D 補點、平滑過的）
  const displayLookup = useDisplayTrajectoryLookup()

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
  const [visibleTracks, setVisibleTracks] = useState(loadVisibleTracks)

  // 軌道開關收在下拉選單裡（攤在標題列上會擋到其他按鈕）。標題列是
  // overflow-hidden，選單用 fixed 定位在按鈕下方才不會被切掉
  const trackMenuButtonRef = useRef(null)
  const trackMenuRef = useRef(null)
  const [trackMenuPosition, setTrackMenuPosition] = useState(null)

  const toggleTrackMenu = () => {
    if (trackMenuPosition) {
      setTrackMenuPosition(null)
      return
    }

    const bounds = trackMenuButtonRef.current?.getBoundingClientRect()
    if (bounds) setTrackMenuPosition({ top: bounds.bottom + 4, right: window.innerWidth - bounds.right })
  }

  useEffect(() => {
    if (!trackMenuPosition) return undefined

    const close = () => setTrackMenuPosition(null)
    const handlePointerDown = (event) => {
      if (
        trackMenuRef.current?.contains(event.target)
        || trackMenuButtonRef.current?.contains(event.target)
      ) {
        return
      }
      close()
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', close)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', close)
    }
  }, [trackMenuPosition])

  const toggleTrack = (key) => {
    setVisibleTracks((previous) => {
      const next = { ...previous, [key]: !previous[key] }
      saveVisibleTracks(next)
      return next
    })
  }

  const showViewMetrics = visibleTracks.distance || visibleTracks.speed
  const matchId = useAppStore(s => s.matchId)
  const { startFrame: rangeStartFrame, endFrame: rangeEndFrame } = useRallyFrameRange()
  const viewPoints = usePairwiseViewPoints(
    showViewMetrics ? matchId : null,
    rangeStartFrame,
    rangeEndFrame,
  )
  const viewSeries = useMemo(
    () => buildViewSeries(viewPoints.points, fps),
    [viewPoints.points, fps],
  )


  const consistency = useLabelConsistency(visibleTracks.consistency)
  const consistencySeries = useMemo(
    () => [{
      cameraIndex: null,
      color: CONSISTENCY_COLOR,
      consistency: consistency.rows,
    }],
    [consistency.rows],
  )
  const consistencyByFrame = useMemo(
    () => new Map(consistency.rows.map(row => [row.frame, row])),
    [consistency.rows],
  )

  // 各曲線軌道畫哪一批、目前的載入狀態
  const laneSource = lane => (
    lane.metric === 'consistency'
      ? {
          series: consistencySeries,
          status: consistency.status,
          loadingText: '2D 標註載入中…',
          errorText: '無法取得 2D 標註',
          emptyText: '畫面範圍內沒有 3 台以上同時標到的格子',
        }
      : {
          series: viewSeries,
          status: viewPoints.status,
          loadingText: '兩兩重建計算中…',
          errorText: '無法取得兩兩重建（範圍過大或後端錯誤）',
          emptyText: '畫面範圍內沒有重建點',
        }
  )

  const lanes = useMemo(() => {
    const plots = PLOT_TRACKS.filter(track => visibleTracks[track.toggle])
    const fixedHeight = RULER_H + RALLY_LANE.height + HITS_LANE.height + ANOMALY_LANE.height
    const plotHeight = plots.length
      ? Math.max(MIN_PLOT_H, Math.min(MAX_PLOT_H, Math.floor((dimensions.height - fixedHeight) / plots.length)))
      : 0

    let top = RULER_H

    return [
      RALLY_LANE,
      HITS_LANE,
      ...plots.map(track => ({ ...track, height: plotHeight })),
      ANOMALY_LANE,
    ].map((lane) => {
      const placed = { ...lane, top }
      top += lane.height
      return placed
    })
  }, [visibleTracks, dimensions.height])

  const lastLane = lanes[lanes.length - 1]
  const tracksBottom = lastLane.top + lastLane.height
  const canvasHeight = Math.max(dimensions.height, tracksBottom)
  const laneAtY = y => lanes.find(lane => y >= lane.top && y < lane.top + lane.height)

  const currentFrame = Math.round(currentTime * fps)
  const currentRally = rallies.find(
    rally => currentFrame >= rally.start_frame && currentFrame <= rally.end_frame,
  )

  const maxScrollLeft = Math.max(
    0,
    durationSec * pxPerSec - Math.max(0, dimensions.width - LABEL_W)
  )

  const clampScroll = (value) => Math.max(0, Math.min(value, maxScrollLeft))
  const getUsableWidth = () => Math.max(0, dimensions.width - LABEL_W)
  // 平常播放線在正中間；捲到開頭或結尾時捲不動，播放線才會離開中間
  const getPlayheadX = () => LABEL_W + currentTime * pxPerSec - scrollLeft
  const getTimeFromCanvasX = (x) => Math.max(0, (x - LABEL_W + scrollLeft) / pxPerSec)
  const getCenterTimeFromScroll = (nextScroll) => Math.max(0, (nextScroll + getUsableWidth() / 2) / pxPerSec)
  const clampZoom = value => Math.max(5, Math.min(value, 1000))

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

  // 播放線固定在中間，縮放後由下面的 effect 把目前時間捲回中間
  const zoomBy = (factor) => {
    pauseForTimelineDrag()
    setZoom(clampZoom(pxPerSec * factor))
  }

  const fitRange = () => {
    if (rangeStartFrame == null || rangeEndFrame == null) return

    const usableWidth = getUsableWidth()
    if (usableWidth <= 0) return

    const startSec = rangeStartFrame / fps
    const endSec = rangeEndFrame / fps
    const centerTime = Math.min(Math.max(currentTime, startSec), endSec)
    const halfSpan = Math.max(centerTime - startSec, endSec - centerTime, 0.5)

    pauseForTimelineDrag()
    setZoom(clampZoom(usableWidth / (2 * halfSpan * 1.06)))
    if (centerTime !== currentTime) setCurrentTime(centerTime)
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
      const idx = sorted.findIndex(r => r.id === activeItem.id)
      if (idx !== -1 && idx < sorted.length - 1) {
        goToRallyByIndex(idx + 1)
        return
      }
    }

    let targetIdx = sorted.findIndex(r => r.start_frame > currentFrame)

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
    const w = dimensions.width
    const h = canvasHeight

    canvas.width = w * scale
    canvas.height = h * scale
    ctx.setTransform(scale, 0, 0, scale, 0, 0)

    ctx.fillStyle = '#09090b'
    ctx.fillRect(0, 0, w, h)

    const timeToX = (t) => t * pxPerSec - scrollLeft + LABEL_W
    const xToTime = (x) => (x - LABEL_W + scrollLeft) / pxPerSec

    const sSec = xToTime(LABEL_W)
    const eSec = xToTime(w)
    const sF = Math.max(0, Math.floor(sSec * fps))
    const eF = Math.max(0, Math.ceil(eSec * fps))
    const tickStep = pickTickStep(pxPerSec)
    const firstTick = Math.max(0, Math.ceil(sSec / tickStep))
    const lastTick = Math.floor(eSec / tickStep)

    const laneById = Object.fromEntries(lanes.map(lane => [lane.id, lane]))
    const hitsLane = laneById.hits
    const anomalyLane = laneById.anomaly
    const plotRanges = {}

    const pts = []
    const step = Math.max(1, Math.floor((eF - sF) / 1000))

    for (let f = sF; f <= eF; f += step) {
      const p = trajMap.get(f)
      if (p) pts.push(p)
    }

    // 3D 參考的距離與速度；速度同各視角，是和前一格的位移乘上 fps
    const referencePoints = { distance: [], speed: [] }

    if (visibleTracks.reference) {
      for (let f = sF; f <= eF; f += step) {
        const p = displayLookup.get(f)
        if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) continue

        referencePoints.distance.push({ frame: p.frame, value: Math.hypot(p.x, p.y, p.z) })

        const previous = displayLookup.get(p.frame - 1)
        if (previous && [previous.x, previous.y, previous.z].every(Number.isFinite)) {
          referencePoints.speed.push({
            frame: p.frame,
            value: Math.hypot(p.x - previous.x, p.y - previous.y, p.z - previous.z) * fps,
          })
        }
      }
    }

    // 軌道底色與分隔線
    let plotIndex = 0

    for (const lane of lanes) {
      const isPlot = Boolean(lane.valueFn || lane.metric)
      ctx.fillStyle = isPlot ? (plotIndex++ % 2 ? '#0d0d10' : '#111114') : '#09090b'
      ctx.fillRect(LABEL_W, lane.top, w - LABEL_W, lane.height)

      ctx.fillStyle = '#1c1c21'
      ctx.fillRect(0, lane.top + lane.height - 1, w, 1)
    }

    ctx.save()
    ctx.beginPath()
    ctx.rect(LABEL_W, RULER_H, w - LABEL_W, tracksBottom - RULER_H)
    ctx.clip()

    // 主刻度的垂直格線
    ctx.fillStyle = 'rgba(63,63,70,0.28)'
    for (let i = firstTick; i <= lastTick; i++) {
      ctx.fillRect(Math.round(timeToX(i * tickStep)), RULER_H, 1, tracksBottom - RULER_H)
    }

    if (selection.inTime != null && selection.outTime != null) {
      const s = Math.min(selection.inTime, selection.outTime)
      const e = Math.max(selection.inTime, selection.outTime)
      const sx = Math.max(LABEL_W, timeToX(s))
      const ex = Math.min(w, timeToX(e))

      if (sx < w && ex > LABEL_W) {
        ctx.fillStyle = 'rgba(167,139,250,0.10)'
        ctx.fillRect(sx, RULER_H, ex - sx, tracksBottom - RULER_H)

        ctx.strokeStyle = 'rgba(167,139,250,0.7)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(sx + 0.5, RULER_H)
        ctx.lineTo(sx + 0.5, tracksBottom)
        ctx.moveTo(ex - 0.5, RULER_H)
        ctx.lineTo(ex - 0.5, tracksBottom)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    const drawLaneMessage = (lane, text) => {
      ctx.fillStyle = '#52525b'
      ctx.font = `11px ${SANS}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, LABEL_W + 12, lane.top + lane.height / 2)
    }

    const drawMidline = (lane) => {
      ctx.strokeStyle = 'rgba(63,63,70,0.45)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 5])
      ctx.beginPath()
      ctx.moveTo(LABEL_W, Math.round(lane.top + lane.height / 2) + 0.5)
      ctx.lineTo(w, Math.round(lane.top + lane.height / 2) + 0.5)
      ctx.stroke()
      ctx.setLineDash([])
    }

    const drawPositionTrack = (lane) => {
      let minV = Infinity
      let maxV = -Infinity

      for (const p of pts) {
        const v = lane.valueFn(p)
        if (v == null) continue
        if (v < minV) minV = v
        if (v > maxV) maxV = v
      }

      if (minV === Infinity) {
        drawLaneMessage(lane, '畫面範圍內沒有軌跡')
        return
      }

      if (maxV - minV < 1e-6) {
        minV -= 1
        maxV += 1
      }

      plotRanges[lane.id] = { min: minV, max: maxV }

      const innerTop = lane.top + 8
      const innerBot = lane.top + lane.height - 8
      const toY = (v) => {
        const t = (v - minV) / (maxV - minV)
        return lane.invert
          ? innerTop + t * (innerBot - innerTop)
          : innerBot - t * (innerBot - innerTop)
      }

      drawMidline(lane)

      ctx.strokeStyle = lane.color
      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      ctx.beginPath()

      let previous = null

      for (const p of pts) {
        const v = lane.valueFn(p)
        if (v == null) {
          previous = null
          continue
        }

        const px = timeToX(p.frame / fps)
        const py = toY(v)

        if (previous && p.frame - previous.frame <= step * 2 + 10) {
          ctx.lineTo(px, py)
        } else {
          ctx.moveTo(px, py)
        }

        previous = p
      }

      ctx.stroke()
    }

    const drawViewMetric = (lane) => {
      const source = laneSource(lane)
      const viewsReady = source.status === 'ready'
      const reference = referencePoints[lane.metric] || []
      const isUsable = value => Number.isFinite(value) && !(lane.log && value <= 0)

      let minV = Infinity
      let maxV = -Infinity
      const include = (value) => {
        if (!isUsable(value)) return
        if (value < minV) minV = value
        if (value > maxV) maxV = value
      }

      if (viewsReady) {
        for (const series of source.series) {
          for (const point of series[lane.metric]) {
            if (point.frame >= sF && point.frame <= eF) include(point.value)
          }
        }
      }

      for (const point of reference) include(point.value)

      const statusMessage = {
        idle: '沒有 rally 範圍',
        loading: source.loadingText,
        error: source.errorText,
      }[source.status]

      if (minV === Infinity) {
        drawLaneMessage(lane, statusMessage || source.emptyText)
        return
      }

      // 距離和原腳本一樣用對數軸；速度從 0 起算，上限截在 SPEED_AXIS_MAX
      let lo
      let hi

      if (lane.log) {
        lo = Math.log10(minV)
        hi = Math.log10(maxV)
        if (hi - lo < 1e-6) {
          lo -= 0.5
          hi += 0.5
        }
        plotRanges[lane.id] = { min: 10 ** lo, max: 10 ** hi }
      } else {
        lo = 0
        hi = Math.min(SPEED_AXIS_MAX, maxV) || 1
        plotRanges[lane.id] = { min: lo, max: hi }
      }

      const innerTop = lane.top + 8
      const innerBot = lane.top + lane.height - 8
      const toY = (value) => {
        const t = lane.log ? Math.log10(value) : value
        return innerBot - ((t - lo) / (hi - lo)) * (innerBot - innerTop)
      }

      ctx.save()
      ctx.beginPath()
      ctx.rect(LABEL_W, lane.top, w - LABEL_W, lane.height - 1)
      ctx.clip()

      ctx.lineWidth = 1
      ctx.lineJoin = 'round'
      ctx.globalAlpha = 0.85

      for (const series of viewsReady ? source.series : []) {
        ctx.strokeStyle = series.color
        ctx.beginPath()

        let previousFrame = null

        for (const point of series[lane.metric]) {
          if (
            point.frame < sF - 1
            || point.frame > eF + 1
            || !Number.isFinite(point.value)
            || (lane.log && point.value <= 0)
          ) {
            previousFrame = null
            continue
          }

          const px = timeToX(point.frame / fps)
          const py = toY(point.value)

          // 缺格處斷開，同原腳本用 NaN 留空
          if (previousFrame !== null && point.frame - previousFrame === 1) {
            ctx.lineTo(px, py)
          } else {
            ctx.moveTo(px, py)
          }

          previousFrame = point.frame
        }

        ctx.stroke()
      }

      if (reference.length) {
        ctx.globalAlpha = 1
        ctx.strokeStyle = REFERENCE_COLOR
        ctx.lineWidth = 1.4
        ctx.setLineDash([5, 3])
        ctx.beginPath()

        let previousFrame = null

        for (const point of reference) {
          if (!isUsable(point.value)) {
            previousFrame = null
            continue
          }

          const px = timeToX(point.frame / fps)
          const py = toY(point.value)

          if (previousFrame !== null && point.frame - previousFrame <= step) {
            ctx.lineTo(px, py)
          } else {
            ctx.moveTo(px, py)
          }

          previousFrame = point.frame
        }

        ctx.stroke()
        ctx.setLineDash([])
      }

      ctx.restore()

      // 兩兩重建還沒好時，參考線照畫，再疊上狀態
      if (statusMessage) drawLaneMessage(lane, statusMessage)
    }

    for (const lane of lanes) {
      if (lane.valueFn) drawPositionTrack(lane)
      else if (lane.metric) drawViewMetric(lane)
    }

    // Rally
    const rallyLane = laneById.rally

    for (const r of rallies) {
      const sx = timeToX(r.start_frame / fps)
      const ex = timeToX(r.end_frame / fps)

      if (ex < LABEL_W || sx > w) continue

      const [fill, accent] = RALLY_STYLES[r.status] || RALLY_STYLES.default
      const isActive = (activeItem?.type === 'rally' && activeItem.id === r.id) || currentRally?.id === r.id
      const barY = rallyLane.top + 4
      const barH = rallyLane.height - 8
      const barW = Math.max(2, ex - sx)

      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.roundRect(sx, barY, barW, barH, 3)
      ctx.fill()

      ctx.fillStyle = accent
      ctx.fillRect(sx, barY, Math.min(2, barW), barH)

      if (isActive) {
        ctx.strokeStyle = accent
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.roundRect(sx + 0.5, barY + 0.5, barW - 1, barH - 1, 3)
        ctx.stroke()
      }

      // 標籤貼著可見範圍左緣，捲動時還看得到
      const text = `R${r.rally_index}`
      ctx.font = `600 10px ${SANS}`
      const labelX = Math.max(sx, LABEL_W) + 7
      if (labelX + ctx.measureText(text).width < ex - 4) {
        ctx.fillStyle = isActive ? '#f4f4f5' : '#a1a1aa'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, labelX, barY + barH / 2 + 0.5)
      }
    }

    // 異常
    for (const a of anomalies) {
      const sx = timeToX(a.start_frame / fps)
      const ex = timeToX(a.end_frame / fps)

      if (ex < LABEL_W || sx > w) continue

      const sev = a.severity ?? 3
      ctx.fillStyle = `rgba(244,63,94,${Math.min(0.85, 0.3 + sev * 0.1)})`
      ctx.beginPath()
      ctx.roundRect(sx, anomalyLane.top + 5, Math.max(2, ex - sx), anomalyLane.height - 10, 2)
      ctx.fill()
    }

    // 擊球：線穿過曲線軌道，標籤放在自己那條
    for (const hItem of hits) {
      const isDraggingThis = draggingHit?.id === hItem.id
      const frame = isDraggingThis && draggingHit.currentFrame !== undefined
        ? draggingHit.currentFrame
        : (hItem.new_hit_frame ?? hItem.hit_frame)

      const hx = Math.round(timeToX(frame / fps)) + 0.5

      if (hx < LABEL_W - 40 || hx > w + 40) continue

      const isLow = (hItem.confidence ?? 1) < 0.5
      const isHovered = hoveredHit === hItem.id || isDraggingThis
      const lineColor = isHovered ? '#22d3ee' : isLow ? 'rgba(244,63,94,0.7)' : 'rgba(228,228,231,0.28)'

      ctx.strokeStyle = lineColor
      ctx.lineWidth = isHovered ? 1.5 : 1
      ctx.setLineDash(isHovered ? [] : [3, 4])
      ctx.beginPath()
      ctx.moveTo(hx, hitsLane.top + hitsLane.height)
      ctx.lineTo(hx, anomalyLane.top)
      ctx.stroke()
      ctx.setLineDash([])

      const label = hItem.shot_type || 'Hit'
      ctx.font = `10px ${SANS}`
      const pillW = Math.max(28, ctx.measureText(label).width + 12)
      const pillH = hitsLane.height - 6
      const pillX = hx - pillW / 2
      const pillY = hitsLane.top + 3

      ctx.fillStyle = isHovered ? '#083344' : '#18181b'
      ctx.strokeStyle = isHovered ? '#22d3ee' : isLow ? '#f43f5e' : '#3f3f46'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = isHovered ? '#67e8f9' : isLow ? '#fda4af' : '#d4d4d8'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, hx, pillY + pillH / 2 + 0.5)
    }

    ctx.restore()

    // 尺規
    ctx.fillStyle = '#0b0b0e'
    ctx.fillRect(LABEL_W, 0, w - LABEL_W, RULER_H)
    ctx.fillStyle = '#27272a'
    ctx.fillRect(0, RULER_H - 1, w, 1)

    const minorDivisions = tickStep * pxPerSec / 5 >= 10 ? 5 : 2
    const minorStep = tickStep / minorDivisions

    ctx.fillStyle = '#3f3f46'
    for (
      let i = Math.max(0, Math.ceil(sSec / minorStep));
      i <= Math.floor(eSec / minorStep);
      i++
    ) {
      if (i % minorDivisions === 0) continue
      const tx = Math.round(timeToX(i * minorStep))
      if (tx >= LABEL_W) ctx.fillRect(tx, RULER_H - 5, 1, 4)
    }

    ctx.font = `10px ${MONO}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'

    for (let i = firstTick; i <= lastTick; i++) {
      const tx = Math.round(timeToX(i * tickStep))
      if (tx < LABEL_W) continue

      ctx.fillStyle = '#52525b'
      ctx.fillRect(tx, RULER_H - 9, 1, 8)

      ctx.fillStyle = '#a1a1aa'
      ctx.fillText(formatTick(i * tickStep, tickStep), tx + 4, RULER_H - 15)
    }

    // 播放線
    const cx = Math.round(getPlayheadX()) + 0.5

    if (cx >= LABEL_W && cx <= w) {
      ctx.strokeStyle = '#22d3ee'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(cx, RULER_H - 4)
      ctx.lineTo(cx, h)
      ctx.stroke()

      const badge = `F ${currentFrame}`
      ctx.font = `600 10px ${MONO}`
      const badgeW = ctx.measureText(badge).width + 12
      const badgeH = 16
      const badgeX = Math.max(LABEL_W + 2, Math.min(w - badgeW - 2, cx - badgeW / 2))
      const badgeY = 3

      ctx.fillStyle = '#0891b2'
      ctx.beginPath()
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3)
      ctx.fill()

      ctx.beginPath()
      ctx.moveTo(cx - 4, badgeY + badgeH)
      ctx.lineTo(cx + 4, badgeY + badgeH)
      ctx.lineTo(cx, badgeY + badgeH + 5)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#ecfeff'
      ctx.textAlign = 'center'
      ctx.fillText(badge, badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.5)
    }

    // 左側標籤欄
    ctx.fillStyle = '#0b0b0e'
    ctx.fillRect(0, 0, LABEL_W, h)
    ctx.fillStyle = '#27272a'
    ctx.fillRect(LABEL_W - 1, 0, 1, h)
    ctx.fillRect(0, RULER_H - 1, LABEL_W, 1)

    ctx.fillStyle = '#d4d4d8'
    ctx.font = `11px ${MONO}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(formatClock(currentTime), 12, RULER_H / 2)

    const currentPoint = trajMap.get(currentFrame)

    for (const lane of lanes) {
      ctx.fillStyle = '#1c1c21'
      ctx.fillRect(0, lane.top + lane.height - 1, LABEL_W, 1)

      if (!lane.valueFn && !lane.metric) {
        ctx.fillStyle = '#71717a'
        ctx.font = `11px ${SANS}`
        ctx.textAlign = 'left'
        ctx.fillText(lane.label, 12, lane.top + lane.height / 2)
        continue
      }

      const rowY = lane.top + 13

      if (lane.color) {
        ctx.fillStyle = lane.color
        ctx.fillRect(0, lane.top, 2, lane.height - 1)
      }

      ctx.fillStyle = '#e4e4e7'
      ctx.font = `600 11px ${SANS}`
      ctx.textAlign = 'left'
      ctx.fillText(lane.label, 12, rowY)
      const labelWidth = ctx.measureText(lane.label).width

      ctx.fillStyle = '#52525b'
      ctx.font = `10px ${SANS}`
      ctx.fillText(lane.unit, 12 + labelWidth + 5, rowY)

      // 播放線所在 frame 的值
      const currentValue = lane.valueFn && currentPoint ? lane.valueFn(currentPoint) : null
      if (currentValue != null) {
        ctx.fillStyle = lane.color
        ctx.font = `10px ${MONO}`
        ctx.textAlign = 'right'
        ctx.fillText(currentValue.toFixed(2), LABEL_W - 8, rowY)
      }

      const range = plotRanges[lane.id]

      if (lane.metric && range) {
        ctx.fillStyle = '#52525b'
        ctx.font = `9px ${MONO}`
        ctx.textAlign = 'right'
        ctx.fillText(
          `${formatAxisValue(range.min)}–${formatAxisValue(range.max)}`,
          LABEL_W - 8,
          rowY,
        )
      }

      if (lane.metric === 'consistency' && lane.height >= 36) {
        // 圖例那一行寫播放線所在這格的值和用了幾台
        const row = consistencyByFrame.get(currentFrame)
        ctx.font = `600 10px ${MONO}`
        ctx.textAlign = 'left'
        ctx.fillStyle = row ? '#e4e4e7' : '#52525b'
        ctx.fillText(row ? `${row.value.toFixed(1)} · ${row.viewCount} 台` : '這格 —', 12, lane.top + 29)
      } else if (lane.metric && lane.height >= 36) {
        const { series: laneSeries } = laneSource(lane)
        const spacing = Math.min(16, (LABEL_W - 24) / Math.max(1, laneSeries.length - 1))
        ctx.font = `600 10px ${MONO}`
        ctx.textAlign = 'center'
        laneSeries.forEach((series, order) => {
          ctx.fillStyle = series.color
          ctx.fillText(String(series.cameraIndex), 15 + order * spacing, lane.top + 29)
        })
      }

      if (lane.valueFn && range && lane.height >= 36) {
        ctx.fillStyle = '#52525b'
        ctx.font = `9px ${MONO}`
        ctx.textAlign = 'left'
        ctx.fillText(
          `${formatAxisValue(range.min)} – ${formatAxisValue(range.max)}`,
          12,
          lane.top + lane.height - 10,
        )
      }
    }
  }, [
    dimensions,
    canvasHeight,
    lanes,
    tracksBottom,
    scrollLeft,
    pxPerSec,
    trajMap,
    displayLookup,
    rallies,
    hits,
    anomalies,
    currentTime,
    currentFrame,
    currentRally,
    activeItem,
    hoveredHit,
    draggingHit,
    fps,
    selection,
    viewPoints.status,
    viewSeries,
    consistency.status,
    consistencySeries,
    consistencyByFrame,
    visibleTracks.reference,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleWheel = (e) => {
      e.preventDefault()
      pauseForTimelineDrag()

      if (e.shiftKey) {
        const mouseX = e.offsetX
        if (mouseX < LABEL_W) return

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
        const targetTime = (mouseX - LABEL_W + scrollLeft) / pxPerSec
        const newPx = clampZoom(pxPerSec * zoomFactor)
        const newScroll = targetTime * newPx - (mouseX - LABEL_W)

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

  const getRallyAtTime = t => rallies.find(r => t >= r.start_frame / fps && t <= r.end_frame / fps)
  const isNearPlayhead = (x) => Math.abs(x - getPlayheadX()) <= PLAYHEAD_GRAB_PX

  const startHitDrag = (hit, x) => {
    const frame = hit.new_hit_frame ?? hit.hit_frame

    setDraggingHit({
      id: hit.id,
      startX: x,
      frameOffset: frame,
    })
    setActiveItem('hit', hit.id)
    setCurrentTime(frame / fps)
  }

  const handlePointerDown = (e) => {
    e.target.setPointerCapture(e.pointerId)

    const x = e.nativeEvent.offsetX
    const y = e.nativeEvent.offsetY

    if (x < LABEL_W) return

    pauseForTimelineDrag()

    const t = getTimeFromCanvasX(x)

    if (isNearPlayhead(x) || y < RULER_H) {
      setIsScrubbing(true)
      setCurrentTime(t)
      return
    }

    if (laneAtY(y)?.id === 'rally') {
      const rally = getRallyAtTime(t)

      if (rally) {
        const startSec = rally.start_frame / fps

        setSelectionRange(startSec, rally.end_frame / fps)
        setCurrentTime(startSec)
        setActiveItem('rally', rally.id)
        ensureTimeVisible(startSec)
        return
      }
    }

    const hit = getHitAtX(x)

    if (hit && y < tracksBottom) {
      startHitDrag(hit, x)
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
    const setCursor = (cursor) => {
      if (canvas) canvas.style.cursor = cursor
    }

    if (isScrubbing) {
      pauseForTimelineDrag()
      setCurrentTime(getTimeFromCanvasX(x))
      setCursor('ew-resize')
      return
    }

    if (draggingHit) {
      pauseForTimelineDrag()

      const dxSec = (x - draggingHit.startX) / pxPerSec
      const newFrame = Math.max(0, Math.round(draggingHit.frameOffset + dxSec * fps))

      setDraggingHit(prev => ({
        ...prev,
        currentFrame: newFrame,
      }))
      setCurrentTime(newFrame / fps)
      setCursor('ew-resize')
      return
    }

    if (isPanning) {
      pauseForTimelineDrag()

      const targetScroll = isPanning.startScroll - (x - isPanning.startX)

      if (rafPanRef.current) cancelAnimationFrame(rafPanRef.current)

      rafPanRef.current = requestAnimationFrame(() => {
        setScrollAndCenterTime(targetScroll)
      })

      setCursor('grabbing')
      return
    }

    if (x <= LABEL_W) {
      if (hoveredHit) setHoveredHit(null)
      setCursor('default')
      return
    }

    if (isNearPlayhead(x) || y < RULER_H) {
      if (hoveredHit) setHoveredHit(null)
      setCursor('ew-resize')
      return
    }

    const hit = y < tracksBottom ? getHitAtX(x) : null

    if (hit) {
      if (hoveredHit !== hit.id) setHoveredHit(hit.id)
      setCursor('ew-resize')
      return
    }

    if (hoveredHit) setHoveredHit(null)

    const overRally = laneAtY(y)?.id === 'rally' && getRallyAtTime(getTimeFromCanvasX(x))
    setCursor(overRally ? 'pointer' : 'grab')
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

  const rallyStatusColor = currentRally
    ? (RALLY_STYLES[currentRally.status] || RALLY_STYLES.default)[1]
    : null

  const headerButton = 'h-7 px-2 flex items-center justify-center text-[11px] text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors'

  return (
    <div className="h-full w-full min-h-0 min-w-0 relative flex flex-col bg-[#09090b] select-none overflow-hidden">
      {/* 右側留 104px 給 App 疊在上面的「專注底部」按鈕 */}
      <div className="h-[42px] shrink-0 pl-3 pr-[104px] flex items-center gap-3 border-b border-zinc-800 bg-zinc-950 z-20 min-w-0 overflow-hidden">
        <div className="flex flex-1 basis-0 items-center gap-2 min-w-0">
          <div className="flex bg-zinc-900 border border-zinc-800 rounded-md p-0.5 gap-0.5 shrink-0">
            {[
              ['timeline', 'Timeline'],
              ['projection2d', '2D'],
              ['quality2d', '品質檢查'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setBottomView(id)}
                className={`h-6 px-2.5 rounded text-[11px] font-semibold transition-colors ${
                  bottomView === id
                    ? 'bg-zinc-700 text-zinc-50'
                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {currentRally && (
            <div className="hidden lg:flex items-center gap-1.5 h-7 px-2 rounded-md border border-zinc-800 bg-zinc-900 text-[11px] text-zinc-300 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: rallyStatusColor }} />
              R{currentRally.rally_index}
              <span className="text-zinc-500 font-mono">
                {((currentRally.end_frame - currentRally.start_frame) / fps).toFixed(1)}s
              </span>
            </div>
          )}

          {draggingHit?.currentFrame !== undefined && (
            <div className="text-[11px] text-amber-300 font-semibold px-2 h-7 flex items-center bg-amber-500/10 border border-amber-500/30 rounded-md shrink-0">
              Hit #{draggingHit.id} → F {draggingHit.currentFrame}
            </div>
          )}
        </div>

        <div className="shrink-0">
          <PlaybackUI
            goPrevRally={goPrevRally}
            goNextRally={goNextRally}
          />
        </div>

        <div className="flex flex-1 basis-0 items-center justify-end gap-2 min-w-0">
          <button
            ref={trackMenuButtonRef}
            type="button"
            onClick={toggleTrackMenu}
            className={`h-7 px-2.5 flex items-center gap-1.5 rounded-md border text-[11px] shrink-0 transition-colors ${
              trackMenuPosition
                ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
            title="顯示 / 隱藏軌道"
            aria-haspopup="menu"
            aria-expanded={Boolean(trackMenuPosition)}
          >
            軌道
            <span className="font-mono text-zinc-500">
              {TRACK_TOGGLES.filter(([key]) => visibleTracks[key]).length}/{TRACK_TOGGLES.length}
            </span>
            <span className="text-zinc-500">▾</span>
          </button>

          {trackMenuPosition && (
            <div
              ref={trackMenuRef}
              role="menu"
              className="fixed z-50 min-w-[9rem] py-1 rounded-md border border-zinc-700 bg-zinc-900 shadow-lg shadow-black/50"
              style={{ top: trackMenuPosition.top, right: trackMenuPosition.right }}
            >
              {TRACK_TOGGLES.map(([key, label, color, dashed]) => (
                <button
                  key={key}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={Boolean(visibleTracks[key])}
                  onClick={() => toggleTrack(key)}
                  className={`w-full h-7 px-3 flex items-center gap-2 text-left text-[11px] hover:bg-zinc-800 transition-colors ${
                    visibleTracks[key] ? 'text-zinc-100' : 'text-zinc-500'
                  }`}
                >
                  <span className={`w-3 text-center ${visibleTracks[key] ? 'text-zinc-200' : 'text-transparent'}`}>✓</span>
                  {dashed ? (
                    <span
                      className="w-3 border-t border-dashed"
                      style={{ borderColor: visibleTracks[key] ? color : '#3f3f46' }}
                    />
                  ) : (
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: visibleTracks[key] ? color : '#3f3f46' }}
                    />
                  )}
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="hidden xl:flex items-center bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden shrink-0">
            <button type="button" onClick={() => zoomBy(1 / 1.25)} className={`${headerButton} w-7`} title="縮小">
              −
            </button>
            <button
              type="button"
              onClick={fitRange}
              disabled={rangeStartFrame == null}
              className={`${headerButton} border-x border-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent`}
              title="縮放到整段 rally（或選取範圍）"
            >
              適配
            </button>
            <button type="button" onClick={() => zoomBy(1.25)} className={`${headerButton} w-7`} title="放大">
              +
            </button>
          </div>

          <div
            className="w-6 h-6 shrink-0 rounded-full border border-zinc-700 text-zinc-500 hover:text-zinc-200 flex items-center justify-center text-[11px] cursor-help"
            title={TIMELINE_TIPS}
          >
            ?
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 min-w-0 relative overflow-y-auto overflow-x-hidden" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0 w-full block"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={(e) => {
            e.preventDefault()
            clearSelection()
          }}
          style={{ touchAction: 'none', cursor: 'grab', height: `${canvasHeight}px` }}
        />
      </div>

      <div
        ref={scrollBarRef}
        className="h-[12px] w-full shrink-0 overflow-x-scroll overflow-y-hidden bg-zinc-950 border-t border-zinc-800"
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
            width: `${(durationSec * pxPerSec) + LABEL_W}px`,
            height: '1px',
          }}
        />
      </div>
    </div>
  )
}
