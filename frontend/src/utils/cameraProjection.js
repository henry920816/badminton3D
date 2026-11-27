const DEFAULT_COORDINATE_MODE = 'raw';
const DEFAULT_USE_LENS_DISTORTION = true;
const DEFAULT_COURT_WORLD_TRANSFORM = {
  xOffset: 0,
  zOffset: 0,
  rotateDeg: 0,
  xScale: 1,
  zScale: 1,
  yOffset: 0
};
function toPointArray(point) {
  if (Array.isArray(point)) {
    return point;
  }
  return [point.x, point.y, point.z];
}
function isFinitePoint(point) {
  return point.every(Number.isFinite);
}
export function applyProjectionCoordinateTransform(point, mode = DEFAULT_COORDINATE_MODE) {
  const raw = toPointArray(point);
  if (!isFinitePoint(raw)) {
    return null;
  }
  const [x, y, z] = raw;
  switch (mode) {
    case 'scene':
      return [x, -y, -z];
    case 'flipZ':
      return [x, y, -z];
    case 'flipY':
      return [x, -y, z];
    case 'flipX':
      return [-x, y, z];
    case 'flipXFlipZ':
      return [-x, y, -z];
    case 'flipXFlipYFlipZ':
      return [-x, -y, -z];
    case 'raw':
    default:
      return [x, y, z];
  }
}
export function transformCourtPoint(point, transform = DEFAULT_COURT_WORLD_TRANSFORM) {
  const raw = Array.isArray(point) ? {
    x: point[0],
    y: point[1],
    z: point[2]
  } : point;
  const resolvedTransform = {
    ...DEFAULT_COURT_WORLD_TRANSFORM,
    ...(transform || {})
  };
  const initialX = raw.x * resolvedTransform.xScale;
  const initialZ = raw.z * resolvedTransform.zScale;
  const angle = resolvedTransform.rotateDeg * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rotatedX = initialX * cosine - initialZ * sine;
  const rotatedZ = initialX * sine + initialZ * cosine;
  return {
    x: rotatedX + resolvedTransform.xOffset,
    y: raw.y + resolvedTransform.yOffset,
    z: rotatedZ + resolvedTransform.zOffset
  };
}
export function project3DToImage(point, cameraParams, options = {}) {
  if (!point || !cameraParams || !Array.isArray(cameraParams.intrinsic) || !Array.isArray(cameraParams.extrinsic)) {
    return null;
  }
  const coordinateMode = options.coordinateMode ?? cameraParams.coordinateMode ?? DEFAULT_COORDINATE_MODE;
  const useLensDistortion = options.useLensDistortion ?? cameraParams.useLensDistortion ?? DEFAULT_USE_LENS_DISTORTION;
  const world = applyProjectionCoordinateTransform(point, coordinateMode);
  if (!world) {
    return null;
  }
  const [worldX, worldY, worldZ] = world;
  const extrinsic = cameraParams.extrinsic;
  const [focalX, focalY, centerX, centerY, radial1 = 0, radial2 = 0, tangential1 = 0, tangential2 = 0, radial3 = 0] = cameraParams.intrinsic;
  const cameraX = extrinsic[0][0] * worldX + extrinsic[0][1] * worldY + extrinsic[0][2] * worldZ + extrinsic[0][3];
  const cameraY = extrinsic[1][0] * worldX + extrinsic[1][1] * worldY + extrinsic[1][2] * worldZ + extrinsic[1][3];
  const cameraZ = extrinsic[2][0] * worldX + extrinsic[2][1] * worldY + extrinsic[2][2] * worldZ + extrinsic[2][3];
  if (!Number.isFinite(cameraZ) || cameraZ <= 0.000001) {
    return null;
  }
  const normalizedX = cameraX / cameraZ;
  const normalizedY = cameraY / cameraZ;
  let projectedX = normalizedX;
  let projectedY = normalizedY;
  if (useLensDistortion) {
    const radiusSquared = normalizedX * normalizedX + normalizedY * normalizedY;
    const radiusFourth = radiusSquared * radiusSquared;
    const radiusSixth = radiusFourth * radiusSquared;
    const radial = 1 + radial1 * radiusSquared + radial2 * radiusFourth + radial3 * radiusSixth;
    projectedX = normalizedX * radial + 2 * tangential1 * normalizedX * normalizedY + tangential2 * (radiusSquared + 2 * normalizedX * normalizedX);
    projectedY = normalizedY * radial + tangential1 * (radiusSquared + 2 * normalizedY * normalizedY) + 2 * tangential2 * normalizedX * normalizedY;
  }
  const imageX = focalX * projectedX + centerX + (cameraParams.uOffset || 0);
  const imageY = focalY * projectedY + centerY + (cameraParams.vOffset || 0);
  if (!Number.isFinite(imageX) || !Number.isFinite(imageY)) {
    return null;
  }
  const imageWidth = cameraParams.imageWidth || 1920;
  const imageHeight = cameraParams.imageHeight || 1200;
  return {
    u: imageX,
    v: imageY,
    depth: cameraZ,
    cameraPoint: {
      x: cameraX,
      y: cameraY,
      z: cameraZ
    },
    insideImage: imageX >= 0 && imageX <= imageWidth && imageY >= 0 && imageY <= imageHeight
  };
}
export function projectTrajectoryPoints(points, cameraParams, options = {}) {
  return (points || []).map(point => {
    const projected = project3DToImage(point, cameraParams, options);
    if (!projected) {
      return null;
    }
    return {
      ...projected,
      frame: point.frame,
      original: point
    };
  }).filter(Boolean);
}
const HALF_WIDTH = 3.05;
const HALF_LENGTH = 6.7;
const SINGLE_HALF_WIDTH = 2.59;
const SHORT_SERVICE = 1.98;
const DOUBLE_LONG_SERVICE_FROM_BACK = 0.76;
const DOUBLE_LONG_SERVICE_Z = HALF_LENGTH - DOUBLE_LONG_SERVICE_FROM_BACK;
function point(x, y, z) {
  return {
    x,
    y,
    z
  };
}
export const BADMINTON_COURT_LINES = [{
  name: 'outer_left',
  from: point(-HALF_WIDTH, 0, -HALF_LENGTH),
  to: point(-HALF_WIDTH, 0, HALF_LENGTH)
}, {
  name: 'outer_right',
  from: point(HALF_WIDTH, 0, -HALF_LENGTH),
  to: point(HALF_WIDTH, 0, HALF_LENGTH)
}, {
  name: 'outer_near',
  from: point(-HALF_WIDTH, 0, -HALF_LENGTH),
  to: point(HALF_WIDTH, 0, -HALF_LENGTH)
}, {
  name: 'outer_far',
  from: point(-HALF_WIDTH, 0, HALF_LENGTH),
  to: point(HALF_WIDTH, 0, HALF_LENGTH)
}, {
  name: 'single_left',
  from: point(-SINGLE_HALF_WIDTH, 0, -HALF_LENGTH),
  to: point(-SINGLE_HALF_WIDTH, 0, HALF_LENGTH)
}, {
  name: 'single_right',
  from: point(SINGLE_HALF_WIDTH, 0, -HALF_LENGTH),
  to: point(SINGLE_HALF_WIDTH, 0, HALF_LENGTH)
}, {
  name: 'net',
  from: point(-HALF_WIDTH, 0, 0),
  to: point(HALF_WIDTH, 0, 0)
}, {
  name: 'center_near',
  from: point(0, 0, -DOUBLE_LONG_SERVICE_Z),
  to: point(0, 0, -SHORT_SERVICE)
}, {
  name: 'center_far',
  from: point(0, 0, SHORT_SERVICE),
  to: point(0, 0, DOUBLE_LONG_SERVICE_Z)
}, {
  name: 'short_service_near',
  from: point(-HALF_WIDTH, 0, -SHORT_SERVICE),
  to: point(HALF_WIDTH, 0, -SHORT_SERVICE)
}, {
  name: 'short_service_far',
  from: point(-HALF_WIDTH, 0, SHORT_SERVICE),
  to: point(HALF_WIDTH, 0, SHORT_SERVICE)
}, {
  name: 'double_long_service_near',
  from: point(-HALF_WIDTH, 0, -DOUBLE_LONG_SERVICE_Z),
  to: point(HALF_WIDTH, 0, -DOUBLE_LONG_SERVICE_Z)
}, {
  name: 'double_long_service_far',
  from: point(-HALF_WIDTH, 0, DOUBLE_LONG_SERVICE_Z),
  to: point(HALF_WIDTH, 0, DOUBLE_LONG_SERVICE_Z)
}];
export function projectCourtLines(cameraParams, options = {}) {
  const courtTransform = options.courtWorldTransform ?? cameraParams?.courtWorldTransform ?? DEFAULT_COURT_WORLD_TRANSFORM;
  return BADMINTON_COURT_LINES.map(line => {
    const transformedFrom = transformCourtPoint(line.from, courtTransform);
    const transformedTo = transformCourtPoint(line.to, courtTransform);
    const from = project3DToImage(transformedFrom, cameraParams, options);
    const to = project3DToImage(transformedTo, cameraParams, options);
    if (!from || !to) {
      return null;
    }
    return {
      ...line,
      from,
      to
    };
  }).filter(Boolean);
}

// 將影像點反算成世界座標的視線。畸變迭代不收斂的點不使用。
export function imagePointToRay(u, v, params, options = {}) {
  if (!params || !Array.isArray(params.intrinsic) || !Array.isArray(params.extrinsic) || !Number.isFinite(u) || !Number.isFinite(v)) return null;
  const mode = options.coordinateMode ?? params.coordinateMode ?? DEFAULT_COORDINATE_MODE;
  const useDistortion = options.useLensDistortion ?? params.useLensDistortion ?? DEFAULT_USE_LENS_DISTORTION;
  const [fx, fy, cx, cy, k1 = 0, k2 = 0, p1 = 0, p2 = 0, k3 = 0] = params.intrinsic;
  if (!(fx > 0) || !(fy > 0)) return null;
  const dx = (u - cx - (params.uOffset || 0)) / fx;
  const dy = (v - cy - (params.vOffset || 0)) / fy;
  let x = dx, y = dy;
  if (useDistortion) {
    for (let i = 0; i < 12; i++) {
      const r2 = x*x+y*y;
      const radial = 1+k1*r2+k2*r2*r2+k3*r2*r2*r2;
      if (!Number.isFinite(radial) || Math.abs(radial) <= 1e-12) return null;
      const tx = 2*p1*x*y+p2*(r2+2*x*x);
      const ty = p1*(r2+2*y*y)+2*p2*x*y;
      x = (dx-tx)/radial; y = (dy-ty)/radial;
    }
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const r = params.extrinsic.map(row => row.slice(0,3));
  const t = params.extrinsic.map(row => Number(row[3]));
  if (r.length !== 3 || r.some(row => row.length !== 3 || row.some(n => !Number.isFinite(n))) || t.some(n => !Number.isFinite(n))) return null;
  // 高斯消去，不能假設相機旋轉矩陣的數值剛好正交。
  const inv = [];
  for (let axis = 0; axis < 3; axis++) {
    const mat = r.map((row, i) => [...row, i === axis ? 1 : 0]);
    for (let j = 0; j < 3; j++) {
      let pivot = j;
      for (let k = j+1; k < 3; k++) if (Math.abs(mat[k][j]) > Math.abs(mat[pivot][j])) pivot = k;
      if (Math.abs(mat[pivot][j]) < 1e-12) return null;
      [mat[j], mat[pivot]] = [mat[pivot], mat[j]];
      const fac = mat[j][j];
      for (let k = j; k < 4; k++) mat[j][k] /= fac;
      for (let i = 0; i < 3; i++) if (i !== j) {
        const scalar = mat[i][j];
        for (let k = j; k < 4; k++) mat[i][k] -= scalar * mat[j][k];
      }
    }
    inv.push(mat.map(row => row[3]));
  }
  const inverse = [[inv[0][0],inv[1][0],inv[2][0]], [inv[0][1],inv[1][1],inv[2][1]], [inv[0][2],inv[1][2],inv[2][2]]];
  const multiply = point => inverse.map(row => row.reduce((sum, value, j) => sum+value*point[j],0));
  const originCamera = multiply(t.map(n => -n));
  const directionCamera = multiply([x,y,1]);
  const length = Math.hypot(...directionCamera);
  if (!(length > 1e-12)) return null;
  const origin = applyProjectionCoordinateTransform(originCamera, mode);
  const direction = applyProjectionCoordinateTransform(directionCamera.map(n=>n/length),mode);
  const probe = origin.map((n,axis) => n+direction[axis]*10);
  const back = project3DToImage(probe,params,options);
  if (!back || Math.hypot(back.u-u,back.v-v) > 1) return null;
  return {origin,direction};
}
