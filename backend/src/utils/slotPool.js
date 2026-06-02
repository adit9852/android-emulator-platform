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

const SEED_LOCK = 'slot_pool:seedlock';

async function ensureInitialized() {
  const client = getRedisClient();
  const slots = buildSlots();
  // Token covers device+id so changing the device line forces a reseed.
  const token = JSON.stringify(slots.map((s) => `${s.slotId}:${s.device}`));
  if ((await client.get(RESET_KEY)) === token) return;

  // Seeding lock so concurrent callers (the 5s frontend poll hits several
  // endpoints at once) can't each del+rPush and produce DUPLICATE slots —
  // which previously let two sessions land on the same emulator.
  const gotLock = await client.set(SEED_LOCK, token, { NX: true, PX: 8000 });
  if (!gotLock) {
    // Another caller is seeding — wait until the token is published.
    for (let i = 0; i < 60; i++) {
      if ((await client.get(RESET_KEY)) === token) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    return;
  }
  try {
    if ((await client.get(RESET_KEY)) === token) return; // double-check inside lock
    await client.del(POOL_KEY);
    if (slots.length > 0) {
      await client.rPush(POOL_KEY, slots.map((s) => JSON.stringify(s)));
    }
    await client.set(RESET_KEY, token);
    logger.info(`Slot pool seeded with ${slots.length} slots: ${slots.map((s) => `${s.slotId}=${s.device}`).join(', ')}`);
  } finally {
    await client.del(SEED_LOCK);
  }
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

  // Scan for a matching slot and claim it atomically: only the caller whose
  // LREM actually removed the entry gets the slot. This prevents two concurrent
  // claims for the same device from both receiving the same emulator.
  const all = await client.lRange(POOL_KEY, 0, -1);
  for (let i = 0; i < all.length; i++) {
    const slot = JSON.parse(all[i]);
    if (slot.device === device) {
      const removed = await client.lRem(POOL_KEY, 1, all[i]);
      if (removed >= 1) return slot;
      // someone else claimed it first — keep scanning for another match
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
