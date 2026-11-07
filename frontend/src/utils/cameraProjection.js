import * as THREE from 'three'

const DEFAULT_COORDINATE_MODE = 'raw'

const DEFAULT_USE_LENS_DISTORTION = true

const DEFAULT_COURT_WORLD_TRANSFORM = {
  xOffset: 0,
  zOffset: 0,
  rotateDeg: 0,
  xScale: 1,
  zScale: 1,
  yOffset: 0,
}


function toPointArray(point) {
  if (Array.isArray(point)) {
    return point
  }

  return [
    point.x,
    point.y,
    point.z,
  ]
}


function isFinitePoint(point) {
  return point.every(
    Number.isFinite,
  )
}


export function applyProjectionCoordinateTransform(
  point,
  mode = DEFAULT_COORDINATE_MODE,
) {
  const raw = toPointArray(
    point
  )

  if (!isFinitePoint(raw)) {
    return null
  }

  const [
    x,
    y,
    z,
  ] = raw

  switch (mode) {
    case 'scene':
      return [
        x,
        -y,
        -z,
      ]

    case 'flipZ':
      return [
        x,
        y,
        -z,
      ]

    case 'flipY':
      return [
        x,
        -y,
        z,
      ]

    case 'flipX':
      return [
        -x,
        y,
        z,
      ]

    case 'flipXFlipZ':
      return [
        -x,
        y,
        -z,
      ]

    case 'flipXFlipYFlipZ':
      return [
        -x,
        -y,
        -z,
      ]

    case 'raw':
    default:
      return [
        x,
        y,
        z,
      ]
  }
}


export function transformCourtPoint(
  point,
  transform = DEFAULT_COURT_WORLD_TRANSFORM,
) {
  const raw = (
    Array.isArray(point)
      ? {
          x: point[0],
          y: point[1],
          z: point[2],
        }
      : point
  )

  const resolvedTransform = {
    ...DEFAULT_COURT_WORLD_TRANSFORM,
    ...(transform || {}),
  }

  const initialX = (
    raw.x
    * resolvedTransform.xScale
  )

  const initialZ = (
    raw.z
    * resolvedTransform.zScale
  )

  const angle = (
    resolvedTransform.rotateDeg
    * Math.PI
    / 180
  )

  const cosine = Math.cos(
    angle
  )

  const sine = Math.sin(
    angle
  )

  const rotatedX = (
    initialX * cosine
    - initialZ * sine
  )

  const rotatedZ = (
    initialX * sine
    + initialZ * cosine
  )

  return {
    x: (
      rotatedX
      + resolvedTransform.xOffset
    ),

    y: (
      raw.y
      + resolvedTransform.yOffset
    ),

    z: (
      rotatedZ
      + resolvedTransform.zOffset
    ),
  }
}


export function project3DToImage(
  point,
  cameraParams,
  options = {},
) {
  if (
    !point
    || !cameraParams
    || !Array.isArray(
      cameraParams.intrinsic
    )
    || !Array.isArray(
      cameraParams.extrinsic
    )
  ) {
    return null
  }

  const coordinateMode = (
    options.coordinateMode
    ?? cameraParams.coordinateMode
    ?? DEFAULT_COORDINATE_MODE
  )

  const useLensDistortion = (
    options.useLensDistortion
    ?? cameraParams.useLensDistortion
    ?? DEFAULT_USE_LENS_DISTORTION
  )

  const world = (
    applyProjectionCoordinateTransform(
      point,
      coordinateMode,
    )
  )

  if (!world) {
    return null
  }

  const [
    worldX,
    worldY,
    worldZ,
  ] = world

  const extrinsic = (
    cameraParams.extrinsic
  )

  const [
    focalX,
    focalY,
    centerX,
    centerY,
    radial1 = 0,
    radial2 = 0,
    tangential1 = 0,
    tangential2 = 0,
    radial3 = 0,
  ] = cameraParams.intrinsic

  const cameraX = (
    extrinsic[0][0] * worldX
    + extrinsic[0][1] * worldY
    + extrinsic[0][2] * worldZ
    + extrinsic[0][3]
  )

  const cameraY = (
    extrinsic[1][0] * worldX
    + extrinsic[1][1] * worldY
    + extrinsic[1][2] * worldZ
    + extrinsic[1][3]
  )

  const cameraZ = (
    extrinsic[2][0] * worldX
    + extrinsic[2][1] * worldY
    + extrinsic[2][2] * worldZ
    + extrinsic[2][3]
  )

  if (
    !Number.isFinite(cameraZ)
    || cameraZ <= 0.000001
  ) {
    return null
  }

  const normalizedX = (
    cameraX
    / cameraZ
  )

  const normalizedY = (
    cameraY
    / cameraZ
  )

  let projectedX = (
    normalizedX
  )

  let projectedY = (
    normalizedY
  )

  if (useLensDistortion) {
    const radiusSquared = (
      normalizedX * normalizedX
      + normalizedY * normalizedY
    )

    const radiusFourth = (
      radiusSquared
      * radiusSquared
    )

    const radiusSixth = (
      radiusFourth
      * radiusSquared
    )

    const radial = (
      1
      + radial1
        * radiusSquared
      + radial2
        * radiusFourth
      + radial3
        * radiusSixth
    )

    projectedX = (
      normalizedX
        * radial
      + 2
        * tangential1
        * normalizedX
        * normalizedY
      + tangential2
        * (
          radiusSquared
          + 2
            * normalizedX
            * normalizedX
        )
    )

    projectedY = (
      normalizedY
        * radial
      + tangential1
        * (
          radiusSquared
          + 2
            * normalizedY
            * normalizedY
        )
      + 2
        * tangential2
        * normalizedX
        * normalizedY
    )
  }

  const imageX = (
    focalX * projectedX
    + centerX
    + (
      cameraParams.uOffset
      || 0
    )
  )

  const imageY = (
    focalY * projectedY
    + centerY
    + (
      cameraParams.vOffset
      || 0
    )
  )

  if (
    !Number.isFinite(imageX)
    || !Number.isFinite(imageY)
  ) {
    return null
  }

  const imageWidth = (
    cameraParams.imageWidth
    || 1920
  )

  const imageHeight = (
    cameraParams.imageHeight
    || 1200
  )

  return {
    u: imageX,
    v: imageY,
    depth: cameraZ,

    cameraPoint: {
      x: cameraX,
      y: cameraY,
      z: cameraZ,
    },

    insideImage: (
      imageX >= 0
      && imageX <= imageWidth
      && imageY >= 0
      && imageY <= imageHeight
    ),
  }
}


export function projectTrajectoryPoints(
  points,
  cameraParams,
  options = {},
) {
  return (
    points
    || []
  )
    .map(
      point => {
        const projected = (
          project3DToImage(
            point,
            cameraParams,
            options,
          )
        )

        if (!projected) {
          return null
        }

        return {
          ...projected,
          frame: point.frame,
          original: point,
        }
      },
    )
    .filter(Boolean)
}


const HALF_WIDTH = 3.05
const HALF_LENGTH = 6.7
const SINGLE_HALF_WIDTH = 2.59
const SHORT_SERVICE = 1.98

const DOUBLE_LONG_SERVICE_FROM_BACK = (
  0.76
)

const DOUBLE_LONG_SERVICE_Z = (
  HALF_LENGTH
  - DOUBLE_LONG_SERVICE_FROM_BACK
)


function point(
  x,
  y,
  z,
) {
  return {
    x,
    y,
    z,
  }
}


export const BADMINTON_COURT_LINES = [
  {
    name: 'outer_left',
    from: point(
      -HALF_WIDTH,
      0,
      -HALF_LENGTH,
    ),
    to: point(
      -HALF_WIDTH,
      0,
      HALF_LENGTH,
    ),
  },
  {
    name: 'outer_right',
    from: point(
      HALF_WIDTH,
      0,
      -HALF_LENGTH,
    ),
    to: point(
      HALF_WIDTH,
      0,
      HALF_LENGTH,
    ),
  },
  {
    name: 'outer_near',
    from: point(
      -HALF_WIDTH,
      0,
      -HALF_LENGTH,
    ),
    to: point(
      HALF_WIDTH,
      0,
      -HALF_LENGTH,
    ),
  },
  {
    name: 'outer_far',
    from: point(
      -HALF_WIDTH,
      0,
      HALF_LENGTH,
    ),
    to: point(
      HALF_WIDTH,
      0,
      HALF_LENGTH,
    ),
  },
  {
    name: 'single_left',
    from: point(
      -SINGLE_HALF_WIDTH,
      0,
      -HALF_LENGTH,
    ),
    to: point(
      -SINGLE_HALF_WIDTH,
      0,
      HALF_LENGTH,
    ),
  },
  {
    name: 'single_right',
    from: point(
      SINGLE_HALF_WIDTH,
      0,
      -HALF_LENGTH,
    ),
    to: point(
      SINGLE_HALF_WIDTH,
      0,
      HALF_LENGTH,
    ),
  },
  {
    name: 'net',
    from: point(
      -HALF_WIDTH,
      0,
      0,
    ),
    to: point(
      HALF_WIDTH,
      0,
      0,
    ),
  },
  {
    name: 'center_near',
    from: point(
      0,
      0,
      -DOUBLE_LONG_SERVICE_Z,
    ),
    to: point(
      0,
      0,
      -SHORT_SERVICE,
    ),
  },
  {
    name: 'center_far',
    from: point(
      0,
      0,
      SHORT_SERVICE,
    ),
    to: point(
      0,
      0,
      DOUBLE_LONG_SERVICE_Z,
    ),
  },
  {
    name: 'short_service_near',
    from: point(
      -HALF_WIDTH,
      0,
      -SHORT_SERVICE,
    ),
    to: point(
      HALF_WIDTH,
      0,
      -SHORT_SERVICE,
    ),
  },
  {
    name: 'short_service_far',
    from: point(
      -HALF_WIDTH,
      0,
      SHORT_SERVICE,
    ),
    to: point(
      HALF_WIDTH,
      0,
      SHORT_SERVICE,
    ),
  },
  {
    name: 'double_long_service_near',
    from: point(
      -HALF_WIDTH,
      0,
      -DOUBLE_LONG_SERVICE_Z,
    ),
    to: point(
      HALF_WIDTH,
      0,
      -DOUBLE_LONG_SERVICE_Z,
    ),
  },
  {
    name: 'double_long_service_far',
    from: point(
      -HALF_WIDTH,
      0,
      DOUBLE_LONG_SERVICE_Z,
    ),
    to: point(
      HALF_WIDTH,
      0,
      DOUBLE_LONG_SERVICE_Z,
    ),
  },
]


export function projectCourtLines(
  cameraParams,
  options = {},
) {
  const courtTransform = (
    options.courtWorldTransform
    ?? cameraParams?.courtWorldTransform
    ?? DEFAULT_COURT_WORLD_TRANSFORM
  )

  return BADMINTON_COURT_LINES
    .map(
      line => {
        const transformedFrom = (
          transformCourtPoint(
            line.from,
            courtTransform,
          )
        )

        const transformedTo = (
          transformCourtPoint(
            line.to,
            courtTransform,
          )
        )

        const from = (
          project3DToImage(
            transformedFrom,
            cameraParams,
            options,
          )
        )

        const to = (
          project3DToImage(
            transformedTo,
            cameraParams,
            options,
          )
        )

        if (!from || !to) {
          return null
        }

        return {
          ...line,
          from,
          to,
        }
      },
    )
    .filter(Boolean)
}

/**
 * project3DToImage 的反運算：影像上 (u, v) 這個像素對應的視線，
 * 回傳 { origin, direction }（direction 是單位向量），座標和傳給
 * project3DToImage 的點同一套。視線上的點投影回來都落在 (u, v)。
 *
 * 鏡頭畸變用迭代反算，和後端 _undistort_normalized 一樣。迭代不一定
 * 收斂（畸變強的相機在畫面邊緣，多項式會把視野外的點折回畫面內），
 * 所以最後把視線上的點投影回去檢查，差超過 RAY_MAX_REPROJECTION_PX
 * 就回傳 null。座標模式都是正負號翻轉，自己就是自己的反函數。
 */
// imagePointToRay 反算出來的視線投影回去和原像素差超過這個值就不用
const RAY_MAX_REPROJECTION_PX = 1


export function imagePointToRay(u, v, cameraParams, options = {}) {
  if (
    !cameraParams
    || !Array.isArray(cameraParams.intrinsic)
    || !Array.isArray(cameraParams.extrinsic)
    || !Number.isFinite(u)
    || !Number.isFinite(v)
  ) {
    return null
  }

  const coordinateMode = (
    options.coordinateMode
    ?? cameraParams.coordinateMode
    ?? DEFAULT_COORDINATE_MODE
  )

  const useLensDistortion = (
    options.useLensDistortion
    ?? cameraParams.useLensDistortion
    ?? DEFAULT_USE_LENS_DISTORTION
  )

  const [
    focalX,
    focalY,
    centerX,
    centerY,
    radial1 = 0,
    radial2 = 0,
    tangential1 = 0,
    tangential2 = 0,
    radial3 = 0,
  ] = cameraParams.intrinsic

  const distortedX = (u - centerX - (cameraParams.uOffset || 0)) / focalX
  const distortedY = (v - centerY - (cameraParams.vOffset || 0)) / focalY

  let x = distortedX
  let y = distortedY

  if (useLensDistortion) {
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const r2 = x * x + y * y
      const radial = 1 + radial1 * r2 + radial2 * r2 * r2 + radial3 * r2 * r2 * r2

      if (Math.abs(radial) <= 1e-12) return null

      const deltaX = 2 * tangential1 * x * y + tangential2 * (r2 + 2 * x * x)
      const deltaY = tangential1 * (r2 + 2 * y * y) + 2 * tangential2 * x * y

      x = (distortedX - deltaX) / radial
      y = (distortedY - deltaY) / radial
    }
  }

  if (![x, y].every(Number.isFinite)) return null

  // 外參的旋轉部分不一定是正交矩陣，和後端一樣用一般反矩陣
  const extrinsic = cameraParams.extrinsic
  const rotation = new THREE.Matrix3().set(...extrinsic.flatMap(row => row.slice(0, 3)))

  if (Math.abs(rotation.determinant()) < 1e-12) return null

  rotation.invert()

  const translation = new THREE.Vector3(...extrinsic.map(row => row[3]))
  const origin = translation.clone().negate().applyMatrix3(rotation)
  const direction = new THREE.Vector3(x, y, 1).sub(translation).applyMatrix3(rotation).sub(origin)

  if (!(direction.length() > 0)) return null

  direction.normalize()

  const ray = {
    origin: applyProjectionCoordinateTransform(origin.toArray(), coordinateMode),
    direction: applyProjectionCoordinateTransform(direction.toArray(), coordinateMode),
  }

  // 視線上離相機 10 公尺的點投影回去要落在 (u, v)
  const probe = ray.origin.map((value, axis) => value + ray.direction[axis] * 10)
  const back = project3DToImage(probe, cameraParams, options)

  if (!back || Math.hypot(back.u - u, back.v - v) > RAY_MAX_REPROJECTION_PX) return null

  return ray
}
