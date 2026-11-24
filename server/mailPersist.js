// mailPersist.js — Mail persistence (Room-State Persistence v2,
// `sq-mail-persist-v1`).
//
// Piece 2 of the room-state persistence fix: per-player mail
// inboxes used to live only in memory (userMailInbox in
// server/socket.js), so every Railway redeploy wiped unread mail.
// These helpers save the serialized inbox to Postgres on every
// mutation and load it back lazily, so a restart restores the mail
// instead of emptying the mailbox.
//
// No side effects on import: the pool is passed in by the caller
// (server/socket.js). With no pool (local dev without Postgres)
// every helper is a no-op and mail behaves exactly as before —
// in-memory only, never a crash.
//
// The table mirrors the decorations pattern in socket.js
// (initDb / saveDecoration) and the hat pattern (hatPersist.js):
// one row per user_id, the serialized inbox as JSONB, updated_at
// for debugging. The caller in socket.js (persistMail /
// ensureMailLoaded) owns the try/catch, so a DB failure warns and
// never blocks a live broadcast.
//
// DELIBERATE CHOICE: ALL inboxes are persisted, including guests'.
// A guest's userId is a socket id, so its row is orphaned after
// they leave and never read again — harmless — and distinguishing
// guests reliably at the recipient end is fiddly (the sender only
// knows a mailbox code, not whether the recipient is a guest).
//
// DEC 19 RESET NOTE: the deliberate pre-showcase reset (a later
// piece) must EXCLUDE mail by default — people's private mail is
// not room state, and wiping it would delete gifts. The reset
// clears persisted ROOM state only; mail_inbox is not touched.

import {
  parseMailState,
  serializeMailState,
} from '../src/village/mailState.js';

// sq-mail-persist-v1 — marker for the v1 landing check.
export const MAIL_PERSIST_MARKER = 'sq-mail-persist-v1';

export const MAIL_INBOX_TABLE = 'mail_inbox';

export const MAIL_INBOX_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS mail_inbox (
      user_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

/**
 * Save one player's inbox. No-op (returns false) without a pool
 * or user. Throws on a DB error, same as saveHatState — the caller
 * catches and warns. Returns true when the row was written.
 */
export async function saveMailInbox(pool, userId, state) {
  if (!pool) return false;
  const safeUser = String(userId || '');
  if (!safeUser) return false;
  await pool.query(
    `INSERT INTO mail_inbox (user_id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [safeUser, JSON.stringify(serializeMailState(state))]
  );
  return true;
}

/**
 * Load one player's inbox. Returns the parsed state, or null when
 * there is no pool, no row, or the row cannot be read — the caller
 * starts with an empty inbox in all of those cases, exactly as
 * today. A stored row is validated with parseMailState (never
 * trust the row blindly: a bad row repairs to an empty inbox).
 */
export async function loadMailInbox(pool, userId) {
  if (!pool) return null;
  const safeUser = String(userId || '');
  if (!safeUser) return null;
  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT data FROM mail_inbox WHERE user_id = $1',
      [safeUser]
    ));
  } catch (e) {
    console.error('loadMailInbox failed:', e && e.message);
    return null;
  }
  const raw = rows && rows[0] ? rows[0].data : null;
  if (!raw || typeof raw !== 'object') return null;
  return parseMailState(raw);
}
