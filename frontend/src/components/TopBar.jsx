import React, { useState } from 'react'

import { useAppStore } from '../store.js'
import { API_BASE } from '../config.js'

import DatasetBrowser from './DatasetBrowser.jsx'
import DatasetUploadButton from './DatasetUploadButton.jsx'

export default function TopBar() {
  const matchId = useAppStore(
    state => state.matchId,
  )

  const matchTitle = useAppStore(
    state => state.matchTitle,
  )

  const currentTime = useAppStore(
    state => state.currentTime,
  )

  const currentFrame = useAppStore(
    state => state.currentFrame,
  )

  const fps = useAppStore(
    state => state.fps,
  )

  const selection = useAppStore(
    state => state.selection,
  )

  const [
    browserOpen,
    setBrowserOpen,
  ] = useState(false)

  const exportCsv = () => {
    if (matchId == null) {
      return
    }

    window.open(
      `${API_BASE}/export/csv?match_id=${matchId}`,
      '_blank',
    )
  }

  return (
    <div
      className="
        h-[44px]
        px-3
        flex
        items-center
        gap-3
        border-b
        border-zinc-800
        bg-zinc-950
      "
    >
      <div
        className="
          font-semibold
          text-sm
        "
      >
        Badminton 3D Debugger MVP
      </div>

      <button
        type="button"
        onClick={() => {
          setBrowserOpen(true)
        }}
        title="切換或刪除資料集"
        className="
          max-w-[380px]
          truncate
          px-2
          py-1
          rounded
          bg-zinc-900
          hover:bg-zinc-800
          border
          border-zinc-700
          text-xs
          text-zinc-200
        "
      >
        {matchId == null
          ? '尚未選擇資料集'
          : matchTitle || `資料集 ${matchId}`}
      </button>

      <DatasetUploadButton />

      <DatasetBrowser
        open={browserOpen}
        onClose={() => {
          setBrowserOpen(false)
        }}
      />

      <div
        className="
          ml-auto
          flex
          items-center
          gap-3
          text-xs
        "
      >
        <div
          className="
            text-zinc-400
          "
        >
          t=
          {currentTime.toFixed(3)}
          s · frame=
          {currentFrame}
          {' · '}
          fps=
          {fps}
        </div>

        <div
          className="
            text-zinc-400
          "
        >
          sel:{' '}

          {selection.inTime == null
            ? '-'
            : selection.inTime.toFixed(2)}

          {' → '}

          {selection.outTime == null
            ? '-'
            : selection.outTime.toFixed(2)}
        </div>

        <button
          type="button"
          disabled={matchId == null}
          onClick={exportCsv}
          className="
            px-2
            py-1
            rounded
            bg-zinc-900
            hover:bg-zinc-800
            border
            border-zinc-800
            disabled:opacity-40
          "
        >
          Export CSV
        </button>
      </div>
    </div>
  )
}