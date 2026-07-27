import React from 'react'

import { useAppStore } from '../store.js'
import { API_BASE } from '../config.js'

import DatasetUploadButton from './DatasetUploadButton.jsx'
import DatasetSwitchButton from './DatasetSwitchButton.jsx'
import DatasetDeleteButton from './DatasetDeleteButton.jsx'

export default function TopBar() {
  const matchId = useAppStore(
    state => state.matchId,
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
        relative
        z-[100]
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

      <div
        className="
          text-xs
          text-zinc-400
        "
      >
        match #
        {matchId ?? '-'}
      </div>

      <DatasetUploadButton />

      <DatasetSwitchButton />

      <DatasetDeleteButton />

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
