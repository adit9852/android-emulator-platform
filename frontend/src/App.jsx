import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from './api.js';

function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function App() {
  const [timeout, setTimeoutMin] = useState(30);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [serverInfo, setServerInfo] = useState({ count: 0, maxConcurrent: 2, free: 2 });

  const [apks, setApks] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(null); // null | 0..100
  const [installing, setInstalling] = useState(null); // apkId currently installing
  const [installMsg, setInstallMsg] = useState(null);
  const apkInputRef = useRef(null);

  const [devices, setDevices] = useState([]);
  const [pickedDevice, setPickedDevice] = useState('');
  const [rotation, setRotation] = useState(0);
  const [urlInput, setUrlInput] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listSessions();
      setSessions(data.sessions || []);
      setServerInfo({
        count: data.count,
        maxConcurrent: data.maxConcurrent,
        free: data.free ?? Math.max(0, data.maxConcurrent - data.count),
      });
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const refreshApks = useCallback(async () => {
    try {
      const data = await api.listApks();
      setApks(data.apks || []);
    } catch (e) {
      // soft-fail: keep prior list
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const data = await api.listDevices();
      setDevices(data.devices || []);
      // Pick the first device with free slots, or first overall.
      if (!pickedDevice && data.devices?.length) {
        const free = data.devices.find((d) => d.free > 0);
        setPickedDevice((free || data.devices[0]).device);
      }
    } catch (e) {
      // soft-fail
    }
  }, [pickedDevice]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadProgress(0);
    setInstallMsg(null);
    try {
      const result = await api.uploadApk(file, setUploadProgress);
      setUploadProgress(null);
      await refreshApks();
      setInstallMsg(`Uploaded ${result.filename} (${formatBytes(result.size)})`);
      if (apkInputRef.current) apkInputRef.current.value = '';
    } catch (err) {
      setUploadProgress(null);
      setInstallMsg(`Upload failed: ${err.message}`);
    }
  }

  async function handleInstall(apkId) {
    if (!activeSession) {
      setInstallMsg('Start an emulator session first.');
      return;
    }
    setInstalling(apkId);
    setInstallMsg('Installing…');
    try {
      const res = await api.installApk(activeSession.sessionId, apkId);
      setInstallMsg(
        res.success
          ? 'Installed. Look in the emulator app drawer.'
          : `Install reported failure:\n${res.output || 'no output'}`
      );
    } catch (err) {
      setInstallMsg(`Install error: ${err.message}`);
    } finally {
      setInstalling(null);
    }
  }

  async function handleDeleteApk(apkId) {
    try {
      await api.deleteApk(apkId);
      await refreshApks();
    } catch (err) {
      setInstallMsg(`Delete error: ${err.message}`);
    }
  }

  useEffect(() => {
    refresh();
    refreshApks();
    refreshDevices();
    const id = setInterval(() => {
      refresh();
      refreshDevices();
    }, 5000);
    return () => clearInterval(id);
  }, [refresh, refreshApks, refreshDevices]);

  async function startSession() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.createSession(pickedDevice || undefined, timeout);
      setActiveSession(data);
      setRotation(0);
      await refresh();
      await refreshDevices();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function takeScreenshot() {
    if (!activeSession) return;
    try {
      const blob = await api.screenshot(activeSession.sessionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `emulator-${activeSession.device.replace(/\W+/g, '_')}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  }

  async function cycleRotation() {
    if (!activeSession) return;
    try {
      await api.rotate(activeSession.sessionId, 1);
      setRotation((r) => (r + 1) % 4);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleUrlInstall() {
    if (!urlInput.trim()) return;
    setUrlBusy(true);
    setInstallMsg(null);
    try {
      const res = await api.installFromUrl(urlInput.trim());
      setUrlInput('');
      await refreshApks();
      setInstallMsg(`Downloaded ${res.filename} (${formatBytes(res.size)}) — click Install.`);
    } catch (err) {
      setInstallMsg(`URL download failed: ${err.message}`);
    } finally {
      setUrlBusy(false);
    }
  }

  async function stopSession(sessionId) {
    try {
      await api.stopSession(sessionId);
      if (activeSession?.sessionId === sessionId) setActiveSession(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Android Emulator Platform</h1>
        <div className="capacity">
          {serverInfo.free} of {serverInfo.maxConcurrent} emulators free
        </div>
      </header>

      <main className="main">
        <section className="panel">
          <h2>Launch a session</h2>
          <p className="hint">
            Emulators are pre-warmed — pressing Start gives you an Android instance
            instantly. Each device runs on Android 11 with hardware GPU acceleration.
          </p>
          <div className="form-row">
            <label>
              Device
              <select
                value={pickedDevice}
                onChange={(e) => setPickedDevice(e.target.value)}
              >
                {devices.map((d) => (
                  <option key={d.device} value={d.device} disabled={d.free === 0}>
                    {d.device}
                    {d.total > 1 ? ` (${d.free}/${d.total} free)` : d.free === 0 ? ' — in use' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Timeout (min)
              <input
                type="number"
                min={1}
                max={120}
                value={timeout}
                onChange={(e) => setTimeoutMin(Number(e.target.value))}
              />
            </label>
            <button onClick={startSession} disabled={loading || !pickedDevice || serverInfo.free === 0}>
              {loading
                ? 'Connecting…'
                : serverInfo.free === 0
                ? 'All emulators in use'
                : 'Start Emulator'}
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </section>

        {activeSession && (
          <section className="panel">
            <div className="viewer-header">
              <h2>
                {activeSession.device} · session {activeSession.sessionId.slice(0, 8)}…
              </h2>
              <div>
                <button onClick={takeScreenshot}>Screenshot</button>
                <button onClick={cycleRotation}>
                  Rotate ({['0°', '90°', '180°', '270°'][rotation]})
                </button>
                <button className="danger" onClick={() => stopSession(activeSession.sessionId)}>
                  Stop
                </button>
              </div>
            </div>
            <iframe
              key={activeSession.sessionId}
              title="emulator"
              src={activeSession.vncUrl}
              className="emulator-frame"
              allow="clipboard-read; clipboard-write"
            />
          </section>
        )}

        <section className="panel">
          <h2>APK library</h2>
          <div className="form-row">
            <input
              ref={apkInputRef}
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              onChange={handleUpload}
              disabled={uploadProgress !== null}
            />
            {uploadProgress !== null && (
              <span className="muted">Uploading… {uploadProgress}%</span>
            )}
          </div>
          <div className="form-row" style={{ marginTop: 10 }}>
            <label style={{ flex: 1 }}>
              …or install from URL
              <input
                type="url"
                placeholder="https://example.com/app.apk"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                disabled={urlBusy}
                style={{ minWidth: 360 }}
              />
            </label>
            <button onClick={handleUrlInstall} disabled={urlBusy || !urlInput.trim()}>
              {urlBusy ? 'Downloading…' : 'Fetch'}
            </button>
          </div>
          {installMsg && <div className="hint" style={{ whiteSpace: 'pre-wrap' }}>{installMsg}</div>}
          {apks.length === 0 ? (
            <p className="muted">No APKs uploaded yet.</p>
          ) : (
            <table className="sessions">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Uploaded</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {apks.map((a) => (
                  <tr key={a.id}>
                    <td>{a.original_name}</td>
                    <td>{formatBytes(Number(a.file_size))}</td>
                    <td>{new Date(a.uploaded_at).toLocaleString()}</td>
                    <td>
                      <button
                        onClick={() => handleInstall(a.id)}
                        disabled={!activeSession || installing === a.id}
                      >
                        {installing === a.id ? 'Installing…' : 'Install'}
                      </button>
                      <button className="danger" onClick={() => handleDeleteApk(a.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!activeSession && (
            <p className="muted">Start a session above to enable Install.</p>
          )}
        </section>

        <section className="panel">
          <h2>Active sessions</h2>
          {sessions.length === 0 ? (
            <p className="muted">No active sessions.</p>
          ) : (
            <table className="sessions">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Slot</th>
                  <th>VNC port</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.sessionId}>
                    <td>{s.sessionId.slice(0, 8)}…</td>
                    <td>#{s.slotId}</td>
                    <td>{s.vncPort}</td>
                    <td>{s.status}</td>
                    <td>
                      <button
                        onClick={() =>
                          setActiveSession({
                            sessionId: s.sessionId,
                            vncUrl: `http://${window.location.hostname}:${s.vncPort}`,
                          })
                        }
                      >
                        Open
                      </button>
                      <button
                        className="danger"
                        onClick={() => stopSession(s.sessionId)}
                      >
                        Stop
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
