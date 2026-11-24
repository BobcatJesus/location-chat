// treePersist.js — Trim the Tree persistence (Room-State
// Persistence v4, `sq-tree-persist-v1`).
//
// Piece 4 of the room-state persistence fix: the trees used to
// live only in memory (treeRooms in server/socket.js), so every
// Railway redeploy wiped them (tree 1 bare again, tree 2 gone
// until tree 1 finishes again) — a group effort toward 25 lost.
// These helpers save the serialized tree state to Postgres on
// every hang and load it back lazily, so a restart restores the
// trees in whatever state they were in.
//
// No side effects on import: the pool is passed in by the caller
// (server/socket.js). With no pool (local dev without Postgres)
// every helper is a no-op and the trees behave exactly as
// before — in-memory only, never a crash.
//
// The table mirrors the decorations pattern in socket.js
// (initDb / saveDecoration) and the puzzle pattern
// (puzzlePersist.js): one row per room_id, the serialized state
// as JSONB, updated_at for debugging. The caller in socket.js
// (persistTree / ensureTreeLoaded) owns the try/catch, so a DB
// failure warns and never blocks a live broadcast.
//
// No separate repair function is needed: unlike the puzzle there
// is no completion timer, and parseTreeState already repairs the
// consistency that matters — a completed tree's counted is forced
// to 25, and the `active` pointer is recomputed as the first
// unfinished tree, or -1 when both are done. A finished tree
// stays finished (it is decor); there is nothing to re-arm.
//
// DEC 19 RESET NOTE: the deliberate pre-showcase reset (a later
// piece) clears this table — the trees ARE room state, unlike
// mail, which is excluded from that reset by default.

import {
  createTreeState,
  parseTreeState,
  serializeTreeState,
} from '../src/village/treeState.js';

// sq-tree-persist-v1 — marker for the v1 landing check.
export const TREE_PERSIST_MARKER = 'sq-tree-persist-v1';

export const TREE_ROOM_STATE_TABLE = 'tree_room_state';

export const TREE_ROOM_STATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS tree_room_state (
      room_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

/**
 * Save one room's tree state. No-op (returns false) without a
 * pool or room. Throws on a DB error, same as savePuzzleState —
 * the caller catches and warns. Returns true when the row was
 * written.
 */
export async function saveTreeState(pool, roomId, state) {
  if (!pool) return false;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return false;
  await pool.query(
    `INSERT INTO tree_room_state (room_id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (room_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [safeRoom, JSON.stringify(serializeTreeState(state))]
  );
  return true;
}

/**
 * Load one room's tree state. Returns the parsed state, or null
 * when there is no pool, no row, or the row cannot be read — the
 * caller starts with bare trees in all of those cases, exactly as
 * today. A stored row is validated with parseTreeState (never
 * trust the row blindly: a bad row repairs to bare trees, a
 * completed tree claiming fewer than 25 is forced to 25, and the
 * active pointer is recomputed from the trees).
 */
export async function loadTreeState(pool, roomId) {
  if (!pool) return null;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return null;
  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT data FROM tree_room_state WHERE room_id = $1',
      [safeRoom]
    ));
  } catch (e) {
    console.error('loadTreeState failed:', e && e.message);
    return null;
  }
  const raw = rows && rows[0] ? rows[0].data : null;
  if (!raw || typeof raw !== 'object') return null;
  return parseTreeState(raw);
}
