import React, { useEffect, useState } from 'react'

import { useAppStore } from '../store.js'
import { API_BASE } from '../config.js'

import DatasetBrowser from './DatasetBrowser.jsx'
import DatasetUploadButton from './DatasetUploadButton.jsx'

const SHORTCUTS = [
  ['Space', '播放 / 暫停'],
  ['← / →', '逐幀移動；選取 Rally / Hit 時依情境操作'],
  ['0～9', '切換相機視角'],
  ['I / O', '設定選取範圍 In / Out'],
  ['Esc', '清除目前選取'],
  ['Shift + 拖曳', '在 Timeline 建立範圍'],
  ['Shift + N / P', '跳到下一個 / 上一個異常區段'],
]

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

  const playing = useAppStore(
    state => state.playing,
  )

  const playbackRate = useAppStore(
    state => state.playbackRate,
  )

  const [
    browserOpen,
    setBrowserOpen,
  ] = useState(false)

  const [
    helpOpen,
    setHelpOpen,
  ] = useState(false)

  useEffect(() => {
    if (!helpOpen) return undefined

    const closeOnEscape = event => {
      if (event.key === 'Escape') {
        setHelpOpen(false)
      }
    }

    window.addEventListener(
      'keydown',
      closeOnEscape,
    )

    return () => {
      window.removeEventListener(
        'keydown',
        closeOnEscape,
      )
    }
  }, [helpOpen])

  const exportCsv = () => {
    if (matchId == null) {
      return
    }

    window.open(
      `${API_BASE}/export/csv?match_id=${matchId}`,
      '_blank',
    )
  }

  const resetLayout = () => {
    window.dispatchEvent(
      new CustomEvent(
        'badminton-reset-layout',
      ),
    )
  }

  const hasSelection = (
    selection.inTime != null
    || selection.outTime != null
  )

  return (
    <>
      <div
        className="
          h-[44px]
          px-3
          flex
          items-center
          gap-2
          border-b
          border-zinc-800
          bg-zinc-950
          min-w-0
        "
      >
        <div
          className="
            shrink-0
            font-semibold
            text-sm
            tracking-tight
          "
          title="Badminton 3D Debugger"
        >
          B3D Debugger
        </div>

        <button
          type="button"
          onClick={() => {
            setBrowserOpen(true)
          }}
          title="切換或刪除資料集"
          className="
            min-w-0
            max-w-[320px]
            truncate
            px-2.5
            py-1.5
            rounded-md
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
            gap-2
            min-w-0
            text-xs
          "
        >
          {matchId != null && (
            <>
              <div
                className="
                  hidden
                  lg:flex
                  items-center
                  gap-1.5
                  px-2
                  py-1
                  rounded-md
                  border
                  border-zinc-800
                  bg-zinc-900/70
                  text-zinc-400
                  font-mono
                  shrink-0
                "
              >
                <span
                  className={
                    playing
                      ? 'text-emerald-400'
                      : 'text-zinc-500'
                  }
                >
                  {playing ? '● PLAY' : '● PAUSE'}
                </span>

                <span className="text-zinc-700">|</span>

                <span>
                  F {currentFrame}
                </span>

                <span className="text-zinc-700">|</span>

                <span>
                  {currentTime.toFixed(3)}s
                </span>

                <span className="text-zinc-700">|</span>

                <span>
                  {playbackRate}x · {fps}fps
                </span>
              </div>

              {hasSelection && (
                <div
                  className="
                    hidden
                    2xl:block
                    px-2
                    py-1
                    rounded-md
                    border
                    border-cyan-900/60
                    bg-cyan-950/20
                    text-cyan-300
                    font-mono
                    shrink-0
                  "
                >
                  IN {selection.inTime == null
                    ? '-'
                    : selection.inTime.toFixed(2)}
                  {' → '}
                  OUT {selection.outTime == null
                    ? '-'
                    : selection.outTime.toFixed(2)}
                </div>
              )}
            </>
          )}

          <button
            type="button"
            onClick={resetLayout}
            className="
              hidden
              md:inline-flex
              px-2
              py-1.5
              rounded-md
              bg-zinc-900
              hover:bg-zinc-800
              border
              border-zinc-800
              text-zinc-300
              shrink-0
            "
            title="恢復預設版面比例並離開專注模式"
          >
            重設版面
          </button>

          <button
            type="button"
            onClick={() => {
              setHelpOpen(true)
            }}
            className="
              px-2
              py-1.5
              rounded-md
              bg-zinc-900
              hover:bg-zinc-800
              border
              border-zinc-800
              text-zinc-300
              shrink-0
            "
            title="查看快捷鍵"
          >
            快捷鍵
          </button>

          <button
            type="button"
            disabled={matchId == null}
            onClick={exportCsv}
            className="
              px-2
              py-1.5
              rounded-md
              bg-zinc-900
              hover:bg-zinc-800
              border
              border-zinc-800
              disabled:opacity-40
              shrink-0
            "
          >
            匯出 CSV
          </button>
        </div>
      </div>

      {helpOpen && (
        <div
          className="
            fixed
            inset-0
            z-[100]
            flex
            items-center
            justify-center
            bg-black/65
            p-4
            backdrop-blur-sm
          "
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setHelpOpen(false)
            }
          }}
        >
          <div
            className="
              w-full
              max-w-lg
              rounded-xl
              border
              border-zinc-700
              bg-zinc-950
              shadow-2xl
              overflow-hidden
            "
          >
            <div
              className="
                h-12
                px-4
                flex
                items-center
                justify-between
                border-b
                border-zinc-800
              "
            >
              <div className="font-semibold">
                快捷鍵
              </div>

              <button
                type="button"
                onClick={() => {
                  setHelpOpen(false)
                }}
                className="
                  w-8
                  h-8
                  rounded-md
                  hover:bg-zinc-800
                  text-zinc-400
                  hover:text-white
                "
                aria-label="關閉快捷鍵說明"
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-2">
              {SHORTCUTS.map(
                ([keyName, description]) => (
                  <div
                    key={keyName}
                    className="
                      flex
                      items-center
                      gap-4
                      rounded-lg
                      border
                      border-zinc-800
                      bg-zinc-900/45
                      px-3
                      py-2
                    "
                  >
                    <kbd
                      className="
                        min-w-[110px]
                        rounded
                        border
                        border-zinc-700
                        bg-zinc-900
                        px-2
                        py-1
                        text-center
                        text-xs
                        font-mono
                        text-zinc-200
                      "
                    >
                      {keyName}
                    </kbd>

                    <div
                      className="
                        text-sm
                        text-zinc-300
                      "
                    >
                      {description}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
