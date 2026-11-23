// hatPersist.js — Santa Hat persistence (Room-State Persistence v1,
// `sq-hat-persist-v1`).
//
// Piece 1 of the room-state persistence fix: the Santa hat room
// state used to live only in memory (hatRooms in server/socket.js),
// so every Railway redeploy reset the hat to hidden behind the
// tree. These helpers save the serialized hat state to Postgres on
// every mutation and load it back lazily, so a restart restores the
// hat in whatever state it was in.
//
// No side effects on import: the pool is passed in by the caller
// (server/socket.js). With no pool (local dev without Postgres)
// every helper is a no-op and the hat behaves exactly as before —
// in-memory only, never a crash.
//
// The table mirrors the decorations pattern in socket.js
// (initDb / saveDecoration): one row per room_id, the serialized
// state as JSONB, updated_at for debugging. The caller in
// socket.js (persistHat / ensureHatLoaded) owns the try/catch, so
// a DB failure warns and never blocks a live broadcast.

import {
  HAT_HIDE_SPOT,
  createHatState,
  isSlipDue,
  parseHatState,
  serializeHatState,
} from '../src/village/hatState.js';

// sq-hat-persist-v1 — marker for the v1 landing check.
export const HAT_PERSIST_MARKER = 'sq-hat-persist-v1';

export const HAT_ROOM_STATE_TABLE = 'hat_room_state';

export const HAT_ROOM_STATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS hat_room_state (
      room_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

/**
 * Save one room's hat state. No-op (returns false) without a pool
 * or room. Throws on a DB error, same as saveDecoration /
 * saveShelfBook — the caller catches and warns. Returns true when
 * the row was written.
 */
export async function saveHatState(pool, roomId, state) {
  if (!pool) return false;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return false;
  await pool.query(
    `INSERT INTO hat_room_state (room_id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (room_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [safeRoom, JSON.stringify(serializeHatState(state))]
  );
  return true;
}

/**
 * Repair a loaded state whose slip time passed while the server
 * was down: a hat that was on the cat when the server stopped must
 * not come back worn forever. It lands on the ground at the foot
 * of the tree (HAT_HIDE_SPOT — a known safe floor spot in Agora,
 * visible on the floor and pickable). Pure: returns
 * { state, repaired } and never mutates its input.
 */
export function repairLoadedHatState(state, now = Date.now()) {
  const s = state || createHatState();
  if (s.status === 'onCat' && isSlipDue(s, now)) {
    return {
      state: {
        ...s,
        status: 'ground',
        groundX: HAT_HIDE_SPOT.x,
        groundY: HAT_HIDE_SPOT.y,
        wornAt: 0,
        slipAt: 0,
      },
      repaired: true,
    };
  }
  return { state: s, repaired: false };
}

/**
 * Load one room's hat state. Returns { state, repaired } or null
 * when there is no pool, no row, or the row cannot be read — the
 * caller starts hidden in all of those cases, exactly as today. A
 * stored row is validated with parseHatState (never trust the row
 * blindly: a bad row repairs to hidden) and slip-repaired.
 */
export async function loadHatState(pool, roomId) {
  if (!pool) return null;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return null;
  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT data FROM hat_room_state WHERE room_id = $1',
      [safeRoom]
    ));
  } catch (e) {
    console.error('loadHatState failed:', e && e.message);
    return null;
  }
  const raw = rows && rows[0] ? rows[0].data : null;
  if (!raw || typeof raw !== 'object') return null;
  return repairLoadedHatState(parseHatState(raw));
}
