import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreAtFrame } from '../src/utils/matchScore.js'
import { imagePointToRay, project3DToImage } from '../src/utils/cameraProjection.js'
import { prepareReferences, triangulateRays, multiViewConsistency, computeEpipolarGuide, evaluateGuideError } from '../src/utils/epipolarGuide.js'
import { computeConsistencyRows } from '../src/utils/labelConsistency.js'

const camera = tx => ({ intrinsic: [1000, 1000, 960, 600], extrinsic: [[1,0,0,-tx],[0,1,0,0],[0,0,1,0]], imageWidth:1920,imageHeight:1200 })
const p = [0.5,-0.1,5]
const coords = [-1,0,1].map((tx,index) => ({ cameraIndex:index, params:camera(tx), ...(()=>{ const q=project3DToImage(p,camera(tx)); return {u:q.u,v:q.v}})() }))

test('世界點投影與視線反算能互相對應', () => {
  for(const item of coords){
    const ray=imagePointToRay(item.u,item.v,item.params)
    assert.ok(ray)
    const point=ray.origin.map((n,i)=>n+ray.direction[i]*5)
    const roundtrip=project3DToImage(point,item.params)
    assert.ok(Math.hypot(roundtrip.u-item.u,roundtrip.v-item.v)<0.01)
  }
})

test('三台相機標註一致時誤差接近零', () => {
  const prepared=prepareReferences(coords)
  const point=triangulateRays(prepared.map(item=>item.ray))
  assert.ok(point)
  assert.ok(Math.hypot(...point.map((v,i)=>v-p[i]))<1e-4)
  assert.ok(multiViewConsistency(prepared)<1e-4)
  const score=computeConsistencyRows({labels:coords.map(i=>({camera_index:i.cameraIndex,frame:100,visibility:1,x:i.u,y:i.v})),cameras:coords.map(i=>({index:i.cameraIndex,projection:i.params})),startFrame:100,endFrame:100})
  assert.equal(score.length,1)
  assert.ok(score[0].value<1e-4)
})

test('跨視角位置導引不會憑空產生2D修正',()=>{
  const guide=computeEpipolarGuide({targetParams:camera(1),references:coords.slice(0,2)})
  assert.ok(guide.minimum)
  assert.ok(Math.hypot(guide.minimum.u-coords[2].u,guide.minimum.v-coords[2].v)<0.01)
  assert.ok(evaluateGuideError(camera(1),guide.references,coords[2].u,coords[2].v).error<1e-4)
})

test('記分板在回合結束影格才計分',()=>{
  const rs=[
    {start_frame:100,end_frame:110,game_index:1,up_team:0,up_score:1,down_score:0,score:'1-0'},
    {start_frame:120,end_frame:130,game_index:1,up_team:0,up_score:2,down_score:0,score:'2-0'},
    {start_frame:200,end_frame:210,game_index:2,up_team:0,up_score:1,down_score:0,score:'1-0'}
  ]
  assert.equal(scoreAtFrame(rs,105).teams[0].points,0)
  assert.equal(scoreAtFrame(rs,110).teams[0].points,1)
  assert.equal(scoreAtFrame(rs,200).teams[0].points,0)
  assert.equal(scoreAtFrame(rs,200).teams[0].games,1)
})
