import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAppStore } from '../store.js';
import { PROJECTION_ERROR_COLORS, qualityCellPresentation } from '../utils/qualityProjectionColor.js';
import { PlaybackUI } from './TimelinePanel.jsx';
import CourtXYZPanel from './CourtXYZPanel.jsx';
import Ball2DTrackPanel from './Ball2DTrackPanel.jsx';
import { buildBall2DTrackRows } from '../utils/ball2DTrackDiagnostics.js';
import { buildCourtXYZData } from '../utils/courtXYZDiagnostics.js';
import { isMissingReview } from '../utils/reviewQueue.js';
import { findBlueRun, isBlueCell } from '../utils/blueReviewSelection.js';
import { getQualityCameraRows, qualityGridHit } from '../utils/qualityCameraRows.js';
const ROW_HEIGHT_FALLBACK = 26;
const MIN_ROW_HEIGHT = 16;
const MIN_ZOOM_FRAMES = 10;
const BLUE_HOLD_MS = 600;
const POINTER_MOVE_LIMIT = 7;
const AVAILABLE_CAMERA_MIN = 3;
const MAX_CAMERA_GRID_FRAMES = 6000;
function usePanelSize(ref) {
  const [size, setSize] = useState({
    width: 0,
    height: 0
  });
  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const {
        width,
        height
      } = entry.contentRect;
      setSize({
        width,
        height
      });
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
function findCurrentRally(rallies, currentFrame, activeItem) {
  const sorted = [...rallies].sort((first, second) => first.start_frame - second.start_frame);
  if (activeItem?.type === 'rally') {
    const active = sorted.find(rally => rally.id === activeItem.id);
    if (active) {
      return active;
    }
  }
  return sorted.find(rally => currentFrame <= rally.end_frame) || null;
}
export default function Quality2DPanel() {
  const matchId = useAppStore(state => state.matchId);
  const fps = useAppStore(state => state.fps) || 50;

  // 依目前選的 2D 來源（原始 / 修正後）做品質檢查
  const ball2DSource = useAppStore(state => state.ball2DSource);
  const ball2DCorrectionTick = useAppStore(state => state.ball2DCorrectionTick);
  const ball2DHistoryRevision = useAppStore(state => state.ball2DHistoryRevision);
  const currentFrame = useAppStore(state => state.currentFrame);
  const setCurrentFrame = useAppStore(state => state.setCurrentFrame);
  const setCurrentTime = useAppStore(state => state.setCurrentTime);
  const bottomView = useAppStore(state => state.bottomView);
  const setBottomView = useAppStore(state => state.setBottomView);
  const cameras = useAppStore(state => state.cameras) || [];
  const setActiveCamera = useAppStore(state => state.setActiveCamera);
  const setSceneCameraTarget = useAppStore(state => state.setSceneCameraTarget);
  const rallies = useAppStore(state => state.rallies) || [];
  const activeItem = useAppStore(state => state.activeItem);
  const setActiveItem = useAppStore(state => state.setActiveItem);
  const setSelectionRange = useAppStore(state => state.setSelectionRange);
  const setPlaying = useAppStore(state => state.setPlaying);
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const draggingRef = useRef(false);
  const pressRef = useRef(null);
  const suppressDoubleClickUntilRef = useRef(0);
  const hideBusyRef = useRef(false);
  const [hidingBlue, setHidingBlue] = useState(false);
  const [hideHint, setHideHint] = useState('');
  const size = usePanelSize(wrapRef);
  const [grid, setGrid] = useState([]);
  const [loadedRallyId, setLoadedRallyId] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [autoRepairing, setAutoRepairing] = useState(false);
  const [autoRepairResult, setAutoRepairResult] = useState(null);
  const [zoom, setZoom] = useState(null);
  const [onlyRed, setOnlyRed] = useState(true);
  const [showMissing, setShowMissing] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const [showXYZ, setShowXYZ] = useState(false);
  const [show2DTrack, setShow2DTrack] = useState(false);
  const [trackCameraIndex, setTrackCameraIndex] = useState(null);
  const trajByFrame = useAppStore(state => state.trajByFrame);
  const currentRally = useMemo(() => findCurrentRally(rallies, currentFrame, activeItem), [rallies, currentFrame, activeItem]);
  const currentRallyRef = useRef(null);
  currentRallyRef.current = currentRally;
  const sortedCameras = useMemo(() => getQualityCameraRows(cameras), [cameras]);

  /*
   * 載入目前 Rally
   * 的品質檢查結果。
   *
   * 這裡完全保留原本的
   * camera-grid 偵測。
   */
  useEffect(() => {
    if (matchId == null || !currentRally) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      setScanning(true);
      setScanError('');
      if (currentRally.end_frame - currentRally.start_frame > MAX_CAMERA_GRID_FRAMES) {
        setScanError('此 rally 超過 ' + MAX_CAMERA_GRID_FRAMES + ' frame，暫不支援品質檢查');
        setGrid([]);
        setLoadedRallyId(null);
        setScanning(false);
        return;
      }
      try {
        const points = await api.getTraj2DCameraGrid(matchId, currentRally.start_frame, currentRally.end_frame, useAppStore.getState().ball2DSource);
        if (cancelled) {
          return;
        }
        setGrid(points);
        setLoadedRallyId(currentRally.id);
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setScanError(error?.message || String(error));
          setGrid([]);
          setLoadedRallyId(null);
        }
      } finally {
        if (!cancelled) {
          setScanning(false);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [matchId, currentRally,
  // 切換原始 / 修正後時重新檢查
  ball2DSource, ball2DHistoryRevision]);

  /*
   * 影片面板存好一格 2D 標註修正：
   * 品質檢查逐格獨立，只重算那一格，
   * 不必整個 rally 重抓。
   */
  useEffect(() => {
    const tick = ball2DCorrectionTick;
    if (!tick || matchId == null || tick.matchId !== matchId || ball2DSource !== 'corrected' || !currentRally || tick.frame < currentRally.start_frame || tick.frame > currentRally.end_frame) {
      return;
    }
    const rallyId = currentRally.id;
    api.getTraj2DCameraGrid(matchId, tick.frame, tick.frame, 'corrected').then(rows => {
      if (useAppStore.getState().matchId !== matchId || currentRallyRef.current?.id !== rallyId) {
        return;
      }
      setGrid(previous => [...previous.filter(item => item.frame !== tick.frame), ...(rows || [])].sort((first, second) => first.frame - second.frame));
    }).catch(error => {
      console.warn('Quality grid frame refresh failed:', error);
    });
  }, [ball2DCorrectionTick]);

  /*
   * 換 Rally 時，
   * 重設顯示範圍。
   */
  useEffect(() => {
    setAutoRepairResult(null);
    if (!currentRally) {
      setZoom(null);
      return;
    }
    setZoom({
      start: currentRally.start_frame,
      len: Math.max(1, currentRally.end_frame - currentRally.start_frame + 1)
    });
  }, [currentRally?.id]);

  // 色塊以實際的回投像素誤差為準；原始 3D 經其他相機驗證時優先。
  // 儲存完整條目，滑鼠移動時也能顯示誤差來源與精確數值。
  const qualityByFrame = useMemo(() => {
    const byFrame = new Map();
    for (const point of grid) {
      byFrame.set(Number(point.frame), new Map((point.cameras || []).map(entry => [Number(entry.camera_index), entry])));
    }
    return byFrame;
  }, [grid]);
  const selectedTrackCamera = sortedCameras.some(camera => Number(camera.index) === trackCameraIndex) ? trackCameraIndex : Number(sortedCameras[0]?.index ?? 0);
  const trackPayloadSupported = grid.some(row => (row.cameras || []).some(camera => Object.prototype.hasOwnProperty.call(camera, 'track_observed_2d')));
  const trackRows = useMemo(() => show2DTrack ? buildBall2DTrackRows(grid, selectedTrackCamera) : [], [show2DTrack, grid, selectedTrackCamera]);
  const selectTrackCamera = cameraIndex => {
    setTrackCameraIndex(Number(cameraIndex));
    const camera = sortedCameras.find(item => Number(item.index) === Number(cameraIndex));
    if (camera) {
      setActiveCamera(camera.id);
      setSceneCameraTarget(camera.id);
    }
  };
  const xyzRows = useMemo(() => showXYZ && currentRally ? buildCourtXYZData(trajByFrame, grid, currentRally.start_frame, currentRally.end_frame) : [], [showXYZ, trajByFrame, grid, currentRally?.start_frame, currentRally?.end_frame]);
  const lowCoverageByFrame = useMemo(() => {
    const map = new Map();
    for (const point of grid) {
      map.set(Number(point.frame), Boolean(point.low_coverage));
    }
    return map;
  }, [grid]);

  // Warn explicitly when the backend has not been updated to return the
  // original-3D reprojection field. Otherwise "no field" looks like "no 3D".
  const missingProjectionApi = useMemo(() => grid.some(row => (row.cameras || []).some(entry => !Object.prototype.hasOwnProperty.call(entry, 'review_status'))), [grid]);
  const reviewCounts = useMemo(() => {
    let position = 0;
    let blue = 0;
    for (const row of grid) for (const cell of row.cameras || []) {
      if (cell.review_status === 'auto_fix' && cell.review_auto_allowed) position++;
      if (isBlueCell(cell)) blue++;
    }
    return { position, blue };
  }, [grid]);
  const dataReady = Boolean(currentRally && loadedRallyId === currentRally.id && !scanning);
  const rallyFrameCount = currentRally ? Math.max(1, currentRally.end_frame - currentRally.start_frame + 1) : 1;
  const isZoomed = Boolean(zoom && currentRally && zoom.len < rallyFrameCount - 0.5);
  const viewStartFrame = currentRally ? Math.max(currentRally.start_frame, Math.floor(zoom?.start ?? currentRally.start_frame)) : 0;
  const viewFrameCount = currentRally ? Math.max(1, Math.min(rallyFrameCount, Math.round(zoom?.len ?? rallyFrameCount))) : 1;
  const viewEndFrame = currentRally ? Math.min(currentRally.end_frame, viewStartFrame + viewFrameCount - 1) : 0;
  const rowCount = sortedCameras.length;
  const totalRows = rowCount;
  const rowHeight = size.height > 0 ? size.height / Math.max(1, totalRows) : ROW_HEIGHT_FALLBACK;
  const resetZoom = () => {
    if (!currentRally) {
      return;
    }
    setZoom({
      start: currentRally.start_frame,
      len: rallyFrameCount
    });
  };

  // 紅色已通過跨視角與擊球保護檢查。一次處理整份資料集並保留單步復原。
  const repairAllRed = async () => {
    if (hideBusyRef.current || autoRepairing || matchId == null) return;
    setAutoRepairing(true);
    setAutoRepairResult(null);
    setPlaying(false);
    try {
      const result = await api.repairDatasetRed2DLabels(matchId);
      if (useAppStore.getState().matchId !== matchId) return;
      if (useAppStore.getState().ball2DSource !== 'corrected') {
        useAppStore.getState().setBall2DSource('corrected');
      }
      if (result.repaired_points) useAppStore.getState().refreshAfter2DHistory();
      setAutoRepairResult({
        repairedFrames: result.repaired_frames,
        repairedPoints: result.repaired_points,
        affectedRallies: result.affected_rallies,
      });
    } catch (error) {
      const message = error?.message || String(error);
      setAutoRepairResult({ error: message === '"Not Found"' || message === 'Not Found'
        ? '後端沒有整場紅色修正路由（404）。請套用更新包並重新 build backend。'
        : message });
    } finally {
      setAutoRepairing(false);
    }
  };
  // 整份資料集所有 Rally 的藍格一次處理完；後端分批掃描，整批只記一個上一步。
  const hideAllBlue = async () => {
    if (hideBusyRef.current || autoRepairing || matchId == null) return;
    hideBusyRef.current = true;
    setHidingBlue(true);
    setHideHint('');
    setPlaying(false);
    try {
      const result = await api.hideDatasetBlue2DLabels(matchId);
      if (useAppStore.getState().matchId !== matchId) return;
      // 修正結果只會顯示在 corrected 來源，避免按完按鈕仍看見原始藍格。
      if (useAppStore.getState().ball2DSource !== 'corrected') {
        useAppStore.getState().setBall2DSource('corrected');
      }
      if (result.hidden_points) useAppStore.getState().refreshAfter2DHistory();
      setHideHint(result.hidden_points
        ? `已消除所有 Rally 的 ${result.hidden_points} 個藍色 2D（涉及 ${result.affected_rallies} 個 Rally，可按上一步復原）`
        : '這份資料集所有 Rally 都沒有可消除的藍色標註');
      setAutoRepairResult(null);
    } catch (error) {
      const message = error?.message || String(error);
      setHideHint(`藍色一鍵消除失敗：${message === '"Not Found"' || message === 'Not Found'
        ? '後端沒有整場藍色清除路由（404），請重新建置後端：docker compose up -d --build --force-recreate backend'
        : message}`);
      console.error(error);
    } finally {
      hideBusyRef.current = false;
      setHidingBlue(false);
    }
  };
  // 點藍色只改該幀；長按取「逐格連續」的藍色，不用總覽的缺幀合併。
  const hideBlueFrames = async (cameraIndex, frames) => {
    if (!frames.length || !dataReady || hideBusyRef.current || autoRepairing || matchId == null) return;
    hideBusyRef.current = true;
    setHidingBlue(true);
    setHideHint('');
    setPlaying(false);
    try {
      const result = await api.hideBlue2DLabels(matchId, cameraIndex, frames);
      if (useAppStore.getState().matchId !== matchId) return;
      useAppStore.getState().refreshAfter2DHistory();
      setHideHint(`已移除 Cam ${cameraIndex} 的 ${result.hidden_points} 個 2D 標註（僅修正層，可復原）`);
      setAutoRepairResult(null);

    } catch (error) {
      setHideHint(`移除失敗：${error?.message || String(error)}`);
      console.error(error);
    } finally {
      hideBusyRef.current = false;
      setHidingBlue(false);
    }
  };

  /*
   * 畫品質 Grid。
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || rowCount === 0 || !currentRally) {
      return;
    }
    const height = rowHeight * totalRows;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, size.width * scale);
    canvas.height = Math.max(1, height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const width = size.width;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, width, height);
    const startFrame = viewStartFrame;
    const endFrame = viewEndFrame;
    const pxPerFrame = width / viewFrameCount;
    const colorForCell = (cameraIndex, frame) => {
      if (!dataReady) return PROJECTION_ERROR_COLORS.missing;
      const entry = qualityByFrame.get(frame)?.get(cameraIndex);
      if (!showMissing && isMissingReview(entry)) return PROJECTION_ERROR_COLORS.normal;
      const display = qualityCellPresentation(entry, lowCoverageByFrame.get(frame));
      if (onlyRed && !display.isRed && !display.isPurple && !display.isBlue) return PROJECTION_ERROR_COLORS.normal;
      return display.color;
    };
    sortedCameras.forEach((camera, rowIndex) => {
      const cameraIndex = Number(camera.index);
      const rowTop = rowHeight * rowIndex;
      let camRunStartFrame = startFrame;
      let camRunColor = colorForCell(cameraIndex, startFrame);
      const flushRun = untilFrame => {
        const x = (camRunStartFrame - startFrame) * pxPerFrame;
        const rectWidth = Math.max(1, (untilFrame - camRunStartFrame) * pxPerFrame);
        ctx.fillStyle = camRunColor;
        ctx.fillRect(x, rowTop, rectWidth, rowHeight - 2);
      };
      for (let frame = startFrame + 1; frame <= endFrame + 1; frame += 1) {
        const color = frame <= endFrame ? colorForCell(cameraIndex, frame) : null;
        if (color !== camRunColor) {
          flushRun(frame);
          camRunStartFrame = frame;
          camRunColor = color;
        }
      }
    });
    ctx.strokeStyle = 'rgba(9,9,11,0.9)';
    ctx.lineWidth = 1;
    for (let rowIndex = 1; rowIndex < totalRows; rowIndex += 1) {
      const y = rowHeight * rowIndex;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }, [size.width, rowHeight, totalRows, sortedCameras, onlyRed, showMissing, qualityByFrame, lowCoverageByFrame, dataReady, currentRally, viewStartFrame, viewEndFrame, viewFrameCount, rowCount]);
  const cellAtPointer = (clientX, clientY) => {
    if (!currentRally) return null;
    const hit = qualityGridHit(clientX, clientY, canvasRef.current?.getBoundingClientRect(),
      sortedCameras.length, viewStartFrame, viewFrameCount);
    if (!hit) return null;
    const camera = sortedCameras[hit.rowIndex];
    const frame = hit.frame;
    const cameraIndex = Number(camera.index);
    return { frame, cameraIndex,
      blue: dataReady && isBlueCell(qualityByFrame.get(frame)?.get(cameraIndex)) };
  };
  const clearPress = () => {
    if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };
  useEffect(() => () => {
    if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
  }, []);
  const jumpToCanvasPoint = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas || !currentRally || sortedCameras.length === 0) {
      return;
    }
    const hit = qualityGridHit(clientX, clientY, canvas.getBoundingClientRect(),
      sortedCameras.length, viewStartFrame, viewFrameCount);
    if (!hit) return;
    const frame = hit.frame;
    const camera = sortedCameras[hit.rowIndex];
    setCurrentFrame(frame);
    if (camera) {
      setTrackCameraIndex(Number(camera.index));
      setActiveCamera(camera.id);
      setSceneCameraTarget(camera.id);
    }
  };
  const handlePointerDown = event => {
    if (event.button !== 0 || hideBusyRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const selected = cellAtPointer(event.clientX, event.clientY);
    draggingRef.current = true;
    jumpToCanvasPoint(event.clientX, event.clientY);
    clearPress();
    const press = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      selected, moved: false, held: false, timer: null,
    };
    pressRef.current = press;
    if (selected?.blue) {
      press.timer = setTimeout(() => {
        if (pressRef.current !== press || press.moved || hideBusyRef.current) return;
        press.held = true;
        suppressDoubleClickUntilRef.current = Date.now() + 850;
        const frames = findBlueRun(qualityByFrame, selected.cameraIndex,
          selected.frame, currentRally.start_frame, currentRally.end_frame);
        void hideBlueFrames(selected.cameraIndex, frames);
      }, BLUE_HOLD_MS);
    }
  };
  const handlePointerMove = event => {
    const hit = cellAtPointer(event.clientX, event.clientY);
    const entry = hit ? qualityByFrame.get(hit.frame)?.get(hit.cameraIndex) : null;
    const display = qualityCellPresentation(entry);
    event.currentTarget.title = hit && entry ?
      `Cam ${hit.cameraIndex} / Frame ${hit.frame}：${display.sourceLabel}；${
        display.errorPx === null ? '沒有有效投影誤差' : `誤差 ${display.errorPx.toFixed(1)} px`
      }；${hit.blue ? '雙擊移除單幀，長按 0.6 秒移除連續藍色區段' :
        display.autoAllowed ? '可自動處理' : '不自動改動'}；其他支持視角 ${entry.review_other_support_count ?? 0} 台` : '';
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > POINTER_MOVE_LIMIT) {
      press.moved = true;
      if (press.timer) clearTimeout(press.timer);
      press.timer = null;
    }
    // 長按成立後，放開滑鼠不再做第二次操作。
    if (draggingRef.current && press.moved && !press.held) {
      jumpToCanvasPoint(event.clientX, event.clientY);
    }
  };
  const stopDragging = event => {
    const press = pressRef.current;
    if (press && press.pointerId === event.pointerId) {
      clearPress();
    }
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  // 單擊只定位；雙擊才移除該格，避免調整時間軸時誤刪。
  const handleDoubleClick = event => {
    if (hideBusyRef.current || Date.now() < suppressDoubleClickUntilRef.current) return;
    const hit = cellAtPointer(event.clientX, event.clientY);
    if (hit?.blue) void hideBlueFrames(hit.cameraIndex, [hit.frame]);
  };
  const handleWheel = event => {
    if (!currentRally || !zoom) {
      return;
    }
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const ratioX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const rallyStart = currentRally.start_frame;
    const rallyEnd = currentRally.end_frame;
    const maxLen = rallyEnd - rallyStart + 1;
    setZoom(previous => {
      const cursorFrame = previous.start + ratioX * previous.len;
      if (event.shiftKey) {
        const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9;
        const nextLen = Math.min(maxLen, Math.max(MIN_ZOOM_FRAMES, previous.len * zoomFactor));
        let nextStart = cursorFrame - ratioX * nextLen;
        nextStart = Math.max(rallyStart, Math.min(nextStart, rallyEnd - nextLen + 1));
        return {
          start: nextStart,
          len: nextLen
        };
      }
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const panFrames = delta / Math.max(1, rect.width) * previous.len;
      let nextStart = previous.start + panFrames;
      nextStart = Math.max(rallyStart, Math.min(nextStart, rallyEnd - previous.len + 1));
      return {
        start: nextStart,
        len: previous.len
      };
    });
  };
  const goToRallyByIndex = targetIndex => {
    const sorted = [...rallies].sort((first, second) => first.start_frame - second.start_frame);
    if (sorted.length === 0) {
      return;
    }
    const index = Math.max(0, Math.min(sorted.length - 1, targetIndex));
    const rally = sorted[index];
    const startSec = rally.start_frame / fps;
    const endSec = rally.end_frame / fps;
    setSelectionRange(startSec, endSec);
    setCurrentTime(startSec);
    setActiveItem('rally', rally.id);
  };
  const goPrevRally = () => {
    const sorted = [...rallies].sort((first, second) => first.start_frame - second.start_frame);
    if (sorted.length === 0) {
      return;
    }
    if (activeItem?.type === 'rally') {
      const index = sorted.findIndex(rally => rally.id === activeItem.id);
      if (index > 0) {
        goToRallyByIndex(index - 1);
        return;
      }
    }
    let targetIndex = -1;
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      if (sorted[index].start_frame < currentFrame) {
        targetIndex = index;
        break;
      }
    }
    if (targetIndex === -1) {
      targetIndex = 0;
    }
    goToRallyByIndex(targetIndex);
  };
  const goNextRally = () => {
    const sorted = [...rallies].sort((first, second) => first.start_frame - second.start_frame);
    if (sorted.length === 0) {
      return;
    }
    if (activeItem?.type === 'rally') {
      const index = sorted.findIndex(rally => rally.id === activeItem.id);
      if (index !== -1 && index < sorted.length - 1) {
        goToRallyByIndex(index + 1);
        return;
      }
    }
    const targetIndex = sorted.findIndex(rally => rally.start_frame > currentFrame);
    goToRallyByIndex(targetIndex === -1 ? sorted.length - 1 : targetIndex);
  };
  return <div className="h-full w-full min-h-0 min-w-0 flex flex-col bg-zinc-950">
      <div className="min-h-[42px] py-2 flex-wrap shrink-0 pl-4 pr-[104px] flex items-center gap-3 border-b border-zinc-800 bg-zinc-950 shadow-sm z-20 min-w-0 overflow-hidden">
        <div className="flex bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden shrink-0">
          {[['timeline', 'TIMELINE'], ['quality2d', '品質檢查'], ['projection2d', '3D/2D 比對']].map(([id, label]) => <button key={id} type="button" onClick={() => setBottomView(id)} className={`
                  px-3
                  py-1
                  text-xs
                  font-bold
                  tracking-wider
                  transition-colors
                  ${bottomView === id ? 'bg-zinc-800 ' + 'text-zinc-100' : 'text-zinc-500 ' + 'hover:text-zinc-200 ' + 'hover:bg-zinc-800/70'}
                `}>
                {label}
              </button>)}
        </div>


        <div className="text-xs text-zinc-500 truncate min-w-0">
          {!currentRally ? '請先選擇或播放到一個 rally' : autoRepairing ? '正在處理全部 Rally 的紅色標註…' : scanning ? `掃描 Rally #${currentRally.rally_index} 中…` : scanError ? `掃描失敗：${scanError}` : `Rally #${currentRally.rally_index}：frame ${viewStartFrame}-${viewEndFrame} / 共 ${currentRally.start_frame}-${currentRally.end_frame}`}
        </div>


        {matchId != null && <button type="button" onClick={hideAllBlue}
          disabled={autoRepairing || hidingBlue || scanning}
          className="shrink-0 px-2 py-1 text-xs font-semibold rounded border border-sky-700 bg-sky-950/50 text-sky-300 disabled:opacity-40"
          title="一次消除目前資料集所有 Rally、全部相機的藍色標註。不跳確認視窗，整批可按一次上一步復原。">
          {hidingBlue ? '處理中…' : '🔵 全部 Rally 藍色一鍵消除'}
        </button>}
        {matchId != null && <button type="button" onClick={repairAllRed}
          disabled={autoRepairing || hidingBlue || scanning}
          className="shrink-0 px-2 py-1 text-xs font-semibold rounded border border-red-700 bg-red-950/50 text-red-300 disabled:opacity-40"
          title="一次修正所有 Rally、所有視角符合高可信條件的紅色標註。沒有確認視窗，整批一次上一步可還原。">
          {autoRepairing ? '修正中…' : '🔴 全部 Rally 紅色一鍵修正'}
        </button>}


        <button type="button" className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800" onClick={() => setShowGuide(value => !value)} aria-expanded={showGuide} aria-controls="quality-operation-guide">{showGuide ? '收起操作說明' : '操作說明 ?'}</button>
        <label className="shrink-0 flex items-center gap-1 text-xs text-red-300">
          <input type="checkbox" checked={onlyRed} onChange={event => setOnlyRed(event.target.checked)} />
          專注藍／紅／紫
        </label>

        <label className="shrink-0 flex items-center gap-1 text-xs text-zinc-300">
          <input type="checkbox" checked={showMissing} onChange={event => setShowMissing(event.target.checked)} />
          包含可能漏標
        </label>


        {currentRally && <button type="button" onClick={() => setShow2DTrack(value => !value)} aria-expanded={show2DTrack} className={`shrink-0 px-2 py-1 rounded border text-xs font-semibold ${show2DTrack ? 'border-sky-700 bg-sky-950/50 text-sky-300' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`} title="每台相機 2D X/Y 標註和原始 3D 投影的時間曲線；偵測連續偏離與疑似追蹤切換">
            2D 軌跡 {show2DTrack ? '收起' : '展開'}
          </button>}

        {currentRally && <button type="button" onClick={() => setShowXYZ(value => !value)} aria-expanded={showXYZ} className={`shrink-0 px-2 py-1 rounded border text-xs font-semibold ${showXYZ ? 'border-sky-700 bg-sky-950/50 text-sky-300' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`} title="展開原始 3D 與雙視角暫時 3D 的 X/Y/Z 曲線；標出位置跳動與兩者分歧的影格">
            XYZ 軌跡 {showXYZ ? '收起' : '展開'}
          </button>}

        {isZoomed && <button type="button" onClick={resetZoom} className="shrink-0 px-2 py-1 text-xs rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" title="
              回到完整 rally 範圍
            ">
            重置縮放
          </button>}


        <div className="ml-auto min-w-0 overflow-hidden shrink-0">
          <PlaybackUI goPrevRally={goPrevRally} goNextRally={goNextRally} />
        </div>
      </div>


      {showGuide && <div id="quality-operation-guide" className="shrink-0 border-b border-sky-900/60 bg-sky-950/20 px-4 py-2 text-xs text-sky-100 leading-5" role="note">
        <strong>品質檢查操作：</strong>單擊格子跳到對應影格；雙擊藍格移除單點；長按藍格處理連續區段。Shift + 滾輪縮放、滾輪平移。紅色／藍色全 Rally 按鈕會批次修改，若需還原請使用頂部「上一步」。切換「原始／修正後」可比對結果。
      </div>}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-2 p-3 bg-[#09090b] overflow-hidden">
        {!currentRally ? <div className="flex-1 flex items-center justify-center text-xs text-zinc-600">
                在 Timeline 點一個 Rally，
                或播放到 rally 內即可看到各視角的狀態
              </div> : <>
                <div className="flex-1 min-h-0 flex gap-2">
                  <div className="w-20 shrink-0 flex flex-col border border-zinc-800 rounded-l-md overflow-hidden bg-zinc-950">
                    {sortedCameras.map(camera => <div key={camera.id} className={`flex items-center px-2 text-[11px] border-b border-zinc-900 last:border-b-0 truncate ${useAppStore.getState().activeCameraId === camera.id ? 'bg-sky-950/70 text-sky-200' : 'text-zinc-400'}`} style={{
              height: rowHeight, minHeight: 0, flexShrink: 0, lineHeight: 1
            }}>
                          {`Cam ${Number(camera.index)}`}
                        </div>)}
                  </div>


                  <div ref={wrapRef} className="flex-1 min-w-0 relative border border-zinc-800 rounded-r-md overflow-hidden bg-zinc-950">
                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopDragging} onPointerCancel={stopDragging} onDoubleClick={handleDoubleClick} onContextMenu={event => event.preventDefault()} onWheel={handleWheel} style={{
              cursor: 'crosshair',
              touchAction: 'none'
            }} />
                    {currentFrame >= viewStartFrame && currentFrame <= viewEndFrame && <div aria-hidden="true" className="pointer-events-none absolute top-0 bottom-0 w-[2px] bg-sky-400/90" style={{ left: `${(currentFrame - viewStartFrame) / viewFrameCount * 100}%` }} />}
                  </div>
                </div>

                {show2DTrack && dataReady && !trackPayloadSupported && <div className="shrink-0 rounded border border-amber-700/70 px-3 py-2 text-xs text-amber-300">
                    2D 軌跡需要新版後端：camera-grid 尚未回傳 track_observed_2d。
                    請同時套用更新包的 backend，重新建置 Docker，然後刷新頁面。
                  </div>}

                {show2DTrack && trackPayloadSupported && <Ball2DTrackPanel rows={trackRows} cameras={sortedCameras} selectedCamera={selectedTrackCamera} onCameraChange={selectTrackCamera} startFrame={currentRally.start_frame} endFrame={currentRally.end_frame} currentFrame={currentFrame} onSeek={frame => {
          setPlaying(false);
          setCurrentFrame(frame);
        }} />}

                {showXYZ && <CourtXYZPanel rows={xyzRows} startFrame={currentRally.start_frame} endFrame={currentRally.end_frame} currentFrame={currentFrame} onSeek={frame => {
          setPlaying(false);
          setCurrentFrame(frame);
        }} />}

                {(missingProjectionApi || hideHint || autoRepairResult) && <div role="status" aria-live="polite" className="shrink-0 text-xs px-2 py-1 rounded bg-zinc-900 border border-zinc-800 flex gap-3 flex-wrap">
                  {missingProjectionApi && <span className="text-amber-300">後端版本不相容：camera-grid 缺少 review_status，請重新建置後端。</span>}
                  {hideHint && <span className="text-sky-300">{hideHint}</span>}
                  {autoRepairResult && <span className={autoRepairResult.error ? 'text-red-400' : 'text-emerald-400'}>
                    {autoRepairResult.error ? `自動修正失敗：${autoRepairResult.error}` :
                      `已修正 ${autoRepairResult.repairedFrames} 幀／${autoRepairResult.repairedPoints} 點` +
                      ''}
                  </span>}
                </div>}
              </>}
      </div>
    </div>;
}
