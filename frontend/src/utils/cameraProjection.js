// frontend/src/utils/cameraProjection.js

import cameraParamsJson from '../assets/camera_params.json'

export const PROJECTION_COORDINATE_MODE = cameraParamsJson.coordinateMode || 'raw'
export const USE_LENS_DISTORTION = cameraParamsJson.useLensDistortion ?? true

export const COURT_WORLD_TRANSFORM = cameraParamsJson.courtWorldTransform || {
  xOffset: 0,
  zOffset: 0,
  rotateDeg: 0,
  xScale: 1,
  zScale: 1,
  yOffset: 0,
}

export const CAMERA_PROJECTION_PARAMS = cameraParamsJson.cameras || {}

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

export function applyProjectionCoordinateTransform(point, mode = PROJECTION_COORDINATE_MODE) {
  const raw = toPointArray(point)
  if (!isFinitePoint(raw)) return null

  const [x, y, z] = raw

  switch (mode) {
    case 'scene':
      return [x, -y, -z]

    case 'flipZ':
      return [x, y, -z]

    case 'flipY':
      return [x, -y, z]

    case 'flipX':
      return [-x, y, z]

    case 'flipXFlipZ':
      return [-x, y, -z]

    case 'flipXFlipYFlipZ':
      return [-x, -y, -z]

    case 'raw':
    default:
      return [x, y, z]
  }
}

export function transformCourtPoint(point) {
  const raw = Array.isArray(point)
    ? { x: point[0], y: point[1], z: point[2] }
    : point

  const x0 = raw.x * COURT_WORLD_TRANSFORM.xScale
  const z0 = raw.z * COURT_WORLD_TRANSFORM.zScale

  const theta = (COURT_WORLD_TRANSFORM.rotateDeg * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)

  const xRot = x0 * cos - z0 * sin
  const zRot = x0 * sin + z0 * cos

  return {
    x: xRot + COURT_WORLD_TRANSFORM.xOffset,
    y: raw.y + COURT_WORLD_TRANSFORM.yOffset,
    z: zRot + COURT_WORLD_TRANSFORM.zOffset,
  }
}

export function project3DToImage(point, cameraParams, options = {}) {
  if (!point || !cameraParams) return null

  const world = applyProjectionCoordinateTransform(point, options.coordinateMode)
  if (!world) return null

  const [X, Y, Z] = world
  const E = cameraParams.extrinsic
  const [fx, fy, cx, cy, k1, k2, p1, p2, k3] = cameraParams.intrinsic

  const Xc = E[0][0] * X + E[0][1] * Y + E[0][2] * Z + E[0][3]
  const Yc = E[1][0] * X + E[1][1] * Y + E[1][2] * Z + E[1][3]
  const Zc = E[2][0] * X + E[2][1] * Y + E[2][2] * Z + E[2][3]

  if (!Number.isFinite(Zc) || Zc <= 1e-6) return null

  const x = Xc / Zc
  const y = Yc / Zc

  let xProjected = x
  let yProjected = y

  if (USE_LENS_DISTORTION) {
    const r2 = x * x + y * y
    const r4 = r2 * r2
    const r6 = r4 * r2
    const radial = 1 + k1 * r2 + k2 * r4 + k3 * r6

    xProjected =
      x * radial +
      2 * p1 * x * y +
      p2 * (r2 + 2 * x * x)

    yProjected =
      y * radial +
      p1 * (r2 + 2 * y * y) +
      2 * p2 * x * y
  }

  const u = fx * xProjected + cx + (cameraParams.uOffset || 0)
  const v = fy * yProjected + cy + (cameraParams.vOffset || 0)

  if (!Number.isFinite(u) || !Number.isFinite(v)) return null

  return {
    u,
    v,
    depth: Zc,
    cameraPoint: {
      x: Xc,
      y: Yc,
      z: Zc,
    },
    insideImage:
      u >= 0 &&
      u <= cameraParams.imageWidth &&
      v >= 0 &&
      v <= cameraParams.imageHeight,
  }
}

export function projectTrajectoryPoints(points, cameraParams, options = {}) {
  return (points || [])
    .map((point) => {
      const projected = project3DToImage(point, cameraParams, options)
      if (!projected) return null

      return {
        ...projected,
        frame: point.frame,
        original: point,
      }
    })
    .filter(Boolean)
}

const HALF_WIDTH = 3.05
const HALF_LENGTH = 6.7
const SINGLE_HALF_WIDTH = 2.59
const SHORT_SERVICE = 1.98
const DOUBLE_LONG_SERVICE_FROM_BACK = 0.76
const DOUBLE_LONG_SERVICE_Z = HALF_LENGTH - DOUBLE_LONG_SERVICE_FROM_BACK

function p(x, y, z) {
  return { x, y, z }
}

export const BADMINTON_COURT_LINES = [
  {
    name: 'outer_left',
    from: p(-HALF_WIDTH, 0, -HALF_LENGTH),
    to: p(-HALF_WIDTH, 0, HALF_LENGTH),
  },
  {
    name: 'outer_right',
    from: p(HALF_WIDTH, 0, -HALF_LENGTH),
    to: p(HALF_WIDTH, 0, HALF_LENGTH),
  },
  {
    name: 'outer_near',
    from: p(-HALF_WIDTH, 0, -HALF_LENGTH),
    to: p(HALF_WIDTH, 0, -HALF_LENGTH),
  },
  {
    name: 'outer_far',
    from: p(-HALF_WIDTH, 0, HALF_LENGTH),
    to: p(HALF_WIDTH, 0, HALF_LENGTH),
  },

  {
    name: 'single_left',
    from: p(-SINGLE_HALF_WIDTH, 0, -HALF_LENGTH),
    to: p(-SINGLE_HALF_WIDTH, 0, HALF_LENGTH),
  },
  {
    name: 'single_right',
    from: p(SINGLE_HALF_WIDTH, 0, -HALF_LENGTH),
    to: p(SINGLE_HALF_WIDTH, 0, HALF_LENGTH),
  },

  {
    name: 'net',
    from: p(-HALF_WIDTH, 0, 0),
    to: p(HALF_WIDTH, 0, 0),
  },

  {
    name: 'center_near',
    from: p(0, 0, -DOUBLE_LONG_SERVICE_Z),
    to: p(0, 0, -SHORT_SERVICE),
  },
  {
    name: 'center_far',
    from: p(0, 0, SHORT_SERVICE),
    to: p(0, 0, DOUBLE_LONG_SERVICE_Z),
  },

  {
    name: 'short_service_near',
    from: p(-HALF_WIDTH, 0, -SHORT_SERVICE),
    to: p(HALF_WIDTH, 0, -SHORT_SERVICE),
  },
  {
    name: 'short_service_far',
    from: p(-HALF_WIDTH, 0, SHORT_SERVICE),
    to: p(HALF_WIDTH, 0, SHORT_SERVICE),
  },

  {
    name: 'double_long_service_near',
    from: p(-HALF_WIDTH, 0, -DOUBLE_LONG_SERVICE_Z),
    to: p(HALF_WIDTH, 0, -DOUBLE_LONG_SERVICE_Z),
  },
  {
    name: 'double_long_service_far',
    from: p(-HALF_WIDTH, 0, DOUBLE_LONG_SERVICE_Z),
    to: p(HALF_WIDTH, 0, DOUBLE_LONG_SERVICE_Z),
  },
]

export function projectCourtLines(cameraParams, options = {}) {
  return BADMINTON_COURT_LINES.map((line) => {
    const transformedFrom = transformCourtPoint(line.from)
    const transformedTo = transformCourtPoint(line.to)

    const from = project3DToImage(transformedFrom, cameraParams, options)
    const to = project3DToImage(transformedTo, cameraParams, options)

    if (!from || !to) return null

    return {
      ...line,
      from,
      to,
    }
  }).filter(Boolean)
}
