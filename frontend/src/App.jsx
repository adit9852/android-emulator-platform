import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Smartphone, Home, ArrowLeft, Square, Power,
  Volume2, VolumeX, Camera, RotateCcw,
  MapPin, Battery, Wifi, WifiOff, Link as LinkIcon,
  Upload, Download, Trash2, Loader2, Check,
  PlayCircle, StopCircle, Folder, Globe,
} from 'lucide-react';
import { api } from './api.js';

function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const GPS_PRESETS = [
  { name: 'Mumbai',        lat: 19.0760, lng:  72.8777 },
  { name: 'San Francisco', lat: 37.7749, lng: -122.4194 },
  { name: 'New York',      lat: 40.7128, lng:  -74.0060 },
  { name: 'London',        lat: 51.5074, lng:   -0.1278 },
  { name: 'Tokyo',         lat: 35.6762, lng:  139.6503 },
  { name: 'Sydney',        lat: -33.8688, lng: 151.2093 },
];

const NETWORK_PROFILES = [
  { id: 'full',    label: 'Wi-Fi',   icon: Wifi },
  { id: '4g',      label: '4G LTE',  icon: Wifi },
  { id: '3g',      label: '3G',      icon: Wifi },
  { id: 'edge',    label: 'EDGE',    icon: Wifi },
  { id: 'offline', label: 'Offline', icon: WifiOff },
];

const HW_KEYS = [
  { id: 'RECENT',      label: 'Recent', icon: Square },
  { id: 'HOME',        label: 'Home',   icon: Home },
  { id: 'BACK',        label: 'Back',   icon: ArrowLeft },
  { id: 'POWER',       label: 'Power',  icon: Power },
  { id: 'VOLUME_UP',   label: 'Vol +',  icon: Volume2 },
  { id: 'VOLUME_DOWN', label: 'Vol -',  icon: VolumeX },
];

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [devices, setDevices] = useState([]);
  const [pickedDevice, setPickedDevice] = useState('');
  const [timeoutMin, setTimeoutMin] = useState(30);
  const [loading, setLoading] = useState(false);
  const [serverInfo, setServerInfo] = useState({ count: 0, maxConcurrent: 3, free: 3 });
  const [error, setError] = useState(null);

  // device controls
  const [orientation, setOrientation] = useState('portrait');
  const [rotating, setRotating] = useState(false);
  const [batteryLevel, setBatteryLevel] = useState(100);
  const [networkProfile, setNetworkProfile] = useState('full');
  const [gpsLat, setGpsLat] = useState('19.0760');
  const [gpsLng, setGpsLng] = useState('72.8777');
  const [openUrlInput, setOpenUrlInput] = useState('');

  // APK
  const [apks, setApks] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [installing, setInstalling] = useState(null);
  const [installMsg, setInstallMsg] = useState(null);
  const [urlApkInput, setUrlApkInput] = useState('');
  const [urlApkBusy, setUrlApkBusy] = useState(false);
  const apkInputRef = useRef(null);

  // ---------- data loaders ----------
  const refreshSessions = useCallback(async () => {
    try {
      const data = await api.listSessions();
      setSessions(data.sessions || []);
      setServerInfo({
        count: data.count,
        maxConcurrent: data.maxConcurrent,
        free: data.free ?? Math.max(0, data.maxConcurrent - data.count),
      });
    } catch (e) { setError(e.message); }
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const data = await api.listDevices();
      setDevices(data.devices || []);
      if (!pickedDevice && data.devices?.length) {
        const free = data.devices.find((d) => d.free > 0);
        setPickedDevice((free || data.devices[0]).device);
      }
    } catch {}
  }, [pickedDevice]);

  const refreshApks = useCallback(async () => {
    try {
      const data = await api.listApks();
      setApks(data.apks || []);
    } catch {}
  }, []);

  useEffect(() => {
    refreshSessions(); refreshDevices(); refreshApks();
    const id = setInterval(() => { refreshSessions(); refreshDevices(); }, 5000);
    return () => clearInterval(id);
  }, [refreshSessions, refreshDevices, refreshApks]);

  // ---------- session lifecycle ----------
  async function startSession() {
    if (!pickedDevice) return;
    setLoading(true); setError(null);
    try {
      const s = await api.createSession(pickedDevice, timeoutMin);
      setActiveSession(s);
      setOrientation('portrait');
      setBatteryLevel(100);
      setNetworkProfile('full');
      await refreshSessions(); await refreshDevices();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function stopSession(sessionId = activeSession?.sessionId) {
    if (!sessionId) return;
    try {
      await api.stopSession(sessionId);
      if (activeSession?.sessionId === sessionId) setActiveSession(null);
      await refreshSessions(); await refreshDevices();
    } catch (e) { setError(e.message); }
  }

  // ---------- controls ----------
  async function pressKey(key) {
    if (!activeSession) return;
    try { await api.key(activeSession.sessionId, key); }
    catch (e) { setError(e.message); }
  }

  async function takeScreenshot() {
    if (!activeSession) return;
    try {
      const blob = await api.screenshot(activeSession.sessionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `emulator-${activeSession.device.replace(/\W+/g, '_')}-${Date.now()}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
  }

  async function toggleOrientation() {
    if (!activeSession || rotating) return;
    setRotating(true);
    try {
      const r = await api.rotate(activeSession.sessionId);
      setOrientation(r.orientation || (orientation === 'portrait' ? 'landscape' : 'portrait'));
    } catch (e) { setError(e.message); }
    finally { setRotating(false); }
  }

  async function applyBattery(level) {
    setBatteryLevel(level);
    if (!activeSession) return;
    try { await api.battery(activeSession.sessionId, level); }
    catch (e) { setError(e.message); }
  }

  async function applyNetwork(profile) {
    setNetworkProfile(profile);
    if (!activeSession) return;
    try { await api.network(activeSession.sessionId, profile); }
    catch (e) { setError(e.message); }
  }

  async function applyGps(lat, lng) {
    setGpsLat(String(lat)); setGpsLng(String(lng));
    if (!activeSession) return;
    try { await api.gps(activeSession.sessionId, Number(lat), Number(lng)); }
    catch (e) { setError(e.message); }
  }

  async function openUrlOnDevice() {
    if (!activeSession || !openUrlInput.trim()) return;
    try {
      await api.openUrl(activeSession.sessionId, openUrlInput.trim());
      setOpenUrlInput('');
    } catch (e) { setError(e.message); }
  }

  // ---------- APK ----------
  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadProgress(0); setInstallMsg(null);
    try {
      const r = await api.uploadApk(file, setUploadProgress);
      setUploadProgress(null);
      await refreshApks();
      setInstallMsg(`Uploaded ${r.filename} (${formatBytes(r.size)}).`);
      if (apkInputRef.current) apkInputRef.current.value = '';
    } catch (e) {
      setUploadProgress(null);
      setInstallMsg(`Upload failed: ${e.message}`);
    }
  }

  async function handleUrlApkFetch() {
    if (!urlApkInput.trim()) return;
    setUrlApkBusy(true); setInstallMsg(null);
    try {
      const r = await api.installFromUrl(urlApkInput.trim());
      setUrlApkInput('');
      await refreshApks();
      setInstallMsg(`Downloaded ${r.filename} (${formatBytes(r.size)}).`);
    } catch (e) {
      setInstallMsg(`URL download failed: ${e.message}`);
    } finally { setUrlApkBusy(false); }
  }

  async function handleInstall(apkId) {
    if (!activeSession) { setInstallMsg('Start a session first.'); return; }
    setInstalling(apkId); setInstallMsg('Installing…');
    try {
      const r = await api.installApk(activeSession.sessionId, apkId);
      setInstallMsg(r.success ? 'Installed. Check the app drawer.' : `Install failed:\n${r.output || ''}`);
    } catch (e) { setInstallMsg(`Install error: ${e.message}`); }
    finally { setInstalling(null); }
  }

  async function handleDeleteApk(apkId) {
    try { await api.deleteApk(apkId); await refreshApks(); }
    catch (e) { setInstallMsg(`Delete error: ${e.message}`); }
  }

  // ---------- iframe URL with no toolbar ----------
  const vncSrc = useMemo(() => {
    if (!activeSession) return null;
    const base = activeSession.vncUrl.replace(/\/$/, '');
    return `${base}/vnc_lite.html?autoconnect=true&resize=scale&path=websockify`;
  }, [activeSession]);

  // ===================================================================
  return (
    <div className="h-full flex flex-col">
      <Header serverInfo={serverInfo} />

      <div className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
        {/* LEFT SIDEBAR */}
        <aside className="col-span-3 flex flex-col gap-4 overflow-y-auto pr-1">
          <DevicePicker
            devices={devices}
            picked={pickedDevice}
            onPick={setPickedDevice}
            timeoutMin={timeoutMin}
            onTimeout={setTimeoutMin}
            onStart={startSession}
            loading={loading}
            disabled={!pickedDevice || serverInfo.free === 0}
            error={error}
          />
          <SessionsList
            sessions={sessions}
            activeId={activeSession?.sessionId}
            onOpen={(s) =>
              setActiveSession({
                sessionId: s.sessionId,
                device: s.device,
                vncPort: s.vncPort,
                vncUrl: `http://${window.location.hostname}:${s.vncPort}`,
              })
            }
            onStop={stopSession}
          />
          <ApkLibrary
            apks={apks}
            apkInputRef={apkInputRef}
            uploadProgress={uploadProgress}
            installing={installing}
            installMsg={installMsg}
            urlApkInput={urlApkInput}
            urlApkBusy={urlApkBusy}
            hasSession={!!activeSession}
            onUpload={handleUpload}
            onUrlChange={setUrlApkInput}
            onUrlFetch={handleUrlApkFetch}
            onInstall={handleInstall}
            onDelete={handleDeleteApk}
          />
        </aside>

        {/* CENTER: viewer */}
        <main className="col-span-6 flex flex-col">
          {activeSession ? (
            <EmulatorViewer
              session={activeSession}
              vncSrc={vncSrc}
              orientation={orientation}
              onStop={() => stopSession()}
            />
          ) : (
            <WelcomeHero
              pickedDevice={pickedDevice}
              serverFree={serverInfo.free}
              onStart={startSession}
            />
          )}
        </main>

        {/* RIGHT: tools panel */}
        <aside className="col-span-3 overflow-y-auto pl-1">
          <ToolsPanel
            active={activeSession}
            orientation={orientation}
            rotating={rotating}
            onKey={pressKey}
            onScreenshot={takeScreenshot}
            onRotate={toggleOrientation}
            batteryLevel={batteryLevel}
            onBattery={applyBattery}
            networkProfile={networkProfile}
            onNetwork={applyNetwork}
            gpsLat={gpsLat}
            gpsLng={gpsLng}
            onGpsChange={(lat, lng) => { setGpsLat(lat); setGpsLng(lng); }}
            onGpsApply={() => applyGps(gpsLat, gpsLng)}
            onGpsPreset={(p) => applyGps(p.lat, p.lng)}
            openUrlInput={openUrlInput}
            onOpenUrlChange={setOpenUrlInput}
            onOpenUrl={openUrlOnDevice}
          />
        </aside>
      </div>
    </div>
  );
}

// ===================================================================
// Header
// ===================================================================
function Header({ serverInfo }) {
  return (
    <header className="border-b border-ink-700 bg-ink-900/80 backdrop-blur-md px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
          <Smartphone className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-semibold leading-tight">Emulator Platform</h1>
          <p className="text-xs text-ink-400 leading-tight">Android in your browser</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="chip-emerald">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Online
        </span>
        <span className="chip-indigo">
          {serverInfo.free} of {serverInfo.maxConcurrent} free
        </span>
      </div>
    </header>
  );
}

// ===================================================================
// Device picker (sidebar)
// ===================================================================
function DevicePicker({ devices, picked, onPick, timeoutMin, onTimeout, onStart, loading, disabled, error }) {
  return (
    <section className="panel-pad">
      <SectionTitle icon={<Smartphone className="w-4 h-4" />}>Devices</SectionTitle>
      <div className="space-y-2 mt-3">
        {devices.length === 0 && (
          <div className="text-xs text-ink-400">Loading devices…</div>
        )}
        {devices.map((d) => (
          <button
            key={d.device}
            onClick={() => onPick(d.device)}
            disabled={d.free === 0 && picked !== d.device}
            className={`w-full text-left p-3 rounded-lg border-2 transition-all
              ${picked === d.device
                ? 'border-indigo-500 bg-indigo-500/10'
                : 'border-ink-700 bg-ink-900/50 hover:border-ink-600'}
              ${d.free === 0 && picked !== d.device ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{d.device}</div>
                <div className="text-xs text-ink-400 mt-0.5">Android 11</div>
              </div>
              {d.free > 0 ? (
                <span className="chip-emerald">Free</span>
              ) : (
                <span className="chip-rose">In use</span>
              )}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="label">Timeout (min)</label>
          <input
            type="number"
            className="input"
            min={1} max={120}
            value={timeoutMin}
            onChange={(e) => onTimeout(Number(e.target.value))}
          />
        </div>
        <button
          onClick={onStart}
          disabled={loading || disabled}
          className="btn-primary w-full justify-center py-2.5"
        >
          {loading ? (<><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</>) : (<><PlayCircle className="w-4 h-4" /> Start Session</>)}
        </button>
        {error && (
          <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded p-2">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}

// ===================================================================
// Sessions list
// ===================================================================
function SessionsList({ sessions, activeId, onOpen, onStop }) {
  if (sessions.length === 0) return null;
  return (
    <section className="panel-pad">
      <SectionTitle icon={<Folder className="w-4 h-4" />}>Active sessions</SectionTitle>
      <div className="space-y-2 mt-3">
        {sessions.map((s) => (
          <div key={s.sessionId}
            className={`p-3 rounded-lg border transition-colors flex items-center justify-between gap-2
              ${activeId === s.sessionId
                ? 'border-indigo-500 bg-indigo-500/5'
                : 'border-ink-700 bg-ink-900/40 hover:border-ink-600'}`}>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{s.device}</div>
              <div className="text-xs text-ink-400 font-mono">{s.sessionId.slice(0, 8)}…</div>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              <button onClick={() => onOpen(s)} className="btn-ghost px-2 py-1 text-xs">Open</button>
              <button onClick={() => onStop(s.sessionId)} className="btn-ghost px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10">Stop</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ===================================================================
// APK library
// ===================================================================
function ApkLibrary({
  apks, apkInputRef, uploadProgress, installing, installMsg,
  urlApkInput, urlApkBusy, hasSession,
  onUpload, onUrlChange, onUrlFetch, onInstall, onDelete,
}) {
  return (
    <section className="panel-pad">
      <SectionTitle icon={<Upload className="w-4 h-4" />}>APK library</SectionTitle>

      <div className="mt-3 space-y-3">
        <label className="block">
          <div className="border-2 border-dashed border-ink-700 rounded-lg p-3 hover:border-indigo-500/60 transition-colors cursor-pointer">
            <input
              ref={apkInputRef}
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              onChange={onUpload}
              disabled={uploadProgress !== null}
              className="hidden"
            />
            <div className="flex items-center gap-2 text-xs">
              <Upload className="w-4 h-4 text-ink-400" />
              <span className="text-ink-300">
                {uploadProgress !== null ? `Uploading… ${uploadProgress}%` : 'Choose APK to upload'}
              </span>
            </div>
          </div>
        </label>

        <div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Or paste URL…"
              value={urlApkInput}
              onChange={(e) => onUrlChange(e.target.value)}
              disabled={urlApkBusy}
            />
            <button onClick={onUrlFetch} disabled={urlApkBusy || !urlApkInput.trim()}
              className="btn-secondary px-3 text-xs">
              {urlApkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {installMsg && (
          <div className="text-xs bg-ink-900/60 border border-ink-700 rounded p-2 text-ink-300 whitespace-pre-wrap">
            {installMsg}
          </div>
        )}

        {apks.length === 0 ? (
          <p className="text-xs text-ink-400 text-center py-4">No APKs uploaded yet.</p>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {apks.map((a) => (
              <div key={a.id} className="bg-ink-900/40 rounded-md p-2 text-xs flex items-center gap-2 group">
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium" title={a.original_name}>{a.original_name}</div>
                  <div className="text-ink-400">{formatBytes(Number(a.file_size))}</div>
                </div>
                <button onClick={() => onInstall(a.id)} disabled={!hasSession || installing === a.id}
                  className="btn-ghost px-2 py-1 text-xs">
                  {installing === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                </button>
                <button onClick={() => onDelete(a.id)} className="btn-ghost px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ===================================================================
// Welcome hero (when no active session)
// ===================================================================
function WelcomeHero({ pickedDevice, serverFree, onStart }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="panel-pad max-w-md text-center">
        <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 flex items-center justify-center">
          <Smartphone className="w-10 h-10 text-indigo-400" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Ready when you are</h2>
        <p className="text-sm text-ink-400 mb-5">
          Pre-warmed Android emulators are sitting at the home screen. Pick a device
          on the left, then start a session — no boot wait.
        </p>
        {pickedDevice && (
          <button onClick={onStart} disabled={serverFree === 0} className="btn-primary justify-center px-6 py-2.5">
            <PlayCircle className="w-4 h-4" />
            Start {pickedDevice}
          </button>
        )}
      </div>
    </div>
  );
}

// ===================================================================
// Emulator viewer (main content when session is active)
// ===================================================================
function EmulatorViewer({ session, vncSrc, orientation, onStop }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="panel mb-3 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="chip-emerald">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
          <div>
            <div className="text-sm font-semibold">{session.device}</div>
            <div className="text-xs text-ink-400 font-mono">
              {session.sessionId.slice(0, 8)}… · {orientation}
            </div>
          </div>
        </div>
        <button onClick={onStop} className="btn-danger px-3 py-1.5 text-sm">
          <StopCircle className="w-4 h-4" /> End session
        </button>
      </div>

      <div className="panel flex-1 min-h-0 p-3 bg-gradient-to-br from-ink-800 to-ink-900 flex items-center justify-center overflow-hidden">
        <iframe
          key={session.sessionId}
          title="emulator"
          src={vncSrc}
          className="emulator-iframe w-full h-full rounded-lg"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}

// ===================================================================
// Tools panel (right sidebar when session active)
// ===================================================================
function ToolsPanel({
  active, orientation, rotating,
  onKey, onScreenshot, onRotate,
  batteryLevel, onBattery,
  networkProfile, onNetwork,
  gpsLat, gpsLng, onGpsChange, onGpsApply, onGpsPreset,
  openUrlInput, onOpenUrlChange, onOpenUrl,
}) {
  if (!active) {
    return (
      <div className="panel-pad text-center text-xs text-ink-400">
        Hardware controls and sensor sims appear when a session is running.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Quick actions */}
      <section className="panel-pad">
        <SectionTitle icon={<Camera className="w-4 h-4" />}>Quick actions</SectionTitle>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button onClick={onScreenshot} className="btn-secondary justify-center">
            <Camera className="w-4 h-4" /> Capture
          </button>
          <button onClick={onRotate} disabled={rotating} className="btn-secondary justify-center">
            {rotating
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <RotateCcw className="w-4 h-4" />}
            {orientation === 'portrait' ? 'Landscape' : 'Portrait'}
          </button>
        </div>
      </section>

      {/* Hardware keys */}
      <section className="panel-pad">
        <SectionTitle icon={<Power className="w-4 h-4" />}>Hardware</SectionTitle>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {HW_KEYS.map((k) => {
            const Icon = k.icon;
            return (
              <button key={k.id} onClick={() => onKey(k.id)} className="btn-secondary flex-col py-3 text-xs gap-1">
                <Icon className="w-4 h-4" />
                {k.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Network */}
      <section className="panel-pad">
        <SectionTitle icon={<Wifi className="w-4 h-4" />}>Network</SectionTitle>
        <div className="grid grid-cols-3 gap-1.5 mt-3">
          {NETWORK_PROFILES.map((p) => {
            const Icon = p.icon;
            const active = networkProfile === p.id;
            return (
              <button key={p.id} onClick={() => onNetwork(p.id)}
                className={`btn justify-center text-xs flex-col py-2 gap-1
                  ${active
                    ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500'
                    : 'bg-ink-700 text-ink-200 hover:bg-ink-600 border border-ink-600'}`}>
                <Icon className="w-3.5 h-3.5" />
                {p.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Battery */}
      <section className="panel-pad">
        <SectionTitle icon={<Battery className="w-4 h-4" />}>Battery</SectionTitle>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-400">Level</span>
            <span className={`font-mono ${batteryLevel < 20 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {batteryLevel}%
            </span>
          </div>
          <input type="range" min="0" max="100" value={batteryLevel}
            onChange={(e) => onBattery(Number(e.target.value))}
            className="w-full accent-indigo-500" />
        </div>
      </section>

      {/* GPS */}
      <section className="panel-pad">
        <SectionTitle icon={<MapPin className="w-4 h-4" />}>GPS</SectionTitle>
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className="input text-xs" placeholder="Lat" value={gpsLat}
              onChange={(e) => onGpsChange(e.target.value, gpsLng)} />
            <input className="input text-xs" placeholder="Lng" value={gpsLng}
              onChange={(e) => onGpsChange(gpsLat, e.target.value)} />
          </div>
          <button onClick={onGpsApply} className="btn-secondary w-full justify-center text-xs">
            Apply coordinates
          </button>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {GPS_PRESETS.map((p) => (
              <button key={p.name} onClick={() => onGpsPreset(p)}
                className="text-xs px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 text-ink-300">
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Open URL */}
      <section className="panel-pad">
        <SectionTitle icon={<Globe className="w-4 h-4" />}>Open URL on device</SectionTitle>
        <div className="mt-3 flex gap-2">
          <input className="input text-xs" placeholder="https://example.com"
            value={openUrlInput} onChange={(e) => onOpenUrlChange(e.target.value)} />
          <button onClick={onOpenUrl} disabled={!openUrlInput.trim()}
            className="btn-secondary px-3 text-xs">
            <LinkIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>
    </div>
  );
}

// ===================================================================
// Small helpers
// ===================================================================
function SectionTitle({ icon, children }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-300">
      <span className="text-indigo-400">{icon}</span>
      {children}
    </div>
  );
}
