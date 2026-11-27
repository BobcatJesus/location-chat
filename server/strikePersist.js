// strikePersist.js — Notes Strike System v1
// (`sq-notes-strikes-v1`).
//
// Strikes are rows in Postgres (player_strikes), so a server
// restart never forgives a strike early and a mute survives a
// redeploy. One row per strike: who was struck, which note earned
// it (for audit — null when a strike was recorded without a
// note), who struck them, when, and when it expires (30 days
// after it was issued).
//
// Mirrors notePersist.js: the pool is passed in by the caller
// (server/socket.js). With no pool (local dev without Postgres)
// every helper is a no-op and the strikes behave in-memory only
// for the session — the socket.js strike cache still enforces
// them while the server is up, exactly like notes without a
// pool. No side effects on import.
//
// Expiry is judged by the pure mute logic
// (src/village/strikeState.js — activeStrikes /
// computeNoteMute), NOT by the store: an expired row is still
// listed, and the caller decides it does not count. That keeps
// the audit trail (a moderator can see the full history) while
// the mute math stays in one pure place.
//
// DEC 19 RESET NOTE: the deliberate pre-showcase reset (a later
// piece) should decide whether to clear this table. Strikes are
// player discipline, not room state — unlike notes, which ARE
// room state and are cleared by that reset. Leave this table
// alone unless the reset explicitly says otherwise.

import { cleanStrike, STRIKE_EXPIRE_MS } from '../src/village/strikeState.js';

// sq-notes-strikes-v1 — marker for the strikes landing check.
export const STRIKE_PERSIST_MARKER = 'sq-notes-strikes-v1';

export const PLAYER_STRIKES_TABLE = 'player_strikes';

export const PLAYER_STRIKES_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS player_strikes (
      id SERIAL PRIMARY KEY,
      player_id TEXT NOT NULL,
      note_id TEXT,
      struck_by TEXT NOT NULL,
      struck_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `;

/**
 * Record a strike. Returns the cleaned strike, or null without
 * a pool, without a player, or without a struck time. The row's
 * id is the strike's audit id. Times go in as ISO strings; pg
 * returns them as Dates, which cleanStrike accepts.
 */
export async function addStrike(pool, raw = {}) {
  if (!pool) return null;
  const strike = cleanStrike({
    ...raw,
    expiresAt: raw.expiresAt ?? (Number(new Date(raw.struckAt ?? 0)) || 0) + STRIKE_EXPIRE_MS,
  });
  if (!strike) return null;
  const { rows } = await pool.query(
    `INSERT INTO player_strikes (player_id, note_id, struck_by, struck_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, player_id, note_id, struck_by, struck_at, expires_at`,
    [
      strike.playerId,
      strike.noteId,
      strike.struckBy,
      new Date(strike.struckAt).toISOString(),
      new Date(strike.expiresAt).toISOString(),
    ]
  );
  const row = rows && rows[0] ? rows[0] : null;
  if (!row) return null;
  return cleanStrike({
    playerId: row.player_id,
    noteId: row.note_id,
    struckBy: row.struck_by,
    struckAt: row.struck_at,
    expiresAt: row.expires_at,
  });
}

/**
 * Every strike for one player, oldest first — including expired
 * ones. The caller judges expiry with activeStrikes /
 * computeNoteMute. Returns [] without a pool or a player.
 */
export async function listStrikesForPlayer(pool, playerId) {
  if (!pool) return [];
  const safePlayer = String(playerId || '');
  if (!safePlayer) return [];
  const { rows } = await pool.query(
    `SELECT id, player_id, note_id, struck_by, struck_at, expires_at
     FROM player_strikes WHERE player_id = $1 ORDER BY struck_at ASC`,
    [safePlayer]
  );
  return (rows || [])
    .map((row) => cleanStrike({
      playerId: row.player_id,
      noteId: row.note_id,
      struckBy: row.struck_by,
      struckAt: row.struck_at,
      expiresAt: row.expires_at,
    }))
    .filter(Boolean);
}

/**
 * Forgive / undo: delete every strike for one player (expired
 * ones included — they do not count anyway, and a clear is a
 * clean slate). Returns how many rows were removed. Returns 0
 * without a pool or a player.
 */
export async function clearStrikesForPlayer(pool, playerId) {
  if (!pool) return 0;
  const safePlayer = String(playerId || '');
  if (!safePlayer) return 0;
  const res = await pool.query(
    'DELETE FROM player_strikes WHERE player_id = $1',
    [safePlayer]
  );
  return Number(res?.rowCount) || 0;
}
