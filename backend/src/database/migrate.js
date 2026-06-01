// Standalone migration runner — invoked via `npm run migrate`.
// initializeDatabase() is idempotent (CREATE TABLE IF NOT EXISTS), so this
// is safe to run on every deploy.
require('dotenv').config();
const { initializeDatabase, closeDatabase } = require('./init');
const logger = require('../utils/logger');

(async () => {
  try {
    await initializeDatabase();
    logger.info('Migration complete');
  } catch (err) {
    logger.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
})();
