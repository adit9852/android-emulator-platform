const express = require('express');
const router = express.Router();

/**
 * Upload routes (placeholder for future implementation)
 * For now, we'll skip APK upload to get the platform running quickly
 */

// Health check for upload service
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'upload' });
});

// TODO: Implement these routes when adding APK upload
// router.post('/apk', upload.single('apk'), async (req, res) => { ... });
// router.get('/apk/:apkId', async (req, res) => { ... });
// router.delete('/apk/:apkId', async (req, res) => { ... });

module.exports = router;
