// puzzlePersist.js — Shared Puzzle persistence (Room-State
// Persistence v3, `sq-puzzle-persist-v1`).
//
// Piece 3 of the room-state persistence fix: the shared puzzle
// board used to live only in memory (puzzleState in
// server/socket.js), so every Railway redeploy started a fresh
// puzzle (round 1, nothing found) — mid-puzzle progress was lost.
// These helpers save the serialized puzzle state to Postgres on
// every mutation and load it back lazily, so a restart restores
// the board in whatever state it was in.
//
// No side effects on import: the pool is passed in by the caller
// (server/socket.js). With no pool (local dev without Postgres)
// every helper is a no-op and the puzzle behaves exactly as
// before — in-memory only, never a crash.
//
// The table mirrors the decorations pattern in socket.js
// (initDb / saveDecoration) and the hat pattern (hatPersist.js):
// one row per room_id, the serialized state as JSONB, updated_at
// for debugging. The caller in socket.js (persistPuzzle /
// ensurePuzzleLoaded) owns the try/catch, so a DB failure warns
// and never blocks a live broadcast.
//
// Completion-timer rule: a finished board stays up to admire for
// PUZZLE_RESET_MS (60s), then a fresh round starts. If the server
// was down when that window elapsed, the board comes back as a
// fresh round (repairLoadedPuzzleState); if the window has NOT
// elapsed yet, the state comes back as-is and the caller re-arms
// the reset timer for the remaining time.
//
// DEC 19 RESET NOTE: the deliberate pre-showcase reset (a later
// piece) clears this table — the puzzle IS room state, unlike
// mail, which is excluded from that reset by default.

import {
  PUZZLE_RESET_MS,
  createPuzzleState,
  parsePuzzleState,
  resetPuzzleState,
  serializePuzzleState,
} from '../src/village/puzzleState.js';

// sq-puzzle-persist-v1 — marker for the v1 landing check.
export const PUZZLE_PERSIST_MARKER = 'sq-puzzle-persist-v1';

export const PUZZLE_ROOM_STATE_TABLE = 'puzzle_room_state';

export const PUZZLE_ROOM_STATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS puzzle_room_state (
      room_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

/**
 * Save one room's puzzle state. No-op (returns false) without a
 * pool or room. Throws on a DB error, same as saveHatState — the
 * caller catches and warns. Returns true when the row was written.
 */
export async function savePuzzleState(pool, roomId, state) {
  if (!pool) return false;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return false;
  await pool.query(
    `INSERT INTO puzzle_room_state (room_id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (room_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [safeRoom, JSON.stringify(serializePuzzleState(state))]
  );
  return true;
}

/**
 * Repair a loaded state whose 60s admire window already elapsed
 * while the server was down: a finished board must not come back
 * completed forever — it repairs to a fresh round (round number
 * up, everything else cleared), exactly what the reset timer
 * would have done. A board whose window has NOT elapsed yet is
 * kept as-is (repaired: false) — the caller re-arms the reset
 * timer for the remaining time. Pure: returns { state, repaired }
 * and never mutates its input.
 */
export function repairLoadedPuzzleState(state, now = Date.now()) {
  const s = state || createPuzzleState();
  if (s.completed && now - s.completedAt >= PUZZLE_RESET_MS) {
    return { state: resetPuzzleState(s), repaired: true };
  }
  return { state: s, repaired: false };
}

/**
 * Load one room's puzzle state. Returns the parsed state, or null
 * when there is no pool, no row, or the row cannot be read — the
 * caller starts a fresh round in all of those cases, exactly as
 * today. A stored row is validated with parsePuzzleState (never
 * trust the row blindly: a bad row repairs to a fresh round). The
 * 60s-window repair is NOT applied here — the caller runs
 * repairLoadedPuzzleState, so it can re-arm the reset timer when
 * the loaded board is completed but still inside its window.
 */
export async function loadPuzzleState(pool, roomId) {
  if (!pool) return null;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return null;
  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT data FROM puzzle_room_state WHERE room_id = $1',
      [safeRoom]
    ));
  } catch (e) {
    console.error('loadPuzzleState failed:', e && e.message);
    return null;
  }
  const raw = rows && rows[0] ? rows[0].data : null;
  if (!raw || typeof raw !== 'object') return null;
  return parsePuzzleState(raw);
}
