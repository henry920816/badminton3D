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

import {
  api,
} from '../api.js'


const BALL_2D_PRELOAD_RADIUS_FRAMES = 300


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


function getImagePointFromPointer({
  event,
  canvas,
  container,
  video,
  cameraParams,
}) {
  if (
    !event
    || !canvas
    || !container
    || !video
  ) {
    return null
  }

  const rectangle = (
    getObjectContainRect(
      container,
      video,
    )
  )
  const canvasRectangle = (
    canvas.getBoundingClientRect()
  )
  const canvasX = (
    event.clientX
    - canvasRectangle.left
  )
  const canvasY = (
    event.clientY
    - canvasRectangle.top
  )

  if (
    canvasX < rectangle.x
    || canvasX
      > rectangle.x
        + rectangle.width
    || canvasY < rectangle.y
    || canvasY
      > rectangle.y
        + rectangle.height
  ) {
    return null
  }

  const imageWidth = (
    cameraParams?.imageWidth
    || video.videoWidth
    || 1920
  )
  const imageHeight = (
    cameraParams?.imageHeight
    || video.videoHeight
    || 1200
  )

  return {
    x: (
      (
        canvasX
        - rectangle.x
      )
      * imageWidth
      / rectangle.width
    ),
    y: (
      (
        canvasY
        - rectangle.y
      )
      * imageHeight
      / rectangle.height
    ),
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
  ball2DMap,
  showBall2D,
  repair2DMode,
  repairObservation,
  repairPreviewPoint,
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

  if (!context) {
    return
  }

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

  const drawPoint = ({
    u,
    v,
    imageWidth,
    imageHeight,
    fillStyle,
    radius,
    strokeStyle = null,
  }) => {
    if (
      !Number.isFinite(Number(u))
      || !Number.isFinite(Number(v))
      || !Number.isFinite(Number(imageWidth))
      || !Number.isFinite(Number(imageHeight))
      || Number(imageWidth) <= 0
      || Number(imageHeight) <= 0
    ) {
      return
    }

    const canvasX = (
      rectangle.x
      + Number(u)
      * rectangle.width
      / Number(imageWidth)
    )
    const canvasY = (
      rectangle.y
      + Number(v)
      * rectangle.height
      / Number(imageHeight)
    )

    context.save()
    context.fillStyle = fillStyle
    context.shadowColor = (
      'rgba(0, 0, 0, 0.85)'
    )
    context.shadowBlur = 4
    context.beginPath()
    context.arc(
      canvasX,
      canvasY,
      radius,
      0,
      Math.PI * 2,
    )
    context.fill()

    if (strokeStyle) {
      context.strokeStyle = strokeStyle
      context.lineWidth = 1.5
      context.stroke()
    }

    context.restore()
  }

  if (
    showProjection
    && cameraParams
  ) {
    const currentPoint = (
      getNearestTrajectoryPoint(
        trajectoryMap,
        currentFrame,
        3,
      )
    )
    const projection = (
      currentPoint
        ? project3DToImage(
            currentPoint,
            cameraParams,
          )
        : null
    )

    if (projection) {
      drawPoint({
        u: projection.u,
        v: projection.v,
        imageWidth: (
          cameraParams.imageWidth
          || video.videoWidth
          || 1920
        ),
        imageHeight: (
          cameraParams.imageHeight
          || video.videoHeight
          || 1200
        ),
        fillStyle: '#ef4444',
        radius: 4,
      })
    }
  }

  const ball2DPoint = (
    ball2DMap?.get(currentFrame)
  )

  if (
    showBall2D
    && Number(ball2DPoint?.visibility) === 1
  ) {
    drawPoint({
      u: ball2DPoint.x,
      v: ball2DPoint.y,
      imageWidth: (
        cameraParams?.imageWidth
        || video.videoWidth
        || 1920
      ),
      imageHeight: (
        cameraParams?.imageHeight
        || video.videoHeight
        || 1200
      ),
      fillStyle: '#22d3ee',
      strokeStyle: '#ecfeff',
      radius: 5,
    })
  }

  if (
    repair2DMode
    && repairObservation
  ) {
    drawPoint({
      u: repairObservation.x,
      v: repairObservation.y,
      imageWidth: (
        cameraParams?.imageWidth
        || video.videoWidth
        || 1920
      ),
      imageHeight: (
        cameraParams?.imageHeight
        || video.videoHeight
        || 1200
      ),
      fillStyle: '#d946ef',
      strokeStyle: '#fae8ff',
      radius: 6,
    })
  }

  if (
    repair2DMode
    && repairPreviewPoint
    && cameraParams
  ) {
    const previewProjection = (
      project3DToImage(
        repairPreviewPoint,
        cameraParams,
      )
    )

    if (previewProjection) {
      drawPoint({
        u: previewProjection.u,
        v: previewProjection.v,
        imageWidth: (
          cameraParams.imageWidth
          || video.videoWidth
          || 1920
        ),
        imageHeight: (
          cameraParams.imageHeight
          || video.videoHeight
          || 1200
        ),
        fillStyle: '#22c55e',
        strokeStyle: '#dcfce7',
        radius: 7,
      })
    }
  }
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

  const ball2DInflightRef = useRef(
    new Set()
  )

  const matchId = useAppStore(
    state => state.matchId
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

  const setCameraHasBall2D = useAppStore(
    state => state.setCameraHasBall2D
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

  const upsertTrajPoints = useAppStore(
    state => state.upsertTrajPoints
  )

  const removeTrajFrames = useAppStore(
    state => state.removeTrajFrames
  )

  const ball2DByCameraFrame = useAppStore(
    state => state.ball2DByCameraFrame
  )

  const upsertBall2DPoints = useAppStore(
    state => state.upsertBall2DPoints
  )

  const removeBall2DPoints = useAppStore(
    state => state.removeBall2DPoints
  )

  const markBall2DRangeLoaded = useAppStore(
    state => state.markBall2DRangeLoaded
  )

  const hasBall2DRangeLoaded = useAppStore(
    state => state.hasBall2DRangeLoaded
  )

  const fps = (
    useAppStore(
      state => state.fps
    )
    || 50
  )

  const durationSec = useAppStore(
    state => state.durationSec
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

  const [
    showBall2D,
    setShowBall2D,
  ] = useState(true)

  const [
    videoReadyIdentity,
    setVideoReadyIdentity,
  ] = useState(null)

  const [
    repair2DMode,
    setRepair2DMode,
  ] = useState(false)

  const [
    repair2DFrame,
    setRepair2DFrame,
  ] = useState(null)

  const [
    repair2DObservations,
    setRepair2DObservations,
  ] = useState({})

  const [
    repair2DPreview,
    setRepair2DPreview,
  ] = useState(null)

  const [
    repair2DStatus,
    setRepair2DStatus,
  ] = useState('idle')

  const [
    repair2DError,
    setRepair2DError,
  ] = useState('')

  const [
    lastRepair2DId,
    setLastRepair2DId,
  ] = useState(null)

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

  const ball2DAvailable = Boolean(
    activeCamera?.has_ball_2d
  )

  const repairCapableCameraCount = (
    safeCameras.filter(
      camera => (
        camera
          ?.projection
          ?.intrinsic
        && camera
          ?.projection
          ?.extrinsic
      ),
    ).length
  )

  const repair2DObservationList = (
    Object.values(
      repair2DObservations
      || {},
    )
  )

  const activeRepair2DObservation = (
    repair2DMode
    && repair2DFrame
      === currentFrame
      ? (
          repair2DObservations[
            Number(
              activeCamera?.index
            )
          ]
          || null
        )
      : null
  )

  const repair2DPreviewPoint = (
    repair2DMode
    && repair2DPreview?.frame
      === currentFrame
      ? (
          repair2DPreview
            ?.trajectory_point
          || null
        )
      : null
  )

  const activeBall2DMap = useMemo(
    () => (
      ball2DByCameraFrame.get(
        Number(activeCamera?.index),
      )
      || null
    ),
    [
      ball2DByCameraFrame,
      activeCamera,
    ],
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

  const activeVideoIdentity = (
    activeCamera?.id
    && activeSource
      ? `${activeCamera.id}|${activeSource}`
      : null
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
      ball2DMap: activeBall2DMap,
      showBall2D: (
        ball2DAvailable
        && showBall2D
      ),
      repair2DMode,
      repairObservation: (
        activeRepair2DObservation
      ),
      repairPreviewPoint: (
        repair2DPreviewPoint
      ),
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
      activeBall2DMap,
      currentFrame,
      showProjection,
      showBall2D,
      ball2DAvailable,
      activeSource,
      repair2DMode,
      activeRepair2DObservation,
      repair2DPreviewPoint,
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
      activeBall2DMap,
      currentFrame,
      showProjection,
      showBall2D,
      ball2DAvailable,
      repair2DMode,
      activeRepair2DObservation,
      repair2DPreviewPoint,
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
      activeBall2DMap,
      currentFrame,
      showProjection,
      showBall2D,
      ball2DAvailable,
      repair2DMode,
      activeRepair2DObservation,
      repair2DPreviewPoint,
    ],
  )

  useEffect(
    () => {
      ball2DInflightRef.current = new Set()

      setRepair2DMode(false)
      setRepair2DFrame(null)
      setRepair2DObservations({})
      setRepair2DPreview(null)
      setRepair2DStatus('idle')
      setRepair2DError('')
      setLastRepair2DId(null)
    },
    [
      matchId,
    ],
  )

  useEffect(
    () => {
      if (
        !repair2DMode
        || lastRepair2DId != null
      ) {
        return
      }

      if (
        repair2DFrame == null
        || repair2DFrame
          !== currentFrame
      ) {
        setRepair2DFrame(
          currentFrame
        )
        setRepair2DObservations({})
        setRepair2DPreview(null)
        setRepair2DStatus('idle')
        setRepair2DError('')
      }
    },
    [
      currentFrame,
      repair2DMode,
      repair2DFrame,
      lastRepair2DId,
    ],
  )

  useEffect(
    () => {
      if (
        repair2DMode
        && playing
      ) {
        setPlaying(false)
      }
    },
    [
      repair2DMode,
      playing,
      setPlaying,
    ],
  )

  useEffect(
    () => {
      if (
        matchId == null
        || !activeVideoIdentity
        || videoReadyIdentity
          !== activeVideoIdentity
        || !activeCamera?.has_ball_2d
        || !Number.isInteger(
          Number(activeCamera.index),
        )
      ) {
        return
      }

      const cameraIndex = Number(
        activeCamera.index,
      )
      const durationFrame = Math.max(
        0,
        Math.round(
          (durationSec || 0)
          * (fps || 0),
        ),
      )
      const start = Math.max(
        0,
        currentFrame
        - BALL_2D_PRELOAD_RADIUS_FRAMES,
      )
      const end = (
        durationFrame > 0
          ? Math.min(
              durationFrame,
              currentFrame
              + BALL_2D_PRELOAD_RADIUS_FRAMES,
            )
          : (
              currentFrame
              + BALL_2D_PRELOAD_RADIUS_FRAMES
            )
      )

      if (
        hasBall2DRangeLoaded(
          cameraIndex,
          currentFrame,
          currentFrame,
        )
      ) {
        return
      }

      const key = (
        `${matchId}-${cameraIndex}-${start}-${end}`
      )

      if (
        ball2DInflightRef.current.has(
          key,
        )
      ) {
        return
      }

      ball2DInflightRef.current.add(
        key,
      )

      ;(async () => {
        try {
          const points = await api.getTraj2D(
            matchId,
            cameraIndex,
            start,
            end,
          )

          if (
            useAppStore.getState().matchId
            !== matchId
          ) {
            return
          }

          upsertBall2DPoints(
            cameraIndex,
            points,
          )

          markBall2DRangeLoaded(
            cameraIndex,
            start,
            end,
          )
        } catch (error) {
          console.error(error)
        } finally {
          ball2DInflightRef.current.delete(
            key,
          )
        }
      })()
    },
    [
      matchId,
      activeVideoIdentity,
      videoReadyIdentity,
      activeCamera,
      currentFrame,
      fps,
      durationSec,
      hasBall2DRangeLoaded,
      upsertBall2DPoints,
      markBall2DRangeLoaded,
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

          if (repair2DMode) {
            setPlaying(false)
          } else {
            togglePlaying()
          }

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
      repair2DMode,
      setPlaying,
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

  const resetRepair2DWork = (
    frame = currentFrame
  ) => {
    setRepair2DFrame(frame)
    setRepair2DObservations({})
    setRepair2DPreview(null)
    setRepair2DStatus('idle')
    setRepair2DError('')
    setLastRepair2DId(null)
  }

  const toggleRepair2DMode = () => {
    if (repair2DMode) {
      setRepair2DMode(false)
      resetRepair2DWork(null)
      return
    }

    if (
      repairCapableCameraCount < 2
    ) {
      return
    }

    setPlaying(false)
    setShowProjection(true)
    setRepair2DMode(true)
    resetRepair2DWork(
      currentFrame
    )
  }

  const handleRepair2DPointerDown = (
    event
  ) => {
    if (
      !repair2DMode
      || lastRepair2DId != null
      || !projectionAvailable
      || !Number.isInteger(
        Number(activeCamera?.index)
      )
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setPlaying(false)

    const point = (
      getImagePointFromPointer({
        event,
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
      })
    )

    if (!point) {
      setRepair2DError(
        '請點在影片畫面範圍內'
      )
      return
    }

    const cameraIndex = Number(
      activeCamera.index
    )

    setRepair2DFrame(
      currentFrame
    )
    setRepair2DObservations(
      previous => ({
        ...previous,

        [cameraIndex]: {
          camera_index: (
            cameraIndex
          ),
          x: point.x,
          y: point.y,
        },
      }),
    )
    setRepair2DPreview(null)
    setRepair2DStatus('idle')
    setRepair2DError('')
  }

  const previewRepair2D = async () => {
    if (
      matchId == null
      || repair2DFrame == null
      || repair2DObservationList.length
        < 2
    ) {
      setRepair2DError(
        '請先在至少兩個不同相機點選羽球'
      )
      return
    }

    setRepair2DStatus('previewing')
    setRepair2DError('')

    try {
      const result = await api.repairTraj2D(
        matchId,
        {
          frame: repair2DFrame,
          observations: (
            repair2DObservationList
          ),
          confirm: false,
        },
      )

      setRepair2DPreview(
        result
      )
      setRepair2DStatus('previewed')
    } catch (error) {
      console.error(error)
      setRepair2DStatus('error')
      setRepair2DError(
        error?.message
        || String(error)
      )
    }
  }

  const confirmRepair2D = async () => {
    if (
      matchId == null
      || repair2DFrame == null
      || !repair2DPreview
      || repair2DObservationList.length
        < 2
    ) {
      setRepair2DError(
        '請先完成 3D 預覽'
      )
      return
    }

    setRepair2DStatus('saving')
    setRepair2DError('')

    try {
      const result = await api.repairTraj2D(
        matchId,
        {
          frame: repair2DFrame,
          observations: (
            repair2DObservationList
          ),
          confirm: true,
        },
      )

      if (result?.trajectory_point) {
        upsertTrajPoints(
          [
            result.trajectory_point,
          ]
        )
      }

      for (
        const point
        of result?.ball_2d_points
          || []
      ) {
        upsertBall2DPoints(
          Number(
            point.camera_index
          ),
          [
            point,
          ],
        )
        setCameraHasBall2D(
          Number(
            point.camera_index
          ),
          true,
        )
      }

      setRepair2DPreview(
        result
      )
      setLastRepair2DId(
        result.repair_id
      )
      setRepair2DStatus('saved')
    } catch (error) {
      console.error(error)
      setRepair2DStatus('error')
      setRepair2DError(
        error?.message
        || String(error)
      )
    }
  }

  const undoRepair2D = async () => {
    if (
      matchId == null
      || lastRepair2DId == null
    ) {
      return
    }

    setRepair2DStatus('undoing')
    setRepair2DError('')

    try {
      const result = (
        await api.undoTraj2DRepair(
          matchId,
          lastRepair2DId,
        )
      )

      if (result?.trajectory_point) {
        upsertTrajPoints(
          [
            result.trajectory_point,
          ]
        )
      } else if (
        result?.trajectory_deleted
      ) {
        removeTrajFrames(
          [
            result.frame,
          ]
        )
      }

      for (
        const point
        of result?.ball_2d_points
          || []
      ) {
        const cameraIndex = Number(
          point.camera_index
        )

        if (point.deleted) {
          removeBall2DPoints(
            cameraIndex,
            [
              point.frame,
            ],
          )
        } else {
          upsertBall2DPoints(
            cameraIndex,
            [
              point,
            ],
          )
        }

        if (
          typeof point.has_ball_2d
          !== 'undefined'
        ) {
          setCameraHasBall2D(
            cameraIndex,
            point.has_ball_2d,
          )
        }
      }

      setLastRepair2DId(null)
      setRepair2DPreview(null)
      setRepair2DObservations({})
      setRepair2DStatus('undone')
    } catch (error) {
      console.error(error)
      setRepair2DStatus('error')
      setRepair2DError(
        error?.message
        || String(error)
      )
    }
  }

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
            ? ' / 3D 投影 ON'
            : ''}

          {ball2DAvailable
            && showBall2D
            ? ' / 2D 標註 ON'
            : ''}

          {repair2DMode
            ? ' / 2D 修復 ON'
            : ''}

          {` / ${safePlaybackRate}x`}
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
              <span className="text-red-400">
                ●
              </span>
              {' 3D→2D'}
            </button>

            <button
              type="button"
              disabled={
                !ball2DAvailable
              }
              onClick={() => {
                setShowBall2D(
                  value => !value
                )
              }}
              className={[
                'px-2 py-1 rounded border text-xs',

                ball2DAvailable
                  ? (
                      showBall2D
                        ? 'bg-cyan-900/80 border-cyan-500 text-cyan-50 hover:bg-cyan-800/80'
                        : 'bg-zinc-900/80 border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                    )
                  : 'bg-zinc-950/80 border-zinc-800 text-zinc-500 cursor-not-allowed',
              ].join(' ')}
              title={
                ball2DAvailable
                  ? '顯示或隱藏上傳的 2D 羽球標註'
                  : '此視角沒有上傳 2D 羽球位置'
              }
            >
              <span className="text-cyan-400">
                ●
              </span>
              {' 2D 標註'}
            </button>

            <button
              type="button"
              disabled={
                repairCapableCameraCount
                < 2
              }
              onClick={
                toggleRepair2DMode
              }
              className={[
                'px-2 py-1 rounded border text-xs',

                repairCapableCameraCount
                  >= 2
                  ? (
                      repair2DMode
                        ? 'bg-fuchsia-900/90 border-fuchsia-500 text-fuchsia-50 hover:bg-fuchsia-800/90'
                        : 'bg-zinc-900/80 border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                    )
                  : 'bg-zinc-950/80 border-zinc-800 text-zinc-500 cursor-not-allowed',
              ].join(' ')}
              title={
                repairCapableCameraCount
                  >= 2
                  ? (
                      '從至少兩個相機點選 2D 羽球位置並重建 3D 點'
                    )
                  : (
                      '至少需要兩個具有 camera params 的視角'
                    )
              }
            >
              <span className="text-fuchsia-400">
                ●
              </span>
              {' 2D 修復'}
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

                const requiresSeek = (
                  Math.abs(
                    video.currentTime
                    - targetTime
                  ) > 0.001
                )

                try {
                  video.currentTime = (
                    targetTime
                  )
                } catch {
                  // Ignore invalid seek.

                  if (activeVideoIdentity) {
                    setVideoReadyIdentity(
                      activeVideoIdentity
                    )
                  }
                }

                if (
                  !requiresSeek
                  && activeVideoIdentity
                ) {
                  setVideoReadyIdentity(
                    activeVideoIdentity
                  )
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
              onSeeked={() => {
                if (activeVideoIdentity) {
                  setVideoReadyIdentity(
                    activeVideoIdentity
                  )
                }
              }}
              preload="auto"
              playsInline
              onClick={
                repair2DMode
                  ? undefined
                  : togglePlaying
              }
            />

            <canvas
              ref={overlayCanvasRef}
              onPointerDown={
                handleRepair2DPointerDown
              }
              className={[
                'absolute inset-0',

                repair2DMode
                && lastRepair2DId == null
                  ? (
                      'pointer-events-auto cursor-crosshair'
                    )
                  : (
                      'pointer-events-none'
                    ),
              ].join(' ')}
            />
          </div>
        )}

        {activeSource
          && repair2DMode
          && (
            <div
              className="
                absolute
                left-3
                bottom-3
                z-30
                w-80
                max-w-[calc(100%_-_1.5rem)]
                rounded
                border
                border-fuchsia-700/80
                bg-zinc-950/95
                p-3
                text-xs
                text-zinc-200
                shadow-2xl
                backdrop-blur
              "
            >
              <div
                className="
                  flex
                  items-center
                  justify-between
                  gap-2
                "
              >
                <div
                  className="
                    font-semibold
                    text-fuchsia-200
                  "
                >
                  2D 多視角修復
                </div>

                <button
                  type="button"
                  onClick={
                    toggleRepair2DMode
                  }
                  className="
                    text-zinc-400
                    hover:text-white
                  "
                  title="關閉 2D 修復"
                >
                  ✕
                </button>
              </div>

              <div
                className="
                  mt-2
                  leading-5
                  text-zinc-400
                "
              >
                Frame
                {' '}
                <span
                  className="
                    text-zinc-100
                    font-semibold
                  "
                >
                  {repair2DFrame
                    ?? currentFrame}
                </span>
                ：在目前影片點選羽球，
                再切換另一個相機點選同一 frame。
              </div>

              <div
                className="
                  mt-2
                  flex
                  flex-wrap
                  gap-1
                "
              >
                {repair2DObservationList.length
                  === 0
                  ? (
                      <span
                        className="
                          text-zinc-500
                        "
                      >
                        尚未選取 2D 點
                      </span>
                    )
                  : (
                      [
                        ...repair2DObservationList,
                      ]
                        .sort(
                          (
                            first,
                            second,
                          ) => (
                            first.camera_index
                            - second.camera_index
                          ),
                        )
                        .map(
                          observation => (
                            <span
                              key={
                                observation
                                  .camera_index
                              }
                              className="
                                rounded
                                border
                                border-fuchsia-700
                                bg-fuchsia-950/70
                                px-2
                                py-0.5
                                text-fuchsia-100
                              "
                            >
                              Cam
                              {' '}
                              {
                                observation
                                  .camera_index
                              }
                              {' '}
                              ✓
                            </span>
                          ),
                        )
                    )}
              </div>

              <div
                className="
                  mt-2
                  flex
                  items-center
                  gap-3
                  text-[11px]
                  text-zinc-400
                "
              >
                <span>
                  <span
                    className="
                      text-fuchsia-400
                    "
                  >
                    ●
                  </span>
                  {' 點選位置'}
                </span>

                <span>
                  <span
                    className="
                      text-green-400
                    "
                  >
                    ●
                  </span>
                  {' 預覽投影'}
                </span>
              </div>

              {repair2DPreview
                && (
                  <div
                    className="
                      mt-2
                      rounded
                      border
                      border-emerald-900
                      bg-emerald-950/30
                      p-2
                      leading-5
                    "
                  >
                    <div
                      className="
                        text-emerald-200
                        font-semibold
                      "
                    >
                      3D 預覽
                      {repair2DPreview
                        .confirmed
                        ? '（已儲存）'
                        : '（尚未寫入）'}
                    </div>

                    <div
                      className="
                        text-zinc-300
                      "
                    >
                      X
                      {' '}
                      {Number(
                        repair2DPreview
                          ?.trajectory_point
                          ?.x,
                      ).toFixed(4)}
                      {' / Y '}
                      {Number(
                        repair2DPreview
                          ?.trajectory_point
                          ?.y,
                      ).toFixed(4)}
                      {' / Z '}
                      {Number(
                        repair2DPreview
                          ?.trajectory_point
                          ?.z,
                      ).toFixed(4)}
                    </div>

                    <div
                      className="
                        text-zinc-400
                      "
                    >
                      RMS
                      {' '}
                      {Number(
                        repair2DPreview
                          ?.rms_error,
                      ).toFixed(2)}
                      {' px / Max '}
                      {Number(
                        repair2DPreview
                          ?.max_error,
                      ).toFixed(2)}
                      {' px'}
                    </div>

                    {(repair2DPreview
                      ?.warnings
                      || [])
                      .map(
                        warning => (
                          <div
                            key={warning}
                            className="
                              text-amber-300
                            "
                          >
                            {warning}
                          </div>
                        ),
                      )}
                  </div>
                )}

              {repair2DError
                && (
                  <div
                    className="
                      mt-2
                      break-words
                      text-red-300
                    "
                  >
                    {repair2DError}
                  </div>
                )}

              <div
                className="
                  mt-3
                  flex
                  flex-wrap
                  gap-2
                "
              >
                {lastRepair2DId == null
                  ? (
                      <>
                        <button
                          type="button"
                          onClick={
                            previewRepair2D
                          }
                          disabled={
                            repair2DObservationList
                              .length < 2
                            || repair2DStatus
                              === 'previewing'
                            || repair2DStatus
                              === 'saving'
                          }
                          className="
                            rounded
                            bg-sky-700
                            px-2.5
                            py-1
                            text-white
                            hover:bg-sky-600
                            disabled:cursor-not-allowed
                            disabled:opacity-40
                          "
                        >
                          {repair2DStatus
                            === 'previewing'
                            ? '計算中...'
                            : '預覽 3D'}
                        </button>

                        <button
                          type="button"
                          onClick={
                            confirmRepair2D
                          }
                          disabled={
                            !repair2DPreview
                            || repair2DStatus
                              === 'saving'
                            || repair2DStatus
                              === 'previewing'
                          }
                          className="
                            rounded
                            bg-emerald-700
                            px-2.5
                            py-1
                            text-white
                            hover:bg-emerald-600
                            disabled:cursor-not-allowed
                            disabled:opacity-40
                          "
                        >
                          {repair2DStatus
                            === 'saving'
                            ? '儲存中...'
                            : '確認寫入'}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            resetRepair2DWork(
                              currentFrame
                            )
                          }}
                          disabled={
                            repair2DStatus
                              === 'saving'
                            || repair2DStatus
                              === 'previewing'
                          }
                          className="
                            rounded
                            border
                            border-zinc-700
                            bg-zinc-900
                            px-2.5
                            py-1
                            text-zinc-300
                            hover:bg-zinc-800
                            disabled:opacity-40
                          "
                        >
                          清除點選
                        </button>
                      </>
                    )
                  : (
                      <>
                        <button
                          type="button"
                          onClick={
                            undoRepair2D
                          }
                          disabled={
                            repair2DStatus
                            === 'undoing'
                          }
                          className="
                            rounded
                            bg-amber-700
                            px-2.5
                            py-1
                            text-white
                            hover:bg-amber-600
                            disabled:opacity-40
                          "
                        >
                          {repair2DStatus
                            === 'undoing'
                            ? '復原中...'
                            : '復原此次修復'}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            resetRepair2DWork(
                              currentFrame
                            )
                          }}
                          className="
                            rounded
                            border
                            border-zinc-700
                            bg-zinc-900
                            px-2.5
                            py-1
                            text-zinc-200
                            hover:bg-zinc-800
                          "
                        >
                          修下一點
                        </button>
                      </>
                    )}
              </div>
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
