// Session reaper — the safety net that keeps the slot pool honest.
//
// Slots are popped from the pool on acquire() and only returned by an explicit
// DELETE /session. If a user closes the tab, or the session's Redis TTL expires
// first, the slot would otherwise leak forever (the device shows "in use" and
// never frees). This reaper:
//   1. Ends any session that has lived past its (capped) timeout.
//   2. Reconciles "orphaned" slots — claimed but backing no live session — back
//      into the pool. A slot must look orphaned on TWO consecutive passes before
//      it's reclaimed, which makes it impossible to race a session still in setup.

const { get, del, srem, smembers, getRedisClient } = require('./redis');
const { release, listAll } = require('./slotPool');
const logger = require('./logger');

const ACTIVE_KEY = 'active_sessions';        // must match routes/emulator.js
const POOL_KEY = 'slot_pool:available';      // must match utils/slotPool.js
const MAX_TIMEOUT_MIN = 30;                  // hard ceiling on any session
const INTERVAL_MS = 30 * 1000;

// Slots seen orphaned on the previous pass — only reclaimed if still orphaned now.
let suspectedOrphans = new Set();

function ageMinutes(createdAt) {
  const t = new Date(createdAt).getTime();
  if (!t || Number.isNaN(t)) return Infinity; // unknown age → treat as expired
  return (Date.now() - t) / 60000;
}

async function reapOnce() {
  const client = getRedisClient();
  const ids = await smembers(ACTIVE_KEY);
  const liveSlotIds = new Set();

  for (const id of ids) {
    const s = await get(`session:${id}`);
    if (!s) {
      // Record expired/gone — drop the dangling set member. Its slot (if any)
      // is recovered by the orphan reconciler below.
      await srem(ACTIVE_KEY, id);
      continue;
    }
    const cap = Math.min(Number(s.timeoutMinutes) || MAX_TIMEOUT_MIN, MAX_TIMEOUT_MIN);
    if (ageMinutes(s.createdAt) >= cap) {
      const slot = s.slotId != null ? listAll().find((x) => x.slotId === s.slotId) : null;
      if (slot) await release(slot);
      await del(`session:${id}`);
      await srem(ACTIVE_KEY, id);
      logger.info(`Reaper: ended session ${id} after ${cap}m → freed slot ${s.slotId} (${s.device})`);
      continue;
    }
    if (s.slotId != null) liveSlotIds.add(s.slotId);
  }

  // Reconcile leaks: a slot that's neither available nor backing a live session.
  const availRaw = await client.lRange(POOL_KEY, 0, -1);
  const availIds = new Set(availRaw.map((r) => {
    try { return JSON.parse(r).slotId; } catch { return null; }
  }));

  const orphanNow = new Set();
  for (const slot of listAll()) {
    if (!liveSlotIds.has(slot.slotId) && !availIds.has(slot.slotId)) orphanNow.add(slot.slotId);
  }
  for (const slotId of orphanNow) {
    if (suspectedOrphans.has(slotId)) {            // orphaned two passes in a row
      const slot = listAll().find((x) => x.slotId === slotId);
      if (slot) {
        await release(slot);
        logger.warn(`Reaper: recovered orphaned slot ${slotId} (${slot.device})`);
      }
    }
  }
  suspectedOrphans = orphanNow;
}

function startReaper() {
  const tick = () => reapOnce().catch((e) => logger.error(`Reaper error: ${e.message}`));
  setInterval(tick, INTERVAL_MS);
  setTimeout(tick, 5000); // first sweep shortly after boot
  logger.info(`Session reaper started — sweep every ${INTERVAL_MS / 1000}s, max ${MAX_TIMEOUT_MIN}m per session`);
}

module.exports = { startReaper, reapOnce, MAX_TIMEOUT_MIN };
