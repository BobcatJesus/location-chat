// catPersist.js — Cat State persistence (Room-State
// Persistence v7, `sq-cat-persist-v1`).
//
// Piece 7 of the room-state persistence fix: the cafe cat used to
// live only in memory (catState + catHunger in server/socket.js),
// so every Railway redeploy woke her up, reset the pet count,
// and forgot who fed her this window — the window became
// completable again and the +3 could pay twice. These helpers
// save the combined cat state to Postgres on every pet, feed,
// wake, and hunger-tick change, and load it back lazily, so a
// restart restores the cat in whatever state she was in.
//
// ONE row per room, holding BOTH stores together: the sleep state
// ({ pets, asleep }) and the hunger state ({ windowId, hungry,
// fedBy }). They are one cat in one room, so they persist as one
// row — a load never restores the pets without the hunger, or
// the hunger without the pets.
//
// The stored hunger shape is the FULL state, including fedBy —
// NOT the wire shape (serializeCatHunger returns only { hungry,
// windowId }; fedBy is deliberately not on the wire). Storing
// only the wire shape would forget "already fed this window" on
// restart and the +3 would pay twice.
//
// No side effects on import: the pool is passed in by the caller
// (server/socket.js). With no pool (local dev without Postgres)
// every helper is a no-op and the cat behaves exactly as
// before — in-memory only, never a crash.
//
// The table mirrors the decorations pattern in socket.js
// (initDb / saveDecoration) and the notice-board pattern
// (noticeBoardPersist.js): one row per room_id, the serialized
// state as JSONB, updated_at for debugging. The caller in
// socket.js (persistCat / ensureCatLoaded) owns the try/catch,
// so a DB failure warns and never blocks a live broadcast.
//
// Repair lives here (parseCatRoomState) plus the shared
// parseCatHungerState in catHunger.js: pets is an integer
// clamped 0..3 (3 pets puts her to sleep), asleep a boolean,
// hunger repaired by the shared parser. No window math here —
// the caller runs the refreshCatHunger tick after loading, so a
// window that opened or closed while the server was down applies
// through the same code path the live server already uses.
//
// DEC 19 RESET NOTE: the deliberate pre-showcase reset (a later
// piece) clears this table — the cat IS room state, unlike mail,
// which is excluded from that reset by default.

import {
  createCatHungerState,
  parseCatHungerState,
} from '../src/village/catHunger.js';

// sq-cat-persist-v1 — marker for the v1 landing check.
export const CAT_PERSIST_MARKER = 'sq-cat-persist-v1';

export const CAT_ROOM_STATE_TABLE = 'cat_room_state';

export const CAT_ROOM_STATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS cat_room_state (
      room_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

// 3 pets puts her to sleep — mirrors CATS_PETS_TO_SLEEP in
// server/socket.js (kept as a literal here so this pure module
// never imports the server).
const CATS_PETS_TO_SLEEP = 3;

/** Fresh combined cat state for one room. */
export function createCatRoomState() {
  return { pets: 0, asleep: false, hunger: createCatHungerState() };
}

/** The stored shape: the full state, including fedBy (see the
 *  header — the wire shape would lose "already fed"). */
export function serializeCatRoomState(state = {}) {
  const hunger = state.hunger && typeof state.hunger === 'object' ? state.hunger : createCatHungerState();
  return {
    pets: Number.isFinite(Number(state.pets)) ? Math.min(CATS_PETS_TO_SLEEP, Math.max(0, Math.floor(Number(state.pets)))) : 0,
    asleep: state.asleep === true,
    hunger: {
      windowId: typeof hunger.windowId === 'string' && hunger.windowId ? hunger.windowId : null,
      hungry: hunger.hungry === true,
      fedBy: typeof hunger.fedBy === 'string' && hunger.fedBy ? hunger.fedBy : null,
    },
  };
}

/** Repair a stored cat state: never trust the row blindly. Pets
 *  is an integer clamped 0..3, asleep a boolean, hunger repaired
 *  by the shared parser; a missing or unusable row comes back as
 *  a fresh cat (0 pets, awake, not hungry). */
export function parseCatRoomState(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const pets = Number(r.pets);
  return {
    pets: Number.isFinite(pets) ? Math.min(CATS_PETS_TO_SLEEP, Math.max(0, Math.floor(pets))) : 0,
    asleep: r.asleep === true,
    hunger: parseCatHungerState(r.hunger),
  };
}

/**
 * Save one room's cat state. No-op (returns false) without a
 * pool or room. Throws on a DB error, same as saveNoticeBoardState
 * — the caller catches and warns. Returns true when the row was
 * written.
 */
export async function saveCatState(pool, roomId, state) {
  if (!pool) return false;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return false;
  await pool.query(
    `INSERT INTO cat_room_state (room_id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (room_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [safeRoom, JSON.stringify(serializeCatRoomState(state))]
  );
  return true;
}

/**
 * Load one room's cat state. Returns the parsed state, or null
 * when there is no pool, no row, or the row cannot be read — the
 * caller starts with a fresh cat in all of those cases, exactly
 * as today. A stored row is validated with parseCatRoomState
 * (never trust the row blindly: pets is clamped 0..3, asleep is
 * a boolean, hunger is repaired by parseCatHungerState).
 */
export async function loadCatState(pool, roomId) {
  if (!pool) return null;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return null;
  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT data FROM cat_room_state WHERE room_id = $1',
      [safeRoom]
    ));
  } catch (e) {
    console.error('loadCatState failed:', e && e.message);
    return null;
  }
  const raw = rows && rows[0] ? rows[0].data : null;
  if (!raw || typeof raw !== 'object') return null;
  return parseCatRoomState(raw);
}
