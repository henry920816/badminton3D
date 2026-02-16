import React from 'react'
import { useAppStore } from '../store.js'
import { API_BASE } from '../config.js'

export default function TopBar() {
  const matchId = useAppStore(s => s.matchId)
  const currentTime = useAppStore(s => s.currentTime)
  const currentFrame = useAppStore(s => s.currentFrame)
  const fps = useAppStore(s => s.fps)
  const selection = useAppStore(s => s.selection)

  const exportCsv = () => {
    window.open(`${API_BASE}/export/csv?match_id=${matchId}`, '_blank')
  }

  return (
    <div className="h-[44px] px-3 flex items-center gap-3 border-b border-zinc-800 bg-zinc-950">
      <div className="font-semibold text-sm">Badminton 3D Debugger MVP</div>
      <div className="text-xs text-zinc-400">match #{matchId}</div>
      <div className="ml-auto flex items-center gap-3 text-xs">
        <div className="text-zinc-400">
          t={currentTime.toFixed(3)}s · frame={currentFrame} · fps={fps}
        </div>
        <div className="text-zinc-400">
          sel: {selection.inTime==null?'-':selection.inTime.toFixed(2)} → {selection.outTime==null?'-':selection.outTime.toFixed(2)}
        </div>
        <button onClick={exportCsv} className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800">
          Export CSV
        </button>
      </div>
    </div>
  )
}
