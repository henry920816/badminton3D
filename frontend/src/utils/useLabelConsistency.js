import { useEffect, useMemo } from 'react'
import { api } from '../api.js'
import { useAppStore } from '../store.js'
import { computeConsistencyRows } from './labelConsistency.js'
import { useBall2DRangeLabels } from './usePairwiseBallPoints.js'
import { useRallyFrameRange } from './useRallyBallData.js'

/**
 * 目前 rally 範圍裡，每一格所有視角的 2D 標註彼此一致的程度（見
 * multiViewConsistency），值越高越該回去修那一格的標註。
 *
 * 每台相機的標註優先用 2D 修正的值（修正成看不見就不算那台），沒有
 * 修正才用目前 2D 來源的標註，和 2D 修正的引導線同一套。
 *
 * 回傳 { status, rows: [{ frame, value, viewCount }] }。
 */
export function useLabelConsistency(enabled = true) {
  const matchId = useAppStore(state => state.matchId)
  const cameras = useAppStore(state => state.cameras)
  const ball2DCorrections = useAppStore(state => state.ball2DCorrections)
  const { startFrame, endFrame } = useRallyFrameRange()

  const labels = useBall2DRangeLabels(
    enabled ? matchId : null,
    startFrame,
    endFrame,
  )

  // 修正是依相機分開抓的，還沒抓過的相機補抓（2D 修正模式也會抓）
  useEffect(
    () => {
      if (!enabled || matchId == null) return undefined

      let cancelled = false

      for (const camera of cameras || []) {
        const cameraIndex = Number(camera?.index)

        if (
          !camera?.has_ball_2d
          || !Number.isInteger(cameraIndex)
          || useAppStore.getState().ball2DCorrections.has(cameraIndex)
        ) {
          continue
        }

        api.getBall2DCorrections(matchId, cameraIndex)
          .then(list => {
            if (!cancelled && useAppStore.getState().matchId === matchId) {
              useAppStore.getState().setBall2DCorrections(cameraIndex, list)
            }
          })
          .catch(error => console.error(error))
      }

      return () => {
        cancelled = true
      }
    },
    [enabled, matchId, cameras],
  )

  return useMemo(
    () => (
      labels.status === 'ready'
        ? {
            status: 'ready',
            rows: computeConsistencyRows({
              labels: labels.points,
              corrections: ball2DCorrections,
              cameras,
              startFrame,
              endFrame,
            }),
          }
        : { status: labels.status, rows: [] }
    ),
    [labels, cameras, ball2DCorrections, startFrame, endFrame],
  )
}
