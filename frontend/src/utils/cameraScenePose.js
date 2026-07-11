// frontend/src/utils/cameraScenePose.js

import cameraParamsJson from '../assets/camera_params.json'

function mat3Transpose(R) {
  return [
    [R[0][0], R[1][0], R[2][0]],
    [R[0][1], R[1][1], R[2][1]],
    [R[0][2], R[1][2], R[2][2]],
  ]
}

function mat3VecMul(M, v) {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ]
}

function addVec(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scaleVec(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s]
}

function rawToScene(point) {
  // 對齊 Scene3D.jsx 裡的 new THREE.Vector3(p.x, -p.y, -p.z)
  return [point[0], -point[1], -point[2]]
}

export function getCameraScenePose(cameraParams, lookDistance = 4) {
  if (!cameraParams?.extrinsic) {
    return {
      position: [0, 3, 0],
      target: [0, 0, 0],
    }
  }

  const E = cameraParams.extrinsic

  const R = [
    [E[0][0], E[0][1], E[0][2]],
    [E[1][0], E[1][1], E[1][2]],
    [E[2][0], E[2][1], E[2][2]],
  ]

  const t = [E[0][3], E[1][3], E[2][3]]

  // extrinsic 是 world -> camera:
  // X_cam = R * X_world + t
  // camera center in world:
  // C = -R^T * t
  const Rt = mat3Transpose(R)
  const cameraCenterRaw = scaleVec(mat3VecMul(Rt, t), -1)

  // OpenCV camera optical axis 通常是 camera +Z
  // 換回 world direction:
  // forward_world = R^T * [0, 0, 1]
  const forwardRaw = mat3VecMul(Rt, [0, 0, 1])
  const targetRaw = addVec(cameraCenterRaw, scaleVec(forwardRaw, lookDistance))

  return {
    position: rawToScene(cameraCenterRaw),
    target: rawToScene(targetRaw),
  }
}

export function buildDefaultCamerasFromCameraParams() {
  const cameras = cameraParamsJson.cameras || {}

  return Array.from({ length: 10 }, (_, index) => {
    const id = `cam${index}`
    const params = cameras[id]
    const pose = getCameraScenePose(params, 4)

    return {
      id,
      index,
      label: `Cam ${index}`,
      fileName: `${index}.mp4`,
      video_url: null,
      fps: 50,
      offset_frame: 0,
      position: pose.position,
      target: pose.target,
      enabled: true,
    }
  })
}