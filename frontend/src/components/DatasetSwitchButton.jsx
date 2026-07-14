import React, {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { api } from '../api.js'
import { useAppStore } from '../store.js'

function formatNumber(value) {
  return new Intl.NumberFormat(
    'zh-TW',
  ).format(
    Number(value) || 0,
  )
}

function formatCreatedAt(value) {
  if (!value) {
    return '時間不明'
  }

  const date = new Date(value)

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value
  }

  return date.toLocaleString(
    'zh-TW',
  )
}

function getErrorMessage(error) {
  const text = (
    error instanceof Error
      ? error.message
      : String(error)
  )

  try {
    const parsed = JSON.parse(text)

    return (
      parsed.detail
      || parsed.message
      || text
    )
  } catch {
    return text
  }
}

export default function DatasetSwitchButton() {
  const matchId = useAppStore(
    state => state.matchId,
  )

  const setMatchId = useAppStore(
    state => state.setMatchId,
  )

  const setPlaying = useAppStore(
    state => state.setPlaying,
  )

  const setCurrentFrame = useAppStore(
    state => state.setCurrentFrame,
  )

  const clearSelection = useAppStore(
    state => state.clearSelection,
  )

  const clearTrajSelection = useAppStore(
    state => state.clearTrajSelection,
  )

  const clearActiveItem = useAppStore(
    state => state.clearActiveItem,
  )

  const setRepairMode = useAppStore(
    state => state.setRepairMode,
  )

  const resetTrajCache = useAppStore(
    state => state.resetTrajCache,
  )

  const setTimelineData = useAppStore(
    state => state.setTimelineData,
  )

  const setScrollLeft = useAppStore(
    state => state.setScrollLeft,
  )

  const [
    open,
    setOpen,
  ] = useState(false)

  const [
    datasets,
    setDatasets,
  ] = useState([])

  const [
    selectedId,
    setSelectedId,
  ] = useState(null)

  const [
    loading,
    setLoading,
  ] = useState(false)

  const [
    switching,
    setSwitching,
  ] = useState(false)

  const [
    error,
    setError,
  ] = useState('')

  const selectedDataset = useMemo(
    () => (
      datasets.find(
        item => (
          item.match_id
          === selectedId
        ),
      ) || null
    ),
    [
      datasets,
      selectedId,
    ],
  )

  const loadDatasets = async () => {
    setLoading(true)
    setError('')

    try {
      const result = (
        await api.listDatasets()
      )

      const nextDatasets = (
        Array.isArray(
          result?.datasets,
        )
          ? result.datasets
          : []
      )

      setDatasets(
        nextDatasets,
      )

      const currentExists = (
        nextDatasets.some(
          item => (
            item.match_id
            === matchId
          ),
        )
      )

      if (currentExists) {
        setSelectedId(
          matchId,
        )
      } else if (
        nextDatasets.length > 0
      ) {
        setSelectedId(
          nextDatasets[0].match_id,
        )
      } else {
        setSelectedId(
          null,
        )
      }
    } catch (loadError) {
      setDatasets([])
      setSelectedId(null)

      setError(
        getErrorMessage(
          loadError,
        ),
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(
    () => {
      if (!open) {
        return
      }

      loadDatasets()
    },
    [
      open,
    ],
  )

  const switchDataset = () => {
    if (
      !selectedDataset
      || switching
    ) {
      return
    }

    if (
      selectedDataset.match_id
      === matchId
    ) {
      setOpen(false)
      return
    }

    setSwitching(true)
    setError('')

    try {
      setPlaying(false)

      clearSelection()
      clearTrajSelection()
      clearActiveItem()

      setRepairMode(false)

      resetTrajCache()

      setTimelineData({
        rallies: [],
        hits: [],
        anomalies: [],
      })

      setCurrentFrame(0)
      setScrollLeft(0)

      setMatchId(
        selectedDataset.match_id,
      )

      setOpen(false)
    } catch (switchError) {
      setError(
        getErrorMessage(
          switchError,
        ),
      )
    } finally {
      setSwitching(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setError('')
        }}
        className="
          px-2
          py-1
          rounded
          bg-emerald-950
          hover:bg-emerald-900
          border
          border-emerald-800
          text-emerald-200
          text-xs
        "
      >
        切換資料集
      </button>

      {open && (
        <div
          className="
            fixed
            inset-0
            z-[105]
            bg-black/70
            flex
            items-center
            justify-center
            p-4
          "
        >
          <div
            className="
              w-full
              max-w-2xl
              rounded-lg
              border
              border-zinc-700
              bg-zinc-950
              shadow-2xl
            "
          >
            <div
              className="
                px-4
                py-3
                border-b
                border-zinc-800
                flex
                items-center
              "
            >
              <div>
                <div className="font-semibold">
                  切換資料集
                </div>

                <div
                  className="
                    text-xs
                    text-zinc-400
                    mt-0.5
                  "
                >
                  選擇已匯入的資料集，系統會重新載入
                  Rally、Hit、異常與球軌跡。
                </div>
              </div>

              <button
                type="button"
                disabled={switching}
                onClick={() => {
                  setOpen(false)
                }}
                className="
                  ml-auto
                  text-zinc-400
                  hover:text-white
                  disabled:opacity-40
                "
              >
                ✕
              </button>
            </div>

            <div
              className="
                p-4
                space-y-4
              "
            >
              <div
                className="
                  flex
                  items-center
                  justify-between
                  gap-3
                "
              >
                <div
                  className="
                    text-xs
                    text-zinc-400
                  "
                >
                  目前資料集：match #
                  {matchId ?? '-'}
                </div>

                <button
                  type="button"
                  disabled={
                    loading
                    || switching
                  }
                  onClick={
                    loadDatasets
                  }
                  className="
                    px-2
                    py-1
                    rounded
                    bg-zinc-900
                    hover:bg-zinc-800
                    border
                    border-zinc-700
                    text-xs
                    disabled:opacity-50
                  "
                >
                  重新整理
                </button>
              </div>

              {loading && (
                <div
                  className="
                    rounded
                    border
                    border-zinc-800
                    bg-zinc-900
                    p-4
                    text-zinc-300
                  "
                >
                  正在讀取資料集清單…
                </div>
              )}

              {!loading
                && datasets.length === 0
                && !error
                && (
                  <div
                    className="
                      rounded
                      border
                      border-zinc-800
                      bg-zinc-900
                      p-4
                      text-zinc-300
                    "
                  >
                    目前沒有可切換的資料集，
                    請先使用「上傳資料集」。
                  </div>
                )}

              {!loading
                && datasets.length > 0
                && (
                  <div
                    className="
                      max-h-[420px]
                      overflow-auto
                      space-y-2
                      pr-1
                    "
                  >
                    {datasets.map(
                      dataset => {
                        const selected = (
                          dataset.match_id
                          === selectedId
                        )

                        const current = (
                          dataset.match_id
                          === matchId
                        )

                        return (
                          <button
                            key={
                              dataset.match_id
                            }
                            type="button"
                            disabled={
                              switching
                            }
                            onClick={() => {
                              setSelectedId(
                                dataset.match_id,
                              )

                              setError('')
                            }}
                            className={[
                              'w-full text-left rounded-lg border p-3 transition',

                              selected
                                ? 'border-emerald-600 bg-emerald-950/30'
                                : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600',

                              switching
                                ? 'opacity-60'
                                : '',
                            ].join(' ')}
                          >
                            <div
                              className="
                                flex
                                items-center
                                gap-2
                              "
                            >
                              <span
                                className={[
                                  'h-4 w-4 rounded-full border flex items-center justify-center shrink-0',

                                  selected
                                    ? 'border-emerald-500'
                                    : 'border-zinc-600',
                                ].join(' ')}
                              >
                                {selected && (
                                  <span
                                    className="
                                      h-2
                                      w-2
                                      rounded-full
                                      bg-emerald-500
                                    "
                                  />
                                )}
                              </span>

                              <span
                                className="
                                  font-medium
                                  break-all
                                "
                              >
                                {dataset.title
                                  || (
                                    `資料集 ${
                                      dataset.match_id
                                    }`
                                  )}
                              </span>

                              <span
                                className="
                                  text-xs
                                  text-zinc-500
                                  shrink-0
                                "
                              >
                                match #
                                {dataset.match_id}
                              </span>

                              {current && (
                                <span
                                  className="
                                    rounded
                                    bg-indigo-950
                                    border
                                    border-indigo-700
                                    px-1.5
                                    py-0.5
                                    text-[11px]
                                    text-indigo-200
                                    shrink-0
                                  "
                                >
                                  目前使用中
                                </span>
                              )}
                            </div>

                            <div
                              className="
                                mt-2
                                pl-6
                                text-xs
                                text-zinc-400
                                grid
                                grid-cols-2
                                md:grid-cols-4
                                gap-1.5
                              "
                            >
                              <span>
                                Rally：
                                {formatNumber(
                                  dataset.rally_count,
                                )}
                              </span>

                              <span>
                                Hit：
                                {formatNumber(
                                  dataset.hit_count,
                                )}
                              </span>

                              <span>
                                軌跡點：
                                {formatNumber(
                                  dataset.trajectory_count,
                                )}
                              </span>

                              <span>
                                FPS：
                                {dataset.fps}
                              </span>
                            </div>

                            <div
                              className="
                                mt-1
                                pl-6
                                text-[11px]
                                text-zinc-500
                              "
                            >
                              建立時間：
                              {formatCreatedAt(
                                dataset.created_at,
                              )}
                            </div>
                          </button>
                        )
                      },
                    )}
                  </div>
                )}

              {selectedDataset
                && selectedDataset.match_id
                  !== matchId
                && (
                  <div
                    className="
                      rounded
                      border
                      border-emerald-800
                      bg-emerald-950/30
                      p-3
                      text-sm
                      text-emerald-200
                    "
                  >
                    即將切換到「
                    {selectedDataset.title
                      || (
                        `資料集 ${
                          selectedDataset.match_id
                        }`
                      )}
                    」
                  </div>
                )}

              {selectedDataset
                && selectedDataset.match_id
                  === matchId
                && (
                  <div
                    className="
                      rounded
                      border
                      border-zinc-700
                      bg-zinc-900
                      p-3
                      text-sm
                      text-zinc-300
                    "
                  >
                    這個資料集目前已經在使用中。
                  </div>
                )}

              {error && (
                <div
                  className="
                    rounded
                    border
                    border-red-700
                    bg-red-950/50
                    p-3
                    text-red-300
                    whitespace-pre-wrap
                  "
                >
                  {error}
                </div>
              )}
            </div>

            <div
              className="
                px-4
                py-3
                border-t
                border-zinc-800
                flex
                justify-end
                gap-2
              "
            >
              <button
                type="button"
                disabled={switching}
                onClick={() => {
                  setOpen(false)
                }}
                className="
                  px-3
                  py-2
                  rounded
                  bg-zinc-900
                  border
                  border-zinc-700
                  disabled:opacity-50
                "
              >
                關閉
              </button>

              <button
                type="button"
                disabled={
                  !selectedDataset
                  || loading
                  || switching
                }
                onClick={
                  switchDataset
                }
                className="
                  px-3
                  py-2
                  rounded
                  bg-emerald-700
                  hover:bg-emerald-600
                  disabled:opacity-50
                "
              >
                {switching
                  ? '正在切換…'
                  : selectedDataset?.match_id
                      === matchId
                    ? '目前使用中'
                    : '切換到選取資料集'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}