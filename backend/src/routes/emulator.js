const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs/promises');
const path = require('path');

const {
  getEmulatorStatus,
  listEmulators,
  getContainerStats,
  execInContainer,
} = require('../services/docker');
const { set, get, del, sadd, srem, smembers } = require('../utils/redis');
const { acquire, release, available, availableByDevice, listAll } = require('../utils/slotPool');
const { query } = require('../database/init');
const logger = require('../utils/logger');

const ACTIVE_KEY = 'active_sessions';
const APKS_DIR = process.env.UPLOAD_DIR || '/app/apks';

function publicHost(req) {
  if (process.env.PUBLIC_HOST) return process.env.PUBLIC_HOST;
  return req.hostname;
}

function deriveSlotId(name) {
  if (!name) return null;
  const m = name.match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Per-device tweak overrides — controls how heavy each device renders.
 * Override resolutions are chosen to keep each at ~1.1MP which matches the
 * Xvfb-friendly load while preserving the device's native aspect ratio.
 */
const DEVICE_TWEAKS = {
  'Samsung Galaxy S10': { wmSize: '720x1520', wmDensity: '320' },
  'Nexus 5':            { wmSize: '720x1280', wmDensity: '320' },
  'Samsung Galaxy S6':  { wmSize: '720x1280', wmDensity: '320' },
};

const COMMON_TWEAKS = [
  ['settings', 'put', 'global', 'window_animation_scale', '0.75'],
  ['settings', 'put', 'global', 'transition_animation_scale', '0.75'],
  ['settings', 'put', 'global', 'animator_duration_scale', '0.75'],
  ['settings', 'put', 'secure', 'long_press_timeout', '300'],
  ['cmd', 'power', 'set-fixed-performance-mode-enabled', 'true'],
];

async function adb(containerName, args) {
  return execInContainer(containerName, ['adb', 'shell', ...args]);
}

// Per-slot rotation state in Redis. 0=portrait, 1=landscape, 2=upside-down,
// 3=landscape-reversed. `adb emu rotate` only steps +1 clockwise per call, so
// we track absolute state ourselves to compute how many steps to land on a
// requested orientation.
const SLOT_ROT_PREFIX = 'slot_rotation:';
async function getSlotRotation(slotId) {
  const v = await require('../utils/redis').getRedisClient().get(`${SLOT_ROT_PREFIX}${slotId}`);
  return v ? Number(v) : 0;
}
async function setSlotRotation(slotId, value) {
  await require('../utils/redis').getRedisClient().set(`${SLOT_ROT_PREFIX}${slotId}`, String(value));
}

// In-process mutex per slot. Serialises rotate calls so two clicks can't race
// (both reading `current=1`, both rotating 3 steps → 6 total → wrong end state).
const slotLocks = new Map();
async function withSlotLock(slotId, fn) {
  while (slotLocks.get(slotId)) {
    await slotLocks.get(slotId).catch(() => {});
  }
  let release;
  const p = new Promise((r) => (release = r));
  slotLocks.set(slotId, p);
  try {
    return await fn();
  } finally {
    slotLocks.delete(slotId);
    release();
  }
}

async function rotateBy(containerName, steps) {
  for (let i = 0; i < steps; i++) {
    await execInContainer(containerName, ['adb', 'emu', 'rotate']);
  }
}

async function resetSlot(containerName, device, slotId) {
  try {
    await adb(containerName, ['input', 'keyevent', 'KEYCODE_HOME']);
  } catch (err) {
    logger.warn(`HOME keyevent on ${containerName} failed: ${err.message}`);
  }

  // Reset orientation back to portrait between users.
  if (slotId != null) {
    try {
      const current = await getSlotRotation(slotId);
      if (current > 0) {
        await rotateBy(containerName, (4 - current) % 4);
      }
      await setSlotRotation(slotId, 0);
    } catch (err) {
      logger.warn(`rotation reset on ${containerName} failed: ${err.message}`);
    }
  }

  const tweaks = [...COMMON_TWEAKS];
  const dt = DEVICE_TWEAKS[device];
  if (dt) {
    tweaks.push(['wm', 'size', dt.wmSize], ['wm', 'density', dt.wmDensity]);
  }
  for (const cmd of tweaks) {
    try { await adb(containerName, cmd); } catch (err) {
      logger.warn(`tweak ${cmd.join(' ')} on ${containerName} failed: ${err.message}`);
    }
  }
}

// ============================================================
// Pool / device discovery
// ============================================================

/** Return the device list with current availability. */
router.get('/devices', async (req, res) => {
  const slots = listAll();
  const free = await availableByDevice();
  // Aggregate slots by device for the device picker.
  const byDevice = {};
  for (const s of slots) {
    if (!byDevice[s.device]) byDevice[s.device] = { device: s.device, total: 0, free: 0 };
    byDevice[s.device].total += 1;
    byDevice[s.device].free = free[s.device] || 0;
  }
  res.json({ devices: Object.values(byDevice) });
});

/** Pool debug (kept from earlier). */
router.get('/pool', async (req, res) => {
  res.json({
    slots: listAll(),
    free: await available(),
    freeByDevice: await availableByDevice(),
  });
});

// ============================================================
// Session lifecycle
// ============================================================

router.post('/session', async (req, res) => {
  const { device = null, timeout = 30 } = req.body || {};
  const sessionId = uuidv4();

  const slot = await acquire(device);
  if (!slot) {
    return res.status(503).json({
      error: device
        ? `No free '${device}' slot — pick a different device or wait`
        : 'No free emulator slot',
      free: await available(),
      freeByDevice: await availableByDevice(),
    });
  }

  try {
    await resetSlot(slot.containerName, slot.device, slot.slotId);

    await query(
      `INSERT INTO sessions (id, container_name, container_id, vnc_port, adb_port, device_type, status, timeout_minutes, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        sessionId, slot.containerName, slot.containerName,
        slot.vncPort, slot.adbPort, slot.device,
        'active', timeout, req.ip,
      ]
    );

    const record = {
      sessionId,
      slotId: slot.slotId,
      containerName: slot.containerName,
      vncPort: slot.vncPort,
      adbPort: slot.adbPort,
      device: slot.device,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    await set(`session:${sessionId}`, record, timeout * 60);
    await sadd(ACTIVE_KEY, sessionId);

    logger.info(`Session ${sessionId} → slot ${slot.slotId} (${slot.device})`);
    res.status(201).json({
      ...record,
      vncUrl: `http://${publicHost(req)}:${slot.vncPort}`,
      timeoutMinutes: timeout,
      message: `Connected to ${slot.device}.`,
    });
  } catch (err) {
    logger.error('Error claiming slot:', err);
    await release(slot);
    res.status(500).json({ error: 'Failed to claim emulator slot', details: err.message });
  }
});

router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    let session = await get(`session:${sessionId}`);
    if (!session) {
      const result = await query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Session not found' });
      }
      session = result.rows[0];
    }
    const containerName = session.containerName || session.container_name;
    const status = await getEmulatorStatus(containerName);
    res.json({
      sessionId,
      status: status ? status.status : 'unknown',
      vncPort: session.vncPort || session.vnc_port,
      adbPort: session.adbPort || session.adb_port,
      device: session.device || session.device_type,
      createdAt: session.createdAt || session.created_at,
      vncUrl: `http://${publicHost(req)}:${session.vncPort || session.vnc_port}`,
    });
  } catch (err) {
    logger.error('Error getting session:', err);
    res.status(500).json({ error: 'Failed to get session', details: err.message });
  }
});

router.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    let session = await get(`session:${sessionId}`);
    if (!session) {
      const result = await query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Session not found' });
      }
      session = result.rows[0];
    }
    const containerName = session.containerName || session.container_name;
    const slot = {
      slotId: session.slotId ?? deriveSlotId(containerName),
      containerName,
      vncPort: session.vncPort || session.vnc_port,
      adbPort: session.adbPort || session.adb_port,
      device: session.device || session.device_type,
    };
    if (slot.containerName) await resetSlot(slot.containerName, slot.device, slot.slotId);
    await query('UPDATE sessions SET status = $1, ended_at = NOW() WHERE id = $2',
      ['released', sessionId]);
    await del(`session:${sessionId}`);
    await srem(ACTIVE_KEY, sessionId);
    if (slot.slotId != null) await release(slot);
    res.json({ message: 'Session released', sessionId });
  } catch (err) {
    logger.error('Error releasing session:', err);
    res.status(500).json({ error: 'Failed to release session', details: err.message });
  }
});

router.get('/sessions', async (req, res) => {
  try {
    const ids = await smembers(ACTIVE_KEY);
    const sessions = [];
    for (const id of ids) {
      const s = await get(`session:${id}`);
      if (s) sessions.push(s);
    }
    res.json({
      count: sessions.length,
      maxConcurrent: listAll().length,
      free: await available(),
      freeByDevice: await availableByDevice(),
      sessions,
    });
  } catch (err) {
    logger.error('Error listing sessions:', err);
    res.status(500).json({ error: 'Failed to list sessions', details: err.message });
  }
});

// ============================================================
// Developer features: screenshot, rotate
// ============================================================

/**
 * POST /api/emulator/screenshot/:sessionId
 * Captures the current Android screen and returns it as image/png.
 * Strategy: `adb shell screencap -p /sdcard/<f>.png` + adb pull to /tmp/apks
 * (which is shared with the backend container as /app/apks), then stream the
 * file out and delete it.
 */
router.post('/screenshot/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await get(`session:${sessionId}`);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const filename = `cap-${Date.now()}-${uuidv4().slice(0, 8)}.png`;
    const sdcardPath = `/sdcard/${filename}`;
    const sharedPath = `/tmp/apks/${filename}`;
    const backendPath = path.join(APKS_DIR, filename);

    await execInContainer(session.containerName, ['adb', 'shell', 'screencap', '-p', sdcardPath]);
    await execInContainer(session.containerName, ['adb', 'pull', sdcardPath, sharedPath]);
    await execInContainer(session.containerName, ['adb', 'shell', 'rm', sdcardPath]);

    const buf = await fs.readFile(backendPath);
    await fs.unlink(backendPath).catch(() => {});

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="emulator-${session.device.replace(/\W+/g, '_')}-${Date.now()}.png"`);
    res.end(buf);
  } catch (err) {
    logger.error('Screenshot error:', err);
    res.status(500).json({ error: 'Screenshot failed', details: err.message });
  }
});

/**
 * POST /api/emulator/rotate/:sessionId
 * Toggles between portrait (0) and landscape (1) — collapsing the 4 hardware
 * rotation states into a 2-state UI. Backend computes how many `adb emu rotate`
 * 90° steps are needed to land on the target. Tracked per-slot in Redis so
 * resetSlot can always return the next user to portrait.
 */
router.post('/rotate/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await get(`session:${sessionId}`);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const slotId = session.slotId ?? deriveSlotId(session.containerName);
    if (slotId == null) {
      return res.status(500).json({ error: 'Cannot determine slot id' });
    }

    const result = await withSlotLock(slotId, async () => {
      const current = await getSlotRotation(slotId);     // 0|1|2|3
      const target = current % 2 === 0 ? 1 : 0;          // portrait (0,2) → 1, landscape (1,3) → 0
      const steps = (target - current + 4) % 4;
      await rotateBy(session.containerName, steps);
      await setSlotRotation(slotId, target);
      return target;
    });

    res.json({ orientation: result === 0 ? 'portrait' : 'landscape' });
  } catch (err) {
    logger.error('Rotate error:', err);
    res.status(500).json({ error: 'Rotate failed', details: err.message });
  }
});

// ============================================================
// Hardware keys (Home / Back / Recent / Power / Vol Up/Down / Menu)
// ============================================================

const KEY_MAP = {
  HOME: 'KEYCODE_HOME',
  BACK: 'KEYCODE_BACK',
  RECENT: 'KEYCODE_APP_SWITCH',
  POWER: 'KEYCODE_POWER',
  VOLUME_UP: 'KEYCODE_VOLUME_UP',
  VOLUME_DOWN: 'KEYCODE_VOLUME_DOWN',
  MENU: 'KEYCODE_MENU',
  LOCK: 'KEYCODE_SLEEP',
  WAKE: 'KEYCODE_WAKEUP',
};

router.post('/key/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const key = (req.body && req.body.key || '').toUpperCase();
    const code = KEY_MAP[key];
    if (!code) {
      return res.status(400).json({
        error: `Unknown key '${key}'`,
        valid: Object.keys(KEY_MAP),
      });
    }
    const session = await get(`session:${sessionId}`);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    await adb(session.containerName, ['input', 'keyevent', code]);
    res.json({ ok: true, key });
  } catch (err) {
    logger.error('Key error:', err);
    res.status(500).json({ error: 'Key failed', details: err.message });
  }
});

// ============================================================
// Sensor / system simulation: GPS, battery, network, locale, open URL
// ============================================================

router.post('/gps/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { lat, lng } = req.body || {};
    const latN = Number(lat), lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
      return res.status(400).json({ error: 'lat and lng required as numbers' });
    }
    if (latN < -90 || latN > 90 || lngN < -180 || lngN > 180) {
      return res.status(400).json({ error: 'lat/-lng out of range' });
    }
    const session = await get(`session:${sessionId}`);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    // `adb emu geo fix` takes longitude latitude (in that order).
    await execInContainer(session.containerName, [
      'adb', 'emu', 'geo', 'fix', String(lngN), String(latN),
    ]);
    res.json({ ok: true, lat: latN, lng: lngN });
  } catch (err) {
    logger.error('GPS error:', err);
    res.status(500).json({ error: 'GPS failed', details: err.message });
  }
});

router.post('/battery/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const level = Number(req.body?.level);
    if (!Number.isInteger(level) || level < 0 || level > 100) {
      return res.status(400).json({ error: 'level must be 0..100' });
    }
    const session = await get(`session:${sessionId}`);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    await adb(session.containerName, ['dumpsys', 'battery', 'set', 'level', String(level)]);
    // Status: 2=charging, 3=discharging, 5=full
    const status = level >= 100 ? 5 : level <= 20 ? 3 : 2;
    await adb(session.containerName, ['dumpsys', 'battery', 'set', 'status', String(status)]);
    res.json({ ok: true, level, status });
  } catch (err) {
    logger.error('Battery error:', err);
    res.status(500).json({ error: 'Battery failed', details: err.message });
  }
});

const NET_PROFILES = {
  full:    { delay: 'none', speed: 'full' },
  wifi:    { delay: 'none', speed: 'full' },
  '5g':    { delay: 'none', speed: 'lte' },
  '4g':    { delay: 'lte',  speed: 'lte' },
  '3g':    { delay: 'umts', speed: 'umts' },
  edge:    { delay: 'edge', speed: 'edge' },
  gprs:    { delay: 'gprs', speed: 'gprs' },
  offline: { delay: 'none', speed: '0' },
};

router.post('/network/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const profile = String(req.body?.profile || 'full').toLowerCase();
    const cfg = NET_PROFILES[profile];
    if (!cfg) {
      return res.status(400).json({
        error: `Unknown network profile '${profile}'`,
        valid: Object.keys(NET_PROFILES),
      });
    }
    const session = await get(`session:${sessionId}`);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    await execInContainer(session.containerName, ['adb', 'emu', 'network', 'delay', cfg.delay]);
    await execInContainer(session.containerName, ['adb', 'emu', 'network', 'speed', cfg.speed]);
    res.json({ ok: true, profile, ...cfg });
  } catch (err) {
    logger.error('Network error:', err);
    res.status(500).json({ error: 'Network failed', details: err.message });
  }
});

router.post('/url/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const url = req.body?.url;
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'http(s) url required' });
    }
    const session = await get(`session:${sessionId}`);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    await adb(session.containerName, [
      'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url,
    ]);
    res.json({ ok: true, url });
  } catch (err) {
    logger.error('Open URL error:', err);
    res.status(500).json({ error: 'Open URL failed', details: err.message });
  }
});

// ============================================================
// Existing diagnostics
// ============================================================

router.get('/stats/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await get(`session:${sessionId}`);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const stats = await getContainerStats(session.containerName);
    res.json({ sessionId, stats });
  } catch (err) {
    logger.error('Error getting stats:', err);
    res.status(500).json({ error: 'Failed to get stats', details: err.message });
  }
});

router.get('/containers', async (req, res) => {
  try {
    const containers = await listEmulators();
    res.json({ count: containers.length, containers });
  } catch (err) {
    logger.error('Error listing containers:', err);
    res.status(500).json({ error: 'Failed to list containers', details: err.message });
  }
});

module.exports = router;
