import React, { useEffect, useMemo, useState } from 'react'

import { api } from '../api.js'
import { useAppStore } from '../store.js'

const NO_GROUP_KEY = '__none__'

const BROWSE_MODES = [
  { key: 'all', label: '全部' },
  { key: 'player', label: '依選手' },
  { key: 'discipline', label: '依項目' },
]

const SORT_OPTIONS = [
  { key: 'created_desc', label: '建立時間（新→舊）' },
  { key: 'created_asc', label: '建立時間（舊→新）' },
  { key: 'title_asc', label: '標題（A→Z）' },
]

// Disciplines the backend derives from the SMPL gender plus how many names sit
// on a court.
const DISCIPLINE_LABELS = {
  female_singles: '女子單打',
  male_singles: '男子單打',
  female_doubles: '女子雙打',
  male_doubles: '男子雙打',
  mixed_doubles: '混合雙打',
  unknown_singles: '單打',
  unknown_doubles: '雙打',
}

const collator = new Intl.Collator('zh-TW', {
  numeric: true,
  sensitivity: 'base',
})

function formatNumber(value) {
  return new Intl.NumberFormat('zh-TW').format(Number(value) || 0)
}

function formatCreatedAt(value) {
  if (!value) return '時間不明'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('zh-TW')
}

function formatDuration(dataset) {
  const fps = Number(dataset.fps) || 0
  const frames = Number(dataset.duration_frame) || 0

  if (!fps || !frames) return '長度不明'

  const total = Math.round(frames / fps)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60

  return minutes + ':' + String(seconds).padStart(2, '0')
}

function formatDiscipline(value) {
  return DISCIPLINE_LABELS[value] || value || '未標註項目'
}

function formatCourts(courts) {
  const list = Array.isArray(courts) ? courts : []

  return list
    .map(court => {
      if (court === 'up') return '上半場'
      if (court === 'down') return '下半場'
      return court
    })
    .join('／')
}

function datasetTitle(dataset) {
  return dataset.title || '資料集 ' + dataset.match_id
}

function datasetPlayers(dataset) {
  return Array.isArray(dataset.players) ? dataset.players : []
}

function getErrorMessage(error) {
  const text = error instanceof Error ? error.message : String(error)

  try {
    const parsed = JSON.parse(text)
    return parsed.detail || parsed.message || text
  } catch {
    return text
  }
}

// Which buckets a dataset belongs to under the current browse mode. One match
// can sit in several player buckets at once, so this always returns a list.
function groupKeysOf(dataset, mode) {
  if (mode === 'player') {
    const names = datasetPlayers(dataset)
      .map(player => String(player?.name || '').trim())
      .filter(Boolean)

    return names.length > 0 ? names : [NO_GROUP_KEY]
  }

  if (mode === 'discipline') {
    const value = String(dataset.discipline || '').trim()
    return [value || NO_GROUP_KEY]
  }

  return ['all']
}

function groupLabelOf(key, mode) {
  if (mode === 'all') return '所有資料集'

  if (key !== NO_GROUP_KEY) {
    return mode === 'discipline' ? formatDiscipline(key) : key
  }

  if (mode === 'player') return '沒有選手資料'

  return '未標註項目'
}

function matchesSearch(dataset, keyword) {
  if (!keyword) return true

  const haystack = [
    datasetTitle(dataset),
    'match ' + dataset.match_id,
    '#' + dataset.match_id,
    formatDiscipline(dataset.discipline),
    ...datasetPlayers(dataset).map(player => player?.name),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return keyword
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(token => haystack.includes(token))
}

function sortDatasets(datasets, sortKey) {
  const list = [...datasets]

  const createdOf = dataset => new Date(dataset.created_at || 0).getTime() || 0

  if (sortKey === 'created_asc') {
    list.sort((a, b) => createdOf(a) - createdOf(b) || a.match_id - b.match_id)
  } else if (sortKey === 'title_asc') {
    list.sort((a, b) => collator.compare(datasetTitle(a), datasetTitle(b)))
  } else {
    list.sort((a, b) => createdOf(b) - createdOf(a) || b.match_id - a.match_id)
  }

  return list
}

export default function DatasetBrowser({ open, onClose }) {
  const matchId = useAppStore(state => state.matchId)
  const setMatchId = useAppStore(state => state.setMatchId)
  const setPlaying = useAppStore(state => state.setPlaying)
  const setCurrentFrame = useAppStore(state => state.setCurrentFrame)
  const clearSelection = useAppStore(state => state.clearSelection)
  const clearTrajSelection = useAppStore(state => state.clearTrajSelection)
  const clearActiveItem = useAppStore(state => state.clearActiveItem)
  const setRepairMode = useAppStore(state => state.setRepairMode)
  const resetTrajCache = useAppStore(state => state.resetTrajCache)
  const setTimelineData = useAppStore(state => state.setTimelineData)
  const setScrollLeft = useAppStore(state => state.setScrollLeft)

  const [datasets, setDatasets] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [browseMode, setBrowseMode] = useState('all')
  const [groupKey, setGroupKey] = useState('all')
  const [sortKey, setSortKey] = useState('created_desc')
  const [keyword, setKeyword] = useState('')

  // Filter by keyword first, so the counts on the left always describe what the
  // right-hand list can actually show.
  const searched = useMemo(
    () => datasets.filter(dataset => matchesSearch(dataset, keyword)),
    [datasets, keyword],
  )

  const groups = useMemo(() => {
    const buckets = new Map()

    searched.forEach(dataset => {
      groupKeysOf(dataset, browseMode).forEach(key => {
        const bucket = buckets.get(key) || {
          key,
          label: groupLabelOf(key, browseMode),
          count: 0,
        }

        bucket.count += 1

        buckets.set(key, bucket)
      })
    })

    const list = [...buckets.values()]

    list.sort((a, b) => {
      if (a.key === NO_GROUP_KEY) return 1
      if (b.key === NO_GROUP_KEY) return -1
      return b.count - a.count || collator.compare(a.label, b.label)
    })

    return list
  }, [searched, browseMode])

  // The stored group key can go stale when the mode or the keyword changes, so
  // the list renders from a derived key and the effect below only writes the
  // corrected value back into state.
  const activeGroupKey = useMemo(() => {
    if (browseMode === 'all') return 'all'
    if (groups.some(group => group.key === groupKey)) return groupKey

    return groups.length > 0 ? groups[0].key : null
  }, [browseMode, groups, groupKey])

  const visibleDatasets = useMemo(() => {
    const filtered =
      browseMode === 'all'
        ? searched
        : searched.filter(dataset =>
            groupKeysOf(dataset, browseMode).includes(activeGroupKey),
          )

    return sortDatasets(filtered, sortKey)
  }, [searched, browseMode, activeGroupKey, sortKey])

  const selectedDataset = useMemo(
    () => datasets.find(item => item.match_id === selectedId) || null,
    [datasets, selectedId],
  )

  // Keep the group cursor pointing at something that still exists after the
  // mode, the keyword or the dataset list changes.
  useEffect(() => {
    if (activeGroupKey === null) return
    if (activeGroupKey === groupKey) return

    setGroupKey(activeGroupKey)
  }, [activeGroupKey, groupKey])

  useEffect(() => {
    if (visibleDatasets.some(item => item.match_id === selectedId)) return

    setSelectedId(visibleDatasets.length > 0 ? visibleDatasets[0].match_id : null)
  }, [visibleDatasets, selectedId])

  // An armed delete belongs to one dataset only, so moving the cursor disarms it.
  useEffect(() => {
    setConfirmingDelete(false)
  }, [selectedId])

  const loadDatasets = async () => {
    setLoading(true)
    setError('')

    try {
      const result = await api.listDatasets()
      const nextDatasets = Array.isArray(result?.datasets) ? result.datasets : []

      setDatasets(nextDatasets)

      const currentExists = nextDatasets.some(item => item.match_id === matchId)
      setSelectedId(currentExists ? matchId : null)
    } catch (loadError) {
      setDatasets([])
      setSelectedId(null)
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return

    setConfirmingDelete(false)
    setNotice('')
    setError('')
    loadDatasets()
  }, [open])

  // Clearing everything the current dataset put into the store. Switching to
  // another dataset and deleting the one in use both need it.
  const resetSceneState = () => {
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
  }

  const switchDataset = dataset => {
    const target = dataset || selectedDataset

    if (!target || switching || deleting) return

    if (target.match_id === matchId) {
      onClose()
      return
    }

    setSwitching(true)
    setError('')

    try {
      resetSceneState()
      setMatchId(target.match_id)

      onClose()
    } catch (switchError) {
      setError(getErrorMessage(switchError))
    } finally {
      setSwitching(false)
    }
  }

  const deleteSelectedDataset = async () => {
    if (!selectedDataset || deleting || switching) return

    // First click arms the confirmation, second one actually deletes.
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      setError('')
      setNotice('')
      return
    }

    setDeleting(true)
    setError('')
    setNotice('')

    try {
      const result = await api.deleteDataset(selectedDataset.match_id)

      if (selectedDataset.match_id === matchId) {
        resetSceneState()
        setMatchId(result.next_match_id ?? null)
      }

      setNotice(
        '已刪除資料集「'
        + (result.deleted_title || datasetTitle(selectedDataset))
        + '」',
      )

      setConfirmingDelete(false)
      await loadDatasets()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
    } finally {
      setDeleting(false)
    }
  }

  if (!open) {
    return null
  }

  const closeFromBackdrop = event => {
    // Only a click that landed on the backdrop itself, not one that bubbled up
    // out of the dialog.
    if (event.target !== event.currentTarget) return
    if (switching || deleting) return

    onClose()
  }

  return (
    <div
      onMouseDown={closeFromBackdrop}
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
          max-w-5xl
          h-[80vh]
          flex
          flex-col
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
              資料集
            </div>

            <div
              className="
                text-xs
                text-zinc-400
                mt-0.5
              "
            >
              可依選手、項目或建立時間挑選資料集，切換後會重新載入
              Rally、Hit、異常與球軌跡。
            </div>
          </div>

          <button
            type="button"
            disabled={switching || deleting}
            onClick={onClose}
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
            px-4
            py-2.5
            border-b
            border-zinc-800
            flex
            flex-wrap
            items-center
            gap-2
          "
        >
          <input
            type="search"
            value={keyword}
            onChange={event => {
              setKeyword(event.target.value)
            }}
            placeholder="搜尋標題、選手、賽事或 match ID"
            className="
              flex-1
              min-w-[200px]
              px-2
              py-1.5
              rounded
              bg-zinc-900
              border
              border-zinc-700
              text-sm
              placeholder:text-zinc-600
              focus:outline-none
              focus:border-emerald-700
            "
          />

          <label
            className="
              flex
              items-center
              gap-1.5
              text-xs
              text-zinc-400
            "
          >
            排序

            <select
              value={sortKey}
              onChange={event => {
                setSortKey(event.target.value)
              }}
              className="
                px-2
                py-1.5
                rounded
                bg-zinc-900
                border
                border-zinc-700
                text-xs
                text-zinc-200
              "
            >
              {SORT_OPTIONS.map(option => (
                <option
                  key={option.key}
                  value={option.key}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={loading || switching}
            onClick={loadDatasets}
            className="
              px-2
              py-1.5
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

        <div
          className="
            flex-1
            min-h-0
            flex
          "
        >
          <div
            className="
              w-52
              shrink-0
              border-r
              border-zinc-800
              flex
              flex-col
            "
          >
            <div
              className="
                p-2
                grid
                grid-cols-3
                gap-1
              "
            >
              {BROWSE_MODES.map(mode => (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => {
                    setBrowseMode(mode.key)
                  }}
                  className={[
                    'px-2 py-1 rounded border text-xs transition',

                    browseMode === mode.key
                      ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600',
                  ].join(' ')}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div
              className="
                flex-1
                overflow-auto
                px-2
                pb-2
                space-y-1
              "
            >
              {browseMode === 'all' && (
                <div
                  className="
                    px-2
                    py-2
                    text-xs
                    text-zinc-500
                  "
                >
                  目前列出所有資料集，可用上方的分類方式縮小範圍。
                </div>
              )}

              {browseMode !== 'all'
                && groups.length === 0
                && (
                  <div
                    className="
                      px-2
                      py-2
                      text-xs
                      text-zinc-500
                    "
                  >
                    沒有符合的分類。
                  </div>
                )}

              {browseMode !== 'all'
                && groups.map(group => {
                  const active = group.key === activeGroupKey

                  return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => {
                        setGroupKey(group.key)
                      }}
                      className={[
                        'w-full text-left px-2 py-1.5 rounded border text-xs transition',

                        active
                          ? 'border-emerald-600 bg-emerald-950/40'
                          : 'border-transparent hover:border-zinc-700 hover:bg-zinc-900',
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
                          className="
                            font-medium
                            break-all
                          "
                        >
                          {group.label}
                        </span>

                        <span
                          className="
                            ml-auto
                            text-[11px]
                            text-zinc-500
                            shrink-0
                          "
                        >
                          {group.count} 場
                        </span>
                      </div>
                    </button>
                  )
                })}
            </div>
          </div>

          <div
            className="
              flex-1
              min-w-0
              flex
              flex-col
            "
          >
            <div
              className="
                px-4
                py-2
                text-xs
                text-zinc-400
                border-b
                border-zinc-800
                flex
                items-center
                gap-2
              "
            >
              <span>
                顯示 {visibleDatasets.length}
                {' / '}
                {datasets.length} 個資料集
              </span>

              {browseMode !== 'all'
                && activeGroupKey !== null
                && (
                  <span className="text-zinc-500">
                    · 分類：
                    {groupLabelOf(activeGroupKey, browseMode)}
                  </span>
                )}

              <span
                className="
                  ml-auto
                  text-zinc-500
                "
              >
                目前使用：match #
                {matchId ?? '-'}
              </span>
            </div>

            <div
              className="
                flex-1
                overflow-auto
                p-3
                space-y-2
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
                && visibleDatasets.length === 0
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
                    沒有符合條件的資料集，
                    試著清除搜尋關鍵字或換一個分類。
                  </div>
                )}

              {!loading
                && visibleDatasets.map(dataset => {
                  const selected = dataset.match_id === selectedId
                  const current = dataset.match_id === matchId
                  const players = datasetPlayers(dataset)

                  return (
                    <button
                      key={dataset.match_id}
                      type="button"
                      disabled={switching || deleting}
                      onClick={() => {
                        setSelectedId(dataset.match_id)
                        setError('')
                        setNotice('')
                      }}
                      onDoubleClick={() => {
                        switchDataset(dataset)
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
                          {datasetTitle(dataset)}
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
                          flex
                          flex-wrap
                          items-center
                          gap-1.5
                        "
                      >
                        {players.length === 0 && (
                          <span
                            className="
                              text-[11px]
                              text-zinc-600
                            "
                          >
                            沒有選手資料
                          </span>
                        )}

                        {players.map(player => {
                          const highlighted = (
                            browseMode === 'player'
                            && player?.name === activeGroupKey
                          )

                          return (
                            <span
                              key={player.name}
                              title={
                                formatCourts(player.courts)
                                + '｜'
                                + formatNumber(player.rally_count)
                                + ' rally'
                              }
                              className={[
                                'rounded-full border px-2 py-0.5 text-[11px]',

                                highlighted
                                  ? 'border-emerald-600 bg-emerald-950/60 text-emerald-200'
                                  : 'border-zinc-700 bg-zinc-950 text-zinc-300',
                              ].join(' ')}
                            >
                              {player.name}

                              <span className="text-zinc-500">
                                {' · '}
                                {formatNumber(player.rally_count)}
                              </span>
                            </span>
                          )
                        })}

                        <span
                          className="
                            text-[11px]
                            text-zinc-500
                          "
                        >
                          {formatDiscipline(dataset.discipline)}
                        </span>
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
                          {formatNumber(dataset.rally_count)}
                        </span>

                        <span>
                          Hit：
                          {formatNumber(dataset.hit_count)}
                        </span>

                        <span>
                          軌跡點：
                          {formatNumber(dataset.trajectory_count)}
                        </span>

                        <span>
                          2D 點：
                          {formatNumber(dataset.ball_2d_point_count)}
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
                        長度：
                        {formatDuration(dataset)}
                        {' · 相機：'}
                        {formatNumber(dataset.camera_count)}
                        {' · 建立時間：'}
                        {formatCreatedAt(dataset.created_at)}
                      </div>
                    </button>
                  )
                })}

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
          </div>
        </div>

        <div
          className="
            px-4
            py-3
            border-t
            border-zinc-800
            flex
            items-center
            gap-2
          "
        >
          <div
            className="
              text-xs
              min-w-0
              truncate
            "
          >
            {confirmingDelete && selectedDataset ? (
              <span className="text-red-300">
                確定要刪除「
                {datasetTitle(selectedDataset)}
                」？此動作無法復原，請再按一次刪除。
              </span>
            ) : notice ? (
              <span className="text-emerald-300">
                {notice}
              </span>
            ) : (
              <span className="text-zinc-400">
                {selectedDataset
                  ? selectedDataset.match_id === matchId
                    ? '這個資料集目前已經在使用中。'
                    : (
                        '即將切換到「'
                        + datasetTitle(selectedDataset)
                        + '」（雙擊卡片可直接切換）'
                      )
                  : '尚未選取資料集。'}
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={
              !selectedDataset
              || loading
              || switching
              || deleting
            }
            onClick={deleteSelectedDataset}
            className={[
              'ml-auto px-3 py-2 rounded border disabled:opacity-50',

              confirmingDelete
                ? 'bg-red-700 border-red-600 text-white'
                : 'bg-zinc-900 border-red-900 text-red-300 hover:bg-red-950',
            ].join(' ')}
          >
            {deleting
              ? '正在刪除…'
              : confirmingDelete
                ? '確認刪除'
                : '刪除'}
          </button>

          {confirmingDelete && (
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                setConfirmingDelete(false)
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
              取消
            </button>
          )}

          <button
            type="button"
            disabled={
              !selectedDataset
              || loading
              || switching
              || deleting
              || confirmingDelete
            }
            onClick={() => {
              switchDataset(null)
            }}
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
              : selectedDataset?.match_id === matchId
                ? '目前使用中'
                : '切換到選取資料集'}
          </button>
        </div>
      </div>
    </div>
  )
}
