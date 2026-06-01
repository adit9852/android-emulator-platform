const express = require('express');
const router = express.Router();

/**
 * Simple auth routes (placeholder for future implementation)
 * For now, we'll skip authentication to get the platform running quickly
 */

// Health check for auth service
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'auth' });
});

// TODO: Implement these routes when adding authentication
// router.post('/register', async (req, res) => { ... });
// router.post('/login', async (req, res) => { ... });
// router.post('/logout', async (req, res) => { ... });
// router.get('/me', async (req, res) => { ... });

module.exports = router;
