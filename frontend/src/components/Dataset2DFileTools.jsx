import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { useAppStore } from '../store.js';

function formatError(error) {
  try {
    const parsed = JSON.parse(error?.message || '');
    return typeof parsed === 'string' ? parsed : (parsed.message || parsed.detail || error.message);
  } catch {
    return error?.message || String(error);
  }
}

// 僅更新 2D 羽球 CSV；原本的 Rally、3D 與相機參數不會被覆蓋。
export default function Dataset2DFileTools() {
  const matchId = useAppStore(state => state.matchId);
  const refreshAfter2DHistory = useAppStore(state => state.refreshAfter2DHistory);
  const fileRef = useRef(null);
  const originalFileRef = useRef(null);
  const originalFolderRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [sourceCategory, setSourceCategory] = useState('rally-data');
  const [originalFiles, setOriginalFiles] = useState([]);
  const [sourceMessage, setSourceMessage] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [sourceProgress, setSourceProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const totalMb = files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024;
  const invalidFileNames = files.filter(file => !file.name.toLowerCase().endsWith('.csv'));
  const invalidSelection = files.length > 300 || totalMb > 256 || invalidFileNames.length > 0;

  const upload = async () => {
    if (matchId == null || !files.length || busy || invalidSelection) return;
    setBusy(true);
    setProgress(0);
    setError('');
    setMessage('');
    try {
      const result = await api.replaceDataset2DFiles(matchId, files, setProgress);
      if (useAppStore.getState().matchId === matchId) {
        for (const cameraIndex of result.camera_indices || []) {
          useAppStore.getState().setCameraHasBall2D(cameraIndex, true);
        }
        refreshAfter2DHistory();
      }
      setMessage(`已更新 ${result.replaced_files} 個 CSV、${result.imported_rows} 筆原始 2D。其他資料類型不變；若原始座標有變動，相關舊人工修正可能失效，請重新檢視。${result.source_warning || ''}`);
      setFiles([]);
      if (fileRef.current) fileRef.current.value = '';
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  const backupOriginalFiles = async () => {
    if (busy || !originalFiles.length || matchId == null) return;
    setBusy(true);
    setSourceProgress(0);
    setSourceError('');
    setSourceMessage('');
    try {
      const result = await api.uploadDatasetOriginals(matchId, sourceCategory,
        originalFiles, setSourceProgress);
      setSourceMessage(`${result.saved_files} 個原始檔已保存，可用於 Export Dataset。`);
      setOriginalFiles([]);
      if (originalFileRef.current) originalFileRef.current.value = '';
      if (originalFolderRef.current) originalFolderRef.current.value = '';
    } catch (error) {
      setSourceError(formatError(error));
    } finally {
      setBusy(false);
    }
  };

  if (matchId == null) return null;
  return <>
    <button type="button" onClick={() => { setOpen(true); setError(''); setMessage(''); }}
      className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
      title="更新目前資料集的 2D 標註 CSV，可一次選取多個檔案">
      Update Dataset
    </button>
    {open && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4">
      <div role="dialog" aria-modal="true" aria-label="更新現有資料集" className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-5 shadow-2xl text-zinc-200">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Update Dataset｜更新現有資料集</h2>
          <button type="button" disabled={busy} onClick={() => setOpen(false)} className="text-zinc-400 hover:text-white">✕</button>
        </div>
        <div className="mt-5 border-t border-zinc-800 pt-4 font-semibold text-sm">部分重傳／修正 2D CSV</div>
        <p className="mt-3 text-xs leading-6 text-zinc-400">
          目前既有資料集的部分檔案更新支援 2D CSV。一次可選多個 *_ball.csv。依檔名中的 Rally、起訖 Frame 與 View 對應到現有資料集；
          只替換那些 Rally／相機的「原始 2D」，其他 Rally、相機、3D 與影片不受影響。
          既有人工修正歷史會保留，但若原始座標已變動，受影響的舊修正將不再套用，需人工確認。
          注意：重傳會整段取代該 Rally／Cam 的原始 CSV；新檔缺少的 Frame 也會被移除。建議先使用 Export Dataset 匯出 2D 備份。
        </p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" multiple disabled={busy}
          onChange={event => { setFiles(Array.from(event.target.files || [])); setError(''); setMessage(''); }}
          className="mt-4 w-full text-xs text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-indigo-700 file:px-3 file:py-2 file:text-white" />
        <div className="mt-2 text-xs text-zinc-400">已選 {files.length} 個檔案（{totalMb.toFixed(1)} MB），上限 300 個、總計 256 MB。</div>
        {invalidSelection && <p role="alert" className="mt-2 rounded border border-red-800 bg-red-950/40 p-2 text-xs text-red-300">檔案選取不符合限制：只能選 CSV、最多 300 個、總計不超過 256 MB。請重新選取。</p>}
        {files.length > 0 && <div className="mt-3 max-h-32 overflow-y-auto rounded bg-zinc-900 p-2 text-xs text-zinc-400">
          {files.map((file, index) => <div key={`${index}-${file.name}`}>{file.name}</div>)}
        </div>}
        {busy && <div className="mt-3" role="status"><div className="text-xs text-indigo-300">上傳中 {progress}%</div><progress className="mt-1 w-full" value={progress} max="100">{progress}%</progress></div>}
        {error && <div role="alert" className="mt-3 whitespace-pre-wrap rounded bg-red-950/40 p-2 text-xs text-red-300">{error}</div>}
        {message && <div role="status" className="mt-3 rounded bg-emerald-950/40 p-2 text-xs text-emerald-300">{message}</div>}
        <div className="mt-6 border-t border-zinc-700 pt-4">
          <h3 className="text-sm font-semibold">補回原始檔（供相同格式匯出）</h3>
          <p className="mt-2 text-xs leading-5 text-zinc-400">
            舊資料集匯入時沒有保存原始檔，無法從資料庫還原原本的 PTH、NPY 和 CSV 全部欄位。
            可在這裡重新提供原始檔；只保存供 Export Dataset 使用，不會更動目前正在使用的 3D、相機參數或擊球資料。
            2D CSV 請使用上面的「部分重傳／修正 2D CSV」，可同步更新資料庫。
            若要完整匯出某類，請補齊該類所有原始檔，而不只是一部分。
          </p>
          <select value={sourceCategory} disabled={busy}
            onChange={event => { setSourceCategory(event.target.value); setOriginalFiles([]); setSourceError(''); }}
            className="mt-3 rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs">
            <option value="cameras">相機參數（NPY）</option>
            <option value="rally-data">Rally 與擊球標註（CSV）</option>
            <option value="ball">球軌跡（NPY）</option>
            <option value="ball-mask">球軌跡 Mask（NPY）</option>
            <option value="human-racket">人體與球拍（PTH／NPZ／CSV）</option>
          </select>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="cursor-pointer rounded border border-zinc-600 px-2 py-2 text-xs">
              選擇多個檔案
              <input ref={originalFileRef} type="file" multiple disabled={busy} className="hidden"
                onChange={event => setOriginalFiles(Array.from(event.target.files || []))} />
            </label>
            <label className="cursor-pointer rounded border border-zinc-600 px-2 py-2 text-xs">
              選擇資料夾（保留路徑）
              <input ref={originalFolderRef} type="file" multiple webkitdirectory="" directory=""
                disabled={busy} className="hidden"
                onChange={event => setOriginalFiles(Array.from(event.target.files || []))} />
            </label>
          </div>
          <div className="mt-2 text-xs text-zinc-400">已選擇 {originalFiles.length} 個來源檔案（每次最多 400 個、512 MB）</div>
          {busy && sourceProgress > 0 && <div className="mt-2 text-xs text-indigo-300">補傳進度 {sourceProgress}%</div>}
          {sourceError && <div className="mt-2 rounded bg-red-950/50 p-2 text-xs text-red-300">{sourceError}</div>}
          {sourceMessage && <div className="mt-2 rounded bg-emerald-950/40 p-2 text-xs text-emerald-300">{sourceMessage}</div>}
          <button disabled={busy || !originalFiles.length} onClick={backupOriginalFiles} type="button"
            className="mt-3 rounded bg-indigo-700 px-3 py-2 text-xs text-white disabled:opacity-40">
            {busy ? '處理中…' : '保存這批原始檔'}
          </button>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setOpen(false)}
            className="rounded border border-zinc-700 px-3 py-2 text-xs">關閉</button>
          <button type="button" disabled={busy || !files.length || invalidSelection} onClick={upload}
            className="rounded bg-indigo-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
            {busy ? '上傳中…' : `更新選取的 ${files.length} 個檔案`}
          </button>
        </div>
      </div>
    </div>}
  </>;
}
