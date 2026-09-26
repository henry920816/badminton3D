import React, {
  useEffect,
  useRef,
  useState,
} from 'react'

import { api } from './api.js'
import { useAppStore } from './store.js'

import TopBar from './components/TopBar.jsx'
import Scene3D from './components/Scene3D.jsx'
import VideoPanel from './components/VideoPanel.jsx'
import TimelinePanel from './components/TimelinePanel.jsx'
import Projection2DPanel from './components/Projection2DPanel.jsx'
import Quality2DPanel from './components/Quality2DPanel.jsx'
import RightDock from './components/RightDock.jsx'


function clamp(
  value,
  min,
  max,
) {
  return Math.min(
    max,
    Math.max(
      min,
      value,
    ),
  )
}

const LAYOUT_STORAGE_KEY = 'badminton-ui-layout-v1'

const DEFAULT_LAYOUT = {
  topHeightPct: 58,
  leftTopWidthPct: 50,
  rightPanelWidth: 360,
}

function readSavedLayout() {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(
        LAYOUT_STORAGE_KEY,
      ) || '{}',
    )

    return {
      topHeightPct: clamp(
        Number(saved.topHeightPct) || DEFAULT_LAYOUT.topHeightPct,
        42,
        72,
      ),
      leftTopWidthPct: clamp(
        Number(saved.leftTopWidthPct) || DEFAULT_LAYOUT.leftTopWidthPct,
        20,
        80,
      ),
      rightPanelWidth: clamp(
        Number(saved.rightPanelWidth) || DEFAULT_LAYOUT.rightPanelWidth,
        260,
        700,
      ),
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

export default function App() {
  const matchId = useAppStore(
    state => state.matchId,
  )

  const setMatchMeta = useAppStore(
    state => state.setMatchMeta,
  )

  const setTimelineData = useAppStore(
    state => state.setTimelineData,
  )

  const setReplaySegments = useAppStore(
    state => state.setReplaySegments,
  )

  const upsertTrajPoints = useAppStore(
    state => state.upsertTrajPoints,
  )

  const resetTrajCache = useAppStore(
    state => state.resetTrajCache,
  )

  const activeItem = useAppStore(
    state => state.activeItem,
  )

  const bottomView = useAppStore(
    state => state.bottomView,
  )

  const bootstrapDoneRef = useRef(
    false,
  )

  const mainWrapRef = useRef(
    null,
  )

  const centerWrapRef = useRef(
    null,
  )

  const topAreaRef = useRef(
    null,
  )

  const savedLayoutRef = useRef(
    readSavedLayout(),
  )

  const [
    topHeightPct,
    setTopHeightPct,
  ] = useState(
    savedLayoutRef.current.topHeightPct,
  )

  const [
    leftTopWidthPct,
    setLeftTopWidthPct,
  ] = useState(
    savedLayoutRef.current.leftTopWidthPct,
  )

  const [
    rightPanelWidth,
    setRightPanelWidth,
  ] = useState(
    savedLayoutRef.current.rightPanelWidth,
  )

  const [
    focusMode,
    setFocusMode,
  ] = useState(null)

  const showRightDock = Boolean(
    activeItem?.type,
  )

  useEffect(
    () => {
      try {
        window.localStorage.setItem(
          LAYOUT_STORAGE_KEY,
          JSON.stringify({
            topHeightPct,
            leftTopWidthPct,
            rightPanelWidth,
          }),
        )
      } catch {
        // localStorage may be disabled; layout still works for this session.
      }
    },
    [
      topHeightPct,
      leftTopWidthPct,
      rightPanelWidth,
    ],
  )

  useEffect(
    () => {
      const resetLayout = () => {
        setTopHeightPct(
          DEFAULT_LAYOUT.topHeightPct,
        )
        setLeftTopWidthPct(
          DEFAULT_LAYOUT.leftTopWidthPct,
        )
        setRightPanelWidth(
          DEFAULT_LAYOUT.rightPanelWidth,
        )
        setFocusMode(null)
      }

      window.addEventListener(
        'badminton-reset-layout',
        resetLayout,
      )

      return () => {
        window.removeEventListener(
          'badminton-reset-layout',
          resetLayout,
        )
      }
    },
    [],
  )

  useEffect(
    () => {
      bootstrapDoneRef.current = false
      resetTrajCache()

      if (matchId == null) {
        setMatchMeta({
          fps: 50,
          duration_frame: 0,
          cameras: [],
        })

        setTimelineData({
          rallies: [],
          hits: [],
          anomalies: [],
        })

        setReplaySegments([])

        return
      }

      ;(async () => {
        const match = (
          await api.getMatch(
            matchId,
          )
        )

        setMatchMeta(
          match,
        )

        const timeline = (
          await api.getTimeline(
            matchId,
          )
        )

        setTimelineData(
          timeline,
        )

        setReplaySegments(
          (timeline.rallies || []).map(
            rally => ({
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
              duration_sec: (
                rally.end_frame
                - rally.start_frame
                + 1
              ) / (match.fps || 50),
            }),
          ),
        )

        const preloadStart = 0

        const preloadEnd = (
          match.duration_frame
        )

        const points = (
          await api.getTraj(
            matchId,
            preloadStart,
            preloadEnd,
          )
        )

        upsertTrajPoints(
          points,
        )

        bootstrapDoneRef.current = true
      })().catch(
        error => {
          console.error(
            error,
          )

          alert(
            'Backend 連不上或資料載入失敗。'
            + '請先啟動 docker-compose。\n'
            + String(error),
          )
        },
      )
    },
    [
      matchId,
      resetTrajCache,
      setMatchMeta,
      setTimelineData,
      setReplaySegments,
      upsertTrajPoints,
    ],
  )

  const startResizeTopBottom = (
    event
  ) => {
    event.preventDefault()

    const wrap = (
      centerWrapRef.current
    )

    if (!wrap) {
      return
    }

    const rect = (
      wrap.getBoundingClientRect()
    )

    const onMove = moveEvent => {
      const y = (
        moveEvent.clientY
        - rect.top
      )

      const percentage = (
        y / rect.height
      ) * 100

      setTopHeightPct(
        clamp(
          percentage,
          42,
          72,
        ),
      )
    }

    const onUp = () => {
      window.removeEventListener(
        'mousemove',
        onMove,
      )

      window.removeEventListener(
        'mouseup',
        onUp,
      )

      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = (
      'row-resize'
    )

    document.body.style.userSelect = (
      'none'
    )

    window.addEventListener(
      'mousemove',
      onMove,
    )

    window.addEventListener(
      'mouseup',
      onUp,
    )
  }

  const startResizeLeftRightTop = (
    event
  ) => {
    event.preventDefault()

    const wrap = (
      topAreaRef.current
    )

    if (!wrap) {
      return
    }

    const rect = (
      wrap.getBoundingClientRect()
    )

    const onMove = moveEvent => {
      const x = (
        moveEvent.clientX
        - rect.left
      )

      const percentage = (
        x / rect.width
      ) * 100

      setLeftTopWidthPct(
        clamp(
          percentage,
          20,
          80,
        ),
      )
    }

    const onUp = () => {
      window.removeEventListener(
        'mousemove',
        onMove,
      )

      window.removeEventListener(
        'mouseup',
        onUp,
      )

      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = (
      'col-resize'
    )

    document.body.style.userSelect = (
      'none'
    )

    window.addEventListener(
      'mousemove',
      onMove,
    )

    window.addEventListener(
      'mouseup',
      onUp,
    )
  }

  const startResizeMainAndDock = (
    event
  ) => {
    event.preventDefault()

    const wrap = (
      mainWrapRef.current
    )

    if (!wrap) {
      return
    }

    const rect = (
      wrap.getBoundingClientRect()
    )

    const onMove = moveEvent => {
      const nextWidth = (
        rect.right
        - moveEvent.clientX
      )

      setRightPanelWidth(
        clamp(
          nextWidth,
          260,
          700,
        ),
      )
    }

    const onUp = () => {
      window.removeEventListener(
        'mousemove',
        onMove,
      )

      window.removeEventListener(
        'mouseup',
        onUp,
      )

      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = (
      'col-resize'
    )

    document.body.style.userSelect = (
      'none'
    )

    window.addEventListener(
      'mousemove',
      onMove,
    )

    window.addEventListener(
      'mouseup',
      onUp,
    )
  }

  const bottomHeightPct = (
    100
    - topHeightPct
  )

  const rightDockPx = (
    `${rightPanelWidth}px`
  )

  if (matchId == null) {
    return (
      <div
        className="
          h-screen
          w-screen
          bg-zinc-950
          text-zinc-100
          overflow-hidden
        "
      >
        <TopBar />

        <div
          className="
            h-[calc(100vh-44px)]
            flex
            items-center
            justify-center
            p-6
          "
        >
          <div
            className="
              max-w-lg
              rounded-xl
              border
              border-zinc-800
              bg-zinc-900/60
              p-8
              text-center
            "
          >
            <div
              className="
                text-lg
                font-semibold
              "
            >
              目前沒有資料集
            </div>

            <div
              className="
                mt-2
                text-sm
                text-zinc-400
              "
            >
              請使用上方「上傳資料集」選擇各類資料夾，
              匯入完成後會自動開啟。
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="
        h-screen
        w-screen
        bg-zinc-950
        text-zinc-100
        overflow-hidden
      "
    >
      <TopBar />

      <div
        ref={mainWrapRef}
        className="
          flex
          h-[calc(100vh-44px)]
          min-h-0
          w-full
        "
      >
        <div
          className="
            flex-1
            min-w-0
            min-h-0
            flex
            flex-col
          "
        >
          <div
            ref={centerWrapRef}
            className="
              flex-1
              min-h-0
              flex
              flex-col
            "
          >
            <div
              ref={topAreaRef}
              className="
                flex
                min-h-0
                border-b
                border-zinc-800
                relative
              "
              style={{
                height: focusMode
                  ? '100%'
                  : `${topHeightPct}%`,
                display: focusMode === 'bottom'
                  ? 'none'
                  : 'flex',
              }}
            >
              <div
                className="
                  min-w-0
                  min-h-0
                  border-r
                  border-zinc-800
                  relative
                "
                style={{
                  width: focusMode === 'scene'
                    ? '100%'
                    : `${leftTopWidthPct}%`,
                  display: focusMode === 'video'
                    ? 'none'
                    : 'block',
                }}
              >
                <div
                  className="
                    absolute
                    z-10
                    top-2
                    left-2
                    flex
                    items-center
                    gap-2
                    text-xs
                    font-semibold
                    px-2
                    py-1
                    rounded
                    bg-zinc-900/80
                    border
                    border-zinc-800
                    backdrop-blur
                  "
                >
                  <span>3D 場景</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFocusMode(
                        focusMode === 'scene'
                          ? null
                          : 'scene',
                      )
                    }}
                    className="
                      px-1.5
                      py-0.5
                      rounded
                      text-[10px]
                      text-zinc-300
                      hover:text-white
                      hover:bg-zinc-700
                    "
                    title="放大 / 還原 3D 場景"
                  >
                    {focusMode === 'scene'
                      ? '還原'
                      : '專注'}
                  </button>
                </div>

                <Scene3D />
              </div>

              <div
                onMouseDown={
                  startResizeLeftRightTop
                }
                className="
                  w-[4px]
                  shrink-0
                  cursor-col-resize
                  bg-zinc-950
                  hover:bg-zinc-900
                  active:bg-zinc-800
                  transition-colors
                  relative
                  z-20
                "
                title="
                  拖拉調整 3D / 影片 寬度
                "
                style={{
                  display: focusMode
                    ? 'none'
                    : 'block',
                }}
              >
                <div
                  className="
                    absolute
                    inset-y-0
                    left-1/2
                    -translate-x-1/2
                    w-[1px]
                    bg-zinc-800
                  "
                />
              </div>

              <div
                className="
                  flex-1
                  min-w-0
                  min-h-0
                  relative
                "
                style={{
                  display: focusMode === 'scene'
                    ? 'none'
                    : 'block',
                }}
              >
                <div
                  className="
                    absolute
                    z-10
                    top-2
                    left-2
                    flex
                    items-center
                    gap-2
                    text-xs
                    font-semibold
                    px-2
                    py-1
                    rounded
                    bg-zinc-900/80
                    border
                    border-zinc-800
                    backdrop-blur
                  "
                >
                  <span>影片</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFocusMode(
                        focusMode === 'video'
                          ? null
                          : 'video',
                      )
                    }}
                    className="
                      px-1.5
                      py-0.5
                      rounded
                      text-[10px]
                      text-zinc-300
                      hover:text-white
                      hover:bg-zinc-700
                    "
                    title="放大 / 還原影片"
                  >
                    {focusMode === 'video'
                      ? '還原'
                      : '專注'}
                  </button>
                </div>

                <VideoPanel />
              </div>
            </div>

            <div
              onMouseDown={
                startResizeTopBottom
              }
              className="
                h-[4px]
                shrink-0
                cursor-row-resize
                bg-zinc-950
                hover:bg-zinc-900
                active:bg-zinc-800
                transition-colors
                relative
                z-20
              "
              title="
                拖拉調整 上方 / Timeline 高度
              "
              style={{
                display: focusMode
                  ? 'none'
                  : 'block',
              }}
            >
              <div
                className="
                  absolute
                  inset-x-0
                  top-1/2
                  -translate-y-1/2
                  h-[1px]
                  bg-zinc-800
                "
              />
            </div>

            <div
              className="
                min-h-0
                relative
              "
              style={{
                height: focusMode === 'bottom'
                  ? '100%'
                  : `${bottomHeightPct}%`,
                display: (
                  focusMode === 'scene'
                  || focusMode === 'video'
                )
                  ? 'none'
                  : 'block',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setFocusMode(
                    focusMode === 'bottom'
                      ? null
                      : 'bottom',
                  )
                }}
                className="
                  absolute
                  top-2
                  right-3
                  z-30
                  px-2
                  py-1
                  rounded
                  border
                  border-zinc-700
                  bg-zinc-900/85
                  hover:bg-zinc-800
                  text-[10px]
                  text-zinc-300
                  hover:text-white
                  backdrop-blur
                "
                title="放大 / 還原底部檢視"
              >
                {focusMode === 'bottom'
                  ? '還原版面'
                  : '專注底部'}
              </button>
              {bottomView
                === 'projection2d'
                ? (
                    <Projection2DPanel />
                  )
                : bottomView
                  === 'quality2d'
                  ? (
                      <Quality2DPanel />
                    )
                  : (
                      <TimelinePanel />
                    )}
            </div>
          </div>
        </div>

        {showRightDock && !focusMode && (
          <>
            <div
              onMouseDown={
                startResizeMainAndDock
              }
              className="
                w-[4px]
                shrink-0
                cursor-col-resize
                bg-zinc-950
                hover:bg-zinc-900
                active:bg-zinc-800
                transition-colors
                relative
                z-20
              "
              title="
                拖拉調整 主畫面 / 右側 Panel 寬度
              "
            >
              <div
                className="
                  absolute
                  inset-y-0
                  left-1/2
                  -translate-x-1/2
                  w-[1px]
                  bg-zinc-800
                "
              />
            </div>

            <div
              className="
                shrink-0
                min-h-0
              "
              style={{
                width:
                  rightDockPx,
              }}
            >
              <RightDock />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
