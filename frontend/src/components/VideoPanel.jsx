import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store.js'
import { API_BASE } from '../config.js'
import {
  getProjectionParams,
  hasProjectionParams,
  project3DToImage,
  projectTrajectoryPoints,
} from '../utils/cameraProjection.js'

function resolveVideoUrl(url) {
  if (!url) return null
  if (url.startsWith('blob:')) return url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/')) return `${API_BASE}${url}`
  return url
}

function detectCameraIdFromFileName(fileName) {
  const name = String(fileName || '').toLowerCase()

  const simple = name.match(/^([0-9])\.mp4$/)
  if (simple) return `cam${simple[1]}`

  const cam = name.match(/(?:cam|camera)[_-]?([0-9])\.mp4$/)
  if (cam) return `cam${cam[1]}`

  return null
}

function getCameraVideoTime(globalFrame, globalFps, camera) {
  const cameraFps = camera?.fps || globalFps || 50
  const offsetFrame = camera?.offset_frame || 0
  return Math.max(0, (globalFrame + offsetFrame) / cameraFps)
}

function getGlobalFrameFromCameraTime(cameraTime, globalFps, camera) {
  const cameraFps = camera?.fps || globalFps || 50
  const offsetFrame = camera?.offset_frame || 0
  return Math.max(0, Math.round(cameraTime * cameraFps - offsetFrame))
}

function getNearestTrajectoryPoint(trajByFrame, frame, radius = 3) {
  const exact = trajByFrame.get(frame)
  if (exact) return exact

  for (let d = 1; d <= radius; d++) {
    const before = trajByFrame.get(frame - d)
    if (before) return before

    const after = trajByFrame.get(frame + d)
    if (after) return after
  }

  return null
}

function getTrajectoryWindow(trajByFrame, centerFrame, radius = 12) {
  const points = []

  for (let frame = centerFrame - radius; frame <= centerFrame + radius; frame++) {
    const point = trajByFrame.get(frame)
    if (point) points.push(point)
  }

  return points
}

function getObjectContainRect(container, video) {
  const boxWidth = Math.max(1, Math.round(container?.clientWidth || video?.clientWidth || 0))
  const boxHeight = Math.max(1, Math.round(container?.clientHeight || video?.clientHeight || 0))

  const videoWidth = video?.videoWidth || 1280
  const videoHeight = video?.videoHeight || 800

  const boxRatio = boxWidth / boxHeight
  const videoRatio = videoWidth / videoHeight

  let width = boxWidth
  let height = boxHeight
  let x = 0
  let y = 0

  if (boxRatio > videoRatio) {
    height = boxHeight
    width = height * videoRatio
    x = (boxWidth - width) / 2
  } else {
    width = boxWidth
    height = width / videoRatio
    y = (boxHeight - height) / 2
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
  trajByFrame,
  currentFrame,
  showProjection,
}) {
  if (!canvas || !container || !video) return

  const rect = getObjectContainRect(container, video)
  const dpr = window.devicePixelRatio || 1

  canvas.style.width = `${rect.boxWidth}px`
  canvas.style.height = `${rect.boxHeight}px`
  canvas.width = Math.max(1, Math.round(rect.boxWidth * dpr))
  canvas.height = Math.max(1, Math.round(rect.boxHeight * dpr))

  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, rect.boxWidth, rect.boxHeight)

  if (!showProjection || !cameraParams) return

  const scaleX = rect.width / cameraParams.imageWidth
  const scaleY = rect.height / cameraParams.imageHeight

  const toCanvasPoint = (projection) => ({
    x: rect.x + projection.u * scaleX,
    y: rect.y + projection.v * scaleY,
  })

  const windowPoints = getTrajectoryWindow(trajByFrame, currentFrame, 12)
  const projectedTrail = projectTrajectoryPoints(windowPoints, cameraParams)
    .filter((projection) => projection.insideImage)
    .map((projection) => ({
      ...projection,
      canvasPoint: toCanvasPoint(projection),
    }))

  if (projectedTrail.length > 1) {
    ctx.save()
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'
    ctx.shadowBlur = 4
    ctx.beginPath()

    projectedTrail.forEach((projection, index) => {
      const p = projection.canvasPoint
      if (index === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })

    ctx.stroke()
    ctx.restore()

    ctx.save()
    ctx.fillStyle = 'rgba(250, 204, 21, 0.75)'

    for (const projection of projectedTrail) {
      const p = projection.canvasPoint
      ctx.beginPath()
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
  }

  const currentPoint = getNearestTrajectoryPoint(trajByFrame, currentFrame, 3)
  const currentProjection = currentPoint
    ? project3DToImage(currentPoint, cameraParams)
    : null

  if (!currentProjection) return

  const currentCanvasPoint = toCanvasPoint(currentProjection)

  ctx.save()
  ctx.fillStyle = '#ef4444'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)'
  ctx.shadowBlur = 4

  ctx.beginPath()
  ctx.arc(currentCanvasPoint.x, currentCanvasPoint.y, 4, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

export default function VideoPanel() {
  const videoWrapRef = useRef(null)
  const videoRef = useRef(null)
  const overlayCanvasRef = useRef(null)
  const syncFromVideoRef = useRef(false)
  const lastAppliedTimeRef = useRef(null)
  const previousLocalUrlsRef = useRef({})

  const cameras = useAppStore((s) => s.cameras)
  const activeCameraId = useAppStore((s) => s.activeCameraId)
  const setActiveCamera = useAppStore((s) => s.setActiveCamera)
  const sceneCameraTargetId = useAppStore((s) => s.sceneCameraTargetId)
  const setSceneCameraTarget = useAppStore((s) => s.setSceneCameraTarget)

  const currentFrame = useAppStore((s) => s.currentFrame)
  const setCurrentFrame = useAppStore((s) => s.setCurrentFrame)
  const setCurrentTime = useAppStore((s) => s.setCurrentTime)
  const trajByFrame = useAppStore((s) => s.trajByFrame)

  const fps = useAppStore((s) => s.fps) || 50
  const playing = useAppStore((s) => s.playing)
  const setPlaying = useAppStore((s) => s.setPlaying)
  const togglePlaying = useAppStore((s) => s.togglePlaying)
  const previewRange = useAppStore((s) => s.previewRange)

  const localVideoSrcMap = useAppStore((s) => s.localVideoSrcMap)
  const setLocalVideoSrcMap = useAppStore((s) => s.setLocalVideoSrcMap)

  const [showProjection, setShowProjection] = useState(true)

  const safeCameras = useMemo(() => {
    return Array.isArray(cameras) && cameras.length > 0 ? cameras : []
  }, [cameras])

  const activeCamera = useMemo(() => {
    return safeCameras.find((camera) => camera.id === activeCameraId) || safeCameras[0] || null
  }, [safeCameras, activeCameraId])

  const activeCameraParams = useMemo(() => {
    return activeCamera ? getProjectionParams(activeCamera.id) : null
  }, [activeCamera])

  const projectionAvailable = Boolean(activeCameraParams)

  const activeSrc = useMemo(() => {
    if (!activeCamera) return null
    return localVideoSrcMap[activeCamera.id] || resolveVideoUrl(activeCamera.video_url || activeCamera.url)
  }, [activeCamera, localVideoSrcMap])

  const redrawOverlay = () => {
    drawProjectionOverlay({
      canvas: overlayCanvasRef.current,
      container: videoWrapRef.current,
      video: videoRef.current,
      cameraParams: activeCameraParams,
      trajByFrame,
      currentFrame,
      showProjection,
    })
  }

  useEffect(() => {
    if (!activeCamera && safeCameras[0]) {
      setActiveCamera(safeCameras[0].id)
      return
    }

    if (
      activeCameraId &&
      safeCameras.length > 0 &&
      !safeCameras.some((camera) => camera.id === activeCameraId)
    ) {
      setActiveCamera(safeCameras[0].id)
    }
  }, [activeCamera, activeCameraId, safeCameras, setActiveCamera])

  useEffect(() => {
    redrawOverlay()
  }, [activeCameraParams, trajByFrame, currentFrame, showProjection, activeSrc])

  useEffect(() => {
    const onResize = () => redrawOverlay()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [activeCameraParams, trajByFrame, currentFrame, showProjection])

  useEffect(() => {
    const target = videoWrapRef.current
    if (!target) return

    const observer = new ResizeObserver(() => {
      redrawOverlay()
    })

    observer.observe(target)

    return () => observer.disconnect()
  }, [activeSrc, activeCameraParams, trajByFrame, currentFrame, showProjection])

  function onPickLocalFiles(files) {
    const pickedFiles = Array.from(files || [])
    if (!pickedFiles.length) return

    const nextMap = { ...localVideoSrcMap }
    const oldUrls = { ...previousLocalUrlsRef.current }

    for (const file of pickedFiles) {
      const cameraId = detectCameraIdFromFileName(file.name)
      if (!cameraId) continue
      if (!safeCameras.some((camera) => camera.id === cameraId)) continue

      const nextUrl = URL.createObjectURL(file)

      if (oldUrls[cameraId]?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(oldUrls[cameraId])
        } catch {}
      }

      nextMap[cameraId] = nextUrl
      oldUrls[cameraId] = nextUrl
    }

    previousLocalUrlsRef.current = oldUrls
    setLocalVideoSrcMap(nextMap)

    const firstValid = pickedFiles
      .map((file) => detectCameraIdFromFileName(file.name))
      .find((cameraId) => cameraId && safeCameras.some((camera) => camera.id === cameraId))

    if (firstValid) {
      setActiveCamera(firstValid)
      setSceneCameraTarget(firstValid)
    }

    setPlaying(false)
  }

  function switchCamera(cameraId) {
    setActiveCamera(cameraId)
    setSceneCameraTarget(cameraId)
    lastAppliedTimeRef.current = null
  }

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    if (playing && activeSrc) {
      const p = v.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } else {
      v.pause()
    }
  }, [playing, activeSrc])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !activeCamera || !fps) return
    if (syncFromVideoRef.current) return

    const targetTime = getCameraVideoTime(currentFrame, fps, activeCamera)
    if (!Number.isFinite(targetTime)) return

    const diffFromVideo = Math.abs(v.currentTime - targetTime)
    const diffFromLastApplied =
      lastAppliedTimeRef.current == null
        ? Infinity
        : Math.abs(lastAppliedTimeRef.current - targetTime)

    const seekThreshold = playing ? 0.12 : 0.015
    const shouldSeek = diffFromVideo > seekThreshold && diffFromLastApplied > 0.001

    if (shouldSeek) {
      lastAppliedTimeRef.current = targetTime

      try {
        v.currentTime = targetTime
      } catch {}
    }
  }, [currentFrame, fps, activeCamera, activeSrc, playing])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !activeCamera || !fps) return

    let callbackId = null
    let stopped = false

    const updateFrame = (now, meta) => {
      if (stopped || !videoRef.current) return

      const mediaTime = meta?.mediaTime ?? videoRef.current.currentTime
      const frame = getGlobalFrameFromCameraTime(mediaTime, fps, activeCamera)

      syncFromVideoRef.current = true
      lastAppliedTimeRef.current = mediaTime

      if (previewRange && frame >= previewRange.endFrame) {
        const endFrame = previewRange.endFrame
        setCurrentFrame(endFrame)
        setCurrentTime(endFrame / fps)
        setPlaying(false)
        syncFromVideoRef.current = false
        return
      }

      setCurrentFrame(frame)
      setCurrentTime(frame / fps)
      syncFromVideoRef.current = false

      if (videoRef.current.requestVideoFrameCallback && !stopped) {
        callbackId = videoRef.current.requestVideoFrameCallback(updateFrame)
      }
    }

    if (v.requestVideoFrameCallback) {
      callbackId = v.requestVideoFrameCallback(updateFrame)
    }

    return () => {
      stopped = true

      if (callbackId && v.cancelVideoFrameCallback) {
        v.cancelVideoFrameCallback(callbackId)
      }
    }
  }, [fps, activeCamera, previewRange, setCurrentFrame, setCurrentTime, setPlaying, activeSrc])

  function onTimeUpdate() {
    const v = videoRef.current
    if (!v || !activeCamera || !fps) return
    if (v.requestVideoFrameCallback) return

    const frame = getGlobalFrameFromCameraTime(v.currentTime, fps, activeCamera)

    syncFromVideoRef.current = true
    lastAppliedTimeRef.current = v.currentTime

    if (previewRange && frame >= previewRange.endFrame) {
      const endFrame = previewRange.endFrame
      setCurrentFrame(endFrame)
      setCurrentTime(endFrame / fps)
      setPlaying(false)
      syncFromVideoRef.current = false
      return
    }

    setCurrentFrame(frame)
    setCurrentTime(frame / fps)
    syncFromVideoRef.current = false
  }

  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return

      if (e.code === 'Space') {
        e.preventDefault()
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

      if (Object.prototype.hasOwnProperty.call(keyToCameraIndex, e.code)) {
        const cameraIndex = keyToCameraIndex[e.code]
        const camera = safeCameras.find((item) => item.index === cameraIndex || item.id === `cam${cameraIndex}`)

        if (camera) {
          e.preventDefault()
          switchCamera(camera.id)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlaying, safeCameras])

  useEffect(() => {
    return () => {
      Object.values(previousLocalUrlsRef.current).forEach((url) => {
        if (typeof url === 'string' && url.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(url)
          } catch {}
        }
      })
    }
  }, [])

  return (
    <div className="relative w-full h-full bg-black flex flex-col">
      <div className="px-3 py-2 pl-28 border-b border-zinc-800 bg-zinc-950 flex items-center justify-between gap-3 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0 overflow-x-auto">

          {safeCameras.map((camera) => {
            const isActive = activeCamera?.id === camera.id
            const hasVideo = Boolean(localVideoSrcMap[camera.id] || camera.video_url || camera.url)
            const isSceneTarget = sceneCameraTargetId === camera.id
            const cameraHasProjection = hasProjectionParams(camera.id)

            return (
              <button
                key={camera.id}
                onClick={() => switchCamera(camera.id)}
                className={`px-2.5 py-1 rounded text-xs border shrink-0 transition-colors ${
                  isActive
                    ? 'bg-sky-700 border-sky-500 text-white'
                    : hasVideo
                      ? 'bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:bg-zinc-900'
                }`}
                title={`${camera.label} / ${camera.description || ''} / ${camera.fileName || ''}${isSceneTarget ? ' / 3D view target' : ''}${cameraHasProjection ? ' / has projection params' : ''}`}
              >
                {camera.index ?? camera.id.replace('cam', '')}
              </button>
            )
          })}
        </div>

        <label className="inline-flex items-center shrink-0">
          <span className="px-3 py-1 text-xs text-white bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer">
            選擇 0-9.mp4
          </span>

          <input
            type="file"
            accept="video/*"
            multiple
            onChange={(e) => onPickLocalFiles(e.target.files)}
            className="hidden"
          />
        </label>
      </div>

      <div className="flex-1 flex items-center justify-center bg-black min-h-0 overflow-hidden relative">
        <div className="absolute top-2 left-2 z-10 px-2 py-1 rounded bg-black/65 border border-white/10 text-xs text-zinc-100">
          {activeCamera?.label || 'No Camera'}
          {activeCamera?.offset_frame ? ` / offset ${activeCamera.offset_frame >= 0 ? '+' : ''}${activeCamera.offset_frame}f` : ''}
          {projectionAvailable && showProjection ? ' / Projection ON' : ''}
        </div>

        {activeSrc && (
          <div className="absolute top-2 right-2 z-20 flex items-center gap-2">
            <button
              type="button"
              disabled={!projectionAvailable}
              onClick={() => setShowProjection((v) => !v)}
              className={`px-2 py-1 rounded border text-xs ${
                projectionAvailable
                  ? showProjection
                    ? 'bg-yellow-700/80 border-yellow-500 text-yellow-50 hover:bg-yellow-600/80'
                    : 'bg-zinc-900/80 border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                  : 'bg-zinc-950/80 border-zinc-800 text-zinc-500 cursor-not-allowed'
              }`}
              title={projectionAvailable ? '顯示 / 隱藏 3D 球點投影' : '此視角沒有 camera params'}
            >
              3D→2D
            </button>
          </div>
        )}

        {!activeSrc && (
          <div className="text-zinc-400 text-sm px-4 text-center leading-7">
            目前沒有載入 {activeCamera?.label || 'camera'} 的影片。
            <br />
            請上方選擇 <span className="text-zinc-100">0.mp4 ~ 9.mp4</span>。
          </div>
        )}

        {activeSrc && (
          <div
            ref={videoWrapRef}
            className="relative w-full h-full flex items-center justify-center overflow-hidden"
          >
            <video
              ref={videoRef}
              key={activeCamera?.id}
              src={activeSrc}
              className="block w-full h-full object-contain"
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={() => {
                const v = videoRef.current
                if (!v || !activeCamera) return

                const targetTime = getCameraVideoTime(currentFrame, fps, activeCamera)

                try {
                  v.currentTime = targetTime
                  lastAppliedTimeRef.current = targetTime
                } catch {}

                if (playing) {
                  const p = v.play()
                  if (p && typeof p.catch === 'function') p.catch(() => {})
                }

                window.requestAnimationFrame(redrawOverlay)
              }}
              playsInline
              onClick={togglePlaying}
            />

            <canvas
              ref={overlayCanvasRef}
              className="absolute inset-0 pointer-events-none"
            />
          </div>
        )}

        {activeSrc && !projectionAvailable && (
          <div className="absolute bottom-3 right-3 z-10 px-2 py-1 rounded bg-black/65 border border-white/10 text-xs text-zinc-400">
            此視角沒有 camera params，無法投影
          </div>
        )}
      </div>
    </div>
  )
}
