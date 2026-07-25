import React, {
  useEffect,
  useRef,
  useState,
} from 'react'

import { api } from '../api.js'
import { useAppStore } from '../store.js'


const DEFAULT_SETTINGS = {
  title: '',
  fps: 50,
  imageWidth: 1920,
  imageHeight: 1200,
  coordinateMode: 'raw',
  useLensDistortion: true,
  reconstructionCompetition: '',

  courtWorldTransform: {
    xOffset: 0,
    zOffset: 0,
    rotateDeg: 0,
    xScale: 1,
    zScale: 1,
    yOffset: 0,
  },

  cameraSettings: {},
}


const CATEGORY_CONFIG = {
  cameras: {
    title: '相機參數',
    description: (
      '選擇相機參數資料夾。系統會自動讀取其中的 Cam_*_intrinsic.npy 與 Cam_*_extrinsic.npy'
    ),
    buttonText: '選擇相機參數資料夾',
    accept: '.npy,application/octet-stream',
    required: true,
  },

  'rally-data': {
    title: 'Rally 與擊球標註',
    description: (
      '選擇 Rally 資料夾。每個 Set 資料夾內放 RallySeg.csv 與 shot_annotated.csv，系統會依相同資料夾自動配對'
    ),
    buttonText: '選擇 Rally 資料夾',
    accept: '.csv,text/csv',
    required: true,
  },

  ball: {
    title: '球軌跡',
    description: (
      '選擇球軌跡資料夾。系統會自動上傳其中所有 .npy'
    ),
    buttonText: '選擇球軌跡資料夾',
    accept: '.npy,application/octet-stream',
    required: false,
  },

  'ball-mask': {
    title: '球軌跡 Mask',
    description: (
      '選擇 Mask 資料夾。系統會自動上傳其中所有 .npy 並依檔名配對'
    ),
    buttonText: '選擇 Mask 資料夾',
    accept: '.npy,application/octet-stream',
    required: false,
  },

  'ball-2d': {
    title: '2D 羽球位置',
    description: (
      '選擇 match2 類型的資料夾；系統會讀取 rally*/view*/v3/*_ball.csv，並依檔名換算全場 frame。'
    ),
    buttonText: '選擇 2D 羽球位置資料夾',
    accept: '.csv,text/csv',
    required: false,
  },

  'human-racket': {
    title: '人體與球拍重建',
    description: (
      '選擇單一比賽資料夾，或選擇包含 new_racket 與 gender.csv 的最外層資料夾。'
      + '系統會讀取 {Score}_0.pth 與 {Score}_1.pth，並在建立資料集時自動轉成 NPZ'
    ),
    buttonText: '選擇人體與球拍資料夾',
    accept: '.pth,.npz,.csv,application/octet-stream,text/csv',
    required: false,
  },
}


const CAMERA_FILE_PATTERN = (
  /^(?:cam(?:era)?[_-]?)?\d+[_-](intrinsic|extrinsic)\.npy$/i
)

const BALL_2D_FILE_PATTERN = (
  /^match\d+_\d+_\d+_\d+_view\d+(?:_calib)?_ball\.csv$/i
)

const UPLOAD_BATCH_MAX_FILES = 100
const UPLOAD_BATCH_MAX_BYTES = 64 * 1024 * 1024


function splitUploadBatches(files) {
  const batches = []
  let current = []
  let currentBytes = 0

  for (const file of files || []) {
    const size = Number(file?.size || 0)
    const wouldOverflowFiles = current.length >= UPLOAD_BATCH_MAX_FILES
    const wouldOverflowBytes = (
      current.length > 0
      && currentBytes + size > UPLOAD_BATCH_MAX_BYTES
    )

    if (wouldOverflowFiles || wouldOverflowBytes) {
      batches.push(current)
      current = []
      currentBytes = 0
    }

    current.push(file)
    currentBytes += size
  }

  if (current.length > 0) {
    batches.push(current)
  }

  return batches
}


function categoryFileAllowed(
  category,
  file,
) {
  const name = String(
    file?.name || '',
  ).toLowerCase()

  if (category === 'cameras') {
    return CAMERA_FILE_PATTERN.test(
      file?.name || '',
    )
  }

  if (category === 'rally-data') {
    return (
      name === 'rallyseg.csv'
      || name === 'shot_annotated.csv'
    )
  }

  if (
    category === 'ball'
    || category === 'ball-mask'
  ) {
    return name.endsWith('.npy')
  }

  if (category === 'ball-2d') {
    return BALL_2D_FILE_PATTERN.test(
      file?.name || '',
    )
  }

  if (category === 'human-racket') {
    return (
      name === 'gender.csv'
      || name.endsWith('.pth')
      || name.endsWith('.npz')
    )
  }

  return false
}


function filteredCategoryFiles(
  category,
  fileList,
) {
  return Array.from(
    fileList || [],
  ).filter(file => (
    categoryFileAllowed(
      category,
      file,
    )
  ))
}


function formatBytes(bytes) {
  if (
    !Number.isFinite(bytes)
    || bytes <= 0
  ) {
    return '0 B'
  }

  const units = [
    'B',
    'KB',
    'MB',
    'GB',
  ]

  const index = Math.min(
    units.length - 1,
    Math.floor(
      Math.log(bytes)
      / Math.log(1024),
    ),
  )

  return `${(
    bytes
    / 1024 ** index
  ).toFixed(
    index === 0
      ? 0
      : 1,
  )} ${units[index]}`
}


function errorText(error) {
  const text = (
    error instanceof Error
      ? error.message
      : String(error)
  )

  try {
    const parsed = JSON.parse(text)

    if (
      typeof parsed
      === 'string'
    ) {
      return parsed
    }

    if (Array.isArray(parsed)) {
      return parsed
        .map(item => {
          const location = Array.isArray(
            item?.loc,
          )
            ? item.loc.join('.')
            : ''

          if (location.endsWith('files')) {
            return '沒有收到檔案，請重新選擇資料夾'
          }

          return item?.msg
            || '上傳資料格式錯誤'
        })
        .join('\n')
    }

    if (
      parsed
      && typeof parsed
        === 'object'
    ) {
      const message = (
        parsed.message
        || parsed.detail
        || ''
      )

      const errors = Array.isArray(
        parsed.errors,
      )
        ? parsed.errors
        : []

      return [
        message,
        ...errors,
      ]
        .filter(Boolean)
        .join('\n')
        || text
    }

  } catch {
    return text
  }

  return text
}


function numberValue(
  value,
  fallback = 0,
) {
  const number = Number(value)

  return Number.isFinite(number)
    ? number
    : fallback
}


function cameraDefaults(
  cameras,
  fps,
) {
  return Object.fromEntries(
    (cameras || []).map(
      camera => [
        camera.id,
        {
          label: `Cam ${camera.index}`,
          fileName: `${camera.index}.mp4`,
          fps,
          offsetFrame: 0,
          uOffset: 0,
          vOffset: 0,
          enabled: true,
        },
      ],
    ),
  )
}


function Field({
  label,
  children,
}) {
  return (
    <label className="block">
      <div
        className="
          mb-1
          text-xs
          text-zinc-400
        "
      >
        {label}
      </div>

      {children}
    </label>
  )
}


function MessageList({
  title,
  items,
  tone,
}) {
  if (!items?.length) {
    return null
  }

  const classes = (
    tone === 'error'
      ? (
          'border-red-700 '
          + 'bg-red-950/40 '
          + 'text-red-200'
        )
      : (
          'border-amber-700 '
          + 'bg-amber-950/30 '
          + 'text-amber-200'
        )
  )

  return (
    <div
      className={`
        rounded
        border
        p-3
        ${classes}
      `}
    >
      <div className="mb-1 font-semibold">
        {title}
      </div>

      {items.map(
        (
          item,
          index,
        ) => (
          <div
            key={`${index}-${item}`}
            className="text-xs leading-6"
          >
            • {item}
          </div>
        ),
      )}
    </div>
  )
}


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


function CategoryCard({
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
          rounded
          border
          border-indigo-500
          bg-indigo-600
          px-2
          py-1
          text-xs
          hover:bg-indigo-500
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
