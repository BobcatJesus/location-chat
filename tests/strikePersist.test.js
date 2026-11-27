// strikePersist.test.js — Notes Strike System v1
// (`sq-notes-strikes-v1`).
//
// Strikes are rows in Postgres (player_strikes), so a server
// restart never forgives a strike early and a mute survives a
// redeploy. One row per strike: who, which note earned it (for
// audit), who struck them, when, and when it expires (30 days).
//
// These tests cover the persistence layer
// (server/strikePersist.js) against a fake in-memory pool — no
// real Postgres needed. The socket.js wiring (the strike cache,
// the note_strike / note_clear_strikes handlers) is verified by
// node --check + code read: socket.js boots a server on import
// and cannot run in vitest.

import { describe, it, expect } from 'vitest';
import {
  STRIKE_PERSIST_MARKER,
  PLAYER_STRIKES_TABLE,
  PLAYER_STRIKES_TABLE_SQL,
  addStrike,
  listStrikesForPlayer,
  clearStrikesForPlayer,
} from '../server/strikePersist.js';
import { STRIKE_EXPIRE_MS } from '../src/village/strikeState.js';

const NOW = 1800000000000;
const DAY = 24 * 60 * 60 * 1000;
const TROLL = 'troll@example.com';
const MOD = 'tfkelleher3@gmail.com';

// Tiny in-memory stand-in for a pg Pool: an array of rows,
// answering only the queries the persistence layer issues. Rows
// come back the way pg returns TIMESTAMPTZ — as Date objects.
function makeFakePool() {
  const rows = [];
  const queries = [];
  let nextId = 1;
  return {
    rows,
    queries,
    async query(text, params = []) {
      queries.push({ text, params });
      const sql = String(text);
      if (/INSERT INTO player_strikes/i.test(sql)) {
        const row = {
          id: nextId++,
          player_id: params[0],
          note_id: params[1],
          struck_by: params[2],
          struck_at: new Date(params[3]),
          expires_at: new Date(params[4]),
        };
        rows.push(row);
        return { rows: [row] };
      }
      if (/SELECT [\s\S]* FROM player_strikes/i.test(sql)) {
        return {
          rows: rows
            .filter((r) => r.player_id === params[0])
            .sort((a, b) => a.struck_at - b.struck_at)
            .map((r) => ({ ...r })),
        };
      }
      if (/DELETE FROM player_strikes/i.test(sql)) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].player_id === params[0]) rows.splice(i, 1);
        }
        return { rowCount: before - rows.length, rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

function strikeInput(n, struckAt = NOW, overrides = {}) {
  return {
    playerId: TROLL,
    noteId: `note-${n}`,
    struckBy: MOD,
    struckAt,
    expiresAt: struckAt + STRIKE_EXPIRE_MS,
    ...overrides,
  };
}

describe('constants', () => {
  it('carries the v1 marker and the table shape', () => {
    expect(STRIKE_PERSIST_MARKER).toBe('sq-notes-strikes-v1');
    expect(PLAYER_STRIKES_TABLE).toBe('player_strikes');
    expect(PLAYER_STRIKES_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS player_strikes/);
    expect(PLAYER_STRIKES_TABLE_SQL).toMatch(/player_id TEXT NOT NULL/);
    expect(PLAYER_STRIKES_TABLE_SQL).toMatch(/note_id TEXT/);
    expect(PLAYER_STRIKES_TABLE_SQL).toMatch(/struck_by TEXT NOT NULL/);
    expect(PLAYER_STRIKES_TABLE_SQL).toMatch(/struck_at TIMESTAMPTZ NOT NULL/);
    expect(PLAYER_STRIKES_TABLE_SQL).toMatch(/expires_at TIMESTAMPTZ NOT NULL/);
  });
});

describe('add/list round-trip', () => {
  it('a strike survives save/load — a restart never forgives it early', async () => {
    const pool = makeFakePool();
    const saved = await addStrike(pool, strikeInput(1));
    expect(saved).not.toBeNull();
    expect(saved.playerId).toBe(TROLL);
    expect(saved.noteId).toBe('note-1');
    expect(saved.struckAt).toBe(NOW);
    expect(saved.expiresAt).toBe(NOW + STRIKE_EXPIRE_MS);
    const listed = await listStrikesForPlayer(pool, TROLL);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(saved);
  });

  it('lists in struck order and only for that player', async () => {
    const pool = makeFakePool();
    await addStrike(pool, strikeInput(2, NOW - DAY));
    await addStrike(pool, strikeInput(1, NOW - 2 * DAY));
    await addStrike(pool, { ...strikeInput(9, NOW), playerId: 'someone-else@example.com' });
    const listed = await listStrikesForPlayer(pool, TROLL);
    expect(listed.map((s) => s.noteId)).toEqual(['note-1', 'note-2']);
    expect(await listStrikesForPlayer(pool, 'nobody@example.com')).toEqual([]);
  });

  it('an expired strike is still listed (expiry is judged by the mute logic, not the store)', async () => {
    const pool = makeFakePool();
    await addStrike(pool, strikeInput(1, NOW - 31 * DAY));
    const listed = await listStrikesForPlayer(pool, TROLL);
    expect(listed).toHaveLength(1);
    // The pure mute logic — not the store — decides it does not count.
    expect(listed[0].expiresAt).toBeLessThanOrEqual(NOW);
  });

  it('a strike without a note id is fine (null note_id)', async () => {
    const pool = makeFakePool();
    const saved = await addStrike(pool, { ...strikeInput(1), noteId: null });
    expect(saved.noteId).toBeNull();
    expect((await listStrikesForPlayer(pool, TROLL))[0].noteId).toBeNull();
  });

  it('derives expiresAt from struckAt when it is missing', async () => {
    const pool = makeFakePool();
    const saved = await addStrike(pool, { playerId: TROLL, struckBy: MOD, struckAt: NOW });
    expect(saved.expiresAt).toBe(NOW + STRIKE_EXPIRE_MS);
  });

  it('returns null / [] with no pool or no player', async () => {
    expect(await addStrike(null, strikeInput(1))).toBeNull();
    expect(await listStrikesForPlayer(null, TROLL)).toEqual([]);
    const pool = makeFakePool();
    expect(await addStrike(pool, { playerId: '', struckBy: MOD, struckAt: NOW })).toBeNull();
    expect(await listStrikesForPlayer(pool, '')).toEqual([]);
  });
});

describe('clearStrikesForPlayer', () => {
  it('removes every strike for that player and only that player', async () => {
    const pool = makeFakePool();
    await addStrike(pool, strikeInput(1, NOW - 2 * DAY));
    await addStrike(pool, strikeInput(2, NOW - DAY));
    await addStrike(pool, { ...strikeInput(9, NOW), playerId: 'someone-else@example.com' });
    const removed = await clearStrikesForPlayer(pool, TROLL);
    expect(removed).toBe(2);
    expect(await listStrikesForPlayer(pool, TROLL)).toEqual([]);
    expect(await listStrikesForPlayer(pool, 'someone-else@example.com')).toHaveLength(1);
  });

  it('clearing a player with no strikes removes nothing', async () => {
    const pool = makeFakePool();
    expect(await clearStrikesForPlayer(pool, TROLL)).toBe(0);
    expect(await clearStrikesForPlayer(null, TROLL)).toBe(0);
  });
});
