import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Smartphone, Home, ArrowLeft, Square, Power, Volume2, VolumeX, Camera, RotateCcw,
  MapPin, Battery, Wifi, WifiOff, Link as LinkIcon, Upload, Download, Trash2, Loader2,
  Check, PlayCircle, StopCircle, Globe, LayoutGrid, Clock, BarChart3, Settings,
  MonitorSmartphone, Menu, ChevronRight,
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

// Vertical hardware toolbar alongside the phone
const TOOLBAR_KEYS = [
  { id: 'HOME',        label: 'Home',   icon: Home },
  { id: 'BACK',        label: 'Back',   icon: ArrowLeft },
  { id: 'RECENT',      label: 'Recent', icon: Square },
  { id: 'POWER',       label: 'Power',  icon: Power },
  { id: 'VOLUME_UP',   label: 'Vol +',  icon: Volume2 },
  { id: 'VOLUME_DOWN', label: 'Vol -',  icon: VolumeX },
];

const NAV_ITEMS = [
  { id: 'sandbox',  label: 'Device Sandbox',  icon: MonitorSmartphone },
  { id: 'apps',     label: 'Apps',            icon: LayoutGrid },
  { id: 'sessions', label: 'Session History', icon: Clock },
  { id: 'reports',  label: 'Reports',         icon: BarChart3 },
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

  // ui
  const [nav, setNav] = useState('sandbox');
  const [showControls, setShowControls] = useState(true);
  const [showDevTools, setShowDevTools] = useState(true);

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
      if (apkInputRef.current) apkInputRef.current.value = '';
      if (activeSession) {
        await handleInstall(r.apkId);
      } else {
        setInstallMsg(`Uploaded ${r.filename}. Start a session, then press Install.`);
      }
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
      if (r.success) {
        setInstallMsg(
          r.launched
            ? `Installed & launched${r.package ? ` ${r.package}` : ''}.`
            : `Installed${r.package ? ` ${r.package}` : ''} — open it from the app drawer.`
        );
      } else {
        setInstallMsg(`Install failed:\n${r.output || ''}`);
      }
    } catch (e) { setInstallMsg(`Install error: ${e.message}`); }
    finally { setInstalling(null); }
  }

  async function handleDeleteApk(apkId) {
    try { await api.deleteApk(apkId); await refreshApks(); }
    catch (e) { setInstallMsg(`Delete error: ${e.message}`); }
  }

  // =========================================================================
  return (
    <div className="app-shell h-full flex">
      <NavRail nav={nav} onNav={setNav} serverInfo={serverInfo} />

      <div className="app-content flex-1 flex flex-col min-w-0">
        <TopBar nav={nav} serverInfo={serverInfo} active={activeSession} orientation={orientation} onStop={() => stopSession()} />

        <div className="workspace flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
          {/* CENTER — phone stage */}
          <main className="stage-area flex-1 min-w-0 min-h-[72vh] lg:min-h-0 animate-slide-up">
            {nav === 'apps' ? (
              <AppsView
                apks={apks} apkInputRef={apkInputRef} uploadProgress={uploadProgress}
                installing={installing} installMsg={installMsg} urlApkInput={urlApkInput}
                urlApkBusy={urlApkBusy} hasSession={!!activeSession}
                onUpload={handleUpload} onUrlChange={setUrlApkInput} onUrlFetch={handleUrlApkFetch}
                onInstall={handleInstall} onDelete={handleDeleteApk}
              />
            ) : nav === 'sessions' ? (
              <SessionsView
                sessions={sessions} activeId={activeSession?.sessionId} serverInfo={serverInfo}
                onOpen={(s) => { setActiveSession({ sessionId: s.sessionId, device: s.device, containerName: s.containerName, slotId: s.slotId, vncPort: s.vncPort, vncUrl: `/stream/${s.slotId}/` }); setNav('sandbox'); }}
                onStop={() => stopSession()} onGoSandbox={() => setNav('sandbox')}
              />
            ) : nav === 'reports' ? (
              <ReportsView serverInfo={serverInfo} devices={devices} sessions={sessions} apks={apks} />
            ) : nav === 'settings' ? (
              <SettingsView
                timeoutMin={timeoutMin} onTimeout={setTimeoutMin}
                showControls={showControls} onToggleControls={() => setShowControls((v) => !v)}
                showDevTools={showDevTools} onToggleDevTools={() => setShowDevTools((v) => !v)}
                serverInfo={serverInfo}
              />
            ) : activeSession ? (
              <PhoneStage
                session={activeSession}
                showControls={showControls}
                rotating={rotating}
                onKey={pressKey}
                onScreenshot={takeScreenshot}
                onRotate={toggleOrientation}
                orientation={orientation}
              />
            ) : (
              <WelcomeStage
                pickedDevice={pickedDevice}
                serverFree={serverInfo.free}
                loading={loading}
                onStart={startSession}
              />
            )}
          </main>

          {/* RIGHT — config panel (sandbox only) */}
          {nav === 'sandbox' && (
          <aside className="config-sidebar w-full lg:w-[324px] flex-shrink-0 lg:order-first lg:overflow-y-auto animate-slide-up delay-1">
            <ConfigPanel
              devices={devices}
              pickedDevice={pickedDevice}
              onPickDevice={setPickedDevice}
              timeoutMin={timeoutMin}
              onTimeout={setTimeoutMin}
              onStart={startSession}
              onStop={() => stopSession()}
              loading={loading}
              serverInfo={serverInfo}
              error={error}
              active={activeSession}
              orientation={orientation}
              showControls={showControls}
              onToggleControls={() => setShowControls((v) => !v)}
              showDevTools={showDevTools}
              onToggleDevTools={() => setShowDevTools((v) => !v)}
              apks={apks}
              apkInputRef={apkInputRef}
              uploadProgress={uploadProgress}
              installing={installing}
              installMsg={installMsg}
              urlApkInput={urlApkInput}
              urlApkBusy={urlApkBusy}
              onUpload={handleUpload}
              onUrlChange={setUrlApkInput}
              onUrlFetch={handleUrlApkFetch}
              onInstall={handleInstall}
              onDelete={handleDeleteApk}
              sessions={sessions}
              activeId={activeSession?.sessionId}
              onOpenSession={(s) =>
                setActiveSession({
                  sessionId: s.sessionId,
                  device: s.device,
                  containerName: s.containerName,
                  slotId: s.slotId,
                  vncPort: s.vncPort,
                  vncUrl: `/stream/${s.slotId}/`,
                })
              }
              networkProfile={networkProfile}
              onNetwork={applyNetwork}
              batteryLevel={batteryLevel}
              onBattery={applyBattery}
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
          )}
        </div>
      </div>
    </div>
  );
}

// ===================================================================
// Left nav rail (collapsible)
// ===================================================================
function NavRail({ nav, onNav, serverInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <nav
      className={`nav-rail hidden md:flex flex-col items-stretch gap-1 py-4 transition-all duration-300 ${open ? 'w-64 px-4' : 'w-[72px] px-3'}`}
    >
      <div className="flex items-center gap-2.5 mb-8 px-1.5">
        <div className="brand-mark w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0">
          <Smartphone className="w-5 h-5" />
        </div>
        {open && (
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight truncate">Emulator</div>
            <div className="text-[11px] text-slate-400 leading-tight">Cloud sandbox</div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {NAV_ITEMS.map((it) => {
          const Icon = it.icon;
          const active = nav === it.id;
          return (
            <button
              key={it.id}
              onClick={() => onNav(it.id)}
              title={it.label}
              className={`${open ? 'justify-start gap-3 px-2.5' : 'justify-center'} nav-item ${open ? 'w-full' : ''} ${active ? 'nav-item-active' : ''}`}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {open && <span className="text-sm font-medium">{it.label}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col gap-1">
        <div className={`${open ? 'px-2.5' : 'px-0 justify-center'} flex items-center gap-2 py-2 text-[11px] text-slate-400`}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
          {open && <span>{serverInfo.free}/{serverInfo.maxConcurrent} devices free</span>}
        </div>
        <button onClick={() => onNav('settings')} title="Settings"
          className={`${open ? 'justify-start gap-3 px-2.5 w-full' : 'justify-center'} nav-item ${nav === 'settings' ? 'nav-item-active' : ''}`}>
          <Settings className="w-5 h-5 flex-shrink-0" />
          {open && <span className="text-sm font-medium">Settings</span>}
        </button>
        <button onClick={() => setOpen((v) => !v)} title={open ? 'Collapse' : 'Expand'}
          className={`${open ? 'justify-start gap-3 px-2.5 w-full' : 'justify-center'} nav-item`}>
          {open ? <ChevronRight className="w-5 h-5 rotate-180 flex-shrink-0" /> : <Menu className="w-5 h-5 flex-shrink-0" />}
          {open && <span className="text-sm font-medium">Collapse</span>}
        </button>
      </div>
    </nav>
  );
}

// ===================================================================
// Top bar
// ===================================================================
const NAV_META = {
  sandbox:  { title: 'Device Sandbox',  sub: 'Pick a device and launch a live Android instance', icon: MonitorSmartphone },
  apps:     { title: 'Apps',            sub: 'Upload, install, and manage APKs',                 icon: LayoutGrid },
  sessions: { title: 'Session History', sub: 'Active and recent device sessions',                icon: Clock },
  reports:  { title: 'Reports',         sub: 'Live capacity and usage',                          icon: BarChart3 },
  settings: { title: 'Settings',        sub: 'Workspace preferences',                            icon: Settings },
};

function TopBar({ nav, serverInfo, active, orientation, onStop }) {
  const meta = NAV_META[nav] || NAV_META.sandbox;
  const Icon = meta.icon;
  const onSandbox = nav === 'sandbox';
  return (
    <header className="top-bar relative z-10 px-6 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <Icon className="w-5 h-5 text-slate-500 flex-shrink-0" />
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold leading-tight tracking-tight truncate">
            {onSandbox && active ? active.device : meta.title}
          </h1>
          <p className="text-[12px] text-slate-500 leading-tight truncate">
            {onSandbox && active ? `Android 11 · ${orientation} · ${active.sessionId.slice(0, 8)}…` : meta.sub}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="chip-emerald">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot" /> Online
        </span>
        <span className="chip-teal font-mono">{serverInfo.free}/{serverInfo.maxConcurrent} free</span>
        {active && (
          <>
            <span className="chip-teal"><span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" /> Live</span>
            <button onClick={onStop} className="btn-danger px-3 py-1.5 text-sm ml-1">
              <StopCircle className="w-4 h-4" /> End
            </button>
          </>
        )}
      </div>
    </header>
  );
}

// ===================================================================
// Phone stage = viewer + vertical control toolbar
// ===================================================================
function PhoneStage({ session, showControls, rotating, onKey, onScreenshot, onRotate, orientation }) {
  return (
    <div className="h-full flex items-stretch justify-center gap-4 min-h-0">
      <div className="flex-1 min-w-0 h-full"><EmulatorViewer session={session} /></div>
      {showControls && (
        <div className="device-toolbar self-center w-[56px] flex-shrink-0 p-2 flex flex-col gap-1.5 overflow-y-auto animate-in-right">
          <button onClick={onScreenshot} className="tool-key"><Camera className="w-4 h-4" />Shot</button>
          <button onClick={onRotate} disabled={rotating} className="tool-key">
            {rotating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            {orientation === 'portrait' ? 'Land' : 'Port'}
          </button>
          <div className="h-px bg-white/5 my-0.5" />
          {TOOLBAR_KEYS.map((k) => {
            const Icon = k.icon;
            return (
              <button key={k.id} onClick={() => onKey(k.id)} className="tool-key">
                <Icon className="w-4 h-4" />{k.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===================================================================
// Emulator viewer (the phone) — box sizing preserved
// ===================================================================
function EmulatorViewer({ session }) {
  // The scrcpy Xvfb is a fixed 720x1520; we JS-size the box to that aspect so it
  // always fits, and the custom phone.html uses noVNC scaleViewport to fill it.
  const RATIO = 720 / 1520;
  const vncSrc = `${(session.vncUrl || '').replace(/\/$/, '')}/phone.html`;
  const areaRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const update = () => {
      const aw = el.clientWidth, ah = el.clientHeight;
      if (aw <= 0 || ah <= 0) return;
      const h = Math.min(ah, aw / RATIO);
      setBox({ w: Math.floor(h * RATIO), h: Math.floor(h) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [RATIO]);

  return (
    <div
      ref={areaRef}
      className="device-canvas h-full min-h-0 flex items-center justify-center overflow-hidden"
    >
      <div
        className="phone-window relative overflow-hidden bg-black"
        style={{ width: box.w || undefined, height: box.h || undefined }}
      >
        <iframe
          key={session.sessionId}
          title="emulator"
          src={vncSrc}
          allow="clipboard-read; clipboard-write"
          className="absolute inset-0 border-0 bg-black"
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
}

// ===================================================================
// Welcome stage (no session) — Tap to Start mockup
// ===================================================================
function WelcomeStage({ pickedDevice, serverFree, loading, onStart }) {
  return (
    <div className="device-canvas h-full min-h-0 flex items-center justify-center p-6 overflow-hidden">
      <div className="relative animate-pop" style={{ aspectRatio: '720 / 1520', height: 'min(620px, 70vh)', maxWidth: '100%' }}>
        <div className="preview-phone absolute inset-0 overflow-hidden flex flex-col items-center justify-center text-center px-8">
          <div className="hidden" />
          <div className="relative w-16 h-16 rounded-2xl bg-white/85 border border-slate-200 flex items-center justify-center mb-5">
            <Smartphone className="w-8 h-8 text-slate-700" />
          </div>
          <h2 className="relative text-xl font-semibold mb-1.5">Ready to launch</h2>
          <p className="relative text-sm text-slate-500 mb-6 max-w-[16rem]">
            Pick a device and start a live Android session.
          </p>
          <button onClick={onStart} disabled={!pickedDevice || serverFree === 0 || loading}
            className="relative btn-primary px-6 py-2.5">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>
              : <><PlayCircle className="w-4 h-4" /> {serverFree === 0 ? 'All devices busy' : 'Tap to Start'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================================================================
// Right config panel
// ===================================================================
function ConfigPanel({
  devices, pickedDevice, onPickDevice, timeoutMin, onTimeout, onStart, onStop, loading, serverInfo, error,
  active, showControls, onToggleControls, showDevTools, onToggleDevTools,
  apks, apkInputRef, uploadProgress, installing, installMsg, urlApkInput, urlApkBusy,
  onUpload, onUrlChange, onUrlFetch, onInstall, onDelete,
  sessions, activeId, onOpenSession,
  networkProfile, onNetwork, batteryLevel, onBattery,
  gpsLat, gpsLng, onGpsChange, onGpsApply, onGpsPreset,
  openUrlInput, onOpenUrlChange, onOpenUrl,
}) {
  const free = devices.find((d) => d.device === pickedDevice)?.free ?? 0;
  return (
    <div>
      {/* Configuration */}
      <section className="config-section">
        <SectionTitle icon={<Settings className="w-4 h-4" />}>Configuration</SectionTitle>
        <div className="mt-3 space-y-3">
          <div>
            <label className="label">Device</label>
            <select className="select" value={pickedDevice} onChange={(e) => onPickDevice(e.target.value)} disabled={!!active}>
              {devices.length === 0 && <option>Loading…</option>}
              {devices.map((d) => (
                <option key={d.device} value={d.device}>
                  {d.device}{d.free === 0 ? ' (in use)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">OS Version</label>
              <select className="select" disabled defaultValue="a11"><option value="a11">Android 11.0</option></select>
            </div>
            <div>
              <label className="label">Timeout</label>
              <input type="number" min={1} max={30} className="input" value={timeoutMin}
                onChange={(e) => onTimeout(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} disabled={!!active} />
            </div>
          </div>
          {!active ? (
            <button onClick={onStart} disabled={loading || !pickedDevice || free === 0} className="btn-primary w-full justify-center py-2.5">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</>
                : <><PlayCircle className="w-4 h-4" /> {free === 0 ? 'Device in use' : 'Start Session'}</>}
            </button>
          ) : (
            <button onClick={onStop} className="btn-danger w-full justify-center py-2.5">
              <StopCircle className="w-4 h-4" /> End Session
            </button>
          )}
          {error && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2">{error}</div>
          )}
        </div>
      </section>

      {/* Display toggles */}
      <section className="config-section">
        <SectionTitle icon={<LayoutGrid className="w-4 h-4" />}>Display</SectionTitle>
        <div className="mt-3 space-y-1">
            <Toggle label="Device controls" desc="Hardware controls" checked={showControls} onChange={onToggleControls} />
            <Toggle label="Developer tools" desc="Network and sensors" checked={showDevTools} onChange={onToggleDevTools} />
        </div>
      </section>

      {/* APK */}
      <section className="config-section">
        <SectionTitle icon={<Upload className="w-4 h-4" />}>Apps</SectionTitle>
        <div className="mt-3 space-y-3">
          <label className="block">
            <div className="upload-dropzone border-2 border-dashed rounded-md p-4 text-center transition-colors cursor-pointer">
              <input ref={apkInputRef} type="file" accept=".apk,application/vnd.android.package-archive"
                onChange={onUpload} disabled={uploadProgress !== null} className="hidden" />
              <Upload className="w-5 h-5 text-ink-400 mx-auto mb-1.5" />
              <div className="text-xs text-ink-300">
                {uploadProgress !== null ? `Uploading… ${uploadProgress}%` : 'Drop or choose an APK'}
              </div>
            </div>
          </label>
          <div className="flex gap-2">
            <input className="input flex-1 text-xs" placeholder="…or paste an APK URL" value={urlApkInput}
              onChange={(e) => onUrlChange(e.target.value)} disabled={urlApkBusy} />
            <button onClick={onUrlFetch} disabled={urlApkBusy || !urlApkInput.trim()} className="btn-secondary px-3">
              {urlApkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </button>
          </div>
          {installMsg && (
            <div className="text-xs bg-ink-900/60 border border-white/10 rounded-lg p-2 text-ink-300 whitespace-pre-wrap">{installMsg}</div>
          )}
          {apks.length === 0 ? (
            <p className="text-xs text-ink-500 text-center py-2">No apps uploaded yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {apks.map((a) => (
                <div key={a.id} className="bg-ink-900/40 rounded-lg p-2 text-xs flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium" title={a.original_name}>{a.original_name}</div>
                    <div className="text-ink-500">{formatBytes(Number(a.file_size))}</div>
                  </div>
                  <button onClick={() => onInstall(a.id)} disabled={!active || installing === a.id}
                    className="btn-ghost px-2 py-1 text-teal-300 hover:bg-teal-500/10">
                    {installing === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => onDelete(a.id)} className="btn-ghost px-2 py-1 text-rose-400 hover:bg-rose-500/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Active sessions */}
      {sessions.length > 0 && (
        <section className="config-section">
          <SectionTitle icon={<Clock className="w-4 h-4" />}>Active sessions</SectionTitle>
          <div className="mt-3 space-y-2">
            {sessions.map((s) => (
              <div key={s.sessionId}
                className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 transition-colors
                  ${activeId === s.sessionId ? 'border-teal-500/60 bg-teal-500/5' : 'border-white/5 bg-ink-900/40 hover:border-white/15'}`}>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{s.device}</div>
                  <div className="text-[11px] text-ink-500 font-mono">{s.sessionId.slice(0, 8)}…</div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => onOpenSession(s)} className="btn-ghost px-2 py-1 text-xs text-teal-300">Open</button>
                  <button onClick={() => onStop()} className="btn-ghost px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10">Stop</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Developer tools / sensors */}
      {showDevTools && (
        <section className="config-section">
          <SectionTitle icon={<Wifi className="w-4 h-4" />}>Developer tools</SectionTitle>
          {!active ? (
            <p className="text-xs text-ink-500 mt-3">Start a session to simulate network, battery, and location.</p>
          ) : (
            <div className="mt-3 space-y-4">
              {/* Network */}
              <div>
                <div className="label">Network</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {NETWORK_PROFILES.map((p) => {
                    const Icon = p.icon;
                    const on = networkProfile === p.id;
                    return (
                      <button key={p.id} onClick={() => onNetwork(p.id)}
                        className={`btn justify-center text-[11px] flex-col py-2 gap-1
                          ${on ? 'bg-teal-500/15 text-teal-200 border border-teal-500/60'
                               : 'bg-ink-700/50 text-ink-300 hover:bg-ink-600/60 border border-white/10'}`}>
                        <Icon className="w-3.5 h-3.5" />{p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Battery */}
              <div>
                <div className="flex items-center justify-between">
                  <div className="label mb-0">Battery</div>
                  <span className={`text-xs font-mono ${batteryLevel < 20 ? 'text-rose-400' : 'text-teal-300'}`}>{batteryLevel}%</span>
                </div>
                <input type="range" min="0" max="100" value={batteryLevel}
                  onChange={(e) => onBattery(Number(e.target.value))} className="w-full mt-1.5 accent-teal-400" />
              </div>
              {/* GPS */}
              <div>
                <div className="label">Location</div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input text-xs" placeholder="Lat" value={gpsLat} onChange={(e) => onGpsChange(e.target.value, gpsLng)} />
                  <input className="input text-xs" placeholder="Lng" value={gpsLng} onChange={(e) => onGpsChange(gpsLat, e.target.value)} />
                </div>
                <button onClick={onGpsApply} className="btn-secondary w-full justify-center text-xs mt-2">
                  <MapPin className="w-3.5 h-3.5" /> Set location
                </button>
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {GPS_PRESETS.map((p) => (
                    <button key={p.name} onClick={() => onGpsPreset(p)}
                      className="text-[11px] px-2 py-1 rounded-md bg-ink-700/50 hover:bg-teal-500/15 hover:text-teal-200 text-ink-300 transition-colors">
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              {/* Open URL */}
              <div>
                <div className="label">Open URL on device</div>
                <div className="flex gap-2">
                  <input className="input text-xs" placeholder="https://example.com" value={openUrlInput}
                    onChange={(e) => onOpenUrlChange(e.target.value)} />
                  <button onClick={onOpenUrl} disabled={!openUrlInput.trim()} className="btn-secondary px-3">
                    <Globe className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ===================================================================
// Small helpers
// ===================================================================
function SectionTitle({ icon, children }) {
  return (
    <div className="section-title flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
      <span className="section-title-icon">{icon}</span>
      {children}
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }) {
  return (
    <button onClick={onChange} className="toggle-row w-full flex items-center justify-between gap-3 py-2 group">
      <div className="text-left min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="toggle-desc text-[11px]">{desc}</div>}
      </div>
      <span className={`toggle-track relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${checked ? 'toggle-track-on' : 'toggle-track-off'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

// ===================================================================
// Full-page nav views (Apps / Sessions / Reports / Settings)
// ===================================================================
function ViewShell({ icon, title, subtitle, children }) {
  return (
    <div className="h-full overflow-y-auto pr-1 animate-slide-up">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-teal-500/15 text-teal-300 flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-ink-400">{subtitle}</p>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent = 'teal' }) {
  const tones = {
    teal: 'text-teal-300', emerald: 'text-emerald-300', amber: 'text-amber-300', rose: 'text-rose-300', slate: 'text-ink-200',
  };
  return (
    <div className="panel-pad">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${tones[accent]}`}>{value}</div>
      {sub && <div className="text-xs text-ink-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function AppsView({
  apks, apkInputRef, uploadProgress, installing, installMsg, urlApkInput, urlApkBusy, hasSession,
  onUpload, onUrlChange, onUrlFetch, onInstall, onDelete,
}) {
  return (
    <ViewShell icon={<LayoutGrid className="w-5 h-5" />} title="Apps" subtitle="Upload, install, and manage APKs">
      <div className="space-y-4">
        <section className="panel-pad">
          <label className="block">
            <div className="border-2 border-dashed border-white/10 rounded-xl p-6 text-center hover:border-teal-500/50 hover:bg-teal-500/5 transition-colors cursor-pointer">
              <input ref={apkInputRef} type="file" accept=".apk,application/vnd.android.package-archive"
                onChange={onUpload} disabled={uploadProgress !== null} className="hidden" />
              <Upload className="w-7 h-7 text-ink-400 mx-auto mb-2" />
              <div className="text-sm text-ink-200 font-medium">
                {uploadProgress !== null ? `Uploading… ${uploadProgress}%` : 'Drop an APK here or click to browse'}
              </div>
              <div className="text-xs text-ink-500 mt-1">Android package (.apk)</div>
            </div>
          </label>
          <div className="flex gap-2 mt-3">
            <input className="input flex-1 text-sm" placeholder="…or paste an APK download URL" value={urlApkInput}
              onChange={(e) => onUrlChange(e.target.value)} disabled={urlApkBusy} />
            <button onClick={onUrlFetch} disabled={urlApkBusy || !urlApkInput.trim()} className="btn-secondary px-3">
              {urlApkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </button>
          </div>
          {installMsg && (
            <div className="text-xs bg-ink-900/60 border border-white/10 rounded-lg p-2 mt-3 text-ink-300 whitespace-pre-wrap">{installMsg}</div>
          )}
          {!hasSession && (
            <div className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2 mt-3">
              Start a session in <span className="font-semibold">Device Sandbox</span> to install apps onto a device.
            </div>
          )}
        </section>

        <section className="panel-pad">
          <SectionTitle icon={<LayoutGrid className="w-4 h-4" />}>Library ({apks.length})</SectionTitle>
          {apks.length === 0 ? (
            <p className="text-sm text-ink-500 text-center py-8">No apps uploaded yet.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2 mt-3">
              {apks.map((a) => (
                <div key={a.id} className="bg-ink-900/40 rounded-xl p-3 flex items-center gap-3 border border-white/5">
                  <div className="w-9 h-9 rounded-lg bg-teal-500/15 text-teal-300 flex items-center justify-center flex-shrink-0">
                    <Smartphone className="w-4.5 h-4.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium" title={a.original_name}>{a.original_name}</div>
                    <div className="text-[11px] text-ink-500">{formatBytes(Number(a.file_size))}</div>
                  </div>
                  <button onClick={() => onInstall(a.id)} disabled={!hasSession || installing === a.id}
                    title={hasSession ? 'Install on device' : 'Start a session first'}
                    className="btn-ghost px-2 py-1 text-teal-300 hover:bg-teal-500/10 disabled:opacity-40">
                    {installing === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  </button>
                  <button onClick={() => onDelete(a.id)} className="btn-ghost px-2 py-1 text-rose-400 hover:bg-rose-500/10">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </ViewShell>
  );
}

function SessionsView({ sessions, activeId, serverInfo, onOpen, onStop, onGoSandbox }) {
  return (
    <ViewShell icon={<Clock className="w-5 h-5" />} title="Session History"
      subtitle={`${sessions.length} active · ${serverInfo.free}/${serverInfo.maxConcurrent} devices free`}>
      {sessions.length === 0 ? (
        <section className="panel-pad text-center py-12">
          <Clock className="w-8 h-8 text-ink-500 mx-auto mb-3" />
          <p className="text-sm text-ink-300 font-medium">No active sessions</p>
          <p className="text-xs text-ink-500 mt-1 mb-4">Launch a device to start a session.</p>
          <button onClick={onGoSandbox} className="btn-primary mx-auto"><PlayCircle className="w-4 h-4" /> Go to Device Sandbox</button>
        </section>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <section key={s.sessionId}
              className={`panel-pad flex items-center justify-between gap-3 ${activeId === s.sessionId ? 'ring-1 ring-teal-500/50' : ''}`}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-teal-500/15 text-teal-300 flex items-center justify-center flex-shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {s.device}
                    {activeId === s.sessionId && <span className="chip-teal text-[10px] py-0">viewing</span>}
                  </div>
                  <div className="text-[11px] text-ink-500 font-mono truncate">{s.sessionId}</div>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => onOpen(s)} className="btn-secondary px-3 py-1.5 text-xs"><PlayCircle className="w-3.5 h-3.5" /> Open</button>
                <button onClick={onStop} className="btn-ghost px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10"><StopCircle className="w-3.5 h-3.5" /> Stop</button>
              </div>
            </section>
          ))}
        </div>
      )}
    </ViewShell>
  );
}

function ReportsView({ serverInfo, devices, sessions, apks }) {
  const total = serverInfo.maxConcurrent ?? devices.length;
  const inUse = (serverInfo.maxConcurrent ?? 0) - (serverInfo.free ?? 0);
  const utilization = total ? Math.round((inUse / total) * 100) : 0;
  return (
    <ViewShell icon={<BarChart3 className="w-5 h-5" />} title="Reports" subtitle="Live capacity and usage">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard label="Devices free" value={serverInfo.free ?? 0} sub={`of ${total}`} accent="emerald" />
        <StatCard label="In use" value={inUse < 0 ? 0 : inUse} sub={`${utilization}% utilization`} accent={inUse > 0 ? 'amber' : 'slate'} />
        <StatCard label="Active sessions" value={sessions.length} accent="teal" />
        <StatCard label="Apps in library" value={apks.length} accent="slate" />
      </div>
      <section className="panel-pad">
        <SectionTitle icon={<MonitorSmartphone className="w-4 h-4" />}>Device pool</SectionTitle>
        <div className="mt-3 space-y-2">
          {devices.length === 0 && <p className="text-sm text-ink-500">Loading device pool…</p>}
          {devices.map((d) => {
            const busy = d.free === 0;
            return (
              <div key={d.device} className="flex items-center justify-between gap-3 bg-ink-900/40 rounded-xl p-3 border border-white/5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${busy ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                  <span className="text-sm font-medium truncate">{d.device}</span>
                </div>
                <span className={busy ? 'chip-amber' : 'chip-emerald'}>{busy ? 'In use' : 'Available'}</span>
              </div>
            );
          })}
        </div>
      </section>
    </ViewShell>
  );
}

function SettingsView({ timeoutMin, onTimeout, showControls, onToggleControls, showDevTools, onToggleDevTools, serverInfo }) {
  return (
    <ViewShell icon={<Settings className="w-5 h-5" />} title="Settings" subtitle="Workspace preferences">
      <div className="space-y-4">
        <section className="panel-pad">
          <SectionTitle icon={<Clock className="w-4 h-4" />}>Session defaults</SectionTitle>
          <div className="mt-3 max-w-[220px]">
            <label className="label">Default timeout (min)</label>
            <input type="number" min={1} max={30} className="input" value={timeoutMin}
              onChange={(e) => onTimeout(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} />
            <p className="text-[11px] text-ink-500 mt-1.5">Sessions end automatically after this many minutes (capped at 30).</p>
          </div>
        </section>
        <section className="panel-pad">
          <SectionTitle icon={<LayoutGrid className="w-4 h-4" />}>Interface</SectionTitle>
          <div className="mt-2 space-y-1">
          <Toggle label="Device controls" desc="Hardware controls" checked={showControls} onChange={onToggleControls} />
          <Toggle label="Developer tools" desc="Network and sensors" checked={showDevTools} onChange={onToggleDevTools} />
          </div>
        </section>
        <section className="panel-pad">
          <SectionTitle icon={<Settings className="w-4 h-4" />}>About</SectionTitle>
          <dl className="mt-3 text-sm space-y-2">
            <div className="flex justify-between"><dt className="text-ink-400">Platform</dt><dd className="font-medium">Android Cloud Emulator</dd></div>
            <div className="flex justify-between"><dt className="text-ink-400">Android version</dt><dd className="font-medium">11.0 (API 30)</dd></div>
            <div className="flex justify-between"><dt className="text-ink-400">Capacity</dt><dd className="font-medium">{serverInfo.maxConcurrent ?? '—'} concurrent devices</dd></div>
            <div className="flex justify-between"><dt className="text-ink-400">Streaming</dt><dd className="font-medium">scrcpy · noVNC</dd></div>
          </dl>
        </section>
      </div>
    </ViewShell>
  );
}
