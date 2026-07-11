let model = null
let pendingFrameMessage = null

function rodrigues(v) {
  const x0 = Number(v?.[0] || 0)
  const y0 = Number(v?.[1] || 0)
  const z0 = Number(v?.[2] || 0)
  const theta = Math.hypot(x0, y0, z0)
  if (theta < 1e-8) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const x = x0 / theta
  const y = y0 / theta
  const z = z0 / theta
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const t = 1 - c
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * y * x + s * z, t * y * y + c, t * y * z - s * x,
    t * z * x - s * y, t * z * y + s * x, t * z * z + c,
  ]
}

function mat4Mul(a, b) {
  const out = new Float32Array(16)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4] * b[c] +
        a[r * 4 + 1] * b[4 + c] +
        a[r * 4 + 2] * b[8 + c] +
        a[r * 4 + 3] * b[12 + c]
    }
  }
  return out
}

function transformMat(R, x, y, z) {
  return new Float32Array([
    R[0], R[1], R[2], x,
    R[3], R[4], R[5], y,
    R[6], R[7], R[8], z,
    0, 0, 0, 1,
  ])
}

function flattenBodyPose(bodyPose) {
  if (!Array.isArray(bodyPose)) return []
  return Array.isArray(bodyPose[0]) ? bodyPose.flat() : bodyPose
}

function buildPose(globalOrient, bodyPose) {
  const body = flattenBodyPose(bodyPose)
  const rotMats = new Float32Array(24 * 9)
  const poseFeature = new Float32Array(23 * 9)

  for (let joint = 0; joint < 24; joint++) {
    const axisAngle = joint === 0
      ? globalOrient
      : body.slice((joint - 1) * 3, (joint - 1) * 3 + 3)
    const R = rodrigues(axisAngle)
    rotMats.set(R, joint * 9)
    if (joint > 0) {
      const offset = (joint - 1) * 9
      for (let i = 0; i < 9; i++) {
        poseFeature[offset + i] = R[i] - (i % 4 === 0 ? 1 : 0)
      }
    }
  }

  return { rotMats, poseFeature }
}

function computeVPosedInto(out, vShaped, posedirs, poseFeature, vertexCount) {
  out.set(vShaped)
  const coordCount = vertexCount * 3
  for (let coord = 0; coord < coordCount; coord++) {
    let sum = 0
    for (let p = 0; p < poseFeature.length; p++) {
      sum += poseFeature[p] * posedirs[p * coordCount + coord]
    }
    out[coord] += sum
  }
}

function computeVShaped(beta) {
  const vertexCount = model.vertexCount
  const shapeCount = model.shapeCount
  const vTemplate = model.shared.v_template
  const shapedirs = model.shared.shapedirs
  const out = new Float32Array(vTemplate)

  for (let vertex = 0; vertex < vertexCount; vertex++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0
      const base = (vertex * 3 + c) * shapeCount
      for (let b = 0; b < shapeCount; b++) {
        sum += shapedirs[base + b] * Number(beta?.[b] || 0)
      }
      out[vertex * 3 + c] += sum
    }
  }

  return out
}

function computeJoints(vShaped) {
  const vertexCount = model.vertexCount
  const jointCount = model.jointCount
  const regressor = model.shared.J_regressor
  const joints = new Float32Array(jointCount * 3)

  for (let joint = 0; joint < jointCount; joint++) {
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const w = regressor[joint * vertexCount + vertex]
      if (!w) continue
      joints[joint * 3] += w * vShaped[vertex * 3]
      joints[joint * 3 + 1] += w * vShaped[vertex * 3 + 1]
      joints[joint * 3 + 2] += w * vShaped[vertex * 3 + 2]
    }
  }

  return joints
}

function computeTransforms(rotMats, joints, parents, jointCount) {
  const chain = Array(jointCount)
  for (let joint = 0; joint < jointCount; joint++) {
    const parent = parents[joint]
    const R = rotMats.subarray(joint * 9, joint * 9 + 9)
    let x = joints[joint * 3]
    let y = joints[joint * 3 + 1]
    let z = joints[joint * 3 + 2]
    if (parent >= 0) {
      x -= joints[parent * 3]
      y -= joints[parent * 3 + 1]
      z -= joints[parent * 3 + 2]
    }
    const local = transformMat(R, x, y, z)
    chain[joint] = parent >= 0 ? mat4Mul(chain[parent], local) : local
  }

  return chain.map((m, joint) => {
    const x = joints[joint * 3]
    const y = joints[joint * 3 + 1]
    const z = joints[joint * 3 + 2]
    const out = new Float32Array(m)
    out[3] -= m[0] * x + m[1] * y + m[2] * z
    out[7] -= m[4] * x + m[5] * y + m[6] * z
    out[11] -= m[8] * x + m[9] * y + m[10] * z
    return out
  })
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ]
}

function sourceRacketTransformToThreeMatrix(racketTransform, racketFrameOffset) {
  if (!Array.isArray(racketTransform) || !Array.isArray(racketTransform[0])) return null
  const offset = Array.isArray(racketFrameOffset) ? racketFrameOffset : [0, 0, 0]
  const m = [
    Number(racketTransform[0][0] || 0), Number(racketTransform[0][1] || 0), Number(racketTransform[0][2] || 0), Number(racketTransform[0][3] || 0),
    Number(racketTransform[1][0] || 0), Number(racketTransform[1][1] || 0), Number(racketTransform[1][2] || 0), Number(racketTransform[1][3] || 0),
    Number(racketTransform[2][0] || 0), Number(racketTransform[2][1] || 0), Number(racketTransform[2][2] || 0), Number(racketTransform[2][3] || 0),
    0, 0, 0, 1,
  ]

  m[3] += m[0] * Number(offset[0] || 0) + m[1] * Number(offset[1] || 0) + m[2] * Number(offset[2] || 0)
  m[7] += m[4] * Number(offset[0] || 0) + m[5] * Number(offset[1] || 0) + m[6] * Number(offset[2] || 0)
  m[11] += m[8] * Number(offset[0] || 0) + m[9] * Number(offset[1] || 0) + m[10] * Number(offset[2] || 0)

  return [
    m[0], m[1], m[2], m[3],
    -m[4], -m[5], -m[6], -m[7],
    -m[8], -m[9], -m[10], -m[11],
    0, 0, 0, 1,
  ]
}

function computeRacketMatrix(racketPose, rotMats, joints, parents, trans) {
  if (!Array.isArray(racketPose)) return null

  const wristJoint = 23
  const forearmJoint = 21
  const j21x = joints[forearmJoint * 3]
  const j21y = joints[forearmJoint * 3 + 1]
  const j21z = joints[forearmJoint * 3 + 2]
  const j23x = joints[wristJoint * 3]
  const j23y = joints[wristJoint * 3 + 1]
  const j23z = joints[wristJoint * 3 + 2]
  const dx = j23x - j21x
  const dy = j23y - j21y
  const dz = j23z - j21z
  const invLen = 1 / Math.max(Math.hypot(dx, dy, dz), 1e-8)
  const racketJoint = [
    j21x + 0.67 * dx * invLen,
    j21y + 0.67 * dy * invLen,
    j21z + 0.67 * dz * invLen,
  ]
  const parentJoint = [
    joints[wristJoint * 3],
    joints[wristJoint * 3 + 1],
    joints[wristJoint * 3 + 2],
  ]

  const chain = Array(model.jointCount + 1)
  const racketRotation = rodrigues(racketPose)
  for (let joint = 0; joint < model.jointCount; joint++) {
    const parent = parents[joint]
    const R = joint === wristJoint
      ? racketRotation
      : rotMats.subarray(joint * 9, joint * 9 + 9)
    let x = joints[joint * 3]
    let y = joints[joint * 3 + 1]
    let z = joints[joint * 3 + 2]
    if (parent >= 0) {
      x -= joints[parent * 3]
      y -= joints[parent * 3 + 1]
      z -= joints[parent * 3 + 2]
    }
    const local = transformMat(R, x, y, z)
    chain[joint] = parent >= 0 ? mat4Mul(chain[parent], local) : local
  }

  const localRacketJoint = transformMat(
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    racketJoint[0] - parentJoint[0],
    racketJoint[1] - parentJoint[1],
    racketJoint[2] - parentJoint[2]
  )
  chain[model.jointCount] = mat4Mul(chain[wristJoint], localRacketJoint)

  const sourceMatrix = chain[model.jointCount]
  const transformedRestJoint = transformPoint(sourceMatrix, racketJoint[0], racketJoint[1], racketJoint[2])
  sourceMatrix[3] -= transformedRestJoint[0]
  sourceMatrix[7] -= transformedRestJoint[1]
  sourceMatrix[11] -= transformedRestJoint[2]

  const frameOffset = [
    model.racketFrameOffset[0],
    model.racketFrameOffset[1],
    model.racketFrameOffset[2],
  ]
  sourceMatrix[3] += sourceMatrix[0] * frameOffset[0] + sourceMatrix[1] * frameOffset[1] + sourceMatrix[2] * frameOffset[2]
  sourceMatrix[7] += sourceMatrix[4] * frameOffset[0] + sourceMatrix[5] * frameOffset[1] + sourceMatrix[6] * frameOffset[2]
  sourceMatrix[11] += sourceMatrix[8] * frameOffset[0] + sourceMatrix[9] * frameOffset[1] + sourceMatrix[10] * frameOffset[2]

  sourceMatrix[3] += Number(trans?.[0] || 0)
  sourceMatrix[7] += Number(trans?.[1] || 0)
  sourceMatrix[11] += Number(trans?.[2] || 0)

  return [
    sourceMatrix[0], sourceMatrix[1], sourceMatrix[2], sourceMatrix[3],
    -sourceMatrix[4], -sourceMatrix[5], -sourceMatrix[6], -sourceMatrix[7],
    -sourceMatrix[8], -sourceMatrix[9], -sourceMatrix[10], -sourceMatrix[11],
    0, 0, 0, 1,
  ]
}

function skinInto(positions, vPosed, transforms, weights, trans, vertexCount, jointCount) {
  const tx = Number(trans?.[0] || 0)
  const ty = Number(trans?.[1] || 0)
  const tz = Number(trans?.[2] || 0)

  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const x = vPosed[vertex * 3]
    const y = vPosed[vertex * 3 + 1]
    const z = vPosed[vertex * 3 + 2]
    let ox = 0
    let oy = 0
    let oz = 0

    for (let joint = 0; joint < jointCount; joint++) {
      const w = weights[vertex * jointCount + joint]
      if (!w) continue
      const m = transforms[joint]
      ox += w * (m[0] * x + m[1] * y + m[2] * z + m[3])
      oy += w * (m[4] * x + m[5] * y + m[6] * z + m[7])
      oz += w * (m[8] * x + m[9] * y + m[10] * z + m[11])
    }

    positions[vertex * 3] = ox + tx
    positions[vertex * 3 + 1] = -(oy + ty)
    positions[vertex * 3 + 2] = -(oz + tz)
  }
}

function computeFrameInto(message, positions) {
  const { rotMats, poseFeature } = buildPose(message.global_orient, message.body_pose)
  computeVPosedInto(model.vPosed, model.vShaped, model.shared.posedirs, poseFeature, model.vertexCount)
  const transforms = computeTransforms(rotMats, model.joints, model.shared.parents, model.jointCount)
  skinInto(positions, model.vPosed, transforms, model.shared.lbs_weights, message.trans, model.vertexCount, model.jointCount)
  const precomputedRacketMatrix = sourceRacketTransformToThreeMatrix(
    message.racket_transform,
    message.racket_frame_offset
  )
  if (precomputedRacketMatrix) return precomputedRacketMatrix
  return computeRacketMatrix(message.racket_pose, rotMats, model.joints, model.shared.parents, message.trans)
}

function acquireOutputBuffer() {
  return model.outputPool.pop() || null
}

function releaseOutputBuffer(buffer) {
  const coordCount = model.vertexCount * 3
  if (!buffer || buffer.byteLength !== coordCount * Float32Array.BYTES_PER_ELEMENT) return
  model.outputPool.push(new Float32Array(buffer))
}

function processFrameMessage(message) {
  const positions = acquireOutputBuffer()
  if (!positions) {
    pendingFrameMessage = message
    return
  }

  const racketMatrix = computeFrameInto(message, positions)
  self.postMessage({
    type: 'frame',
    requestId: message.requestId,
    playerId: message.playerId,
    frame: message.frame,
    positions,
    racketMatrix,
  }, [positions.buffer])
}

function flushPendingFrame() {
  if (!pendingFrameMessage || !model?.outputPool?.length) return
  const message = pendingFrameMessage
  pendingFrameMessage = null
  processFrameMessage(message)
}

self.onmessage = (event) => {
  const message = event.data
  if (message.type === 'init') {
    model = {
      vertexCount: message.vertexCount,
      jointCount: message.jointCount,
      shapeCount: message.shapeCount || 10,
      beta: message.beta || new Array(message.shapeCount || 10).fill(0),
      shared: message.shared,
      player: message.player,
    }
    model.vShaped = computeVShaped(model.beta)
    model.joints = computeJoints(model.vShaped)
    model.racketFrameOffset = [
      model.joints[23 * 3],
      model.joints[23 * 3 + 1],
      model.joints[23 * 3 + 2],
    ]
    model.vPosed = new Float32Array(model.vertexCount * 3)
    model.outputPool = [
      new Float32Array(model.vertexCount * 3),
      new Float32Array(model.vertexCount * 3),
    ]
    pendingFrameMessage = null
    self.postMessage({ type: 'ready' })
    return
  }

  if (!model) return

  if (message.type === 'release') {
    releaseOutputBuffer(message.buffer)
    flushPendingFrame()
    return
  }

  if (message.type === 'frame') {
    processFrameMessage(message)
  }
}
