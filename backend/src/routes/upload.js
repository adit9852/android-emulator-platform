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

    // On success, resolve the package name (aapt) and launch it so the app
    // appears on screen immediately — installed apps otherwise only land in the
    // app drawer, which reads as "nothing happened".
    let packageName = null;
    let launched = false;
    if (success) {
      try {
        const badging = await execInContainer(session.containerName, [
          'bash', '-c',
          `AAPT=$(ls /opt/android/build-tools/*/aapt 2>/dev/null | head -1); "$AAPT" dump badging "${containerPath}" 2>/dev/null | grep -m1 "^package:"`,
        ]);
        const m = badging.match(/name='([^']+)'/);
        packageName = m ? m[1] : null;
        if (packageName) {
          await execInContainer(session.containerName, [
            'adb', 'shell', 'monkey', '-p', packageName,
            '-c', 'android.intent.category.LAUNCHER', '1',
          ]);
          launched = true;
          logger.info(`APK installed + launched: ${packageName} on ${session.containerName}`);
        }
      } catch (e) {
        logger.warn(`launch after install failed: ${e.message}`);
      }
    }

    res.json({
      success,
      apkId,
      sessionId,
      package: packageName,
      launched,
      output: output.trim().slice(-500),
    });
  } catch (err) {
    logger.error('APK install error:', err);
    res.status(500).json({ error: 'Install failed', details: err.message });
  }
});

/**
 * POST /api/upload/apk-url
 * Body: { url: "https://example.com/path/to/app.apk", name?: "MyApp.apk" }
 * Downloads the APK server-side and registers it. Saves a round-trip when the
 * APK is already hosted on GitHub Releases / S3 / your CI artifacts.
 */
router.post('/apk-url', async (req, res) => {
  const { url, name } = req.body || {};
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Provide a valid http(s) URL' });
  }

  const apkId = uuidv4();
  const filename = `${apkId}.apk`;
  const filePath = path.join(UPLOAD_DIR, filename);

  let derivedName = name;
  if (!derivedName) {
    try {
      const u = new URL(url);
      derivedName = path.basename(u.pathname) || 'download.apk';
    } catch {
      derivedName = 'download.apk';
    }
  }
  if (!derivedName.toLowerCase().endsWith('.apk')) {
    derivedName += '.apk';
  }

  let size = 0;
  try {
    const resp = await fetch(url, { redirect: 'follow' });
    if (!resp.ok) {
      return res.status(400).json({ error: `Download failed: ${resp.status} ${resp.statusText}` });
    }
    const declared = Number(resp.headers.get('content-length') || 0);
    if (declared > MAX_MB * 1024 * 1024) {
      return res.status(413).json({ error: `APK too large: ${declared} bytes (max ${MAX_MB} MB)` });
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    size = buffer.length;
    if (size > MAX_MB * 1024 * 1024) {
      return res.status(413).json({ error: `APK too large: ${size} bytes (max ${MAX_MB} MB)` });
    }
    await fs.promises.writeFile(filePath, buffer);
  } catch (err) {
    logger.error('APK URL download failed:', err);
    return res.status(502).json({ error: 'Download failed', details: err.message });
  }

  try {
    await query(
      `INSERT INTO apks (id, filename, original_name, file_size, file_path)
       VALUES ($1, $2, $3, $4, $5)`,
      [apkId, filename, derivedName, size, filePath]
    );
    logger.info(`APK from URL: ${derivedName} (${size} B) → ${apkId}`);
    res.status(201).json({ apkId, filename: derivedName, size });
  } catch (err) {
    logger.error('APK URL DB insert failed:', err);
    try { fs.unlinkSync(filePath); } catch {}
    res.status(500).json({ error: 'Failed to register APK', details: err.message });
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
