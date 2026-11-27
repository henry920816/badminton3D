import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAppStore } from '../store.js';
import { buildProjectionIssues, projectionIssueLabel } from '../utils/projectionReview.js';
import { PlaybackUI } from './TimelinePanel.jsx';

const MAX_RANGE = 6000;
const tabStyle = active => `px-3 py-1 text-xs font-bold transition-colors ${active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/70'}`;
const keyOf = item => `${item.frame}:${item.cameraIndex}`;

function colorFor(issue, threshold) {
  if (!issue) return '#18181b';
  if (issue.type === 'missing_projection') return '#a855f7';
  if (issue.type === 'outside_view') return '#3b82f6';
  if (issue.error > Math.max(100, threshold)) return '#ef4444';
  return '#f59e0b';
}

export default function ProjectionQualityPanel() {
  const matchId = useAppStore(s => s.matchId);
  const rallies = useAppStore(s => s.rallies) || [];
  const cameras = useAppStore(s => s.cameras) || [];
  const currentFrame = useAppStore(s => s.currentFrame);
  const activeItem = useAppStore(s => s.activeItem);
  const source = useAppStore(s => s.ball2DSource);
  const historyRevision = useAppStore(s => s.ball2DHistoryRevision);
  const correctionTick = useAppStore(s => s.ball2DCorrectionTick);
  const setBottomView = useAppStore(s => s.setBottomView);
  const setCurrentFrame = useAppStore(s => s.setCurrentFrame);
  const setCurrentTime = useAppStore(s => s.setCurrentTime);
  const setSelectionRange = useAppStore(s => s.setSelectionRange);
  const setActiveItem = useAppStore(s => s.setActiveItem);
  const fps = useAppStore(s => s.fps) || 60;
  const setPlaying = useAppStore(s => s.setPlaying);
  const setActiveCamera = useAppStore(s => s.setActiveCamera);
  const setSceneCameraTarget = useAppStore(s => s.setSceneCameraTarget);
  const upsertTrajPoints = useAppStore(s => s.upsertTrajPoints);
  const removeTrajFrames = useAppStore(s => s.removeTrajFrames);
  const trajByFrame = useAppStore(s => s.trajByFrame);
  const [alignBusy, setAlignBusy] = useState(false);
  const [alignMessage, setAlignMessage] = useState('');
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [threshold, setThreshold] = useState(50);
  const [typeFilter, setTypeFilter] = useState('all');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({width: 0, height: 0});
  const orderedRallies = useMemo(() => [...rallies].sort((a, b) => a.start_frame - b.start_frame), [rallies]);
  const currentRally = useMemo(() => {
    if (activeItem?.type === 'rally') {
      const selectedRally = orderedRallies.find(r => String(r.id) === String(activeItem.id));
      if (selectedRally) return selectedRally;
    }
    return orderedRallies.find(r => currentFrame >= r.start_frame && currentFrame <= r.end_frame) || null;
  }, [orderedRallies, currentFrame, activeItem]);
  const rallyId = currentRally?.id;
  const start = Number(currentRally?.start_frame ?? 0);
  const end = Number(currentRally?.end_frame ?? -1);
  const count = Math.max(0, end - start + 1);
  const sortedCameras = useMemo(() => [...cameras].sort((a, b) => Number(a.index) - Number(b.index)), [cameras]);

  useEffect(() => {
    if (!wrapRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setSize({width: entry.contentRect.width, height: entry.contentRect.height}));
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, [currentRally]);

  useEffect(() => {
    setRows([]);
    setSelected(null);
    setHovered(null);
    setError('');
    if (matchId == null || !currentRally) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) throw new Error('Rally 影格範圍無效');
        const next = [];
        for (let first = start; first <= end; first += MAX_RANGE) {
          const chunk = await api.getTraj2DCameraGrid(matchId, first, Math.min(end, first + MAX_RANGE - 1), source);
          if (cancelled) return;
          next.push(...(chunk || []));
        }
        if (!cancelled) setRows(next);
      } catch (e) {
        if (!cancelled) setError(e?.message || '品質檢查載入失敗');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [matchId, rallyId, start, end, source, historyRevision, correctionTick?.seq, revision]);

  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, [matchId]);

  const issues = useMemo(() => buildProjectionIssues(rows, threshold).filter(item => typeFilter === 'all' || item.type === typeFilter), [rows, threshold, typeFilter]);
  const issueMap = useMemo(() => new Map(issues.map(item => [keyOf(item), item])), [issues]);
  const chronologicalIssues = useMemo(() => [...issues].sort((a, b) => a.frame - b.frame || a.cameraIndex - b.cameraIndex), [issues]);
  const pixelIssues = useMemo(() => {
    const buckets = new Map();
    if (!count || !size.width) return buckets;
    const priority = {missing_projection: 4, outside_view: 3, large_error: 2};
    for (const item of issues) {
      const x = Math.min(size.width - 1, Math.floor((item.frame - start) / count * size.width));
      const key = `${item.cameraIndex}:${x}`;
      const old = buckets.get(key);
      if (!old || priority[item.type] > priority[old.type] || (priority[item.type] === priority[old.type] && (item.error ?? 0) > (old.error ?? 0))) buckets.set(key, item);
    }
    return buckets;
  }, [issues, size.width, count, start]);
  const selectedIssue = selected ? issueMap.get(keyOf(selected)) : null;
  const target = selectedIssue || (selected && selected.frame >= start && selected.frame <= end ? selected : null);
  const selectedIndex = target ? chronologicalIssues.findIndex(item => keyOf(item) === keyOf(target)) : -1;

  const choose = item => {
    if (!item) return;
    setSelected(item);
    setAlignMessage('');
    setPlaying(false);
    setCurrentFrame(item.frame);
    const camera = sortedCameras.find(c => Number(c.index) === item.cameraIndex);
    if (camera) {
      setActiveCamera(camera.id);
      setSceneCameraTarget(camera.id);
    }
  };
  const goToRally = index => {
    if (index < 0 || index >= orderedRallies.length) return;
    const rally = orderedRallies[index];
    setPlaying(false);
    setSelectionRange(rally.start_frame / fps, rally.end_frame / fps);
    setCurrentTime(rally.start_frame / fps);
    setActiveItem('rally', rally.id);
    setSelected(null);
  };
  const rallyIndex = orderedRallies.findIndex(rally => String(rally.id) === String(rallyId));
  const goPrevRally = () => goToRally(rallyIndex - 1);
  const goNextRally = () => goToRally(rallyIndex + 1);
  const rowHeight = Math.max(18, Math.min(30, Math.floor((size.height || 210) / Math.max(sortedCameras.length, 1))));
  const plotWidth = Math.max(size.width, 1);
  const plotHeight = Math.max(size.height, 1);
  const frameAt = x => Math.min(end, Math.max(start, start + Math.floor((x / plotWidth) * count)));
  const hitAt = (event) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !count) return null;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const index = Math.floor(y / rowHeight);
    if (index < 0 || index >= sortedCameras.length || x < 0 || x > rect.width) return null;
    const frame = frameAt(x);
    const cameraIndex = Number(sortedCameras[index].index);
    const pixel = Math.min(Math.ceil(size.width) - 1, Math.floor(x));
    return pixelIssues.get(`${cameraIndex}:${pixel}`) || issueMap.get(`${frame}:${cameraIndex}`) || {frame, cameraIndex};
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width || !size.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(size.width * ratio);
    canvas.height = Math.ceil(size.height * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, size.width, size.height);
    if (!count) return;
    const height = rowHeight;
    for (let index = 0; index < sortedCameras.length; index++) {
      const camera = sortedCameras[index];
      const y = index * height;
      ctx.fillStyle = index % 2 ? '#111115' : '#18181b';
      ctx.fillRect(0, y, size.width, height);
      ctx.strokeStyle = '#27272a';
      ctx.beginPath(); ctx.moveTo(0, y + height); ctx.lineTo(size.width, y + height); ctx.stroke();
    }
    // 同一個水平像素內可能有多個 frame；繪出該區段最嚴重的異常，避免縮放後漏顯。
    const priority = {missing_projection: 4, outside_view: 3, large_error: 2};
    const bucket = new Map();
    for (const item of issues) {
      const index = sortedCameras.findIndex(c => Number(c.index) === item.cameraIndex);
      if (index < 0) continue;
      const x = Math.min(size.width - 1, Math.floor((item.frame - start) / count * size.width));
      const key = `${index}:${x}`;
      const old = bucket.get(key);
      const rank = priority[item.type] || 1;
      if (!old || rank > old.rank || (rank === old.rank && (item.error ?? 0) > (old.item.error ?? 0))) bucket.set(key, {index, x, item, rank});
    }
    for (const cell of bucket.values()) {
      ctx.fillStyle = colorFor(cell.item, threshold);
      ctx.fillRect(cell.x, cell.index * height + 2, Math.max(2, size.width / count), Math.max(2, height - 4));
    }
    if (currentFrame >= start && currentFrame <= end) {
      const x = (currentFrame - start + 0.5) / count * size.width;
      ctx.strokeStyle = '#67e8f9'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.height); ctx.stroke();
    }
    if (target) {
      const index = sortedCameras.findIndex(c => Number(c.index) === target.cameraIndex);
      if (index >= 0) {
        const x = (target.frame - start + 0.5) / count * size.width;
        ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 3, index * height + 1, 7, Math.max(3, height - 2));
      }
    }
  }, [issues, sortedCameras, size, rowHeight, count, start, end, currentFrame, target?.frame, target?.cameraIndex, threshold]);

  const refreshFrame = async frame => {
    try {
      const updated = await api.getTraj2DCameraGrid(matchId, frame, frame, source);
      setRows(previous => {
        const fresh = (updated || []).find(row => Number(row.frame) === Number(frame));
        if (!fresh) return previous;
        const index = previous.findIndex(row => Number(row.frame) === Number(frame));
        if (index < 0) return [...previous, fresh].sort((a,b) => a.frame - b.frame);
        const next = [...previous];
        next[index] = fresh;
        return next;
      });
    } catch (err) {
      setAlignMessage(`修改已儲存，但畫面更新失敗：${err?.message || '請按重新掃描'}`);
    }
  };
  const align3D = async () => {
    if (!target || !matchId || alignBusy) return;
    const frame = target.frame;
    const cameraIndex = target.cameraIndex;
    const source2d = source;
    const match = matchId;
    setPlaying(false);
    setAlignBusy(true);
    setAlignMessage('正在驗證並修改 3D 軌跡…');
    try {
      const result = await api.align3DProjectionTo2D(match, {
        frame, camera_index: cameraIndex, source_2d: source2d, confirm: true, direct: true
      });
      upsertTrajPoints([{...result.point, frame: result.frame}]);
      setUndoStack(stack => [...stack, result.version_id]);
      setRedoStack([]);
      await refreshFrame(result.frame);
      setAlignMessage(`已更新 Frame ${result.frame} 的 3D 軌跡及各視角投影；2D 標註未變動`);
    } catch (err) {
      setAlignMessage(err?.message || '3D 對齊失敗，未修改 3D 軌跡');
    } finally {
      setAlignBusy(false);
    }
  };
  const fill3D = async () => {
    if (!target || !matchId || alignBusy) return;
    setPlaying(false);
    setAlignBusy(true);
    setAlignMessage('正在檢查多視角資料並補上 3D 座標…');
    try {
      const result = await api.fillMissing3D(matchId, {
        frame: target.frame, source_2d: source, allow_short_interpolation: true
      });
      upsertTrajPoints([{...result.point, frame: result.frame}]);
      setUndoStack(stack => [...stack, result.version_id]);
      setRedoStack([]);
      await refreshFrame(result.frame);
      setAlignMessage(`Frame ${result.frame} 已補上 3D 點（${result.method === 'multi_view' ? '多視角重建' : result.method === 'single_view_depth' ? '單視角深度估計' : '短缺口插值'}），可使用上一步撤銷`);
    } catch (err) {
      setAlignMessage(err?.message || '無法安全補點，原始資料未變動');
    } finally {
      setAlignBusy(false);
    }
  };
  const undo3D = async () => {
    if (!undoStack.length || !matchId || alignBusy) return;
    const version = undoStack[undoStack.length - 1];
    setAlignBusy(true);
    try {
      const result = await api.undo3DProjectionAlignment(matchId, version);
      if (result.deleted) removeTrajFrames([result.frame]);
      else upsertTrajPoints([{...result.point, frame: result.frame}]);
      setUndoStack(stack => stack.slice(0, -1));
      setRedoStack(stack => [...stack, version]);
      await refreshFrame(result.frame);
      setAlignMessage(`已返回上一步：Frame ${result.frame} 的 3D 修改已撤銷`);
    } catch (err) {
      setAlignMessage(err?.message || '返回上一步失敗');
    } finally {
      setAlignBusy(false);
    }
  };
  const redo3D = async () => {
    if (!redoStack.length || !matchId || alignBusy) return;
    const version = redoStack[redoStack.length - 1];
    setAlignBusy(true);
    try {
      const result = await api.redo3DProjectionAlignment(matchId, version);
      upsertTrajPoints([{...result.point, frame: result.frame}]);
      setRedoStack(stack => stack.slice(0, -1));
      setUndoStack(stack => [...stack, version]);
      await refreshFrame(result.frame);
      setAlignMessage(`已前進下一步：Frame ${result.frame} 的 3D 修改已重做`);
    } catch (err) {
      setAlignMessage(err?.message || '前進下一步失敗');
    } finally {
      setAlignBusy(false);
    }
  };
  const inspected = hovered || target;
  const currentIssue = inspected ? issueMap.get(keyOf(inspected)) : null;
  return <div className="h-full w-full min-h-0 min-w-0 flex flex-col bg-zinc-950 text-zinc-100">
    <div className="min-h-[42px] py-1 pl-3 pr-[104px] shrink-0 flex items-center gap-3 border-b border-zinc-800 min-w-0 overflow-x-auto">
      <div className="flex bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden shrink-0">
        {[['timeline','TIMELINE'],['quality2d','品質檢查'],['projection2d','3D/2D 比對']].map(([id, label]) => <button key={id} type="button" onClick={() => setBottomView(id)} className={tabStyle(id === 'projection2d')}>{label}</button>)}
      </div>

      <span className="text-xs text-zinc-400 truncate hidden xl:inline">{currentRally ? `Rally #${currentRally.rally_index} · frame ${start}–${end}` : '請先選擇 Rally'}</span>
      <div className="ml-auto shrink-0"><PlaybackUI goPrevRally={rallyIndex > 0 ? goPrevRally : null} goNextRally={rallyIndex >= 0 && rallyIndex < orderedRallies.length - 1 ? goNextRally : null} /></div>
      <span className="text-xs text-cyan-300 shrink-0">{loading ? '載入中…' : `${issues.length} 個異常`}</span>
    </div>
    <div className="flex gap-3 px-4 py-2 border-b border-zinc-800 flex-wrap items-center text-xs">
      <label>誤差 &gt; <input type="number" min="0" max="10000" aria-label="誤差門檻" value={threshold} onChange={e => setThreshold(Math.max(0, Number(e.target.value) || 0))} className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1" /> px</label>
      <label>類型 <select aria-label="問題類型" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded p-1"><option value="all">全部</option><option value="large_error">距離過大</option><option value="missing_projection">無有效投影</option><option value="outside_view">投影在視野外</option></select></label>
      <label title="僅在下方資訊列顯示異常點"><input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} /> 僅選異常</label>
      <button type="button" onClick={() => setRevision(value => value + 1)} className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800">重新掃描</button>
      <button type="button" disabled={!chronologicalIssues.length} onClick={() => {const index = chronologicalIssues.findIndex(item => item.frame > currentFrame);choose(chronologicalIssues[index < 0 ? 0 : index]);}} className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800 disabled:opacity-40">下一個異常</button>
      <span className="text-zinc-400">🟠 &gt;門檻　🔴 &gt;100px　🔵 視野外　🟣 無有效投影</span>
    </div>
    {error && <div role="alert" className="px-4 py-1 text-xs text-rose-300">{error}</div>}
    <div className="flex-1 min-h-0 flex gap-2 p-3 overflow-hidden">
      <div className="w-20 shrink-0 flex flex-col border border-zinc-800 rounded-l overflow-hidden">
        {sortedCameras.map(camera => <div key={camera.id} className="px-2 text-[11px] text-zinc-400 border-b border-zinc-800 flex items-center" style={{height:rowHeight,minHeight:rowHeight}}>Cam {camera.index}</div>)}
      </div>
      <div ref={wrapRef} className="relative flex-1 min-w-0 border border-zinc-800 rounded-r overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full cursor-crosshair" onClick={e => {const item = hitAt(e);if (item && (!onlyIssues || issueMap.has(keyOf(item)))) choose(item);}} onMouseMove={e => setHovered(hitAt(e))} onMouseLeave={() => setHovered(null)} title="點擊格子跳到對應 Frame 與相機" />
      </div>
    </div>
    <div className="px-4 py-2 border-t border-zinc-800 text-xs flex gap-3 flex-wrap items-center">
      <button type="button" disabled={selectedIndex <= 0} onClick={() => choose(chronologicalIssues[selectedIndex - 1])} className="px-2 py-1 rounded border border-zinc-700 disabled:opacity-30">上一個異常</button>
      <button type="button" disabled={!chronologicalIssues.length} onClick={() => choose(chronologicalIssues[selectedIndex < 0 || selectedIndex >= chronologicalIssues.length - 1 ? 0 : selectedIndex + 1])} className="px-2 py-1 rounded border border-zinc-700 disabled:opacity-30">下一個異常</button>
      <span className="text-zinc-300">{inspected ? `Cam ${inspected.cameraIndex} · Frame ${inspected.frame}` : '點選格子查看'}</span>
      <span className="text-amber-300">{currentIssue ? `${projectionIssueLabel(currentIssue.type)}${currentIssue.error == null ? '' : ` · ${currentIssue.error.toFixed(1)} px`}` : '無符合條件的異常'}</span>
      {currentIssue && <span className="text-zinc-400">2D: {currentIssue.observed ? `${Number(currentIssue.observed.x).toFixed(1)}, ${Number(currentIssue.observed.y).toFixed(1)}` : '無'}　投影: {currentIssue.projection ? `${Number(currentIssue.projection.x).toFixed(1)}, ${Number(currentIssue.projection.y).toFixed(1)}` : '無'}</span>}
      <button type="button" disabled={!target || alignBusy || !trajByFrame?.has(target.frame)} onClick={align3D} className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40" title="驗證目前 3D／2D 位置後直接更新該 Frame 的 3D 軌跡，保留相機深度；可使用復原按鈕撤銷">{alignBusy ? '修改中…' : '將 3D 投影對齊 2D'}</button>
      <button type="button" disabled={!target || alignBusy || trajByFrame?.has(target.frame)} onClick={fill3D} className="px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40" title="缺少 3D 點時，先嘗試多視角重建；觀測不足則僅在安全短缺口使用插值">補上缺失 3D</button>
      <button type="button" disabled={!undoStack.length || alignBusy} onClick={undo3D} className="px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800 disabled:opacity-40" title="撤銷最近一次 3D 軌跡修改">↶ 上一步</button>
      <button type="button" disabled={!redoStack.length || alignBusy} onClick={redo3D} className="px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800 disabled:opacity-40" title="重做上一個撤銷的 3D 軌跡修改">↷ 下一步</button>
      {alignMessage && <span role="status" className="text-sky-300">{alignMessage}</span>}
      <span className="ml-auto text-zinc-500">點格子同步影片與 3D · 直接修正 · 上一步／下一步可撤銷及重做</span>
    </div>
  </div>;
}
