const { getRedisClient } = require('./redis');
const logger = require('./logger');

const POOL_KEY = 'slot_pool:available';
const INIT_KEY = 'slot_pool:initialized';
const RESET_KEY = 'slot_pool:reset_token';

function buildSlots() {
  const vncStart = parseInt(process.env.VNC_PORT_START || '6080', 10);
  const adbStart = parseInt(process.env.ADB_PORT_START || '5554', 10);
  const count = parseInt(process.env.MAX_CONCURRENT_EMULATORS || '2', 10);
  const prefix = process.env.SLOT_NAME_PREFIX || 'android-emulator-';
  const slots = [];
  for (let i = 1; i <= count; i++) {
    slots.push({
      slotId: i,
      containerName: `${prefix}${i}`,
      vncPort: vncStart + i - 1,
      adbPort: adbStart + i - 1,
    });
  }
  return slots;
}

/**
 * Seed the available-slot list in Redis. Re-seeds whenever MAX_CONCURRENT_EMULATORS
 * changes (detected via a reset token derived from current config).
 */
async function ensureInitialized() {
  const client = getRedisClient();
  const slots = buildSlots();
  const token = JSON.stringify(slots.map((s) => s.slotId));
  const stored = await client.get(RESET_KEY);
  if (stored === token) return;

  await client.del(POOL_KEY);
  if (slots.length > 0) {
    await client.rPush(POOL_KEY, slots.map((s) => JSON.stringify(s)));
  }
  await client.set(RESET_KEY, token);
  await client.set(INIT_KEY, '1');
  logger.info(`Slot pool initialized with ${slots.length} slots`);
}

async function acquire() {
  await ensureInitialized();
  const client = getRedisClient();
  const raw = await client.lPop(POOL_KEY);
  if (!raw) return null;
  return JSON.parse(raw);
}

async function release(slot) {
  if (!slot || slot.slotId == null) return;
  const client = getRedisClient();
  // Avoid duplicates if release is called twice for the same slot.
  const current = await client.lRange(POOL_KEY, 0, -1);
  const already = current.some((raw) => {
    try { return JSON.parse(raw).slotId === slot.slotId; } catch { return false; }
  });
  if (already) return;
  await client.rPush(POOL_KEY, JSON.stringify(slot));
}

async function available() {
  await ensureInitialized();
  const client = getRedisClient();
  return client.lLen(POOL_KEY);
}

function listAll() {
  return buildSlots();
}

module.exports = { acquire, release, available, listAll };
