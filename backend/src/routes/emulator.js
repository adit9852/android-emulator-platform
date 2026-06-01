const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const {
  getEmulatorStatus,
  listEmulators,
  getContainerStats,
  execInContainer,
} = require('../services/docker');
const { set, get, del, sadd, srem, smembers } = require('../utils/redis');
const { acquire, release, available, listAll } = require('../utils/slotPool');
const { query } = require('../database/init');
const logger = require('../utils/logger');

const ACTIVE_KEY = 'active_sessions';

function publicHost(req) {
  if (process.env.PUBLIC_HOST) return process.env.PUBLIC_HOST;
  return req.hostname;
}

function deriveSlotId(containerName) {
  if (!containerName) return null;
  const m = containerName.match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Reset emulator state between users — sends KEYCODE_HOME so the next user
 * lands on the launcher, and applies perf tweaks (idempotent) that meaningfully
 * cut perceived lag inside the emulator. All best-effort.
 */
const PERF_TWEAKS = [
  // Kill UI animations — pure perceived-smoothness win.
  ['settings', 'put', 'global', 'window_animation_scale', '0'],
  ['settings', 'put', 'global', 'transition_animation_scale', '0'],
  ['settings', 'put', 'global', 'animator_duration_scale', '0'],
  ['settings', 'put', 'secure', 'long_press_timeout', '300'],
  // Drop display from Nexus 5 native (1080x1920 @ 480 dpi) to ~720p @ 320 dpi:
  // ~56% fewer pixels to render and stream via noVNC. Reversible with `wm size reset`.
  ['wm', 'size', '720x1280'],
  ['wm', 'density', '320'],
  // Force max CPU clocks inside Android so it stops scaling down between frames.
  ['cmd', 'power', 'set-fixed-performance-mode-enabled', 'true'],
];

async function adb(containerName, args) {
  return execInContainer(containerName, ['adb', 'shell', ...args]);
}

async function resetSlot(containerName) {
  try {
    await adb(containerName, ['input', 'keyevent', 'KEYCODE_HOME']);
  } catch (err) {
    logger.warn(`HOME keyevent on ${containerName} failed: ${err.message}`);
  }
  for (const cmd of PERF_TWEAKS) {
    try {
      await adb(containerName, cmd);
    } catch (err) {
      logger.warn(`perf tweak ${cmd.join(' ')} on ${containerName} failed: ${err.message}`);
    }
  }
}

/**
 * Create (claim) a session — hands out a pre-warmed slot.
 * POST /api/emulator/session
 */
router.post('/session', async (req, res) => {
  const { timeout = 30 } = req.body || {};
  const sessionId = uuidv4();

  const slot = await acquire();
  if (!slot) {
    const free = await available();
    return res.status(503).json({
      error: 'All emulators are currently busy — please wait for one to free up.',
      free,
      maxConcurrent: parseInt(process.env.MAX_CONCURRENT_EMULATORS || '2', 10),
    });
  }

  try {
    // Hand the user a clean launcher screen.
    await resetSlot(slot.containerName);

    await query(
      `INSERT INTO sessions (id, container_name, container_id, vnc_port, adb_port, device_type, status, timeout_minutes, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        sessionId,
        slot.containerName,
        slot.containerName,
        slot.vncPort,
        slot.adbPort,
        'Nexus 5',
        'active',
        timeout,
        req.ip,
      ]
    );

    const record = {
      sessionId,
      slotId: slot.slotId,
      containerName: slot.containerName,
      vncPort: slot.vncPort,
      adbPort: slot.adbPort,
      device: 'Nexus 5',
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    await set(`session:${sessionId}`, record, timeout * 60);
    await sadd(ACTIVE_KEY, sessionId);

    logger.info(`Session ${sessionId} → slot ${slot.slotId} (${slot.containerName})`);

    res.status(201).json({
      ...record,
      vncUrl: `http://${publicHost(req)}:${slot.vncPort}`,
      timeoutMinutes: timeout,
      message: 'Connected to a pre-warmed emulator. Tap the screen to start.',
    });
  } catch (err) {
    logger.error('Error claiming slot:', err);
    await release(slot);
    res.status(500).json({ error: 'Failed to claim emulator slot', details: err.message });
  }
});

/**
 * Get session status.
 */
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
    const containerStatus = await getEmulatorStatus(containerName);
    res.json({
      sessionId,
      status: containerStatus ? containerStatus.status : 'unknown',
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

/**
 * Release a session — pushes its slot back into the pool (does NOT stop the container).
 */
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
    };

    // Best-effort reset before next user picks up this slot.
    if (slot.containerName) await resetSlot(slot.containerName);

    await query('UPDATE sessions SET status = $1, ended_at = NOW() WHERE id = $2', [
      'released',
      sessionId,
    ]);
    await del(`session:${sessionId}`);
    await srem(ACTIVE_KEY, sessionId);
    if (slot.slotId != null) await release(slot);

    logger.info(`Released session ${sessionId} (slot ${slot.slotId})`);
    res.json({ message: 'Session released', sessionId });
  } catch (err) {
    logger.error('Error releasing session:', err);
    res.status(500).json({ error: 'Failed to release session', details: err.message });
  }
});

/**
 * List active sessions.
 */
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
      maxConcurrent: parseInt(process.env.MAX_CONCURRENT_EMULATORS || '2', 10),
      free: await available(),
      sessions,
    });
  } catch (err) {
    logger.error('Error listing sessions:', err);
    res.status(500).json({ error: 'Failed to list sessions', details: err.message });
  }
});

/**
 * Pool state — useful for debugging.
 */
router.get('/pool', async (req, res) => {
  res.json({
    slots: listAll(),
    free: await available(),
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_EMULATORS || '2', 10),
  });
});

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
