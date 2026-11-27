// notePersist.js — Pick-Up Notes persistence (Pick-Up Notes v1,
// `sq-pickup-notes-v1`).
//
// The notes used to live only in memory, so every Railway redeploy
// would have wiped them — and the 48-hour expiry would have been
// meaningless, since a restart would have killed every note
// early. These helpers save the serialized notes state to
// Postgres on every drop and removal and load it back lazily, so
// a restart restores the notes in whatever state they were in,
// with their original createdAt — and a note left Monday at noon
// still fades Wednesday at noon, restart or not.
//
// Mirrors the notice-board persistence (noticeBoardPersist.js)
// exactly: one row per room_id, the serialized state as JSONB,
// updated_at for debugging. The caller in socket.js
// (persistNotes / ensureNotesLoaded) owns the try/catch, so a DB
// failure warns and never blocks a live broadcast.
//
// No side effects on import: the pool is passed in by the caller
// (server/socket.js). With no pool (local dev without Postgres)
// every helper is a no-op and the notes behave exactly as before
// — in-memory only, never a crash.
//
// ANONYMITY NOTE: the row stores the STORAGE serialization, which
// keeps each note's authorId — the server needs it for the
// "writer can delete their own note" gate. The wire serialization
// (serializeNoteState) strips it, so the row's authorId never
// reaches a client. Do not "simplify" the save to use the wire
// serialization: a restart would then orphan every note from its
// writer, and nobody but a moderator could ever take one down.
//
// No separate repair function is needed: parseNoteState already
// repairs what matters — each note is cleaned, expired notes are
// dropped, duplicate ids are dropped, and malformed entries are
// skipped. A room with nothing usable in it comes back empty.
//
// DEC 19 RESET NOTE: the deliberate pre-showcase reset (a later
// piece) clears this table — the notes ARE room state, unlike
// mail, which is excluded from that reset by default.

import {
  createNoteState,
  parseNoteState,
  serializeNoteStateForStorage,
} from '../src/village/noteState.js';

// sq-pickup-notes-v1 — marker for the v1 landing check.
export const NOTE_PERSIST_MARKER = 'sq-pickup-notes-v1';

export const NOTES_ROOM_STATE_TABLE = 'room_notes_state';

export const NOTES_ROOM_STATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS room_notes_state (
      room_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

/**
 * Save one room's notes state. No-op (returns false) without a
 * pool or room. Throws on a DB error, same as saveNoticeBoardState
 * — the caller catches and warns. Returns true when the row was
 * written. Saves the STORAGE serialization (with authorId) — see
 * the anonymity note above.
 */
export async function saveNoteState(pool, roomId, state) {
  if (!pool) return false;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return false;
  await pool.query(
    `INSERT INTO room_notes_state (room_id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (room_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [safeRoom, JSON.stringify(serializeNoteStateForStorage(state))]
  );
  return true;
}

/**
 * Load one room's notes state. Returns the parsed state, or null
 * when there is no pool, no row, or the row cannot be read — the
 * caller starts with an empty floor in all of those cases,
 * exactly as today. A stored row is validated with
 * parseNoteState (never trust the row blindly: a bad row repairs
 * to an empty floor, notes are cleaned, expired notes are
 * dropped, duplicates and malformed entries are dropped).
 */
export async function loadNoteState(pool, roomId) {
  if (!pool) return null;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return null;
  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT data FROM room_notes_state WHERE room_id = $1',
      [safeRoom]
    ));
  } catch (e) {
    console.error('loadNoteState failed:', e && e.message);
    return null;
  }
  const raw = rows && rows[0] ? rows[0].data : null;
  if (!raw || typeof raw !== 'object') return null;
  return parseNoteState(raw);
}
