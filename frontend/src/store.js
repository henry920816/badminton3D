import { create } from 'zustand'

function normalizeRange(start, end) {
  const a = Math.max(0, Math.min(start, end))
  const b = Math.max(0, Math.max(start, end))
  return { start: a, end: b }
}

export const DEFAULT_CAMERAS = [
  {
    id: 'cam0',
    index: 0,
    label: 'Cam 0',
    fileName: '0.mp4',
    description: '實際校正位置 Cam 0',
    video_url: null,
    fps: 50,
    offset_frame: 0,
    position: [-11.4588, 5.0819, -0.9554],
    target: [-7.0362, 2.9984, -2.0040],
    enabled: true,
  },
  {
    id: 'cam1',
    index: 1,
    label: 'Cam 1',
    fileName: '1.mp4',
    description: '實際校正位置 Cam 1',
    video_url: null,
    fps: 50,
    offset_frame: 0,
    position: [11.4519, 5.0414, 1.0773],
    target: [7.0023, 3.0007, 2.0952],
    enabled: true,
  },
  {
    id: 'cam2',
    index: 2,
    label: 'Cam 2',
    fileName: '2.mp4',
    description: '實際校正位置 Cam 2',
    video_url: null,
    fps: 50,
    offset_frame: 0,
    position: [11.4710, 5.0591, 4.2546],
    target: [7.5436, 3.3906, 1.6484],
    enabled: true,
  },
  {
    id: 'cam3',
    index: 3,
    label: 'Cam 3',
    fileName: '3.mp4',
    description: '實際校正位置 Cam 3',
    video_url: null,
    fps: 50,
    offset_frame: 0,
    position: [0.0085, 3.9100, 8.0808],
    target: [0.0386, 0.7618, 4.1965],
    enabled: true,
  },
  {
    id: 'cam4',
    index: 4,
    label: 'Cam 4',
    fileName: '4.mp4',
    description: '實際校正位置 Cam 4',
    video_url: null,
    fps: 50,
    offset_frame: 0,
    position: [0.0800, 3.8949, -7.5377],
    target: [-0.1831, 0.1498, -4.2354],
    enabled: true,
  },
  {
    id: 'cam5',
    index: 5,
    label: 'Cam 5',
    fileName: '5.mp4',
    description: '實際校正位置 Cam 5',
    video_url: null,
    fps: 50,
    offset_frame: 0,
    position: [11.4252, 5.0345, -3.9932],
    target: [7.4593, 3.3348, -1.4668],
    enabled: true,
  },
  {
    id: 'cam6',
    index: 6,
    label: 'Cam 6',
    fileName: '6.mp4',
    description: '實際校正位置 Cam 6',
    video_url: null,
    fps: 50,
    offset_frame: 0,
    position: [-11.4017, 5.1018, 0.8919],
    target: [-6.9718, 3.0429, 1.9579],
    enabled: true,
  },
  {
    id: 'cam7',
    index: 7,
    label: 'Cam 7',
    fileName: '7.mp4',
    description: '實際校正位置 Cam 7',
    video_url: null,
    fps: 50,
    offset_frame: 0,
    position: [-11.2263, 5.1586, 3.9836],
    target: [-7.3162, 3.3693, 1.4323],
    enabled: true,
  },
  {
    id: 'cam8',
    index: 8,
    label: 'Cam 8',
    fileName: '8.mp4',
    description: '實際校正位置 Cam 8',
    video_url: null,
    fps: 50,
    offset_frame: 0,
    position: [-11.4321, 5.1087, -3.9306],
    target: [-7.5047, 3.3484, -1.3855],
    enabled: true,
  },
  {
    id: 'cam9',
    index: 9,
    label: 'Cam 9',
    fileName: '9.mp4',
    description: '實際校正位置 Cam 9',
    video_url: null,
    fps: 50,
    offset_frame: 0,
    position: [11.4379, 4.9914, -0.9066],
    target: [7.0110, 2.9273, -1.9751],
    enabled: true,
  },
]

function normalizeCameras(cameras, fallbackFps = 50) {
  if (!Array.isArray(cameras) || cameras.length < 10) {
    return DEFAULT_CAMERAS.map((camera) => ({
      ...camera,
      fps: fallbackFps || camera.fps || 50,
    }))
  }

  return cameras.slice(0, 10).map((camera, index) => {
    const fallback = DEFAULT_CAMERAS[index]
    return {
      ...fallback,
      ...camera,
      id: camera.id || fallback.id,
      index: camera.index ?? index,
      label: camera.label || fallback.label,
      fileName: camera.fileName || camera.file_name || `${index}.mp4`,
      video_url: camera.video_url ?? camera.url ?? fallback.video_url,
      fps: camera.fps || fallbackFps || fallback.fps || 50,
      offset_frame: camera.offset_frame ?? camera.offsetFrame ?? fallback.offset_frame ?? 0,
      position: camera.position || fallback.position,
      target: camera.target || fallback.target,
      enabled: camera.enabled ?? true,
    }
  })
}

export const useAppStore = create((set, get) => ({
  matchId: 1,

  fps: 50,
  durationSec: 0,

  cameras: DEFAULT_CAMERAS,
  activeCameraId: 'cam0',
  sceneCameraTargetId: 'cam0',
  localVideoSrcMap: {},

  currentTime: 0,
  currentFrame: 0,
  playing: false,
  playbackRate: 1.0,

  selection: {
    inTime: null,
    outTime: null,
  },

  rallies: [],
  hits: [],
  anomalies: [],

  trajByFrame: new Map(),
  loadedTrajRanges: [],

  pxPerSec: 100,
  scrollLeft: 0,
  bottomView: 'timeline',

  activeItem: null,
  selectedTrajFrames: [],
  repairMode: false,

  setZoom: (px) => set({ pxPerSec: px }),
  setScrollLeft: (x) => set({ scrollLeft: x }),
  setBottomView: (view) => set({
    bottomView: view === 'projection2d' ? 'projection2d' : 'timeline',
  }),

  setMatchMeta: (m) => {
    const fps = m?.fps || 50
    const cameras = normalizeCameras(m?.cameras, fps)

    set({
      fps,
      durationSec: m?.duration_sec ?? (m?.duration_frame ? m.duration_frame / fps : 0),
      cameras,
      activeCameraId: cameras[0]?.id || 'cam0',
      sceneCameraTargetId: cameras[0]?.id || 'cam0',
    })
  },

  setCurrentTime: (t) => {
    const fps = get().fps || 50
    const durationSec = get().durationSec || 0
    const clamped = durationSec > 0 ? Math.min(Math.max(0, t), durationSec) : Math.max(0, t)
    const frame = Math.max(0, Math.round(clamped * fps))

    set({
      currentTime: clamped,
      currentFrame: frame,
    })
  },

  setCurrentFrame: (f) => {
    const fps = get().fps || 50
    const durationSec = get().durationSec || 0
    const maxFrame = durationSec > 0 ? Math.round(durationSec * fps) : Number.MAX_SAFE_INTEGER
    const clampedFrame = Math.max(0, Math.min(f, maxFrame))
    const t = clampedFrame / fps

    set({
      currentFrame: clampedFrame,
      currentTime: t,
    })
  },

  setPlaying: (v) => set({ playing: Boolean(v) }),

  togglePlaying: () => set((s) => ({
    playing: !s.playing,
  })),

  setPlaybackRate: (r) => set({
    playbackRate: Number(r) || 1.0,
  }),

  setSelectionIn: () => {
    const t = get().currentTime
    const sel = get().selection

    set({
      selection: {
        ...sel,
        inTime: t,
      },
    })
  },

  setSelectionOut: () => {
    const t = get().currentTime
    const sel = get().selection

    set({
      selection: {
        ...sel,
        outTime: t,
      },
    })
  },

  setSelectionRange: (inTime, outTime) => {
    const lo = Math.min(inTime, outTime)
    const hi = Math.max(inTime, outTime)

    set({
      selection: {
        inTime: lo,
        outTime: hi,
      },
    })
  },

  clearSelection: () => set({
    selection: {
      inTime: null,
      outTime: null,
    },
  }),

  setTimelineData: ({ rallies, hits, anomalies }) => set({
    rallies: rallies || [],
    hits: hits || [],
    anomalies: anomalies || [],
  }),

  updateHit: (id, updates) => set((s) => ({
    hits: s.hits.map((h) => (
      h.id === id ? { ...h, ...updates } : h
    )),
  })),

  updateAnomaly: (id, updates) => set((s) => ({
    anomalies: s.anomalies.map((a) => (
      a.id === id ? { ...a, ...updates } : a
    )),
  })),

  setActiveCamera: (id) => set({
    activeCameraId: id,
  }),

  setActiveCameraFromScene: (id) => set({
    activeCameraId: id,
    sceneCameraTargetId: id,
  }),

  setSceneCameraTarget: (id) => set({
    sceneCameraTargetId: id,
  }),

  setCameraOffset: (id, offsetFrame) => set((s) => ({
    cameras: s.cameras.map((c) => (
      c.id === id
        ? {
            ...c,
            offset_frame: Number(offsetFrame) || 0,
          }
        : c
    )),
  })),

  setLocalVideoSrc: (cameraId, src) => set((s) => ({
    localVideoSrcMap: {
      ...s.localVideoSrcMap,
      [cameraId]: src,
    },
  })),

  setLocalVideoSrcMap: (srcMap) => set({
    localVideoSrcMap: srcMap || {},
  }),

  clearLocalVideoSrcMap: () => set({
    localVideoSrcMap: {},
  }),

  setActiveItem: (type, id) => set({
    activeItem: {
      type,
      id,
    },
  }),

  clearActiveItem: () => set({
    activeItem: null,
  }),

  setRepairMode: (v) => set({
    repairMode: Boolean(v),
  }),

  toggleRepairMode: () => set((s) => ({
    repairMode: !s.repairMode,
  })),

  toggleTrajFrameSelection: (frame) => set((s) => {
    let next = [...s.selectedTrajFrames]

    if (next.includes(frame)) {
      next = next.filter((f) => f !== frame)
    } else {
      next.push(frame)
      if (next.length > 2) next.shift()
    }

    return {
      selectedTrajFrames: next,
    }
  }),

  clearTrajSelection: () => set({
    selectedTrajFrames: [],
  }),

  upsertTrajPoints: (points) => {
    const map = new Map(get().trajByFrame)

    for (const p of points || []) {
      if (p && typeof p.frame !== 'undefined') {
        map.set(p.frame, p)
      }
    }

    set({
      trajByFrame: map,
    })
  },

  markTrajRangeLoaded: (start, end) => {
    const nextRange = normalizeRange(start, end)
    const ranges = [...get().loadedTrajRanges, nextRange].sort((a, b) => a.start - b.start)
    const merged = []

    for (const range of ranges) {
      if (!merged.length) {
        merged.push({ ...range })
        continue
      }

      const last = merged[merged.length - 1]

      if (range.start <= last.end + 1) {
        last.end = Math.max(last.end, range.end)
      } else {
        merged.push({ ...range })
      }
    }

    set({
      loadedTrajRanges: merged,
    })
  },

  hasTrajRangeLoaded: (start, end) => {
    const target = normalizeRange(start, end)

    return get().loadedTrajRanges.some((range) => (
      target.start >= range.start && target.end <= range.end
    ))
  },

  resetTrajCache: () => set({
    trajByFrame: new Map(),
    loadedTrajRanges: [],
  }),

  getSelectionFrameRange: () => {
    const { inTime, outTime } = get().selection
    const fps = get().fps || 50

    if (inTime == null || outTime == null) return null

    const s = Math.max(0, Math.floor(Math.min(inTime, outTime) * fps))
    const e = Math.max(0, Math.ceil(Math.max(inTime, outTime) * fps))

    return [s, e]
  },

  getVisiblePointsFor3D: (windowSec = 3.0) => {
    const { currentTime } = get()
    const fps = get().fps || 50
    const startFrame = Math.max(0, Math.floor((currentTime - windowSec) * fps))
    const endFrame = Math.max(0, Math.ceil((currentTime + windowSec) * fps))
    const map = get().trajByFrame
    const out = []

    for (let f = startFrame; f <= endFrame; f++) {
      const p = map.get(f)
      if (p) out.push(p)
    }

    return out
  },
}))
