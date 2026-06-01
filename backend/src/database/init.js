const { Pool } = require('pg');
const logger = require('../utils/logger');

let pool = null;

/**
 * Initialize PostgreSQL connection pool
 */
async function initializeDatabase() {
  try {
    const connectionString = process.env.DATABASE_URL || 
      'postgresql://emulator_admin:password@localhost:5432/emulator_platform';
    
    pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    
    logger.info('Database connection established');
    
    // Create tables if they don't exist
    await createTables();
    
    return pool;
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Get database pool instance
 */
function getPool() {
  if (!pool) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return pool;
}

/**
 * Create database tables
 */
async function createTables() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        role VARCHAR(50) DEFAULT 'user'
      )
    `);
    
    // Sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        container_name VARCHAR(255),
        container_id VARCHAR(255),
        vnc_port INTEGER,
        adb_port INTEGER,
        device_type VARCHAR(100),
        status VARCHAR(50) DEFAULT 'starting',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP,
        ended_at TIMESTAMP,
        timeout_minutes INTEGER DEFAULT 30,
        ip_address VARCHAR(45)
      )
    `);
    
    // APKs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS apks (
        id UUID PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_size BIGINT,
        file_path VARCHAR(500),
        package_name VARCHAR(255),
        version_name VARCHAR(100),
        version_code INTEGER,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_deleted BOOLEAN DEFAULT false
      )
    `);
    
    // Usage logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        session_id UUID REFERENCES sessions(id),
        action VARCHAR(100),
        details JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Billing table (for future monetization)
    await client.query(`
      CREATE TABLE IF NOT EXISTS billing (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        amount DECIMAL(10, 2),
        currency VARCHAR(3) DEFAULT 'USD',
        description TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        payment_method VARCHAR(50),
        transaction_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMP
      )
    `);
    
    // Create indexes
    await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_apks_user_id ON apks(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_usage_logs_session_id ON usage_logs(session_id)');
    
    await client.query('COMMIT');
    logger.info('Database tables created/verified successfully');
    
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error creating database tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Execute a query
 */
async function query(text, params) {
  try {
    const start = Date.now();
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    logger.debug('Executed query', { text, duration, rows: result.rowCount });
    return result;
  } catch (error) {
    logger.error('Database query error:', { text, error: error.message });
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 */
async function getClient() {
  return await pool.connect();
}

/**
 * Close database connection
 */
async function closeDatabase() {
  try {
    if (pool) {
      await pool.end();
      logger.info('Database connection closed');
    }
  } catch (error) {
    logger.error('Error closing database connection:', error);
  }
}

module.exports = {
  initializeDatabase,
  getPool,
  query,
  getClient,
  closeDatabase
};
