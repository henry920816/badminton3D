import React, {
  useEffect,
  useRef,
  useState,
} from 'react'

import { api } from '../api.js'
import { useAppStore } from '../store.js'

import {
  CATEGORY_CONFIG,
  DEFAULT_SETTINGS,
  cameraDefaults,
  errorText,
  filteredCategoryFiles,
  formatBytes,
  numberValue,
  splitUploadBatches,
} from './datasetUpload/uploadConfig.js'
import { Field, MessageList } from './datasetUpload/formParts.jsx'
import { CategoryCard } from './datasetUpload/CategoryCard.jsx'


export default function DatasetUploadButton() {
  const inputRefs = useRef({})
  const sessionTokenRef = useRef(null)
  const requestVersionRef = useRef(0)

  const setMatchId = useAppStore(
    state => state.setMatchId,
  )

  const setCurrentFrame = useAppStore(
    state => state.setCurrentFrame,
  )

  const setPlaying = useAppStore(
    state => state.setPlaying,
  )

  const clearSelection = useAppStore(
    state => state.clearSelection,
  )

  const clearTrajSelection = useAppStore(
    state => state.clearTrajSelection,
  )

  const resetTrajCache = useAppStore(
    state => state.resetTrajCache,
  )

  const setTimelineData = useAppStore(
    state => state.setTimelineData,
  )

  const [
    open,
    setOpen,
  ] = useState(false)

  const [
    session,
    setSession,
  ] = useState(null)

  const [
    settings,
    setSettings,
  ] = useState(DEFAULT_SETTINGS)

  const [
    status,
    setStatus,
  ] = useState('idle')

  const [
    busyCategory,
    setBusyCategory,
  ] = useState(null)

  const [
    progress,
    setProgress,
  ] = useState({})

  const [
    error,
    setError,
  ] = useState('')

  const [
    result,
    setResult,
  ] = useState(null)

  const [
    advanced,
    setAdvanced,
  ] = useState(false)

  const busy = (
    status === 'creating'
    || status === 'finalizing'
    || Boolean(busyCategory)
  )

  const categories = (
    session?.categories
    || {}
  )

  const cameras = (
    Array.isArray(
      categories.cameras?.items,
    )
      ? categories.cameras.items
      : []
  )

  const reconstructionCandidates = (
    Array.isArray(
      categories['human-racket']?.items,
    )
      ? categories['human-racket'].items
      : []
  )

  const discardSession = token => {
    if (!token) {
      return
    }

    api
      .deleteDatasetUploadSession(token)
      .catch(() => {})
  }

  const clearSessionReference = () => {
    sessionTokenRef.current = null
  }

  useEffect(
    () => (
      () => {
        requestVersionRef.current += 1

        discardSession(
          sessionTokenRef.current,
        )

        clearSessionReference()
      }
    ),
    [],
  )

  const resetDialogState = () => {
    setSession(null)
    setSettings(DEFAULT_SETTINGS)
    setStatus('idle')
    setBusyCategory(null)
    setProgress({})
    setError('')
    setResult(null)
    setAdvanced(false)
  }

  const mergeCameraSettings = data => {
    const nextCameras = (
      data?.categories
        ?.cameras
        ?.items
      || []
    )

    setSettings(previous => {
      const defaults = cameraDefaults(
        nextCameras,
        previous.fps,
      )

      return {
        ...previous,
        cameraSettings: {
          ...defaults,
          ...previous.cameraSettings,
        },
      }
    })
  }

  const mergeReconstructionSettings = data => {
    const category = data?.categories?.['human-racket']
    const items = Array.isArray(category?.items)
      ? category.items
      : []
    const available = new Set(
      items.map(item => item.competition),
    )
    const recommended = (
      category?.recommended_competition
      || (items.length === 1
        ? items[0].competition
        : '')
    )

    setSettings(previous => {
      const current = previous.reconstructionCompetition
      if (current && available.has(current)) {
        return previous
      }

      return {
        ...previous,
        reconstructionCompetition: recommended,
      }
    })
  }

  const applySession = data => {
    setSession(data)
    mergeCameraSettings(data)
    mergeReconstructionSettings(data)
  }

  const createSession = async () => {
    requestVersionRef.current += 1

    const version = (
      requestVersionRef.current
    )

    setStatus('creating')
    setError('')

    try {
      const data = (
        await api
          .createDatasetUploadSession()
      )

      if (
        version
        !== requestVersionRef.current
      ) {
        discardSession(
          data?.session_token,
        )
        return
      }

      sessionTokenRef.current = (
        data.session_token
      )

      applySession(data)
      setStatus('ready')

    } catch (createError) {
      if (
        version
        !== requestVersionRef.current
      ) {
        return
      }

      setStatus('error')
      setError(
        errorText(createError),
      )
    }
  }

  const openDialog = () => {
    discardSession(
      sessionTokenRef.current,
    )

    clearSessionReference()
    resetDialogState()
    setOpen(true)
    createSession()
  }

  const closeDialog = () => {
    if (busy) {
      return
    }

    requestVersionRef.current += 1

    discardSession(
      sessionTokenRef.current,
    )

    clearSessionReference()
    setOpen(false)
  }

  const chooseCategory = category => {
    if (busy) {
      return
    }

    inputRefs.current[
      category
    ]?.click()
  }

  const uploadCategory = async (
    category,
    fileList,
  ) => {
    const files = filteredCategoryFiles(
      category,
      fileList,
    )

    if (!files.length) {
      setError(
        `${CATEGORY_CONFIG[category]?.title || '此類型'}資料夾中沒有可上傳的檔案`,
      )

      return
    }

    const token = (
      sessionTokenRef.current
    )

    if (!token) {
      setError(
        '上傳工作階段尚未建立完成',
      )
      return
    }

    setBusyCategory(category)
    setError('')
    setProgress(previous => ({
      ...previous,
      [category]: 0,
    }))

    try {
      const batches = splitUploadBatches(files)
      const totalBytes = files.reduce(
        (sum, file) => sum + Number(file?.size || 0),
        0,
      )
      let completedBytes = 0
      let data = null

      for (const batch of batches) {
        const batchBytes = batch.reduce(
          (sum, file) => sum + Number(file?.size || 0),
          0,
        )

        data = await api.uploadDatasetCategory(
          token,
          category,
          batch,
          value => {
            const uploadedInBatch = batchBytes * value / 100
            const aggregate = totalBytes > 0
              ? Math.round((completedBytes + uploadedInBatch) / totalBytes * 100)
              : Math.round((batches.indexOf(batch) + value / 100) / batches.length * 100)

            setProgress(previous => ({
              ...previous,
              [category]: Math.min(99, aggregate),
            }))
          },
        )

        completedBytes += batchBytes
        applySession(data)
      }

      if (data) {
        applySession(data)
      }

      setProgress(previous => ({
        ...previous,
        [category]: 100,
      }))

    } catch (uploadError) {
      setError(
        errorText(uploadError),
      )

    } finally {
      setBusyCategory(null)
    }
  }

  const clearCategory = async category => {
    const token = (
      sessionTokenRef.current
    )

    if (
      !token
      || busy
    ) {
      return
    }

    setBusyCategory(category)
    setError('')

    try {
      const data = (
        await api.clearDatasetCategory(
          token,
          category,
        )
      )

      applySession(data)

      if (category === 'cameras') {
        setSettings(previous => ({
          ...previous,
          cameraSettings: {},
        }))
      }

      if (category === 'human-racket') {
        setSettings(previous => ({
          ...previous,
          reconstructionCompetition: '',
        }))
      }

    } catch (clearError) {
      setError(
        errorText(clearError),
      )

    } finally {
      setBusyCategory(null)
    }
  }

  const setValue = (
    key,
    value,
  ) => {
    setSettings(previous => ({
      ...previous,
      [key]: value,
    }))
  }

  const setCourtValue = (
    key,
    value,
  ) => {
    setSettings(previous => ({
      ...previous,

      courtWorldTransform: {
        ...previous
          .courtWorldTransform,
        [key]: value,
      },
    }))
  }

  const setCameraValue = (
    cameraId,
    key,
    value,
  ) => {
    setSettings(previous => ({
      ...previous,

      cameraSettings: {
        ...previous.cameraSettings,

        [cameraId]: {
          ...previous
            .cameraSettings[
              cameraId
            ],
          [key]: value,
        },
      },
    }))
  }

  const changeGlobalFps = value => {
    setSettings(previous => ({
      ...previous,
      fps: value,

      cameraSettings: (
        Object.fromEntries(
          Object.entries(
            previous.cameraSettings,
          ).map(
            (
              [
                cameraId,
                camera,
              ],
            ) => [
              cameraId,
              {
                ...camera,
                fps: value,
              },
            ],
          ),
        )
      ),
    }))
  }

  const validateSettings = () => {
    const fps = Number(
      settings.fps
    )
    const width = Number(
      settings.imageWidth
    )
    const height = Number(
      settings.imageHeight
    )

    if (
      !Number.isFinite(fps)
      || fps <= 0
    ) {
      return 'FPS 必須大於 0'
    }

    if (
      !Number.isInteger(width)
      || width <= 0
    ) {
      return (
        '影片寬度必須是'
        + '大於 0 的整數'
      )
    }

    if (
      !Number.isInteger(height)
      || height <= 0
    ) {
      return (
        '影片高度必須是'
        + '大於 0 的整數'
      )
    }

    if (
      reconstructionCandidates.length > 1
      && !settings.reconstructionCompetition
    ) {
      return '請選擇正確的人體與球拍比賽代碼'
    }

    return ''
  }

  const finalizeDataset = async () => {
    const token = (
      sessionTokenRef.current
    )

    if (
      !token
      || !session?.can_finalize
      || busy
    ) {
      return
    }

    const validationError = (
      validateSettings()
    )

    if (validationError) {
      setError(validationError)
      return
    }

    const normalizedSettings = {
      ...settings,
      title: String(
        settings.title
        || '',
      ).trim(),
      fps: Number(settings.fps),
      imageWidth: Number(
        settings.imageWidth
      ),
      imageHeight: Number(
        settings.imageHeight
      ),

      courtWorldTransform: (
        Object.fromEntries(
          Object.entries(
            settings
              .courtWorldTransform,
          ).map(
            (
              [key, value],
            ) => [
              key,
              numberValue(value),
            ],
          ),
        )
      ),

      cameraSettings: (
        Object.fromEntries(
          Object.entries(
            settings.cameraSettings,
          ).map(
            (
              [
                cameraId,
                camera,
              ],
            ) => [
              cameraId,
              {
                ...camera,
                fps: Number(
                  camera.fps
                  || settings.fps,
                ),
                offsetFrame: numberValue(
                  camera.offsetFrame,
                ),
                uOffset: numberValue(
                  camera.uOffset,
                ),
                vOffset: numberValue(
                  camera.vOffset,
                ),
              },
            ],
          ),
        )
      ),
    }

    setStatus('finalizing')
    setError('')
    setResult(null)

    try {
      const data = (
        await api
          .finalizeDatasetUploadSession(
            token,
            normalizedSettings,
          )
      )

      clearSessionReference()
      setPlaying(false)
      clearSelection()
      clearTrajSelection()
      resetTrajCache()

      setTimelineData({
        rallies: [],
        hits: [],
        anomalies: [],
      })

      setCurrentFrame(0)
      setMatchId(data.match_id)
      setResult(data)
      setStatus('success')

    } catch (finalizeError) {
      setStatus('ready')
      setError(
        errorText(finalizeError),
      )
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="
          px-2
          py-1
          rounded
          bg-zinc-900
          hover:bg-zinc-800
          border
          border-zinc-700
          text-xs
          text-zinc-200
        "
      >
        新增資料集
      </button>

      {open && (
        <div
          className="
            fixed
            inset-0
            z-[100]
            flex
            items-center
            justify-center
            bg-black/70
            p-4
          "
        >
          <div
            className="
              max-h-[95vh]
              w-full
              max-w-6xl
              overflow-auto
              rounded-lg
              border
              border-zinc-700
              bg-zinc-950
              shadow-2xl
            "
          >
            <div
              className="
                sticky
                top-0
                z-20
                flex
                items-center
                border-b
                border-zinc-800
                bg-zinc-950
                px-4
                py-3
              "
            >
              <div>
                <div className="font-semibold">
                  建立新資料集
                </div>

                <div
                  className="
                    mt-0.5
                    text-xs
                    text-zinc-400
                  "
                >
                  相機、Rally、球軌跡、Mask、人體與球拍各自選擇資料夾；RallySeg.csv 與 shot_annotated.csv 放在同一個 Rally 資料夾內。
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={closeDialog}
                className="
                  ml-auto
                  text-zinc-400
                  hover:text-white
                  disabled:opacity-40
                "
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 p-4">
              {Object.entries(
                CATEGORY_CONFIG,
              ).map(
                ([category, config]) => (
                  <input
                    key={category}
                    ref={element => {
                      inputRefs.current[
                        category
                      ] = element
                    }}
                    type="file"
                    accept={config.accept}
                    multiple
                    webkitdirectory=""
                    directory=""
                    className="hidden"
                    onChange={event => {
                      uploadCategory(
                        category,
                        event.target.files,
                      )

                      event.target.value = ''
                    }}
                  />
                ),
              )}

              {status === 'creating' && (
                <div
                  className="
                    rounded
                    border
                    border-indigo-700
                    bg-indigo-950/30
                    p-4
                    text-indigo-200
                  "
                >
                  正在建立資料集上傳工作階段……
                </div>
              )}

              {session && status !== 'success' && (
                <>
                  <div
                    className="
                      grid
                      grid-cols-1
                      gap-3
                      lg:grid-cols-2
                    "
                  >
                    {Object.keys(
                      CATEGORY_CONFIG,
                    ).map(category => (
                      <CategoryCard
                        key={category}
                        category={category}
                        data={
                          categories[
                            category
                          ]
                        }
                        uploading={
                          busyCategory
                          === category
                        }
                        progress={
                          progress[
                            category
                          ]
                          || 0
                        }
                        disabled={busy}
                        onChoose={() => {
                          chooseCategory(
                            category
                          )
                        }}
                        onClear={() => {
                          clearCategory(
                            category
                          )
                        }}
                      />
                    ))}
                  </div>

                  <div
                    className="
                      rounded-lg
                      border
                      border-zinc-800
                      bg-zinc-900/60
                      p-4
                    "
                  >
                    <div className="font-semibold">
                      基本設定
                    </div>

                    <div
                      className="
                        mt-3
                        grid
                        grid-cols-1
                        gap-3
                        md:grid-cols-2
                      "
                    >
                      <Field label="資料集名稱">
                        <input
                          value={settings.title}
                          disabled={busy}
                          onChange={event => {
                            setValue(
                              'title',
                              event.target.value,
                            )
                          }}
                          placeholder="例如：12_24_1"
                          className="
                            w-full
                            rounded
                            border
                            border-zinc-700
                            bg-zinc-950
                            px-3
                            py-2
                            disabled:opacity-50
                          "
                        />
                      </Field>

                      {reconstructionCandidates.length > 0 && (
                        <Field label="人體與球拍比賽代碼">
                          <select
                            value={settings.reconstructionCompetition}
                            disabled={busy}
                            onChange={event => {
                              setValue(
                                'reconstructionCompetition',
                                event.target.value,
                              )
                            }}
                            className="
                              w-full
                              rounded
                              border
                              border-zinc-700
                              bg-zinc-950
                              px-3
                              py-2
                              disabled:opacity-50
                            "
                          >
                            <option value="">
                              請選擇比賽資料夾
                            </option>
                            {reconstructionCandidates.map(item => (
                              <option
                                key={item.competition}
                                value={item.competition}
                              >
                                {item.competition}
                                {' · '}
                                {item.gender || 'neutral'}
                                {' · '}
                                {item.matched_score_count || 0} 個 Rally 對應
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}

                      <Field label="FPS">
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={settings.fps}
                          disabled={busy}
                          onChange={event => {
                            changeGlobalFps(
                              event.target.value,
                            )
                          }}
                          className="
                            w-full
                            rounded
                            border
                            border-zinc-700
                            bg-zinc-950
                            px-3
                            py-2
                            disabled:opacity-50
                          "
                        />
                      </Field>

                      <Field label="影片寬度">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={
                            settings.imageWidth
                          }
                          disabled={busy}
                          onChange={event => {
                            setValue(
                              'imageWidth',
                              event.target.value,
                            )
                          }}
                          className="
                            w-full
                            rounded
                            border
                            border-zinc-700
                            bg-zinc-950
                            px-3
                            py-2
                            disabled:opacity-50
                          "
                        />
                      </Field>

                      <Field label="影片高度">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={
                            settings.imageHeight
                          }
                          disabled={busy}
                          onChange={event => {
                            setValue(
                              'imageHeight',
                              event.target.value,
                            )
                          }}
                          className="
                            w-full
                            rounded
                            border
                            border-zinc-700
                            bg-zinc-950
                            px-3
                            py-2
                            disabled:opacity-50
                          "
                        />
                      </Field>
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setAdvanced(
                          value => !value
                        )
                      }}
                      className="
                        mt-4
                        rounded
                        border
                        border-zinc-700
                        bg-zinc-950
                        px-3
                        py-2
                        text-sm
                        hover:bg-zinc-800
                        disabled:opacity-50
                      "
                    >
                      {advanced
                        ? '收起進階設定'
                        : '展開進階設定'}
                    </button>

                    {advanced && (
                      <div className="mt-4 space-y-4">
                        <div
                          className="
                            grid
                            grid-cols-1
                            gap-3
                            md:grid-cols-2
                          "
                        >
                          <Field label="座標模式">
                            <select
                              value={
                                settings
                                  .coordinateMode
                              }
                              disabled={busy}
                              onChange={event => {
                                setValue(
                                  'coordinateMode',
                                  event.target.value,
                                )
                              }}
                              className="
                                w-full
                                rounded
                                border
                                border-zinc-700
                                bg-zinc-950
                                px-3
                                py-2
                              "
                            >
                              <option value="raw">
                                原始座標
                              </option>

                              <option value="scene">
                                3D 場景座標
                              </option>

                              <option value="flipX">
                                X 軸反向
                              </option>

                              <option value="flipY">
                                Y 軸反向
                              </option>

                              <option value="flipZ">
                                Z 軸反向
                              </option>

                              <option value="flipXFlipZ">
                                X、Z 軸反向
                              </option>

                              <option value="flipXFlipYFlipZ">
                                X、Y、Z 軸反向
                              </option>
                            </select>
                          </Field>

                          <label
                            className="
                              mt-5
                              flex
                              items-center
                              gap-2
                              rounded
                              border
                              border-zinc-700
                              bg-zinc-950
                              px-3
                              py-2
                            "
                          >
                            <input
                              type="checkbox"
                              checked={
                                settings
                                  .useLensDistortion
                              }
                              disabled={busy}
                              onChange={event => {
                                setValue(
                                  'useLensDistortion',
                                  event.target.checked,
                                )
                              }}
                            />

                            <span className="text-sm">
                              使用鏡頭畸變參數
                            </span>
                          </label>
                        </div>

                        <div>
                          <div className="mb-2 font-medium">
                            球場座標微調
                          </div>

                          <div
                            className="
                              grid
                              grid-cols-2
                              gap-2
                              md:grid-cols-3
                            "
                          >
                            {[
                              ['xOffset', 'X 偏移'],
                              ['zOffset', 'Z 偏移'],
                              ['rotateDeg', '旋轉角度'],
                              ['xScale', 'X 縮放'],
                              ['zScale', 'Z 縮放'],
                              ['yOffset', 'Y 偏移'],
                            ].map(
                              ([key, label]) => (
                                <Field
                                  key={key}
                                  label={label}
                                >
                                  <input
                                    type="number"
                                    step="0.001"
                                    value={
                                      settings
                                        .courtWorldTransform[
                                          key
                                        ]
                                    }
                                    disabled={busy}
                                    onChange={event => {
                                      setCourtValue(
                                        key,
                                        event.target.value,
                                      )
                                    }}
                                    className="
                                      w-full
                                      rounded
                                      border
                                      border-zinc-700
                                      bg-zinc-950
                                      px-2
                                      py-2
                                    "
                                  />
                                </Field>
                              ),
                            )}
                          </div>
                        </div>

                        {cameras.length > 0 && (
                          <div>
                            <div className="mb-2 font-medium">
                              各相機同步與投影偏移
                            </div>

                            <div
                              className="
                                overflow-x-auto
                                rounded
                                border
                                border-zinc-800
                              "
                            >
                              <table
                                className="
                                  w-full
                                  min-w-[850px]
                                  text-xs
                                "
                              >
                                <thead
                                  className="
                                    bg-zinc-950
                                    text-zinc-400
                                  "
                                >
                                  <tr>
                                    <th className="px-2 py-2 text-left">
                                      相機
                                    </th>
                                    <th className="px-2 py-2 text-left">
                                      影片名稱
                                    </th>
                                    <th className="px-2 py-2 text-left">
                                      FPS
                                    </th>
                                    <th className="px-2 py-2 text-left">
                                      Frame offset
                                    </th>
                                    <th className="px-2 py-2 text-left">
                                      水平偏移
                                    </th>
                                    <th className="px-2 py-2 text-left">
                                      垂直偏移
                                    </th>
                                    <th className="px-2 py-2 text-center">
                                      啟用
                                    </th>
                                  </tr>
                                </thead>

                                <tbody>
                                  {cameras.map(camera => {
                                    const current = (
                                      settings
                                        .cameraSettings[
                                          camera.id
                                        ]
                                      || {}
                                    )

                                    const inputClass = (
                                      'rounded border '
                                      + 'border-zinc-700 '
                                      + 'bg-zinc-950 '
                                      + 'px-2 py-1.5'
                                    )

                                    return (
                                      <tr
                                        key={camera.id}
                                        className="
                                          border-t
                                          border-zinc-800
                                        "
                                      >
                                        <td className="px-2 py-2 whitespace-nowrap">
                                          Cam {camera.index}
                                        </td>

                                        <td className="px-2 py-2">
                                          <input
                                            value={
                                              current.fileName
                                              || ''
                                            }
                                            disabled={busy}
                                            onChange={event => {
                                              setCameraValue(
                                                camera.id,
                                                'fileName',
                                                event.target.value,
                                              )
                                            }}
                                            className={`w-full ${inputClass}`}
                                          />
                                        </td>

                                        <td className="px-2 py-2">
                                          <input
                                            type="number"
                                            min="0.001"
                                            step="0.001"
                                            value={
                                              current.fps
                                              ?? settings.fps
                                            }
                                            disabled={busy}
                                            onChange={event => {
                                              setCameraValue(
                                                camera.id,
                                                'fps',
                                                event.target.value,
                                              )
                                            }}
                                            className={`w-24 ${inputClass}`}
                                          />
                                        </td>

                                        <td className="px-2 py-2">
                                          <input
                                            type="number"
                                            step="1"
                                            value={
                                              current.offsetFrame
                                              ?? 0
                                            }
                                            disabled={busy}
                                            onChange={event => {
                                              setCameraValue(
                                                camera.id,
                                                'offsetFrame',
                                                event.target.value,
                                              )
                                            }}
                                            className={`w-24 ${inputClass}`}
                                          />
                                        </td>

                                        <td className="px-2 py-2">
                                          <input
                                            type="number"
                                            step="0.1"
                                            value={
                                              current.uOffset
                                              ?? 0
                                            }
                                            disabled={busy}
                                            onChange={event => {
                                              setCameraValue(
                                                camera.id,
                                                'uOffset',
                                                event.target.value,
                                              )
                                            }}
                                            className={`w-24 ${inputClass}`}
                                          />
                                        </td>

                                        <td className="px-2 py-2">
                                          <input
                                            type="number"
                                            step="0.1"
                                            value={
                                              current.vOffset
                                              ?? 0
                                            }
                                            disabled={busy}
                                            onChange={event => {
                                              setCameraValue(
                                                camera.id,
                                                'vOffset',
                                                event.target.value,
                                              )
                                            }}
                                            className={`w-24 ${inputClass}`}
                                          />
                                        </td>

                                        <td className="px-2 py-2 text-center">
                                          <input
                                            type="checkbox"
                                            checked={
                                              current.enabled
                                              ?? true
                                            }
                                            disabled={busy}
                                            onChange={event => {
                                              setCameraValue(
                                                camera.id,
                                                'enabled',
                                                event.target.checked,
                                              )
                                            }}
                                          />
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div
                    className={`
                      rounded
                      border
                      p-4
                      ${
                        session.can_finalize
                          ? (
                              'border-emerald-700 '
                              + 'bg-emerald-950/30 '
                              + 'text-emerald-200'
                            )
                          : (
                              'border-zinc-700 '
                              + 'bg-zinc-900 '
                              + 'text-zinc-300'
                            )
                      }
                    `}
                  >
                    <div className="font-semibold">
                      {session.can_finalize
                        ? '✓ 必要資料已準備完成'
                        : '請先完成必要資料'}
                    </div>

                    <div className="mt-1 text-xs opacity-80">
                      已上傳暫存資料：{formatBytes(
                        session.total_size,
                      )}
                    </div>
                  </div>

                  <MessageList
                    title="必須修正"
                    items={session.errors}
                    tone="error"
                  />

                  <MessageList
                    title="提醒"
                    items={session.warnings}
                    tone="warning"
                  />
                </>
              )}

              {status === 'finalizing' && (
                <div
                  className="
                    rounded
                    border
                    border-indigo-700
                    bg-indigo-950/30
                    p-4
                    text-indigo-200
                  "
                >
                  正在寫入 PostgreSQL，請不要關閉視窗……
                </div>
              )}

              {status === 'success' && result && (
                <div
                  className="
                    rounded
                    border
                    border-emerald-700
                    bg-emerald-950/30
                    p-4
                    text-emerald-200
                  "
                >
                  <div className="text-base font-semibold">
                    資料集建立完成
                  </div>

                  <div className="mt-2 text-sm leading-7">
                    <div>
                      資料集：{result.title}
                    </div>
                    <div>
                      Match ID：{result.match_id}
                    </div>
                    <div>
                      Rally：{result.rally_count ?? 0}
                      {'　'}
                      Hit：{result.hit_count ?? 0}
                    </div>
                    <div>
                      軌跡點：{result.trajectory_count ?? 0}
                      {'　'}
                      相機：{result.camera_count ?? 0}
                    </div>
                    <div>
                      2D 羽球位置：{result.ball_2d_point_count ?? 0}
                      {'（可見 '}
                      {result.ball_2d_visible_count ?? 0}
                      {'）'}
                    </div>
                    <div>
                      人體／球拍動作檔：
                      {result.reconstruction_motion_count ?? 0}
                      {'　'}
                      比賽代碼：
                      {result.reconstruction_competition || '未上傳'}
                    </div>
                  </div>

                  <MessageList
                    title="匯入提醒"
                    items={result.warnings}
                    tone="warning"
                  />
                </div>
              )}

              {error && (
                <div
                  className="
                    whitespace-pre-wrap
                    rounded
                    border
                    border-red-700
                    bg-red-950/40
                    p-3
                    text-red-200
                  "
                >
                  {error}
                </div>
              )}
            </div>

            <div
              className="
                sticky
                bottom-0
                z-20
                flex
                justify-end
                gap-2
                border-t
                border-zinc-800
                bg-zinc-950
                px-4
                py-3
              "
            >
              <button
                type="button"
                disabled={busy}
                onClick={closeDialog}
                className="
                  rounded
                  border
                  border-zinc-700
                  bg-zinc-900
                  px-3
                  py-2
                  text-sm
                  hover:bg-zinc-800
                  disabled:opacity-50
                "
              >
                {status === 'success'
                  ? '完成'
                  : '取消'}
              </button>

              {status !== 'success' && (
                <button
                  type="button"
                  disabled={
                    busy
                    || !session
                      ?.can_finalize
                  }
                  onClick={finalizeDataset}
                  className="
                    rounded
                    border
                    border-indigo-500
                    bg-indigo-600
                    px-4
                    py-2
                    text-sm
                    hover:bg-indigo-500
                    disabled:opacity-40
                  "
                >
                  {status === 'finalizing'
                    ? '正在建立…'
                    : '建立資料集'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
