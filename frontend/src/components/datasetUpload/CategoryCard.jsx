import React from 'react'

import { CATEGORY_CONFIG } from './uploadConfig.js'
import { MessageList } from './formParts.jsx'


function CategorySummary({
  category,
  data,
}) {
  if (!data) {
    return '尚未上傳'
  }

  if (category === 'cameras') {
    return (
      `${data.camera_count || 0} 台相機，`
      + `${data.file_count || 0} 個檔案`
    )
  }

  if (category === 'rally-data') {
    return (
      `${data.folder_count || 0} 個 Set，`
      + `${data.rally_file_count || 0} 個 Rally CSV，`
      + `${data.shot_file_count || 0} 個 Hit CSV，`
      + `${data.rally_row_count || 0} 個 Rally，`
      + `${data.shot_row_count || 0} 筆 Hit`
    )
  }

  if (category === 'human-racket') {
    return (
      `${data.competition_count || 0} 個比賽資料夾，`
      + `${data.motion_file_count || 0} 個動作檔，`
      + `${data.gender_file_count || 0} 個 gender.csv`
    )
  }

  if (category === 'ball-2d') {
    return (
      `${data.file_count || 0} 個 CSV，`
      + `${data.camera_count || 0} 個視角，`
      + `${data.row_count || 0} 筆座標，`
      + `${data.visible_count || 0} 筆可見`
    )
  }

  return (
    `${data.file_count || 0} 個 NPY，`
    + `${data.paired_count || 0} 組已配對`
  )
}


export function CategoryCard({
  category,
  data,
  uploading,
  progress,
  disabled,
  onChoose,
  onClear,
}) {
  const config = CATEGORY_CONFIG[
    category
  ]

  const fileCount = (
    data?.file_count
    || 0
  )

  const hasFiles = fileCount > 0

  let stateClass = (
    'border-zinc-700 '
    + 'bg-zinc-900/60'
  )

  let stateText = (
    config.required
      ? '必要資料'
      : '選填資料'
  )

  if (hasFiles && data?.valid) {
    stateClass = (
      'border-emerald-700 '
      + 'bg-emerald-950/20'
    )
    stateText = '✓ 已通過檢查'
  }

  if (hasFiles && !data?.valid) {
    stateClass = (
      'border-red-700 '
      + 'bg-red-950/20'
    )
    stateText = '✕ 需要修正'
  }

  return (
    <div
      className={`
        rounded-lg
        border
        p-4
        ${stateClass}
      `}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-semibold">
              {config.title}
            </div>

            <div
              className="
                rounded-full
                border
                border-zinc-700
                px-2
                py-0.5
                text-[11px]
                text-zinc-400
              "
            >
              {config.required
                ? '必要'
                : '選填'}
            </div>
          </div>

          <div
            className="
              mt-1
              text-xs
              leading-5
              text-zinc-400
            "
          >
            {config.description}
          </div>

          <div
            className="
              mt-2
              text-sm
              text-zinc-200
            "
          >
            {CategorySummary({
              category,
              data,
            })}
          </div>

          <div
            className={`
              mt-1
              text-xs
              ${
                hasFiles && !data?.valid
                  ? 'text-red-300'
                  : hasFiles
                    ? 'text-emerald-300'
                    : 'text-zinc-500'
              }
            `}
          >
            {stateText}
          </div>
        </div>

        <div
          className="
            flex
            shrink-0
            flex-col
            gap-2
          "
        >
          <button
            type="button"
            disabled={disabled}
            onClick={onChoose}
            className="
              rounded
              border
              border-indigo-500
              bg-indigo-600
              px-3
              py-2
              text-xs
              hover:bg-indigo-500
              disabled:opacity-40
            "
          >
            {uploading
              ? '正在上傳…'
              : config.buttonText}
          </button>

          {hasFiles && (
            <button
              type="button"
              disabled={disabled}
              onClick={onClear}
              className="
                rounded
                border
                border-zinc-700
                bg-zinc-950
                px-3
                py-2
                text-xs
                hover:bg-zinc-800
                disabled:opacity-40
              "
            >
              清除此類
            </button>
          )}
        </div>
      </div>

      {uploading && (
        <div className="mt-3">
          <div
            className="
              mb-1
              text-xs
              text-indigo-200
            "
          >
            上傳中 {progress}%
          </div>

          <div
            className="
              h-2
              overflow-hidden
              rounded
              bg-zinc-800
            "
          >
            <div
              className="
                h-full
                bg-indigo-500
                transition-all
              "
              style={{
                width: `${progress}%`,
              }}
            />
          </div>
        </div>
      )}

      {hasFiles && data?.items?.length > 0 && (
        <div
          className="
            mt-3
            max-h-32
            overflow-auto
            rounded
            border
            border-zinc-800
            bg-zinc-950/60
            p-2
          "
        >
          {data.items.map(
            (
              item,
              index,
            ) => (
              <div
                key={
                  item.id
                  || item.name
                  || `${category}-${index}`
                }
                className="
                  flex
                  items-center
                  gap-2
                  border-b
                  border-zinc-900
                  py-1
                  text-xs
                  last:border-b-0
                "
              >
                <span
                  className={
                    item.valid
                      ? 'text-emerald-300'
                      : 'text-red-300'
                  }
                >
                  {item.valid
                    ? '✓'
                    : '✕'}
                </span>

                <span
                  className="
                    min-w-0
                    flex-1
                    truncate
                  "
                  title={
                    item.relative_path
                    || item.name
                  }
                >
                  {category === 'cameras'
                    ? `Cam ${item.index}`
                    : item.name}
                </span>

                {category === 'rally-data' && (
                  <span className="text-zinc-500">
                    Rally {item.rally_row_count || 0}
                    {' / '}
                    Hit {item.shot_row_count || 0}
                  </span>
                )}

                {category === 'human-racket' && (
                  <span className="whitespace-nowrap text-zinc-500">
                    {item.gender || 'neutral'}
                    {' · '}
                    {item.paired_count || 0} 組完整
                    {' · '}
                    {item.unpaired_count || 0} 組缺檔
                  </span>
                )}

                {category !== 'rally-data'
                  && category !== 'human-racket'
                  && Number.isFinite(
                    item.row_count,
                  )
                  && (
                    <span className="text-zinc-500">
                      {item.row_count} 筆
                    </span>
                  )}

                {item.shape && (
                  <span className="text-zinc-500">
                    ({item.shape.join(', ')})
                  </span>
                )}
              </div>
            ),
          )}
        </div>
      )}

      <MessageList
        title="此類型錯誤"
        items={data?.errors}
        tone="error"
      />

      <MessageList
        title="此類型提醒"
        items={data?.warnings}
        tone="warning"
      />
    </div>
  )
}
