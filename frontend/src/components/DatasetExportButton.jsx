import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAppStore } from '../store.js';

// 分類名稱和「新增資料集」一致；匯出時可只選其中幾類。
const CATEGORIES = [
  ['cameras', '相機參數', '原始 .npy；保持上傳檔名與矩陣格式。'],
  ['rally-data', 'Rally 與擊球標註', '原始 CSV；保留欄位、順序及檔名。'],
  ['ball', '球軌跡', '原始 .npy；不再用資料庫重建代替。'],
  ['ball-mask', '球軌跡 Mask', '原始 .npy；保留完整 Mask。'],
  ['ball-2d', '2D 羽球位置', '沿用原始 CSV 路徑、欄位，套入已儲存的 2D 修正。'],
  ['human-racket', '人體與球拍重建', '原始 .pth／.npz／gender.csv，格式不轉換。'],
];

export default function DatasetExportButton() {
  const matchId = useAppStore(state => state.matchId);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(['ball-2d']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sources, setSources] = useState(null);

  useEffect(() => {
    if (!open || matchId == null) return;
    let cancelled = false;
    api.getDatasetSourceStatus(matchId)
      .then(value => { if (!cancelled) setSources(value); })
      .catch(() => { if (!cancelled) setSources(null); });
    return () => { cancelled = true; };
  }, [open, matchId]);

  const toggle = category => {
    setSelected(previous => previous.includes(category)
      ? previous.filter(item => item !== category)
      : [...previous, category]);
  };

  const exportSelected = async () => {
    if (busy || matchId == null || selected.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(api.exportDatasetCategoriesUrl(matchId, selected));
      if (!response.ok) {
        const body = await response.text();
        let message = body;
        try { message = JSON.parse(body)?.detail || body; } catch { /* 後端可能回傳純文字 */ }
        throw new Error(`HTTP ${response.status}：${message}`);
      }
      const content = await response.blob();
      const blobUrl = URL.createObjectURL(content);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `badminton_dataset_${matchId}_same_as_input.zip`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      setOpen(false);
    } catch (reason) {
      setError(reason?.message || String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (matchId == null) return null;
  return <>
    <button type="button" onClick={() => { setOpen(true); setError(''); }}
      className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">
      Export Dataset
    </button>
    {open && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4">
      <div role="dialog" aria-modal="true" aria-label="匯出 Dataset" className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-5 shadow-2xl text-zinc-200">
        <div className="flex justify-between gap-3">
          <div>
            <h2 className="font-semibold">匯出 Dataset</h2>
            <p className="mt-1 text-xs text-zinc-400">勾選要匯出的資料類型。沿用原始上傳檔的名稱、格式與欄位；2D 會套用已儲存的修正。</p>
          </div>
          <button disabled={busy} type="button" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="mt-4 flex gap-2 text-xs">
          <button type="button" disabled={busy} onClick={() => setSelected(CATEGORIES.map(row => row[0]))}
            className="rounded border border-zinc-700 px-2 py-1">全選</button>
          <button type="button" disabled={busy} onClick={() => setSelected([])}
            className="rounded border border-zinc-700 px-2 py-1">清除選取</button>
        </div>
        {sources && !sources.has_originals && <p className="mt-3 rounded border border-amber-700 bg-amber-950/30 p-2 text-xs text-amber-300">
          這份資料集匯入時沒有保存原始檔。請到 Update Dataset 補傳原始檔，否則無法保證輸出和輸入相同。
        </p>}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {CATEGORIES.map(([key, title, note]) => <label key={key}
            className="flex cursor-pointer gap-2 rounded border border-zinc-800 bg-zinc-900/60 p-3">
            <input type="checkbox" className="mt-1" checked={selected.includes(key)}
              disabled={busy} onChange={() => toggle(key)} />
            <span className="min-w-0">
              <span className="block text-sm text-zinc-200">{title}</span>
              {sources && <span className={`ml-1 text-[11px] ${(sources.counts?.[key] || 0) ? 'text-emerald-400' : 'text-amber-400'}`}>
                （原始檔 {sources.counts?.[key] || 0} 個）
              </span>}
              <span className="block mt-1 text-xs leading-5 text-zinc-400">{note}</span>
            </span>
          </label>)}
        </div>
        <p className="mt-3 text-xs leading-5 text-amber-300">
          新版匯出直接使用保存的上傳原檔；原始檔不存在時會顯示原因，不會用資料庫推算資料冒充原格式。舊資料集可在 Update Dataset 補傳原檔。
        </p>
        {error && <p role="alert" className="mt-3 whitespace-pre-wrap rounded bg-red-950/50 p-2 text-xs text-red-300">{error}</p>}
        <div className="mt-3 text-xs text-zinc-400" role="status">已選擇 {selected.length} 類資料{sources ? '；沒有原始檔的類別可能無法匯出' : ''}。</div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setOpen(false)}
            className="rounded border border-zinc-700 px-3 py-2 text-xs">取消</button>
          <button type="button" disabled={busy || selected.length === 0} onClick={exportSelected}
            className="rounded bg-indigo-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
            {busy ? '正在打包…' : `匯出所選 ${selected.length} 類（ZIP）`}
          </button>
        </div>
      </div>
    </div>}
  </>;
}
