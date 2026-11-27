import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAppStore } from '../store.js';

// 所有 2D 位置編輯、藍色移除與紅色批次修正共用同一份上一步／下一步紀錄。
export default function Edit2DHistoryControls() {
  const matchId = useAppStore(state => state.matchId);
  const editTick = useAppStore(state => state.ball2DCorrectionTick?.seq);
  const historyRevision = useAppStore(state => state.ball2DHistoryRevision);
  const [history, setHistory] = useState({ can_undo: false, can_redo: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (matchId == null) return undefined;
    let active = true;
    api.get2DEditHistory(matchId).then(value => {
      if (active) setHistory(value);
    }).catch(reason => {
      if (active) setError(reason.message || String(reason));
    });
    return () => { active = false; };
  }, [matchId, editTick, historyRevision]);

  const run = async direction => {
    if (matchId == null || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = direction === 'undo' ? await api.undo2DEdit(matchId) : await api.redo2DEdit(matchId);
      if (useAppStore.getState().matchId !== matchId) return;
      useAppStore.getState().refreshAfter2DHistory();
      setHistory(await api.get2DEditHistory(matchId));
      setError('');
      window.dispatchEvent(new CustomEvent('badminton-2d-history-changed', { detail: response }));
    } catch (reason) {
      setError(reason.message || String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (matchId == null) return null;
  return <div className="shrink-0 flex items-center gap-1 text-xs" aria-label="2D 修正歷史">
    <button type="button" disabled={busy || !history.can_undo} onClick={() => run('undo')}
      className="px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 disabled:opacity-30"
      title={history.undo_label ? `上一步：${history.undo_label}` : '上一步 2D 修正'}>↶ 上一步</button>
    <button type="button" disabled={busy || !history.can_redo} onClick={() => run('redo')}
      className="px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 disabled:opacity-30"
      title={history.redo_label ? `下一步：${history.redo_label}` : '下一步 2D 修正'}>↷ 下一步</button>
    {error && <span role="alert" className="max-w-[200px] truncate text-red-400" title={error}>{error}</span>}
  </div>;
}
