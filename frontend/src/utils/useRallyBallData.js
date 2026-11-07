import { createContext, createElement, useContext, useMemo } from 'react'
import { useAppStore } from '../store.js'
import {
  PAIRWISE_FLIGHT_OPTIONS,
  buildBallFlightPath,
  toThreeVector,
} from './ballPath.js'
import {
  SMOOTHING_LEVELS,
  enforceForwardFlight,
  fitFlightPlanes,
  fillShortGaps,
  filterPairwisePoints,
  fitSingleViewPoints,
  overlayPhysicalFlights,
  projectOntoFlightPlanes,
  removeSpikes,
  smoothBallTrajectory,
  snapSingleViewPoints,
} from './mergeBallTrajectory.js'
import { imagePointToRay } from './cameraProjection.js'
import { buildBallProvenance } from './ballProvenance.js'
import { simulateMissingFrames } from './simulateGaps.js'
import {
  RECONSTRUCTION_CAMERA_MAX_DISTANCE,
  useBall2DRangeLabels,
  usePairwiseBallPoints,
} from './usePairwiseBallPoints.js'


// 相機組合少於這個數的格子不拿來偵測擊球：只有 1 組時，
// 和 ball_traj 的差距 p90 達 9 公尺
const MIN_PAIRWISE_PAIRS = 2


/**
 * 純 2D 軌跡要不要多用幾種 2D 標註較少的格子（store 的 extraViewLevel）：
 *   0 只用 2 組以上相機組合的重建點
 *   1 再加只有 2 台相機拍到的格子（只配得出 1 組，後端已要求兩台的
 *     重投影都在 12 px 內）
 *   2 再加只有 1 台相機拍到的格子，把先驗位置移到那條視線上（見
 *     fitSingleViewPoints）
 * 兩種都要在球場範圍內、也要和前後鄰點的飛行弧接得上（同重建點的檢查），
 * 但不拿去偵測擊球，擊球的判斷和原本一樣。
 *
 * 以下是完全不用 cam 3、4 時量的（現在改成只在球夠近時用，見
 * RECONSTRUCTION_CAMERA_MAX_DISTANCE）。match 1 前 30
 * 個 rally 實測（8995 格）：2 台的 543 格在球場內，521 格通過；1 台的
 * 1377 格裡 402 格通過（其餘大多離軌跡好幾公尺，是誤偵測）。
 *   - 拿 3 台以上的格子任取 2 台重建，和共識點差 med 4.4 / p90 14 公分
 *   - 藏掉 30 格重建點、用其中 1 台的標註補回：和共識點的距離從接縫後
 *     先驗的 med 4.9 / p90 9.7 變成 4.4 / 9.2 公分（但共識點本身含那台的
 *     標註，偏向補點）；其他相機的重投影誤差 10.6 → 11.9 px，略差。
 *     含 cam 3、4 時補點明顯變差（p90 11 → 19 公分）
 */
export const EXTRA_VIEW_LEVELS = [
  { label: '關', twoCamera: false, singleCamera: false },
  { label: '2 台', twoCamera: true, singleCamera: false },
  { label: '2 台 + 1 台', twoCamera: true, singleCamera: true },
]

// 球場在 raw 座標的範圍：x 是寬、z 是長，y 朝下、地板在 y = 0.5
const COURT_HALF_WIDTH = 3.05
const COURT_HALF_LENGTH = 6.7
const COURT_FLOOR_Y = 0.5

// 出界球會飛到線外一點（ball_traj 最遠到底線外約 1 公尺），貼線的
// 出界球不要丟。match 1 實測：2 組相機的點落在這個範圍外的，和
// ball_traj 差距中位數 5 公尺，全是錯的重建；範圍內的只差 18 公分
const COURT_MARGIN = 0.5

// 地板以下容許的誤差、以及往上最高多少公尺
const COURT_FLOOR_TOLERANCE = 0.2
const COURT_MAX_HEIGHT = 12


function isInsideCourt(point) {
  return (
    Math.abs(point.x) <= COURT_HALF_WIDTH + COURT_MARGIN
    && Math.abs(point.z) <= COURT_HALF_LENGTH + COURT_MARGIN
    && point.y <= COURT_FLOOR_Y + COURT_FLOOR_TOLERANCE
    && point.y >= COURT_FLOOR_Y - COURT_MAX_HEIGHT
  )
}


function collectRangePoints(trajByFrame, startFrame, endFrame) {
  if (startFrame == null || endFrame == null) return []

  const points = []

  for (let frame = startFrame; frame <= endFrame; frame += 1) {
    const point = trajByFrame.get(frame)

    if (point) points.push(point)
  }

  return points
}


/**
 * 目前在看的 frame 範圍：有 in/out 選取就用選取範圍，否則用目前
 * （或下一個）rally。沒有 rally 時兩者都是 null。
 */
export function useRallyFrameRange() {
  const selection = useAppStore(state => state.selection)
  const fps = useAppStore(state => state.fps) || 60
  const rallies = useAppStore(state => state.rallies) || []
  const currentFrame = useAppStore(state => state.currentFrame)

  return useMemo(
    () => {
      const inTime = selection.inTime
      const outTime = selection.outTime

      // 使用者拉了 in/out 就以選取範圍為準
      if (inTime != null && outTime != null) {
        return {
          startFrame: Math.max(
            0,
            Math.floor(Math.min(inTime, outTime) * fps),
          ),
          endFrame: Math.max(
            0,
            Math.ceil(Math.max(inTime, outTime) * fps),
          ),
        }
      }

      const sortedRallies = [...rallies].sort(
        (first, second) => first.start_frame - second.start_frame,
      )

      const targetRally = sortedRallies.find(
        rally => currentFrame <= rally.end_frame,
      )

      if (!targetRally) return { startFrame: null, endFrame: null }

      return {
        startFrame: targetRally.start_frame,
        endFrame: targetRally.end_frame,
      }
    },
    [selection.inTime, selection.outTime, fps, currentFrame, rallies],
  )
}


/**
 * 目前要顯示的那段球軌跡，以及那段裡推算出來的擊球位置。整個 app 只在
 * RallyBallDataProvider 算一次，各元件用 useRallyBallData 讀同一份。
 *
 * 軌跡線畫的是 ball_traj，擊球卻是用 2D 標註兩兩重建的 3D 點去猜：
 * ball_traj 不一定準，而擊球前球最慢，2D 標註在那裡相對準。
 * 每次擊球的 anchor 是擊球前最後一格的重建點，球拍拍面中心要對準它。
 *
 * displayPoints 是 3D 場景、影片 3D→2D 疊圖與時間軸 3D 參考顯示用的軌跡：
 * 選了純 2D 就是 buildPure2DTrace 的結果，選了 ball_traj 或在修復模式時
 * 就是 ball_traj —— 修復模式改的是 ball_traj 的點，那時要看到、點得到的
 * 就是它。
 */
/**
 * 純 2D 模式：只用 2D 重建與物理擬合，完全不讀 ball_traj。
 *   1. 重建點（2 組以上，加上補點設定的 2 台）檢查：飛行分析的跳點、
 *      離前後鄰點的弧超過 0.5 公尺的剔除（見 filterPairwisePoints）
 *   2. 每段飛行用重建點擬合物理軌跡，接得起來就補中間沒有重建點的格子
 *      （overlayPhysicalFlights），段頭段尾再沿著軌跡往外推最多
 *      PURE_EXTRAPOLATE_FRAMES 格；切段只用重建點偵測到的擊球
 *   2b. 還空著、前後都有點的短空檔（不超過 PURE_FILL_GAP 格）用兩側的點
 *      擬合二次曲線補（fillShortGaps）—— 物理擬合接不起來的段也補得到
 *   5. 剩下的格子不管把握多少都盡量模擬（simulateMissingFrames）：拆段
 *      或放寬的物理擬合、往擊球推並交接、往外推到落地、重力拋物線接起來。
 *      放在平滑之後，模擬的點不會透過平滑影響真的重建點
 *   3. 補點設定到 1 台時，物理擬合補出來的格子再用那台的標註視線修正
 *   4. 平滑照設定；再做鉛直面、不回飛、去閃電
 * 沒有重建點、也不在接得起來的飛行段中間的格子沒有位置（不顯示）。
 *
 * 物理模型（physicsModel）關掉時只做 1 和平滑：只畫通過檢查的重建點，
 * 沒有重建點的格子空著，也不做鉛直面、不回飛、去閃電。1 台補點要拿
 * 物理擬合補出來的位置當先驗，所以也一起不做。
 */
// 純 2D 模式補空檔的範圍。match 1 前 30 個 rally，藏掉真的有重建點的格子、
// 看補回來和原本差多少（中位數 / p90，公分）：
//   內插（二次曲線）：空 2 格 2.5 / 6.2、4 格 2.9 / 7.0、6 格 3.4 / 8.6、
//     8 格 4.3 / 10.7、10 格 4.4 / 11.4、12 格 4.6 / 11.6；6 格以內和物理
//     擬合一樣或更好，更長時物理擬合較好（10 格 4.0 / 7.5），但會走到這一步
//     的正是物理擬合接不起來的段
//   外推（物理擬合）：擊球前 5 格內 7.3 / 16、擊球後 5 格內 8.5 / 19.5；
//     推到 10 格時偶爾會飛掉（p90 83），局部二次曲線外推更差
const PURE_FILL_GAP = 10
const PURE_EXTRAPOLATE_FRAMES = 5


function buildPure2DTrace({
  observations,
  singleViewObservations,
  flightPath,
  fps,
  physicsModel,
  smoothingLevel,
  startFrame,
  endFrame,
}) {
  if (!observations.length) return { final: [], mode: 'pure_no_2d' }

  // 擊球、跳點只用重建點那次的飛行分析；沒有的話（只有 2 台的點）整段當一段
  const contacts = flightPath.fromPairwise ? flightPath.contacts : []
  const outlierFrames = new Set(flightPath.fromPairwise ? flightPath.outliers.map(entry => entry.frame) : [])
  const halfWindow = SMOOTHING_LEVELS[smoothingLevel]?.halfWindow ?? 0

  const reconstructed = filterPairwisePoints(observations, outlierFrames, contacts)

  if (!physicsModel) {
    const smoothed = smoothBallTrajectory(reconstructed, contacts, { halfWindow })

    return {
      final: smoothed,
      mode: 'pure',
      physicsModel: false,
      outlierFrames,
      planeByFrame: new Map(),
      stages: { withSingles: reconstructed, projected: reconstructed, smoothed, snapped: smoothed },
    }
  }

  const withPhysics = fillShortGaps(
    overlayPhysicalFlights(reconstructed, observations, fps, contacts, [], {
      extrapolateFrames: PURE_EXTRAPOLATE_FRAMES,
      isInside: isInsideCourt,
      // 第一個重建點之前是發球前，球在手上
      noExtrapolateBefore: Math.min(...observations.map(point => point.frame)),
    }),
    contacts,
    PURE_FILL_GAP,
  )

  const planeByFrame = fitFlightPlanes(withPhysics, contacts)

  let withSingles = withPhysics

  if (singleViewObservations.length) {
    const singles = fitSingleViewPoints(withPhysics, singleViewObservations, {
      contacts,
      isInside: isInsideCourt,
      planeAt: frame => planeByFrame.get(frame),
      priorSources: ['physics', 'interp'],
    })

    if (singles.length) {
      const singleByFrame = new Map(singles.map(point => [point.frame, point]))
      withSingles = withPhysics.map(point => singleByFrame.get(point.frame) || point)
    }
  }

  const projected = planeByFrame.size ? projectOntoFlightPlanes(withSingles, planeByFrame) : withSingles
  const smoothed = smoothBallTrajectory(projected, contacts, { halfWindow })
  const snapped = snapSingleViewPoints(smoothed)

  // 最後才把還空著的格子盡量模擬出來：放在平滑之後，模擬的點才不會
  // 透過平滑把真的重建點拉走
  // 不回飛先只對真的資料做，模擬之後再做一次、但只讓模擬的點讓開
  const forward = enforceForwardFlight(snapped, contacts)
  const simulated = simulateMissingFrames({
    points: forward,
    observations,
    contacts,
    fps,
    rangeStart: startFrame,
    rangeEnd: endFrame,
  })
  const forwardAgain = enforceForwardFlight(simulated, contacts, [], {
    weightOf: point => (point.source === 'simulated' ? 1 : 1e6),
  })
  // 最後保證沒有閃電（見 removeSpikes）
  const final = removeSpikes(forwardAgain)

  return {
    final,
    mode: 'pure',
    physicsModel: true,
    outlierFrames,
    planeByFrame,
    // 模擬的點不在這些中間結果裡，說明時從 final 認（source 'simulated'）
    stages: { withSingles, projected, smoothed, snapped },
  }
}


function useRallyBallDataValue() {
  const fps = useAppStore(state => state.fps) || 60
  const matchId = useAppStore(state => state.matchId)
  const trajByFrame = useAppStore(state => state.trajByFrame)
  const trajectoryDisplaySource = useAppStore(state => state.trajectoryDisplaySource)
  const repairMode = useAppStore(state => state.repairMode)
  const smoothingLevel = useAppStore(state => state.displaySmoothingLevel)
  const extraViewLevel = useAppStore(state => state.extraViewLevel)
  const extraViews = EXTRA_VIEW_LEVELS[extraViewLevel] || EXTRA_VIEW_LEVELS[0]
  const cameras = useAppStore(state => state.cameras)
  const physicsModel = useAppStore(state => state.usePhysicsModel)
  const { startFrame, endFrame } = useRallyFrameRange()

  const points = useMemo(
    () => collectRangePoints(trajByFrame, startFrame, endFrame),
    [trajByFrame, startFrame, endFrame],
  )

  const pairwise = usePairwiseBallPoints(matchId, startFrame, endFrame)

  // 3D 場景畫的兩兩重建軌跡也用這一批，看到的就是擊球偵測看到的
  const pairwisePoints = useMemo(
    () => (pairwise.points || [])
      .filter(point => point.pair_count >= MIN_PAIRWISE_PAIRS && isInsideCourt(point)),
    [pairwise],
  )

  // 只有 2 台相機拍到的格子：只配得出 1 組。3 台以上卻只有 1 組互相
  // 同意的不算，那是標註彼此矛盾
  const twoCameraPoints = useMemo(
    () => (pairwise.points || [])
      .filter(point => point.pair_count === 1 && point.camera_count === 2 && isInsideCourt(point)),
    [pairwise],
  )

  const projectionByCamera = useMemo(
    () => new Map(
      (cameras || [])
        .filter(camera => camera?.projection?.intrinsic && camera?.projection?.extrinsic)
        .map(camera => [Number(camera.index), camera.projection]),
    ),
    [cameras],
  )

  // 1 台相機的格子要各相機的 2D 標註；相機還沒載入時不抓（會快取成空）
  const labels = useBall2DRangeLabels(
    extraViews.singleCamera && projectionByCamera.size ? matchId : null,
    startFrame,
    endFrame,
  )

  // 只有 1 台相機看得到球、也沒有重建點的格子，換成那台相機的視線
  const singleViewObservations = useMemo(
    () => {
      if (labels.status !== 'ready') return []

      const pairwiseFrames = new Set((pairwise.points || []).map(point => point.frame))
      const labelsByFrame = new Map()

      for (const label of labels.points) {
        if (!projectionByCamera.has(Number(label.camera_index))) continue
        if (!labelsByFrame.has(label.frame)) labelsByFrame.set(label.frame, [])
        labelsByFrame.get(label.frame).push(label)
      }

      const observations = []

      for (const [frame, frameLabels] of labelsByFrame) {
        if (pairwiseFrames.has(frame)) continue

        // 只在球夠近時才用的相機（cam 3、4）沒有重建點時多半是太遠了：
        // 它和另一台一起拍到時，那一格算成只有另一台；只有它拍到時才用
        // 它，並在補點時檢查距離
        const unlimited = frameLabels.filter(label => !(label.camera_index in RECONSTRUCTION_CAMERA_MAX_DISTANCE))
        const candidates = unlimited.length ? unlimited : frameLabels
        if (candidates.length !== 1) continue

        const label = candidates[0]
        const cameraIndex = Number(label.camera_index)
        const ray = imagePointToRay(label.x, label.y, projectionByCamera.get(cameraIndex))

        if (ray) {
          observations.push({
            frame,
            cameraIndex,
            ray,
            maxDistance: RECONSTRUCTION_CAMERA_MAX_DISTANCE[cameraIndex],
          })
        }
      }

      return observations
    },
    [labels, pairwise, projectionByCamera],
  )

  const flightPath = useMemo(
    () => {
      if (pairwise.status === 'loading') return { contacts: [], outliers: [], fromPairwise: false }

      if (pairwisePoints.length) {
        const analysis = buildBallFlightPath(pairwisePoints, fps, PAIRWISE_FLIGHT_OPTIONS)

        return {
          ...analysis,
          fromPairwise: true,
          contacts: analysis.contacts.map(contact => ({
            ...contact,
            anchor: contact.lastPositionBefore,
          })),
        }
      }

      // 這段沒有 2D 標註（或後端拿不到）才退回 ball_traj。沒有 anchor，
      // 球拍只轉拍面法線
      return { ...buildBallFlightPath(points, fps), fromPairwise: false }
    },
    [pairwise.status, pairwisePoints, points, fps],
  )

  // 顯示用的軌跡。trace 除了最後的結果，也留下每一步的中間結果
  // （stages），讓 buildBallProvenance 說明每一格的位置是怎麼來的
  const trace = useMemo(
    () => {
      if (repairMode) return { final: points, mode: 'repair' }
      if (trajectoryDisplaySource !== 'pure2d') return { final: points, mode: 'ball_traj' }
      if (pairwise.status === 'loading') return { final: [], mode: 'pure_loading' }

      // 沒有 2 組以上的重建點時，只要還有 2 台或 1 台的點就照樣算；
      // 那時沒有重建點偵測的擊球，整段當一段（見 buildPure2DTrace）
      const extraPoints = extraViews.twoCamera ? twoCameraPoints : []
      const hasSingles = extraViews.singleCamera && singleViewObservations.length > 0

      return buildPure2DTrace({
        observations: [...pairwisePoints, ...extraPoints],
        singleViewObservations: hasSingles ? singleViewObservations : [],
        flightPath,
        fps,
        physicsModel,
        smoothingLevel,
        startFrame,
        endFrame,
      })
    },
    [
      trajectoryDisplaySource,
      repairMode,
      smoothingLevel,
      extraViews,
      physicsModel,
      flightPath,
      pairwisePoints,
      twoCameraPoints,
      singleViewObservations,
      pairwise.status,
      fps,
      startFrame,
      endFrame,
      points,
    ],
  )

  const displayPoints = trace.final

  // 每一格的位置怎麼來的，3D 場景下方的說明列用
  const provenance = useMemo(
    () => buildBallProvenance({
      trace,
      rawPairwise: pairwise.points || [],
      singleViewObservations,
      contacts: flightPath.contacts,
      settings: { extraViews, isInsideCourt },
    }),
    [trace, pairwise, singleViewObservations, flightPath, extraViews],
  )

  // 球拍拍面中心對準的點：顯示的是純 2D 軌跡時，用擊球前最後一格「畫出來
  // 的球」，鉛直面、不回飛移動了那一格也一樣對得上；顯示 ball_traj 時
  // 照舊對準重建點（ball_traj 不一定準）
  const contacts = useMemo(
    () => {
      if (displayPoints === points) return flightPath.contacts

      const displayByFrame = new Map(displayPoints.map(point => [point.frame, point]))

      return flightPath.contacts.map((contact) => {
        const shown = displayByFrame.get(contact.lastFrameBefore)

        return shown && contact.anchor ? { ...contact, anchor: toThreeVector(shown) } : contact
      })
    },
    [displayPoints, points, flightPath],
  )

  // 依 frame 查顯示用的球位置：rally 範圍內用 displayPoints，範圍外用
  // ball_traj（純 2D 模式不用，範圍外就沒有）
  const pureMode = trace.mode.startsWith('pure')
  const displayLookup = useMemo(
    () => {
      const displayByFrame = new Map(displayPoints.map(point => [point.frame, point]))
      const inRange = frame => startFrame != null && frame >= startFrame && frame <= endFrame

      return {
        get: frame => {
          if (inRange(frame)) return displayByFrame.get(frame)
          return pureMode ? undefined : trajByFrame.get(frame)
        },
      }
    },
    [displayPoints, trajByFrame, startFrame, endFrame, pureMode],
  )

  const pairwiseStatus = pairwise.status

  // 播放時每格都會重新 render（useRallyFrameRange 看 currentFrame），
  // 內容沒變就沿用同一個物件，讀這份資料的元件才不會跟著每格重畫
  return useMemo(
    () => ({
      points,
      displayPoints,
      displayLookup,
      provenance,
      pairwisePoints,
      pairwiseStatus,
      projectionByCamera,
      contacts,
      flightPath,
      startFrame,
      endFrame,
    }),
    [
      points,
      displayPoints,
      displayLookup,
      provenance,
      pairwisePoints,
      pairwiseStatus,
      projectionByCamera,
      contacts,
      flightPath,
      startFrame,
      endFrame,
    ],
  )
}


const RallyBallDataContext = createContext(null)


/**
 * 算一次目前 rally 的球軌跡（useRallyBallDataValue），放進 context。
 * 純 2D 的重建、補點、平滑整串不便宜，各元件各算一次會重複好幾倍。
 */
export function RallyBallDataProvider({ children }) {
  const value = useRallyBallDataValue()

  return createElement(RallyBallDataContext.Provider, { value }, children)
}


export function useRallyBallData() {
  const value = useContext(RallyBallDataContext)

  if (!value) throw new Error('useRallyBallData 要在 RallyBallDataProvider 裡面用')

  return value
}


/**
 * 依 frame 查顯示用的球位置（{ get(frame) }）：目前 rally 範圍內用
 * displayPoints（可能是純 2D 補點、平滑過的），範圍外用 ball_traj。
 * 影片疊圖和時間軸拿它，看到的就是 3D 場景畫的那一份。
 */
export function useDisplayTrajectoryLookup() {
  return useRallyBallData().displayLookup
}
