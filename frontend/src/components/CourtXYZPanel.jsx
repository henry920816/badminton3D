import React, { useEffect, useMemo, useRef, useState } from 'react';
import { findCourtXYZReviewFrames, groupCourtXYZWarnings, xyzAxisBounds } from '../utils/courtXYZDiagnostics.js';
const COLORS = {
  x: '#38bdf8',
  y: '#fb923c',
  z: '#34d399'
};
const AXES = ['x', 'y', 'z'];
const CHART_HEIGHT = 182;
const LABEL_WIDTH = 66;
const RIGHT_PAD = 10;
const TOP_PAD = 6;
const ROW_HEIGHT = 54;
const formatCoord = value => Number.isFinite(value) ? value.toFixed(2) : '—';
export default function CourtXYZPanel({
  rows,
  currentFrame,
  startFrame,
  endFrame,
  onSeek
}) {
  const canvasRef = useRef(null);
  const hostRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [hoverFrame, setHoverFrame] = useState(null);
  const warnings = useMemo(() => findCourtXYZReviewFrames(rows), [rows]);
  const warningFrames = useMemo(() => new Set(warnings.map(item => item.frame)), [warnings]);
  const warningGroups = useMemo(() => groupCourtXYZWarnings(warnings), [warnings]);
  const byFrame = useMemo(() => new Map(rows.map(row => [row.frame, row])), [rows]);
  const frameSpan = Math.max(1, endFrame - startFrame);
  const drawableWidth = Math.max(1, width - LABEL_WIDTH - RIGHT_PAD);
  const frameToX = frame => LABEL_WIDTH + (frame - startFrame) / frameSpan * drawableWidth;
  const frameFromEvent = event => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const localX = (event.clientX - rect.left) * (width / Math.max(1, rect.width));
    return Math.max(startFrame, Math.min(endFrame, Math.round(startFrame + (localX - LABEL_WIDTH) / drawableWidth * frameSpan)));
  };
  useEffect(() => {
    if (!hostRef.current) return undefined;
    const node = hostRef.current;
    const resize = () => setWidth(Math.max(0, Math.round(node.clientWidth)));
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(resize);
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < LABEL_WIDTH + 16) return;
    const dpi = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpi);
    canvas.height = Math.round(CHART_HEIGHT * dpi);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpi, 0, 0, dpi, 0, 0);
    context.clearRect(0, 0, width, CHART_HEIGHT);
    const boundsByAxis = Object.fromEntries(AXES.map(axis => [axis, xyzAxisBounds(rows, axis)]));
    const mapY = (value, axis, bandTop) => {
      const [minimum, maximum] = boundsByAxis[axis];
      const fraction = (value - minimum) / Math.max(1e-9, maximum - minimum);
      // Project uses a vertical-down raw Y axis: draw lower Y higher on screen.
      const displayFraction = axis === 'y' ? fraction : 1 - fraction;
      return bandTop + 7 + displayFraction * (ROW_HEIGHT - 16);
    };
    for (let i = 0; i < 3; i++) {
      const axis = AXES[i];
      const bandTop = TOP_PAD + i * ROW_HEIGHT;
      context.fillStyle = i % 2 ? '#111115' : '#0d0d11';
      context.fillRect(0, bandTop, width, ROW_HEIGHT);
      context.strokeStyle = '#27272a';
      context.beginPath();
      context.moveTo(0, bandTop + ROW_HEIGHT - 0.5);
      context.lineTo(width, bandTop + ROW_HEIGHT - 0.5);
      context.stroke();
      context.font = '11px system-ui, sans-serif';
      context.fillStyle = COLORS[axis];
      context.fillText(`${axis.toUpperCase()} (m)`, 9, bandTop + 19);
      context.fillStyle = '#71717a';
      context.font = '10px monospace';
      context.fillText(formatCoord(boundsByAxis[axis][axis === 'y' ? 0 : 1]), LABEL_WIDTH + 3, bandTop + 12);
      context.fillText(formatCoord(boundsByAxis[axis][axis === 'y' ? 1 : 0]), LABEL_WIDTH + 3, bandTop + ROW_HEIGHT - 4);
      for (const [type, dashed, alpha] of [['original', false, 1], ['stereo', true, 0.83]]) {
        context.strokeStyle = COLORS[axis];
        context.globalAlpha = alpha;
        context.lineWidth = type === 'original' ? 1.5 : 1.1;
        context.setLineDash(dashed ? [4, 4] : []);
        context.beginPath();
        let previous = null;
        for (const row of rows) {
          const point = row[type];
          if (!point) {
            previous = null;
            continue;
          }
          const x = frameToX(row.frame);
          const y = mapY(point[axis], axis, bandTop);
          if (previous && row.frame === previous.frame + 1) context.lineTo(x, y);else context.moveTo(x, y);
          previous = row;
        }
        context.stroke();
      }
      context.setLineDash([]);
      context.globalAlpha = 1;
    }

    // Draw sparse review markers on top of the 3D tracks without changing 2D labels.
    context.fillStyle = 'rgba(251,113,133,0.16)';
    context.strokeStyle = 'rgba(251,113,133,0.65)';
    context.lineWidth = 1;
    for (const group of warningGroups) {
      const left = frameToX(group.start);
      const right = frameToX(group.end);
      const span = Math.max(2, right - left);
      context.fillRect(left, TOP_PAD, span, 3 * ROW_HEIGHT);
      context.beginPath();
      context.moveTo(left, TOP_PAD);
      context.lineTo(left, TOP_PAD + 3 * ROW_HEIGHT);
      context.stroke();
    }
  }, [rows, width, startFrame, endFrame, warningGroups]);
  const focusFrame = hoverFrame ?? currentFrame;
  const focus = byFrame.get(focusFrame);
  const focusWarning = warnings.find(item => item.frame === focusFrame);
  const playheadLeft = width > LABEL_WIDTH ? Math.min(width - RIGHT_PAD, Math.max(LABEL_WIDTH, frameToX(currentFrame))) : LABEL_WIDTH;
  const nextWarning = () => {
    if (!warningGroups.length) return;
    const next = warningGroups.find(group => group.start > currentFrame) || warningGroups[0];
    onSeek(next.start);
  };
  return <section className="shrink-0 border border-zinc-800 rounded-md bg-zinc-950 overflow-hidden" aria-label="XYZ 軌跡對照">
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 px-3 py-1.5 text-[11px] border-b border-zinc-800">
        <strong className="text-zinc-200">XYZ 軌跡對照</strong>
        <span className="text-zinc-400">實線：原始 3D</span>
        <span className="text-zinc-400">虛線：雙視角 2D 暫時重建</span>
        <span className="text-rose-400">粉紅標記：位置突跳／重建分歧</span>
        <span className="ml-auto text-zinc-500">{warningGroups.length} 段待檢查（{warnings.length} 幀）</span>
        <button type="button" disabled={!warningGroups.length} onClick={nextWarning} className="rounded border border-zinc-700 px-2 py-1 text-zinc-200 hover:bg-zinc-800 disabled:opacity-40">
          下一個異常
        </button>
      </div>
      <div ref={hostRef} className="w-full relative" style={{
      height: CHART_HEIGHT
    }}>
        <canvas ref={canvasRef} width={width || 600} height={CHART_HEIGHT} onPointerMove={event => setHoverFrame(frameFromEvent(event))} onPointerLeave={() => setHoverFrame(null)} onClick={event => {
        const frame = frameFromEvent(event);
        if (frame !== null) onSeek(frame);
      }} className="w-full h-full block cursor-crosshair" title="點擊軌跡可同步跳到該 Frame；紅色虛線僅為待檢查候選" />
        <div aria-hidden="true" className="absolute pointer-events-none border-l border-white/80" style={{
        left: playheadLeft,
        top: TOP_PAD,
        height: ROW_HEIGHT * 3
      }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-1.5 border-t border-zinc-800 text-[11px] text-zinc-400">
        <span>Frame {focusFrame}{warningFrames.has(focusFrame) ? ' · 待檢查' : ''}</span>
        <span>原始：X {formatCoord(focus?.original?.x)} / Y {formatCoord(focus?.original?.y)} / Z {formatCoord(focus?.original?.z)}</span>
        <span>雙視角：X {formatCoord(focus?.stereo?.x)} / Y {formatCoord(focus?.stereo?.y)} / Z {formatCoord(focus?.stereo?.z)}</span>
        {Number.isFinite(focus?.separation) && <span className="text-amber-300">相距 {focus.separation.toFixed(2)} m</span>}
        {focusWarning && <span className="text-rose-400">{focusWarning.reason}</span>}
        <span className="w-full text-zinc-500">標記是疑似軌跡切換／隔壁場誤標的線索，不能單靠位置突跳確認球場身分；不會自動改動標註。</span>
      </div>
    </section>;
}
