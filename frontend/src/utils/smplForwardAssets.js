const DEFAULT_SHARED_URL = '/models/smpl/forward/shared.json'
const DEFAULT_PLAYER_URL = '/models/smpl/forward/players/neutral.json'

const cache = new Map()

async function fetchJson(url) {
  const resolved = new URL(url, window.location.href).toString()
  if (!cache.has(resolved)) {
    cache.set(resolved, fetch(resolved).then(async (res) => {
      if (!res.ok) throw new Error(`${resolved}: ${res.status} ${res.statusText}`)
      return res.json()
    }))
  }
  return cache.get(resolved)
}

async function fetchArray(sourceUrl, descriptor, Type) {
  if (!descriptor) return new Type()
  if (Array.isArray(descriptor)) return new Type(descriptor)
  if (descriptor instanceof Type) return descriptor

  const base = new URL(sourceUrl, window.location.href).toString()
  const resolved = new URL(descriptor.url, base).toString()
  const key = `${resolved}#${Type.name}`
  if (!cache.has(key)) {
    cache.set(key, fetch(resolved).then(async (res) => {
      if (!res.ok) throw new Error(`${resolved}: ${res.status} ${res.statusText}`)
      const buffer = await res.arrayBuffer()
      return new Type(buffer)
    }))
  }
  return cache.get(key)
}

async function normalizeShared(raw, sourceUrl) {
  return {
    meta: raw.meta || {},
    arrays: {
      faces: await fetchArray(sourceUrl, raw.arrays?.faces, Uint32Array),
      parents: await fetchArray(sourceUrl, raw.arrays?.parents, Int32Array),
      v_template: await fetchArray(sourceUrl, raw.arrays?.v_template, Float32Array),
      shapedirs: await fetchArray(sourceUrl, raw.arrays?.shapedirs, Float32Array),
      J_regressor: await fetchArray(sourceUrl, raw.arrays?.J_regressor, Float32Array),
      lbs_weights: await fetchArray(sourceUrl, raw.arrays?.lbs_weights, Float32Array),
      posedirs: await fetchArray(sourceUrl, raw.arrays?.posedirs, Float32Array),
    },
  }
}

async function normalizePlayer(raw, sourceUrl) {
  return {
    meta: raw.meta || {},
    arrays: {
      v_shaped: await fetchArray(sourceUrl, raw.arrays?.v_shaped, Float32Array),
      joints: await fetchArray(sourceUrl, raw.arrays?.joints, Float32Array),
    },
  }
}

export async function loadSmplForwardModel(config) {
  const sharedUrl = config?.shared_url || DEFAULT_SHARED_URL
  const playerUrl = config?.player_url || DEFAULT_PLAYER_URL
  const shared = await normalizeShared(await fetchJson(sharedUrl), sharedUrl)

  let player
  try {
    player = await normalizePlayer(await fetchJson(playerUrl), playerUrl)
  } catch (err) {
    if (playerUrl === DEFAULT_PLAYER_URL) throw err
    player = await normalizePlayer(await fetchJson(DEFAULT_PLAYER_URL), DEFAULT_PLAYER_URL)
  }

  return { shared, player }
}
