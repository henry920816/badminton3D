import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAppStore } from '../store.js'
import {
  RECONSTRUCTION_AGREEMENT_PX,
  RECONSTRUCTION_CAMERA_MAX_DISTANCE,
} from './usePairwiseBallPoints.js'


// 查過的格子留著，來回看同一格不重打後端
const cache = new Map()


/**
 * 目前這一格的兩兩重建說明（後端 /traj2d/pairwise/explain）。播放中不抓，
 * 停下來 150 ms 後才抓，回傳 { status, data }。
 */
export function usePairwiseExplanation(frame) {
  const matchId = useAppStore(state => state.matchId)
  const source = useAppStore(state => state.ball2DSource)
  const revision = useAppStore(state => state.pairwiseRevision)
  const correctionTick = useAppStore(state => state.ball2DCorrectionTick)
  const playing = useAppStore(state => state.playing)
  const key = matchId != null && Number.isFinite(frame)
    ? `${matchId}:${source}:${revision}:${correctionTick?.seq ?? 0}:${frame}`
    : null
  const [state, setState] = useState({ key: null, status: 'idle', data: null })

  useEffect(() => {
    if (!key || playing) return undefined

    if (cache.has(key)) {
      setState({ key, status: 'ready', data: cache.get(key) })
      return undefined
    }

    let cancelled = false
    const timer = setTimeout(() => {
      setState({ key, status: 'loading', data: null })

      api.explainPairwiseFrame(
        matchId,
        frame,
        source,
        RECONSTRUCTION_CAMERA_MAX_DISTANCE,
        RECONSTRUCTION_AGREEMENT_PX,
      )
        .then((data) => {
          if (cache.size > 500) cache.clear()
          cache.set(key, data)
          if (!cancelled) setState({ key, status: 'ready', data })
        })
        .catch(() => {
          if (!cancelled) setState({ key, status: 'error', data: null })
        })
    }, 150)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, playing])

  if (playing) return { status: 'playing', data: null }
  if (state.key !== key) return { status: 'loading', data: null }

  return state
}


const camList = cameras => cameras.map(index => `cam ${index}`).join('、')


function describePair(pair, threshold, minAngle) {
  const name = `${pair.cameras[0]}–${pair.cameras[1]}`

  switch (pair.status) {
    case 'ok':
      return `${name} ✓（${pair.supporters.join('、')} 同意）`
    case 'support': {
      // 不同意的相機各差多少
      const others = (pair.camera_errors || [])
        .filter(item => !pair.supporters.includes(item.camera))
        .map(item => `cam ${item.camera} 差 ${item.px.toFixed(1)} px`)
      return `${name} ✗ 只有 ${pair.supporters.join('、')} 同意` + (others.length ? `（${others.join('、')}）` : '')
    }
    case 'reprojection':
      return `${name} ✗ 兩台互相差 ${pair.max_error_px.toFixed(1)} px（> ${threshold}）`
    case 'parallel':
      return pair.angle_deg == null
        ? `${name} ✗ 兩台相機位置重疊`
        : `${name} ✗ 視線夾角 ${pair.angle_deg.toFixed(1)}°（< ${minAngle}°）`
    default:
      return `${name} ✗ 重建失敗`
  }
}


/**
 * 猜是哪幾台的標註有問題：每台相機看「不含它的配對」重建出來的點，投影
 * 到它身上差多少，取中位數 —— 別人一致認定的位置和它的標註差多遠。
 * 中位數超過門檻的就是可疑的相機，依差距由大到小排。都沒超過時回傳
 * 各台的差距，讓使用者知道是「大家都只差一點點」。
 */
function cameraDisagreement(explanation) {
  const rows = []

  for (const index of explanation.cameras) {
    const errors = explanation.pairs
      .filter(pair => !pair.cameras.includes(index))
      .flatMap(pair => (pair.camera_errors || []).filter(item => item.camera === index).map(item => item.px))
      .sort((a, b) => a - b)

    if (errors.length) rows.push({ camera: index, px: errors[errors.length >> 1] })
  }

  return rows.sort((a, b) => b.px - a.px)
}


// brief：重建成功時只列通過的配對，失敗時才逐組列出原因（組數多時太長）
function describeAttempt(explanation, label, threshold, minAngle, brief) {
  const lines = []

  lines.push(
    `${label}${camList(explanation.cameras)} 有標註`
    + (explanation.cameras.length >= 2 ? `，要 ${explanation.required_support} 台同意同一個點` : ''),
  )

  if (!explanation.pairs.length) return lines

  if (brief) {
    const passed = explanation.pairs.filter(pair => pair.status === 'ok')
    const failed = explanation.pairs.length - passed.length

    lines.push(
      `通過的配對：${passed.map(pair => pair.cameras.join('–')).join('、') || '無'}`
      + (failed ? `（另 ${failed} 組沒通過）` : ''),
    )
  } else {
    lines.push(`配對：${explanation.pairs.map(pair => describePair(pair, threshold, minAngle)).join('；')}`)
  }

  return lines
}


/**
 * 把後端的說明整理成幾行中文（BallProvenanceBar 用）。
 */
export function formatPairwiseExplanation(explanation) {
  if (!explanation) return []

  if (!explanation.cameras.length) return ['沒有任何有相機參數的相機標到這格']
  if (explanation.cameras.length === 1) return [`只有 cam ${explanation.cameras[0]} 有標註，配不出組`]

  const threshold = explanation.reprojection_threshold_px
  const minAngle = explanation.min_ray_angle_deg
  const brief = Boolean(explanation.result)
  const lines = describeAttempt(explanation, '', threshold, minAngle, brief && !explanation.retry)

  for (const item of explanation.limited) {
    if (item.distance == null) {
      lines.push(`cam ${item.camera} 只在 ${item.limit} 公尺內用；全部一起配對都通不過，拿掉 cam ${item.camera} 重試`)
    } else if (item.dropped) {
      lines.push(`cam ${item.camera} 離球 ${item.distance.toFixed(1)} 公尺（> ${item.limit}），拿掉重算`)
    } else {
      lines.push(`cam ${item.camera} 離球 ${item.distance.toFixed(1)} 公尺（≤ ${item.limit}），照用`)
    }
  }

  if (explanation.retry) lines.push(...describeAttempt(explanation.retry, '重試：', threshold, minAngle, brief))

  const final = explanation.retry || explanation
  const disagreement = cameraDisagreement(final)
  const describe = rows => rows.map(row => `cam ${row.camera} 差 ${row.px.toFixed(1)} px`).join('、')

  if (explanation.result) {
    const used = explanation.result.used_cameras
    const unused = disagreement.filter(row => !used.includes(row.camera))

    lines.push(
      `結果：用 ${camList(used)} 重建`
      + (unused.length ? `；沒用到 ${describe(unused)}（和其他台一致的位置對不上）` : ''),
    )
  } else {
    const suspects = disagreement.filter(row => row.px > threshold)
    // 至少要有兩台互相一致，才說得出是「其他台」和誰對不上
    const consistent = final.cameras.length - suspects.length

    if (suspects.length && consistent >= 2) {
      lines.push(`結果：沒有重建點；其他台一致的位置和這幾台的標註對不上，可能是它們偏了：${describe(suspects)}`)
    } else if (disagreement.length) {
      lines.push(`結果：沒有重建點；每一台和其他台的點都差一些，判斷不出是哪一台偏了（${describe(disagreement)}，門檻 ${threshold} px）`)
    } else {
      lines.push('結果：沒有重建點；所有配對都沒有通過自己的檢查，無法比較各台')
    }
  }

  return lines
}
