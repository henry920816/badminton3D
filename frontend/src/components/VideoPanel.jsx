import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  useAppStore,
} from '../store.js'

import {
  API_BASE,
} from '../config.js'

import {
  project3DToImage,
} from '../utils/cameraProjection.js'


function resolveVideoUrl(url) {
  if (!url) {
    return null
  }

  if (url.startsWith('blob:')) {
    return url
  }

  if (
    url.startsWith('http://')
    || url.startsWith('https://')
  ) {
    return url
  }

  if (url.startsWith('/')) {
    return (
      `${API_BASE}${url}`
    )
  }

  return url
}


function detectCameraIdFromFileName(
  fileName,
) {
  const name = String(
    fileName
    || '',
  ).toLowerCase()

  const simpleMatch = name.match(
    /^([0-9])\.mp4$/
  )

  if (simpleMatch) {
    return (
      `cam${simpleMatch[1]}`
    )
  }

  const cameraMatch = name.match(
    /(?:cam|camera)[_-]?([0-9])\.mp4$/
  )

  if (cameraMatch) {
    return (
      `cam${cameraMatch[1]}`
    )
  }

  return null
}


function getCameraVideoTime(
  globalFrame,
  globalFps,
  camera,
) {
  const cameraFps = (
    camera?.fps
    || globalFps
    || 50
  )

  const offsetFrame = (
    camera?.offset_frame
    || 0
  )

  return Math.max(
    0,
    (
      globalFrame
      + offsetFrame
    )
    / cameraFps,
  )
}


function getGlobalFrameFromCameraTime(
  cameraTime,
  globalFps,
  camera,
) {
  const cameraFps = (
    camera?.fps
    || globalFps
    || 50
  )

  const offsetFrame = (
    camera?.offset_frame
    || 0
  )

  return Math.max(
    0,
    Math.round(
      cameraTime
      * cameraFps
      - offsetFrame,
    ),
  )
}


function getNearestTrajectoryPoint(
  trajectoryMap,
  frame,
  radius = 3,
) {
  const exact = (
    trajectoryMap.get(
      frame
    )
  )

  if (exact) {
    return exact
  }

  for (
    let distance = 1;
    distance <= radius;
    distance += 1
  ) {
    const previous = (
      trajectoryMap.get(
        frame - distance
      )
    )

    if (previous) {
      return previous
    }

    const next = (
      trajectoryMap.get(
        frame + distance
      )
    )

    if (next) {
      return next
    }
  }

  return null
}


function getObjectContainRect(
  container,
  video,
) {
  const boxWidth = Math.max(
    1,
    Math.round(
      container?.clientWidth
      || video?.clientWidth
      || 0,
    ),
  )

  const boxHeight = Math.max(
    1,
    Math.round(
      container?.clientHeight
      || video?.clientHeight
      || 0,
    ),
  )

  const videoWidth = (
    video?.videoWidth
    || 1280
  )

  const videoHeight = (
    video?.videoHeight
    || 800
  )

  const boxRatio = (
    boxWidth
    / boxHeight
  )

  const videoRatio = (
    videoWidth
    / videoHeight
  )

  let width = boxWidth
  let height = boxHeight
  let x = 0
  let y = 0

  if (boxRatio > videoRatio) {
    height = boxHeight
    width = (
      height
      * videoRatio
    )
    x = (
      boxWidth
      - width
    ) / 2
  } else {
    width = boxWidth
    height = (
      width
      / videoRatio
    )
    y = (
      boxHeight
      - height
    ) / 2
  }

  return {
    boxWidth,
    boxHeight,
    x,
    y,
    width,
    height,
  }
}


function drawProjectionOverlay({
  canvas,
  container,
  video,
  cameraParams,
  trajectoryMap,
  currentFrame,
  showProjection,
}) {
  if (
    !canvas
    || !container
    || !video
  ) {
    return
  }

  const rectangle = (
    getObjectContainRect(
      container,
      video,
    )
  )

  const pixelRatio = (
    window.devicePixelRatio
    || 1
  )

  canvas.style.width = (
    `${rectangle.boxWidth}px`
  )

  canvas.style.height = (
    `${rectangle.boxHeight}px`
  )

  canvas.width = Math.max(
    1,
    Math.round(
      rectangle.boxWidth
      * pixelRatio,
    ),
  )

  canvas.height = Math.max(
    1,
    Math.round(
      rectangle.boxHeight
      * pixelRatio,
    ),
  )

  const context = (
    canvas.getContext('2d')
  )

  context.setTransform(
    pixelRatio,
    0,
    0,
    pixelRatio,
    0,
    0,
  )

  context.clearRect(
    0,
    0,
    rectangle.boxWidth,
    rectangle.boxHeight,
  )

  if (
    !showProjection
    || !cameraParams
  ) {
    return
  }

  const imageWidth = (
    cameraParams.imageWidth
    || 1920
  )

  const imageHeight = (
    cameraParams.imageHeight
    || 1200
  )

  const scaleX = (
    rectangle.width
    / imageWidth
  )

  const scaleY = (
    rectangle.height
    / imageHeight
  )

  const currentPoint = (
    getNearestTrajectoryPoint(
      trajectoryMap,
      currentFrame,
      3,
    )
  )

  if (!currentPoint) {
    return
  }

  const projection = (
    project3DToImage(
      currentPoint,
      cameraParams,
    )
  )

  if (!projection) {
    return
  }

  const canvasX = (
    rectangle.x
    + projection.u
    * scaleX
  )

  const canvasY = (
    rectangle.y
    + projection.v
    * scaleY
  )

  context.save()

  context.fillStyle = (
    '#ef4444'
  )

  context.shadowColor = (
    'rgba(0, 0, 0, 0.85)'
  )

  context.shadowBlur = 4

  context.beginPath()

  context.arc(
    canvasX,
    canvasY,
    4,
    0,
    Math.PI * 2,
  )

  context.fill()
  context.restore()
}


export default function VideoPanel() {
  const videoWrapRef = useRef(null)
  const videoRef = useRef(null)
  const overlayCanvasRef = useRef(null)

  const syncFromVideoRef = useRef(false)

  const previousLocalUrlsRef = useRef({})

  const lastVideoDrivenFrameRef = useRef(
    null
  )

  const cameras = useAppStore(
    state => state.cameras
  )

  const activeCameraId = useAppStore(
    state => state.activeCameraId
  )

  const setActiveCamera = useAppStore(
    state => state.setActiveCamera
  )

  const sceneCameraTargetId = useAppStore(
    state => state.sceneCameraTargetId
  )

  const setSceneCameraTarget = useAppStore(
    state => state.setSceneCameraTarget
  )

  const currentFrame = useAppStore(
    state => state.currentFrame
  )

  const setCurrentFrame = useAppStore(
    state => state.setCurrentFrame
  )

  const setCurrentTime = useAppStore(
    state => state.setCurrentTime
  )

  const trajectoryMap = useAppStore(
    state => state.trajByFrame
  )

  const fps = (
    useAppStore(
      state => state.fps
    )
    || 50
  )

  const playing = useAppStore(
    state => state.playing
  )

  const setPlaying = useAppStore(
    state => state.setPlaying
  )

  const togglePlaying = useAppStore(
    state => state.togglePlaying
  )

  const playbackRate = (
    useAppStore(
      state => state.playbackRate
    )
    || 1
  )

  const previewRange = useAppStore(
    state => state.previewRange
  )

  const localVideoSrcMap = useAppStore(
    state => state.localVideoSrcMap
  )

  const setLocalVideoSrcMap = useAppStore(
    state => state.setLocalVideoSrcMap
  )

  const [
    showProjection,
    setShowProjection,
  ] = useState(true)

  const safePlaybackRate = (
    Number.isFinite(
      Number(playbackRate)
    )
    && Number(playbackRate) > 0
      ? Number(playbackRate)
      : 1
  )

  const safeCameras = useMemo(
    () => (
      Array.isArray(cameras)
      && cameras.length > 0
        ? cameras
        : []
    ),
    [
      cameras,
    ],
  )

  const activeCamera = useMemo(
    () => (
      safeCameras.find(
        camera => (
          camera.id
          === activeCameraId
        ),
      )
      || safeCameras[0]
      || null
    ),
    [
      safeCameras,
      activeCameraId,
    ],
  )

  const activeCameraParams = useMemo(
    () => (
      activeCamera?.projection
      || null
    ),
    [
      activeCamera,
    ],
  )

  const projectionAvailable = Boolean(
    activeCameraParams?.intrinsic
    && activeCameraParams?.extrinsic
  )

  const activeSource = useMemo(
    () => {
      if (!activeCamera) {
        return null
      }

      return (
        localVideoSrcMap[
          activeCamera.id
        ]
        || resolveVideoUrl(
          activeCamera.video_url
          || activeCamera.url
        )
      )
    },
    [
      activeCamera,
      localVideoSrcMap,
    ],
  )

  const redrawOverlay = () => {
    drawProjectionOverlay({
      canvas: (
        overlayCanvasRef.current
      ),
      container: (
        videoWrapRef.current
      ),
      video: (
        videoRef.current
      ),
      cameraParams: (
        activeCameraParams
      ),
      trajectoryMap,
      currentFrame,
      showProjection,
    })
  }

  useEffect(
    () => {
      if (
        !activeCamera
        && safeCameras[0]
      ) {
        setActiveCamera(
          safeCameras[0].id
        )

        return
      }

      if (
        activeCameraId
        && safeCameras.length > 0
        && !safeCameras.some(
          camera => (
            camera.id
            === activeCameraId
          ),
        )
      ) {
        setActiveCamera(
          safeCameras[0].id
        )
      }
    },
    [
      activeCamera,
      activeCameraId,
      safeCameras,
      setActiveCamera,
    ],
  )

  useEffect(
    () => {
      redrawOverlay()
    },
    [
      activeCameraParams,
      trajectoryMap,
      currentFrame,
      showProjection,
      activeSource,
    ],
  )

  useEffect(
    () => {
      const handleResize = () => {
        redrawOverlay()
      }

      window.addEventListener(
        'resize',
        handleResize,
      )

      return () => {
        window.removeEventListener(
          'resize',
          handleResize,
        )
      }
    },
    [
      activeCameraParams,
      trajectoryMap,
      currentFrame,
      showProjection,
    ],
  )

  useEffect(
    () => {
      const target = (
        videoWrapRef.current
      )

      if (!target) {
        return undefined
      }

      const observer = (
        new ResizeObserver(
          () => {
            redrawOverlay()
          },
        )
      )

      observer.observe(
        target
      )

      return () => {
        observer.disconnect()
      }
    },
    [
      activeSource,
      activeCameraParams,
      trajectoryMap,
      currentFrame,
      showProjection,
    ],
  )

  const pickLocalFiles = files => {
    const selectedFiles = Array.from(
      files
      || [],
    )

    if (
      selectedFiles.length === 0
    ) {
      return
    }

    const nextSourceMap = {
      ...localVideoSrcMap,
    }

    const previousUrls = {
      ...previousLocalUrlsRef.current,
    }

    for (
      const file
      of selectedFiles
    ) {
      const cameraId = (
        detectCameraIdFromFileName(
          file.name
        )
      )

      if (!cameraId) {
        continue
      }

      const cameraExists = (
        safeCameras.some(
          camera => (
            camera.id
            === cameraId
          ),
        )
      )

      if (!cameraExists) {
        continue
      }

      const nextUrl = (
        URL.createObjectURL(
          file
        )
      )

      const previousUrl = (
        previousUrls[
          cameraId
        ]
      )

      if (
        typeof previousUrl === 'string'
        && previousUrl.startsWith(
          'blob:'
        )
      ) {
        try {
          URL.revokeObjectURL(
            previousUrl
          )
        } catch {
          // Ignore invalid old object URLs.
        }
      }

      nextSourceMap[
        cameraId
      ] = nextUrl

      previousUrls[
        cameraId
      ] = nextUrl
    }

    previousLocalUrlsRef.current = (
      previousUrls
    )

    setLocalVideoSrcMap(
      nextSourceMap
    )

    const firstValidCameraId = (
      selectedFiles
      .map(
        file => (
          detectCameraIdFromFileName(
            file.name
          )
        ),
      )
      .find(
        cameraId => (
          cameraId
          && safeCameras.some(
            camera => (
              camera.id
              === cameraId
            ),
          )
        ),
      )
    )

    if (firstValidCameraId) {
      setActiveCamera(
        firstValidCameraId
      )

      setSceneCameraTarget(
        firstValidCameraId
      )
    }

    setPlaying(false)
  }

  const switchCamera = cameraId => {
    setActiveCamera(
      cameraId
    )

    setSceneCameraTarget(
      cameraId
    )

    lastVideoDrivenFrameRef.current = (
      null
    )
  }

  useEffect(
    () => {
      const video = (
        videoRef.current
      )

      if (!video) {
        return
      }

      try {
        video.playbackRate = (
          safePlaybackRate
        )
      } catch {
        // Ignore unsupported playback rate.
      }
    },
    [
      safePlaybackRate,
      activeSource,
      activeCameraId,
    ],
  )

  useEffect(
    () => {
      const video = (
        videoRef.current
      )

      if (!video) {
        return
      }

      try {
        video.playbackRate = (
          safePlaybackRate
        )
      } catch {
        // Ignore unsupported playback rate.
      }

      if (
        playing
        && activeSource
      ) {
        const promise = (
          video.play()
        )

        if (
          promise
          && typeof promise.catch
            === 'function'
        ) {
          promise.catch(
            () => {}
          )
        }
      } else {
        video.pause()
      }
    },
    [
      playing,
      activeSource,
      safePlaybackRate,
    ],
  )

  useEffect(
    () => {
      const video = (
        videoRef.current
      )

      if (
        !video
        || !activeCamera
        || !fps
      ) {
        return
      }

      if (
        syncFromVideoRef.current
      ) {
        return
      }

      const targetTime = (
        getCameraVideoTime(
          currentFrame,
          fps,
          activeCamera,
        )
      )

      if (
        !Number.isFinite(
          targetTime
        )
      ) {
        return
      }

      const difference = Math.abs(
        video.currentTime
        - targetTime
      )

      const lastVideoFrame = (
        lastVideoDrivenFrameRef.current
      )

      const frameDifference = (
        lastVideoFrame == null
          ? Infinity
          : Math.abs(
              currentFrame
              - lastVideoFrame
            )
      )

      const tolerance = Math.max(
        2,
        Math.round(
          fps * 0.08
        ),
      )

      const normalPlaybackUpdate = (
        playing
        && frameDifference
          <= tolerance
      )

      if (normalPlaybackUpdate) {
        return
      }

      const seekThreshold = (
        playing
          ? 0.025
          : 0.015
      )

      if (
        difference
        > seekThreshold
      ) {
        try {
          video.currentTime = (
            targetTime
          )
        } catch {
          // Ignore invalid seek.
        }
      }
    },
    [
      currentFrame,
      fps,
      activeCamera,
      activeSource,
      playing,
    ],
  )

  useEffect(
    () => {
      const video = (
        videoRef.current
      )

      if (
        !video
        || !activeCamera
        || !fps
      ) {
        return undefined
      }

      let callbackId = null
      let stopped = false

      const updateFrame = (
        now,
        metadata,
      ) => {
        if (
          stopped
          || !videoRef.current
        ) {
          return
        }

        const mediaTime = (
          metadata?.mediaTime
          ?? videoRef.current.currentTime
        )

        const frame = (
          getGlobalFrameFromCameraTime(
            mediaTime,
            fps,
            activeCamera,
          )
        )

        lastVideoDrivenFrameRef.current = (
          frame
        )

        syncFromVideoRef.current = true

        if (
          previewRange
          && frame
            >= previewRange.endFrame
        ) {
          const endFrame = (
            previewRange.endFrame
          )

          lastVideoDrivenFrameRef.current = (
            endFrame
          )

          setCurrentFrame(
            endFrame
          )

          setCurrentTime(
            endFrame / fps
          )

          setPlaying(false)

          syncFromVideoRef.current = false

          return
        }

        setCurrentFrame(
          frame
        )

        setCurrentTime(
          frame / fps
        )

        syncFromVideoRef.current = false

        if (
          videoRef.current
            .requestVideoFrameCallback
          && !stopped
        ) {
          callbackId = (
            videoRef.current
            .requestVideoFrameCallback(
              updateFrame
            )
          )
        }
      }

      if (
        video
          .requestVideoFrameCallback
      ) {
        callbackId = (
          video
          .requestVideoFrameCallback(
            updateFrame
          )
        )
      }

      return () => {
        stopped = true

        if (
          callbackId
          && video
            .cancelVideoFrameCallback
        ) {
          video.cancelVideoFrameCallback(
            callbackId
          )
        }
      }
    },
    [
      fps,
      activeCamera,
      previewRange,
      setCurrentFrame,
      setCurrentTime,
      setPlaying,
      activeSource,
    ],
  )

  const handleTimeUpdate = () => {
    const video = (
      videoRef.current
    )

    if (
      !video
      || !activeCamera
      || !fps
    ) {
      return
    }

    if (
      video
        .requestVideoFrameCallback
    ) {
      return
    }

    const frame = (
      getGlobalFrameFromCameraTime(
        video.currentTime,
        fps,
        activeCamera,
      )
    )

    lastVideoDrivenFrameRef.current = (
      frame
    )

    syncFromVideoRef.current = true

    if (
      previewRange
      && frame
        >= previewRange.endFrame
    ) {
      const endFrame = (
        previewRange.endFrame
      )

      lastVideoDrivenFrameRef.current = (
        endFrame
      )

      setCurrentFrame(
        endFrame
      )

      setCurrentTime(
        endFrame / fps
      )

      setPlaying(false)

      syncFromVideoRef.current = false

      return
    }

    setCurrentFrame(
      frame
    )

    setCurrentTime(
      frame / fps
    )

    syncFromVideoRef.current = false
  }

  useEffect(
    () => {
      const handleKeyDown = event => {
        const tagName = (
          event.target
            ?.tagName
            ?.toLowerCase()
        )

        if (
          tagName === 'input'
          || tagName === 'textarea'
          || event.target?.isContentEditable
        ) {
          return
        }

        if (
          event.code === 'Space'
        ) {
          event.preventDefault()
          togglePlaying()
          return
        }

        const keyToCameraIndex = {
          Digit0: 0,
          Digit1: 1,
          Digit2: 2,
          Digit3: 3,
          Digit4: 4,
          Digit5: 5,
          Digit6: 6,
          Digit7: 7,
          Digit8: 8,
          Digit9: 9,
        }

        if (
          Object.prototype
            .hasOwnProperty.call(
              keyToCameraIndex,
              event.code,
            )
        ) {
          const cameraIndex = (
            keyToCameraIndex[
              event.code
            ]
          )

          const camera = (
            safeCameras.find(
              item => (
                item.index
                  === cameraIndex
                || item.id
                  === `cam${cameraIndex}`
              ),
            )
          )

          if (camera) {
            event.preventDefault()

            switchCamera(
              camera.id
            )
          }
        }
      }

      window.addEventListener(
        'keydown',
        handleKeyDown,
      )

      return () => {
        window.removeEventListener(
          'keydown',
          handleKeyDown,
        )
      }
    },
    [
      togglePlaying,
      safeCameras,
    ],
  )

  useEffect(
    () => (
      () => {
        Object.values(
          previousLocalUrlsRef.current
        ).forEach(
          url => {
            if (
              typeof url === 'string'
              && url.startsWith(
                'blob:'
              )
            ) {
              try {
                URL.revokeObjectURL(
                  url
                )
              } catch {
                // Ignore cleanup errors.
              }
            }
          },
        )
      }
    ),
    [],
  )

  return (
    <div
      className="
        relative
        w-full
        h-full
        bg-black
        flex
        flex-col
      "
    >
      <div
        className="
          px-3
          py-2
          pl-28
          border-b
          border-zinc-800
          bg-zinc-950
          flex
          items-center
          justify-between
          gap-3
          overflow-hidden
        "
      >
        <div
          className="
            flex
            items-center
            gap-2
            min-w-0
            overflow-x-auto
          "
        >
          {safeCameras.map(
            camera => {
              const isActive = (
                activeCamera?.id
                === camera.id
              )

              const hasVideo = Boolean(
                localVideoSrcMap[
                  camera.id
                ]
                || camera.video_url
                || camera.url
              )

              const isSceneTarget = (
                sceneCameraTargetId
                === camera.id
              )

              const hasProjection = Boolean(
                camera
                  ?.projection
                  ?.intrinsic
                && camera
                  ?.projection
                  ?.extrinsic
              )

              return (
                <button
                  key={camera.id}
                  type="button"
                  onClick={() => {
                    switchCamera(
                      camera.id
                    )
                  }}
                  className={[
                    'px-2.5 py-1 rounded text-xs border shrink-0 transition-colors',

                    isActive
                      ? 'bg-sky-700 border-sky-500 text-white'
                      : hasVideo
                        ? 'bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:bg-zinc-900',
                  ].join(' ')}
                  title={[
                    camera.label,
                    camera.description,
                    camera.fileName,

                    isSceneTarget
                      ? '3D view target'
                      : '',

                    hasProjection
                      ? 'has projection params'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' / ')}
                >
                  {camera.index
                    ?? camera.id.replace(
                      'cam',
                      '',
                    )}
                </button>
              )
            },
          )}
        </div>

        <label
          className="
            inline-flex
            items-center
            shrink-0
          "
        >
          <span
            className="
              px-3
              py-1
              text-xs
              text-white
              bg-zinc-700
              hover:bg-zinc-600
              rounded
              cursor-pointer
            "
          >
            選擇 0-9.mp4
          </span>

          <input
            type="file"
            accept="video/*"
            multiple
            onChange={event => {
              pickLocalFiles(
                event.target.files
              )
            }}
            className="hidden"
          />
        </label>
      </div>

      <div
        className="
          flex-1
          flex
          items-center
          justify-center
          bg-black
          min-h-0
          overflow-hidden
          relative
        "
      >
        <div
          className="
            absolute
            top-2
            left-2
            z-10
            px-2
            py-1
            rounded
            bg-black/65
            border
            border-white/10
            text-xs
            text-zinc-100
          "
        >
          {activeCamera?.label
            || 'No Camera'}

          {activeCamera?.offset_frame
            ? (
                ` / offset ${
                  activeCamera.offset_frame
                    >= 0
                    ? '+'
                    : ''
                }${
                  activeCamera.offset_frame
                }f`
              )
            : ''}

          {projectionAvailable
            && showProjection
            ? (
                ` / Projection ON / ${
                  safePlaybackRate
                }x`
              )
            : (
                ` / ${safePlaybackRate}x`
              )}
        </div>

        {activeSource && (
          <div
            className="
              absolute
              top-2
              right-2
              z-20
              flex
              items-center
              gap-2
            "
          >
            <button
              type="button"
              disabled={
                !projectionAvailable
              }
              onClick={() => {
                setShowProjection(
                  value => !value
                )
              }}
              className={[
                'px-2 py-1 rounded border text-xs',

                projectionAvailable
                  ? (
                      showProjection
                        ? 'bg-yellow-700/80 border-yellow-500 text-yellow-50 hover:bg-yellow-600/80'
                        : 'bg-zinc-900/80 border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                    )
                  : 'bg-zinc-950/80 border-zinc-800 text-zinc-500 cursor-not-allowed',
              ].join(' ')}
              title={
                projectionAvailable
                  ? '顯示或隱藏 3D 球點投影'
                  : '此視角沒有 camera params'
              }
            >
              3D→2D
            </button>
          </div>
        )}

        {!activeSource && (
          <div
            className="
              text-zinc-400
              text-sm
              px-4
              text-center
              leading-7
            "
          >
            目前沒有載入
            {' '}
            {activeCamera?.label
              || 'camera'}
            的影片。

            <br />

            請上方選擇
            {' '}

            <span
              className="
                text-zinc-100
              "
            >
              0.mp4 ～ 9.mp4
            </span>
            。
          </div>
        )}

        {activeSource && (
          <div
            ref={videoWrapRef}
            className="
              relative
              w-full
              h-full
              flex
              items-center
              justify-center
              overflow-hidden
            "
          >
            <video
              ref={videoRef}
              key={activeCamera?.id}
              src={activeSource}
              className="
                block
                w-full
                h-full
                object-contain
              "
              onTimeUpdate={
                handleTimeUpdate
              }
              onLoadedMetadata={() => {
                const video = (
                  videoRef.current
                )

                if (
                  !video
                  || !activeCamera
                ) {
                  return
                }

                try {
                  video.playbackRate = (
                    safePlaybackRate
                  )
                } catch {
                  // Ignore unsupported rate.
                }

                const targetTime = (
                  getCameraVideoTime(
                    currentFrame,
                    fps,
                    activeCamera,
                  )
                )

                try {
                  video.currentTime = (
                    targetTime
                  )
                } catch {
                  // Ignore invalid seek.
                }

                if (playing) {
                  const promise = (
                    video.play()
                  )

                  if (
                    promise
                    && typeof promise.catch
                      === 'function'
                  ) {
                    promise.catch(
                      () => {}
                    )
                  }
                }

                window.requestAnimationFrame(
                  redrawOverlay
                )
              }}
              preload="auto"
              playsInline
              onClick={
                togglePlaying
              }
            />

            <canvas
              ref={overlayCanvasRef}
              className="
                absolute
                inset-0
                pointer-events-none
              "
            />
          </div>
        )}

        {activeSource
          && !projectionAvailable
          && (
            <div
              className="
                absolute
                bottom-3
                right-3
                z-10
                px-2
                py-1
                rounded
                bg-black/65
                border
                border-white/10
                text-xs
                text-zinc-400
              "
            >
              此視角沒有相機參數，無法投影
            </div>
          )}
      </div>
    </div>
  )
}