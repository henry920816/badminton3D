import { imagePointToRay, project3DToImage } from './cameraProjection.js'

// 原始世界座標的羽球活動範圍：極線只顯示這段，避免整個畫面都是線。
const VOLUME = { minX:-5,maxX:5,minY:-10,maxY:1,minZ:-9,maxZ:9 }
const insideVolume = ([x,y,z]) => x>=VOLUME.minX && x<=VOLUME.maxX && y>=VOLUME.minY && y<=VOLUME.maxY && z>=VOLUME.minZ && z<=VOLUME.maxZ

// 找出離各視線的平方距離總和最小的 3D 點。
export function triangulateRays(rays) {
  if (!Array.isArray(rays) || rays.length < 2) return null
  const a=[0,0,0,0,0,0,0,0,0], b=[0,0,0]
  for (const {origin, direction} of rays) {
    for (let i=0;i<3;i++) for (let j=0;j<3;j++) {
      const v=(i===j?1:0)-direction[i]*direction[j]
      a[i*3+j]+=v
      b[i]+=v*origin[j]
    }
  }
  const det=m=>m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6])
  const d=det(a)
  if (!Number.isFinite(d) || Math.abs(d)<1e-9) return null
  const p=[]
  for (let j=0;j<3;j++) {
    const copy=a.slice()
    for (let i=0;i<3;i++) copy[i*3+j]=b[i]
    p.push(det(copy)/d)
  }
  return p.every(Number.isFinite)?p:null
}

function rms(point,views) {
  let sum=0
  for (const v of views) {
    const p=project3DToImage(point,v.params)
    if (!p) return Infinity
    sum+=(p.u-v.u)**2+(p.v-v.v)**2
  }
  return Math.sqrt(sum/views.length)
}

export function prepareReferences(references) {
  return (references||[]).map(reference=>{
    const u=Number(reference.u),v=Number(reference.v)
    const ray=imagePointToRay(u,v,reference.params)
    return ray?{...reference,u,v,ray}:null
  }).filter(Boolean)
}

export function multiViewConsistency(views) {
  if (!views || views.length<2) return null
  const p=triangulateRays(views.map(v=>v.ray))
  return p?rms(p,views):null
}

export function evaluateGuideError(targetParams,references,u,v) {
  const ray=imagePointToRay(u,v,targetParams)
  if (!ray || !references?.length) return {error:Infinity,point:null}
  const point=triangulateRays([ray,...references.map(ref=>ref.ray)])
  return point?{error:rms(point,[{params:targetParams,u,v},...references]),point}:{error:Infinity,point:null}
}

export function epipolarPolylines(targetParams,reference) {
  const w=Number(targetParams?.imageWidth)||1920
  const h=Number(targetParams?.imageHeight)||1200
  const {origin,direction}=reference.ray
  const result=[]
  let current=[]
  for (let distance=0.5;distance<=40;distance+=0.05) {
    const point=origin.map((value,i)=>value+direction[i]*distance)
    const projection=insideVolume(point)?project3DToImage(point,targetParams):null
    if (projection && projection.u>=0 && projection.v>=0 && projection.u<=w && projection.v<=h) {
      current.push({u:projection.u,v:projection.v})
    } else if(current.length) {
      if(current.length>1) result.push(current)
      current=[]
    }
  }
  if(current.length>1) result.push(current)
  return result
}

export function computeEpipolarGuide({targetParams,references}) {
  if (!targetParams) return {references:[],lines:[],minimum:null}
  const prepared=prepareReferences(references)
  const lines=prepared.flatMap(ref=>epipolarPolylines(targetParams,ref).map(points=>({cameraIndex:ref.cameraIndex,points})))
  const guide={references:prepared,lines,minimum:null}
  if(prepared.length<2) return guide
  const point=triangulateRays(prepared.map(ref=>ref.ray))
  const p=point?project3DToImage(point,targetParams):null
  if(p) guide.minimum={u:p.u,v:p.v,error:rms(point,[{params:targetParams,u:p.u,v:p.v},...prepared])}
  return guide
}
