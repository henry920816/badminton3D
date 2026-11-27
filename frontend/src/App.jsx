import React from 'react';
import { useAppStore } from './store.js';
import TopBar from './components/TopBar.jsx';
import Scene3D from './components/Scene3D.jsx';
import VideoPanel from './components/VideoPanel.jsx';
import TimelinePanel from './components/TimelinePanel.jsx';
import RightDock from './components/RightDock.jsx';
import RenderErrorBoundary from './components/RenderErrorBoundary.jsx';
import { usePanelLayout } from './hooks/usePanelLayout.js';
import { useMatchBootstrap } from './hooks/useMatchBootstrap.js';

// 品質檢查出錯時，不能讓整個主畫面跟著變白。
const Quality2DPanel = React.lazy(() => import('./components/Quality2DPanel.jsx'));
const ProjectionQualityPanel = React.lazy(() => import('./components/ProjectionQualityPanel.jsx'));
export default function App() {
  const matchId = useAppStore(state => state.matchId);
  const activeItem = useAppStore(state => state.activeItem);
  const bottomView = useAppStore(state => state.bottomView);
  const mainView = useAppStore(state => state.mainView);
  useMatchBootstrap(matchId);
  const {
    mainWrapRef,
    centerWrapRef,
    topAreaRef,
    topHeightPct,
    leftTopWidthPct,
    focusMode,
    setFocusMode,
    startResizeTopBottom,
    startResizeLeftRightTop,
    startResizeMainAndDock,
    bottomHeightPct,
    rightDockPx
  } = usePanelLayout();
  const showRightDock = Boolean(activeItem?.type);
  if (matchId == null) {
    return <div className="h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden">
        <TopBar />

        <div className="h-[calc(100vh-44px)] flex items-center justify-center p-6">
          <div className="max-w-lg rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
            <div className="text-lg font-semibold">
              目前沒有資料集
            </div>

            <div className="mt-2 text-sm text-zinc-400">
              請使用上方「上傳資料集」選擇各類資料夾，
              匯入完成後會自動開啟。
            </div>
          </div>
        </div>
      </div>;
  }
  return <div className="h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <TopBar />

      <div ref={mainWrapRef} className="flex h-[calc(100vh-44px)] min-h-0 w-full">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div ref={centerWrapRef} className="flex-1 min-h-0 flex flex-col">
            <div ref={topAreaRef} className="flex min-h-0 border-b border-zinc-800 relative" style={{
            height: focusMode ? '100%' : `${topHeightPct}%`,
            display: focusMode === 'bottom' ? 'none' : 'flex'
          }}>
              <div className="min-w-0 min-h-0 border-r border-zinc-800 relative" style={{
              width: focusMode === 'scene' ? '100%' : `${leftTopWidthPct}%`,
              display: focusMode === 'video' ? 'none' : 'block'
            }}>
                <div className="absolute z-10 top-2 left-2 flex items-center gap-2 text-xs font-semibold px-2 py-1 rounded bg-zinc-900/80 border border-zinc-800 backdrop-blur">
                  <span>3D 場景</span>
                  <button type="button" onClick={() => {
                  setFocusMode(focusMode === 'scene' ? null : 'scene');
                }} className="px-1.5 py-0.5 rounded text-[10px] text-zinc-300 hover:text-white hover:bg-zinc-700" title="放大 / 還原 3D 場景">
                    {focusMode === 'scene' ? '還原' : '專注'}
                  </button>
                </div>

                <Scene3D />
              </div>

              <div onMouseDown={startResizeLeftRightTop} className="w-[4px] shrink-0 cursor-col-resize bg-zinc-950 hover:bg-zinc-900 active:bg-zinc-800 transition-colors relative z-20" title="
                  拖拉調整 3D / 影片 寬度
                " style={{
              display: focusMode ? 'none' : 'block'
            }}>
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1px] bg-zinc-800" />
              </div>

              <div className="flex-1 min-w-0 min-h-0 relative" style={{
              display: focusMode === 'scene' ? 'none' : 'block'
            }}>
                <div className="absolute z-10 top-2 left-2 flex items-center gap-2 text-xs font-semibold px-2 py-1 rounded bg-zinc-900/80 border border-zinc-800 backdrop-blur">
                  <span>影片</span>
                  <button type="button" onClick={() => {
                  setFocusMode(focusMode === 'video' ? null : 'video');
                }} className="px-1.5 py-0.5 rounded text-[10px] text-zinc-300 hover:text-white hover:bg-zinc-700" title="放大 / 還原影片">
                    {focusMode === 'video' ? '還原' : '專注'}
                  </button>
                </div>

                <VideoPanel />
              </div>
            </div>

            <div onMouseDown={startResizeTopBottom} className="h-[4px] shrink-0 cursor-row-resize bg-zinc-950 hover:bg-zinc-900 active:bg-zinc-800 transition-colors relative z-20" title="
                拖拉調整 上方 / Timeline 高度
              " style={{
            display: focusMode ? 'none' : 'block'
          }}>
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-zinc-800" />
            </div>

            <div className="min-h-0 relative" style={{
            height: focusMode === 'bottom' ? '100%' : `${bottomHeightPct}%`,
            display: focusMode === 'scene' || focusMode === 'video' ? 'none' : 'block'
          }}>
              <button type="button" onClick={() => {
              setFocusMode(focusMode === 'bottom' ? null : 'bottom');
            }} className="absolute top-2 right-3 z-30 px-2 py-1 rounded border border-zinc-700 bg-zinc-900/85 hover:bg-zinc-800 text-[10px] text-zinc-300 hover:text-white backdrop-blur" title="放大 / 還原底部檢視">
                {focusMode === 'bottom' ? '還原版面' : '專注底部'}
              </button>
              {bottomView === 'projection2d' ? <React.Suspense fallback={<div className="p-5 text-sm text-zinc-300">正在載入 3D/2D 比對…</div>}><RenderErrorBoundary key="projection2d" onRecover={() => useAppStore.getState().setBottomView('timeline')}><ProjectionQualityPanel /></RenderErrorBoundary></React.Suspense> : bottomView === 'quality2d' ? <React.Suspense fallback={<div className="p-5 text-sm text-zinc-300">正在載入品質檢查…</div>}>
                  <RenderErrorBoundary key="quality2d" onRecover={() => useAppStore.getState().setBottomView('timeline')}>
                    <Quality2DPanel />
                  </RenderErrorBoundary>
                </React.Suspense> : <TimelinePanel />}
            </div>
          </div>
        </div>

        {showRightDock && !focusMode && <>
            <div onMouseDown={startResizeMainAndDock} className="w-[4px] shrink-0 cursor-col-resize bg-zinc-950 hover:bg-zinc-900 active:bg-zinc-800 transition-colors relative z-20" title="
                拖拉調整 主畫面 / 右側 Panel 寬度
              ">
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1px] bg-zinc-800" />
            </div>

            <div className="shrink-0 min-h-0" style={{
          width: rightDockPx
        }}>
              <RightDock />
            </div>
          </>}
      </div>
    </div>;
}
