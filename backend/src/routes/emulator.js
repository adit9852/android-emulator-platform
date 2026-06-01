const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const {
  startEmulator,
  stopEmulator,
  getEmulatorStatus,
  listEmulators,
  getContainerStats,
} = require('../services/docker');
const { set, get, del, sadd, srem, smembers } = require('../utils/redis');
const { acquire, release, available } = require('../utils/portPool');
const { query } = require('../database/init');
const logger = require('../utils/logger');

const ACTIVE_KEY = 'active_sessions';

function publicHost(req) {
  // PUBLIC_HOST overrides everything — useful when behind nginx on a VPS.
  if (process.env.PUBLIC_HOST) return process.env.PUBLIC_HOST;
  return req.hostname;
}

/**
 * Create a new emulator session.
 * POST /api/emulator/session
 */
router.post('/session', async (req, res) => {
  const { device = 'Samsung Galaxy S10', timeout = 30 } = req.body || {};
  const sessionId = uuidv4();

  const ports = await acquire();
  if (!ports) {
    const freeCount = await available();
    return res.status(503).json({
      error: 'All emulator slots are currently in use',
      free: freeCount,
      maxConcurrent: parseInt(process.env.MAX_CONCURRENT_EMULATORS || '25', 10),
    });
  }

  try {
    logger.info(`Starting emulator session ${sessionId} on vnc=${ports.vncPort}`);
    const emulator = await startEmulator(sessionId, {
      device,
      timeout: timeout * 60,
      vncPort: ports.vncPort,
      adbPort: ports.adbPort,
      memoryGB: parseInt(process.env.EMULATOR_RAM_GB || '3', 10),
      cpus: parseInt(process.env.EMULATOR_CPU_CORES || '2', 10),
    });

    await query(
      `INSERT INTO sessions (id, container_name, container_id, vnc_port, adb_port, device_type, status, timeout_minutes, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        sessionId,
        emulator.containerName,
        emulator.containerId,
        ports.vncPort,
        ports.adbPort,
        device,
        'starting',
        timeout,
        req.ip,
      ]
    );

    const sessionRecord = {
      sessionId,
      containerName: emulator.containerName,
      vncPort: ports.vncPort,
      adbPort: ports.adbPort,
      device,
      status: 'starting',
      createdAt: new Date().toISOString(),
    };

    await set(`session:${sessionId}`, sessionRecord, timeout * 60);
    await sadd(ACTIVE_KEY, sessionId);

    res.status(201).json({
      ...sessionRecord,
      vncUrl: `http://${publicHost(req)}:${ports.vncPort}`,
      timeoutMinutes: timeout,
      message: 'Emulator is starting. It may take 60–120s to be ready.',
    });
  } catch (error) {
    logger.error('Error creating emulator session:', error);
    // Roll back port allocation so the slot doesn't leak.
    await release(ports);
    res.status(500).json({
      error: 'Failed to create emulator session',
      details: error.message,
    });
  }
});

/**
 * Get session status.
 * GET /api/emulator/session/:sessionId
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
      status: containerStatus ? containerStatus.status : 'stopped',
      vncPort: session.vncPort || session.vnc_port,
      adbPort: session.adbPort || session.adb_port,
      device: session.device || session.device_type,
      createdAt: session.createdAt || session.created_at,
      vncUrl: `http://${publicHost(req)}:${session.vncPort || session.vnc_port}`,
    });
  } catch (error) {
    logger.error('Error getting session status:', error);
    res.status(500).json({ error: 'Failed to get session status', details: error.message });
  }
});

/**
 * Stop emulator session.
 * DELETE /api/emulator/session/:sessionId
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

    const containerName =
      session.containerName ||
      session.container_name ||
      `android-emulator-${sessionId}`;
    const vncPort = session.vncPort || session.vnc_port;
    const adbPort = session.adbPort || session.adb_port;

    await stopEmulator(containerName);

    await query('UPDATE sessions SET status = $1, ended_at = NOW() WHERE id = $2', [
      'stopped',
      sessionId,
    ]);

    await del(`session:${sessionId}`);
    await srem(ACTIVE_KEY, sessionId);
    if (vncPort && adbPort) await release({ vncPort, adbPort });

    logger.info(`Stopped emulator session ${sessionId}`);
    res.json({ message: 'Session stopped successfully', sessionId });
  } catch (error) {
    logger.error('Error stopping session:', error);
    res.status(500).json({ error: 'Failed to stop session', details: error.message });
  }
});

/**
 * List all active sessions.
 * GET /api/emulator/sessions
 */
router.get('/sessions', async (req, res) => {
  try {
    const activeSessions = await smembers(ACTIVE_KEY);
    const sessions = [];

    for (const sessionId of activeSessions) {
      const session = await get(`session:${sessionId}`);
      if (session) sessions.push(session);
    }

    res.json({
      count: sessions.length,
      maxConcurrent: parseInt(process.env.MAX_CONCURRENT_EMULATORS || '25', 10),
      sessions,
    });
  } catch (error) {
    logger.error('Error listing sessions:', error);
    res.status(500).json({ error: 'Failed to list sessions', details: error.message });
  }
});

router.get('/stats/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await get(`session:${sessionId}`);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const stats = await getContainerStats(session.containerName);
    res.json({ sessionId, stats });
  } catch (error) {
    logger.error('Error getting emulator stats:', error);
    res.status(500).json({ error: 'Failed to get stats', details: error.message });
  }
});

router.get('/containers', async (req, res) => {
  try {
    const containers = await listEmulators();
    res.json({ count: containers.length, containers });
  } catch (error) {
    logger.error('Error listing containers:', error);
    res.status(500).json({ error: 'Failed to list containers', details: error.message });
  }
});

module.exports = router;
