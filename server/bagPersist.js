// bagPersist.js — Bag persistence (Bag Persistence v1,
// `sq-bag-persist-v1`).
//
// The bought bag (20 coins, pocket 3 slots -> bag 10 slots) used to
// live only in the browser's localStorage, so a server restart, a
// cleared browser, or a profile change could downgrade it back to
// a pocket. These helpers save the hasBag flag to Postgres per
// player (keyed by their account id / email), so a restart restores
// the bag and it follows the account across devices and browsers.
//
// No side effects on import: the pool is passed in by the caller
// (server/socket.js). With no pool (local dev without Postgres)
// every helper is a no-op and the bag behaves exactly as before —
// localStorage only, never a crash.
//
// Trust model (same as badges and coins — client-side trust
// boundary, no server-side purchase check): the client is the
// source of truth for whether it bought the bag. The server ORs
// the incoming flag with the stored flag — once a bag, always a
// bag. A later join must never UN-buy a bag just because one
// client sent hasBag false (e.g. a fresh browser that has not
// loaded the localStorage yet). There is no removal feature; the
// flag is only ever set true, never cleared.
//
// Only the hasBag flag is persisted — NOT the pocket items. The
// items stay localStorage-only, same as before.

// sq-bag-persist-v1 — marker for the v1 landing check.
export const BAG_PERSIST_MARKER = 'sq-bag-persist-v1';

export const PLAYER_BAGS_TABLE = 'player_bags';

export const PLAYER_BAGS_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS player_bags (
      player_id TEXT PRIMARY KEY,
      has_bag BOOLEAN NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

/**
 * Pure merge rule: the stored flag OR the claimed flag. Once a bag,
 * always a bag — a false claim never clears a stored bag.
 */
export function mergeBagState(storedHasBag, claimedHasBag) {
  return Boolean(storedHasBag) || Boolean(claimedHasBag);
}

/**
 * Load one player's bag flag. Returns a Boolean, false when there
 * is no pool, no row, or the row cannot be read — the caller keeps
 * the client's local value in all of those cases.
 */
export async function loadBag(pool, playerId) {
  if (!pool) return false;
  const safePlayer = String(playerId || '');
  if (!safePlayer) return false;
  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT has_bag FROM player_bags WHERE player_id = $1',
      [safePlayer]
    ));
  } catch (e) {
    console.error('loadBag failed:', e && e.message);
    return false;
  }
  const row = rows && rows[0] ? rows[0] : null;
  if (!row) return false;
  return Boolean(row.has_bag);
}

/**
 * Save one player's bag flag. Upsert; the caller only ever passes
 * true (the merge rule never clears a bag), but the function
 * itself stores whatever it is given. No-op (returns false)
 * without a pool or player. Throws on a DB error, same as
 * saveHatState — the caller catches and warns. Returns true when
 * the row was written.
 */
export async function saveBag(pool, playerId, hasBag) {
  if (!pool) return false;
  const safePlayer = String(playerId || '');
  if (!safePlayer) return false;
  await pool.query(
    `INSERT INTO player_bags (player_id, has_bag, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (player_id)
     DO UPDATE SET has_bag = EXCLUDED.has_bag, updated_at = NOW()`,
    [safePlayer, Boolean(hasBag)]
  );
  return true;
}
