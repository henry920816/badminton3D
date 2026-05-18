import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { useAppStore } from '../store.js'

const SHOT_TYPES = [
  'Unknown',
  '切球',
  '勾球',
  '平球',
  '防守回抽',
  '防守回挑',
  '放小球',
  '長球',
  '後場抽平球',
  '挑球',
  '推球',
  '殺球',
  '過度切球',
  '撲球',
  '擋小球',
  '點扣',
  '發長球',
  '發短球',
]

const HANDS = ['Unknown', '正拍', '反拍']

function formatPlayer(player) {
  if (player === 'Up') return '上方'
  if (player === 'Down') return '下方'
  return player || '未標註'
}

function formatStatus(status) {
  if (status === 'open') return '未處理'
  if (status === 'fixed') return '已修復'
  if (status === 'false_positive') return '誤判'
  if (status === 'needs_rebuild') return '需要重建'
  return status || '未標註'
}

function formatAnomalyKind(kind) {
  if (kind === 'gap') return '軌跡中斷'
  if (kind === 'jump') return '軌跡跳動'
  if (kind === 'outlier') return '離群點'
  if (kind === 'missing') return '缺失資料'
  return kind || '異常'
}

export default function RightDock() {
  const activeItem = useAppStore(s => s.activeItem)
  const hits = useAppStore(s => s.hits)
  const anomalies = useAppStore(s => s.anomalies)
  const fps = useAppStore(s => s.fps)
  const setCurrentFrame = useAppStore(s => s.setCurrentFrame)
  const currentFrame = useAppStore(s => s.currentFrame)
  const updateHit = useAppStore(s => s.updateHit)
  const updateAnomaly = useAppStore(s => s.updateAnomaly)

  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  const activeHit = useMemo(() => {
    if (!activeItem || activeItem.type !== 'hit') return null
    return (hits || []).find(h => h.id === activeItem.id) || null
  }, [activeItem, hits])

  const activeAnomaly = useMemo(() => {
    if (!activeItem || activeItem.type !== 'anomaly') return null
    return (anomalies || []).find(a => a.id === activeItem.id) || null
  }, [activeItem, anomalies])

  const [shotType, setShotType] = useState('Unknown')
  const [hand, setHand] = useState('Unknown')
  const [note, setNote] = useState('')
  const [newHitFrame, setNewHitFrame] = useState(null)

  useEffect(() => {
    if (!activeHit) return

    setShotType(activeHit.shot_type || 'Unknown')
    setHand(activeHit.hand || 'Unknown')
    setNote(activeHit.note || '')
    setNewHitFrame(activeHit.new_hit_frame ?? null)
    setSaveMessage('')
  }, [activeHit])

  useEffect(() => {
    if (!saveMessage) return

    const timer = window.setTimeout(() => setSaveMessage(''), 1800)
    return () => window.clearTimeout(timer)
  }, [saveMessage])

  const saveHit = async () => {
    if (!activeHit) return

    setSaving(true)
    setSaveMessage('')

    try {
      await api.patchHit(activeHit.id, {
        new_hit_frame: newHitFrame,
        shot_type: shotType,
        hand,
        note,
      })

      updateHit(activeHit.id, {
        new_hit_frame: newHitFrame,
        shot_type: shotType,
        hand,
        note,
      })

      setSaveMessage('已儲存')
    } catch (e) {
      console.error(e)
      setSaveMessage('儲存失敗')
      alert('儲存失敗：' + String(e))
    } finally {
      setSaving(false)
    }
  }

  const markHitNow = () => {
    if (!activeHit) return
    setNewHitFrame(currentFrame)
  }

  const jumpToHit = () => {
    if (!activeHit) return

    const frame = newHitFrame ?? activeHit.hit_frame
    setCurrentFrame(frame)
  }

  const saveAnomalyStatus = async (status) => {
    if (!activeAnomaly) return

    setSaving(true)
    setSaveMessage('')

    try {
      await api.patchAnomaly(activeAnomaly.id, { status })
      updateAnomaly(activeAnomaly.id, { status })
      setSaveMessage('已更新異常狀態')
    } catch (e) {
      console.error(e)
      setSaveMessage('更新失敗')
      alert('更新失敗：' + String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full h-full border-l border-zinc-800 bg-zinc-950 flex flex-col min-w-0 min-h-0">
      <div className="h-[42px] px-3 shrink-0 flex items-center justify-between border-b border-zinc-800">
        <div className="text-xs font-semibold text-zinc-200">編輯面板</div>
        {saveMessage && (
          <div className="text-xs text-emerald-400">{saveMessage}</div>
        )}
      </div>

      <div className="flex-1 min-h-0 p-3 overflow-auto space-y-3 text-sm">
        {!activeItem?.type && (
          <div className="text-zinc-400 text-sm leading-6">
            點選時間軸上的「擊球」或「異常區段」後，這裡會顯示可編輯內容。
          </div>
        )}

        {activeHit && (
          <div className="space-y-3 min-w-0">
            <div className="text-xs text-zinc-400 break-all">
              擊球 #{activeHit.id}
            </div>

            <div className="text-xs text-zinc-400 break-all leading-5">
              Rally {activeHit.rally_id}
              {' · '}
              第 {activeHit.ball_round} 拍
              {' · '}
              球員：{formatPlayer(activeHit.player)}
            </div>

            <div className="grid grid-cols-2 gap-2 min-w-0">
              <div className="rounded border border-zinc-800 p-2 bg-zinc-900/40 min-w-0">
                <div className="text-xs text-zinc-400">Hit Frame</div>
                <div className="font-mono break-all">{activeHit.hit_frame}</div>
              </div>

              <div className="rounded border border-zinc-800 p-2 bg-zinc-900/40 min-w-0">
                <div className="text-xs text-zinc-400">New Hit Frame</div>
                <input
                  className="w-full bg-transparent outline-none font-mono min-w-0"
                  value={newHitFrame ?? ''}
                  onChange={(e) => {
                    const value = e.target.value.trim()

                    if (value === '') {
                      setNewHitFrame(null)
                      return
                    }

                    const parsed = parseInt(value, 10)
                    if (!Number.isNaN(parsed)) setNewHitFrame(parsed)
                  }}
                  placeholder="未填"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={markHitNow}
                className="px-2 py-1 text-xs rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800"
              >
                Mark Current Frame
              </button>

              <button
                onClick={jumpToHit}
                className="px-2 py-1 text-xs rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800"
              >
                Jump to Hit Frame
              </button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 min-w-0">
              <label className="text-xs text-zinc-300 min-w-0">
                <div className="mb-1">球種</div>
                <select
                  className="w-full bg-zinc-900 border border-zinc-800 rounded p-1 text-sm min-w-0"
                  value={shotType}
                  onChange={(e) => setShotType(e.target.value)}
                >
                  {SHOT_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-zinc-300 min-w-0">
                <div className="mb-1">手法</div>
                <select
                  className="w-full bg-zinc-900 border border-zinc-800 rounded p-1 text-sm min-w-0"
                  value={hand}
                  onChange={(e) => setHand(e.target.value)}
                >
                  {HANDS.map(handOption => (
                    <option key={handOption} value={handOption}>{handOption}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="text-xs text-zinc-300 block min-w-0">
              <div className="mb-1">備註</div>
              <textarea
                className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-sm h-24 resize-y min-w-0"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="可以記錄判斷原因、疑似錯誤、需要重看等內容"
              />
            </label>

            <button
              disabled={saving}
              onClick={saveHit}
              className="w-full px-3 py-2 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-sm font-semibold"
            >
              {saving ? '儲存中...' : '儲存擊球'}
            </button>
          </div>
        )}

        {activeAnomaly && (
          <div className="space-y-3 min-w-0">
            <div className="text-xs text-zinc-400 break-all">
              異常區段 #{activeAnomaly.id}
            </div>

            <div className="rounded border border-zinc-800 p-2 bg-zinc-900/40 text-xs text-zinc-300 break-all leading-5">
              類型：{formatAnomalyKind(activeAnomaly.kind)}
              <br />
              嚴重度：{activeAnomaly.severity}
              <br />
              狀態：{formatStatus(activeAnomaly.status)}
            </div>

            <div className="text-xs text-zinc-400 break-all">
              影格 {activeAnomaly.start_frame} → {activeAnomaly.end_frame}
              {' '}
              ({((activeAnomaly.end_frame - activeAnomaly.start_frame) / fps).toFixed(2)} 秒)
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                disabled={saving}
                onClick={() => saveAnomalyStatus('fixed')}
                className="px-2 py-1 text-xs rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-50"
              >
                標記為已修復
              </button>

              <button
                disabled={saving}
                onClick={() => saveAnomalyStatus('false_positive')}
                className="px-2 py-1 text-xs rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-50"
              >
                標記為誤判
              </button>

              <button
                disabled={saving}
                onClick={() => saveAnomalyStatus('needs_rebuild')}
                className="px-2 py-1 text-xs rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-50"
              >
                需要重建
              </button>
            </div>
          </div>
        )}

        <div className="text-xs text-zinc-500 border-t border-zinc-800 pt-3 break-words leading-5">
          快捷鍵：Space 播放 / 暫停；← / → 單幀；Shift + 拖曳時間軸框選；I / O 設定 In / Out；Shift + N / P 跳到異常區段；0~9 切換視角。
        </div>
      </div>
    </div>
  )
}
