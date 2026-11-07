import React from 'react'


function formatPoint(point) {
  if (!point) return '沒有標註'
  if (Number(point.visibility) !== 1) return '看不見'
  return `(${Math.round(Number(point.x))}, ${Math.round(Number(point.y))})`
}


// 參考視角在這格不能用的原因（ok 時不顯示）
const REFERENCE_STATUS_TEXT = {
  noParams: '沒有相機參數',
  none: '這格沒有標註',
  hidden: '這格標成看不見',
  loading: '載入中',
}


function formatError(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} px` : '—'
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
  referenceOptions = [],
  onToggleReference,
  guideSummary,
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
          <span className="text-zinc-400" title="原始標註">
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

      {referenceOptions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span
            className="shrink-0 text-zinc-400"
            title={
              '其他相機在這格有標註就畫出它的極線（白線，標著相機編號，羽球應該在線上），'
              + '幾條線的交會處就是和其他視角都合得來的位置。覺得哪台標錯就點掉它。'
              + '參考點是那台的修正值，沒修正就用原始標註'
            }
          >
            參考視角
          </span>

          <div className="flex flex-wrap items-center gap-1">
            {referenceOptions.map(option => {
              // 這格沒有可用的標註（看不見、沒標註、載入中）就不能當參考，
              // 不畫藍框、也不能點，免得看起來像有拿去算
              const unusable = option.status !== 'ok'
              const reason = REFERENCE_STATUS_TEXT[option.status]
              const used = option.selected && !unusable

              return (
                <button
                  key={option.cameraIndex}
                  type="button"
                  disabled={unusable}
                  onClick={() => onToggleReference(option.cameraIndex)}
                  title={
                    reason
                    || `${option.selected ? '點一下不用這台' : '點一下改用這台'}（${option.corrected ? '修正值' : '原始標註'}）`
                  }
                  className={[
                    'h-6 px-2 rounded border font-mono transition-colors',
                    'disabled:opacity-40 disabled:cursor-not-allowed disabled:line-through',
                    used
                      ? 'border-sky-500 bg-sky-500/15 text-sky-100'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:hover:bg-zinc-900',
                  ].join(' ')}
                >
                  {option.label}
                  {option.corrected && option.status === 'ok' && (
                    <span className="ml-1 text-amber-300">●</span>
                  )}
                </button>
              )
            })}
          </div>

          {guideSummary && (
            <span className="flex items-center gap-2.5 font-mono text-zinc-400 shrink-0">
              {guideSummary.referenceCount < 2 ? (
                <span title="只有一台參考時誤差沿著極線都是 0，羽球在白線上的某處">
                  沿白線找羽球
                </span>
              ) : (
                <span title="參考視角彼此之間的不一致；這台點得再準，誤差也不會低於這個值">
                  最低
                  {' '}
                  <span className="text-sky-200">{formatError(guideSummary.minimumError)}</span>
                </span>
              )}
              {guideSummary.correctionError != null && (
                <span title="這格的修正點和參考視角一起三角化的重投影誤差（RMS）">
                  修正點
                  {' '}
                  <span className="text-amber-200">{formatError(guideSummary.correctionError)}</span>
                </span>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
