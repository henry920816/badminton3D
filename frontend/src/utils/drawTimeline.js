// 時間軸 canvas 的繪製：尺規、各軌道曲線、rally / 擊球、播放線。
// 純繪圖，狀態全部由 TimelinePanel 傳進來


// 左側標籤欄寬度與上方尺規高度，TimelinePanel 的滑鼠操作也用
export const LABEL_W = 112
export const RULER_H = 28

export const RALLY_STYLES = {
  verified: ['rgba(16,185,129,0.20)', '#10b981'],
  needs_fix: ['rgba(244,63,94,0.20)', '#f43f5e'],
  reviewing: ['rgba(14,165,233,0.20)', '#0ea5e9'],
  default: ['rgba(82,82,91,0.30)', '#71717a'],
}

// 同 triangulation_3Dline.py 速度點圖的 y 軸上限：只靠一組相機重建的
// 視角偶爾會跳出好幾百 m/s，不截掉整條軸都會被壓扁
const SPEED_AXIS_MAX = 50

// 3D 軌跡的距離與速度，在距離 / 速度軌道上畫成白色虛線當參考，
// 角色同 triangulation_3Dline.py 的 Ground truth 線。用的是 3D 場景
// 顯示的那一份（純 2D 或 ball_traj），不是固定 ball_traj
const REFERENCE_COLOR = 'rgba(244,244,245,0.9)'

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Consolas, monospace'


function formatAxisValue(value) {
  return Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
}


// 主刻度間距至少 80 px
function pickTickStep(pxPerSec) {
  return TICK_STEPS.find(step => step * pxPerSec >= 80) ?? TICK_STEPS[TICK_STEPS.length - 1]
}


function formatTick(t, step) {
  const minutes = Math.floor(t / 60 + 1e-9)
  const seconds = t - minutes * 60
  const secondsText = step < 1 ? seconds.toFixed(1) : String(Math.round(seconds))

  if (minutes > 0) {
    return `${minutes}:${secondsText.padStart(step < 1 ? 4 : 2, '0')}`
  }
  return `${secondsText}s`
}


function formatClock(t) {
  const minutes = Math.floor(t / 60)
  const seconds = t - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`
}


export function drawTimeline({
  canvasRef, dimensions, canvasHeight, lanes, tracksBottom, scrollLeft, pxPerSec,
  trajMap, displayLookup, rallies, hits, currentTime, currentFrame,
  currentRally, activeItem, hoveredHit, draggingHit, fps, selection,
  visibleTracks, consistencyByFrame, laneSource, getPlayheadX,
}) {
  const canvas = canvasRef.current
  if (!canvas || dimensions.width === 0 || dimensions.height === 0) return

  const ctx = canvas.getContext('2d')
  const scale = window.devicePixelRatio || 1
  const w = dimensions.width
  const h = canvasHeight

  // 重設 width/height 會重新配置整塊畫布，只在大小變了才做；
  // 下面會整塊塗底色，不用另外清
  if (canvas.width !== Math.round(w * scale)) canvas.width = Math.round(w * scale)
  if (canvas.height !== Math.round(h * scale)) canvas.height = Math.round(h * scale)
  ctx.setTransform(scale, 0, 0, scale, 0, 0)

  ctx.fillStyle = '#09090b'
  ctx.fillRect(0, 0, w, h)

  const timeToX = (t) => t * pxPerSec - scrollLeft + LABEL_W
  const xToTime = (x) => (x - LABEL_W + scrollLeft) / pxPerSec

  const sSec = xToTime(LABEL_W)
  const eSec = xToTime(w)
  const sF = Math.max(0, Math.floor(sSec * fps))
  const eF = Math.max(0, Math.ceil(eSec * fps))
  const tickStep = pickTickStep(pxPerSec)
  const firstTick = Math.max(0, Math.ceil(sSec / tickStep))
  const lastTick = Math.floor(eSec / tickStep)

  const laneById = Object.fromEntries(lanes.map(lane => [lane.id, lane]))
  const hitsLane = laneById.hits
  const plotRanges = {}

  const pts = []
  const step = Math.max(1, Math.floor((eF - sF) / 1000))

  for (let f = sF; f <= eF; f += step) {
    const p = trajMap.get(f)
    if (p) pts.push(p)
  }

  // 3D 參考的距離與速度；速度同各視角，是和前一格的位移乘上 fps
  const referencePoints = { distance: [], speed: [] }

  if (visibleTracks.reference) {
    for (let f = sF; f <= eF; f += step) {
      const p = displayLookup.get(f)
      if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) continue

      referencePoints.distance.push({ frame: p.frame, value: Math.hypot(p.x, p.y, p.z) })

      const previous = displayLookup.get(p.frame - 1)
      if (previous && [previous.x, previous.y, previous.z].every(Number.isFinite)) {
        referencePoints.speed.push({
          frame: p.frame,
          value: Math.hypot(p.x - previous.x, p.y - previous.y, p.z - previous.z) * fps,
        })
      }
    }
  }

  // 軌道底色與分隔線
  let plotIndex = 0

  for (const lane of lanes) {
    const isPlot = Boolean(lane.valueFn || lane.metric)
    ctx.fillStyle = isPlot ? (plotIndex++ % 2 ? '#0d0d10' : '#111114') : '#09090b'
    ctx.fillRect(LABEL_W, lane.top, w - LABEL_W, lane.height)

    ctx.fillStyle = '#1c1c21'
    ctx.fillRect(0, lane.top + lane.height - 1, w, 1)
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(LABEL_W, RULER_H, w - LABEL_W, tracksBottom - RULER_H)
  ctx.clip()

  // 主刻度的垂直格線
  ctx.fillStyle = 'rgba(63,63,70,0.28)'
  for (let i = firstTick; i <= lastTick; i++) {
    ctx.fillRect(Math.round(timeToX(i * tickStep)), RULER_H, 1, tracksBottom - RULER_H)
  }

  if (selection.inTime != null && selection.outTime != null) {
    const s = Math.min(selection.inTime, selection.outTime)
    const e = Math.max(selection.inTime, selection.outTime)
    const sx = Math.max(LABEL_W, timeToX(s))
    const ex = Math.min(w, timeToX(e))

    if (sx < w && ex > LABEL_W) {
      ctx.fillStyle = 'rgba(167,139,250,0.10)'
      ctx.fillRect(sx, RULER_H, ex - sx, tracksBottom - RULER_H)

      ctx.strokeStyle = 'rgba(167,139,250,0.7)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(sx + 0.5, RULER_H)
      ctx.lineTo(sx + 0.5, tracksBottom)
      ctx.moveTo(ex - 0.5, RULER_H)
      ctx.lineTo(ex - 0.5, tracksBottom)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  const drawLaneMessage = (lane, text) => {
    ctx.fillStyle = '#52525b'
    ctx.font = `11px ${SANS}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, LABEL_W + 12, lane.top + lane.height / 2)
  }

  const drawMidline = (lane) => {
    ctx.strokeStyle = 'rgba(63,63,70,0.45)'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 5])
    ctx.beginPath()
    ctx.moveTo(LABEL_W, Math.round(lane.top + lane.height / 2) + 0.5)
    ctx.lineTo(w, Math.round(lane.top + lane.height / 2) + 0.5)
    ctx.stroke()
    ctx.setLineDash([])
  }

  const drawPositionTrack = (lane) => {
    let minV = Infinity
    let maxV = -Infinity

    for (const p of pts) {
      const v = lane.valueFn(p)
      if (v == null) continue
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }

    if (minV === Infinity) {
      drawLaneMessage(lane, '畫面範圍內沒有軌跡')
      return
    }

    if (maxV - minV < 1e-6) {
      minV -= 1
      maxV += 1
    }

    plotRanges[lane.id] = { min: minV, max: maxV }

    const innerTop = lane.top + 8
    const innerBot = lane.top + lane.height - 8
    const toY = (v) => {
      const t = (v - minV) / (maxV - minV)
      return lane.invert
        ? innerTop + t * (innerBot - innerTop)
        : innerBot - t * (innerBot - innerTop)
    }

    drawMidline(lane)

    ctx.strokeStyle = lane.color
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.beginPath()

    let previous = null

    for (const p of pts) {
      const v = lane.valueFn(p)
      if (v == null) {
        previous = null
        continue
      }

      const px = timeToX(p.frame / fps)
      const py = toY(v)

      if (previous && p.frame - previous.frame <= step * 2 + 10) {
        ctx.lineTo(px, py)
      } else {
        ctx.moveTo(px, py)
      }

      previous = p
    }

    ctx.stroke()
  }

  const drawViewMetric = (lane) => {
    const source = laneSource(lane)
    const viewsReady = source.status === 'ready'
    const reference = referencePoints[lane.metric] || []
    const isUsable = value => Number.isFinite(value) && !(lane.log && value <= 0)

    let minV = Infinity
    let maxV = -Infinity
    const include = (value) => {
      if (!isUsable(value)) return
      if (value < minV) minV = value
      if (value > maxV) maxV = value
    }

    if (viewsReady) {
      for (const series of source.series) {
        for (const point of series[lane.metric]) {
          if (point.frame >= sF && point.frame <= eF) include(point.value)
        }
      }
    }

    for (const point of reference) include(point.value)

    const statusMessage = {
      idle: '沒有 rally 範圍',
      loading: source.loadingText,
      error: source.errorText,
    }[source.status]

    if (minV === Infinity) {
      drawLaneMessage(lane, statusMessage || source.emptyText)
      return
    }

    // 距離和原腳本一樣用對數軸；速度從 0 起算，上限截在 SPEED_AXIS_MAX
    let lo
    let hi

    if (lane.fixedRange) {
      // 固定刻度：不看畫面範圍內的最小最大值
      const [fixedMin, fixedMax] = lane.fixedRange
      lo = lane.log ? Math.log10(fixedMin) : fixedMin
      hi = lane.log ? Math.log10(fixedMax) : fixedMax
      plotRanges[lane.id] = { min: fixedMin, max: fixedMax }
    } else if (lane.log) {
      lo = Math.log10(minV)
      hi = Math.log10(maxV)
      if (hi - lo < 1e-6) {
        lo -= 0.5
        hi += 0.5
      }
      plotRanges[lane.id] = { min: 10 ** lo, max: 10 ** hi }
    } else {
      lo = 0
      hi = Math.min(SPEED_AXIS_MAX, maxV) || 1
      plotRanges[lane.id] = { min: lo, max: hi }
    }

    const innerTop = lane.top + 8
    const innerBot = lane.top + lane.height - 8
    const toY = (value) => {
      const raw = lane.log ? Math.log10(value) : value
      // 固定刻度時超出範圍的值貼在上下緣，不會畫到軌道外看不見
      const t = lane.fixedRange ? Math.min(hi, Math.max(lo, raw)) : raw
      return innerBot - ((t - lo) / (hi - lo)) * (innerBot - innerTop)
    }

    ctx.save()
    ctx.beginPath()
    ctx.rect(LABEL_W, lane.top, w - LABEL_W, lane.height - 1)
    ctx.clip()

    ctx.lineWidth = 1
    ctx.lineJoin = 'round'
    ctx.globalAlpha = 0.85

    for (const series of viewsReady ? source.series : []) {
      ctx.strokeStyle = series.color
      ctx.beginPath()

      let previousFrame = null

      for (const point of series[lane.metric]) {
        if (
          point.frame < sF - 1
          || point.frame > eF + 1
          || !Number.isFinite(point.value)
          || (lane.log && point.value <= 0)
        ) {
          previousFrame = null
          continue
        }

        const px = timeToX(point.frame / fps)
        const py = toY(point.value)

        // 缺格處斷開，同原腳本用 NaN 留空
        if (previousFrame !== null && point.frame - previousFrame === 1) {
          ctx.lineTo(px, py)
        } else {
          ctx.moveTo(px, py)
        }

        previousFrame = point.frame
      }

      ctx.stroke()
    }

    if (reference.length) {
      ctx.globalAlpha = 1
      ctx.strokeStyle = REFERENCE_COLOR
      ctx.lineWidth = 1.4
      ctx.setLineDash([5, 3])
      ctx.beginPath()

      let previousFrame = null

      for (const point of reference) {
        if (!isUsable(point.value)) {
          previousFrame = null
          continue
        }

        const px = timeToX(point.frame / fps)
        const py = toY(point.value)

        if (previousFrame !== null && point.frame - previousFrame <= step) {
          ctx.lineTo(px, py)
        } else {
          ctx.moveTo(px, py)
        }

        previousFrame = point.frame
      }

      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.restore()

    // 兩兩重建還沒好時，參考線照畫，再疊上狀態
    if (statusMessage) drawLaneMessage(lane, statusMessage)
  }

  for (const lane of lanes) {
    if (lane.valueFn) drawPositionTrack(lane)
    else if (lane.metric) drawViewMetric(lane)
  }

  // Rally
  const rallyLane = laneById.rally

  for (const r of rallies) {
    const sx = timeToX(r.start_frame / fps)
    const ex = timeToX(r.end_frame / fps)

    if (ex < LABEL_W || sx > w) continue

    const [fill, accent] = RALLY_STYLES[r.status] || RALLY_STYLES.default
    const isActive = (activeItem?.type === 'rally' && activeItem.id === r.id) || currentRally?.id === r.id
    const barY = rallyLane.top + 4
    const barH = rallyLane.height - 8
    const barW = Math.max(2, ex - sx)

    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.roundRect(sx, barY, barW, barH, 3)
    ctx.fill()

    ctx.fillStyle = accent
    ctx.fillRect(sx, barY, Math.min(2, barW), barH)

    if (isActive) {
      ctx.strokeStyle = accent
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(sx + 0.5, barY + 0.5, barW - 1, barH - 1, 3)
      ctx.stroke()
    }

    // 標籤貼著可見範圍左緣，捲動時還看得到
    const text = `R${r.rally_index}`
    ctx.font = `600 10px ${SANS}`
    const labelX = Math.max(sx, LABEL_W) + 7
    if (labelX + ctx.measureText(text).width < ex - 4) {
      ctx.fillStyle = isActive ? '#f4f4f5' : '#a1a1aa'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, labelX, barY + barH / 2 + 0.5)
    }
  }

  // 擊球：線穿過曲線軌道，標籤放在自己那條
  for (const hItem of hits) {
    const isDraggingThis = draggingHit?.id === hItem.id
    const frame = isDraggingThis && draggingHit.currentFrame !== undefined
      ? draggingHit.currentFrame
      : (hItem.new_hit_frame ?? hItem.hit_frame)

    const hx = Math.round(timeToX(frame / fps)) + 0.5

    if (hx < LABEL_W - 40 || hx > w + 40) continue

    const isLow = (hItem.confidence ?? 1) < 0.5
    const isHovered = hoveredHit === hItem.id || isDraggingThis
    const lineColor = isHovered ? '#22d3ee' : isLow ? 'rgba(244,63,94,0.7)' : 'rgba(228,228,231,0.28)'

    ctx.strokeStyle = lineColor
    ctx.lineWidth = isHovered ? 1.5 : 1
    ctx.setLineDash(isHovered ? [] : [3, 4])
    ctx.beginPath()
    ctx.moveTo(hx, hitsLane.top + hitsLane.height)
    ctx.lineTo(hx, tracksBottom)
    ctx.stroke()
    ctx.setLineDash([])

    const label = hItem.shot_type || 'Hit'
    ctx.font = `10px ${SANS}`
    const pillW = Math.max(28, ctx.measureText(label).width + 12)
    const pillH = hitsLane.height - 6
    const pillX = hx - pillW / 2
    const pillY = hitsLane.top + 3

    ctx.fillStyle = isHovered ? '#083344' : '#18181b'
    ctx.strokeStyle = isHovered ? '#22d3ee' : isLow ? '#f43f5e' : '#3f3f46'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = isHovered ? '#67e8f9' : isLow ? '#fda4af' : '#d4d4d8'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, hx, pillY + pillH / 2 + 0.5)
  }

  ctx.restore()

  // 尺規
  ctx.fillStyle = '#0b0b0e'
  ctx.fillRect(LABEL_W, 0, w - LABEL_W, RULER_H)
  ctx.fillStyle = '#27272a'
  ctx.fillRect(0, RULER_H - 1, w, 1)

  const minorDivisions = tickStep * pxPerSec / 5 >= 10 ? 5 : 2
  const minorStep = tickStep / minorDivisions

  ctx.fillStyle = '#3f3f46'
  for (
    let i = Math.max(0, Math.ceil(sSec / minorStep));
    i <= Math.floor(eSec / minorStep);
    i++
  ) {
    if (i % minorDivisions === 0) continue
    const tx = Math.round(timeToX(i * minorStep))
    if (tx >= LABEL_W) ctx.fillRect(tx, RULER_H - 5, 1, 4)
  }

  ctx.font = `10px ${MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  for (let i = firstTick; i <= lastTick; i++) {
    const tx = Math.round(timeToX(i * tickStep))
    if (tx < LABEL_W) continue

    ctx.fillStyle = '#52525b'
    ctx.fillRect(tx, RULER_H - 9, 1, 8)

    ctx.fillStyle = '#a1a1aa'
    ctx.fillText(formatTick(i * tickStep, tickStep), tx + 4, RULER_H - 15)
  }

  // 播放線
  const cx = Math.round(getPlayheadX()) + 0.5

  if (cx >= LABEL_W && cx <= w) {
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(cx, RULER_H - 4)
    ctx.lineTo(cx, h)
    ctx.stroke()

    const badge = `F ${currentFrame}`
    ctx.font = `600 10px ${MONO}`
    const badgeW = ctx.measureText(badge).width + 12
    const badgeH = 16
    const badgeX = Math.max(LABEL_W + 2, Math.min(w - badgeW - 2, cx - badgeW / 2))
    const badgeY = 3

    ctx.fillStyle = '#0891b2'
    ctx.beginPath()
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3)
    ctx.fill()

    ctx.beginPath()
    ctx.moveTo(cx - 4, badgeY + badgeH)
    ctx.lineTo(cx + 4, badgeY + badgeH)
    ctx.lineTo(cx, badgeY + badgeH + 5)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = '#ecfeff'
    ctx.textAlign = 'center'
    ctx.fillText(badge, badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.5)
  }

  // 左側標籤欄
  ctx.fillStyle = '#0b0b0e'
  ctx.fillRect(0, 0, LABEL_W, h)
  ctx.fillStyle = '#27272a'
  ctx.fillRect(LABEL_W - 1, 0, 1, h)
  ctx.fillRect(0, RULER_H - 1, LABEL_W, 1)

  ctx.fillStyle = '#d4d4d8'
  ctx.font = `11px ${MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(formatClock(currentTime), 12, RULER_H / 2)

  const currentPoint = trajMap.get(currentFrame)

  for (const lane of lanes) {
    ctx.fillStyle = '#1c1c21'
    ctx.fillRect(0, lane.top + lane.height - 1, LABEL_W, 1)

    if (!lane.valueFn && !lane.metric) {
      ctx.fillStyle = '#71717a'
      ctx.font = `11px ${SANS}`
      ctx.textAlign = 'left'
      ctx.fillText(lane.label, 12, lane.top + lane.height / 2)
      continue
    }

    const rowY = lane.top + 13

    if (lane.color) {
      ctx.fillStyle = lane.color
      ctx.fillRect(0, lane.top, 2, lane.height - 1)
    }

    ctx.fillStyle = '#e4e4e7'
    ctx.font = `600 11px ${SANS}`
    ctx.textAlign = 'left'
    ctx.fillText(lane.label, 12, rowY)
    const labelWidth = ctx.measureText(lane.label).width

    ctx.fillStyle = '#52525b'
    ctx.font = `10px ${SANS}`
    ctx.fillText(lane.unit, 12 + labelWidth + 5, rowY)

    // 播放線所在 frame 的值
    const currentValue = lane.valueFn && currentPoint ? lane.valueFn(currentPoint) : null
    if (currentValue != null) {
      ctx.fillStyle = lane.color
      ctx.font = `10px ${MONO}`
      ctx.textAlign = 'right'
      ctx.fillText(currentValue.toFixed(2), LABEL_W - 8, rowY)
    }

    const range = plotRanges[lane.id]

    if (lane.metric && range) {
      ctx.fillStyle = '#52525b'
      ctx.font = `9px ${MONO}`
      ctx.textAlign = 'right'
      ctx.fillText(
        `${formatAxisValue(range.min)}–${formatAxisValue(range.max)}`,
        LABEL_W - 8,
        rowY,
      )
    }

    if (lane.metric === 'consistency' && lane.height >= 36) {
      // 圖例那一行寫播放線所在這格的值和用了幾台
      const row = consistencyByFrame.get(currentFrame)
      ctx.font = `600 10px ${MONO}`
      ctx.textAlign = 'left'
      ctx.fillStyle = row ? '#e4e4e7' : '#52525b'
      ctx.fillText(row ? `${row.value.toFixed(1)} · ${row.viewCount} 台` : '這格 —', 12, lane.top + 29)
    } else if (lane.metric && lane.height >= 36) {
      const { series: laneSeries } = laneSource(lane)
      const spacing = Math.min(16, (LABEL_W - 24) / Math.max(1, laneSeries.length - 1))
      ctx.font = `600 10px ${MONO}`
      ctx.textAlign = 'center'
      laneSeries.forEach((series, order) => {
        ctx.fillStyle = series.color
        ctx.fillText(String(series.cameraIndex), 15 + order * spacing, lane.top + 29)
      })
    }

    if (lane.valueFn && range && lane.height >= 36) {
      ctx.fillStyle = '#52525b'
      ctx.font = `9px ${MONO}`
      ctx.textAlign = 'left'
      ctx.fillText(
        `${formatAxisValue(range.min)} – ${formatAxisValue(range.max)}`,
        12,
        lane.top + lane.height - 10,
      )
    }
  }
}
