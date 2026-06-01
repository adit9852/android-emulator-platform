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
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh, refreshApks]);

  async function startSession() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.createSession('Nexus 5', timeout);
      setActiveSession(data);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
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
            instantly, no boot wait. Device: <strong>Nexus 5 / Android 11</strong>.
          </p>
          <div className="form-row">
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
            <button onClick={startSession} disabled={loading || serverInfo.free === 0}>
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
              <h2>Session {activeSession.sessionId.slice(0, 8)}…</h2>
              <button
                className="danger"
                onClick={() => stopSession(activeSession.sessionId)}
              >
                Stop
              </button>
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
