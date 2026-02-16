import { create } from 'zustand'

export const useAppStore = create((set, get) => ({
  matchId: 1,
  fps: 60,
  durationSec: 0,
  cameras: [],
  activeCameraId: 'cam1',

  // time state (seconds + frame)
  currentTime: 0,
  currentFrame: 0,
  playing: false,
  playbackRate: 1.0,

  // selection range (seconds)
  selection: { inTime: null, outTime: null },

  // timeline objects
  rallies: [],
  hits: [],
  anomalies: [],

  // trajectory cache
  trajByFrame: new Map(), // frame -> {frame,t_sec,x,y,z,confidence}

  // active selection
  activeItem: null, // {type, id}

  // actions
  setMatchMeta: (m) => set({
    fps: m.fps,
    durationSec: m.duration_sec,
    cameras: m.cameras || [],
    activeCameraId: (m.cameras?.[0]?.id) || 'cam1',
  }),

  setCurrentTime: (t) => {
    const fps = get().fps || 60;
    const frame = Math.max(0, Math.round(t * fps));
    set({ currentTime: t, currentFrame: frame });
  },

  setCurrentFrame: (f) => {
    const fps = get().fps || 60;
    const t = f / fps;
    set({ currentFrame: f, currentTime: t });
  },

  setPlaying: (v) => set({ playing: v }),
  togglePlaying: () => set(s => ({ playing: !s.playing })),
  setPlaybackRate: (r) => set({ playbackRate: r }),

  setSelectionIn: () => {
    const t = get().currentTime;
    const sel = get().selection;
    set({ selection: { ...sel, inTime: t }});
  },
  setSelectionOut: () => {
    const t = get().currentTime;
    const sel = get().selection;
    set({ selection: { ...sel, outTime: t }});
  },
  setSelectionRange: (inTime, outTime) => {
    const a = inTime, b = outTime;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    set({ selection: { inTime: lo, outTime: hi }});
  },
  clearSelection: () => set({ selection: { inTime: null, outTime: null }}),

  setTimelineData: ({ rallies, hits, anomalies }) => set({ rallies, hits, anomalies }),

  setActiveCamera: (id) => set({ activeCameraId: id }),

  setActiveItem: (type, id) => set({ activeItem: { type, id }}),

  upsertTrajPoints: (points) => {
    const map = new Map(get().trajByFrame);
    for (const p of points) map.set(p.frame, p);
    set({ trajByFrame: map });
  },

  // helpers
  getSelectionFrameRange: () => {
    const { inTime, outTime } = get().selection;
    const fps = get().fps || 60;
    if (inTime == null || outTime == null) return null;
    const s = Math.max(0, Math.floor(Math.min(inTime, outTime) * fps));
    const e = Math.max(0, Math.ceil(Math.max(inTime, outTime) * fps));
    return [s, e];
  },

  getVisiblePointsFor3D: (windowSec = 3.0) => {
    const { currentTime } = get();
    const fps = get().fps || 60;
    const startFrame = Math.max(0, Math.floor((currentTime - windowSec) * fps));
    const endFrame = Math.max(0, Math.ceil((currentTime + windowSec) * fps));
    const map = get().trajByFrame;
    const out = [];
    for (let f = startFrame; f <= endFrame; f++) {
      const p = map.get(f);
      if (p) out.push(p);
    }
    return out;
  },
}));
