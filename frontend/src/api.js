import { API_BASE } from './config.js';

async function jget(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

async function jpatch(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

export const api = {
  getMatch: (id) => jget(`/matches/${id}`),
  getTimeline: (id) => jget(`/matches/${id}/timeline`),
  getTraj: (id, startFrame, endFrame) => jget(`/matches/${id}/traj?start=${startFrame}&end=${endFrame}`),
  repairTraj: (id, payload) => jpatch(`/matches/${id}/traj/repair`, payload),
  patchHit: (hitId, payload) => jpatch(`/hits/${hitId}`, payload),
  patchAnomaly: (anomalyId, payload) => jpatch(`/anomalies/${anomalyId}`, payload),
};
