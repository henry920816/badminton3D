import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { useAppStore } from '../store.js'

const SHOT_TYPES = ['Unknown', 'Smash', 'Clear', 'Drop', 'Drive', 'Net', 'Lift']
const HANDS = ['Unknown', 'FH', 'BH']

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
  }, [activeHit])

  const saveHit = async () => {
    if (!activeHit) return
    setSaving(true)
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

      alert('已儲存，timeline 與 inspector 已同步更新。')
    } catch (e) {
      console.error(e)
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
    const f = newHitFrame ?? activeHit.hit_frame
    setCurrentFrame(f)
  }

  const saveAnomalyStatus = async (status) => {
    if (!activeAnomaly) return
    setSaving(true)
    try {
      await api.patchAnomaly(activeAnomaly.id, { status })
      updateAnomaly(activeAnomaly.id, { status })
      alert('已更新 anomaly 狀態。')
    } catch (e) {
      console.error(e)
      alert('更新失敗：' + String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full h-full border-l border-zinc-800 bg-zinc-950 flex flex-col min-w-0 min-h-0">
      <div className="h-[42px] px-3 shrink-0 flex items-center border-b border-zinc-800">
        <div className="text-xs font-semibold text-zinc-200">Inspector</div>
      </div>

      <div className="flex-1 min-h-0 p-3 overflow-auto space-y-3 text-sm">
        {!activeItem?.type && (
          <div className="text-zinc-400 text-sm">
            點 timeline 上的 Hit / Anomaly 來編輯。
          </div>
        )}

        {activeHit && (
          <div className="space-y-3 min-w-0">
            <div className="text-xs text-zinc-400 break-all">Hit #{activeHit.id}</div>
            <div className="text-xs text-zinc-400 break-all">
              Rally {activeHit.rally_id} · Round {activeHit.ball_round} · Player {activeHit.player}
            </div>

            <div className="grid grid-cols-2 gap-2 min-w-0">
              <div className="rounded border border-zinc-800 p-2 bg-zinc-900/40 min-w-0">
                <div className="text-xs text-zinc-400">HitFrame</div>
                <div className="font-mono break-all">{activeHit.hit_frame}</div>
              </div>

              <div className="rounded border border-zinc-800 p-2 bg-zinc-900/40 min-w-0">
                <div className="text-xs text-zinc-400">NewHitFrame</div>
                <input
                  className="w-full bg-transparent outline-none font-mono min-w-0"
                  value={newHitFrame ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.trim()
                    if (v === '') {
                      setNewHitFrame(null)
                      return
                    }
                    const n = parseInt(v, 10)
                    if (!Number.isNaN(n)) setNewHitFrame(n)
                  }}
                  placeholder="(empty)"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={markHitNow}
                className="px-2 py-1 text-xs rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800"
              >
                M: Mark current frame
              </button>

              <button
                onClick={jumpToHit}
                className="px-2 py-1 text-xs rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800"
              >
                Jump to hit
              </button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 min-w-0">
              <label className="text-xs text-zinc-300 min-w-0">
                <div className="mb-1">Shot Type</div>
                <select
                  className="w-full bg-zinc-900 border border-zinc-800 rounded p-1 text-sm min-w-0"
                  value={shotType}
                  onChange={(e) => setShotType(e.target.value)}
                >
                  {SHOT_TYPES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-zinc-300 min-w-0">
                <div className="mb-1">Hand</div>
                <select
                  className="w-full bg-zinc-900 border border-zinc-800 rounded p-1 text-sm min-w-0"
                  value={hand}
                  onChange={(e) => setHand(e.target.value)}
                >
                  {HANDS.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="text-xs text-zinc-300 block min-w-0">
              <div className="mb-1">Note</div>
              <textarea
                className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-sm h-24 resize-y min-w-0"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>

            <button
              disabled={saving}
              onClick={saveHit}
              className="w-full px-3 py-2 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-sm font-semibold"
            >
              Save Hit
            </button>
          </div>
        )}

        {activeAnomaly && (
          <div className="space-y-3 min-w-0">
            <div className="text-xs text-zinc-400 break-all">Anomaly #{activeAnomaly.id}</div>

            <div className="rounded border border-zinc-800 p-2 bg-zinc-900/40 text-xs text-zinc-300 break-all">
              {activeAnomaly.kind} · severity {activeAnomaly.severity} · status {activeAnomaly.status}
            </div>

            <div className="text-xs text-zinc-400 break-all">
              frames {activeAnomaly.start_frame} → {activeAnomaly.end_frame} ({((activeAnomaly.end_frame - activeAnomaly.start_frame) / fps).toFixed(2)}s)
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                disabled={saving}
                onClick={() => saveAnomalyStatus('fixed')}
                className="px-2 py-1 text-xs rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-50"
              >
                Mark fixed
              </button>

              <button
                disabled={saving}
                onClick={() => saveAnomalyStatus('false_positive')}
                className="px-2 py-1 text-xs rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-50"
              >
                False positive
              </button>

              <button
                disabled={saving}
                onClick={() => saveAnomalyStatus('needs_rebuild')}
                className="px-2 py-1 text-xs rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-50"
              >
                Needs rebuild
              </button>
            </div>
          </div>
        )}

        <div className="text-xs text-zinc-500 border-t border-zinc-800 pt-3 break-words">
          快捷鍵：Space 播放/暫停；←/→ 單幀；Shift+拖 timeline 框選；I/O 設 In/Out；Shift+N/P 跳異常；1..9 切視角
        </div>
      </div>
    </div>
  )
}
