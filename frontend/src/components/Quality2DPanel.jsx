import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  api,
} from '../api.js'

import {
  useAppStore,
} from '../store.js'

import {
  autoRepairBad2DFrames,
} from '../utils/autoRepair2D.js'

import {
  PlaybackUI,
} from './TimelinePanel.jsx'


const ROW_HEIGHT_FALLBACK = 26
const MIN_ROW_HEIGHT = 16
const MIN_ZOOM_FRAMES = 10

const AVAILABLE_CAMERA_MIN = 3

const MAX_CAMERA_GRID_FRAMES = 6000


const STATUS_COLOR = {
  ok:
    'rgba(34,197,94,0.85)',

  bad:
    'rgba(239,68,68,0.9)',

  no_data:
    'rgba(63,63,70,0.75)',
}


const INSUFFICIENT_COLOR = (
  'rgba(234,179,8,0.9)'
)


function usePanelSize(
  ref,
) {
  const [
    size,
    setSize,
  ] = useState({
    width: 0,
    height: 0,
  })

  useEffect(
    () => {
      if (
        !ref.current
      ) {
        return
      }

      const observer = (
        new ResizeObserver(
          (
            [
              entry,
            ],
          ) => {
            const {
              width,
              height,
            } = (
              entry.contentRect
            )

            setSize({
              width,
              height,
            })
          },
        )
      )

      observer.observe(
        ref.current,
      )

      return () => (
        observer.disconnect()
      )
    },
    [
      ref,
    ],
  )

  return size
}


function findCurrentRally(
  rallies,
  currentFrame,
  activeItem,
) {
  const sorted = [
    ...rallies,
  ].sort(
    (
      first,
      second,
    ) => (
      first.start_frame
      - second.start_frame
    ),
  )

  if (
    activeItem?.type
    === 'rally'
  ) {
    const active = (
      sorted.find(
        rally => (
          rally.id
          === activeItem.id
        ),
      )
    )

    if (
      active
    ) {
      return active
    }
  }

  return (
    sorted.find(
      rally => (
        currentFrame
        <= rally.end_frame
      ),
    )
    || null
  )
}


export default function Quality2DPanel() {
  const matchId = (
    useAppStore(
      state => state.matchId,
    )
  )

  const fps = (
    useAppStore(
      state => state.fps,
    )
    || 50
  )

  const currentFrame = (
    useAppStore(
      state => state.currentFrame,
    )
  )

  const setCurrentFrame = (
    useAppStore(
      state => (
        state.setCurrentFrame
      ),
    )
  )

  const setCurrentTime = (
    useAppStore(
      state => (
        state.setCurrentTime
      ),
    )
  )

  const bottomView = (
    useAppStore(
      state => state.bottomView,
    )
  )

  const setBottomView = (
    useAppStore(
      state => (
        state.setBottomView
      ),
    )
  )

  const cameras = (
    useAppStore(
      state => state.cameras,
    )
    || []
  )

  const setActiveCamera = (
    useAppStore(
      state => (
        state.setActiveCamera
      ),
    )
  )

  const setSceneCameraTarget = (
    useAppStore(
      state => (
        state.setSceneCameraTarget
      ),
    )
  )

  const rallies = (
    useAppStore(
      state => state.rallies,
    )
    || []
  )

  const activeItem = (
    useAppStore(
      state => state.activeItem,
    )
  )

  const setActiveItem = (
    useAppStore(
      state => (
        state.setActiveItem
      ),
    )
  )

  const setSelectionRange = (
    useAppStore(
      state => (
        state.setSelectionRange
      ),
    )
  )

  const setPlaying = (
    useAppStore(
      state => state.setPlaying,
    )
  )

  const upsertTrajPoints = (
    useAppStore(
      state => (
        state.upsertTrajPoints
      ),
    )
  )

  const upsertBall2DPoints = (
    useAppStore(
      state => (
        state.upsertBall2DPoints
      ),
    )
  )


  const wrapRef = (
    useRef(
      null,
    )
  )

  const canvasRef = (
    useRef(
      null,
    )
  )

  const draggingRef = (
    useRef(
      false,
    )
  )


  const size = (
    usePanelSize(
      wrapRef,
    )
  )


  const [
    grid,
    setGrid,
  ] = useState([])

  const [
    loadedRallyId,
    setLoadedRallyId,
  ] = useState(
    null,
  )

  const [
    scanning,
    setScanning,
  ] = useState(
    false,
  )

  const [
    scanError,
    setScanError,
  ] = useState('')


  const [
    autoRepairing,
    setAutoRepairing,
  ] = useState(
    false,
  )

  const [
    autoRepairProgress,
    setAutoRepairProgress,
  ] = useState(
    null,
  )

  const [
    autoRepairResult,
    setAutoRepairResult,
  ] = useState(
    null,
  )


  const [
    zoom,
    setZoom,
  ] = useState(
    null,
  )


  const currentRally = (
    useMemo(
      () => (
        findCurrentRally(
          rallies,
          currentFrame,
          activeItem,
        )
      ),
      [
        rallies,
        currentFrame,
        activeItem,
      ],
    )
  )


  const sortedCameras = (
    useMemo(
      () => (
        [
          ...cameras,
        ].sort(
          (
            first,
            second,
          ) => (
            Number(
              first.index,
            )
            - Number(
              second.index,
            )
          ),
        )
      ),
      [
        cameras,
      ],
    )
  )


  /*
   * 載入目前 Rally
   * 的品質檢查結果。
   *
   * 這裡完全保留原本的
   * camera-grid 偵測。
   */
  useEffect(
    () => {
      if (
        matchId == null
        || !currentRally
      ) {
        return
      }

      let cancelled = false

      const run = async () => {
        setScanning(
          true,
        )

        setScanError(
          '',
        )

        if (
          currentRally.end_frame
          - currentRally.start_frame
          > MAX_CAMERA_GRID_FRAMES
        ) {
          setScanError(
            (
              '此 rally 超過 '
              + MAX_CAMERA_GRID_FRAMES
              + ' frame，暫不支援品質檢查'
            ),
          )

          setGrid([])

          setLoadedRallyId(
            null,
          )

          setScanning(
            false,
          )

          return
        }

        try {
          const points = (
            await api.getTraj2DCameraGrid(
              matchId,
              currentRally.start_frame,
              currentRally.end_frame,
            )
          )

          if (
            cancelled
          ) {
            return
          }

          setGrid(
            points,
          )

          setLoadedRallyId(
            currentRally.id,
          )

        } catch (error) {
          if (
            !cancelled
          ) {
            console.error(
              error,
            )

            setScanError(
              error?.message
              || String(
                error,
              ),
            )

            setGrid([])

            setLoadedRallyId(
              null,
            )
          }

        } finally {
          if (
            !cancelled
          ) {
            setScanning(
              false,
            )
          }
        }
      }

      run()

      return () => {
        cancelled = true
      }
    },
    [
      matchId,
      currentRally,
    ],
  )


  /*
   * 換 Rally 時，
   * 重設顯示範圍。
   */
  useEffect(
    () => {
      setAutoRepairResult(
        null,
      )

      if (
        !currentRally
      ) {
        setZoom(
          null,
        )

        return
      }

      setZoom({
        start:
          currentRally.start_frame,

        len:
          Math.max(
            1,
            (
              currentRally.end_frame
              - currentRally.start_frame
              + 1
            ),
          ),
      })
    },
    [
      currentRally?.id,
    ],
  )


  const statusByFrame = (
    useMemo(
      () => {
        const map = (
          new Map()
        )

        for (
          const point
          of grid
        ) {
          const cameraStatus = (
            new Map()
          )

          for (
            const entry
            of point.cameras
            || []
          ) {
            cameraStatus.set(
              Number(
                entry.camera_index,
              ),
              entry.status,
            )
          }

          map.set(
            Number(
              point.frame,
            ),
            cameraStatus,
          )
        }

        return map
      },
      [
        grid,
      ],
    )
  )


  const lowCoverageByFrame = (
    useMemo(
      () => {
        const map = (
          new Map()
        )

        for (
          const point
          of grid
        ) {
          map.set(
            Number(
              point.frame,
            ),
            Boolean(
              point.low_coverage,
            ),
          )
        }

        return map
      },
      [
        grid,
      ],
    )
  )


  const badFrameCount = (
    useMemo(
      () => (
        grid.filter(
          point => (
            (
              point.cameras
              || []
            ).some(
              camera => (
                camera.status
                === 'bad'
              ),
            )
          ),
        ).length
      ),
      [
        grid,
      ],
    )
  )


  const dataReady = (
    Boolean(
      currentRally
      && loadedRallyId
        === currentRally.id
      && !scanning
    )
  )


  const rallyFrameCount = (
    currentRally
      ? Math.max(
          1,
          (
            currentRally.end_frame
            - currentRally.start_frame
            + 1
          ),
        )
      : 1
  )


  const isZoomed = (
    Boolean(
      zoom
      && currentRally
      && (
        zoom.len
        < rallyFrameCount
          - 0.5
      )
    )
  )


  const viewStartFrame = (
    currentRally
      ? Math.max(
          currentRally.start_frame,
          Math.floor(
            zoom?.start
            ?? currentRally.start_frame,
          ),
        )
      : 0
  )


  const viewFrameCount = (
    currentRally
      ? Math.max(
          1,
          Math.min(
            rallyFrameCount,
            Math.round(
              zoom?.len
              ?? rallyFrameCount,
            ),
          ),
        )
      : 1
  )


  const viewEndFrame = (
    currentRally
      ? Math.min(
          currentRally.end_frame,
          (
            viewStartFrame
            + viewFrameCount
            - 1
          ),
        )
      : 0
  )


  const rowCount = (
    sortedCameras.length
  )

  const totalRows = (
    rowCount
  )


  const rowHeight = (
    size.height > 0
      ? Math.max(
          MIN_ROW_HEIGHT,
          (
            size.height
            / Math.max(
              1,
              totalRows,
            )
          ),
        )
      : ROW_HEIGHT_FALLBACK
  )


  const resetZoom = () => {
    if (
      !currentRally
    ) {
      return
    }

    setZoom({
      start:
        currentRally.start_frame,

      len:
        rallyFrameCount,
    })
  }


  /*
   * 自動修正目前 Rally。
   *
   * 不改偵測：
   * 完全直接使用 grid 裡
   * 現有的 ok / bad / no_data。
   */
  const runAutoRepair = async () => {
    if (
      !dataReady
      || autoRepairing
      || matchId == null
      || !currentRally
    ) {
      return
    }

    /*
     * 自動修正開始後
     * 強制暫停影片。
     */
    setPlaying(
      false,
    )

    setAutoRepairing(
      true,
    )

    setAutoRepairProgress(
      null,
    )

    setAutoRepairResult(
      null,
    )

    try {
      const result = (
        await autoRepairBad2DFrames({
          matchId,

          startFrame:
            currentRally.start_frame,

          endFrame:
            currentRally.end_frame,

          grid,

          cameras:
            sortedCameras,

          onProgress:
            setAutoRepairProgress,

          onConfirmed:
            confirmed => {
              /*
               * 修正後立即更新
               * 前端的 3D cache。
               */
              if (
                confirmed
                  ?.trajectory_point
              ) {
                upsertTrajPoints([
                  confirmed
                    .trajectory_point,
                ])
              }

              /*
               * 修正後立即更新
               * 2D cache。
               */
              const pointsByCamera = (
                new Map()
              )

              for (
                const point
                of (
                  confirmed
                    ?.ball_2d_points
                  || []
                )
              ) {
                const cameraIndex = (
                  Number(
                    point.camera_index,
                  )
                )

                if (
                  !pointsByCamera.has(
                    cameraIndex,
                  )
                ) {
                  pointsByCamera.set(
                    cameraIndex,
                    [],
                  )
                }

                pointsByCamera
                  .get(
                    cameraIndex,
                  )
                  .push(
                    point,
                  )
              }

              for (
                const [
                  cameraIndex,
                  points,
                ]
                of pointsByCamera
              ) {
                upsertBall2DPoints(
                  cameraIndex,
                  points,
                )
              }
            },
        })
      )

      /*
       * 全部修完後，
       * 重新跑一次原本的偵測。
       */
      const refreshed = (
        await api.getTraj2DCameraGrid(
          matchId,
          currentRally.start_frame,
          currentRally.end_frame,
        )
      )

      setGrid(
        refreshed,
      )

      setLoadedRallyId(
        currentRally.id,
      )

      setAutoRepairResult(
        result,
      )

    } catch (error) {
      console.error(
        error,
      )

      setAutoRepairResult({
        error: (
          error?.message
          || String(
            error,
          )
        ),
      })

    } finally {
      setAutoRepairing(
        false,
      )

      setAutoRepairProgress(
        null,
      )
    }
  }


  /*
   * 畫品質 Grid。
   */
  useEffect(
    () => {
      const canvas = (
        canvasRef.current
      )

      if (
        !canvas
        || size.width <= 0
        || rowCount === 0
        || !currentRally
      ) {
        return
      }

      const height = (
        rowHeight
        * totalRows
      )

      const ctx = (
        canvas.getContext(
          '2d',
        )
      )

      if (
        !ctx
      ) {
        return
      }

      const scale = (
        window.devicePixelRatio
        || 1
      )

      canvas.width = (
        Math.max(
          1,
          size.width
            * scale,
        )
      )

      canvas.height = (
        Math.max(
          1,
          height
            * scale,
        )
      )

      ctx.setTransform(
        scale,
        0,
        0,
        scale,
        0,
        0,
      )

      const width = (
        size.width
      )

      ctx.clearRect(
        0,
        0,
        width,
        height,
      )

      ctx.fillStyle = (
        '#09090b'
      )

      ctx.fillRect(
        0,
        0,
        width,
        height,
      )

      const startFrame = (
        viewStartFrame
      )

      const endFrame = (
        viewEndFrame
      )

      const pxPerFrame = (
        width
        / viewFrameCount
      )


      const colorForCell = (
        cameraIndex,
        frame,
      ) => {
        if (
          !dataReady
        ) {
          return (
            STATUS_COLOR.no_data
          )
        }

        const status = (
          statusByFrame
            .get(
              frame,
            )
            ?.get(
              cameraIndex,
            )
          || 'no_data'
        )

        if (
          status !== 'no_data'
          && lowCoverageByFrame
            .get(
              frame,
            )
        ) {
          return (
            INSUFFICIENT_COLOR
          )
        }

        return (
          STATUS_COLOR[
            status
          ]
          || STATUS_COLOR.no_data
        )
      }


      sortedCameras.forEach(
        (
          camera,
          rowIndex,
        ) => {
          const cameraIndex = (
            Number(
              camera.index,
            )
          )

          const rowTop = (
            rowHeight
            * rowIndex
          )

          let camRunStartFrame = (
            startFrame
          )

          let camRunColor = (
            colorForCell(
              cameraIndex,
              startFrame,
            )
          )


          const flushRun = (
            untilFrame,
          ) => {
            const x = (
              (
                camRunStartFrame
                - startFrame
              )
              * pxPerFrame
            )

            const rectWidth = (
              Math.max(
                1,
                (
                  untilFrame
                  - camRunStartFrame
                )
                  * pxPerFrame,
              )
            )

            ctx.fillStyle = (
              camRunColor
            )

            ctx.fillRect(
              x,
              rowTop,
              rectWidth,
              rowHeight - 2,
            )
          }


          for (
            let frame = (
              startFrame + 1
            );
            frame <= (
              endFrame + 1
            );
            frame += 1
          ) {
            const color = (
              frame <= endFrame
                ? colorForCell(
                    cameraIndex,
                    frame,
                  )
                : null
            )

            if (
              color
              !== camRunColor
            ) {
              flushRun(
                frame,
              )

              camRunStartFrame = (
                frame
              )

              camRunColor = (
                color
              )
            }
          }
        },
      )


      if (
        currentFrame
          >= startFrame
        && currentFrame
          <= endFrame
      ) {
        const px = (
          (
            currentFrame
            - startFrame
          )
          * pxPerFrame
        )

        ctx.strokeStyle = (
          '#38bdf8'
        )

        ctx.lineWidth = (
          1.5
        )

        ctx.beginPath()

        ctx.moveTo(
          px,
          0,
        )

        ctx.lineTo(
          px,
          height,
        )

        ctx.stroke()
      }


      ctx.strokeStyle = (
        'rgba(9,9,11,0.9)'
      )

      ctx.lineWidth = 1

      for (
        let rowIndex = 1;
        rowIndex < totalRows;
        rowIndex += 1
      ) {
        const y = (
          rowHeight
          * rowIndex
        )

        ctx.beginPath()

        ctx.moveTo(
          0,
          y,
        )

        ctx.lineTo(
          width,
          y,
        )

        ctx.stroke()
      }
    },
    [
      size.width,
      rowHeight,
      totalRows,
      sortedCameras,
      statusByFrame,
      lowCoverageByFrame,
      dataReady,
      currentFrame,
      currentRally,
      viewStartFrame,
      viewEndFrame,
      viewFrameCount,
      rowCount,
    ],
  )


  const jumpToCanvasPoint = (
    clientX,
    clientY,
  ) => {
    const canvas = (
      canvasRef.current
    )

    if (
      !canvas
      || !currentRally
      || sortedCameras.length
        === 0
    ) {
      return
    }

    const rect = (
      canvas
        .getBoundingClientRect()
    )

    const ratioX = (
      Math.max(
        0,
        Math.min(
          1,
          (
            clientX
            - rect.left
          )
            / rect.width,
        ),
      )
    )

    const frame = (
      viewStartFrame
      + Math.min(
          viewFrameCount
            - 1,
          Math.floor(
            ratioX
            * viewFrameCount,
          ),
        )
    )

    const rowIndex = (
      Math.floor(
        (
          clientY
          - rect.top
        )
          / rowHeight,
      )
    )

    const camera = (
      rowIndex >= 0
        ? sortedCameras[
            Math.min(
              sortedCameras.length
                - 1,
              rowIndex,
            )
          ]
        : null
    )

    setCurrentFrame(
      frame,
    )

    if (
      camera
    ) {
      setActiveCamera(
        camera.id,
      )

      setSceneCameraTarget(
        camera.id,
      )
    }
  }


  const handlePointerDown = (
    event,
  ) => {
    event.currentTarget
      .setPointerCapture(
        event.pointerId,
      )

    draggingRef.current = (
      true
    )

    jumpToCanvasPoint(
      event.clientX,
      event.clientY,
    )
  }


  const handlePointerMove = (
    event,
  ) => {
    if (
      draggingRef.current
    ) {
      jumpToCanvasPoint(
        event.clientX,
        event.clientY,
      )
    }
  }


  const stopDragging = (
    event,
  ) => {
    draggingRef.current = (
      false
    )

    if (
      event.currentTarget
        .hasPointerCapture(
          event.pointerId,
        )
    ) {
      event.currentTarget
        .releasePointerCapture(
          event.pointerId,
        )
    }
  }


  const handleWheel = (
    event,
  ) => {
    if (
      !currentRally
      || !zoom
    ) {
      return
    }

    event.preventDefault()

    const canvas = (
      canvasRef.current
    )

    if (
      !canvas
    ) {
      return
    }

    const rect = (
      canvas
        .getBoundingClientRect()
    )

    const ratioX = (
      Math.max(
        0,
        Math.min(
          1,
          (
            event.clientX
            - rect.left
          )
            / rect.width,
        ),
      )
    )

    const rallyStart = (
      currentRally.start_frame
    )

    const rallyEnd = (
      currentRally.end_frame
    )

    const maxLen = (
      rallyEnd
      - rallyStart
      + 1
    )

    setZoom(
      previous => {
        const cursorFrame = (
          previous.start
          + ratioX
            * previous.len
        )

        if (
          event.shiftKey
        ) {
          const zoomFactor = (
            event.deltaY > 0
              ? 1.1
              : 0.9
          )

          const nextLen = (
            Math.min(
              maxLen,
              Math.max(
                MIN_ZOOM_FRAMES,
                previous.len
                  * zoomFactor,
              ),
            )
          )

          let nextStart = (
            cursorFrame
            - ratioX
              * nextLen
          )

          nextStart = (
            Math.max(
              rallyStart,
              Math.min(
                nextStart,
                (
                  rallyEnd
                  - nextLen
                  + 1
                ),
              ),
            )
          )

          return {
            start:
              nextStart,

            len:
              nextLen,
          }
        }

        const delta = (
          Math.abs(
            event.deltaX,
          )
          > Math.abs(
            event.deltaY,
          )
            ? event.deltaX
            : event.deltaY
        )

        const panFrames = (
          (
            delta
            / Math.max(
              1,
              rect.width,
            )
          )
          * previous.len
        )

        let nextStart = (
          previous.start
          + panFrames
        )

        nextStart = (
          Math.max(
            rallyStart,
            Math.min(
              nextStart,
              (
                rallyEnd
                - previous.len
                + 1
              ),
            ),
          )
        )

        return {
          start:
            nextStart,

          len:
            previous.len,
        }
      },
    )
  }


  const goToRallyByIndex = (
    targetIndex,
  ) => {
    const sorted = [
      ...rallies,
    ].sort(
      (
        first,
        second,
      ) => (
        first.start_frame
        - second.start_frame
      ),
    )

    if (
      sorted.length === 0
    ) {
      return
    }

    const index = (
      Math.max(
        0,
        Math.min(
          sorted.length - 1,
          targetIndex,
        ),
      )
    )

    const rally = (
      sorted[index]
    )

    const startSec = (
      rally.start_frame
      / fps
    )

    const endSec = (
      rally.end_frame
      / fps
    )

    setSelectionRange(
      startSec,
      endSec,
    )

    setCurrentTime(
      startSec,
    )

    setActiveItem(
      'rally',
      rally.id,
    )
  }


  const goPrevRally = () => {
    const sorted = [
      ...rallies,
    ].sort(
      (
        first,
        second,
      ) => (
        first.start_frame
        - second.start_frame
      ),
    )

    if (
      sorted.length === 0
    ) {
      return
    }

    if (
      activeItem?.type
      === 'rally'
    ) {
      const index = (
        sorted.findIndex(
          rally => (
            rally.id
            === activeItem.id
          ),
        )
      )

      if (
        index > 0
      ) {
        goToRallyByIndex(
          index - 1,
        )

        return
      }
    }

    let targetIndex = -1

    for (
      let index = (
        sorted.length - 1
      );
      index >= 0;
      index -= 1
    ) {
      if (
        sorted[index]
          .start_frame
        < currentFrame
      ) {
        targetIndex = (
          index
        )

        break
      }
    }

    if (
      targetIndex === -1
    ) {
      targetIndex = 0
    }

    goToRallyByIndex(
      targetIndex,
    )
  }


  const goNextRally = () => {
    const sorted = [
      ...rallies,
    ].sort(
      (
        first,
        second,
      ) => (
        first.start_frame
        - second.start_frame
      ),
    )

    if (
      sorted.length === 0
    ) {
      return
    }

    if (
      activeItem?.type
      === 'rally'
    ) {
      const index = (
        sorted.findIndex(
          rally => (
            rally.id
            === activeItem.id
          ),
        )
      )

      if (
        index !== -1
        && index
          < sorted.length - 1
      ) {
        goToRallyByIndex(
          index + 1,
        )

        return
      }
    }

    const targetIndex = (
      sorted.findIndex(
        rally => (
          rally.start_frame
          > currentFrame
        ),
      )
    )

    goToRallyByIndex(
      targetIndex === -1
        ? sorted.length - 1
        : targetIndex,
    )
  }


  return (
    <div
      className="
        h-full
        w-full
        min-h-0
        min-w-0
        flex
        flex-col
        bg-zinc-950
      "
    >
      <div
        className="
          h-[42px]
          shrink-0
          px-4
          flex
          items-center
          gap-3
          border-b
          border-zinc-800
          bg-zinc-950
          shadow-sm
          z-20
          min-w-0
          overflow-hidden
        "
      >
        <div
          className="
            flex
            bg-zinc-900
            border
            border-zinc-800
            rounded-md
            overflow-hidden
            shrink-0
          "
        >
          {[
            [
              'timeline',
              'TIMELINE',
            ],
            [
              'projection2d',
              '2D',
            ],
            [
              'quality2d',
              '品質檢查',
            ],
          ].map(
            (
              [
                id,
                label,
              ],
            ) => (
              <button
                key={id}
                type="button"
                onClick={
                  () => (
                    setBottomView(
                      id,
                    )
                  )
                }
                className={`
                  px-3
                  py-1
                  text-xs
                  font-bold
                  tracking-wider
                  transition-colors
                  ${
                    bottomView
                    === id
                      ? (
                          'bg-zinc-800 '
                          + 'text-zinc-100'
                        )
                      : (
                          'text-zinc-500 '
                          + 'hover:text-zinc-200 '
                          + 'hover:bg-zinc-800/70'
                        )
                  }
                `}
              >
                {label}
              </button>
            ),
          )}
        </div>


        <div
          className="
            text-xs
            text-zinc-500
            truncate
            min-w-0
          "
        >
          {!currentRally
            ? (
                '請先選擇或播放到一個 rally'
              )
            : autoRepairing
              ? (
                  autoRepairProgress
                    ? (
                        `自動修正 frame ${
                          autoRepairProgress.frame
                        }（${
                          autoRepairProgress.current
                        }/${
                          autoRepairProgress.total
                        }）`
                      )
                    : (
                        '準備自動修正…'
                      )
                )
              : scanning
                ? (
                    `掃描 Rally #${
                      currentRally.rally_index
                    } 中…`
                  )
                : scanError
                  ? (
                      `掃描失敗：${
                        scanError
                      }`
                    )
                  : (
                      `Rally #${
                        currentRally.rally_index
                      }：frame ${
                        viewStartFrame
                      }-${
                        viewEndFrame
                      } / 共 ${
                        currentRally.start_frame
                      }-${
                        currentRally.end_frame
                      }`
                    )}
        </div>


        {currentRally && (
          <button
            type="button"
            onClick={
              runAutoRepair
            }
            disabled={
              !dataReady
              || autoRepairing
              || scanning
              || badFrameCount === 0
            }
            title="
              使用目前 bad 判定，
              排除錯誤視角後重新 triangulation，
              自動修正 2D + 3D
            "
            className="
              shrink-0
              px-2
              py-1
              text-xs
              font-semibold
              rounded
              border
              border-emerald-700/70
              bg-emerald-950/50
              text-emerald-300
              hover:bg-emerald-900/60
              disabled:opacity-40
              disabled:cursor-not-allowed
            "
          >
            {autoRepairing
              ? (
                  '自動修正中…'
                )
              : badFrameCount > 0
                ? (
                    `自動修正 (${badFrameCount})`
                  )
                : (
                    '沒有錯誤'
                  )}
          </button>
        )}


        {isZoomed && (
          <button
            type="button"
            onClick={
              resetZoom
            }
            className="
              shrink-0
              px-2
              py-1
              text-xs
              rounded
              border
              border-zinc-800
              bg-zinc-900
              text-zinc-400
              hover:text-zinc-100
              hover:bg-zinc-800
            "
            title="
              回到完整 rally 範圍
            "
          >
            重置縮放
          </button>
        )}


        <div
          className="
            ml-auto
            min-w-0
            overflow-hidden
            shrink-0
          "
        >
          <PlaybackUI
            goPrevRally={
              goPrevRally
            }
            goNextRally={
              goNextRally
            }
          />
        </div>
      </div>


      <div
        className="
          flex-1
          min-h-0
          min-w-0
          flex
          flex-col
          gap-2
          p-3
          bg-[#09090b]
          overflow-hidden
        "
      >
        {!currentRally
          ? (
              <div
                className="
                  flex-1
                  flex
                  items-center
                  justify-center
                  text-xs
                  text-zinc-600
                "
              >
                在 Timeline 點一個 Rally，
                或播放到 rally 內即可看到各視角的狀態
              </div>
            )
          : (
              <>
                <div
                  className="
                    flex-1
                    min-h-0
                    flex
                    gap-2
                  "
                >
                  <div
                    className="
                      w-20
                      shrink-0
                      flex
                      flex-col
                      border
                      border-zinc-800
                      rounded-l-md
                      overflow-hidden
                      bg-zinc-950
                    "
                  >
                    {sortedCameras.map(
                      camera => (
                        <div
                          key={
                            camera.id
                          }
                          className="
                            flex
                            items-center
                            px-2
                            text-[11px]
                            text-zinc-400
                            border-b
                            border-zinc-900
                            last:border-b-0
                            truncate
                          "
                          style={{
                            height:
                              rowHeight,
                          }}
                        >
                          {camera.label
                            || (
                              `Cam ${
                                camera.index
                              }`
                            )}
                        </div>
                      ),
                    )}
                  </div>


                  <div
                    ref={
                      wrapRef
                    }
                    className="
                      flex-1
                      min-w-0
                      relative
                      border
                      border-zinc-800
                      rounded-r-md
                      overflow-hidden
                      bg-zinc-950
                    "
                  >
                    <canvas
                      ref={
                        canvasRef
                      }
                      className="
                        absolute
                        inset-0
                        w-full
                        h-full
                        block
                      "
                      onPointerDown={
                        handlePointerDown
                      }
                      onPointerMove={
                        handlePointerMove
                      }
                      onPointerUp={
                        stopDragging
                      }
                      onPointerCancel={
                        stopDragging
                      }
                      onWheel={
                        handleWheel
                      }
                      style={{
                        cursor:
                          'crosshair',

                        touchAction:
                          'none',
                      }}
                    />
                  </div>
                </div>


                <div
                  className="
                    flex
                    items-center
                    gap-3
                    text-[10px]
                    text-zinc-500
                    shrink-0
                    flex-wrap
                  "
                >
                  <span
                    className="
                      flex
                      items-center
                      gap-1
                    "
                  >
                    <span
                      className="
                        w-3
                        h-3
                        rounded-sm
                        inline-block
                      "
                      style={{
                        background:
                          STATUS_COLOR.ok,
                      }}
                    />

                    pass
                  </span>


                  <span
                    className="
                      flex
                      items-center
                      gap-1
                    "
                  >
                    <span
                      className="
                        w-3
                        h-3
                        rounded-sm
                        inline-block
                      "
                      style={{
                        background:
                          STATUS_COLOR.bad,
                      }}
                    />

                    fail（與其他視角不一致）
                  </span>


                  <span
                    className="
                      flex
                      items-center
                      gap-1
                    "
                  >
                    <span
                      className="
                        w-3
                        h-3
                        rounded-sm
                        inline-block
                      "
                      style={{
                        background:
                          STATUS_COLOR.no_data,
                      }}
                    />

                    沒有標註資料
                  </span>


                  <span
                    className="
                      flex
                      items-center
                      gap-1
                    "
                  >
                    <span
                      className="
                        w-3
                        h-3
                        rounded-sm
                        inline-block
                      "
                      style={{
                        background:
                          INSUFFICIENT_COLOR,
                      }}
                    />

                    可用視角少於
                    {' '}
                    {AVAILABLE_CAMERA_MIN}
                    {' '}
                    支
                  </span>


                  {autoRepairResult && (
                    <span
                      className={
                        autoRepairResult.error
                          ? (
                              'text-red-400'
                            )
                          : (
                              'text-emerald-400'
                            )
                      }
                    >
                      {autoRepairResult.error
                        ? (
                            `自動修正失敗：${
                              autoRepairResult.error
                            }`
                          )
                        : (
                            <>
                              自動修正：
                              偵測
                              {' '}
                              {
                                autoRepairResult
                                  .detectedFrames
                              }
                              {' '}
                              frame，
                              成功
                              {' '}
                              {
                                autoRepairResult
                                  .repairedFrames
                              }
                              {' '}
                              frame /
                              {' '}
                              {
                                autoRepairResult
                                  .repairedPoints
                              }
                              {' '}
                              點，
                              跳過
                              {' '}
                              {
                                autoRepairResult
                                  .skippedFrames
                              }
                              {' '}
                              frame
                            </>
                          )}
                    </span>
                  )}


                  <span
                    className="
                      ml-auto
                      text-zinc-600
                    "
                  >
                    Shift+滾輪縮放 / 滾輪平移
                  </span>
                </div>
              </>
            )}
      </div>
    </div>
  )
}
