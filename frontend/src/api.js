import { API_BASE } from './config.js';
function url(path) {
  return `${API_BASE}${path}`;
}
async function parseResponse(response) {
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    if (data && typeof data === 'object' && 'detail' in data) {
      throw new Error(JSON.stringify(data.detail));
    }
    throw new Error(typeof data === 'string' ? data : JSON.stringify(data || {
      message: `HTTP ${response.status}`
    }));
  }
  return data;
}
async function request(path, options = {}) {
  return parseResponse(await fetch(url(path), options));
}
function uploadForm(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url(path));
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || typeof onProgress !== 'function') {
        return;
      }
      onProgress(Math.round(event.loaded / event.total * 100));
    };
    xhr.onerror = () => {
      reject(new Error('無法連線到後端，請確認後端已啟動'));
    };
    xhr.onabort = () => {
      reject(new Error('上傳已取消'));
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      if (data && typeof data === 'object' && 'detail' in data) {
        reject(new Error(JSON.stringify(data.detail)));
        return;
      }
      reject(new Error(typeof data === 'string' ? data : JSON.stringify(data || {
        message: `HTTP ${xhr.status}`
      })));
    };
    xhr.send(formData);
  });
}
function appendFiles(formData, files) {
  Array.from(files || []).forEach(file => {
    formData.append('files', file);
    const name = file.name;
    const match = /^match\d+_(\d+)_\d+_\d+_view(\d+)(?:_calib)?_ball\.csv$/i.exec(name);
    const path = file.webkitRelativePath || (match ? `rally${match[1]}/view${match[2]}/v3/${name}` : name);
    formData.append('relative_paths', path);
  });
}
export const api = {
  align3DProjectionTo2D: (matchId, payload) => request(`/matches/${matchId}/traj3d/align-2d`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)}),
  fillMissing3D: (matchId, payload) => request(`/matches/${matchId}/traj3d/fill-missing`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)}),
  undo3DProjectionAlignment: (matchId, versionId) => request(`/matches/${matchId}/traj3d/align-2d/${versionId}/undo`, {method: 'POST'}),
  redo3DProjectionAlignment: (matchId, versionId) => request(`/matches/${matchId}/traj3d/align-2d/${versionId}/redo`, {method: 'POST'}),
  analyzeTraj3D: (matchId, payload) => request(`/matches/${matchId}/traj3d/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }),
  saveTraj3DVersion: (matchId, payload) => request(`/matches/${matchId}/traj3d/versions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }),
  listTraj3DVersions: matchId => request(`/matches/${matchId}/traj3d/versions`),
  getTraj3DTrajectory: (matchId, versionId = null) => request(`/matches/${matchId}/traj3d/trajectory${versionId == null ? '' : `?version_id=${encodeURIComponent(versionId)}`}`),
  exportTraj3DUrl: (matchId, versionId) => url(`/matches/${matchId}/traj3d/versions/${versionId}/export`),
  health: () => request('/health'),
  getMatch: matchId => request(`/matches/${matchId}`),
  getTimeline: matchId => request(`/matches/${matchId}/dataset-timeline`),
  getSmplReplay: (matchId, startFrame, endFrame) => request(`/matches/${matchId}/dataset-smpl-replay?start=${encodeURIComponent(startFrame)}&end=${encodeURIComponent(endFrame)}`),
  getTraj: (matchId, start, end) => request(`/matches/${matchId}/traj?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
  // 以下讀 2D 標註的 API 都帶 source：'original' 只讀原始資料，
  // 'corrected' 把 2D 標註修正疊上去
  getTraj2D: (matchId, cameraIndex, start, end, source = 'original') => request(`/matches/${matchId}/traj2d?camera_index=${encodeURIComponent(cameraIndex)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&source=${encodeURIComponent(source)}`),
  getTraj2DCameraGrid: (matchId, startFrame, endFrame, source = 'original') => request(`/matches/${matchId}/traj2d/camera-grid?start_frame=${encodeURIComponent(startFrame)}&end_frame=${encodeURIComponent(endFrame)}&source=${encodeURIComponent(source)}`),
  getPairwiseBallPoints: (matchId, startFrame, endFrame, source = 'original') => request(`/matches/${matchId}/traj2d/pairwise?start_frame=${encodeURIComponent(startFrame)}&end_frame=${encodeURIComponent(endFrame)}&source=${encodeURIComponent(source)}`),
  getPairwiseViewPoints: (matchId, startFrame, endFrame, source = 'original') => request(`/matches/${matchId}/traj2d/pairwise/views?start_frame=${encodeURIComponent(startFrame)}&end_frame=${encodeURIComponent(endFrame)}&source=${encodeURIComponent(source)}`),
  // 每一格哪些相機有看得見的 2D 標註，回傳 [{ frame, camera_index }]
  getBall2DVisibleRows: (matchId, startFrame, endFrame, source = 'original') => request(`/matches/${matchId}/traj2d/visible?start_frame=${encodeURIComponent(startFrame)}&end_frame=${encodeURIComponent(endFrame)}&source=${encodeURIComponent(source)}`),
  getBall2DRangeLabels: (matchId, startFrame, endFrame, source = 'original') => request(`/matches/${matchId}/traj2d/labels?start_frame=${encodeURIComponent(startFrame)}&end_frame=${encodeURIComponent(endFrame)}&source=${encodeURIComponent(source)}`),
  // 2D 標註修正：存在獨立的表，原始資料不會被改動
  get2DEditHistory: matchId => request(`/matches/${matchId}/traj2d/edit-history`),
  undo2DEdit: matchId => request(`/matches/${matchId}/traj2d/edit-history/undo`, { method: 'POST' }),
  redo2DEdit: matchId => request(`/matches/${matchId}/traj2d/edit-history/redo`, { method: 'POST' }),
  getBall2DCorrections: (matchId, cameraIndex) => request(`/matches/${matchId}/traj2d/corrections${cameraIndex == null ? '' : `?camera_index=${encodeURIComponent(cameraIndex)}`}`),
  saveBall2DCorrection: (matchId, payload) => request(`/matches/${matchId}/traj2d/corrections`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }),
  // 人工移除品質檢查藍格。單點或同視角連續區段一次存檔，可整批復原。
  hideBlue2DLabels: (matchId, cameraIndex, frames) => request(`/matches/${matchId}/traj2d/review-hide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ camera_index: cameraIndex, frames }),
  }),
  // 舊版目前 Rally 單獨清除 API，保留相容性。
  hideAllBlue2DLabels: (matchId, startFrame, endFrame) => request(`/matches/${matchId}/traj2d/review-hide-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_frame: startFrame, end_frame: endFrame }),
  }),
  // 所有 Rally 同批清除藍色，或同批修正紅色；皆支援上一步。
  hideDatasetBlue2DLabels: matchId => request(`/matches/${matchId}/traj2d/review-hide-dataset`, {
    method: 'POST',
  }),
  repairDatasetRed2DLabels: matchId => request(`/matches/${matchId}/traj2d/review-repair-dataset`, {
    method: 'POST',
  }),
  getDatasetSourceStatus: matchId => request(`/matches/${matchId}/dataset-export/sources`),
  uploadDatasetOriginals: (matchId, category, files, onProgress) => {
    const formData = new FormData();
    appendFiles(formData, files);
    return uploadForm(`/datasets/${matchId}/source-files/${encodeURIComponent(category)}`, formData, onProgress);
  },
  exportDatasetCategoriesUrl: (matchId, categories) =>
    url(`/matches/${matchId}/dataset-export?categories=${encodeURIComponent(categories.join(','))}`),
  // 原始資料與修正層合併後，輸出可供重新匯入的 Rally/view CSV ZIP。
  exportCorrected2DUrl: matchId => url(`/matches/${matchId}/traj2d/corrections/export`),
  replaceDataset2DFiles: (matchId, files, onProgress) => {
    const formData = new FormData();
    appendFiles(formData, files);
    return uploadForm(`/matches/${matchId}/traj2d/replace-files`, formData, onProgress);
  },
  deleteBall2DCorrection: (matchId, cameraIndex, frame) => request(`/matches/${matchId}/traj2d/corrections?camera_index=${encodeURIComponent(cameraIndex)}&frame=${encodeURIComponent(frame)}`, {
    method: 'DELETE'
  }),
  repairTraj2D: (matchId, payload) => request(`/matches/${matchId}/traj2d/repair`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }),
  undoTraj2DRepair: (matchId, repairId) => request(`/matches/${matchId}/traj2d/` + `repairs/${repairId}/undo`, {
    method: 'POST'
  }),
  undoAutoRepair: (matchId, repairIds) => request(`/matches/${matchId}/traj2d/auto-repair/undo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      repair_ids: repairIds
    })
  }),
  patchHit: (hitId, updates) => request(`/hits/${hitId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  }),
  patchAnomaly: (anomalyId, updates) => request(`/anomalies/${anomalyId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  }),
  repairTraj: (matchId, payload) => request(`/matches/${matchId}/traj/repair`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }),
  listDatasets: () => request('/datasets'),
  deleteDataset: matchId => request(`/datasets/${matchId}`, {
    method: 'DELETE'
  }),
  createDatasetUploadSession: () => request('/datasets/upload-sessions', {
    method: 'POST'
  }),
  getDatasetUploadSession: token => request(`/datasets/upload-sessions/${encodeURIComponent(token)}`),
  uploadDatasetCategory: (token, category, files, onProgress) => {
    const formData = new FormData();
    appendFiles(formData, files);
    return uploadForm(`/datasets/upload-sessions/${encodeURIComponent(token)}/categories/${encodeURIComponent(category)}`, formData, onProgress);
  },
  clearDatasetCategory: (token, category) => request(`/datasets/upload-sessions/${encodeURIComponent(token)}/categories/${encodeURIComponent(category)}`, {
    method: 'DELETE'
  }),
  deleteDatasetUploadSession: token => request(`/datasets/upload-sessions/${encodeURIComponent(token)}`, {
    method: 'DELETE'
  }),
  finalizeDatasetUploadSession: (token, settings) => {
    const formData = new FormData();
    formData.append('settings_json', JSON.stringify(settings));
    return request(`/datasets/upload-sessions/${encodeURIComponent(token)}/finalize`, {
      method: 'POST',
      body: formData
    });
  }
};
