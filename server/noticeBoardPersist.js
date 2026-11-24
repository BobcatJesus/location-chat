// noticeBoardPersist.js — Notice Board persistence (Room-State
// Persistence v5, `sq-notice-board-persist-v1`).
//
// Piece 5 of the room-state persistence fix: the boards used to
// live only in memory (noticeBoards in server/socket.js), so every
// Railway redeploy wiped every board clean (fresh board, nothing
// pinned) — pinned flyers, the room's shared voice, were lost.
// These helpers save the serialized board state to Postgres on
// every pin and removal and load it back lazily, so a restart
// restores the boards in whatever state they were in.
//
// No side effects on import: the pool is passed in by the caller
// (server/socket.js). With no pool (local dev without Postgres)
// every helper is a no-op and the boards behave exactly as
// before — in-memory only, never a crash.
//
// The table mirrors the decorations pattern in socket.js
// (initDb / saveDecoration) and the tree pattern
// (treePersist.js): one row per room_id, the serialized state
// as JSONB, updated_at for debugging. The caller in socket.js
// (persistNoticeBoard / ensureNoticeBoardLoaded) owns the
// try/catch, so a DB failure warns and never blocks a live
// broadcast.
//
// No separate repair function is needed: unlike the puzzle there
// is no completion timer, and parseNoticeBoardState already
// repairs what matters — each flyer is cleaned, the list is
// capped at 10, duplicate ids are dropped, and malformed
// entries are skipped. A board with nothing usable in it comes
// back empty.
//
// DEC 19 RESET NOTE: the deliberate pre-showcase reset (a later
// piece) clears this table — the boards ARE room state, unlike
// mail, which is excluded from that reset by default.

import {
  createNoticeBoardState,
  parseNoticeBoardState,
  serializeNoticeBoardState,
} from '../src/village/noticeBoardState.js';

// sq-notice-board-persist-v1 — marker for the v1 landing check.
export const NOTICE_BOARD_PERSIST_MARKER = 'sq-notice-board-persist-v1';

export const NOTICE_BOARD_STATE_TABLE = 'notice_board_state';

export const NOTICE_BOARD_STATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS notice_board_state (
      room_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

/**
 * Save one room's board state. No-op (returns false) without a
 * pool or room. Throws on a DB error, same as saveTreeState —
 * the caller catches and warns. Returns true when the row was
 * written.
 */
export async function saveNoticeBoardState(pool, roomId, state) {
  if (!pool) return false;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return false;
  await pool.query(
    `INSERT INTO notice_board_state (room_id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (room_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [safeRoom, JSON.stringify(serializeNoticeBoardState(state))]
  );
  return true;
}

/**
 * Load one room's board state. Returns the parsed state, or null
 * when there is no pool, no row, or the row cannot be read — the
 * caller starts with an empty board in all of those cases,
 * exactly as today. A stored row is validated with
 * parseNoticeBoardState (never trust the row blindly: a bad row
 * repairs to an empty board, flyers are cleaned and capped at
 * 10, duplicates and malformed entries are dropped).
 */
export async function loadNoticeBoardState(pool, roomId) {
  if (!pool) return null;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return null;
  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT data FROM notice_board_state WHERE room_id = $1',
      [safeRoom]
    ));
  } catch (e) {
    console.error('loadNoticeBoardState failed:', e && e.message);
    return null;
  }
  const raw = rows && rows[0] ? rows[0].data : null;
  if (!raw || typeof raw !== 'object') return null;
  return parseNoticeBoardState(raw);
}
