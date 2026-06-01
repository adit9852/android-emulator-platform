// Custom scrcpy bridge — spawns `scrcpy` + `ffmpeg` per WS connection and
// streams fragmented MP4 (H.264) to the browser. Browser plays it with the
// MediaSource Extensions API (no JS decoder needed — the GPU does it).
//
// Input back-channel: browser sends JSON over the same WS; bridge converts to
// `adb shell input tap/swipe/keyevent` on the device.

const http = require('http');
const { spawn, exec, execSync } = require('child_process');
const { WebSocketServer } = require('ws');
const url = require('url');

const PORT = 8000;
const ALLOWED_HOSTS = (process.env.EMU_HOSTS || '').split(/\s+/).filter(Boolean);

function log(...a) { console.log(new Date().toISOString(), ...a); }

// --- Bootstrap: ADB server + register each emulator host -------------------
function setupAdb() {
  try { execSync('adb kill-server', { stdio: 'ignore' }); } catch {}
  execSync('adb start-server');
  for (const h of ALLOWED_HOSTS) {
    for (let i = 0; i < 30; i++) {
      try {
        const out = execSync(`adb connect ${h}:5555`, { encoding: 'utf8' });
        if (out.includes('connected') || out.includes('already connected')) {
          log(`adb registered ${h}:5555`);
          break;
        }
      } catch {}
      execSync('sleep 2');
    }
  }
  try {
    log('adb devices:\n' + execSync('adb devices', { encoding: 'utf8' }));
  } catch {}
}
setupAdb();
// Re-register every 30s in case an emulator was restarted.
setInterval(() => {
  for (const h of ALLOWED_HOSTS) {
    try { execSync(`adb connect ${h}:5555`, { stdio: 'ignore' }); } catch {}
  }
}, 30_000);

// --- HTTP server (health + minimal player demo) ----------------------------
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      devices: execSync('adb devices', { encoding: 'utf8' }),
    }));
  }
  res.writeHead(404).end('not found');
});

// --- WebSocket server ------------------------------------------------------
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const params = url.parse(req.url, true).query;
  const udid = String(params.udid || '');
  if (!udid || !ALLOWED_HOSTS.some((h) => udid.startsWith(h))) {
    log('reject WS: bad udid', udid);
    ws.close(1008, 'invalid udid');
    return;
  }
  log('WS open', udid);

  // Stream Android's built-in screenrecord directly over adb exec-out.
  // screenrecord has a 180-second hard limit per invocation, so we restart it
  // in a loop until the WebSocket closes.
  let stopped = false;
  let currentRec = null;
  let currentFf = null;

  function startSegment() {
    if (stopped || ws.readyState !== ws.OPEN) return;

    const rec = spawn('adb', [
      '-s', udid, 'exec-out',
      'screenrecord',
      '--output-format=h264',
      '--size=720x1520',
      '--bit-rate=4000000',
      '--time-limit=170',
      '-',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    rec.stderr.on('data', (d) => log('[screenrecord]', d.toString().trim()));
    rec.on('exit', (code) => {
      log('screenrecord exit', code, '— restarting');
      currentRec = null;
      if (!stopped) startSegment();
    });

    const ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'warning',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-fflags', '+nobuffer+flush_packets',
      '-flags', 'low_delay',
      '-f', 'h264',
      '-i', 'pipe:0',
      '-c:v', 'copy',
      '-an',
      '-f', 'mp4',
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset',
      '-frag_duration', '100',
      '-flush_packets', '1',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    ff.stderr.on('data', (d) => log('[ffmpeg]', d.toString().trim()));
    ff.on('exit', (code) => log('ffmpeg exit', code));

    let scrcpyBytes = 0, ffBytes = 0;
    rec.stdout.on('data', (chunk) => {
      scrcpyBytes += chunk.length;
      try { ff.stdin.write(chunk); } catch (e) { log('ff stdin write err', e.message); }
    });
    rec.stdout.on('end', () => {
      log(`screenrecord wrote ${scrcpyBytes} bytes total`);
      try { ff.stdin.end(); } catch {}
    });
    ff.stdout.on('data', (chunk) => {
      ffBytes += chunk.length;
      if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
    });
    const counter = setInterval(() => {
      if (rec.exitCode != null) { clearInterval(counter); return; }
      log(`bytes: screenrecord=${scrcpyBytes} ffmpeg=${ffBytes}`);
    }, 3000);
    rec.on('exit', () => clearInterval(counter));

    currentRec = rec;
    currentFf = ff;
  }
  startSegment();

  // Input back-channel
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || !msg.type) return;
    try {
      if (msg.type === 'tap' && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
        exec(`adb -s ${udid} shell input tap ${Math.round(msg.x)} ${Math.round(msg.y)}`);
      } else if (msg.type === 'swipe' && Number.isFinite(msg.x1)) {
        const { x1, y1, x2, y2, ms = 200 } = msg;
        exec(`adb -s ${udid} shell input swipe ${x1|0} ${y1|0} ${x2|0} ${y2|0} ${ms|0}`);
      } else if (msg.type === 'text' && typeof msg.text === 'string') {
        const safe = msg.text.replace(/[^a-zA-Z0-9 _.,!?@-]/g, '');
        exec(`adb -s ${udid} shell input text ${JSON.stringify(safe)}`);
      } else if (msg.type === 'key' && typeof msg.key === 'string') {
        const KEYS = new Set(['HOME','BACK','APP_SWITCH','POWER','VOLUME_UP','VOLUME_DOWN','MENU','ENTER','DEL']);
        if (KEYS.has(msg.key)) exec(`adb -s ${udid} shell input keyevent KEYCODE_${msg.key}`);
      }
    } catch (err) {
      log('input error:', err.message);
    }
  });

  ws.on('close', () => {
    log('WS close', udid);
    stopped = true;
    try { currentRec && currentRec.kill('SIGTERM'); } catch {}
    try { currentFf && currentFf.kill('SIGTERM'); } catch {}
    try { execSync(`adb -s ${udid} shell pkill -f screenrecord`, { stdio: 'ignore' }); } catch {}
  });
});

server.listen(PORT, '0.0.0.0', () => log(`bridge listening on :${PORT}`));
