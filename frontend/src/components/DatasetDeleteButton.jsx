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

  const date = new Date(
    value,
  )

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
    const parsed = JSON.parse(
      text,
    )

    return (
      parsed.detail
      || parsed.message
      || text
    )

  } catch {
    return text
  }
}

export default function DatasetDeleteButton() {
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

  const resetTrajCache = useAppStore(
    state => state.resetTrajCache,
  )

  const setTimelineData = useAppStore(
    state => state.setTimelineData,
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
    deleting,
    setDeleting,
  ] = useState(false)

  const [
    confirming,
    setConfirming,
  ] = useState(false)

  const [
    error,
    setError,
  ] = useState('')

  const [
    success,
    setSuccess,
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

  const deleteSelectedDataset = async () => {
    if (
      !selectedDataset
      || deleting
    ) {
      return
    }

    if (!confirming) {
      setConfirming(true)
      setError('')
      setSuccess('')
      return
    }

    setDeleting(true)
    setError('')
    setSuccess('')

    try {
      const result = (
        await api.deleteDataset(
          selectedDataset.match_id,
        )
      )

      const deletedCurrentDataset = (
        selectedDataset.match_id
        === matchId
      )

      if (
        deletedCurrentDataset
      ) {
        setPlaying(false)

        clearSelection()
        clearTrajSelection()
        resetTrajCache()

        setTimelineData({
          rallies: [],
          hits: [],
          anomalies: [],
        })

        setCurrentFrame(0)

        setMatchId(
          result.next_match_id
          ?? null,
        )
      }

      setSuccess(
        '已刪除資料集「'
        + (
          result.deleted_title
          || selectedDataset.title
        )
        + '」',
      )

      setConfirming(false)

      await loadDatasets()

    } catch (deleteError) {
      setError(
        getErrorMessage(
          deleteError,
        ),
      )

    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setConfirming(false)
          setError('')
          setSuccess('')
        }}
        className="
          px-2
          py-1
          rounded
          bg-red-950
          hover:bg-red-900
          border
          border-red-800
          text-red-200
          text-xs
        "
      >
        刪除資料集
      </button>

      {open && (
        <div
          className="
            fixed
            inset-0
            z-[110]
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
                <div
                  className="
                    font-semibold
                  "
                >
                  刪除資料集
                </div>

                <div
                  className="
                    text-xs
                    text-zinc-400
                    mt-0.5
                  "
                >
                  會刪除該資料集的
                  Rally、Hit、異常與球軌跡資料。
                </div>
              </div>

              <button
                type="button"
                disabled={deleting}
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
                    目前沒有可刪除的資料集。
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
                              deleting
                            }
                            onClick={() => {
                              setSelectedId(
                                dataset.match_id,
                              )

                              setConfirming(
                                false,
                              )

                              setError('')
                              setSuccess('')
                            }}
                            className={[
                              'w-full text-left rounded-lg border p-3 transition',

                              selected
                                ? 'border-red-600 bg-red-950/40'
                                : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600',

                              deleting
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
                                  'h-4 w-4 rounded-full border flex items-center justify-center',

                                  selected
                                    ? 'border-red-500'
                                    : 'border-zinc-600',
                                ].join(' ')}
                              >
                                {selected && (
                                  <span
                                    className="
                                      h-2
                                      w-2
                                      rounded-full
                                      bg-red-500
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
                                    '資料集 '
                                    + dataset.match_id
                                  )}
                              </span>

                              <span
                                className="
                                  text-xs
                                  text-zinc-500
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
                                md:grid-cols-5
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
                                2D 點：
                                {formatNumber(
                                  dataset.ball_2d_point_count,
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

              {confirming
                && selectedDataset
                && (
                  <div
                    className="
                      rounded
                      border
                      border-red-700
                      bg-red-950/50
                      p-3
                      text-red-200
                    "
                  >
                    <div
                      className="
                        font-semibold
                      "
                    >
                      確定要永久刪除嗎？
                    </div>

                    <div
                      className="
                        mt-1
                        text-sm
                        break-all
                      "
                    >
                      「
                      {selectedDataset.title}
                      」刪除後無法復原。
                    </div>

                    {selectedDataset.match_id
                      === matchId
                      && (
                        <div
                          className="
                            mt-1
                            text-xs
                            text-red-300
                          "
                        >
                          這是目前正在使用的資料集，
                          刪除後會自動切換到其他資料集。
                        </div>
                      )}
                  </div>
                )}

              {success && (
                <div
                  className="
                    rounded
                    border
                    border-emerald-700
                    bg-emerald-950/50
                    p-3
                    text-emerald-300
                  "
                >
                  {success}
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
                disabled={deleting}
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

              {confirming && (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => {
                    setConfirming(false)
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
                  取消刪除
                </button>
              )}

              <button
                type="button"
                disabled={
                  !selectedDataset
                  || loading
                  || deleting
                }
                onClick={
                  deleteSelectedDataset
                }
                className="
                  px-3
                  py-2
                  rounded
                  bg-red-700
                  hover:bg-red-600
                  disabled:opacity-50
                "
              >
                {deleting
                  ? '正在刪除…'
                  : confirming
                    ? '確認永久刪除'
                    : '刪除選取資料集'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
