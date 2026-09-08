import { useMemo } from 'react'
import { useAppStore } from '../store.js'
import { buildBallFlightPath } from './ballPath.js'


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
 * 3D 場景與影片疊圖都要用同一份結果 —— 兩邊各自算一次，
 * 只要有一邊的取樣範圍不一樣，畫出來的擊球位置就會對不起來。
 */
export function useRallyBallData() {
  const selection = useAppStore(state => state.selection)
  const fps = useAppStore(state => state.fps) || 60
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

  // 球拍轉向用的接觸點與畫線用的擊球位置出自同一次分析：分開各算一次
  // 的話，只要有一邊的取樣範圍不一樣，兩者就會對不起來
  const flightPath = useMemo(
    () => buildBallFlightPath(points, fps),
    [points, fps],
  )

  return {
    points,
    contacts: flightPath.contacts,
    flightPath,
    startFrame,
    endFrame,
  }
}
