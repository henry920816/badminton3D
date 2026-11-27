import { useEffect, useRef, useState } from 'react';

// 版面拖曳、記住寬高、專注模式放同一處，App 只負責排版。
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
const LAYOUT_STORAGE_KEY = 'badminton-ui-layout-v1';
const DEFAULT_LAYOUT = {
  topHeightPct: 58,
  leftTopWidthPct: 50,
  rightPanelWidth: 360
};
function readSavedLayout() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) || '{}');
    return {
      topHeightPct: clamp(Number(saved.topHeightPct) || DEFAULT_LAYOUT.topHeightPct, 42, 72),
      leftTopWidthPct: clamp(Number(saved.leftTopWidthPct) || DEFAULT_LAYOUT.leftTopWidthPct, 20, 80),
      rightPanelWidth: clamp(Number(saved.rightPanelWidth) || DEFAULT_LAYOUT.rightPanelWidth, 260, 700)
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}
export function usePanelLayout() {
  const mainWrapRef = useRef(null);
  const centerWrapRef = useRef(null);
  const topAreaRef = useRef(null);
  const savedLayoutRef = useRef(readSavedLayout());
  const [topHeightPct, setTopHeightPct] = useState(savedLayoutRef.current.topHeightPct);
  const [leftTopWidthPct, setLeftTopWidthPct] = useState(savedLayoutRef.current.leftTopWidthPct);
  const [rightPanelWidth, setRightPanelWidth] = useState(savedLayoutRef.current.rightPanelWidth);
  const [focusMode, setFocusMode] = useState(null);
  useEffect(() => {
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({
        topHeightPct,
        leftTopWidthPct,
        rightPanelWidth
      }));
    } catch {
      // 瀏覽器不允許儲存時，這次操作仍可調整版面。
    }
  }, [topHeightPct, leftTopWidthPct, rightPanelWidth]);
  useEffect(() => {
    const resetLayout = () => {
      setTopHeightPct(DEFAULT_LAYOUT.topHeightPct);
      setLeftTopWidthPct(DEFAULT_LAYOUT.leftTopWidthPct);
      setRightPanelWidth(DEFAULT_LAYOUT.rightPanelWidth);
      setFocusMode(null);
    };
    window.addEventListener('badminton-reset-layout', resetLayout);
    return () => {
      window.removeEventListener('badminton-reset-layout', resetLayout);
    };
  }, []);
  const startResizeTopBottom = event => {
    event.preventDefault();
    const wrap = centerWrapRef.current;
    if (!wrap) {
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const onMove = moveEvent => {
      const y = moveEvent.clientY - rect.top;
      const percentage = y / rect.height * 100;
      setTopHeightPct(clamp(percentage, 42, 72));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const startResizeLeftRightTop = event => {
    event.preventDefault();
    const wrap = topAreaRef.current;
    if (!wrap) {
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const onMove = moveEvent => {
      const x = moveEvent.clientX - rect.left;
      const percentage = x / rect.width * 100;
      setLeftTopWidthPct(clamp(percentage, 20, 80));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const startResizeMainAndDock = event => {
    event.preventDefault();
    const wrap = mainWrapRef.current;
    if (!wrap) {
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const onMove = moveEvent => {
      const nextWidth = rect.right - moveEvent.clientX;
      setRightPanelWidth(clamp(nextWidth, 260, 700));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const bottomHeightPct = 100 - topHeightPct;
  const rightDockPx = `${rightPanelWidth}px`;
  return {
    mainWrapRef,
    centerWrapRef,
    topAreaRef,
    topHeightPct,
    leftTopWidthPct,
    rightPanelWidth,
    focusMode,
    setFocusMode,
    startResizeTopBottom,
    startResizeLeftRightTop,
    startResizeMainAndDock,
    bottomHeightPct,
    rightDockPx
  };
}
