import * as THREE from 'three'

// 取樣點之間超過這個 frame 數就視為偵測中斷，不硬接起來
const MAX_FRAME_GAP = 12

// 擬合用幾個點。窗太長會跨過阻力變化太大的區間，太短則撐不住雜訊。
const FIT_WINDOW = 5

// 擬合的階數。羽球的阻力正比於速度平方，殺球在 100ms 內速度可以掉三成，
// 減速度跟著從 340 掉到 130 m/s²，等加速度（二次式）撐不住這種變化，
// 回推一格就會差好幾公分。多一個三次項把減速度的變化也吃進來。
const FIT_DEGREE = 3

// 擬合一條 FIT_DEGREE 階曲線至少需要的點數
const MIN_FIT_POINTS = FIT_DEGREE + 1

// 用前幾格推下一格，實際位置差超過這個距離(公尺)就代表飛行被打斷了。
//
// 這個門檻不敏感，因為兩種情況差了近兩個數量級：實測整場比賽，
// 自由飛行時的一步預測誤差中位數只有 0.6 公分（p90 也才 10 公分），
// 而擊球那一格差到 45 公分以上 —— 球被打到之後速度整個換掉，
// 一格 20ms 就走到完全不同的地方。
const BREAK_DISTANCE = 0.12

// 推不準之後，再往後推一格如果球「回到原本那條弧上」，那凸出去的那一點
// 就是偵測錯的單點，把它丟掉：不放進擬合，畫線時也跳過它，改走推算出來
// 的擊球位置。
//
// 這個值是使用者指定的 20 公分。要注意它抓得很寬：實測整場比賽，真正
// 回到弧上的話那一格的誤差應該長得像自由飛行（往前推兩格的誤差中位數
// 0.6 公分、p90 才 2.4 公分），而被這個門檻抓到的 49 個點誤差全部擠在
// 12~19 公分，並不是真的回到弧上 —— 它們是擊球後的第一個取樣點，
// 出射的球很快，新弧剛好經過舊弧往前推兩格的位置附近。丟掉它們會讓
// 切點晚兩格：附近有這種點的擊球，切點對準率只有 4%，其餘是 88%，
// 整體從 89% 掉到 77%。
//
// 收到 3 公分可以避開這件事，但也不能乾脆整個拿掉：真正的單點偵測錯誤
// 會讓出射窗的第一個點就是壞點，擬合被它拉歪，速度差大到足以通過 isHit
// 的物理確認，於是多冒出一個假的擊球位置（實測偏離 30~75 公分的錯點
// 就會這樣）。
const RESUME_DISTANCE = 0.2

// 確認一個切點真的是擊球，而不是快速飛行時擬合跟不上造成的誤切。
//
// 入射與出射的速度都是由各自的擬合在「同一個時刻」取值，所以自由飛行
// 的話兩者應該幾乎一樣：阻力沿著速度方向作用，完全不讓速度轉向，只有
// 重力的垂直分量會，50fps 下一格最多帶來 0.2 m/s 的速度變化，在 5 m/s
// 時也才轉 2 度。所以任何明顯的轉向或速度變快都證明有外力介入。
//
// 門檻放寬到 30 度是留給雜訊的餘裕，不是物理上限。實測整場比賽，真正的
// 擊球轉角中位數 118 度、出射/入射速度比中位數 4.4，離門檻遠得很。
const MIN_HIT_TURN_DEGREES = 30

// 自由飛行時速度只會被阻力拉低，變快就一定是被打到
const MIN_HIT_SPEEDUP = 1.2

// 反推出的出球速度超過這個值(公尺/秒)代表資料有問題
const MAX_CONTACT_SPEED = 120

// 出球速度低於這個值(公尺/秒)時，方向只是雜訊，不足以拿來擺球拍
const MIN_CONTACT_SPEED = 1


export function toThreeVector(point) {
  return new THREE.Vector3(
    point.x,
    -point.y,
    -point.z,
  )
}


// 解 n×n 線性系統，右手邊是 n 個 Vector3（等同一次解 x/y/z 三軸）
function solveLinearSystem(matrix, rhs) {
  const size = matrix.length
  const a = matrix.map(row => [...row])
  const b = rhs.map(vector => vector.clone())

  for (let col = 0; col < size; col += 1) {
    let pivot = col

    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    }

    if (Math.abs(a[pivot][col]) < 1e-14) return null

    if (pivot !== col) {
      const swappedRow = a[pivot]
      a[pivot] = a[col]
      a[col] = swappedRow

      const swappedVector = b[pivot]
      b[pivot] = b[col]
      b[col] = swappedVector
    }

    for (let row = col + 1; row < size; row += 1) {
      const factor = a[row][col] / a[col][col]
      if (!factor) continue

      for (let k = col; k < size; k += 1) a[row][k] -= factor * a[col][k]

      b[row].addScaledVector(b[col], -factor)
    }
  }

  const solution = new Array(size).fill(null)

  for (let row = size - 1; row >= 0; row -= 1) {
    const accumulator = b[row].clone()

    for (let k = row + 1; k < size; k += 1) {
      accumulator.addScaledVector(solution[k], -a[row][k])
    }

    solution[row] = accumulator.divideScalar(a[row][row])
  }

  return solution
}


// 用最小平方法把一小段自由飛行擬合成時間的多項式。
// 係數是每軸各自解的，正規方程一次解三軸。
function fitMotion(entries, fps, referenceFrame) {
  const size = FIT_DEGREE + 1

  if (entries.length < size) return null

  const normal = Array.from({ length: size }, () => new Array(size).fill(0))
  const rhs = Array.from({ length: size }, () => new THREE.Vector3())

  for (const entry of entries) {
    const t = (entry.frame - referenceFrame) / fps
    const powers = [1]

    for (let k = 1; k < size; k += 1) powers.push(powers[k - 1] * t)

    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        normal[row][col] += powers[row] * powers[col]
      }

      rhs[row].addScaledVector(entry.vector, powers[row])
    }
  }

  const coefficients = solveLinearSystem(normal, rhs)
  if (!coefficients) return null

  if (!coefficients.every(v => Number.isFinite(v.lengthSq()))) return null

  return {
    positionAt(frame) {
      const t = (frame - referenceFrame) / fps
      const out = new THREE.Vector3()
      let power = 1

      for (let k = 0; k < size; k += 1) {
        out.addScaledVector(coefficients[k], power)
        power *= t
      }

      return out
    },

    velocityAt(frame) {
      const t = (frame - referenceFrame) / fps
      const out = new THREE.Vector3()
      let power = 1

      for (let k = 1; k < size; k += 1) {
        out.addScaledVector(coefficients[k], k * power)
        power *= t
      }

      return out
    },
  }
}


/**
 * 把一段軌跡切成一次次的自由飛行，方法是照著球正在飛的方向往前推算，
 * 看下一個取樣點還在不在那條飛行上。
 *
 * 不用 hits 資料表的 hit frame，那個標註不一定準；也不是找轉角最大的
 * 地方。實測發現「挑轉角最大」會被擊球後前一兩格的雜訊騙走 —— 擊球
 * 前後各有一個取樣點都會量到很大的轉角，挑錯的那個會把擊球後的點留在
 * 入射段裡，之後的擬合就全歪了。整場比賽只有 22% 的切點落在正確的那
 * 一格，改成往前推算之後是 78%。
 *
 * 推不準有兩種情況：
 *
 *   1. 那一點是偵測錯的 —— 球突然凸出去一格，下一格又回到原本那條弧上
 *      （見 RESUME_DISTANCE 的說明，那個門檻的鬆緊很有影響）。丟掉那
 *      一點，飛行繼續。
 *   2. 球真的被打出去了 —— 之後的點延續的是一條全新的弧，回不去了。
 *      擊球就落在最後一個推得準的點與第一個推不準的點「之間」。
 */
function walkFlights(entries, fps) {
  const flights = []
  const outliers = []
  const breaks = []

  let current = [0]

  for (let index = 1; index < entries.length; index += 1) {
    const lastIndex = current[current.length - 1]
    const last = entries[lastIndex]
    const entry = entries[index]

    // 偵測中斷太久就不硬接，中間發生什麼事無從得知
    if (entry.frame - last.frame > MAX_FRAME_GAP) {
      flights.push(current)
      breaks.push({ kind: 'gap' })
      current = [index]
      continue
    }

    // 還沒湊滿一次擬合，先收著
    if (current.length < MIN_FIT_POINTS) {
      current.push(index)
      continue
    }

    const window = current.slice(-FIT_WINDOW).map(k => entries[k])
    const motion = fitMotion(window, fps, last.frame)

    if (!motion) {
      current.push(index)
      continue
    }

    if (motion.positionAt(entry.frame).distanceTo(entry.vector) <= BREAK_DISTANCE) {
      current.push(index)
      continue
    }

    // 推不準了。再看下一格：如果球回到原本這條弧上，剛剛那一點只是
    // 偵測錯的單點，丟掉它，飛行繼續。這些點會一併回報出去，畫軌跡時
    // 要跳過它們，改走推算出來的擊球位置。
    const following = entries[index + 1]

    if (
      following
      && following.frame - last.frame <= MAX_FRAME_GAP
      && motion.positionAt(following.frame).distanceTo(following.vector) <= RESUME_DISTANCE
    ) {
      outliers.push(index)
      continue
    }

    flights.push(current)
    breaks.push({ kind: 'hit' })
    current = [index]
  }

  flights.push(current)

  return {
    flights: flights.map(indices => indices.map(k => entries[k])),
    outliers: outliers.map(k => entries[k]),
    breaks,
  }
}


/**
 * 一次擊球的虛擬位置：球被打到的那一刻在哪裡。
 *
 * 50fps 下接觸只有約 1ms，幾乎不可能剛好被取樣到，所以那個位置一定要
 * 推算。這裡**只用擊球前的軌跡**外插 —— 入射段是可信的那一側，實測
 * 一步外插誤差中位數只有 0.6 公分。出射段不拿來定位置，因為接觸瞬間
 * 球常被球員或球拍擋住，2D 偵測一跳掉，出射段的頭幾格就會整段偏掉，
 * 實測有 65% 的擊球兩側在空間上根本接不起來（缺口中位數 14 公分）。
 *
 * 接觸時刻取兩個取樣點的中點。接觸必然落在這兩點之間，而入射的球很慢
 * （4~6 m/s，一格才走 8~12 公分），所以時刻取在區間裡的哪裡都只差幾
 * 公分；取中點是最壞情況最小的選法，誤差約 ±5 公分。
 *
 * 出球方向仍然取自出射段的擬合，那是球拍要轉過去的方向。方向準不準和
 * 位置準不準是兩件事，位置不能用不代表方向不能用。
 */
function reconstructContact(incoming, outgoing, fps) {
  const before = incoming.slice(-FIT_WINDOW)
  const after = outgoing.slice(0, FIT_WINDOW)

  if (before.length < MIN_FIT_POINTS) return null
  if (after.length < MIN_FIT_POINTS) return null

  const lastBefore = before[before.length - 1]
  const firstAfter = after[0]

  const contactFrame = (lastBefore.frame + firstAfter.frame) / 2

  const motionIn = fitMotion(before, fps, contactFrame)
  const motionOut = fitMotion(after, fps, contactFrame)

  if (!motionIn || !motionOut) return null

  const velocityIn = motionIn.velocityAt(contactFrame)
  const velocityOut = motionOut.velocityAt(contactFrame)

  return {
    frame: contactFrame,
    position: motionIn.positionAt(contactFrame),
    velocity: velocityOut,
    velocityIn,
  }
}


// 這個切點真的是被打到，還是球速太快時擬合跟不上造成的誤切？
// 自由飛行不可能讓速度轉向，也不可能讓速度變快。
function isHit(velocityIn, velocityOut) {
  const speedIn = velocityIn.length()
  const speedOut = velocityOut.length()

  if (!Number.isFinite(speedIn) || !Number.isFinite(speedOut)) return false
  if (speedIn < 1e-6 || speedOut < 1e-6) return false

  if (speedOut / speedIn > MIN_HIT_SPEEDUP) return true

  const cosine = velocityIn.dot(velocityOut) / (speedIn * speedOut)
  const turn = Math.acos(Math.min(1, Math.max(-1, cosine)))

  return turn > (MIN_HIT_TURN_DEGREES * Math.PI) / 180
}


// 擊球位置由這裡算出來。兩邊各算一次的話，球拍轉向的擊球時刻
// 會和畫出來的位置對不起來。
function analyzeBallFlight(points, fps) {
  const empty = { contacts: [], outliers: [] }

  if (!points || points.length < 2) return empty
  if (!fps) return empty

  const entries = points.map(point => ({
    frame: point.frame,
    vector: toThreeVector(point),
  }))

  const { flights, outliers, breaks } = walkFlights(entries, fps)
  const contacts = []

  for (let index = 0; index < flights.length - 1; index += 1) {
    // 因偵測中斷而切開的段落沒有擊球，沒有接觸點可反推
    if (breaks[index]?.kind !== 'hit') continue

    const contact = reconstructContact(
      flights[index],
      flights[index + 1],
      fps,
    )

    if (!contact) continue

    // 走訪只知道「飛行在這裡被打斷了」，還要確認打斷它的是一次擊球
    if (!isHit(contact.velocityIn, contact.velocity)) continue

    const speed = contact.velocity.length()

    if (!Number.isFinite(speed)) continue
    if (speed < MIN_CONTACT_SPEED || speed > MAX_CONTACT_SPEED) continue

    contacts.push({
      frame: contact.frame,
      position: contact.position.clone(),
      direction: contact.velocity.clone().divideScalar(speed),
      speed,
    })
  }

  return { contacts, outliers }
}


/**
 * 每次擊球的接觸時刻、虛擬接觸位置，以及球被打出去的方向（單位向量）。
 *
 * 方向取自出射段的擬合在接觸時刻的速度，
 * 而不是「下一個取樣點減這個取樣點」——後者已經被重力與阻力汙染，
 * 而且 50fps 下第一個取樣點離接觸已經過了 20ms。
 */
export function buildBallContacts(points, fps) {
  return analyzeBallFlight(points, fps).contacts
}


/**
 * 畫軌跡需要的東西：每次擊球推算出來的虛擬位置，以及被判定為偵測錯誤
 * 而應該從線上跳過的取樣點。
 *
 * 虛擬位置是推算的，不是量到的，所以畫的時候必須看得出來和取樣點不是
 * 同一回事。
 */
export function buildBallFlightPath(points, fps) {
  return analyzeBallFlight(points, fps)
}
