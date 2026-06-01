const { getRedisClient } = require('./redis');
const logger = require('./logger');

const POOL_KEY = 'slot_pool:available';
const RESET_KEY = 'slot_pool:reset_token';

/**
 * EMULATOR_SLOTS env (JSON) — definitive source of truth for the pool.
 * Example:
 *   [
 *     {"slotId":1,"device":"Samsung Galaxy S10","containerName":"android-emulator-1","vncPort":6080,"adbPort":5554},
 *     {"slotId":2,"device":"Nexus 5",          "containerName":"android-emulator-2","vncPort":6081,"adbPort":5555},
 *     ...
 *   ]
 *
 * Fallback (legacy): if EMULATOR_SLOTS isn't set, derive from
 * MAX_CONCURRENT_EMULATORS + VNC_PORT_START + ADB_PORT_START, single device.
 */
function buildSlots() {
  const json = process.env.EMULATOR_SLOTS;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) throw new Error('EMULATOR_SLOTS must be a JSON array');
      return parsed;
    } catch (e) {
      logger.error(`EMULATOR_SLOTS parse failed (${e.message}), falling back to derived slots.`);
    }
  }
  const vncStart = parseInt(process.env.VNC_PORT_START || '6080', 10);
  const adbStart = parseInt(process.env.ADB_PORT_START || '5554', 10);
  const count = parseInt(process.env.MAX_CONCURRENT_EMULATORS || '1', 10);
  const prefix = process.env.SLOT_NAME_PREFIX || 'android-emulator-';
  const device = process.env.EMULATOR_DEVICE_DEFAULT || 'Samsung Galaxy S10';
  const slots = [];
  for (let i = 1; i <= count; i++) {
    slots.push({
      slotId: i,
      device,
      containerName: `${prefix}${i}`,
      vncPort: vncStart + i - 1,
      adbPort: adbStart + i - 1,
    });
  }
  return slots;
}

async function ensureInitialized() {
  const client = getRedisClient();
  const slots = buildSlots();
  // Token covers device+id so changing the device line forces a reseed.
  const token = JSON.stringify(slots.map((s) => `${s.slotId}:${s.device}`));
  const stored = await client.get(RESET_KEY);
  if (stored === token) return;
  await client.del(POOL_KEY);
  if (slots.length > 0) {
    await client.rPush(POOL_KEY, slots.map((s) => JSON.stringify(s)));
  }
  await client.set(RESET_KEY, token);
  logger.info(`Slot pool seeded with ${slots.length} slots: ${slots.map((s) => `${s.slotId}=${s.device}`).join(', ')}`);
}

/**
 * Acquire a slot. If `device` is provided, only a matching slot is returned.
 * Returns null if none free (or none matching).
 */
async function acquire(device = null) {
  await ensureInitialized();
  const client = getRedisClient();

  if (!device) {
    const raw = await client.lPop(POOL_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  // Scan + remove the first match.
  const all = await client.lRange(POOL_KEY, 0, -1);
  for (let i = 0; i < all.length; i++) {
    const slot = JSON.parse(all[i]);
    if (slot.device === device) {
      // LREM count=1 removes first occurrence
      await client.lRem(POOL_KEY, 1, all[i]);
      return slot;
    }
  }
  return null;
}

async function release(slot) {
  if (!slot || slot.slotId == null) return;
  const client = getRedisClient();
  const all = await client.lRange(POOL_KEY, 0, -1);
  const already = all.some((raw) => {
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

async function availableByDevice() {
  await ensureInitialized();
  const client = getRedisClient();
  const all = await client.lRange(POOL_KEY, 0, -1);
  const map = {};
  for (const raw of all) {
    try {
      const s = JSON.parse(raw);
      map[s.device] = (map[s.device] || 0) + 1;
    } catch {}
  }
  return map;
}

function listAll() {
  return buildSlots();
}

module.exports = { acquire, release, available, availableByDevice, listAll };
