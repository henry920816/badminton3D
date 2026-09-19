import { useMemo } from 'react'
import { useAppStore } from '../store.js'
import {
  PAIRWISE_FLIGHT_OPTIONS,
  buildBallFlightPath,
} from './ballPath.js'
import { usePairwiseBallPoints } from './usePairwiseBallPoints.js'


// 相機組合少於這個數的格子不拿來偵測擊球：只有 1 組時，
// 和 ball_traj 的差距 p90 達 9 公尺
const MIN_PAIRWISE_PAIRS = 2

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
 * 目前要顯示的那段球軌跡，以及那段裡推算出來的擊球位置。
 *
 * 軌跡線畫的是 ball_traj，擊球卻是用 2D 標註兩兩重建的 3D 點去猜：
 * ball_traj 不一定準，而擊球前球最慢，2D 標註在那裡相對準。
 * 每次擊球的 anchor 是擊球前最後一格的重建點，球拍拍面中心要對準它。
 */
export function useRallyBallData() {
  const selection = useAppStore(state => state.selection)
  const fps = useAppStore(state => state.fps) || 60
  const matchId = useAppStore(state => state.matchId)
  const trajByFrame = useAppStore(state => state.trajByFrame)
  const rallies = useAppStore(state => state.rallies) || []
  const currentFrame = useAppStore(state => state.currentFrame)

  const { startFrame, endFrame } = useMemo(
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

  const flightPath = useMemo(
    () => {
      if (pairwise.status === 'loading') return { contacts: [], outliers: [] }

      if (pairwisePoints.length) {
        const analysis = buildBallFlightPath(pairwisePoints, fps, PAIRWISE_FLIGHT_OPTIONS)

        return {
          ...analysis,
          contacts: analysis.contacts.map(contact => ({
            ...contact,
            anchor: contact.lastPositionBefore,
          })),
        }
      }

      // 這段沒有 2D 標註（或後端拿不到）才退回 ball_traj。沒有 anchor，
      // 球拍只轉拍面法線
      return buildBallFlightPath(points, fps)
    },
    [pairwise.status, pairwisePoints, points, fps],
  )

  return {
    points,
    pairwisePoints,
    pairwiseStatus: pairwise.status,
    contacts: flightPath.contacts,
    flightPath,
    startFrame,
    endFrame,
  }
}
