const API_BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.error || data?.message || `Request failed: ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

export const api = {
  health: () => request('/../health'),
  createSession: (device = 'Samsung Galaxy S10', timeout = 30) =>
    request('/emulator/session', {
      method: 'POST',
      body: JSON.stringify({ device, timeout }),
    }),
  getSession: (sessionId) => request(`/emulator/session/${sessionId}`),
  stopSession: (sessionId) =>
    request(`/emulator/session/${sessionId}`, { method: 'DELETE' }),
  listSessions: () => request('/emulator/sessions'),
  listContainers: () => request('/emulator/containers'),
  stats: (sessionId) => request(`/emulator/stats/${sessionId}`),
};
