const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { query } = require('../database/init');
const { execInContainer } = require('../services/docker');
const { get } = require('../utils/redis');
const logger = require('../utils/logger');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/apks';
const MAX_MB = parseInt(process.env.MAX_APK_SIZE_MB || '200', 10);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}.apk`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.apk')) {
      return cb(new Error('Only .apk files are accepted'));
    }
    cb(null, true);
  },
});

router.get('/health', (req, res) => res.json({ status: 'ok', service: 'upload' }));

/**
 * POST /api/upload/apk  (multipart, field name: "apk")
 * Saves the APK under UPLOAD_DIR with a UUID filename and registers it in Postgres.
 */
router.post('/apk', (req, res) => {
  upload.single('apk')(req, res, async (err) => {
    if (err) {
      logger.warn('APK upload rejected:', err.message);
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const apkId = path.basename(req.file.filename, '.apk');
    try {
      await query(
        `INSERT INTO apks (id, filename, original_name, file_size, file_path)
         VALUES ($1, $2, $3, $4, $5)`,
        [apkId, req.file.filename, req.file.originalname, req.file.size, req.file.path]
      );
      logger.info(`APK uploaded: ${req.file.originalname} (${req.file.size} bytes) → ${apkId}`);
      res.status(201).json({
        apkId,
        filename: req.file.originalname,
        size: req.file.size,
      });
    } catch (dbErr) {
      logger.error('APK DB insert failed:', dbErr);
      try { fs.unlinkSync(req.file.path); } catch {}
      res.status(500).json({ error: 'Failed to register APK', details: dbErr.message });
    }
  });
});

/**
 * POST /api/upload/install
 * Body: { sessionId, apkId }
 * Streams the APK from the shared /tmp/apks mount into the emulator via `adb install`.
 */
router.post('/install', async (req, res) => {
  const { sessionId, apkId } = req.body || {};
  if (!sessionId || !apkId) {
    return res.status(400).json({ error: 'sessionId and apkId are required' });
  }

  const session = await get(`session:${sessionId}`);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const apkResult = await query(
    'SELECT * FROM apks WHERE id = $1 AND is_deleted = false',
    [apkId]
  );
  if (apkResult.rows.length === 0) {
    return res.status(404).json({ error: 'APK not found' });
  }
  const apkRow = apkResult.rows[0];
  const containerPath = `/tmp/apks/${apkRow.filename}`;

  try {
    const output = await execInContainer(session.containerName, [
      'adb', 'install', '-r', '-t', '-g', containerPath,
    ]);
    const success = /Success/i.test(output);
    if (!success) logger.warn(`adb install non-success on ${session.containerName}: ${output}`);

    res.json({
      success,
      apkId,
      sessionId,
      output: output.trim().slice(-500),
    });
  } catch (err) {
    logger.error('APK install error:', err);
    res.status(500).json({ error: 'Install failed', details: err.message });
  }
});

/**
 * GET /api/upload/apks
 * Last 50 uploaded APKs (used to populate the picker in the UI).
 */
router.get('/apks', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, original_name, file_size, uploaded_at
       FROM apks
       WHERE is_deleted = false
       ORDER BY uploaded_at DESC
       LIMIT 50`
    );
    res.json({ apks: result.rows });
  } catch (err) {
    logger.error('APK list failed:', err);
    res.status(500).json({ error: 'Failed to list APKs', details: err.message });
  }
});

/**
 * DELETE /api/upload/apk/:apkId
 * Soft-delete and remove the file from disk.
 */
router.delete('/apk/:apkId', async (req, res) => {
  const { apkId } = req.params;
  try {
    const result = await query(
      'SELECT * FROM apks WHERE id = $1 AND is_deleted = false',
      [apkId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'APK not found' });
    const apk = result.rows[0];

    try { fs.unlinkSync(apk.file_path); } catch (e) {
      logger.warn(`Could not unlink ${apk.file_path}: ${e.message}`);
    }
    await query('UPDATE apks SET is_deleted = true WHERE id = $1', [apkId]);
    res.json({ deleted: apkId });
  } catch (err) {
    logger.error('APK delete failed:', err);
    res.status(500).json({ error: 'Delete failed', details: err.message });
  }
});

module.exports = router;
