// 資料集上傳精靈用的設定與純函式


export const DEFAULT_SETTINGS = {
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


export const CATEGORY_CONFIG = {
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


export function splitUploadBatches(files) {
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


export function filteredCategoryFiles(
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


export function formatBytes(bytes) {
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


export function errorText(error) {
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


export function numberValue(
  value,
  fallback = 0,
) {
  const number = Number(value)

  return Number.isFinite(number)
    ? number
    : fallback
}


export function cameraDefaults(
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
