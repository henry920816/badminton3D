import React, {
  useCallback,
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

import {
  useDisplayTrajectoryLookup,
  useRallyBallData,
  useRallyFrameRange,
} from '../utils/useRallyBallData.js'
import {
  RECONSTRUCTION_AGREEMENT_PX,
  useBall2DRangeLabels,
  useBall2DVisibleRows,
} from '../utils/usePairwiseBallPoints.js'

import Ball2DCorrectionPanel from './Ball2DCorrectionPanel.jsx'
import Magnifier from './Magnifier.jsx'
import {
  computeEpipolarGuide,
  evaluateGuideError,
} from '../utils/epipolarGuide.js'


// 後端 get_traj2d 的 end 預設值，代表「這台相機全部」
const ALL_FRAMES = 999999999


// 影片右上角的圖層 / 模式按鈕：底色一律中性，顏色只留在圓點上，
// 圓點的顏色就是那個圖層畫在影片上的顏色，當圖例用
function overlayButtonClass(available, active) {
  return [
    'px-2 py-1 rounded border text-xs flex items-center gap-1.5',
    available
      ? (
          active
            ? 'bg-zinc-700/90 border-zinc-400 text-white hover:bg-zinc-600/90'
            : 'bg-zinc-900/80 border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
        )
      : 'bg-zinc-950/80 border-zinc-800 text-zinc-600 cursor-not-allowed',
  ].join(' ')
}


function OverlayDot({ color, active }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${active ? '' : 'opacity-30'}`}
      style={{ backgroundColor: color }}
    />
  )
}


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
  racketTips,
  showRacketTip,
  handPoints,
  showHands,
  correctionOverlay,
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
    // 給了就以影像像素為單位（跟著畫面縮放），否則 radius 是畫布像素
    imageRadius = null,
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
      imageRadius != null
        ? Math.max(3, imageRadius * rectangle.width / Number(imageWidth))
        : radius,
      0,
      Math.PI * 2,
    )
    context.fill()

    if (strokeStyle) {
      context.strokeStyle = strokeStyle
      context.lineWidth = 2
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

  const drawProjectedPoints = (
    points,
    fillStyle,
  ) => {
    for (
      const point
      of points
    ) {
      const projection = (
        project3DToImage(
          point,
          cameraParams,
        )
      )

      if (!projection) {
        continue
      }

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
        fillStyle,
        radius: 4,
      })
    }
  }

  if (
    showHands
    && cameraParams
  ) {
    drawProjectedPoints(
      handPoints,
      '#facc15',
    )
  }

  if (
    showRacketTip
    && cameraParams
  ) {
    drawProjectedPoints(
      racketTips,
      '#f97316',
    )
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
      // 半徑是兩兩重建「同意」的門檻：3D→2D 的紅點落在圈裡，這台就算同意
      fillStyle: '#22d3ee00',
      strokeStyle: '#22d3ee',
      radius: 5,
      imageRadius: RECONSTRUCTION_AGREEMENT_PX,
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
      // 空心，才看得到底下的羽球
      fillStyle: 'rgba(0, 0, 0, 0)',
      strokeStyle: '#d946ef',
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

  // 2D 標註修正：琥珀色圈是修正後的位置（空心，才看得到底下的羽球）
  if (correctionOverlay) {
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
    const {
      original,
      correction,
      guide,
    } = correctionOverlay

    // 參考視角導引：極線細白線，線上標相機編號。畫在修正的圈圈底下
    if (guide) {
      const toCanvas = point => ({
        x: rectangle.x + point.u * rectangle.width / imageWidth,
        y: rectangle.y + point.v * rectangle.height / imageHeight,
      })

      context.save()
      context.lineWidth = 1
      context.strokeStyle = 'rgba(255, 255, 255, 0.55)'

      for (const { points } of guide.lines) {
        context.beginPath()
        points.forEach((point, index) => {
          const { x, y } = toCanvas(point)
          if (index === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        })
        context.stroke()
      }

      // 編號放在離羽球遠的那一端（交會處附近擠不下），和已經放好的
      // 編號太近就沿著線往內挪
      const anchorPoint = (
        guide.minimum
        || (Number(correction?.visibility) === 1 ? { u: correction.x, v: correction.y } : null)
        || (Number(original?.visibility) === 1 ? { u: original.x, v: original.y } : null)
      )
      const labelled = new Set()
      const placed = []
      const LABEL_MIN_GAP = 18

      context.font = '600 11px ui-monospace, SFMono-Regular, Consolas, monospace'
      context.textAlign = 'center'
      context.textBaseline = 'middle'

      for (const { cameraIndex, points } of guide.lines) {
        // 斷成好幾段的極線只標一次
        if (labelled.has(cameraIndex)) continue
        labelled.add(cameraIndex)

        const ordered = (
          anchorPoint
          && Math.hypot(points[0].u - anchorPoint.u, points[0].v - anchorPoint.v)
            < Math.hypot(points.at(-1).u - anchorPoint.u, points.at(-1).v - anchorPoint.v)
            ? [...points].reverse()
            : points
        )

        let position = null

        for (let step = 0; step < 10; step += 1) {
          const candidate = toCanvas(ordered[Math.floor((ordered.length - 1) * step * 0.05)])
          const x = Math.min(rectangle.x + rectangle.width - 10, Math.max(rectangle.x + 10, candidate.x))
          const y = Math.min(rectangle.y + rectangle.height - 10, Math.max(rectangle.y + 10, candidate.y))
          position = { x, y }
          if (placed.every(other => Math.hypot(other.x - x, other.y - y) >= LABEL_MIN_GAP)) break
        }

        placed.push(position)

        const text = String(cameraIndex)
        const width = context.measureText(text).width + 8

        context.fillStyle = 'rgba(0, 0, 0, 0.7)'
        context.beginPath()
        context.roundRect(position.x - width / 2, position.y - 7, width, 14, 3)
        context.fill()
        context.fillStyle = 'rgba(255, 255, 255, 0.95)'
        context.fillText(text, position.x, position.y + 0.5)
      }

      context.restore()
    }

    if (Number(correction?.visibility) === 1) {
      drawPoint({
        u: correction.x,
        v: correction.y,
        imageWidth,
        imageHeight,
        fillStyle: 'rgba(0, 0, 0, 0)',
        strokeStyle: '#f59e0b',
        radius: 5,
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

  // 和 3D 場景同一份擊球結果（兩兩重建點有快取，不會多打一次後端）
  const {
    contacts: ballContacts,
    startFrame: rallyStartFrame,
    endFrame: rallyEndFrame,
  } = useRallyBallData()

  // 這個 rally 每一格哪些相機有 2D 標註，相機按鈕用來上色
  const ball2DVisible = useBall2DVisibleRows(
    matchId,
    rallyStartFrame,
    rallyEndFrame,
  )

  const camerasWith2DByFrame = useMemo(
    () => {
      const byFrame = new Map()

      for (const row of ball2DVisible.points || []) {
        if (!byFrame.has(row.frame)) byFrame.set(row.frame, new Set())
        byFrame.get(row.frame).add(Number(row.camera_index))
      }

      return byFrame
    },
    [
      ball2DVisible.points,
    ],
  )

  // 這一格是不是某次擊球「球速或方向改變前的最後一個點」，
  // 也就是球拍拍面中心要對準的那一格
  const isLastFrameBeforeHit = useMemo(
    () => ballContacts.some(
      contact => contact.lastFrameBefore === currentFrame,
    ),
    [ballContacts, currentFrame],
  )

  const setCurrentFrame = useAppStore(
    state => state.setCurrentFrame
  )

  const setCurrentTime = useAppStore(
    state => state.setCurrentTime
  )

  // 3D→2D 投影的球和 3D 場景畫同一份（可能是純 2D 補點、平滑過的軌跡）
  const trajectoryMap = useDisplayTrajectoryLookup()

  const upsertTrajPoints = useAppStore(
    state => state.upsertTrajPoints
  )

  const removeTrajFrames = useAppStore(
    state => state.removeTrajFrames
  )

  const ball2DSource = useAppStore(
    state => state.ball2DSource
  )

  const ball2DByCameraFrame = useAppStore(
    state => state.ball2DByCameraFrame
  )

  const playerKeypointsByPlayer = useAppStore(
    state => state.playerKeypointsByPlayer
  )

  const upsertBall2DPoints = useAppStore(
    state => state.upsertBall2DPoints
  )

  const removeBall2DPoints = useAppStore(
    state => state.removeBall2DPoints
  )

  const markBall2DCameraLoaded = useAppStore(
    state => state.markBall2DCameraLoaded
  )

  const hasBall2DCameraLoaded = useAppStore(
    state => state.hasBall2DCameraLoaded
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

  // 拍頂、手掌的投影預設關掉，需要時再從工具列打開
  const [
    showRacketTip,
    setShowRacketTip,
  ] = useState(false)

  const [
    showHands,
    setShowHands,
  ] = useState(false)

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

  const {
    racketTips,
    handPoints,
  } = useMemo(
    () => {
      const keypoints = Object.values(
        playerKeypointsByPlayer
        || {},
      )

      return {
        racketTips: keypoints
          .map(item => item.racketTip)
          .filter(Boolean),

        handPoints: keypoints
          .flatMap(item => item.hands || []),
      }
    },
    [
      playerKeypointsByPlayer,
    ],
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

  // 2D 標註修正：修正存在獨立的表，原始資料不會被改動
  const [
    correction2DMode,
    setCorrection2DMode,
  ] = useState(false)

  const [
    correction2DSaving,
    setCorrection2DSaving,
  ] = useState(false)

  const [
    correction2DError,
    setCorrection2DError,
  ] = useState('')

  const [
    correction2DAdvance,
    setCorrection2DAdvance,
  ] = useState(false)

  const ball2DCorrections = useAppStore(
    state => state.ball2DCorrections
  )

  const activeCorrectionMap = useMemo(
    () => (
      ball2DCorrections.get(
        Number(activeCamera?.index),
      )
      || null
    ),
    [
      ball2DCorrections,
      activeCamera,
    ],
  )

  const activeCorrection = (
    activeCorrectionMap?.get(currentFrame)
    || null
  )

  // 這格的原始標註：有修正時取修正紀錄附的原始值；沒有修正時，
  // 畫面上的 2D 點不論來源都等於原始值
  const activeOriginal2D = (
    activeCorrection
      ? activeCorrection.original
      : activeBall2DMap?.get(currentFrame) || null
  )

  // 2D 修正的參考視角：其他相機在這格有標註就預設拿來畫極線，
  // 使用者覺得哪台標錯就點掉（存的是排除的相機編號）
  const [
    correction2DExcludedIndices,
    setCorrection2DExcludedIndices,
  ] = useState([])

  const toggleCorrection2DReference = cameraIndex => {
    setCorrection2DExcludedIndices(
      previous => (
        previous.includes(cameraIndex)
          ? previous.filter(index => index !== cameraIndex)
          : [...previous, cameraIndex]
      ),
    )
  }

  // 這段 rally 所有相機的標註（時間軸的標註一致軌道也用同一份快取）
  const {
    startFrame: correctionRangeStart,
    endFrame: correctionRangeEnd,
  } = useRallyFrameRange()

  const correctionRangeLabels = useBall2DRangeLabels(
    correction2DMode ? matchId : null,
    correctionRangeStart,
    correctionRangeEnd,
  )

  // 這份只留看得見的標註、沒有 visibility 欄位，補上才和其他來源一致
  const correctionRangeLabelByKey = useMemo(
    () => new Map(
      (correctionRangeLabels.points || []).map(point => [
        `${point.frame}:${Number(point.camera_index)}`,
        { ...point, visibility: 1 },
      ]),
    ),
    [
      correctionRangeLabels.points,
    ],
  )

  // 每台相機在這格能不能當參考：參考點是那台的修正值，沒修正就用原始標註
  const correction2DReferenceOptions = useMemo(
    () => {
      if (!correction2DMode) return []

      const activeIndex = Number(activeCamera?.index)

      return safeCameras
        .filter(camera => (
          Number.isInteger(Number(camera.index))
          && Number(camera.index) !== activeIndex
          && camera.has_ball_2d
        ))
        .map(camera => {
          const cameraIndex = Number(camera.index)
          const selected = !correction2DExcludedIndices.includes(cameraIndex)
          const params = camera.projection
          const correction = ball2DCorrections.get(cameraIndex)?.get(currentFrame) || null
          const point = (
            correction
            || correctionRangeLabelByKey.get(`${currentFrame}:${cameraIndex}`)
            || ball2DByCameraFrame.get(cameraIndex)?.get(currentFrame)
            || null
          )

          let status = 'ok'

          if (!params?.intrinsic || !params?.extrinsic) status = 'noParams'
          else if (!point && correctionRangeLabels.status === 'loading') status = 'loading'
          else if (!point) status = 'none'
          else if (Number(point.visibility) !== 1) status = 'hidden'

          return {
            cameraIndex,
            label: camera.label || camera.id,
            selected,
            status,
            corrected: Boolean(correction),
            reference: (
              status === 'ok'
                ? { cameraIndex, params, u: Number(point.x), v: Number(point.y) }
                : null
            ),
          }
        })
    },
    [
      correction2DMode,
      activeCamera,
      safeCameras,
      correction2DExcludedIndices,
      ball2DCorrections,
      correctionRangeLabelByKey,
      correctionRangeLabels.status,
      ball2DByCameraFrame,
      currentFrame,
    ],
  )

  // 參考點優先用修正值，所以每台相機的修正都要載入
  useEffect(
    () => {
      if (
        !correction2DMode
        || matchId == null
      ) {
        return undefined
      }

      let cancelled = false

      for (const camera of safeCameras) {
        const cameraIndex = Number(camera.index)

        if (
          !camera.has_ball_2d
          || !Number.isInteger(cameraIndex)
          || useAppStore.getState().ball2DCorrections.has(cameraIndex)
        ) {
          continue
        }

        api.getBall2DCorrections(matchId, cameraIndex)
          .then(list => {
            if (!cancelled) {
              useAppStore.getState().setBall2DCorrections(cameraIndex, list)
            }
          })
          .catch(error => {
            if (!cancelled) setCorrection2DError(error?.message || String(error))
          })
      }

      return () => {
        cancelled = true
      }
    },
    [
      correction2DMode,
      matchId,
      safeCameras,
    ],
  )

  const correction2DReferences = useMemo(
    () => (
      correction2DReferenceOptions
        .filter(option => option.selected && option.reference)
        .map(option => option.reference)
    ),
    [
      correction2DReferenceOptions,
    ],
  )

  const correction2DGuide = useMemo(
    () => (
      correction2DMode
      && projectionAvailable
      && correction2DReferences.length > 0
        ? computeEpipolarGuide({
            targetParams: activeCameraParams,
            references: correction2DReferences,
          })
        : null
    ),
    [
      correction2DMode,
      projectionAvailable,
      activeCameraParams,
      correction2DReferences,
    ],
  )

  // 修正點和參考視角一起三角化的誤差，讓使用者點完馬上知道和參考合不合
  const correction2DGuideSummary = useMemo(
    () => {
      if (!correction2DGuide) return null

      return {
        referenceCount: correction2DGuide.references.length,
        minimumError: correction2DGuide.minimum?.error ?? null,
        correctionError: (
          Number(activeCorrection?.visibility) === 1
            ? evaluateGuideError(
                activeCameraParams,
                correction2DGuide.references,
                Number(activeCorrection.x),
                Number(activeCorrection.y),
              ).error
            : null
        ),
      }
    },
    [
      correction2DGuide,
      activeCorrection,
      activeCameraParams,
    ],
  )

  const correctionOverlay = useMemo(
    () => (
      correction2DMode
        ? {
            original: activeOriginal2D,
            correction: activeCorrection,
            guide: correction2DGuide,
          }
        : null
    ),
    [
      correction2DMode,
      activeOriginal2D,
      activeCorrection,
      correction2DGuide,
    ],
  )

  useEffect(
    () => {
      if (
        !correction2DMode
        || matchId == null
        || !Number.isInteger(
          Number(activeCamera?.index),
        )
      ) {
        return undefined
      }

      const cameraIndex = Number(
        activeCamera.index,
      )

      // 存檔 / 清除時 store 已同步更新，換資料集時會清空；
      // 讀過的相機不用每次打開修正模式都重抓
      if (
        useAppStore.getState().ball2DCorrections.has(
          cameraIndex,
        )
      ) {
        return undefined
      }

      let cancelled = false

      api.getBall2DCorrections(
        matchId,
        cameraIndex,
      )
        .then(list => {
          if (!cancelled) {
            useAppStore.getState().setBall2DCorrections(
              cameraIndex,
              list,
            )
          }
        })
        .catch(error => {
          if (!cancelled) {
            setCorrection2DError(
              error?.message
              || String(error)
            )
          }
        })

      return () => {
        cancelled = true
      }
    },
    [
      correction2DMode,
      matchId,
      activeCamera?.index,
    ],
  )

  // 讀的是修正後資料時，畫面上的 2D 點立刻換掉，兩兩重建與品質檢查
  // 只重算這一格（整個 rally 重算要好幾秒）
  const applyCorrectionToView = (
    cameraIndex,
    frame,
    point,
  ) => {
    const state = useAppStore.getState()

    if (state.ball2DSource !== 'corrected') return

    if (point) {
      state.upsertBall2DPoints(
        cameraIndex,
        [
          {
            camera_index: cameraIndex,
            frame,
            ...point,
          },
        ],
      )
    } else {
      state.removeBall2DPoints(
        cameraIndex,
        [frame],
      )
    }

    state.notifyBall2DCorrected(frame)
  }

  const saveCorrection2D = async payload => {
    if (matchId == null) return

    setCorrection2DSaving(true)
    setCorrection2DError('')

    try {
      const result = await api.saveBall2DCorrection(
        matchId,
        payload,
      )

      if (useAppStore.getState().matchId !== matchId) return

      useAppStore.getState().upsertBall2DCorrection(
        result
      )
      applyCorrectionToView(
        result.camera_index,
        result.frame,
        {
          visibility: result.visibility,
          x: result.x,
          y: result.y,
          corrected: true,
        },
      )

      if (correction2DAdvance) {
        setCurrentFrame(
          payload.frame + 1
        )
      }
    } catch (error) {
      console.error(error)
      setCorrection2DError(
        error?.message
        || String(error)
      )
    } finally {
      setCorrection2DSaving(false)
    }
  }

  const markCorrection2DHidden = () => {
    if (
      !Number.isInteger(
        Number(activeCamera?.index),
      )
    ) {
      return
    }

    saveCorrection2D({
      camera_index: Number(activeCamera.index),
      frame: currentFrame,
      visibility: 0,
      x: 0,
      y: 0,
    })
  }

  const clearCorrection2D = async () => {
    if (
      matchId == null
      || !activeCorrection
    ) {
      return
    }

    setCorrection2DSaving(true)
    setCorrection2DError('')

    try {
      const result = await api.deleteBall2DCorrection(
        matchId,
        activeCorrection.camera_index,
        activeCorrection.frame,
      )

      if (useAppStore.getState().matchId !== matchId) return

      useAppStore.getState().removeBall2DCorrection(
        result.camera_index,
        result.frame,
      )
      applyCorrectionToView(
        result.camera_index,
        result.frame,
        result.original
          ? {
              ...result.original,
              corrected: false,
            }
          : null,
      )
    } catch (error) {
      console.error(error)
      setCorrection2DError(
        error?.message
        || String(error)
      )
    } finally {
      setCorrection2DSaving(false)
    }
  }

  const handleCorrection2DPointerDown = event => {
    if (
      !correction2DMode
      || correction2DSaving
      || !Number.isInteger(
        Number(activeCamera?.index),
      )
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setPlaying(false)

    const point = getImagePointFromPointer({
      event,
      canvas: overlayCanvasRef.current,
      container: videoWrapRef.current,
      video: videoRef.current,
      cameraParams: activeCameraParams,
    })

    if (!point) {
      setCorrection2DError(
        '請點在影片畫面範圍內'
      )
      return
    }

    saveCorrection2D({
      camera_index: Number(activeCamera.index),
      frame: currentFrame,
      visibility: 1,
      x: point.x,
      y: point.y,
    })
  }

  const toggleCorrection2DMode = () => {
    if (correction2DMode) {
      setCorrection2DMode(false)
      setCorrection2DExcludedIndices([])
      return
    }

    if (repair2DMode) {
      setRepair2DMode(false)
      resetRepair2DWork(null)
    }

    setPlaying(false)
    setCorrection2DError('')
    setCorrection2DMode(true)
  }

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

  // 影片內容（object-contain 之後）在 videoWrap 裡的範圍，放大鏡用
  const getVideoContentRect = useCallback(
    () => (
      videoWrapRef.current && videoRef.current
        ? getObjectContainRect(videoWrapRef.current, videoRef.current)
        : null
    ),
    [],
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
      racketTips,
      showRacketTip,
      handPoints,
      showHands,
      correctionOverlay,
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
      racketTips,
      showRacketTip,
      handPoints,
      showHands,
      correctionOverlay,
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
      racketTips,
      showRacketTip,
      handPoints,
      showHands,
      correctionOverlay,
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
      racketTips,
      showRacketTip,
      handPoints,
      showHands,
      correctionOverlay,
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

      setCorrection2DMode(false)
      setCorrection2DError('')
      setCorrection2DExcludedIndices([])
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

  // 整台相機的 2D 球點一次抓完
  const loadBall2DCamera = cameraIndex => {
    if (
      hasBall2DCameraLoaded(
        cameraIndex,
      )
    ) {
      return
    }

    // 同一台相機、同一個 2D 來源只發一次；換來源後舊的請求不擋新的
    const inflightKey = `${cameraIndex}:${ball2DSource}`

    if (
      ball2DInflightRef.current.has(
        inflightKey,
      )
    ) {
      return
    }

    ball2DInflightRef.current.add(
      inflightKey,
    )

    /*
     * 切換相機時把這台的 2D 球點一次抓完，
     * 不隨播放位置做滑動視窗。
     *
     * 實測單台約 1.6MB / 0.9s，和開場就一次載完的
     * 3D 軌跡（2.8MB）同一個量級。原本的 ±300 格視窗
     * 是以 `${matchId}-${cameraIndex}-${start}-${end}` 去重，
     * 但 start/end 隨播放每格都在變，去重從來沒生效過：
     * 回應還沒回來就已經每一格再發一次請求。
     */
    ;(async () => {
      try {
        const points = await api.getTraj2D(
          matchId,
          cameraIndex,
          0,
          ALL_FRAMES,
          ball2DSource,
        )

        // 等待期間換了資料集或 2D 來源，這批已經作廢
        if (
          useAppStore.getState().matchId
          !== matchId
          || useAppStore.getState().ball2DSource
          !== ball2DSource
        ) {
          return
        }

        upsertBall2DPoints(
          cameraIndex,
          points,
        )

        markBall2DCameraLoaded(
          cameraIndex,
        )
      } catch (error) {
        console.error(error)
      } finally {
        ball2DInflightRef.current.delete(
          inflightKey,
        )
      }
    })()
  }

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

      loadBall2DCamera(
        Number(activeCamera.index),
      )
    },
    [
      matchId,
      activeVideoIdentity,
      videoReadyIdentity,
      activeCamera,
      hasBall2DCameraLoaded,
      upsertBall2DPoints,
      markBall2DCameraLoaded,
      ball2DSource,
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

        if (
          !useAppStore.getState().playing
        ) {
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

          return
        }

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

    if (
      !useAppStore.getState().playing
    ) {
      return
    }

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
    setCorrection2DMode(false)
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
      if (result?.ball_2d_points?.length) {
        useAppStore.getState().invalidatePairwisePoints()
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
      if (result?.ball_2d_points?.length) {
        useAppStore.getState().invalidatePairwisePoints()
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

              // 目前這格這台相機有看得見的 2D 標註；播放中每格都在變，
              // 只在停下來時標示。有 2D 修正就照修正（標成看不見就不算），
              // 2D 來源是原始資料時修正不會反映在 camerasWith2DByFrame 裡
              const frameCorrection = (
                ball2DCorrections
                  .get(Number(camera.index))
                  ?.get(currentFrame)
              )
              const has2DAtFrame = (
                !playing
                && (
                  frameCorrection
                    ? Number(frameCorrection.visibility) === 1
                    : Boolean(
                        camerasWith2DByFrame
                          .get(currentFrame)
                          ?.has(Number(camera.index))
                      )
                )
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
                      ? 'bg-sky-700 text-white'
                      : hasVideo
                        ? 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
                        : 'bg-zinc-950 text-zinc-500 hover:bg-zinc-900',

                    // 選中的相機平常邊框和底色同色，藍框才看得出是 2D 標註
                    has2DAtFrame
                      ? 'border-blue-400'
                      : isActive
                        ? 'border-sky-700'
                        : hasVideo
                          ? 'border-zinc-700'
                          : 'border-zinc-800',
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

                    has2DAtFrame
                      ? '這格有 2D 標註'
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
        {activeSource && (
          <div
            className="
              absolute
              top-2
              right-2
              z-20
              flex
              flex-col
              items-end
              gap-3
            "
          >
            {/* 顯示在影片上的圖層 */}
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                disabled={!projectionAvailable}
                onClick={() => setShowProjection(value => !value)}
                className={overlayButtonClass(projectionAvailable, showProjection)}
                title={
                  projectionAvailable
                    ? '顯示或隱藏 3D 球點投影，和 3D 場景用同一份軌跡（純 2D 或 ball_traj）'
                    : '此視角沒有 camera params'
                }
              >
                <OverlayDot color="#ef4444" active={projectionAvailable && showProjection} />
                3D→2D
              </button>

              <button
                type="button"
                disabled={!ball2DAvailable}
                onClick={() => setShowBall2D(value => !value)}
                className={overlayButtonClass(ball2DAvailable, showBall2D)}
                title={
                  ball2DAvailable
                    ? '顯示或隱藏上傳的 2D 羽球標註'
                    : '此視角沒有上傳 2D 羽球位置'
                }
              >
                <OverlayDot color="#22d3ee" active={ball2DAvailable && showBall2D} />
                2D 標註
              </button>

              <button
                type="button"
                disabled={!projectionAvailable}
                onClick={() => setShowRacketTip(value => !value)}
                className={overlayButtonClass(projectionAvailable, showRacketTip)}
                title={
                  projectionAvailable
                    ? '顯示或隱藏 3D 球拍拍頂的投影'
                    : '此視角沒有 camera params'
                }
              >
                <OverlayDot color="#f97316" active={projectionAvailable && showRacketTip} />
                拍頂
              </button>

              <button
                type="button"
                disabled={!projectionAvailable}
                onClick={() => setShowHands(value => !value)}
                className={overlayButtonClass(projectionAvailable, showHands)}
                title={
                  projectionAvailable
                    ? '顯示或隱藏 SMPL 雙手掌心的投影'
                    : '此視角沒有 camera params'
                }
              >
                <OverlayDot color="#facc15" active={projectionAvailable && showHands} />
                手掌
              </button>

            </div>

            {/* 在影片上點選的編輯模式 */}
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                disabled={repairCapableCameraCount < 2}
                onClick={toggleRepair2DMode}
                className={overlayButtonClass(repairCapableCameraCount >= 2, repair2DMode)}
                title={
                  repairCapableCameraCount >= 2
                    ? '從至少兩個相機點選 2D 羽球位置並重建 3D 點'
                    : '至少需要兩個具有 camera params 的視角'
                }
              >
                <OverlayDot color="#d946ef" active={repair2DMode} />
                2D 修復
              </button>

              <button
                type="button"
                disabled={matchId == null}
                onClick={toggleCorrection2DMode}
                className={overlayButtonClass(matchId != null, correction2DMode)}
                title="在影片上逐格修正這台相機的 2D 羽球標註；修正另外存放，不會改動原始資料"
              >
                <OverlayDot color="#f59e0b" active={correction2DMode} />
                2D 修正
              </button>
            </div>
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
                    useAppStore.getState().currentFrame,
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

                if (useAppStore.getState().playing) {
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
                || correction2DMode
                  ? undefined
                  : togglePlaying
              }
            />

            <canvas
              ref={overlayCanvasRef}
              onPointerDown={
                correction2DMode
                  ? handleCorrection2DPointerDown
                  : handleRepair2DPointerDown
              }
              className={[
                'absolute inset-0',

                (
                  repair2DMode
                  && lastRepair2DId == null
                )
                || correction2DMode
                  ? (
                      'pointer-events-auto cursor-crosshair'
                    )
                  : (
                      'pointer-events-none'
                    ),
              ].join(' ')}
            />

            <Magnifier
              active={correction2DMode}
              videoRef={videoRef}
              overlayCanvasRef={overlayCanvasRef}
              containerRef={videoWrapRef}
              getContentRect={getVideoContentRect}
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

      {/* 放在影片區下方，不疊在影片上 */}
      {correction2DMode
        && (
          <Ball2DCorrectionPanel
            frame={currentFrame}
            original={activeOriginal2D}
            correction={activeCorrection}
            source={ball2DSource}
            canClick={Boolean(activeSource)}
            saving={correction2DSaving}
            error={correction2DError}
            advance={correction2DAdvance}
            onAdvanceChange={setCorrection2DAdvance}
            correctionCount={activeCorrectionMap?.size || 0}
            onMarkHidden={markCorrection2DHidden}
            onClear={clearCorrection2D}
            onClose={toggleCorrection2DMode}
            referenceOptions={correction2DReferenceOptions}
            onToggleReference={toggleCorrection2DReference}
            guideSummary={correction2DGuideSummary}
          />
        )}
    </div>
  )
}
