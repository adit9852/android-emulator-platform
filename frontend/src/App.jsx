import { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const DEVICES = [
  'Nexus 5',
  'Pixel 4',
  'Samsung Galaxy S6',
  'Samsung Galaxy S10',
];

export default function App() {
  const [device, setDevice] = useState(DEVICES[0]);
  const [timeout, setTimeoutMin] = useState(30);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [serverInfo, setServerInfo] = useState({ count: 0, maxConcurrent: 25 });

  const refresh = useCallback(async () => {
    try {
      const data = await api.listSessions();
      setSessions(data.sessions || []);
      setServerInfo({ count: data.count, maxConcurrent: data.maxConcurrent });
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  async function startSession() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.createSession(device, timeout);
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
          {serverInfo.count} / {serverInfo.maxConcurrent} sessions
        </div>
      </header>

      <main className="main">
        <section className="panel">
          <h2>Launch new session</h2>
          <div className="form-row">
            <label>
              Device
              <select value={device} onChange={(e) => setDevice(e.target.value)}>
                {DEVICES.map((d) => (
                  <option key={d} value={d}>
                    {d}
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
            <button onClick={startSession} disabled={loading}>
              {loading ? 'Starting…' : 'Start Emulator'}
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
            <p className="hint">
              Emulator boot takes ~60–120s. If the screen is black, wait and reload.
            </p>
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
          <h2>Active sessions</h2>
          {sessions.length === 0 ? (
            <p className="muted">No active sessions.</p>
          ) : (
            <table className="sessions">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Device</th>
                  <th>VNC port</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.sessionId}>
                    <td>{s.sessionId.slice(0, 8)}…</td>
                    <td>{s.device}</td>
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
