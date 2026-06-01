const { getRedisClient } = require('./redis');
const logger = require('./logger');

const POOL_KEY = 'port_pool:available';
const POOL_INIT_KEY = 'port_pool:initialized';

/**
 * Lazily initialize the pool of (vncPort, adbPort) pairs in Redis.
 * Idempotent — first caller seeds, subsequent calls no-op.
 */
async function ensureInitialized() {
  const client = getRedisClient();
  const initialized = await client.get(POOL_INIT_KEY);
  if (initialized) return;

  const vncStart = parseInt(process.env.VNC_PORT_START || '6080', 10);
  const adbStart = parseInt(process.env.ADB_PORT_START || '5554', 10);
  const max = parseInt(process.env.MAX_CONCURRENT_EMULATORS || '25', 10);

  const slots = [];
  for (let i = 0; i < max; i++) {
    slots.push(JSON.stringify({ vncPort: vncStart + i, adbPort: adbStart + i }));
  }
  await client.del(POOL_KEY);
  if (slots.length > 0) await client.rPush(POOL_KEY, slots);
  await client.set(POOL_INIT_KEY, '1');
  logger.info(`Port pool initialized with ${slots.length} slots`);
}

/**
 * Acquire a free port pair. Returns null if pool is exhausted.
 */
async function acquire() {
  await ensureInitialized();
  const client = getRedisClient();
  const raw = await client.lPop(POOL_KEY);
  if (!raw) return null;
  return JSON.parse(raw);
}

/**
 * Release a port pair back into the pool.
 */
async function release(ports) {
  if (!ports || ports.vncPort == null) return;
  const client = getRedisClient();
  await client.rPush(POOL_KEY, JSON.stringify(ports));
}

/**
 * How many slots remain free.
 */
async function available() {
  await ensureInitialized();
  const client = getRedisClient();
  return client.lLen(POOL_KEY);
}

module.exports = { acquire, release, available };
