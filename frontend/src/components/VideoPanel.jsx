import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store.js'

export default function VideoPanel() {
  const videoRef = useRef(null)
  const cameras = useAppStore(s => s.cameras)
  const activeCameraId = useAppStore(s => s.activeCameraId)
  const setActiveCamera = useAppStore(s => s.setActiveCamera)
  const currentTime = useAppStore(s => s.currentTime)
  const setCurrentTime = useAppStore(s => s.setCurrentTime)
  const playing = useAppStore(s => s.playing)
  const togglePlaying = useAppStore(s => s.togglePlaying)
  const playbackRate = useAppStore(s => s.playbackRate)
  const setPlaybackRate = useAppStore(s => s.setPlaybackRate)
  const fps = useAppStore(s => s.fps)

  const [localFiles, setLocalFiles] = useState({}) // camId -> objectURL

  const activeCam = useMemo(() => {
    return (cameras || []).find(c => c.id === activeCameraId) || (cameras || [])[0]
  }, [cameras, activeCameraId])

  const src = useMemo(() => {
    if (!activeCam) return null
    return localFiles[activeCam.id] || activeCam.url || null
  }, [activeCam, localFiles])

  // Seek from store -> video
  const isSyncing = useRef(false)
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (Math.abs(v.currentTime - currentTime) > 0.08) {
      isSyncing.current = true
      v.currentTime = currentTime
      isSyncing.current = false
    }
  }, [currentTime])

  // Play/pause from store
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = playbackRate
    if (playing) v.play().catch(() => {})
    else v.pause()
  }, [playing, playbackRate, src])

  // Video -> store
  const onTimeUpdate = () => {
    const v = videoRef.current
    if (!v || isSyncing.current) return
    setCurrentTime(v.currentTime)
  }

  // keyboard: 1..9 switch cams
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') { e.preventDefault(); togglePlaying(); return }
      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1
        if (cameras && cameras[idx]) setActiveCamera(cameras[idx].id)
      }
      if (e.key === '[') setPlaybackRate(Math.max(0.25, playbackRate - 0.25))
      if (e.key === ']') setPlaybackRate(Math.min(2.0, playbackRate + 0.25))

      // frame step
      const v = videoRef.current
      if (!v) return
      const dt = 1.0 / (fps || 60)
      if (e.key === 'ArrowLeft') { e.preventDefault(); v.pause(); v.currentTime = Math.max(0, v.currentTime - dt); setCurrentTime(v.currentTime); }
      if (e.key === 'ArrowRight') { e.preventDefault(); v.pause(); v.currentTime = Math.min(v.duration || 1e9, v.currentTime + dt); setCurrentTime(v.currentTime); }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cameras, playbackRate, fps])

  const onPickLocal = (camId, file) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setLocalFiles(prev => ({ ...prev, [camId]: url }))
  }

  return (
    <div className="w-full h-full bg-black relative">
      {src ? (
        <video
          ref={videoRef}
          src={src}
          className="w-full h-full object-contain"
          onTimeUpdate={onTimeUpdate}
          controls={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">
          沒有影片來源。請在下方選擇本機 mp4。
        </div>
      )}

      {/* HUD */}
      <div className="absolute top-2 right-2 px-2 py-1 rounded bg-zinc-900/70 border border-zinc-800 text-xs">
        {activeCam ? activeCam.label : 'CAM'} · {playbackRate.toFixed(2)}x
      </div>

      {/* Camera strip */}
      <div className="absolute bottom-0 left-0 right-0 bg-zinc-950/80 border-t border-zinc-800 p-2">
        <div className="flex gap-2 overflow-x-auto">
          {(cameras || []).map((c, idx) => (
            <button
              key={c.id}
              onClick={() => setActiveCamera(c.id)}
              className={
                'flex-shrink-0 px-2 py-1 rounded border text-xs ' +
                (c.id === activeCameraId ? 'bg-zinc-800 border-zinc-600' : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800')
              }
              title="點選切換；鍵盤 1..9 快速切"
            >
              {idx + 1}. {c.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {(cameras || []).map((c) => (
              <label key={c.id} className="text-xs text-zinc-400 cursor-pointer">
                <span className="mr-1">{c.label}:</span>
                <input
                  type="file"
                  accept="video/mp4,video/webm"
                  onChange={(e) => onPickLocal(c.id, e.target.files?.[0])}
                  className="text-xs"
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
