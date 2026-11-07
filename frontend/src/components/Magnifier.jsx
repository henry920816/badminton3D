import React, { useEffect, useRef, useState } from 'react'

// 放大鏡直徑（CSS px）、離游標的距離
const LOUPE_SIZE = 160
const LOUPE_GAP = 24

const MIN_ZOOM = 2
const MAX_ZOOM = 8
const DEFAULT_ZOOM = 3


/**
 * 影片上的放大鏡：游標附近的影片畫面連同疊圖（標註圈、導引線）一起
 * 放大，滾輪調倍率。只負責看，點擊照樣由底下的疊圖 canvas 處理。
 *
 * overlayCanvasRef 是疊圖 canvas（事件也掛在它上面），containerRef 是
 * 包住影片和疊圖的那層，getContentRect 回傳影片內容在 container 裡的
 * { x, y, width, height }（object-contain 之後的實際範圍）。
 */
export default function Magnifier({
  active,
  videoRef,
  overlayCanvasRef,
  containerRef,
  getContentRect,
}) {
  const loupeRef = useRef(null)
  const pointerRef = useRef(null)
  const zoomRef = useRef(DEFAULT_ZOOM)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [pointer, setPointer] = useState(null)

  useEffect(
    () => {
      const canvas = overlayCanvasRef.current

      if (!active || !canvas) return undefined

      const handleMove = event => {
        const bounds = canvas.getBoundingClientRect()
        const next = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
        pointerRef.current = next
        setPointer(next)
      }

      const handleLeave = () => {
        pointerRef.current = null
        setPointer(null)
      }

      // React 的 onWheel 是 passive，擋不掉頁面捲動，所以自己掛
      const handleWheel = event => {
        event.preventDefault()
        const next = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, zoomRef.current * (event.deltaY < 0 ? 1.25 : 0.8)),
        )
        zoomRef.current = next
        setZoom(next)
      }

      canvas.addEventListener('pointermove', handleMove)
      canvas.addEventListener('pointerleave', handleLeave)
      canvas.addEventListener('wheel', handleWheel, { passive: false })

      return () => {
        canvas.removeEventListener('pointermove', handleMove)
        canvas.removeEventListener('pointerleave', handleLeave)
        canvas.removeEventListener('wheel', handleWheel)
        pointerRef.current = null
        setPointer(null)
      }
    },
    [active, overlayCanvasRef],
  )

  // 游標在畫面上時每一幀重畫，疊圖或影片換格都會跟上
  useEffect(
    () => {
      if (!active || !pointer) return undefined

      let frameId = 0

      const draw = () => {
        frameId = window.requestAnimationFrame(draw)

        const loupe = loupeRef.current
        const video = videoRef.current
        const overlay = overlayCanvasRef.current
        const position = pointerRef.current
        const rectangle = getContentRect()

        if (!loupe || !video || !overlay || !position || !rectangle?.width) return

        const pixelRatio = window.devicePixelRatio || 1
        const size = Math.round(LOUPE_SIZE * pixelRatio)

        if (loupe.width !== size) {
          loupe.width = size
          loupe.height = size
        }

        const context = loupe.getContext('2d')
        if (!context) return

        // 放大鏡涵蓋的範圍（container 的 CSS px）
        const span = LOUPE_SIZE / zoomRef.current
        const left = position.x - span / 2
        const top = position.y - span / 2

        context.save()
        context.clearRect(0, 0, size, size)
        context.beginPath()
        context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
        context.clip()
        context.fillStyle = '#000'
        context.fillRect(0, 0, size, size)
        context.imageSmoothingEnabled = false

        if (video.videoWidth > 0) {
          const scaleX = video.videoWidth / rectangle.width
          const scaleY = video.videoHeight / rectangle.height

          context.drawImage(
            video,
            (left - rectangle.x) * scaleX,
            (top - rectangle.y) * scaleY,
            span * scaleX,
            span * scaleY,
            0,
            0,
            size,
            size,
          )
        }

        // 疊圖 canvas 的像素是 CSS px × devicePixelRatio
        const overlayRatio = overlay.width / Math.max(1, overlay.clientWidth)

        context.drawImage(
          overlay,
          left * overlayRatio,
          top * overlayRatio,
          span * overlayRatio,
          span * overlayRatio,
          0,
          0,
          size,
          size,
        )

        // 十字準星，中間留空才看得到羽球
        const center = size / 2
        const gap = 6 * pixelRatio
        const arm = 18 * pixelRatio

        context.strokeStyle = 'rgba(250, 204, 21, 0.9)'
        context.lineWidth = pixelRatio
        context.beginPath()
        context.moveTo(center - gap - arm, center)
        context.lineTo(center - gap, center)
        context.moveTo(center + gap, center)
        context.lineTo(center + gap + arm, center)
        context.moveTo(center, center - gap - arm)
        context.lineTo(center, center - gap)
        context.moveTo(center, center + gap)
        context.lineTo(center, center + gap + arm)
        context.stroke()
        context.restore()

        context.strokeStyle = 'rgba(255, 255, 255, 0.7)'
        context.lineWidth = 2 * pixelRatio
        context.beginPath()
        context.arc(center, center, center - pixelRatio, 0, Math.PI * 2)
        context.stroke()
      }

      draw()

      return () => window.cancelAnimationFrame(frameId)
    },
    [active, pointer != null, videoRef, overlayCanvasRef, getContentRect],
  )

  if (!active || !pointer) return null

  // 放在游標右上，碰到邊就翻到另一側
  const container = containerRef.current
  const boxWidth = container?.clientWidth || 0
  const flipX = pointer.x + LOUPE_GAP + LOUPE_SIZE > boxWidth
  const flipY = pointer.y - LOUPE_GAP - LOUPE_SIZE < 0
  const left = flipX ? pointer.x - LOUPE_GAP - LOUPE_SIZE : pointer.x + LOUPE_GAP
  const top = flipY ? pointer.y + LOUPE_GAP : pointer.y - LOUPE_GAP - LOUPE_SIZE

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{ left, top, width: LOUPE_SIZE, height: LOUPE_SIZE }}
    >
      <canvas
        ref={loupeRef}
        className="block rounded-full shadow-lg shadow-black/60"
        style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}
      />
      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/70 px-1 font-mono text-[10px] text-zinc-200">
        {zoom.toFixed(1)}
        ×
      </span>
    </div>
  )
}
