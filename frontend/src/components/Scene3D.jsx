import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { useAppStore } from '../store.js'
import { loadSmplForwardModel } from '../utils/smplForwardAssets.js'
import { toThreeVector } from '../utils/ballPath.js'
import { useRallyBallData } from '../utils/useRallyBallData.js'

const SHUTTLECOCK_OBJ_URL = '/models/shuttlecock/shuttlecock.obj'
const SHUTTLECOCK_MODEL_SCALE = 0.016
const SHUTTLECOCK_HEAD_AXIS = new THREE.Vector3(0, 1, 0)

// 估計球頭朝向時，鄰近取樣點超過這麼多格就不採用
const BALL_DIRECTION_MAX_GAP = 3

// 黃色追尾往回涵蓋多少秒
const BALL_TRAIL_SECONDS = 0.8
let shuttlecockObjectPromise = null

async function loadShuttlecockObject() {
  if (!shuttlecockObjectPromise) {
    shuttlecockObjectPromise = (async () => {
      const materials = await new MTLLoader()
        .setPath('/models/shuttlecock/')
        .loadAsync('shuttlecock.mtl')
      materials.preload()

      const object = await new OBJLoader()
        .setMaterials(materials)
        .loadAsync(SHUTTLECOCK_OBJ_URL)

      // 軌跡點代表的是整支羽球的視覺中心，所以模型要以 bbox 中心對齊，
      // 不是以軟木塞對齊
      const box = new THREE.Box3().setFromObject(object)
      const center = box.getCenter(new THREE.Vector3())
      object.traverse((child) => {
        if (!child.isMesh) return
        child.castShadow = true
        child.receiveShadow = true
        child.geometry = child.geometry.clone()
        child.geometry.translate(-center.x, -center.y, -center.z)
        child.geometry.rotateX(Math.PI / 2)
        child.geometry.scale(
          SHUTTLECOCK_MODEL_SCALE,
          SHUTTLECOCK_MODEL_SCALE,
          SHUTTLECOCK_MODEL_SCALE,
        )
        child.geometry.computeVertexNormals()
      })
      return object
    })()
  }
  return shuttlecockObjectPromise
}

function AnimatedTrajectory({ points }) {
  const currentFrame = useAppStore(s => s.currentFrame)
  const fps = useAppStore(s => s.fps) || 60
  const selectedTrajFrames = useAppStore(s => s.selectedTrajFrames) || []
  const toggleTrajFrameSelection = useAppStore(s => s.toggleTrajFrameSelection)
  const repairMode = useAppStore(s => s.repairMode)
  const [shuttlecockObject, setShuttlecockObject] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadShuttlecockObject()
      .then((object) => {
        if (!cancelled) setShuttlecockObject(object.clone(true))
      })
      .catch((err) => {
        console.warn('Shuttlecock OBJ unavailable:', err)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // 全程路徑只跟軌跡資料有關，不隨播放位置重算
  const pathVectors = useMemo(
    () => (points || []).map(toThreeVector),
    [points],
  )

  const { ballPos, ballQuat } = useMemo(() => {
    const missing = { ballPos: null, ballQuat: null }

    if (!points?.length) return missing

    // 軌跡資料、SMPL 姿態、影片都只存在於整數格上。
    // 這裡若內插出小數格的位置，球就會領先人體與影片最多半格，
    // 殺球時那是 60 公分，比任何模型對位的誤差都大。
    const index = points.findIndex(point => point.frame === currentFrame)

    // 偵測中斷的那幾格本來就沒有球，寧可不畫也不要內插出一顆假的
    if (index === -1) return missing

    const ballPos = toThreeVector(points[index])
    const previous = points[index - 1]
    const next = points[index + 1]

    // 中央差分比前向差分更接近當地切線；鄰點缺太多格就退回單側
    const from = previous && currentFrame - previous.frame <= BALL_DIRECTION_MAX_GAP
      ? toThreeVector(previous)
      : ballPos

    const to = next && next.frame - currentFrame <= BALL_DIRECTION_MAX_GAP
      ? toThreeVector(next)
      : ballPos

    const ballDir = to.clone().sub(from)

    const ballQuat = ballDir.lengthSq() > 1e-8
      ? new THREE.Quaternion().setFromUnitVectors(
          SHUTTLECOCK_HEAD_AXIS,
          ballDir.normalize(),
        )
      : null

    return {
      ballPos,
      ballQuat,
    }
  }, [points, currentFrame])

  const trailVectors = useMemo(() => {
    if (!points?.length) return []

    const trailFrames = Math.round(BALL_TRAIL_SECONDS * fps)

    return points
      .filter(point => (
        point.frame <= currentFrame
        && point.frame >= currentFrame - trailFrames
      ))
      .map(toThreeVector)
  }, [points, currentFrame, fps])

  if (pathVectors.length < 2) return null

  return (
    <group>
      <Line points={pathVectors} lineWidth={1.5} color="#6b7280" opacity={0.3} transparent />

      {trailVectors.length > 1 && (
        <Line points={trailVectors} lineWidth={3.5} color="#fcd34d" />
      )}

      {ballPos && (
        <group
          position={[ballPos.x, ballPos.y, ballPos.z]}
          quaternion={ballQuat || undefined}
        >
          {shuttlecockObject ? (
            <primitive object={shuttlecockObject} />
          ) : (
            <mesh>
              <sphereGeometry args={[0.08, 16, 16]} />
              <meshStandardMaterial color="#ffffff" emissive="#fbbf24" emissiveIntensity={1.2} />
            </mesh>
          )}
          <pointLight distance={3} intensity={3} color="#fcd34d" />
        </group>
      )}

      {repairMode && points.map(point => {
        const isSelected = selectedTrajFrames.includes(point.frame)
        const radius = isSelected ? 0.06 : 0.02
        const color = isSelected ? '#08597e' : '#94a3b8'
        const opacity = isSelected ? 1.0 : 0.4

        return (
          <mesh
            key={point.frame}
            position={[point.x, -point.y, -point.z]}
            onClick={(event) => {
              event.stopPropagation()
              toggleTrajFrameSelection(point.frame)
            }}
          >
            <sphereGeometry args={[radius, 8, 8]} />
            <meshBasicMaterial color={color} transparent opacity={opacity} />
          </mesh>
        )
      })}
    </group>
  )
}

function PlaybackController() {
  const playing = useAppStore(s => s.playing)
  const setPlaying = useAppStore(s => s.setPlaying)
  const playbackRate = useAppStore(s => s.playbackRate)
  const currentTime = useAppStore(s => s.currentTime)
  const setCurrentTime = useAppStore(s => s.setCurrentTime)
  const selection = useAppStore(s => s.selection)
  const durationSec = useAppStore(s => s.durationSec)

  useFrame((state, delta) => {
    if (!playing) return

    let nextTime = currentTime + delta * playbackRate

    if (selection.inTime != null && selection.outTime != null) {
      if (nextTime > selection.outTime) nextTime = selection.inTime
      if (nextTime < selection.inTime) nextTime = selection.inTime
    } else if (durationSec && nextTime >= durationSec) {
      nextTime = durationSec
      setPlaying(false)
    }

    setCurrentTime(nextTime)
  })

  return null
}

function getLocalPoseFrame(playerReplay, frame) {
  const frames = playerReplay?.frames
  if (!frames?.length) return null

  const localFrame = frame - (playerReplay.start_frame || 0)

  // 取「不超過目前這格」的最後一個有效姿態
  let best = null

  for (const item of frames) {
    if ((item.local_frame ?? 0) > localFrame) break
    if (item.valid === false) continue
    best = item
  }

  if (best) return best

  // 還沒走到第一個有效姿態就先擺出它。
  // 這有兩種情況：一是播到 rally 之間的空檔，此時 localFrame 是負的；
  // 二是 rally 開頭本來就有一段 valid=false 的空資料（實測約 48 格、
  // 也就是 1 秒）。兩種情況下人體都不該整個消失 —— 球的軌跡在這時候
  // 已經切到下一個 rally 了，人也應該跟著出現。
  return frames.find(item => item.valid !== false) || null
}

function sourceToThreePositions(source) {
  const out = new Float32Array(source.length)
  for (let i = 0; i < source.length; i += 3) {
    out[i] = source[i]
    out[i + 1] = -source[i + 1]
    out[i + 2] = -source[i + 2]
  }
  return out
}

const SMPL_JOINT_COUNT = 24
const SMPL_POSE_FEATURE_COUNT = 207
const SMPL_POSEDIRS_TEXTURE_WIDTH = 2048
const RACKET_OBJ_URL = '/models/racket/racket.obj'
const RACKET_SCALE = 1
const RACKET_PIVOT = new THREE.Vector3(0, 0, 0)
const RACKET_OFFSET = new THREE.Vector3(0, 0, 0)

// 拍頭沿 local -X 展開，拍面攤在 X-Z 平面上（Y 方向只有 0.014m 厚），
// 所以拍面法線就是 local +Y
const RACKET_FACE_NORMAL = new THREE.Vector3(0, 1, 0)

// 拍面中心在 local 座標的位置，用來判斷這一拍是不是這位球員打的
const RACKET_FACE_CENTER = new THREE.Vector3(-0.545, 0, 0)

// 拍面離擊球點超過這個距離(公尺)就當作是對手那一拍，不套用
const RACKET_AIM_MAX_DISTANCE = 0.75

// 接觸只有一瞬間，硬轉一格會像跳格；前後各這麼多格做漸入漸出
const RACKET_AIM_BLEND_FRAMES = 4

// 每格都要算，共用暫存物件避免在 render loop 裡配置記憶體
const racketAimScratch = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
  faceCenter: new THREE.Vector3(),
  faceNormal: new THREE.Vector3(),
  target: new THREE.Vector3(),
  correction: new THREE.Quaternion(),
  blended: new THREE.Quaternion(),
}

let racketObjectPromise = null


// 找出離現在最近、且還在漸變窗內的那次擊球
function findRacketAim(contacts, frame) {
  if (!contacts?.length || !Number.isFinite(frame)) return null

  let nearest = null
  let nearestDistance = Infinity

  for (const contact of contacts) {
    const distance = Math.abs(frame - contact.frame)

    if (distance > RACKET_AIM_BLEND_FRAMES) continue
    if (distance >= nearestDistance) continue

    nearest = contact
    nearestDistance = distance
  }

  if (!nearest) return null

  // smoothstep：在接觸瞬間權重為 1，窗邊界為 0，且兩端斜率為 0
  const ratio = 1 - nearestDistance / RACKET_AIM_BLEND_FRAMES

  return {
    contact: nearest,
    weight: ratio * ratio * (3 - 2 * ratio),
  }
}


// 把拍面法線轉向出球方向。旋轉是繞 racket local 原點（握把末端，
// 也就是手的位置）做的，所以握把不會離開手。
function aimRacketMatrix(matrix, contact, weight) {
  const scratch = racketAimScratch

  matrix.decompose(scratch.position, scratch.quaternion, scratch.scale)

  scratch.faceCenter.copy(RACKET_FACE_CENTER).applyMatrix4(matrix)

  // 一個 rally 裡兩位球員輪流打，靠距離判斷這一拍屬於誰
  if (scratch.faceCenter.distanceTo(contact.position) > RACKET_AIM_MAX_DISTANCE) {
    return false
  }

  scratch.faceNormal
    .copy(RACKET_FACE_NORMAL)
    .applyQuaternion(scratch.quaternion)
    .normalize()

  scratch.target.copy(contact.direction)

  // 拍面兩側都能擊球，取轉得比較少的那一面，否則正手拍會整支翻過來
  if (scratch.faceNormal.dot(scratch.target) < 0) scratch.target.negate()

  scratch.correction.setFromUnitVectors(scratch.faceNormal, scratch.target)
  scratch.blended.identity().slerp(scratch.correction, weight)
  scratch.quaternion.premultiply(scratch.blended)

  matrix.compose(scratch.position, scratch.quaternion, scratch.scale)

  return true
}


// 球拍姿態來自 SMPL 手腕，擊球瞬間再把拍面轉向球飛出去的方向。
// 修正一定要從 worker 給的原始矩陣重算，累加在上一格結果上會越轉越歪。
function applyRacketAim(racket, baseMatrix, contacts, frame) {
  if (!racket || !baseMatrix) return

  racket.matrix.copy(baseMatrix)

  const aim = findRacketAim(contacts, frame)
  if (aim) aimRacketMatrix(racket.matrix, aim.contact, aim.weight)

  racket.matrixWorldNeedsUpdate = true
}

function createSmplPoseDirectionsTexture(posedirs) {
  const scalarCount = posedirs.length
  const height = Math.ceil(scalarCount / (SMPL_POSEDIRS_TEXTURE_WIDTH * 4))
  const data = new Float32Array(SMPL_POSEDIRS_TEXTURE_WIDTH * height * 4)
  data.set(posedirs)
  const texture = new THREE.DataTexture(
    data,
    SMPL_POSEDIRS_TEXTURE_WIDTH,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  )
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

function createSmplMaterial(color, poseDirections, vertexCount) {
  const uniforms = {
    smplJointMatrices: { value: Array.from({ length: SMPL_JOINT_COUNT }, () => new THREE.Matrix4()) },
    smplPoseFeatures: { value: new Float32Array(SMPL_POSE_FEATURE_COUNT) },
    smplTranslation: { value: new THREE.Vector3() },
    smplPoseDirections: { value: poseDirections },
    smplPoseDirectionsSize: { value: new THREE.Vector2(poseDirections.image.width, poseDirections.image.height) },
    smplCoordinateCount: { value: vertexCount * 3 },
  }
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.66, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
uniform mat4 smplJointMatrices[24];
uniform float smplPoseFeatures[207];
uniform vec3 smplTranslation;
uniform sampler2D smplPoseDirections;
uniform vec2 smplPoseDirectionsSize;
uniform float smplCoordinateCount;
attribute float smplVertexIndex;
attribute vec4 smplWeight0;
attribute vec4 smplWeight1;
attribute vec4 smplWeight2;
attribute vec4 smplWeight3;
attribute vec4 smplWeight4;
attribute vec4 smplWeight5;

float smplPoseDirection(float scalarIndex) {
  float texelIndex = floor(scalarIndex * 0.25);
  float component = mod(scalarIndex, 4.0);
  vec2 uv = (vec2(mod(texelIndex, smplPoseDirectionsSize.x), floor(texelIndex / smplPoseDirectionsSize.x)) + 0.5) / smplPoseDirectionsSize;
  vec4 value = texture(smplPoseDirections, uv);
  if (component < 0.5) return value.r;
  if (component < 1.5) return value.g;
  if (component < 2.5) return value.b;
  return value.a;
}

mat4 smplSkinMatrix() {
  return smplJointMatrices[0] * smplWeight0.x + smplJointMatrices[1] * smplWeight0.y + smplJointMatrices[2] * smplWeight0.z + smplJointMatrices[3] * smplWeight0.w
    + smplJointMatrices[4] * smplWeight1.x + smplJointMatrices[5] * smplWeight1.y + smplJointMatrices[6] * smplWeight1.z + smplJointMatrices[7] * smplWeight1.w
    + smplJointMatrices[8] * smplWeight2.x + smplJointMatrices[9] * smplWeight2.y + smplJointMatrices[10] * smplWeight2.z + smplJointMatrices[11] * smplWeight2.w
    + smplJointMatrices[12] * smplWeight3.x + smplJointMatrices[13] * smplWeight3.y + smplJointMatrices[14] * smplWeight3.z + smplJointMatrices[15] * smplWeight3.w
    + smplJointMatrices[16] * smplWeight4.x + smplJointMatrices[17] * smplWeight4.y + smplJointMatrices[18] * smplWeight4.z + smplJointMatrices[19] * smplWeight4.w
    + smplJointMatrices[20] * smplWeight5.x + smplJointMatrices[21] * smplWeight5.y + smplJointMatrices[22] * smplWeight5.z + smplJointMatrices[23] * smplWeight5.w;
}
`)
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
mat4 smplNormalSkinMatrix = smplSkinMatrix();
vec3 smplSourceNormal = vec3(normal.x, -normal.y, -normal.z);
vec3 smplNormal = normalize(mat3(smplNormalSkinMatrix) * smplSourceNormal);
vec3 objectNormal = vec3(smplNormal.x, -smplNormal.y, -smplNormal.z);`)
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
vec3 smplVPosed = vec3(position.x, -position.y, -position.z);
for (int feature = 0; feature < 207; feature++) {
  float offset = float(feature) * smplCoordinateCount + smplVertexIndex * 3.0;
  float coefficient = smplPoseFeatures[feature];
  smplVPosed.x += coefficient * smplPoseDirection(offset);
  smplVPosed.y += coefficient * smplPoseDirection(offset + 1.0);
  smplVPosed.z += coefficient * smplPoseDirection(offset + 2.0);
}
vec3 smplSourcePosition = (smplSkinMatrix() * vec4(smplVPosed, 1.0)).xyz + smplTranslation;
vec3 transformed = vec3(smplSourcePosition.x, -smplSourcePosition.y, -smplSourcePosition.z);`)
  }
  material.userData.smplUniforms = uniforms
  return material
}

function prepareRacketObject(source) {
  const object = source.clone(true)
  object.traverse((child) => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = true
    child.geometry = child.geometry.clone()
    child.geometry.translate(-RACKET_PIVOT.x, -RACKET_PIVOT.y, -RACKET_PIVOT.z)
    child.geometry.scale(RACKET_SCALE, RACKET_SCALE, RACKET_SCALE)
    child.geometry.translate(RACKET_OFFSET.x, RACKET_OFFSET.y, RACKET_OFFSET.z)
    child.material = new THREE.MeshStandardMaterial({
      color: '#111827',
      roughness: 0.42,
      metalness: 0,
      side: THREE.DoubleSide,
    })
  })
  return object
}

function loadRacketObject() {
  if (!racketObjectPromise) {
    racketObjectPromise = new OBJLoader().loadAsync(RACKET_OBJ_URL).then((object) => {
      object.traverse((child) => {
        if (child.isMesh) child.geometry.computeVertexNormals()
      })
      return object
    })
  }
  return racketObjectPromise
}

function SmplForwardAvatar({ playerReplay, ballContacts }) {
  const currentFrame = useAppStore(s => s.currentFrame)
  const racketRef = useRef(null)
  const baseRacketMatrixRef = useRef(null)
  const ballContactsRef = useRef(ballContacts)
  const currentFrameRef = useRef(currentFrame)
  const workerRef = useRef(null)
  const requestIdRef = useRef(0)
  const lastSentFrameRef = useRef(null)
  const [model, setModel] = useState(null)
  const [vShaped, setVShaped] = useState(null)
  const [racketObject, setRacketObject] = useState(null)
  const [ready, setReady] = useState(false)
  const [hasAppliedFrame, setHasAppliedFrame] = useState(false)
  const [failed, setFailed] = useState('')

  // worker 的回覆是非同步的，回來時要用最新的擊球資料與播放位置
  ballContactsRef.current = ballContacts
  currentFrameRef.current = currentFrame

  useEffect(() => {
    let cancelled = false
    setModel(null)
    setReady(false)
    setHasAppliedFrame(false)
    setFailed('')
    lastSentFrameRef.current = null
    setVShaped(null)

    ;(async () => {
      try {
        const loaded = await loadSmplForwardModel(playerReplay?.smpl_forward_model)
        if (!cancelled) setModel(loaded)
      } catch (err) {
        console.warn('SMPL forward assets unavailable:', err)
        if (!cancelled) setFailed(String(err))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [playerReplay?.smpl_forward_model])

  useEffect(() => {
    lastSentFrameRef.current = null
    requestIdRef.current += 1
    setHasAppliedFrame(false)
    baseRacketMatrixRef.current = null
    if (racketRef.current) racketRef.current.visible = false
  }, [playerReplay?.start_frame, playerReplay?.frame_count])

  useEffect(() => {
    let cancelled = false
    setRacketObject(null)

    loadRacketObject()
      .then((object) => {
        if (!cancelled) setRacketObject(prepareRacketObject(object))
      })
      .catch((err) => {
        console.warn('Racket OBJ unavailable:', err)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const geometry = useMemo(() => {
    if (!model?.shared?.arrays?.v_template?.length || !vShaped?.length) return null
    const geom = new THREE.BufferGeometry()
    geom.setIndex(new THREE.BufferAttribute(model.shared.arrays.faces, 1))
    geom.setAttribute(
      'position',
      new THREE.BufferAttribute(sourceToThreePositions(vShaped), 3)
    )
    const vertexCount = model.shared.meta.vertexCount
    const vertexIndices = new Float32Array(vertexCount)
    for (let vertex = 0; vertex < vertexCount; vertex++) vertexIndices[vertex] = vertex
    geom.setAttribute('smplVertexIndex', new THREE.BufferAttribute(vertexIndices, 1))
    for (let group = 0; group < 6; group++) {
      const weights = new Float32Array(vertexCount * 4)
      for (let vertex = 0; vertex < vertexCount; vertex++) {
        weights.set(model.shared.arrays.lbs_weights.subarray(vertex * SMPL_JOINT_COUNT + group * 4, vertex * SMPL_JOINT_COUNT + group * 4 + 4), vertex * 4)
      }
      geom.setAttribute(`smplWeight${group}`, new THREE.BufferAttribute(weights, 4))
    }
    geom.computeVertexNormals()
    return geom
  }, [model, vShaped])

  const poseDirections = useMemo(
    () => model?.shared?.arrays?.posedirs?.length ? createSmplPoseDirectionsTexture(model.shared.arrays.posedirs) : null,
    [model],
  )

  useEffect(() => () => poseDirections?.dispose(), [poseDirections])

  const material = useMemo(() => {
    if (!poseDirections || !model) return null
    return createSmplMaterial(
      playerReplay.player_index === 0 ? '#9fb7d9' : '#d6b69c',
      poseDirections,
      model.shared.meta.vertexCount,
    )
  }, [model, playerReplay.player_index, poseDirections])

  useEffect(() => () => material?.dispose(), [material])

  useEffect(() => {
    if (!model || !material) return undefined

    const worker = new Worker(new URL('../workers/smplForwardWorker.js', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    setReady(false)

    worker.onmessage = (event) => {
      const message = event.data
      if (message.type === 'ready') {
        setVShaped(message.vShaped)
        setReady(true)
        return
      }
      if (message.type !== 'frame') return

      if (message.requestId === requestIdRef.current) {
        const uniforms = material.userData.smplUniforms
        for (let joint = 0; joint < SMPL_JOINT_COUNT; joint++) {
          uniforms.smplJointMatrices.value[joint]
            .fromArray(message.jointMatrices, joint * 16)
            .transpose()
        }
        uniforms.smplPoseFeatures.value.set(message.poseFeature)
        uniforms.smplTranslation.value.fromArray(message.trans || [0, 0, 0])
        setHasAppliedFrame(true)

        if (racketRef.current && Array.isArray(message.racketMatrix)) {
          racketRef.current.visible = true

          if (!baseRacketMatrixRef.current) {
            baseRacketMatrixRef.current = new THREE.Matrix4()
          }

          baseRacketMatrixRef.current.fromArray(message.racketMatrix).transpose()

          applyRacketAim(
            racketRef.current,
            baseRacketMatrixRef.current,
            ballContactsRef.current,
            currentFrameRef.current,
          )
        }
      }
    }

    worker.onerror = (err) => {
      console.warn('SMPL forward worker failed:', err)
      setFailed(String(err.message || err))
    }

    worker.postMessage({
      type: 'init',
      vertexCount: model.shared.meta.vertexCount,
      jointCount: model.shared.meta.jointCount,
      shapeCount: model.shared.meta.shapeCount || 10,
      beta: playerReplay.beta || new Array(10).fill(0),
      shared: {
        parents: model.shared.arrays.parents,
        v_template: model.shared.arrays.v_template,
        shapedirs: model.shared.arrays.shapedirs,
        J_regressor: model.shared.arrays.J_regressor,
      },
      player: {},
    })

    return () => {
      worker.terminate()
      workerRef.current = null
      setReady(false)
    }
  }, [model, material, playerReplay.beta])

  useFrame((state) => {
    if (!ready || !workerRef.current || !geometry) return
    const poseFrame = getLocalPoseFrame(playerReplay, currentFrame)
    if (!poseFrame || poseFrame.valid === false) {
      if (racketRef.current) racketRef.current.visible = false
      return
    }

    // 姿態資料是稀疏的，同一個 poseFrame 會跨好幾格；
    // 但漸變權重要跟著 currentFrame 走，所以這裡每格都重算一次
    applyRacketAim(
      racketRef.current,
      baseRacketMatrixRef.current,
      ballContacts,
      currentFrame,
    )

    if (lastSentFrameRef.current === poseFrame.frame) return

    lastSentFrameRef.current = poseFrame.frame
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    workerRef.current.postMessage({
      type: 'frame',
      requestId,
      frame: poseFrame.frame,
      global_orient: poseFrame.global_orient,
      body_pose: poseFrame.body_pose,
      trans: poseFrame.trans,
      racket_pose: poseFrame.racket_pose,
      racket_transform: poseFrame.racket_transform,
      racket_frame_offset: poseFrame.racket_frame_offset,
    })
  })

  if (failed || !geometry || !material) return null

  return (
    <group>
      <mesh geometry={geometry} material={material} frustumCulled={false} castShadow receiveShadow visible={hasAppliedFrame} />
      {racketObject && (
        <primitive
          ref={racketRef}
          object={racketObject}
          matrixAutoUpdate={false}
          visible={false}
        />
      )}
    </group>
  )
}

function SmplReplayLayer({ replayData, ballContacts }) {
  const showSmplReplay = useAppStore(s => s.showSmplReplay)
  if (!showSmplReplay || !replayData?.players?.length) return null

  return (
    <group>
      {replayData.players.map(playerReplay => (
        <SmplForwardAvatar
          key={`${replayData.rally_id ?? replayData.score ?? replayData.start_frame}-${playerReplay.id}`}
          playerReplay={playerReplay}
          ballContacts={ballContacts}
        />
      ))}
    </group>
  )
}

function CourtRef() {
  const courtWidth = 6.1
  const courtLength = 13.4
  const netHeight = 1.55

  return (
    <group>
      <mesh position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, courtLength]} />
        <meshStandardMaterial color="#166534" />
      </mesh>

      <lineSegments>
        <edgesGeometry>
          <planeGeometry args={[courtWidth, courtLength]} />
        </edgesGeometry>
        <lineBasicMaterial color="white" linewidth={2} />
      </lineSegments>

      <mesh position={[0, -0.49, 1.98]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, 0.04]} />
        <meshBasicMaterial color="white" />
      </mesh>

      <mesh position={[0, -0.49, -1.98]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, 0.04]} />
        <meshBasicMaterial color="white" />
      </mesh>

      <mesh position={[0, -0.49, courtLength / 2 - 0.76]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, 0.04]} />
        <meshBasicMaterial color="white" />
      </mesh>

      <mesh position={[0, -0.49, -(courtLength / 2 - 0.76)]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, 0.04]} />
        <meshBasicMaterial color="white" />
      </mesh>

      <mesh position={[courtWidth / 2 - 0.46, -0.49, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.04, courtLength]} />
        <meshBasicMaterial color="white" />
      </mesh>

      <mesh position={[-(courtWidth / 2 - 0.46), -0.49, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.04, courtLength]} />
        <meshBasicMaterial color="white" />
      </mesh>

      <mesh position={[0, netHeight / 2 - 0.48, 0]}>
        <boxGeometry args={[courtWidth + 0.5, netHeight, 0.02]} />
        <meshStandardMaterial color="#cbd5e1" opacity={0.6} transparent />
      </mesh>

      <mesh position={[courtWidth / 2 + 0.25, netHeight / 2 - 0.49, 0]}>
        <cylinderGeometry args={[0.05, 0.05, netHeight]} />
        <meshStandardMaterial color="#e5e7eb" />
      </mesh>

      <mesh position={[-(courtWidth / 2 + 0.25), netHeight / 2 - 0.49, 0]}>
        <cylinderGeometry args={[0.05, 0.05, netHeight]} />
        <meshStandardMaterial color="#e5e7eb" />
      </mesh>
    </group>
  )
}

function CameraMarker({ cameraConfig }) {
  const activeCameraId = useAppStore(s => s.activeCameraId)
  const setActiveCameraFromScene = useAppStore(s => s.setActiveCameraFromScene)

  const isActive = activeCameraId === cameraConfig.id
  const position = cameraConfig.position || [0, 2, 0]
  const target = cameraConfig.target || [0, 0, 0]

  const direction = useMemo(() => {
    const from = new THREE.Vector3(...position)
    const to = new THREE.Vector3(...target)
    return to.sub(from).normalize()
  }, [position, target])

  const label = cameraConfig.index ?? cameraConfig.id.replace('cam', '')

  return (
    <group position={position}>
      <mesh
        onClick={(e) => {
          e.stopPropagation()
          setActiveCameraFromScene(cameraConfig.id)
        }}
      >
        <sphereGeometry args={[isActive ? 0.09 : 0.07, 12, 12]} />
        <meshStandardMaterial
          color={isActive ? '#facc15' : '#38bdf8'}
          emissive={isActive ? '#f59e0b' : '#0369a1'}
          emissiveIntensity={isActive ? 0.9 : 0.35}
        />
      </mesh>

      <arrowHelper
        args={[
          direction,
          new THREE.Vector3(0, 0, 0),
          0.38,
          isActive ? '#facc15' : '#38bdf8',
          0.11,
          0.06,
        ]}
      />

      <Html center distanceFactor={12} position={[0, 0.22, 0]}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setActiveCameraFromScene(cameraConfig.id)
          }}
          className={`camera-marker-button ${isActive ? 'active' : ''}`}
          title={`${cameraConfig.label} / ${cameraConfig.description || ''}`}
        >
          📷 {label}
        </button>
      </Html>
    </group>
  )
}

function RealCameraMarkers() {
  const cameras = useAppStore(s => s.cameras) || []
  const playing = useAppStore(s => s.playing)

  if (playing) return null

  return (
    <group>
      {cameras
        .filter(camera => camera.enabled !== false)
        .map(camera => (
          <CameraMarker key={camera.id} cameraConfig={camera} />
        ))}
    </group>
  )
}

function SceneCameraController() {
  const sceneCameraTargetId = useAppStore(s => s.sceneCameraTargetId)
  const cameras = useAppStore(s => s.cameras) || []
  const { camera, controls } = useThree()
  const targetPositionRef = useRef(null)
  const targetLookAtRef = useRef(null)

  useEffect(() => {
    const config = cameras.find(item => item.id === sceneCameraTargetId)
    if (!config || !config.position || !config.target) return

    const basePosition = new THREE.Vector3(...config.position)
    const lookAt = new THREE.Vector3(...config.target)
    const outward = basePosition.clone().sub(lookAt).normalize()
    const finalPosition = basePosition.clone().add(outward.multiplyScalar(1.8))
    finalPosition.y += 0.6

    targetPositionRef.current = finalPosition
    targetLookAtRef.current = lookAt
  }, [sceneCameraTargetId, cameras])

  useFrame(() => {
    const targetPosition = targetPositionRef.current
    const targetLookAt = targetLookAtRef.current
    if (!targetPosition || !targetLookAt) return

    camera.position.lerp(targetPosition, 0.08)

    if (controls?.target) {
      controls.target.lerp(targetLookAt, 0.08)
      controls.update()
    } else {
      camera.lookAt(targetLookAt)
    }

    if (camera.position.distanceTo(targetPosition) < 0.03) {
      targetPositionRef.current = null
      targetLookAtRef.current = null
    }
  })

  return null
}

function CursorZoomControls({
  minDistance = 1.8,
  maxDistance = 45,
  zoomSpeed = 0.14,
  targetFollow = 0.35,
}) {
  const { camera, gl, controls } = useThree()

  const raycasterRef = useRef(new THREE.Raycaster())
  const mouseRef = useRef(new THREE.Vector2())
  const groundPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const hitPointRef = useRef(new THREE.Vector3())
  const directionRef = useRef(new THREE.Vector3())
  const nextCameraPositionRef = useRef(new THREE.Vector3())

  useEffect(() => {
    const dom = gl.domElement
    if (!dom) return

    const handleWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()

      const rect = dom.getBoundingClientRect()
      if (!rect.width || !rect.height) return

      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      const raycaster = raycasterRef.current
      raycaster.setFromCamera(mouseRef.current, camera)

      const hitPoint = hitPointRef.current
      const hasGroundHit = raycaster.ray.intersectPlane(groundPlaneRef.current, hitPoint)

      const zoomCenter =
        hasGroundHit &&
        Number.isFinite(hitPoint.x) &&
        Number.isFinite(hitPoint.y) &&
        Number.isFinite(hitPoint.z)
          ? hitPoint
          : controls?.target || new THREE.Vector3(0, 0, 0)

      const currentDistance = camera.position.distanceTo(zoomCenter)
      const zoomIn = e.deltaY < 0
      const nextDistance = THREE.MathUtils.clamp(
        currentDistance * (zoomIn ? 1 - zoomSpeed : 1 + zoomSpeed),
        minDistance,
        maxDistance
      )

      directionRef.current
        .copy(camera.position)
        .sub(zoomCenter)
        .normalize()

      nextCameraPositionRef.current
        .copy(zoomCenter)
        .add(directionRef.current.multiplyScalar(nextDistance))

      camera.position.copy(nextCameraPositionRef.current)

      if (controls?.target) {
        controls.target.lerp(zoomCenter, zoomIn ? targetFollow : targetFollow * 0.5)
        controls.update()
      } else {
        camera.lookAt(zoomCenter)
      }
    }

    dom.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      dom.removeEventListener('wheel', handleWheel)
    }
  }, [camera, gl, controls, minDistance, maxDistance, zoomSpeed, targetFollow])

  return null
}

export default function Scene3D() {
  const matchId = useAppStore(s => s.matchId)
  const currentFrame = useAppStore(s => s.currentFrame)
  const selectedTrajFrames = useAppStore(s => s.selectedTrajFrames)
  const clearTrajSelection = useAppStore(s => s.clearTrajSelection)
  const repairMode = useAppStore(s => s.repairMode)
  const setRepairMode = useAppStore(s => s.setRepairMode)
  const upsertTrajPoints = useAppStore(s => s.upsertTrajPoints)
  const activeCameraId = useAppStore(s => s.activeCameraId)
  const cameras = useAppStore(s => s.cameras) || []
  const replaySegments = useAppStore(s => s.replaySegments) || []
  const activeReplaySegmentId = useAppStore(s => s.activeReplaySegmentId)
  const setActiveReplaySegment = useAppStore(s => s.setActiveReplaySegment)
  const showSmplReplay = useAppStore(s => s.showSmplReplay)
  const toggleSmplReplay = useAppStore(s => s.toggleSmplReplay)
  const smplReplayBySegmentId = useAppStore(s => s.smplReplayBySegmentId)
  const setSmplReplayData = useAppStore(s => s.setSmplReplayData)
  const [repairing, setRepairing] = useState(false)
  const [smplReplayStatus, setSmplReplayStatus] = useState('idle')

  const activeCamera = cameras.find(camera => camera.id === activeCameraId)
  const activeReplayIndex = replaySegments.findIndex(item => item.id === activeReplaySegmentId)
  const activeReplaySegment = activeReplayIndex >= 0 ? replaySegments[activeReplayIndex] : null
  const replayData = activeReplaySegmentId ? smplReplayBySegmentId.get(activeReplaySegmentId) : null

  const goToReplaySegment = (index) => {
    if (!replaySegments.length) return
    const clamped = Math.max(0, Math.min(replaySegments.length - 1, index))
    setActiveReplaySegment(replaySegments[clamped].id)
  }


  useEffect(() => {
    if (!replaySegments.length) return
    if (
      activeReplaySegment &&
      currentFrame >= activeReplaySegment.start_frame &&
      currentFrame <= activeReplaySegment.end_frame
    ) {
      return
    }

    const sortedSegments = [...replaySegments].sort((first, second) => (
      first.start_frame - second.start_frame
    ))
    const segment = sortedSegments.find(item => currentFrame <= item.end_frame)
    if (segment && segment.id !== activeReplaySegmentId) {
      setActiveReplaySegment(segment.id)
    }
  }, [
    currentFrame,
    replaySegments,
    activeReplaySegment,
    activeReplaySegmentId,
    setActiveReplaySegment,
  ])

  useEffect(() => {
    if (!activeReplaySegment || smplReplayBySegmentId.has(activeReplaySegment.id)) return

    let cancelled = false
    setSmplReplayStatus('loading')

    ;(async () => {
      try {
        const { api } = await import('../api.js')
        const data = await api.getSmplReplay(
          matchId,
          activeReplaySegment.start_frame,
          activeReplaySegment.end_frame,
        )
        if (cancelled) return
        setSmplReplayData(activeReplaySegment.id, data)
        setSmplReplayStatus(data?.players?.length ? 'ready' : 'empty')
      } catch (error) {
        if (cancelled) return
        console.warn('SMPL replay unavailable:', error)
        setSmplReplayData(activeReplaySegment.id, {
          players: [],
          error: String(error),
        })
        setSmplReplayStatus('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    activeReplaySegment,
    matchId,
    smplReplayBySegmentId,
    setSmplReplayData,
  ])

  const handleRepair = async () => {
    if (selectedTrajFrames.length !== 2) return

    setRepairing(true)

    try {
      const { api } = await import('../api.js')
      const start_frame = Math.min(...selectedTrajFrames)
      const end_frame = Math.max(...selectedTrajFrames)

      const res = await api.repairTraj(matchId, {
        start_frame,
        end_frame,
      })

      const updatedPts = await api.getTraj(matchId, start_frame, end_frame)
      upsertTrajPoints(updatedPts)

      alert(`修復成功！已更新 ${res.count} 個 frame 的資料。`)
      clearTrajSelection()
      setRepairMode(false)
    } catch (e) {
      console.error(e)
      alert('修復失敗：' + String(e))
    } finally {
      setRepairing(false)
    }
  }

  const { points, contacts: ballContacts } = useRallyBallData()

  return (
    <div className="w-full h-full relative bg-zinc-950 overflow-hidden">
      <div className="absolute top-2 left-2 z-20 bg-zinc-900/80 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 shadow backdrop-blur-md">
        3D Camera：<span className="text-yellow-300 font-semibold">{activeCamera?.label || activeCameraId}</span>
        {activeCamera?.description && (
          <span className="text-zinc-400 ml-2">{activeCamera.description}</span>
        )}
        <span className="text-zinc-500 ml-2">滾輪依滑鼠位置縮放｜右鍵平移｜點 📷 切換影片</span>
      </div>

      <div className="absolute top-2 right-2 z-20">
        <div className="flex items-center gap-2">
          {activeReplaySegment && (
            <div className="flex items-center bg-zinc-900/80 border border-zinc-800 rounded shadow backdrop-blur-md overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => goToReplaySegment(activeReplayIndex - 1)}
                disabled={activeReplayIndex <= 0}
                className="px-2 py-1.5 text-zinc-300 disabled:opacity-30"
                title="上一個 Rally 人體重播"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={toggleSmplReplay}
                className={`px-3 py-1.5 font-semibold border-x border-zinc-800 ${
                  showSmplReplay
                    ? 'text-emerald-200 bg-emerald-900/40'
                    : 'text-zinc-300'
                }`}
                title="顯示或隱藏人物與球拍"
              >
                人物球拍 {showSmplReplay ? '開' : '關'} · {smplReplayStatus}
              </button>
              <button
                type="button"
                onClick={() => goToReplaySegment(activeReplayIndex + 1)}
                disabled={activeReplayIndex < 0 || activeReplayIndex >= replaySegments.length - 1}
                className="px-2 py-1.5 text-zinc-300 disabled:opacity-30"
                title="下一個 Rally 人體重播"
              >
                ▶
              </button>
            </div>
          )}

          <button
            onClick={() => {
              if (repairMode) clearTrajSelection()
              setRepairMode(!repairMode)
            }}
            className={`px-3 py-1 rounded border text-xs font-semibold shadow ${
              repairMode
                ? 'bg-sky-800 border-sky-700 text-sky-100'
                : 'bg-zinc-900/80 border-zinc-800 text-zinc-200'
            }`}
          >
            {repairMode ? 'Repair mode on' : 'Repair mode off'}
          </button>
        </div>
      </div>

      {repairMode && selectedTrajFrames.length > 0 && (
        <div className="absolute top-12 right-2 z-20 bg-zinc-900/80 border border-zinc-800 rounded p-3 text-sm shadow-xl flex flex-col gap-2 w-64 backdrop-blur-md">
          <div className="text-zinc-200 font-semibold mb-1">修復軌跡資料</div>
          <div className="text-zinc-400 text-xs">
            已選取點：{selectedTrajFrames.join(' 和 ')}
            <br />
            請點兩個異常頭尾的軌跡點
          </div>

          <div className="flex gap-2 mt-2">
            <button
              onClick={handleRepair}
              disabled={selectedTrajFrames.length !== 2 || repairing}
              className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded px-3 py-1 font-medium transition-colors"
            >
              {repairing ? '修復中...' : '執行修復'}
            </button>

            <button
              onClick={clearTrajSelection}
              disabled={repairing}
              className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 transition-colors"
            >
              清除
            </button>
          </div>
        </div>
      )}

      <Canvas camera={{ position: [8, 5, 8], fov: 55 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 20, 10]} intensity={1.5} castShadow />

        <CourtRef />
        <RealCameraMarkers />
        <SmplReplayLayer replayData={replayData} ballContacts={ballContacts} />
        <AnimatedTrajectory points={points} />
        <PlaybackController />

        <OrbitControls
          makeDefault
          target={[0, 0, 0]}
          enableZoom={false}
          enablePan
          enableRotate
          enableDamping
          dampingFactor={0.08}
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN,
          }}
        />

        <CursorZoomControls />

        <SceneCameraController />
      </Canvas>
    </div>
  )
}
