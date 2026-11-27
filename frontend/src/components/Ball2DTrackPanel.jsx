import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ball2DTrackAxisBounds, detectBall2DTrackReviewSegments, groupContinuousTrackSegments } from '../utils/ball2DTrackDiagnostics.js';
const LEFT = 66;
const RIGHT = 14;
const BAND = 86;
const HEIGHT = BAND * 2 + 8;
const LABELS = [{
  axis: 'x',
  color: '#38bdf8'
}, {
  axis: 'y',
  color: '#fb923c'
}];
const format = value => Number.isFinite(value) ? value.toFixed(1) : '—';
export default function Ball2DTrackPanel({
  rows,
  cameras,
  selectedCamera,
  onCameraChange,
  currentFrame,
  startFrame,
  endFrame,
  onSeek
}) {
  const host = useRef(null);
  const canvas = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);
  const segments = useMemo(() => detectBall2DTrackReviewSegments(rows), [rows]);
  const lookup = useMemo(() => new Map(rows.map(row => [row.frame, row])), [rows]);
  const drawnSegments = useMemo(() => ({
    observed: groupContinuousTrackSegments(rows, 'observed'),
    projected: groupContinuousTrackSegments(rows, 'projected')
  }), [rows]);
  const span = Math.max(1, endFrame - startFrame);
  const plotWidth = Math.max(1, width - LEFT - RIGHT);
  const toX = frame => LEFT + (frame - startFrame) / span * plotWidth;
  const toFrame = event => {
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect || !width) return null;
    const local = (event.clientX - rect.left) * width / Math.max(1, rect.width);
    return Math.max(startFrame, Math.min(endFrame, Math.round(startFrame + (local - LEFT) / plotWidth * span)));
  };
  useEffect(() => {
    const node = host.current;
    if (!node) return undefined;
    const resize = () => setWidth(Math.max(0, Math.floor(node.clientWidth)));
    resize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = canvas.current;
    if (!element || width < LEFT + RIGHT + 2) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    element.width = Math.round(width * dpr);
    element.height = Math.round(HEIGHT * dpr);
    const ctx = element.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    for (let bandIndex = 0; bandIndex < 2; bandIndex++) {
      const {
        axis,
        color
      } = LABELS[bandIndex];
      const top = bandIndex * BAND + 4;
      const [min, max] = ball2DTrackAxisBounds(rows, axis);
      const yOf = value => top + 13 + (1 - (value - min) / Math.max(0.01, max - min)) * (BAND - 23);
      ctx.fillStyle = bandIndex ? '#0f0f13' : '#15151b';
      ctx.fillRect(0, top, width, BAND);
      ctx.font = '11px system-ui';
      ctx.fillStyle = color;
      ctx.fillText(`${axis.toUpperCase()} (px)`, 8, top + 22);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#a1a1aa';
      ctx.fillText(format(max), LEFT + 4, top + 11);
      ctx.fillText(format(min), LEFT + 4, top + BAND - 3);
      ctx.strokeStyle = '#3f3f46';
      ctx.beginPath();
      ctx.moveTo(0, top + BAND - 0.5);
      ctx.lineTo(width, top + BAND - 0.5);
      ctx.stroke();
      for (const [source, dashed] of [['projected', true], ['observed', false]]) {
        ctx.beginPath();
        ctx.strokeStyle = source === 'projected' ? '#a1a1aa' : color;
        ctx.lineWidth = source === 'projected' ? 1.3 : 1.8;
        ctx.setLineDash(dashed ? [5, 3] : []);
        for (const run of drawnSegments[source]) {
          run.forEach((point, index) => {
            const x = toX(point.frame);
            const y = yOf(point[axis]);
            if (index === 0) ctx.moveTo(x, y);else ctx.lineTo(x, y);
          });
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    for (const seg of segments) {
      const x1 = toX(seg.startFrame);
      const x2 = toX(seg.endFrame + 1);
      ctx.fillStyle = 'rgba(251,113,133,0.17)';
      ctx.fillRect(x1, 4, Math.max(2, x2 - x1), BAND * 2);
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, 4);
      ctx.lineTo(x1, BAND * 2 + 4);
      ctx.stroke();
    }
  }, [rows, segments, drawnSegments, width, startFrame, endFrame]);
  const focus = lookup.get(hover ?? currentFrame);
  const selected = cameras.find(camera => Number(camera.index) === Number(selectedCamera));
  const nextSegment = () => {
    const next = segments.find(seg => seg.startFrame > currentFrame) || segments[0];
    if (next) onSeek(next.startFrame);
  };
  return <section className="shrink-0 border border-zinc-800 rounded-md bg-zinc-950 overflow-hidden" aria-label="各攝影機 2D XY 軌跡追蹤檢查">
      <div className="flex items-center flex-wrap gap-2 px-3 py-1.5 border-b border-zinc-800 text-[11px]">
        <strong className="text-zinc-100">2D XY／原始 3D 投影對照</strong>
        <label className="flex items-center gap-1 text-zinc-300">
          視角
          <select value={selected?.index ?? selectedCamera} onChange={event => onCameraChange(Number(event.target.value))} className="bg-zinc-900 text-zinc-100 border border-zinc-700 rounded px-2 py-1">
            {cameras.map(cam => <option key={cam.id ?? cam.index} value={cam.index}>{cam.label || `Cam ${cam.index}`}</option>)}
          </select>
        </label>
        <span className="text-zinc-400">彩色實線：2D 標註</span>
        <span className="text-zinc-400">灰色虛線：原始 3D 回投</span>
        <span className="text-rose-300">紅底：獨立多視角支持下的偏離</span>
        <span className="ml-auto text-zinc-300">{segments.length} 段待檢查</span>
        <button type="button" disabled={!segments.length} onClick={nextSegment} className="rounded border border-zinc-700 px-2 py-1 disabled:opacity-40 text-zinc-200 hover:bg-zinc-800">
          下一段
        </button>
      </div>
      <div ref={host} className="w-full relative" style={{
      height: HEIGHT
    }}>
        <canvas ref={canvas} width={width || 500} height={HEIGHT} className="block w-full h-full cursor-crosshair" title="點擊定位到對應影格，不會修改任何標註" onPointerMove={event => setHover(toFrame(event))} onPointerLeave={() => setHover(null)} onClick={event => {
        const frame = toFrame(event);
        if (frame !== null) onSeek(frame);
      }} />
        {width > LEFT && <div aria-hidden="true" className="absolute top-1 border-l border-white/80 pointer-events-none" style={{
        left: Math.max(LEFT, Math.min(width - RIGHT, toX(currentFrame))),
        height: BAND * 2
      }} />}
      </div>
      <div className="px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400 border-t border-zinc-800">
        <span>Frame {hover ?? currentFrame}</span>
        <span>2D：{format(focus?.observed?.x)}, {format(focus?.observed?.y)}</span>
        <span>投影：{format(focus?.projected?.x)}, {format(focus?.projected?.y)}</span>
        <span className={Number.isFinite(focus?.errorPx) && focus.errorPx > 30 ? 'text-rose-300' : 'text-zinc-300'}>
          誤差：{format(focus?.errorPx)} px
        </span>
        <span>其他支持視角：{focus?.peerCount ?? '—'} 台</span>
        <span className="w-full text-zinc-500">
          連續偏離只代表疑似追錯目標，也可能是校正／同步偏移。至少 3 台其他攝影機支持原始 3D 才標記；若全部相機一同追錯球，這種方法仍可能漏掉。
        </span>
        {segments.length > 0 && <div className="flex flex-wrap gap-1 w-full">
            {segments.slice(0, 16).map(seg => <button key={seg.startFrame} type="button" onClick={() => onSeek(seg.startFrame)} title={`${seg.label}，最大誤差 ${format(seg.maxErrorPx)} px，${seg.minOtherCameras} 台其他視角支持`} className="border border-rose-900/70 text-rose-300 px-2 py-1 rounded hover:bg-zinc-800">
                {seg.startFrame}–{seg.endFrame} · {seg.label}
              </button>)}
            {segments.length > 16 && <span>另有 {segments.length - 16} 段，使用「下一段」查看。</span>}
          </div>}
      </div>
    </section>;
}
