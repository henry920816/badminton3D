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

  getTraj2D: (
    matchId,
    cameraIndex,
    start,
    end,
  ) => (
    request(
      `/matches/${matchId}/traj2d?camera_index=${encodeURIComponent(
        cameraIndex,
      )}&start=${encodeURIComponent(
        start,
      )}&end=${encodeURIComponent(
        end,
      )}`,
    )
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
