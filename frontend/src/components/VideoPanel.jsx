import React, { useEffect, useMemo, useRef, useState } from "react"
import { useAppStore } from "../store"

export default function VideoPanel() {
  const videoRef = useRef(null)

  const storeCameras = useAppStore((s) => s.cameras)
  const activeCameraId = useAppStore((s) => s.activeCameraId)
  const setActiveCamera = useAppStore((s) => s.setActiveCamera)

  const currentFrame = useAppStore((s) => s.currentFrame)
  const setCurrentFrame = useAppStore((s) => s.setCurrentFrame)

  const fps = useAppStore((s) => s.fps)
  const playing = useAppStore((s) => s.playing)
  const setPlaying = useAppStore((s) => s.setPlaying)
  const previewRange = useAppStore((s) => s.previewRange)

  const [videoSrcMap, setVideoSrcMap] = useState({})
  const [fileNameMap, setFileNameMap] = useState({})

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

    setFileNameMap((prev) => ({
      ...prev,
      [camId]: file.name,
    }))

    setActiveCamera(camId)
    setPlaying(false)
    setCurrentFrame(0)
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

    const t = currentFrame / fps
    if (Math.abs(v.currentTime - t) > 0.02) {
      v.currentTime = t
    }
  }, [currentFrame, fps, activeSrc])

  function onTimeUpdate() {
    const v = videoRef.current
    if (!v || !fps) return

    const frame = Math.round(v.currentTime * fps)

    if (previewRange && frame >= previewRange.endFrame) {
      setPlaying(false)
      return
    }

    setCurrentFrame(frame)
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
      <div className="flex-1 flex items-center justify-center bg-black min-h-0">
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
          />
        )}
      </div>

      <div className="px-3 py-2 border-t border-zinc-800 bg-zinc-950">
        <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
          <span>選擇檔案</span>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => onPickLocal(safeActiveCameraId, e.target.files?.[0])}
            className="text-sm"
          />
        </label>

      </div>
    </div>
  )
}
