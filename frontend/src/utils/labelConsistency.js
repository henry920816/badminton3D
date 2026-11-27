import {multiViewConsistency,prepareReferences} from './epipolarGuide.js'

// 少於三台有標註的相機，不計算這個共同幾何指標。
export function computeConsistencyRows({labels,cameras,startFrame,endFrame}) {
  const byCamera=new Map((cameras||[]).filter(c=>c.projection?.intrinsic&&c.projection?.extrinsic).map(c=>[Number(c.index),c.projection]))
  const byFrame=new Map()
  for(const label of labels||[]) {
    const frame=Number(label.frame),idx=Number(label.camera_index)
    if(frame<startFrame||frame>endFrame||!byCamera.has(idx)||Number(label.visibility)===0) continue
    const x=Number(label.x),y=Number(label.y)
    if(!Number.isFinite(x)||!Number.isFinite(y)) continue
    if(!byFrame.has(frame)) byFrame.set(frame,new Map())
    byFrame.get(frame).set(idx,{cameraIndex:idx,params:byCamera.get(idx),u:x,v:y})
  }
  const rows=[]
  for (const [frame,observations] of byFrame) {
    if(observations.size<3) continue
    const prepared=prepareReferences([...observations.values()])
    if(prepared.length<3) continue
    const value=multiViewConsistency(prepared)
    if(Number.isFinite(value)) rows.push({frame,value,viewCount:prepared.length})
  }
  return rows.sort((a,b)=>a.frame-b.frame)
}
