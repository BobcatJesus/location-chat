// hatPersist.test.js — Santa Hat persistence (`sq-hat-persist-v1`).
//
// Piece 1 of the room-state persistence fix: the hat room state is
// saved to Postgres on every mutation and loaded back lazily, so a
// server restart restores the hat instead of hiding it behind the
// tree again.
//
// These tests cover the persistence layer (server/hatPersist.js)
// against a fake in-memory pool — no real Postgres needed. The
// socket.js wiring (ensureHatLoaded / persistHat in the hat
// handlers) is verified by node --check + code read: socket.js
// boots a server on import and cannot run in vitest.

import { describe, it, expect } from 'vitest';
import {
  HAT_PERSIST_MARKER,
  HAT_ROOM_STATE_TABLE,
  HAT_ROOM_STATE_TABLE_SQL,
  saveHatState,
  loadHatState,
  repairLoadedHatState,
} from '../server/hatPersist.js';
import {
  HAT_HIDE_SPOT,
  HAT_SLIP_MS,
  createHatState,
  findHat,
  placeHat,
  slipHat,
  pickupHat,
  releaseHat,
  serializeHatState,
} from '../src/village/hatState.js';

// Tiny in-memory stand-in for a pg Pool: one Map keyed by room_id,
// answering only the two queries the persistence layer issues.
function makeFakePool(initial = {}) {
  const store = new Map(Object.entries(initial));
  const queries = [];
  return {
    store,
    queries,
    async query(text, params = []) {
      queries.push({ text, params });
      const sql = String(text);
      if (/SELECT data FROM hat_room_state/i.test(sql)) {
        const data = store.get(params[0]);
        return { rows: data !== undefined ? [{ data }] : [] };
      }
      if (/INSERT INTO hat_room_state/i.test(sql)) {
        store.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

const ROOM = 'agora-houston';
const NOW = Date.now();

function onCatState(now = NOW) {
  const s = createHatState();
  findHat(s, 'user-1');
  placeHat(s, 'user-1', now);
  return s;
}

function groundState(now = NOW) {
  const s = onCatState(now - HAT_SLIP_MS - 1000);
  slipHat(s, 500, 600, now);
  return s;
}

describe('constants', () => {
  it('carries the v1 marker and the table name', () => {
    expect(HAT_PERSIST_MARKER).toBe('sq-hat-persist-v1');
    expect(HAT_ROOM_STATE_TABLE).toBe('hat_room_state');
  });

  it('creates one row per room with the serialized state as JSONB', () => {
    expect(HAT_ROOM_STATE_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS hat_room_state/);
    expect(HAT_ROOM_STATE_TABLE_SQL).toMatch(/room_id TEXT PRIMARY KEY/);
    expect(HAT_ROOM_STATE_TABLE_SQL).toMatch(/data JSONB NOT NULL/);
  });
});

describe('save/load round-trip — every status', () => {
  it.each([
    ['hidden', () => createHatState()],
    ['carried', () => { const s = createHatState(); findHat(s, 'user-1'); return s; }],
    ['onCat', () => onCatState()],
    ['ground', () => groundState()],
  ])('restores a %s hat exactly', async (_label, build) => {
    const pool = makeFakePool();
    const before = build();
    expect(await saveHatState(pool, ROOM, before)).toBe(true);
    const loaded = await loadHatState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(loaded.repaired).toBe(false);
    expect(serializeHatState(loaded.state)).toEqual(serializeHatState(before));
  });

  it('writes an upsert (INSERT ... ON CONFLICT), one row per room', async () => {
    const pool = makeFakePool();
    await saveHatState(pool, ROOM, createHatState());
    await saveHatState(pool, ROOM, onCatState());
    expect(pool.store.size).toBe(1);
    expect(pool.queries.filter((q) => /INSERT INTO hat_room_state/i.test(q.text))).toHaveLength(2);
    expect(pool.queries[0].text).toMatch(/ON CONFLICT \(room_id\)/);
    const loaded = await loadHatState(pool, ROOM);
    expect(loaded.state.status).toBe('onCat');
  });
});

describe('load of a missing row', () => {
  it('returns null — the caller starts hidden, as today', async () => {
    const pool = makeFakePool();
    expect(await loadHatState(pool, ROOM)).toBeNull();
    expect(await loadHatState(pool, 'somewhere-else')).toBeNull();
  });
});

describe('no pool (local dev without Postgres)', () => {
  it('save is a no-op that never throws; load returns null', async () => {
    await expect(saveHatState(null, ROOM, createHatState())).resolves.toBe(false);
    await expect(loadHatState(null, ROOM)).resolves.toBeNull();
    await expect(saveHatState(undefined, ROOM, createHatState())).resolves.toBe(false);
  });
});

describe('bad-row repair (never trust the row blindly)', () => {
  it.each([
    ['a nonsense status', { status: 'floating', carriedBy: '', placedBy: '', groundX: 0, groundY: 0, wornAt: 0, slipAt: 0 }],
    ['carried with no carrier', { status: 'carried', carriedBy: '', placedBy: '', groundX: 0, groundY: 0, wornAt: 0, slipAt: 0 }],
    ['onCat with no slip time', { status: 'onCat', carriedBy: '', placedBy: 'user-1', groundX: 0, groundY: 0, wornAt: 123, slipAt: 0 }],
  ])('repairs %s to hidden', async (_label, data) => {
    const pool = makeFakePool({ [ROOM]: data });
    const loaded = await loadHatState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(loaded.state.status).toBe('hidden');
    expect(loaded.repaired).toBe(false);
  });

  it('returns null for a row with no usable data', async () => {
    const pool = makeFakePool({ [ROOM]: 'not an object' });
    expect(await loadHatState(pool, ROOM)).toBeNull();
    const pool2 = makeFakePool({ [ROOM]: null });
    expect(await loadHatState(pool2, ROOM)).toBeNull();
  });

  it('returns null instead of throwing when the query fails', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(loadHatState(pool, ROOM)).resolves.toBeNull();
  });
});

describe('slip due while the server was down', () => {
  it('moves an overdue onCat hat to the ground at the foot of the tree', () => {
    const s = onCatState(NOW - HAT_SLIP_MS - 5000);
    const { state, repaired } = repairLoadedHatState(s, NOW);
    expect(repaired).toBe(true);
    expect(state.status).toBe('ground');
    expect(state.groundX).toBe(HAT_HIDE_SPOT.x);
    expect(state.groundY).toBe(HAT_HIDE_SPOT.y);
    expect(state.wornAt).toBe(0);
    expect(state.slipAt).toBe(0);
    // The placer is kept (history), the carrier is not invented.
    expect(state.placedBy).toBe('user-1');
  });

  it('leaves an onCat hat alone while its slip time is still ahead', () => {
    const s = onCatState(NOW);
    const { state, repaired } = repairLoadedHatState(s, NOW);
    expect(repaired).toBe(false);
    expect(state.status).toBe('onCat');
    expect(state.slipAt).toBe(NOW + HAT_SLIP_MS);
  });

  it('repairs on load, not just in the pure helper', async () => {
    const pool = makeFakePool();
    await saveHatState(pool, ROOM, onCatState(NOW - HAT_SLIP_MS - 5000));
    const loaded = await loadHatState(pool, ROOM);
    expect(loaded.repaired).toBe(true);
    expect(loaded.state.status).toBe('ground');
    expect(loaded.state.groundX).toBe(HAT_HIDE_SPOT.x);
  });
});

describe('restart-restore flow', () => {
  it('save, drop the in-memory entry, load again: same state', async () => {
    const pool = makeFakePool();
    // Before the "restart": find it, put it on the cat.
    const before = createHatState();
    findHat(before, 'user-1');
    placeHat(before, 'user-1', NOW);
    await saveHatState(pool, ROOM, before);
    // The restart drops the in-memory entry entirely; the load
    // rebuilds it from the row alone.
    const after = await loadHatState(pool, ROOM);
    expect(serializeHatState(after.state)).toEqual(serializeHatState(before));
  });

  it('a carried hat loads back with its carrier', async () => {
    const pool = makeFakePool();
    const before = createHatState();
    findHat(before, 'user-1');
    await saveHatState(pool, ROOM, before);
    const after = await loadHatState(pool, ROOM);
    expect(after.state.status).toBe('carried');
    expect(after.state.carriedBy).toBe('user-1');
  });

  it('a release after a restart goes back to hidden and stays there', async () => {
    const pool = makeFakePool();
    const s = createHatState();
    findHat(s, 'user-1');
    await saveHatState(pool, ROOM, s);
    const reloaded = (await loadHatState(pool, ROOM)).state;
    releaseHat(reloaded, 'user-1');
    await saveHatState(pool, ROOM, reloaded);
    expect((await loadHatState(pool, ROOM)).state.status).toBe('hidden');
  });

  it('a pickup after a restart goes to the new carrier', async () => {
    const pool = makeFakePool();
    await saveHatState(pool, ROOM, groundState());
    const reloaded = (await loadHatState(pool, ROOM)).state;
    pickupHat(reloaded, 'user-2');
    await saveHatState(pool, ROOM, reloaded);
    const after = await loadHatState(pool, ROOM);
    expect(after.state.status).toBe('carried');
    expect(after.state.carriedBy).toBe('user-2');
  });
});

describe('save errors', () => {
  it('saveHatState propagates a DB error (the socket.js caller catches it)', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(saveHatState(pool, ROOM, createHatState())).rejects.toThrow('db down');
  });
});
