import React from 'react'


function formatPoint(point) {
  if (!point) return '沒有標註'
  if (Number(point.visibility) !== 1) return '看不見'
  return `(${Math.round(Number(point.x))}, ${Math.round(Number(point.y))})`
}


/**
 * 影片面板的 2D 標註修正。修正存在獨立的表，原始資料不會被改動；
 * 2D 來源切到「修正後」時，重建與品質檢查才會用到這些修正。
 *
 * 放在影片下方的一條工具列（不疊在影片上），窄的時候自動換行。
 */
export default function Ball2DCorrectionPanel({
  frame,
  original,
  correction,
  source,
  canClick,
  saving,
  error,
  advance,
  onAdvanceChange,
  correctionCount,
  onMarkHidden,
  onClear,
  onClose,
}) {
  const buttonClass = (
    'h-6 px-2 rounded border border-zinc-700 bg-zinc-900 text-zinc-200 '
    + 'hover:bg-zinc-800 transition-colors '
    + 'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900'
  )

  return (
    <div className="shrink-0 border-t border-amber-700/60 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <div
          className="flex items-center gap-2 shrink-0"
          title="在影片上點羽球的位置就會存成這一格的修正；原始資料不會被改動"
        >
          <span className="font-semibold text-amber-200">2D 修正</span>
          <span className="font-mono text-zinc-400">
            F
            {' '}
            {frame}
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono shrink-0">
          <span className="flex items-center gap-1.5 text-zinc-400" title="原始標註（影片上的灰圈）">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-zinc-400" />
            {formatPoint(original)}
          </span>
          <span className="text-zinc-600">→</span>
          <span
            className={`flex items-center gap-1.5 ${correction ? 'text-amber-200' : 'text-zinc-600'}`}
            title="修正後（影片上的琥珀色點）"
          >
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
            {correction ? formatPoint(correction) : '未修正'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onMarkHidden}
            disabled={saving}
            className={buttonClass}
            title="這格其實看不到球"
          >
            標成看不見
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={saving || !correction}
            className={buttonClass}
            title="刪掉這格的修正，回到原始標註"
          >
            清除修正
          </button>
        </div>

        <span className="shrink-0 text-zinc-400" title="這台相機已修正的格數">
          已修正
          {' '}
          <span className="font-semibold text-zinc-100">{correctionCount}</span>
          {' '}
          格
        </span>

        <label className="flex items-center gap-1.5 text-zinc-400 shrink-0" title="存好修正後自動跳到下一格">
          <input
            type="checkbox"
            checked={advance}
            onChange={event => onAdvanceChange(event.target.checked)}
            className="accent-amber-500"
          />
          自動下一格
        </label>

        {!canClick && (
          <span className="text-zinc-500">請先載入這台相機的影片才能點選</span>
        )}
        {source === 'original' && (
          <span className="text-amber-300/80" title="上方工具列的 2D 切到「修正後」，3D 重建與品質檢查才會用到修正">
            重建目前讀原始資料
          </span>
        )}
        {saving && <span className="text-zinc-400">儲存中…</span>}
        {error && <span className="text-rose-300">{error}</span>}

        <button
          type="button"
          onClick={onClose}
          className="ml-auto h-6 w-6 shrink-0 rounded text-zinc-500 hover:bg-zinc-800 hover:text-white"
          title="關閉 2D 標註修正"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
