function mat3Transpose(matrix) {
  return [
    [
      matrix[0][0],
      matrix[1][0],
      matrix[2][0],
    ],
    [
      matrix[0][1],
      matrix[1][1],
      matrix[2][1],
    ],
    [
      matrix[0][2],
      matrix[1][2],
      matrix[2][2],
    ],
  ]
}


function mat3VecMul(
  matrix,
  vector,
) {
  return [
    (
      matrix[0][0] * vector[0]
      + matrix[0][1] * vector[1]
      + matrix[0][2] * vector[2]
    ),
    (
      matrix[1][0] * vector[0]
      + matrix[1][1] * vector[1]
      + matrix[1][2] * vector[2]
    ),
    (
      matrix[2][0] * vector[0]
      + matrix[2][1] * vector[1]
      + matrix[2][2] * vector[2]
    ),
  ]
}


function addVec(
  first,
  second,
) {
  return [
    first[0] + second[0],
    first[1] + second[1],
    first[2] + second[2],
  ]
}


function scaleVec(
  vector,
  scale,
) {
  return [
    vector[0] * scale,
    vector[1] * scale,
    vector[2] * scale,
  ]
}


function rawToScene(
  point,
) {
  return [
    point[0],
    -point[1],
    -point[2],
  ]
}


export function getCameraScenePose(
  cameraParams,
  lookDistance = 4,
) {
  if (!cameraParams?.extrinsic) {
    return {
      position: [
        0,
        3,
        0,
      ],
      target: [
        0,
        0,
        0,
      ],
    }
  }

  const extrinsic = (
    cameraParams.extrinsic
  )

  const rotation = [
    [
      extrinsic[0][0],
      extrinsic[0][1],
      extrinsic[0][2],
    ],
    [
      extrinsic[1][0],
      extrinsic[1][1],
      extrinsic[1][2],
    ],
    [
      extrinsic[2][0],
      extrinsic[2][1],
      extrinsic[2][2],
    ],
  ]

  const translation = [
    extrinsic[0][3],
    extrinsic[1][3],
    extrinsic[2][3],
  ]

  const rotationTranspose = (
    mat3Transpose(
      rotation
    )
  )

  const cameraCenterRaw = (
    scaleVec(
      mat3VecMul(
        rotationTranspose,
        translation,
      ),
      -1,
    )
  )

  const forwardRaw = (
    mat3VecMul(
      rotationTranspose,
      [
        0,
        0,
        1,
      ],
    )
  )

  const targetRaw = (
    addVec(
      cameraCenterRaw,
      scaleVec(
        forwardRaw,
        lookDistance,
      ),
    )
  )

  return {
    position: rawToScene(
      cameraCenterRaw
    ),

    target: rawToScene(
      targetRaw
    ),
  }
}