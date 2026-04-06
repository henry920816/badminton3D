import React, { useEffect, useMemo, useRef, useState } from "react"
import { useAppStore } from "../store"

export default function VideoPanel() {
  const videoRef = useRef(null)
  const syncFromVideoRef = useRef(false)
  const lastAppliedTimeRef = useRef(null)

  const storeCameras = useAppStore((s) => s.cameras)
  const activeCameraId = useAppStore((s) => s.activeCameraId)
  const setActiveCamera = useAppStore((s) => s.setActiveCamera)

  const currentFrame = useAppStore((s) => s.currentFrame)
  const currentTime = useAppStore((s) => s.currentTime)
  const setCurrentFrame = useAppStore((s) => s.setCurrentFrame)
  const setCurrentTime = useAppStore((s) => s.setCurrentTime)

  const fps = useAppStore((s) => s.fps) || 60
  const playing = useAppStore((s) => s.playing)
  const setPlaying = useAppStore((s) => s.setPlaying)
  const previewRange = useAppStore((s) => s.previewRange)

  const [videoSrcMap, setVideoSrcMap] = useState({})

  const cameras = useMemo(() => {
    if (Array.isArray(storeCameras) && storeCameras.length > 0) return storeCameras
    return [{ id: "main", label: "Main" }]
  }, [storeCameras])

  const safeActiveCameraId = useMemo(() => {
    if (activeCameraId && cameras.some((c) => c.id === activeCameraId)) return activeCameraId
    return cameras[0]?.id ?? "main"
  }, [activeCameraId, cameras])

  const activeSrc = videoSrcMap[safeActiveCameraId] || null

  useEffect(() => {
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
