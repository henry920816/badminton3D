import { useMemo } from 'react'
import { useAppStore } from '../store.js'
import { buildBallContacts } from './ballPath.js'


function collectRangePoints(trajByFrame, startFrame, endFrame) {
  const points = []

  for (let frame = startFrame; frame <= endFrame; frame += 1) {
    const point = trajByFrame.get(frame)
    if (point) points.push(point)
  }

  return points
}


/**
 * 目前要顯示的那段球軌跡，以及那段裡反推出來的擊球接觸點。
 *
 * 3D 場景與影片疊圖都要用同一份結果 —— 兩邊各自算一次，
 * 只要有一邊的取樣範圍不一樣，畫出來的接觸點就會對不起來。
 */
export function useRallyBallData() {
  const selection = useAppStore(state => state.selection)
  const fps = useAppStore(state => state.fps) || 60
  const trajByFrame = useAppStore(state => state.trajByFrame)
  const rallies = useAppStore(state => state.rallies) || []
  const currentFrame = useAppStore(state => state.currentFrame)

  const points = useMemo(
    () => {
      const inTime = selection.inTime
      const outTime = selection.outTime

      // 使用者拉了 in/out 就以選取範圍為準
      if (inTime != null && outTime != null) {
        return collectRangePoints(
          trajByFrame,
          Math.max(0, Math.floor(Math.min(inTime, outTime) * fps)),
          Math.max(0, Math.ceil(Math.max(inTime, outTime) * fps)),
        )
      }

      const sortedRallies = [...rallies].sort(
        (first, second) => first.start_frame - second.start_frame,
      )

      const targetRally = sortedRallies.find(
        rally => currentFrame <= rally.end_frame,
      )

      if (!targetRally) return []

      return collectRangePoints(
        trajByFrame,
        targetRally.start_frame,
        targetRally.end_frame,
      )
    },
    [selection.inTime, selection.outTime, fps, trajByFrame, currentFrame, rallies],
  )

  const contacts = useMemo(
    () => buildBallContacts(points, fps),
    [points, fps],
  )

  return { points, contacts }
}
