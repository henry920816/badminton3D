import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAppStore } from '../store.js';
import VideoPanel from './VideoPanel.jsx';
import { buildProjectionIssues, projectionIssueLabel } from '../utils/projectionReview.js';

const MAX_RANGE = 6000;
const coordinates = point => point ? `(${Number(point.x).toFixed(1)}, ${Number(point.y).toFixed(1)})` : '無';

export default function ProjectionReviewPage() {
  const matchId = useAppStore(s => s.matchId);
  const rallies = useAppStore(s => s.rallies) || [];
  const cameras = useAppStore(s => s.cameras) || [];
  const currentFrame = useAppStore(s => s.currentFrame);
  const ball2DSource = useAppStore(s => s.ball2DSource);
  const ball2DHistoryRevision = useAppStore(s => s.ball2DHistoryRevision);
  const ball2DCorrectionTick = useAppStore(s => s.ball2DCorrectionTick);
  const setCurrentFrame = useAppStore(s => s.setCurrentFrame);
  const setActiveCamera = useAppStore(s => s.setActiveCamera);
  const setSceneCameraTarget = useAppStore(s => s.setSceneCameraTarget);
  const setPlaying = useAppStore(s => s.setPlaying);
  const setMainView = useAppStore(s => s.setMainView);
  const setActiveItem = useAppStore(s => s.setActiveItem);
  const orderedRallies = useMemo(() => [...rallies].sort((a, b) => a.start_frame - b.start_frame), [rallies]);
  const [rallyId, setRallyId] = useState('');
  const [cameraFilter, setCameraFilter] = useState('all');
  const [threshold, setThreshold] = useState(50);
  const [kindFilter, setKindFilter] = useState('all');
  const [grid, setGrid] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [dismissed, setDismissed] = useState(() => new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  const [scanRevision, setScanRevision] = useState(0);
  const [scannedRally, setScannedRally] = useState('');

  useEffect(() => {
    setRallyId('');
    setGrid([]);
    setDismissed(new Set());
    setSelectedKey('');
    setScannedRally('');
  }, [matchId]);
  const activeRally = useMemo(() => {
    const explicit = orderedRallies.find(r => String(r.id) === rallyId);
    return explicit || orderedRallies.find(r => currentFrame >= r.start_frame && currentFrame <= r.end_frame) || orderedRallies[0] || null;
  }, [orderedRallies, rallyId, currentFrame]);
  const actualRallyId = activeRally == null ? '' : String(activeRally.id);

  useEffect(() => {
    if (matchId == null || !activeRally) {
      setGrid([]);
      setScannedRally('');
      return;
    }
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setMessage('');
      setGrid([]);
      setSelectedKey('');
      setScannedRally('');
      try {
        const start = Number(activeRally.start_frame);
        const end = Number(activeRally.end_frame);
        if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) throw new Error('Rally 影格範圍無效');
        // 遵守既有 API 的一次請求上限；大型 Rally 分段讀取。
        const rows = [];
        for (let first = start; first <= end; first += MAX_RANGE) {
          const last = Math.min(end, first + MAX_RANGE - 1);
          const chunk = await api.getTraj2DCameraGrid(matchId, first, last, ball2DSource);
          if (cancelled) return;
          rows.push(...(chunk || []));
        }
        if (!cancelled) {
          setGrid(rows);
          setScannedRally(String(activeRally.id));
          const firstIssue = buildProjectionIssues(rows, Number(threshold))[0];
          if (firstIssue) {
            setSelectedKey(`${firstIssue.frame}:${firstIssue.cameraIndex}`);
            const state = useAppStore.getState();
            state.setPlaying(false);
            state.setCurrentFrame(firstIssue.frame);
            const camera = state.cameras.find(c => Number(c.index) === firstIssue.cameraIndex);
            if (camera) {
              state.setActiveCamera(camera.id);
              state.setSceneCameraTarget(camera.id);
            }
          }
        }
      } catch (error) {
        if (!cancelled) setMessage(error?.message || '品質檢查資料載入失敗');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [matchId, actualRallyId, ball2DSource, ball2DHistoryRevision, ball2DCorrectionTick?.seq, scanRevision]);

  const allIssues = useMemo(() => buildProjectionIssues(grid, Number(threshold)), [grid, threshold]);
  const issues = useMemo(() => allIssues.filter(item =>
    (cameraFilter === 'all' || item.cameraIndex === Number(cameraFilter)) &&
    (kindFilter === 'all' || item.type === kindFilter) &&
    (showDismissed || !dismissed.has(`${item.frame}:${item.cameraIndex}`))
  ), [allIssues, cameraFilter, kindFilter, dismissed, showDismissed]);
  const selected = issues.find(item => `${item.frame}:${item.cameraIndex}` === selectedKey) || issues[0] || null;
  const selectedIndex = selected ? issues.findIndex(item => item.frame === selected.frame && item.cameraIndex === selected.cameraIndex) : -1;
  const choose = item => {
    if (!item) return;
    setSelectedKey(`${item.frame}:${item.cameraIndex}`);
    setPlaying(false);
    setCurrentFrame(item.frame);
    const camera = cameras.find(c => Number(c.index) === item.cameraIndex);
    if (camera) {
      setActiveCamera(camera.id);
      setSceneCameraTarget(camera.id);
    }
  };
  const goEditor = item => {
    if (!item) return;
    choose(item);
    if (activeRally) setActiveItem({ type: 'rally', id: activeRally.id });
    setMainView('editor');
  };
  const toggleDismiss = item => {
    const key = `${item.frame}:${item.cameraIndex}`;
    setDismissed(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return <div className="h-[calc(100vh-44px)] min-h-0 flex flex-col bg-zinc-950 text-zinc-100">
    <div className="px-4 py-3 border-b border-zinc-800 flex flex-wrap gap-3 items-end">
      <div className="mr-2"><h1 className="font-semibold text-base">3D 投影 / 2D 標註品質檢查</h1><p className="text-xs text-zinc-400">依原始 3D 軌跡投影與所選 2D 資料比較 · 只做檢視，不自動修改座標</p></div>
      <label className="text-xs text-zinc-300">Rally<select aria-label="選擇 Rally" value={actualRallyId} onChange={event => setRallyId(event.target.value)} className="block mt-1 bg-zinc-900 border border-zinc-700 rounded p-1.5 max-w-[180px]">
        {orderedRallies.map((r, i) => <option key={r.id} value={String(r.id)}>#{i + 1} · {r.start_frame}–{r.end_frame}</option>)}
      </select></label>
      <label className="text-xs text-zinc-300">相機<select aria-label="篩選相機" value={cameraFilter} onChange={e => setCameraFilter(e.target.value)} className="block mt-1 bg-zinc-900 border border-zinc-700 rounded p-1.5">
        <option value="all">全部</option>{cameras.map(c => <option key={c.id} value={String(c.index)}>{c.label || `Cam ${c.index}`}</option>)}
      </select></label>
      <label className="text-xs text-zinc-300">誤差超過 (px)<input aria-label="誤差門檻" type="number" min="0" max="10000" value={threshold} onChange={e => setThreshold(Math.max(0, Number(e.target.value) || 0))} className="block w-24 mt-1 bg-zinc-900 border border-zinc-700 rounded p-1.5" /></label>
      <label className="text-xs text-zinc-300">類型<select aria-label="篩選異常類型" value={kindFilter} onChange={e => setKindFilter(e.target.value)} className="block mt-1 bg-zinc-900 border border-zinc-700 rounded p-1.5">
        <option value="all">所有異常</option><option value="large_error">誤差過大</option><option value="missing_projection">無有效投影、有 2D</option><option value="outside_view">投影超出視野</option>
      </select></label>
      <button type="button" onClick={() => setScanRevision(n => n + 1)} className="px-3 py-1.5 border border-zinc-700 rounded bg-zinc-800 hover:bg-zinc-700 text-xs">重新掃描</button>
      <label className="text-xs text-zinc-300 flex gap-1 items-center"><input type="checkbox" checked={showDismissed} onChange={e => setShowDismissed(e.target.checked)} /> 顯示已略過</label>
      <span className="text-xs text-cyan-300 ml-auto">{loading ? '掃描中…' : `${issues.length} 筆待檢查`}</span>
    </div>
    {message && <div role="alert" className="px-4 py-2 text-rose-300 text-sm bg-rose-950/40">{message}</div>}
    <div className="min-h-0 flex-1 flex flex-col lg:flex-row">
      <section className="lg:w-[52%] flex min-h-0 flex-col border-r border-zinc-800">
        <div className="px-3 py-2 border-b border-zinc-800 flex justify-between items-center text-xs">
          <span>依無投影、視野外及像素誤差排序 · 點選預覽，雙擊前往編輯</span>
          <span className="text-zinc-400">{ball2DSource === 'corrected' ? '2D：修正後' : '2D：原始'}</span>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-xs text-left"><thead className="sticky top-0 bg-zinc-900 text-zinc-400 z-10"><tr>
            <th className="p-2">Frame</th><th className="p-2">相機</th><th className="p-2">誤差</th><th className="p-2">問題</th><th className="p-2">處理</th>
          </tr></thead><tbody>{issues.map(item => {
            const key = `${item.frame}:${item.cameraIndex}`;
            const active = selected && selected.frame === item.frame && selected.cameraIndex === item.cameraIndex;
            return <tr key={key} onClick={() => choose(item)} onDoubleClick={() => goEditor(item)} className={`cursor-pointer border-b border-zinc-800/70 hover:bg-zinc-800 ${active ? 'bg-cyan-950/60' : ''}`}>
              <td className="p-2 font-mono">{item.frame}</td><td className="p-2">Cam {item.cameraIndex}</td>
              <td className={`p-2 font-mono ${item.error != null && item.error > 100 ? 'text-rose-400' : 'text-amber-300'}`}>{item.error == null ? '—' : `${item.error.toFixed(1)}px`}</td>
              <td className="p-2">{projectionIssueLabel(item.type)}</td>
              <td className="p-2"><button type="button" className="underline text-zinc-400 hover:text-white" onClick={e => { e.stopPropagation(); toggleDismiss(item); }}>{dismissed.has(key) ? '恢復' : '略過'}</button></td>
            </tr>;
          })}</tbody></table>
          {!loading && issues.length === 0 && <div className="p-6 text-center text-zinc-400 text-sm">{scannedRally ? '此範圍沒有符合篩選條件的異常' : '尚無掃描結果'}</div>}
        </div>
      </section>
      <section className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="flex flex-wrap gap-2 items-center px-3 py-2 border-b border-zinc-800 text-xs">
          <button type="button" disabled={selectedIndex <= 0} onClick={() => choose(issues[selectedIndex - 1])} className="px-2 py-1 rounded border border-zinc-700 disabled:opacity-30">上一筆</button>
          <button type="button" disabled={selectedIndex < 0 || selectedIndex >= issues.length - 1} onClick={() => choose(issues[selectedIndex + 1])} className="px-2 py-1 rounded border border-zinc-700 disabled:opacity-30">下一筆</button>
          <span className="text-zinc-400">{selected ? `Frame ${selected.frame} · Cam ${selected.cameraIndex}` : '未選取'}</span>
          <button type="button" disabled={!selected} onClick={() => goEditor(selected)} className="ml-auto bg-cyan-800 hover:bg-cyan-700 disabled:opacity-40 px-3 py-1.5 rounded">前往原編輯頁</button>
        </div>
        {selected && <div className="text-xs px-3 py-2 bg-zinc-900/50 grid grid-cols-1 sm:grid-cols-2 gap-1">
          <span>2D 標註：<strong className="text-rose-300">{coordinates(selected.observed)}</strong></span>
          <span>3D 投影：<strong className="text-cyan-300">{coordinates(selected.projection)}</strong></span>
          <span className="sm:col-span-2 text-zinc-400">{selected.reason}</span>
        </div>}
        <div className="flex-1 min-h-[210px] relative"><VideoPanel /></div>
        <div className="px-3 py-2 border-t border-zinc-800 text-xs text-zinc-400">影片原有疊圖可開啟「2D 標註」（實心）及「3D 投影」（空心）比對；點選問題列會切換影格與相機。「略過」僅在此頁暫時隱藏，不會刪除資料。</div>
      </section>
    </div>
  </div>;
}
