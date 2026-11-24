// decorPersist.js — Placed Decorations persistence (Room-State
// Persistence v6, `sq-decor-persist-v1`).
//
// Piece 6 of the room-state persistence fix: placed decorations
// used to live only in memory (decorRooms in server/socket.js),
// so every Railway redeploy wiped every placed ornament, string
// of lights, snowman, tree and Santa clean — the room's shared
// decorating was lost. These helpers save the serialized room
// state to Postgres on every place and removal and load it back
// lazily, so a restart restores the decorations in whatever state
// they were in.
//
// No side effects on import: the pool is passed in by the caller
// (server/socket.js). With no pool (local dev without Postgres)
// every helper is a no-op and the decorations behave exactly as
// before — in-memory only, never a crash.
//
// The table mirrors the notice-board pattern
// (noticeBoardPersist.js): one row per room_id, the serialized
// state as JSONB, updated_at for debugging. The caller in
// socket.js (persistDecor / ensureDecorLoaded) owns the
// try/catch, so a DB failure warns and never blocks a live
// broadcast.
//
// NOTE: this is NOT the older per-row `decorations` table in
// socket.js (initDb / saveDecoration / loadDecorationsForRoom),
// which backs the separate venue/creator flow
// (`place_decoration` / `room_decorations` events). The two
// systems are intentionally separate — do not merge them. This
// module persists decorRooms ONLY, one row per room.
//
// No separate repair function is needed: unlike the puzzle there
// is no completion timer, and parseDecorState already repairs
// what matters — each decoration is cleaned, the list is capped
// at 30, duplicate ids are dropped, and malformed entries are
// skipped. A room with nothing usable in it comes back empty.
//
// DEC 19 RESET NOTE: the deliberate pre-showcase reset (a later
// piece) clears this table — placed decorations ARE room state,
// unlike mail, which is excluded from that reset by default.

import {
  createDecorState,
  parseDecorState,
  serializeDecorState,
} from '../src/village/decorState.js';

// sq-decor-persist-v1 — marker for the v1 landing check.
export const DECOR_PERSIST_MARKER = 'sq-decor-persist-v1';

export const DECOR_ROOM_STATE_TABLE = 'decor_room_state';

export const DECOR_ROOM_STATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS decor_room_state (
      room_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

/**
 * Save one room's placed-decorations state. No-op (returns false)
 * without a pool or room. Throws on a DB error, same as
 * saveNoticeBoardState — the caller catches and warns. Returns
 * true when the row was written.
 */
export async function saveDecorState(pool, roomId, state) {
  if (!pool) return false;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return false;
  await pool.query(
    `INSERT INTO decor_room_state (room_id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (room_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [safeRoom, JSON.stringify(serializeDecorState(state))]
  );
  return true;
}

/**
 * Load one room's placed-decorations state. Returns the parsed
 * state, or null when there is no pool, no row, or the row cannot
 * be read — the caller starts with an empty room in all of those
 * cases, exactly as today. A stored row is validated with
 * parseDecorState (never trust the row blindly: a bad row repairs
 * to an empty room, decorations are cleaned and capped at 30,
 * duplicates and malformed entries are dropped).
 */
export async function loadDecorState(pool, roomId) {
  if (!pool) return null;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return null;
  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT data FROM decor_room_state WHERE room_id = $1',
      [safeRoom]
    ));
  } catch (e) {
    console.error('loadDecorState failed:', e && e.message);
    return null;
  }
  const raw = rows && rows[0] ? rows[0].data : null;
  if (!raw || typeof raw !== 'object') return null;
  return parseDecorState(raw);
}
