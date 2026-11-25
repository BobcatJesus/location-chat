// lightPersist.js — Christmas Lights persistence
// (Lights Persistence v1, `sq-lights-persist-v1`).
//
// The lights used to live only in memory (lightRooms in
// server/socket.js), so every Railway redeploy wiped them (the
// strands bare again, the group effort toward 25 lost) — a
// user-reported loss, Nov 25, 2026: lights he hung disappeared
// when he logged back in, after the gift-wrap and gift-giver
// pushes restarted the server. These helpers save the serialized
// lights state to Postgres on every hang and load it back
// lazily, so a restart restores the strands in whatever state
// they were in.
//
// Mirrors Trim the Tree persistence (treePersist.js, piece 4)
// exactly: one row per room_id, the serialized state as JSONB,
// updated_at for debugging. The caller in socket.js
// (persistLight / ensureLightLoaded) owns the try/catch, so a
// DB failure warns and never blocks a live broadcast.
//
// No side effects on import: the pool is passed in by the
// caller (server/socket.js). With no pool (local dev without
// Postgres) every helper is a no-op and the lights behave
// exactly as before — in-memory only, never a crash.
//
// No separate repair function is needed: parseLightState
// (lightState.js) already repairs the consistency that
// matters — a missing or short `lit` list repairs to the first
// N slots in the old fixed order (the same v1.4 client repair),
// missing contributors/hungBy repair to empty, a non-numeric
// counted repairs to 0, and a completed room's counted is
// forced to 25 with all 25 slots lit. A finished room stays
// finished (it is decor); there is nothing to re-arm.
//
// DEC 19 RESET NOTE: the deliberate pre-showcase reset (a later
// piece) clears this table — the lights ARE room state, unlike
// mail, which is excluded from that reset by default.

import {
  createLightState,
  parseLightState,
  serializeLightState,
} from '../src/village/lightState.js';

// sq-lights-persist-v1 — marker for the v1 landing check.
export const LIGHTS_PERSIST_MARKER = 'sq-lights-persist-v1';

export const LIGHTS_ROOM_STATE_TABLE = 'lights_room_state';

export const LIGHTS_ROOM_STATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS lights_room_state (
      room_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

/**
 * Save one room's lights state. No-op (returns false) without a
 * pool or room. Throws on a DB error, same as saveTreeState —
 * the caller catches and warns. Returns true when the row was
 * written.
 */
export async function saveLightState(pool, roomId, state) {
  if (!pool) return false;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return false;
  await pool.query(
    `INSERT INTO lights_room_state (room_id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (room_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [safeRoom, JSON.stringify(serializeLightState(state))]
  );
  return true;
}

/**
 * Load one room's lights state. Returns the parsed state, or
 * null when there is no pool, no row, or the row cannot be read
 * — the caller starts with bare strands in all of those cases,
 * exactly as today. A stored row is validated with
 * parseLightState (never trust the row blindly: a bad row
 * repairs to bare strands, a missing or short `lit` repairs to
 * the first N slots, and a completed room claiming fewer than
 * 25 is forced to 25 with all slots lit).
 */
export async function loadLightState(pool, roomId) {
  if (!pool) return null;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return null;
  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT data FROM lights_room_state WHERE room_id = $1',
      [safeRoom]
    ));
  } catch (e) {
    console.error('loadLightState failed:', e && e.message);
    return null;
  }
  const raw = rows && rows[0] ? rows[0].data : null;
  if (!raw || typeof raw !== 'object') return null;
  return parseLightState(raw);
}
