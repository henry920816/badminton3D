// 影片上的疊圖：3D→2D 投影的球、2D 標註、修復與修正模式的標記

import {
  project3DToImage,
} from './cameraProjection.js'
import {
  RECONSTRUCTION_AGREEMENT_PX,
} from './usePairwiseBallPoints.js'


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


export function getObjectContainRect(
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


export function getImagePointFromPointer({
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



export function drawProjectionOverlay({
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

  // 重設 width/height 會重新配置整塊畫布，只在大小真的變了才做；
  // 下面本來就會 clearRect
  const pixelWidth = Math.max(1, Math.round(rectangle.boxWidth * pixelRatio))
  const pixelHeight = Math.max(1, Math.round(rectangle.boxHeight * pixelRatio))

  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight

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
