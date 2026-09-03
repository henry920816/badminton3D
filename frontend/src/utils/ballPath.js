import * as THREE from 'three'

// 取樣點之間超過這個 frame 數就視為偵測中斷，不硬接起來
const MAX_FRAME_GAP = 12

// 擊球點前後各取幾個點做等加速度擬合
const FIT_WINDOW = 5

// 速度方向轉超過這個角度就判定為擊球。
//
// 這不是調出來的經驗值，是物理上限：自由飛行時空氣阻力沿著速度方向作用，
// 完全不會讓速度轉向；只有重力的垂直分量會。50fps 下相隔兩格（40ms）
// 重力最多帶來 0.39 m/s 的速度變化，所以除非球慢到幾乎靜止，
// 方向根本不可能轉超過 90 度。要轉過去一定得有外力，也就是被打到。
const MIN_HIT_TURN_DEGREES = 90

// 轉角要有意義，前後兩段的速度都必須夠快。球慢下來時每格位移變短，
// 同樣的偵測雜訊就會製造出很大的假轉角：2 m/s 時一格只走 4cm，
// 2cm 的雜訊就足以歪掉幾十度。
const MIN_HIT_TURN_SPEED = 2

// 估計轉角時，取樣點之間相隔超過這麼多格就不採信（中間可能漏偵測）
const MAX_TURN_SAMPLE_GAP = 3

// 同一次擊球可能在相鄰幾個位置都超過門檻，只取轉角最大的那個
const HIT_SUPPRESSION_RADIUS = 2

// 擬合一條 p(t) = P + V·t + ½A·t² 至少需要 3 個點
const MIN_FIT_POINTS = 3

// 前後兩段外插在接觸時刻的落差超過這個距離(公尺)就不信任
const MAX_CONTACT_RESIDUAL = 0.05

// 反推出的出球速度超過這個值(公尺/秒)代表資料有問題
const MAX_CONTACT_SPEED = 120

// 出球速度低於這個值(公尺/秒)時，方向只是雜訊，不足以拿來擺球拍
const MIN_CONTACT_SPEED = 1

// 接觸點離最近取樣點的距離不得超過當地每幀位移的這個倍數
const MAX_CONTACT_STRAY_RATIO = 2


export function toThreeVector(point) {
  return new THREE.Vector3(
    point.x,
    -point.y,
    -point.z,
  )
}



// 解 3x3 線性系統，右手邊是三個 Vector3（等同一次解 x/y/z 三軸）
function solveThreeByThree(matrix, rhs) {
  const a = matrix.map(row => [...row])
  const b = rhs.map(vector => vector.clone())

  for (let col = 0; col < 3; col += 1) {
    let pivot = col

    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) {
        pivot = row
      }
    }

    if (Math.abs(a[pivot][col]) < 1e-12) {
      return null
    }

    if (pivot !== col) {
      const swappedRow = a[pivot]
      a[pivot] = a[col]
      a[col] = swappedRow

      const swappedVector = b[pivot]
      b[pivot] = b[col]
      b[col] = swappedVector
    }

    for (let row = col + 1; row < 3; row += 1) {
      const factor = a[row][col] / a[col][col]
      if (!factor) continue

      for (let k = col; k < 3; k += 1) {
        a[row][k] -= factor * a[col][k]
      }

      b[row].addScaledVector(b[col], -factor)
    }
  }

  const solution = [null, null, null]

  for (let row = 2; row >= 0; row -= 1) {
    const accumulator = b[row].clone()

    for (let k = row + 1; k < 3; k += 1) {
      accumulator.addScaledVector(solution[k], -a[row][k])
    }

    solution[row] = accumulator.divideScalar(a[row][row])
  }

  return solution
}


// 用最小平方法擬合等加速度運動 p(t) = P + V·t + ½A·t²
// 羽球在自由飛行時只受重力與空氣阻力，短窗內用二次式逼近已足夠
function fitMotion(entries, fps, referenceFrame) {
  if (entries.length < MIN_FIT_POINTS) return null

  let s0 = 0
  let s1 = 0
  let s2 = 0
  let s3 = 0
  let s4 = 0

  const rhs = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]

  for (const entry of entries) {
    const t = (entry.frame - referenceFrame) / fps
    const t2 = t * t

    s0 += 1
    s1 += t
    s2 += t2
    s3 += t2 * t
    s4 += t2 * t2

    rhs[0].add(entry.vector)
    rhs[1].addScaledVector(entry.vector, t)
    rhs[2].addScaledVector(entry.vector, 0.5 * t2)
  }

  const normal = [
    [s0, s1, 0.5 * s2],
    [s1, s2, 0.5 * s3],
    [0.5 * s2, 0.5 * s3, 0.25 * s4],
  ]

  const solution = solveThreeByThree(normal, rhs)
  if (!solution) return null

  const [position, velocity, acceleration] = solution

  if (
    !Number.isFinite(position.lengthSq())
    || !Number.isFinite(velocity.lengthSq())
    || !Number.isFinite(acceleration.lengthSq())
  ) {
    return null
  }

  return {
    positionAt(frame) {
      const t = (frame - referenceFrame) / fps

      return position
        .clone()
        .addScaledVector(velocity, t)
        .addScaledVector(acceleration, 0.5 * t * t)
    },

    velocityAt(frame) {
      const t = (frame - referenceFrame) / fps

      return velocity
        .clone()
        .addScaledVector(acceleration, t)
    },
  }
}


function velocityBetween(from, to, fps) {
  const frames = to.frame - from.frame

  if (frames <= 0) return null
  if (frames > MAX_TURN_SAMPLE_GAP) return null

  return to.vector
    .clone()
    .sub(from.vector)
    .multiplyScalar(fps / frames)
}


// 從軌跡本身找擊球，不看 hits 資料表 —— 標註的 hit frame 不一定準，
// 但速度方向的突變是球自己留下的證據。
//
// 比較的是接觸「外側」的兩段位移：跨越接觸的那一段是
// 「擊球前 + 擊球後」的混合，拿它去比會把訊號稀釋掉。
//
//   index-1 ──► index    (跨越接觸)    index+1 ──► index+2
//   └── before ──┘                     └─── after ───┘
//
function findHitStarts(entries, fps) {
  const minimumTurn = (MIN_HIT_TURN_DEGREES * Math.PI) / 180
  const candidates = []

  for (let index = 1; index + 2 < entries.length; index += 1) {
    const before = velocityBetween(entries[index - 1], entries[index], fps)
    const after = velocityBetween(entries[index + 1], entries[index + 2], fps)

    if (!before || !after) continue

    const beforeSpeed = before.length()
    const afterSpeed = after.length()

    if (beforeSpeed < MIN_HIT_TURN_SPEED) continue
    if (afterSpeed < MIN_HIT_TURN_SPEED) continue

    const cosine = before.dot(after) / (beforeSpeed * afterSpeed)
    const turn = Math.acos(Math.min(1, Math.max(-1, cosine)))

    if (turn < minimumTurn) continue

    // 接觸落在 index 與 index+1 之間，所以新的一段從 index+1 開始
    candidates.push({ start: index + 1, turn })
  }

  // 同一次擊球常在相鄰位置連續超標，只留轉角最大的，
  // 否則會切出只有一兩個點的碎段
  candidates.sort((first, second) => second.turn - first.turn)

  const starts = []

  for (const candidate of candidates) {
    const tooClose = starts.some(
      start => Math.abs(start - candidate.start) <= HIT_SUPPRESSION_RADIUS,
    )

    if (!tooClose) starts.push(candidate.start)
  }

  return new Set(starts)
}


// 切段：擊球會讓速度在 1ms 內反轉，那是真正的物理不連續點，
// 任何跨過它的平滑都是錯的。偵測中斷同樣不能硬接起來。
function splitIntoFlights(entries, hitStarts) {
  const flights = []
  const hitBoundaries = new Set()
  let current = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const previous = entries[index - 1]

    const brokenByGap = Boolean(
      previous
      && entry.frame - previous.frame > MAX_FRAME_GAP,
    )

    const brokenByHit = hitStarts.has(index)

    if (current.length && (brokenByGap || brokenByHit)) {
      // 資料中斷處沒有可信的入射段，就算同時判定為擊球也不反推接觸點
      if (brokenByHit && !brokenByGap) hitBoundaries.add(flights.length)

      flights.push(current)
      current = []
    }

    current.push(entry)
  }

  if (current.length) {
    flights.push(current)
  }

  return { flights, hitBoundaries }
}


// 50fps 下擊球接觸只有約 1ms，幾乎不可能剛好被取樣到。
// 把入射段往前外插、出射段往回外插，兩者最吻合的時刻就是真正的接觸點。
function reconstructContact(incoming, outgoing, fps) {
  // 切點就落在兩個取樣點之間，所以兩段各自都是乾淨的取樣點，
  // 不需要再排除任何一格
  const before = incoming.slice(-FIT_WINDOW)
  const after = outgoing.slice(0, FIT_WINDOW)

  if (before.length < MIN_FIT_POINTS) return null
  if (after.length < MIN_FIT_POINTS) return null

  const lastBefore = before[before.length - 1]
  const firstAfter = after[0]

  // 擬合的時間原點取交界中點，讓兩段的外插距離對稱
  const referenceFrame = (lastBefore.frame + firstAfter.frame) / 2

  const motionIn = fitMotion(before, fps, referenceFrame)
  const motionOut = fitMotion(after, fps, referenceFrame)

  if (!motionIn || !motionOut) return null

  let bestFrame = null
  let bestResidual = Infinity

  const steps = 240

  // 接觸必然發生在最後一個入射取樣點與第一個出射取樣點「之間」，
  // 只在這個區間裡找，時刻本身就不可能跑到離譜的位置
  for (let step = 0; step <= steps; step += 1) {
    const frame = (
      lastBefore.frame
      + ((firstAfter.frame - lastBefore.frame) * step) / steps
    )

    const residual = motionIn
      .positionAt(frame)
      .distanceTo(motionOut.positionAt(frame))

    if (residual < bestResidual) {
      bestResidual = residual
      bestFrame = frame
    }
  }

  // 位置沒通過檢驗時仍然回報一個方向：出球方向來自出射段的擬合，
  // 和「接觸點座標準不準」是兩件事，不必一起放棄
  const untrusted = {
    frame: referenceFrame,
    position: motionOut.positionAt(referenceFrame),
    velocity: motionOut.velocityAt(referenceFrame),
  }

  if (bestFrame == null) return untrusted

  // 以下任一項不過關就退回粗略外插的位置，寧可用近似值也不要用一個錯得離譜的座標
  if (bestResidual > MAX_CONTACT_RESIDUAL) return untrusted

  const outgoingSpeed = motionOut.velocityAt(bestFrame).length()

  if (!Number.isFinite(outgoingSpeed)) return untrusted
  if (outgoingSpeed > MAX_CONTACT_SPEED) return untrusted

  const position = motionIn
    .positionAt(bestFrame)
    .add(motionOut.positionAt(bestFrame))
    .multiplyScalar(0.5)

  const localSpan = Math.max(
    lastBefore.vector.distanceTo(firstAfter.vector),
    0.05,
  )

  const strayDistance = Math.min(
    position.distanceTo(lastBefore.vector),
    position.distanceTo(firstAfter.vector),
  )

  if (strayDistance > MAX_CONTACT_STRAY_RATIO * localSpan) return untrusted

  return {
    frame: bestFrame,
    position,
    velocity: motionOut.velocityAt(bestFrame),
  }
}


/**
 * 每次擊球的接觸時刻、接觸位置，以及球被打出去的方向（單位向量）。
 *
 * 先從速度方向的突變找出擊球，把軌跡切成一段段自由飛行，
 * 再由相鄰兩段的等加速度擬合反推交會處。
 *
 * 方向取自出射段的擬合在接觸時刻的速度，
 * 而不是「下一個取樣點減這個取樣點」——後者已經被重力與阻力汙染，
 * 而且 50fps 下第一個取樣點離接觸已經過了 20ms。
 */
export function buildBallContacts(points, fps) {
  if (!points || points.length < 2) return []
  if (!fps) return []

  const entries = points.map(point => ({
    frame: point.frame,
    vector: toThreeVector(point),
  }))

  const hitStarts = findHitStarts(entries, fps)
  const { flights, hitBoundaries } = splitIntoFlights(entries, hitStarts)
  const contacts = []

  for (let index = 0; index < flights.length - 1; index += 1) {
    // 因偵測中斷而切開的段落沒有擊球，沒有接觸點可反推
    if (!hitBoundaries.has(index)) continue

    const contact = reconstructContact(
      flights[index],
      flights[index + 1],
      fps,
    )

    if (!contact) continue

    const speed = contact.velocity.length()

    if (
      Number.isFinite(speed)
      && speed >= MIN_CONTACT_SPEED
      && speed <= MAX_CONTACT_SPEED
    ) {
      contacts.push({
        frame: contact.frame,
        position: contact.position.clone(),
        direction: contact.velocity.clone().divideScalar(speed),
        speed,
      })
    }
  }

  return contacts
}
