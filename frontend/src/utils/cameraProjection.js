// Cam 3 / Cam 4 camera parameters converted from ParamData/camera_params/*.npy
// intrinsic format: [fx, fy, cx, cy, k1, k2, p1, p2, k3]
// extrinsic format: 3x4 [R | t]

export const CAMERA_PROJECTION_PARAMS = {
  cam3: {
    id: 'cam3',
    label: 'Cam 3',
    imageWidth: 1920,
    imageHeight: 1200,
    intrinsic: [
      942.8571166992188,
      977.551025390625,
      960.0,
      600.0,
      -0.2368421107530594,
      0.07894736528396606,
      0.0,
      -0.03684210404753685,
      0.005263158120214939,
    ],
    extrinsic: [
      [0.9996144436789247, -0.024843204248905182, 0.012400750432329672, -0.005447549667836497],
      [0.027107878931261803, 0.7764985984568306, -0.6295356153657722, -2.0513151279256635],
      [0.006010516538656062, 0.6296290524144962, 0.7768726604111997, 8.739573355132804],
    ],
  },

  cam4: {
    id: 'cam4',
    label: 'Cam 4',
    imageWidth: 1920,
    imageHeight: 1200,
    intrinsic: [
      920.60302734375,
      931.15576171875,
      960.0,
      600.0,
      -0.17989949882030487,
      0.0,
      -0.023115577176213264,
      0.0,
      0.0,
    ],
    extrinsic: [
      [-0.9971281289458154, -0.003346391049807432, 0.07565907890155109, -0.503519381547902],
      [0.05446002568058059, 0.6625389403335138, 0.7470450176058654, -3.0548143230649343],
      [-0.05262699066235076, 0.7490199963460731, -0.6604539687662429, 7.899915580301135],
    ],
  },
}

export function getProjectionParams(cameraId) {
  return CAMERA_PROJECTION_PARAMS[cameraId] || null
}

export function hasProjectionParams(cameraId) {
  return Boolean(getProjectionParams(cameraId))
}

function toPointArray(point) {
  if (Array.isArray(point)) return point
  return [point.x, point.y, point.z]
}

function isFinitePoint(point) {
  return point.every(Number.isFinite)
}

/**
 * Project one 3D ball point to camera 2D pixel coordinate.
 *
 * Input point should use the original ball_new / DB coordinates:
 *   { x, y, z }
 * Do not use the Scene3D display transform [x, -y, -z] here.
 */
export function project3DToImage(point, cameraParams) {
  if (!point || !cameraParams) return null

  const world = toPointArray(point)
  if (!isFinitePoint(world)) return null

  const [X, Y, Z] = world
  const E = cameraParams.extrinsic
  const [fx, fy, cx, cy, k1, k2, p1, p2, k3] = cameraParams.intrinsic

  // Camera coordinates = R * world + t
  const Xc = E[0][0] * X + E[0][1] * Y + E[0][2] * Z + E[0][3]
  const Yc = E[1][0] * X + E[1][1] * Y + E[1][2] * Z + E[1][3]
  const Zc = E[2][0] * X + E[2][1] * Y + E[2][2] * Z + E[2][3]

  if (!Number.isFinite(Zc) || Zc <= 1e-6) return null

  const x = Xc / Zc
  const y = Yc / Zc

  // OpenCV-style radial + tangential distortion
  const r2 = x * x + y * y
  const r4 = r2 * r2
  const r6 = r4 * r2
  const radial = 1 + k1 * r2 + k2 * r4 + k3 * r6

  const xDistorted = x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x)
  const yDistorted = y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y

  const u = fx * xDistorted + cx
  const v = fy * yDistorted + cy

  if (!Number.isFinite(u) || !Number.isFinite(v)) return null

  return {
    u,
    v,
    depth: Zc,
    cameraPoint: { x: Xc, y: Yc, z: Zc },
    insideImage:
      u >= 0 &&
      u <= cameraParams.imageWidth &&
      v >= 0 &&
      v <= cameraParams.imageHeight,
  }
}

export function projectTrajectoryPoints(points, cameraParams) {
  return (points || [])
    .map((point) => {
      const projected = project3DToImage(point, cameraParams)
      if (!projected) return null

      return {
        ...projected,
        frame: point.frame,
        original: point,
      }
    })
    .filter(Boolean)
}
