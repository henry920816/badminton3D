import React, { useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../store.js'
import { API_BASE } from '../config.js'

function resolveVideoUrl(url) {
  if (!url) return null
  if (url.startsWith('blob:')) return url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/')) return `${API_BASE}${url}`
  return url
}

function detectCameraIdFromFileName(fileName) {
  const name = String(fileName || '').toLowerCase()

  // 支援：0.mp4、1.mp4 ... 9.mp4
  const simple = name.match(/^([0-9])\.mp4$/)
  if (simple) return `cam${simple[1]}`

  // 額外支援：cam0.mp4、cam_0.mp4、cam-0.mp4、camera0.mp4
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

export default function VideoPanel() {
  const videoRef = useRef(null)
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

  const fps = useAppStore((s) => s.fps) || 50
  const playing = useAppStore((s) => s.playing)
  const setPlaying = useAppStore((s) => s.setPlaying)
  const togglePlaying = useAppStore((s) => s.togglePlaying)
  const previewRange = useAppStore((s) => s.previewRange)

  const localVideoSrcMap = useAppStore((s) => s.localVideoSrcMap)
  const setLocalVideoSrcMap = useAppStore((s) => s.setLocalVideoSrcMap)

  const safeCameras = useMemo(() => {
    return Array.isArray(cameras) && cameras.length > 0 ? cameras : []
  }, [cameras])

  const activeCamera = useMemo(() => {
    return safeCameras.find((camera) => camera.id === activeCameraId) || safeCameras[0] || null
  }, [safeCameras, activeCameraId])

  const activeSrc = useMemo(() => {
    if (!activeCamera) return null
    return localVideoSrcMap[activeCamera.id] || resolveVideoUrl(activeCamera.video_url || activeCamera.url)
  }, [activeCamera, localVideoSrcMap])

  useEffect(() => {
    if (!activeCamera && safeCameras[0]) {
      setActiveCamera(safeCameras[0].id)
      return
    }

    if (activeCameraId && safeCameras.length > 0 && !safeCameras.some((camera) => camera.id === activeCameraId)) {
      setActiveCamera(safeCameras[0].id)
    }
  }, [activeCamera, activeCameraId, safeCameras, setActiveCamera])

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
        } catch { }
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
      if (p && typeof p.catch === 'function') p.catch(() => { })
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
      } catch { }
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
          } catch { }
        }
      })
    }
  }, [])

  return (
    <div className="relative w-full h-full bg-black flex flex-col">
      <div className="px-3 py-2 pl-28 border-b border-zinc-800 bg-zinc-950 flex items-center gap-2 overflow-x-auto">
        {safeCameras.map((camera) => {
          const isActive = activeCamera?.id === camera.id
          const hasVideo = Boolean(localVideoSrcMap[camera.id] || camera.video_url || camera.url)
          const isSceneTarget = sceneCameraTargetId === camera.id

          return (
            <button
              key={camera.id}
              onClick={() => switchCamera(camera.id)}
              className={`px-2.5 py-1 rounded text-xs border shrink-0 transition-colors ${isActive
                  ? 'bg-sky-700 border-sky-500 text-white'
                  : hasVideo
                    ? 'bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:bg-zinc-900'
                }`}
              title={`${camera.label} / ${camera.description || ''} / ${camera.fileName || ''}${isSceneTarget ? ' / 3D view target' : ''}`}
            >
              {camera.index ?? camera.id.replace('cam', '')}
            </button>
          )
        })}
      </div>

      <div className="flex-1 flex items-center justify-center bg-black min-h-0 overflow-hidden relative">
        <div className="absolute top-2 left-2 z-10 px-2 py-1 rounded bg-black/65 border border-white/10 text-xs text-zinc-100">
          {activeCamera?.label || 'No Camera'}
          {activeCamera?.offset_frame ? ` / offset ${activeCamera.offset_frame >= 0 ? '+' : ''}${activeCamera.offset_frame}f` : ''}
        </div>

        {!activeSrc && (
          <div className="text-zinc-400 text-sm px-4 text-center leading-7">
            目前沒有載入 {activeCamera?.label || 'camera'} 的影片。
            <br />
            請下方一次選擇 <span className="text-zinc-100">0.mp4 ~ 9.mp4</span>。
          </div>
        )}

        {activeSrc && (
          <video
            ref={videoRef}
            key={activeCamera?.id}
            src={activeSrc}
            className="max-h-full max-w-full"
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={() => {
              const v = videoRef.current
              if (!v || !activeCamera) return
              const targetTime = getCameraVideoTime(currentFrame, fps, activeCamera)
              try {
                v.currentTime = targetTime
                lastAppliedTimeRef.current = targetTime
              } catch { }
              if (playing) {
                const p = v.play()
                if (p && typeof p.catch === 'function') p.catch(() => { })
              }
            }}
            playsInline
            onClick={togglePlaying}
          />
        )}
      </div>

      <div className="px-3 py-2 border-t border-zinc-800 bg-zinc-950 flex items-center gap-3">
        <label className="inline-flex items-center shrink-0">
          <span className="px-3 py-1.5 text-sm text-white bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer">
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
        <div className="text-xs text-zinc-500 truncate">
          檔名請用 0.mp4、1.mp4、2.mp4 ... 9.mp4；鍵盤 0~9 可快速切換視角。
        </div>
      </div>
    </div>
  )
}  useEffect(() => {
    if (!activeCameraId && cameras[0]) {
      setActiveCamera(cameras[0].id)
      return
    }
    if (activeCameraId && !cameras.some((c) => c.id === activeCameraId)) {
      setActiveCamera(cameras[0].id)
    }
  }, [activeCameraId, cameras, setActiveCamera])

  function onPickLocal(camId, file) {
    if (!file) return

    const url = URL.createObjectURL(file)

    setVideoSrcMap((prev) => {
      if (prev[camId]?.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(prev[camId])
        } catch {}
      }
      return {
        ...prev,
        [camId]: url,
      }
    })

    lastAppliedTimeRef.current = 0
    setActiveCamera(camId)
    setPlaying(false)
    setCurrentFrame(0)
    setCurrentTime(0)
  }

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    if (playing) {
      const p = v.play()
      if (p && typeof p.catch === "function") p.catch(() => {})
    } else {
      v.pause()
    }
  }, [playing, activeSrc])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !fps) return
    if (syncFromVideoRef.current) return

    const timeFromFrame = currentFrame / fps
    const targetTime =
      typeof currentTime === "number" && Number.isFinite(currentTime)
        ? currentTime
        : timeFromFrame

    if (!Number.isFinite(targetTime)) return

    const diffFromVideo = Math.abs(v.currentTime - targetTime)
    const diffFromLastApplied =
      lastAppliedTimeRef.current == null
        ? Infinity
        : Math.abs(lastAppliedTimeRef.current - targetTime)

    const shouldSeek =
      diffFromVideo > 0.03 && diffFromLastApplied > 0.001

    if (shouldSeek) {
      lastAppliedTimeRef.current = targetTime
      v.currentTime = targetTime
    }
  }, [currentTime, currentFrame, fps, activeSrc])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !fps) return

    let callbackId = null
    let stopped = false

    const updateFrame = (now, meta) => {
      if (stopped || !videoRef.current) return

      const mediaTime = meta?.mediaTime ?? videoRef.current.currentTime
      const frame = Math.round(mediaTime * fps)

      syncFromVideoRef.current = true
      lastAppliedTimeRef.current = mediaTime

      if (previewRange && frame >= previewRange.endFrame) {
        const endFrame = previewRange.endFrame
        const endTime = endFrame / fps
        setCurrentFrame(endFrame)
        setCurrentTime(endTime)
        setPlaying(false)
        syncFromVideoRef.current = false
        return
      }

      setCurrentFrame(frame)
      setCurrentTime(mediaTime)
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
  }, [fps, previewRange, setCurrentFrame, setCurrentTime, setPlaying, activeSrc])

  function onTimeUpdate() {
    const v = videoRef.current
    if (!v || !fps) return
    if (v.requestVideoFrameCallback) return

    const frame = Math.round(v.currentTime * fps)

    syncFromVideoRef.current = true
    lastAppliedTimeRef.current = v.currentTime

    if (previewRange && frame >= previewRange.endFrame) {
      const endFrame = previewRange.endFrame
      const endTime = endFrame / fps
      setCurrentFrame(endFrame)
      setCurrentTime(endTime)
      setPlaying(false)
      syncFromVideoRef.current = false
      return
    }

    setCurrentFrame(frame)
    setCurrentTime(v.currentTime)
    syncFromVideoRef.current = false
  }

  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName?.toLowerCase()
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return

      if (e.code === "Space") {
        e.preventDefault()
        setPlaying((p) => !p)
      }
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setPlaying])

  useEffect(() => {
    return () => {
      Object.values(videoSrcMap).forEach((url) => {
        if (typeof url === "string" && url.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(url)
          } catch {}
        }
      })
    }
  }, [videoSrcMap])

  return (
    <div className="relative w-full h-full bg-black flex flex-col">
      <div className="flex-1 flex items-center justify-center bg-black min-h-0 overflow-hidden">
        {!activeSrc && (
          <div className="text-zinc-400 text-sm px-4 text-center">
            沒有影片來源。請下方選擇檔案。
          </div>
        )}

        {activeSrc && (
          <video
            ref={videoRef}
            src={activeSrc}
            className="max-h-full max-w-full"
            onTimeUpdate={onTimeUpdate}
            playsInline
            onClick={() => setPlaying((p) => !p)}
          />
        )}
      </div>

      <div className="px-3 py-2 border-t border-zinc-800 bg-zinc-950">
        <label className="inline-flex items-center">
          <span className="px-3 py-1.5 text-sm text-white bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer">
            選擇檔案
          </span>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => onPickLocal(safeActiveCameraId, e.target.files?.[0])}
            className="hidden"
          />
        </label>
      </div>
    </div>
  )
}
