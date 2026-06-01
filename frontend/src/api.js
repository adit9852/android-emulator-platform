const API_BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (e.g. rate-limiter plain text, nginx 502 HTML).
    if (!res.ok) throw new Error(text.slice(0, 200) || `Request failed: ${res.status}`);
    return text;
  }
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

  listApks: () => request('/upload/apks'),
  uploadApk: async (file, onProgress) => {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('apk', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload/apk');
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      xhr.onload = () => {
        try {
          const data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
          reject(new Error(data?.error || `Upload failed: ${xhr.status}`));
        } catch (e) {
          reject(new Error(xhr.responseText?.slice(0, 200) || 'Upload failed'));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(form);
    });
  },
  installApk: (sessionId, apkId) =>
    request('/upload/install', {
      method: 'POST',
      body: JSON.stringify({ sessionId, apkId }),
    }),
  deleteApk: (apkId) =>
    request(`/upload/apk/${apkId}`, { method: 'DELETE' }),
};
