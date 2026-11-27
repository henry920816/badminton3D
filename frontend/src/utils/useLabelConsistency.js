import {useMemo} from 'react'
import {useAppStore} from '../store.js'
import {useBall2DRangeLabels} from './usePairwiseBallPoints.js'
import {useRallyFrameRange} from './useRallyBallData.js'
import {computeConsistencyRows} from './labelConsistency.js'

// 使用目前所選的「原始／修正後」標註。單幀更新由既有快取處理。
export function useLabelConsistency(enabled=true) {
  const matchId=useAppStore(s=>s.matchId)
  const cameras=useAppStore(s=>s.cameras)
  const {startFrame,endFrame}=useRallyFrameRange()
  const labels=useBall2DRangeLabels(enabled?matchId:null,startFrame,endFrame)
  return useMemo(()=> labels.status==='ready'
    ? {status:'ready',rows:computeConsistencyRows({labels:labels.points,cameras,startFrame,endFrame})}
    : {status:labels.status,rows:[]},
  [labels.status,labels.points,cameras,startFrame,endFrame])
}
