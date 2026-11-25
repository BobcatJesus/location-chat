// snowPersist.js — Build a Snowman persistence
// (Snowman Persistence v1, `sq-snowman-persist-v1`).
//
// The snowman used to live only in memory (snowRooms in
// server/socket.js), so every Railway redeploy wiped him (the
// half-built snowman gone, the group effort toward 15 lost) —
// the same gap as the lights, reported by the user Nov 25, 2026
// right after the lights piece landed: lights he hung had
// disappeared when he logged back in, after the gift-wrap and
// gift-giver pushes restarted the server. These helpers save
// the serialized snowman state to Postgres on every snowball
// add and load it back lazily, so a restart restores the
// snowman in whatever state he was in.
//
// Mirrors Christmas Lights persistence (lightPersist.js)
// exactly: one row per room_id, the serialized state as JSONB,
// updated_at for debugging. The caller in socket.js
// (persistSnow / ensureSnowLoaded) owns the try/catch, so a
// DB failure warns and never blocks a live broadcast.
//
// No side effects on import: the pool is passed in by the
// caller (server/socket.js). With no pool (local dev without
// Postgres) every helper is a no-op and the snowman behaves
// exactly as before — in-memory only, never a crash.
//
// No separate repair function is needed: parseSnowState
// (snowState.js) already repairs the consistency that
// matters — a non-numeric counted repairs to 0, counted is
// clamped to 0..15, missing contributors/hungBy repair to
// empty, and a completed snowman claiming fewer than 15 is
// forced to 15. A finished snowman stays finished (it is
// decor); there is nothing to re-arm. The growth stage
// (snowStage) derives purely from counted, so a loaded row
// shows the same stage as before the restart.
//
// DEC 19 RESET NOTE: the deliberate pre-showcase reset (a later
// piece) clears this table — the snowman IS room state, unlike
// mail, which is excluded from that reset by default.

import {
  createSnowState,
  parseSnowState,
  serializeSnowState,
} from '../src/village/snowState.js';

// sq-snowman-persist-v1 — marker for the v1 landing check.
export const SNOWMAN_PERSIST_MARKER = 'sq-snowman-persist-v1';

export const SNOWMAN_ROOM_STATE_TABLE = 'snowman_room_state';

export const SNOWMAN_ROOM_STATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS snowman_room_state (
      room_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

/**
 * Save one room's snowman state. No-op (returns false) without a
 * pool or room. Throws on a DB error, same as saveLightState —
 * the caller catches and warns. Returns true when the row was
 * written.
 */
export async function saveSnowState(pool, roomId, state) {
  if (!pool) return false;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return false;
  await pool.query(
    `INSERT INTO snowman_room_state (room_id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (room_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [safeRoom, JSON.stringify(serializeSnowState(state))]
  );
  return true;
}

/**
 * Load one room's snowman state. Returns the parsed state, or
 * null when there is no pool, no row, or the row cannot be read
 * — the caller starts with a bare snow patch in all of those
 * cases, exactly as today. A stored row is validated with
 * parseSnowState (never trust the row blindly: a bad row
 * repairs to a bare patch, a non-numeric counted repairs to 0,
 * counted is clamped to 0..15, and a completed snowman
 * claiming fewer than 15 is forced to 15).
 */
export async function loadSnowState(pool, roomId) {
  if (!pool) return null;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return null;
  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT data FROM snowman_room_state WHERE room_id = $1',
      [safeRoom]
    ));
  } catch (e) {
    console.error('loadSnowState failed:', e && e.message);
    return null;
  }
  const raw = rows && rows[0] ? rows[0].data : null;
  if (!raw || typeof raw !== 'object') return null;
  return parseSnowState(raw);
}
