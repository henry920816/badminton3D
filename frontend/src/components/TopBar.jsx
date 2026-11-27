import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store.js';
import DatasetBrowser from './DatasetBrowser.jsx';
import DatasetUploadButton from './DatasetUploadButton.jsx';
import Dataset2DFileTools from './Dataset2DFileTools.jsx';
import DatasetExportButton from './DatasetExportButton.jsx';
import Edit2DHistoryControls from './Edit2DHistoryControls.jsx';
const SHORTCUTS = [['Space', '播放 / 暫停'], ['← / →', '逐幀移動；選取 Rally / Hit 時依情境操作'], ['0～9', '切換相機視角'], ['I / O', '設定選取範圍 In / Out'], ['Esc', '清除目前選取'], ['Shift + 拖曳', '在 Timeline 建立範圍'], ['Shift + N / P', '跳到下一個 / 上一個異常區段'], ['品質檢查單擊', '選取影格並定位到影片'], ['品質檢查雙擊藍格', '移除選取的錯誤 2D 標註'], ['品質檢查長按藍格', '操作連續藍色區段'], ['Shift + 滾輪', '縮放品質檢查時間範圍']];
export default function TopBar() {
  const matchId = useAppStore(state => state.matchId);
  const mainView = useAppStore(state => state.mainView);
  const setMainView = useAppStore(state => state.setMainView);
  const matchTitle = useAppStore(state => state.matchTitle);
  const currentTime = useAppStore(state => state.currentTime);
  const currentFrame = useAppStore(state => state.currentFrame);
  const fps = useAppStore(state => state.fps);
  const selection = useAppStore(state => state.selection);
  const playing = useAppStore(state => state.playing);
  const playbackRate = useAppStore(state => state.playbackRate);

  // 重建、品質檢查讀原始 2D 標註還是疊上修正後的版本
  const ball2DSource = useAppStore(state => state.ball2DSource);
  const setBall2DSource = useAppStore(state => state.setBall2DSource);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => {
    if (!helpOpen) return undefined;
    const closeOnEscape = event => {
      if (event.key === 'Escape') {
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [helpOpen]);
  const resetLayout = () => {
    window.dispatchEvent(new CustomEvent('badminton-reset-layout'));
  };
  const hasSelection = selection.inTime != null || selection.outTime != null;
  return <>
      <div className="min-h-[44px] px-3 py-1 flex items-center gap-2 border-b border-zinc-800 bg-zinc-950 min-w-0">
        <div className="shrink-0 font-semibold text-sm tracking-tight" title="Badminton 3D Debugger">
          Badminton 3D Debugger
        </div>

        <button type="button" onClick={() => {
        setBrowserOpen(true);
      }} title="切換或刪除資料集" className="min-w-0 max-w-[320px] truncate px-2.5 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-200">
          {matchId == null ? '尚未選擇資料集' : matchTitle || `資料集 ${matchId}`}
        </button>

        <div className="hidden xl:flex shrink-0 items-center gap-2">
        <DatasetUploadButton />
          <Dataset2DFileTools />
          <DatasetExportButton />
        </div>
        <button type="button" className="xl:hidden shrink-0 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs" onClick={() => setToolsOpen(value => !value)} aria-expanded={toolsOpen} aria-controls="dataset-tools" aria-label="展開資料集工具">資料工具 {toolsOpen ? '▴' : '▾'}</button>

        <DatasetBrowser open={browserOpen} onClose={() => {
        setBrowserOpen(false);
      }} />

        <div className="ml-auto flex items-center gap-2 min-w-0 text-xs overflow-x-auto ux-toolbar-scroll">
          {matchId != null && <>
              <div className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-800 bg-zinc-900/70 text-zinc-400 font-mono shrink-0">
                <span className={playing ? 'text-emerald-400' : 'text-zinc-500'}>
                  {playing ? '● PLAY' : '● PAUSE'}
                </span>

                <span className="text-zinc-700">|</span>

                <span>
                  F {currentFrame}
                </span>

                <span className="text-zinc-700">|</span>

                <span>
                  {currentTime.toFixed(3)}s
                </span>

                <span className="text-zinc-700">|</span>

                <span>
                  {playbackRate}x · {fps}fps
                </span>
              </div>

              {hasSelection && <div className="hidden 2xl:block px-2 py-1 rounded-md border border-cyan-900/60 bg-cyan-950/20 text-cyan-300 font-mono shrink-0">
                  IN {selection.inTime == null ? '-' : selection.inTime.toFixed(2)}
                  {' → '}
                  OUT {selection.outTime == null ? '-' : selection.outTime.toFixed(2)}
                </div>}
            </>}

          <Edit2DHistoryControls />
          <div className="hidden md:flex items-center rounded-md border border-zinc-800 bg-zinc-900 p-0.5 text-xs shrink-0" title="3D 重建、時間軸距離 / 速度、品質檢查與影片上的 2D 點，讀原始 2D 標註還是疊上 2D 標註修正（原始資料永遠不會被改動）">
            <span className="px-1.5 text-zinc-500">
              2D
            </span>
            {[['original', '原始'], ['corrected', '修正後']].map(([value, label]) => <button key={value} type="button" onClick={() => setBall2DSource(value)} className={`px-2 py-1 rounded ${ball2DSource === value ? value === 'corrected' ? 'bg-amber-600 text-white' : 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:text-zinc-100'}`}>
                {label}
              </button>)}
          </div>

          <button type="button" onClick={resetLayout} className="hidden md:inline-flex px-2 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 shrink-0" title="恢復預設版面比例並離開專注模式">
            重設版面
          </button>

          <button type="button" onClick={() => {
          setHelpOpen(true);
        }} className="px-2 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 shrink-0" title="查看快捷鍵">
            快捷鍵
          </button>


        </div>
      </div>

      {toolsOpen && <div id="dataset-tools" className="xl:hidden flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2">
        <DatasetUploadButton />
        <Dataset2DFileTools />
        <DatasetExportButton />
        <p className="basis-full text-xs text-zinc-400">更新既有資料、補傳原始檔，或選擇類型匯出備份。</p>
      </div>}
      {helpOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onMouseDown={event => {
      if (event.target === event.currentTarget) {
        setHelpOpen(false);
      }
    }}>
          <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl overflow-hidden">
            <div className="h-12 px-4 flex items-center justify-between border-b border-zinc-800">
              <div className="font-semibold">
                快捷鍵
              </div>

              <button type="button" onClick={() => {
            setHelpOpen(false);
          }} className="w-8 h-8 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white" aria-label="關閉快捷鍵說明">
                ×
              </button>
            </div>

            <div className="p-4 space-y-2">
              {SHORTCUTS.map(([keyName, description]) => <div key={keyName} className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/45 px-3 py-2">
                    <kbd className="min-w-[110px] rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-center text-xs font-mono text-zinc-200">
                      {keyName}
                    </kbd>

                    <div className="text-sm text-zinc-300">
                      {description}
                    </div>
                  </div>)}
            </div>
          </div>
        </div>}
    </>;
}
