import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { useAppStore } from '../store.js'
import { usePairwiseViewPoints } from '../utils/usePairwiseBallPoints.js'
import { useDisplayTrajectoryLookup, useRallyFrameRange } from '../utils/useRallyBallData.js'
import { useLabelConsistency } from '../utils/useLabelConsistency.js'
import { LABEL_W, RALLY_STYLES, RULER_H, drawTimeline } from '../utils/drawTimeline.js'
import { usePanelSize } from '../utils/usePanelSize.js'
import { useRallyNavigation } from '../utils/useRallyNavigation.js'


// matplotlib 的 tab10，和 triangulation_3Dline.py 各視角的配色一樣
const VIEW_COLORS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
]


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

const PLAYHEAD_GRAB_PX = 10

// 曲線軌道平分剩下的高度，太矮就改成捲動
const MIN_PLOT_H = 40
const MAX_PLOT_H = 150

const RALLY_LANE = { id: 'rally', label: 'Rally', height: 24 }
const HITS_LANE = { id: 'hits', label: '擊球', height: 22 }

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
  // y 軸固定（不隨畫面範圍縮放），播放時同樣的誤差永遠在同一個高度；
  // 超出範圍的貼在上下緣
  { id: 'label_consistency', toggle: 'consistency', label: '標註一致', unit: 'px', metric: 'consistency', log: true, fixedRange: [1, 1000] },
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

  const dimensions = usePanelSize(containerRef)
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
    const fixedHeight = RULER_H + RALLY_LANE.height + HITS_LANE.height
    const plotHeight = plots.length
      ? Math.max(MIN_PLOT_H, Math.min(MAX_PLOT_H, Math.floor((dimensions.height - fixedHeight) / plots.length)))
      : 0

    let top = RULER_H

    return [
      RALLY_LANE,
      HITS_LANE,
      ...plots.map(track => ({ ...track, height: plotHeight })),
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

  // 跳到 rally 後把那段捲進時間軸畫面
  const { goPrevRally, goNextRally } = useRallyNavigation(fps, ensureTimeVisible)

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

  // 播放時播放線固定在中間、內容跟著捲，所以每格都得重畫；但同一格裡
  // currentTime 變了之後 scrollLeft 也會跟著變（見上面的 effect），直接
  // 在 effect 裡畫會一格畫兩次。改成排進 requestAnimationFrame，一格最多
  // 畫一次，畫的時候用最新一次 render 的值（drawTimelineRef）
  const drawTimelineRef = useRef(null)
  const drawFrameIdRef = useRef(null)

  drawTimelineRef.current = () => drawTimeline({
    canvasRef, dimensions, canvasHeight, lanes, tracksBottom, scrollLeft, pxPerSec,
    trajMap, displayLookup, rallies, hits, currentTime, currentFrame,
    currentRally, activeItem, hoveredHit, draggingHit, fps, selection,
    visibleTracks, consistencyByFrame, laneSource, getPlayheadX,
  })

  // 取消時要把 id 清掉：開發模式的 StrictMode 會掛載、卸載、再掛載一次，
  // 留著舊 id 的話下面會以為已經排好，之後就再也不畫
  useEffect(() => () => {
    if (drawFrameIdRef.current != null) {
      cancelAnimationFrame(drawFrameIdRef.current)
      drawFrameIdRef.current = null
    }
  }, [])

  useEffect(() => {
    if (drawFrameIdRef.current != null) return

    drawFrameIdRef.current = requestAnimationFrame(() => {
      drawFrameIdRef.current = null
      drawTimelineRef.current()
    })
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
