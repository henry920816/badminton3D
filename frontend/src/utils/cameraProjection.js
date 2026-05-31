// frontend/src/utils/cameraProjection.js
// Camera parameters converted from cameras/Cam_0~9_intrinsic.npy and extrinsic.npy
// intrinsic format: [fx, fy, cx, cy, k1, k2, p1, p2, k3]
// extrinsic format: 3x4 [R | t]

export const PROJECTION_COORDINATE_MODE = 'raw'
// 可改成以下模式測試座標系：
// raw:              [ x,  y,  z]
// scene:            [ x, -y, -z]
// flipZ:            [ x,  y, -z]
// flipY:            [ x, -y,  z]
// flipX:            [-x,  y,  z]
// flipXFlipZ:       [-x,  y, -z]
// flipXFlipYFlipZ:  [-x, -y, -z]

export const USE_LENS_DISTORTION = true

export const COURT_WORLD_TRANSFORM = {
  xOffset: 0,
  zOffset: 0,
  rotateDeg: 0,
  xScale: 1,
  zScale: 1,
  yOffset: 0,
}

export const CAMERA_PROJECTION_PARAMS = {
  cam0: {
    id: 'cam0',
    label: 'Cam 0',
    imageWidth: 1920,
    imageHeight: 1200,
    uOffset: 0,
    vOffset: 0,
    intrinsic: [
      3030.6123046875,
      3100.0,
      960.0,
      600.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
    ],
    extrinsic: [
      [
        0.23938081517000895,
        -0.01956618071470448,
        -0.9707285871451307,
        3.5709784717487367,
      ],
      [
        -0.400402013615793,
        0.908832107727343,
        -0.11705736822726523,
        0.14232726603168938,
      ],
      [
        0.8845196735070172,
        0.41670296919522276,
        0.2097226326435106,
        12.052832219155574,
      ],
    ],
  },

  cam1: {
    id: 'cam1',
    label: 'Cam 1',
    imageWidth: 1920,
    imageHeight: 1200,
    uOffset: 0,
    vOffset: 0,
    intrinsic: [
      2967.346923828125,
      2993.87744140625,
      960.0,
      600.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
    ],
    extrinsic: [
      [
        -0.22911298730261515,
        -0.014063915449148368,
        0.9732982304163049,
        3.6013745271088324,
      ],
      [
        0.394390180606761,
        0.912805731039203,
        0.10602868867882972,
        0.19956812301418703,
      ],
      [
        -0.8899233812470813,
        0.40815181448111304,
        -0.20358897771131146,
        12.029650863664168,
      ],
    ],
  },

  cam2: {
    id: 'cam2',
    label: 'Cam 2',
    imageWidth: 1920,
    imageHeight: 1200,
    uOffset: 0,
    vOffset: 0,
    intrinsic: [
      2967.346923828125,
      2993.87744140625,
      960.0,
      600.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
    ],
    extrinsic: [
      [
        0.5608520318991802,
        0.027669682093938316,
        0.8274535558007962,
        -2.7730663121386585,
      ],
      [
        0.26169697239572987,
        0.9422739541657745,
        -0.20888870227876014,
        0.8763738495271635,
      ],
      [
        -0.7854678178980151,
        0.33369774346497505,
        0.5212351897684137,
        12.91591353934511,
      ],
    ],
  },

  cam3: {
    id: 'cam3',
    label: 'Cam 3',
    imageWidth: 1920,
    imageHeight: 1200,
    uOffset: 0,
    vOffset: 0,
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
      [
        0.9996144439696724,
        -0.024843204223311856,
        0.012400750425746414,
        -0.005447549668191634,
      ],
      [
        0.027107878893608578,
        0.7764985975696538,
        -0.6295356152548086,
        -2.05131512555681,
      ],
      [
        0.006010516541220109,
        0.6296290520427721,
        0.7768726604242345,
        8.739573357704984,
      ],
    ],
  },

  cam4: {
    id: 'cam4',
    label: 'Cam 4',
    imageWidth: 1920,
    imageHeight: 1200,
    uOffset: 0,
    vOffset: 0,
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
      [
        -0.9971281289035682,
        -0.0033463910478619963,
        0.0756590788750692,
        -0.5035193823337338,
      ],
      [
        0.05446002571721953,
        0.6625389400275993,
        0.7470450177505936,
        -3.0548143187469345,
      ],
      [
        -0.05262699068110338,
        0.7490199961376598,
        -0.6604539690529471,
        7.899915583601815,
      ],
    ],
  },

  cam5: {
    id: 'cam5',
    label: 'Cam 5',
    imageWidth: 1920,
    imageHeight: 1200,
    uOffset: 0,
    vOffset: 0,
    intrinsic: [
      2967.346923828125,
      3046.938720703125,
      960.0,
      600.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
    ],
    extrinsic: [
      [
        -0.5433920864143059,
        -0.02047571026316722,
        0.8392292807758357,
        2.7540632398630134,
      ],
      [
        0.27495781831661237,
        0.9402172547340879,
        0.20097191855297783,
        0.7895946909908853,
      ],
      [
        -0.7931728932388427,
        0.33995920224273213,
        -0.5052766591102432,
        12.791384898420398,
      ],
    ],
  },

  cam6: {
    id: 'cam6',
    label: 'Cam 6',
    imageWidth: 1920,
    imageHeight: 1200,
    uOffset: 0,
    vOffset: 0,
    intrinsic: [
      2967.346923828125,
      3002.040771484375,
      960.0,
      600.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
    ],
    extrinsic: [
      [
        -0.22420698132062553,
        -0.0220378756373803,
        -0.9742923388616396,
        -3.537742506311193,
      ],
      [
        -0.4058926903336976,
        0.9110167343685645,
        0.07279858263805095,
        0.08490949737485178,
      ],
      [
        0.885992298759287,
        0.411780089049759,
        -0.21320132457704577,
        12.012512334117023,
      ],
    ],
  },

  cam7: {
    id: 'cam7',
    label: 'Cam 7',
    imageWidth: 1920,
    imageHeight: 1200,
    uOffset: 0,
    vOffset: 0,
    intrinsic: [
      2967.346923828125,
      2940.81640625,
      960.0,
      600.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
    ],
    extrinsic: [
      [
        0.5544326023035928,
        -0.02552503561893804,
        -0.8318371006750769,
        2.7788492071705253,
      ],
      [
        -0.28465978181031215,
        0.9334250092100055,
        -0.21837252757846337,
        0.7495445687276427,
      ],
      [
        0.7820315199034957,
        0.3578634163168306,
        0.5102553058415711,
        12.65807632864614,
      ],
    ],
  },

  cam8: {
    id: 'cam8',
    label: 'Cam 8',
    imageWidth: 1920,
    imageHeight: 1200,
    uOffset: 0,
    vOffset: 0,
    intrinsic: [
      2967.346923828125,
      3046.938720703125,
      960.0,
      600.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
    ],
    extrinsic: [
      [
        -0.557499563516353,
        0.04533696147163517,
        -0.8289383551287728,
        -2.8835607264751495,
      ],
      [
        -0.26875246605580416,
        0.9348817354597534,
        0.23187982381544978,
        0.7921645649135736,
      ],
      [
        0.7854720546703109,
        0.3520521277144617,
        -0.509011739259244,
        12.77883640787911,
      ],
    ],
  },

  cam9: {
    id: 'cam9',
    label: 'Cam 9',
    imageWidth: 1920,
    imageHeight: 1200,
    uOffset: 0,
    vOffset: 0,
    intrinsic: [
      2967.346923828125,
      3046.938720703125,
      960.0,
      600.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
    ],
    extrinsic: [
      [
        0.24757496621698294,
        0.029656539933825943,
        0.9684147488250132,
        -3.5616526102047623,
      ],
      [
        0.39343524042718053,
        0.9103333859987981,
        -0.12845947970457527,
        0.16019856273010558,
      ],
      [
        -0.8853899410387869,
        0.4128118408853081,
        0.213707829365741,
        11.993785920805761,
      ],
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

    xProjected = x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x)
    yProjected = y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y
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
  { name: 'outer_left', from: p(-HALF_WIDTH, 0, -HALF_LENGTH), to: p(-HALF_WIDTH, 0, HALF_LENGTH) },
  { name: 'outer_right', from: p(HALF_WIDTH, 0, -HALF_LENGTH), to: p(HALF_WIDTH, 0, HALF_LENGTH) },
  { name: 'outer_near', from: p(-HALF_WIDTH, 0, -HALF_LENGTH), to: p(HALF_WIDTH, 0, -HALF_LENGTH) },
  { name: 'outer_far', from: p(-HALF_WIDTH, 0, HALF_LENGTH), to: p(HALF_WIDTH, 0, HALF_LENGTH) },

  { name: 'single_left', from: p(-SINGLE_HALF_WIDTH, 0, -HALF_LENGTH), to: p(-SINGLE_HALF_WIDTH, 0, HALF_LENGTH) },
  { name: 'single_right', from: p(SINGLE_HALF_WIDTH, 0, -HALF_LENGTH), to: p(SINGLE_HALF_WIDTH, 0, HALF_LENGTH) },

  { name: 'net', from: p(-HALF_WIDTH, 0, 0), to: p(HALF_WIDTH, 0, 0) },

  { name: 'center_near', from: p(0, 0, -DOUBLE_LONG_SERVICE_Z), to: p(0, 0, -SHORT_SERVICE) },
  { name: 'center_far', from: p(0, 0, SHORT_SERVICE), to: p(0, 0, DOUBLE_LONG_SERVICE_Z) },

  { name: 'short_service_near', from: p(-HALF_WIDTH, 0, -SHORT_SERVICE), to: p(HALF_WIDTH, 0, -SHORT_SERVICE) },
  { name: 'short_service_far', from: p(-HALF_WIDTH, 0, SHORT_SERVICE), to: p(HALF_WIDTH, 0, SHORT_SERVICE) },

  { name: 'double_long_service_near', from: p(-HALF_WIDTH, 0, -DOUBLE_LONG_SERVICE_Z), to: p(HALF_WIDTH, 0, -DOUBLE_LONG_SERVICE_Z) },
  { name: 'double_long_service_far', from: p(-HALF_WIDTH, 0, DOUBLE_LONG_SERVICE_Z), to: p(HALF_WIDTH, 0, DOUBLE_LONG_SERVICE_Z) },
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
