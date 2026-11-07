import { API_BASE } from './config.js'


function url(path) {
  return `${API_BASE}${path}`
}


async function parseResponse(response) {
  const text = await response.text()

  let data = null

  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) {
    if (
      data
      && typeof data === 'object'
      && 'detail' in data
    ) {
      throw new Error(
        JSON.stringify(data.detail),
      )
    }

    throw new Error(
      typeof data === 'string'
        ? data
        : JSON.stringify(
            data || {
              message: `HTTP ${response.status}`,
            },
          ),
    )
  }

  return data
}


async function request(
  path,
  options = {},
) {
  return parseResponse(
    await fetch(
      url(path),
      options,
    ),
  )
}


function uploadForm(
  path,
  formData,
  onProgress,
) {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const xhr = (
        new XMLHttpRequest()
      )

      xhr.open(
        'POST',
        url(path),
      )

      xhr.upload.onprogress = event => {
        if (
          !event.lengthComputable
          || typeof onProgress
            !== 'function'
        ) {
          return
        }

        onProgress(
          Math.round(
            (
              event.loaded
              / event.total
            )
            * 100,
          ),
        )
      }

      xhr.onerror = () => {
        reject(
          new Error(
            '無法連線到後端，請確認後端已啟動',
          ),
        )
      }

      xhr.onabort = () => {
        reject(
          new Error(
            '上傳已取消',
          ),
        )
      }

      xhr.onload = () => {
        let data = null

        try {
          data = xhr.responseText
            ? JSON.parse(
                xhr.responseText,
              )
            : null
        } catch {
          data = xhr.responseText
        }

        if (
          xhr.status >= 200
          && xhr.status < 300
        ) {
          resolve(data)
          return
        }

        if (
          data
          && typeof data === 'object'
          && 'detail' in data
        ) {
          reject(
            new Error(
              JSON.stringify(
                data.detail,
              ),
            ),
          )
          return
        }

        reject(
          new Error(
            typeof data === 'string'
              ? data
              : JSON.stringify(
                  data || {
                    message: (
                      `HTTP ${xhr.status}`
                    ),
                  },
                ),
          ),
        )
      }

      xhr.send(formData)
    },
  )
}


function appendFiles(
  formData,
  files,
) {
  Array.from(
    files || [],
  ).forEach(file => {
    formData.append(
      'files',
      file,
    )

    formData.append(
      'relative_paths',
      file.webkitRelativePath
        || file.name,
    )
  })
}


export const api = {
  health: () => (
    request('/health')
  ),

  getMatch: matchId => (
    request(
      `/matches/${matchId}`,
    )
  ),

  getTimeline: matchId => (
    request(
      `/matches/${matchId}/dataset-timeline`,
    )
  ),

  getSmplReplay: (
    matchId,
    startFrame,
    endFrame,
  ) => (
    request(
      `/matches/${matchId}/dataset-smpl-replay?start=${encodeURIComponent(
        startFrame,
      )}&end=${encodeURIComponent(
        endFrame,
      )}`,
    )
  ),

  getTraj: (
    matchId,
    start,
    end,
  ) => (
    request(
      `/matches/${matchId}/traj?start=${encodeURIComponent(
        start,
      )}&end=${encodeURIComponent(
        end,
      )}`,
    )
  ),

  // 以下讀 2D 標註的 API 都帶 source：'original' 只讀原始資料，
  // 'corrected' 把 2D 標註修正疊上去
  getTraj2D: (
    matchId,
    cameraIndex,
    start,
    end,
    source = 'original',
  ) => (
    request(
      `/matches/${matchId}/traj2d?camera_index=${encodeURIComponent(
        cameraIndex,
      )}&start=${encodeURIComponent(
        start,
      )}&end=${encodeURIComponent(
        end,
      )}&source=${encodeURIComponent(
        source,
      )}`,
    )
  ),

  getTraj2DCameraGrid: (
    matchId,
    startFrame,
    endFrame,
    source = 'original',
  ) => (
    request(
      `/matches/${matchId}/traj2d/camera-grid?start_frame=${encodeURIComponent(
        startFrame,
      )}&end_frame=${encodeURIComponent(
        endFrame,
      )}&source=${encodeURIComponent(
        source,
      )}`,
    )
  ),

  // 某一格兩兩重建的說明：哪幾台有標註、各組配對通過與否與原因
  explainPairwiseFrame: (
    matchId,
    frame,
    source = 'original',
    cameraMaxDistance = {},
    thresholdPx = null,
  ) => (
    request(
      `/matches/${matchId}/traj2d/pairwise/explain?frame=${encodeURIComponent(
        frame,
      )}&source=${encodeURIComponent(
        source,
      )}&camera_max_distance=${encodeURIComponent(
        Object.entries(cameraMaxDistance).map(([camera, meters]) => `${camera}:${meters}`).join(','),
      )}${thresholdPx ? `&reprojection_threshold_px=${encodeURIComponent(thresholdPx)}` : ''}`,
    )
  ),

  // cameraMaxDistance：{ 相機編號: 公尺 }，這些相機只在球離它不超過
  // 那個距離時才拿來重建
  getPairwiseBallPoints: (
    matchId,
    startFrame,
    endFrame,
    source = 'original',
    cameraMaxDistance = {},
    thresholdPx = null,
  ) => (
    request(
      `/matches/${matchId}/traj2d/pairwise?start_frame=${encodeURIComponent(
        startFrame,
      )}&end_frame=${encodeURIComponent(
        endFrame,
      )}&source=${encodeURIComponent(
        source,
      )}&camera_max_distance=${encodeURIComponent(
        Object.entries(cameraMaxDistance).map(([camera, meters]) => `${camera}:${meters}`).join(','),
      )}${thresholdPx ? `&reprojection_threshold_px=${encodeURIComponent(thresholdPx)}` : ''}`,
    )
  ),

  getPairwiseViewPoints: (
    matchId,
    startFrame,
    endFrame,
    source = 'original',
  ) => (
    request(
      `/matches/${matchId}/traj2d/pairwise/views?start_frame=${encodeURIComponent(
        startFrame,
      )}&end_frame=${encodeURIComponent(
        endFrame,
      )}&source=${encodeURIComponent(
        source,
      )}`,
    )
  ),

  // 每一格哪些相機有看得見的 2D 標註，回傳 [{ frame, camera_index }]
  getBall2DVisibleRows: (
    matchId,
    startFrame,
    endFrame,
    source = 'original',
  ) => (
    request(
      `/matches/${matchId}/traj2d/visible?start_frame=${encodeURIComponent(
        startFrame,
      )}&end_frame=${encodeURIComponent(
        endFrame,
      )}&source=${encodeURIComponent(
        source,
      )}`,
    )
  ),

  // 2D 標註修正：存在獨立的表，原始資料不會被改動
  getBall2DCorrections: (matchId, cameraIndex) => request(
    `/matches/${matchId}/traj2d/corrections${
      cameraIndex == null ? '' : `?camera_index=${encodeURIComponent(cameraIndex)}`
    }`,
  ),

  saveBall2DCorrection: (matchId, payload) => request(
    `/matches/${matchId}/traj2d/corrections`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  ),

  deleteBall2DCorrection: (matchId, cameraIndex, frame) => request(
    `/matches/${matchId}/traj2d/corrections?camera_index=${encodeURIComponent(
      cameraIndex,
    )}&frame=${encodeURIComponent(frame)}`,
    { method: 'DELETE' },
  ),

  repairTraj2D: (
    matchId,
    payload,
  ) => (
    request(
      `/matches/${matchId}/traj2d/repair`,
      {
        method: 'POST',
        headers: {
          'Content-Type': (
            'application/json'
          ),
        },
        body: JSON.stringify(
          payload,
        ),
      },
    )
  ),

  undoTraj2DRepair: (
    matchId,
    repairId,
  ) => (
    request(
      (
        `/matches/${matchId}/traj2d/`
        + `repairs/${repairId}/undo`
      ),
      {
        method: 'POST',
      },
    )
  ),

  undoAutoRepair: (matchId, repairIds) => request(
    `/matches/${matchId}/traj2d/auto-repair/undo`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repair_ids: repairIds }),
    },
  ),

  patchHit: (
    hitId,
    updates,
  ) => (
    request(
      `/hits/${hitId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': (
            'application/json'
          ),
        },
        body: JSON.stringify(
          updates,
        ),
      },
    )
  ),

  patchAnomaly: (
    anomalyId,
    updates,
  ) => (
    request(
      `/anomalies/${anomalyId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': (
            'application/json'
          ),
        },
        body: JSON.stringify(
          updates,
        ),
      },
    )
  ),

  repairTraj: (
    matchId,
    payload,
  ) => (
    request(
      `/matches/${matchId}/traj/repair`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': (
            'application/json'
          ),
        },
        body: JSON.stringify(
          payload,
        ),
      },
    )
  ),

  listDatasets: () => (
    request('/datasets')
  ),

  deleteDataset: matchId => (
    request(
      `/datasets/${matchId}`,
      {
        method: 'DELETE',
      },
    )
  ),

  createDatasetUploadSession: () => (
    request(
      '/datasets/upload-sessions',
      {
        method: 'POST',
      },
    )
  ),

  getDatasetUploadSession: token => (
    request(
      `/datasets/upload-sessions/${encodeURIComponent(
        token,
      )}`,
    )
  ),

  uploadDatasetCategory: (
    token,
    category,
    files,
    onProgress,
  ) => {
    const formData = (
      new FormData()
    )

    appendFiles(
      formData,
      files,
    )

    return uploadForm(
      `/datasets/upload-sessions/${encodeURIComponent(
        token,
      )}/categories/${encodeURIComponent(
        category,
      )}`,
      formData,
      onProgress,
    )
  },

  clearDatasetCategory: (
    token,
    category,
  ) => (
    request(
      `/datasets/upload-sessions/${encodeURIComponent(
        token,
      )}/categories/${encodeURIComponent(
        category,
      )}`,
      {
        method: 'DELETE',
      },
    )
  ),

  deleteDatasetUploadSession: token => (
    request(
      `/datasets/upload-sessions/${encodeURIComponent(
        token,
      )}`,
      {
        method: 'DELETE',
      },
    )
  ),

  finalizeDatasetUploadSession: (
    token,
    settings,
  ) => {
    const formData = (
      new FormData()
    )

    formData.append(
      'settings_json',
      JSON.stringify(settings),
    )

    return request(
      `/datasets/upload-sessions/${encodeURIComponent(
        token,
      )}/finalize`,
      {
        method: 'POST',
        body: formData,
      },
    )
  },
}
