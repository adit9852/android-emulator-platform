const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const logger = require('./utils/logger');
const emulatorRoutes = require('./routes/emulator');
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const { initializeDatabase } = require('./database/init');
const { initializeRedis } = require('./utils/redis');
const { initializeDocker } = require('./services/docker');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust first proxy hop (nginx) so req.ip and rate-limiter pick the real client IP
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting — generous because the SPA polls /sessions every 5s.
// Only rate-limit mutating verbs; reads are unmetered for a single-tenant box.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many write requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return writeLimiter(req, res, next);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/emulator', emulatorRoutes);
app.use('/api/upload', uploadRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Android Emulator Platform API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      emulator: '/api/emulator',
      upload: '/api/upload'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      status: err.status || 500
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      status: 404
    }
  });
});

// Initialize services and start server
async function startServer() {
  try {
    logger.info('Initializing services...');
    
    // Initialize database
    await initializeDatabase();
    logger.info('✓ Database initialized');
    
    // Initialize Redis
    await initializeRedis();
    logger.info('✓ Redis initialized');
    
    // Initialize Docker connection
    await initializeDocker();
    logger.info('✓ Docker initialized');
    
    // Start server
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`✓ Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Max concurrent emulators: ${process.env.MAX_CONCURRENT_EMULATORS || 25}`);
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();

module.exports = app;
