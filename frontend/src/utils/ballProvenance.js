/*
 * 說明顯示軌跡每一格的位置是怎麼決定的：用了哪一種來源、為什麼沒用
 * 2D 重建點、之後各步驟又把它移了多少。資料來自 useRallyBallData 的
 * trace（每一步的中間結果）。
 */

// 移動小於這個距離（公尺）的步驟不列出來
const MIN_SHIFT = 0.005

const MODE_TEXT = {
  repair: '修復模式：顯示 ball_traj',
  ball_traj: '「軌跡」選了 ball_traj：顯示學長姐的軌跡',
  pure_loading: '純 2D：2D 重建點載入中',
  pure_no_2d: '純 2D：這段沒有可用的 2D 重建點，不顯示',
}

// simulateMissingFrames 補出來的點，依可靠程度由高到低
const SIMULATED_TEXT = {
  split: '模擬（拆段物理擬合）：這段接不起來，拆成兩段飛行（多半漏抓了一次擊球）各自擬合',
  relaxed: '模擬（放寬的物理擬合）：這段接不起來，放寬條件後擬合的軌跡',
  bridge: '模擬（往擊球推）：前後兩段飛行各自沿物理軌跡往擊球推、在擊球處交接',
  extend: '模擬（往外推）：沿最後一段的物理軌跡往外推，推到落地或出界為止',
  hold: '發球前：球還在發球員手上，固定在第一個重建點的位置（不往回推拋物線）',
  arc: '模擬（重力拋物線）：其他方法都推不出來，兩側的點之間接一條只受重力的拋物線，最不可靠',
}

const cm = meters => `${(meters * 100).toFixed(1)} 公分`

const byFrame = points => new Map((points || []).map(point => [point.frame, point]))

const distance = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : 0)


function describeSource(point) {
  switch (point?.source) {
    case 'pairwise':
      return (point.cameraCount === 2
        ? '2D 重建：只有 2 台相機拍到（1 組配對）'
        : `2D 重建：${point.cameraCount ?? '?'} 台相機拍到，${point.pairCount ?? '?'} 組配對互相同意`)
        + (point.usedCameras?.length ? `，用 cam ${point.usedCameras.join('、')}` : '')
    case 'single':
      return `1 台相機補點：cam ${point.cameraIndex} 的標註視線`
        + (point.plane ? '與鉛直面的交點' : '上、離軌跡最近的點')
        + `（從軌跡移了 ${cm(point.correction)}）`
    case 'physics':
      return point.extrapolated
        ? `物理擬合外推：沿著這段飛行擬合的軌跡往外推 ${point.extrapolated} 格（離觀測點 RMS ${cm(point.physicsRms)}）`
        : `物理擬合：前後段接得起來（離觀測點 RMS ${cm(point.physicsRms)}），補這格沒拍到的部分`
    case 'interp':
      return `內插：前後的點擬合二次曲線（等加速度）補這 ${point.gap} 格的空檔`
    case 'simulated':
      return SIMULATED_TEXT[point.method] || '模擬'
    default:
      return '這格沒有球的位置'
  }
}


// 沒有位置的格子：為什麼沒有用 2D
function whyNot2D(frame, { raw, single, trace, settings }) {
  if (raw) {
    if (raw.pair_count === 1 && raw.camera_count >= 3) {
      return `有重建點但不用：${raw.camera_count} 台相機只有 1 組配對互相同意（標註彼此矛盾）`
    }
    if (raw.pair_count === 1 && raw.camera_count === 2 && !settings.extraViews.twoCamera) {
      return '有 2 台相機的重建點，但「補點」沒開'
    }
    if (!settings.isInsideCourt(raw)) return '有重建點但落在球場範圍外'
    if (trace.outlierFrames?.has(frame)) return '有重建點但飛行分析判定為跳點（凸出去一格又回到弧上）'

    return '有重建點但離前後鄰點擬合的弧超過 0.5 公尺，剔除（所在飛行段也接不起來，沒有物理擬合可補）'
  }

  if (single) {
    return settings.extraViews.singleCamera
      ? `只有 cam ${single.cameraIndex} 拍到，但 1 台補點沒通過（要移超過 0.5 公尺、落在場外、或接不上前後的弧）`
      : `只有 cam ${single.cameraIndex} 拍到，「補點」沒開到 1 台`
  }

  return '沒有 2D 重建點（停下來時下方列出各相機配對的結果）'
}


/**
 * 回傳 { mode, modeText, get(frame) → { source, title, notes: [字串],
 * adjustments: [{ label, shift }] } | null }。
 */
export function buildBallProvenance({ trace, rawPairwise, singleViewObservations, contacts, settings }) {
  if (trace.mode !== 'pure') {
    return { mode: trace.mode, modeText: MODE_TEXT[trace.mode] || '', get: () => null }
  }

  const { withSingles, projected, smoothed, snapped } = trace.stages
  const stage = {
    decided: byFrame(withSingles),
    projected: byFrame(projected),
    smoothed: byFrame(smoothed),
    snapped: byFrame(snapped),
    final: byFrame(trace.final),
  }
  const rawByFrame = byFrame(rawPairwise)
  const singleByFrame = byFrame(singleViewObservations)
  const anchorFrames = new Set((contacts || []).map(contact => contact.lastFrameBefore))

  return {
    mode: trace.mode,
    modeText: '',
    get: (frame) => {
      const final = stage.final.get(frame)
      // 純 2D 最後一步模擬出來的點不在中間結果裡
      const decided = stage.decided.get(frame) || (final?.source === 'simulated' ? final : null)

      // 沒有位置的格子：說明為什麼不顯示
      if (!decided || !final) {
        return {
          source: 'none',
          title: trace.physicsModel
            ? '純 2D：這格不顯示（在第一個重建點之前或最後一個之後，物理軌跡也推不到這裡）'
            : '純 2D：這格沒有重建點，物理模型關著，不補',
          notes: [whyNot2D(frame, {
            raw: rawByFrame.get(frame),
            single: singleByFrame.get(frame),
            trace,
            settings,
          })],
          adjustments: [],
        }
      }

      const notes = []

      if (anchorFrames.has(frame)) notes.push('擊球前最後一格：球拍拍面中心對準這一格')
      if (final.despiked) {
        notes.push(`閃電修正：這格跳出前後的軌跡 ${cm(final.despiked)}，換成前後 3 格接起來的位置`)
      }

      const steps = [
        ['移到鉛直面', decided, stage.projected.get(frame)],
        ['平滑', stage.projected.get(frame), stage.smoothed.get(frame)],
        ['放回標註視線', stage.smoothed.get(frame), stage.snapped.get(frame)],
        ['不回飛修正', stage.snapped.get(frame), final.despiked ? null : final],
      ]

      const adjustments = steps
        .map(([label, before, after]) => ({ label, shift: distance(before, after) }))
        .filter(step => step.shift >= MIN_SHIFT)

      return { source: decided.source, title: describeSource(decided), notes, adjustments }
    },
  }
}
