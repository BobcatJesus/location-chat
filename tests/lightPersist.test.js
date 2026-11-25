// lightPersist.test.js — Christmas Lights persistence
// (Lights Persistence v1, `sq-lights-persist-v1`).
//
// The lights are saved to Postgres on every hang and loaded back
// lazily, so a server restart restores the strands instead of
// wiping the group effort toward 25 — the user-reported loss,
// Nov 25, 2026: lights he hung disappeared when he logged back
// in, after the gift-wrap and gift-giver pushes restarted the
// server.
//
// These tests cover the persistence layer
// (server/lightPersist.js) against a fake in-memory pool — no
// real Postgres needed. The socket.js wiring (ensureLightLoaded /
// persistLight in the lights handlers) is verified by node --check
// + code read: socket.js boots a server on import and cannot run
// in vitest.

import { describe, it, expect } from 'vitest';
import {
  LIGHTS_PERSIST_MARKER,
  LIGHTS_ROOM_STATE_TABLE,
  LIGHTS_ROOM_STATE_TABLE_SQL,
  saveLightState,
  loadLightState,
} from '../server/lightPersist.js';
import {
  LIGHTS_TOTAL,
  createLightState,
  hangLight,
  serializeLightState,
} from '../src/village/lightState.js';

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
      if (/SELECT data FROM lights_room_state/i.test(sql)) {
        const data = store.get(params[0]);
        return { rows: data !== undefined ? [{ data }] : [] };
      }
      if (/INSERT INTO lights_room_state/i.test(sql)) {
        store.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

const ROOM = 'agora-houston';
const NOW = Date.now();

// Hang spots, one per hang: the bar wall plus the four corners
// (v1.3), so the lit slots are spread, not just 0..N.
const SPOTS = [
  { x: 800, y: 190 }, // bar wall
  { x: 220, y: 170 }, // NW corner
  { x: 1380, y: 170 }, // NE corner
  { x: 1420, y: 620 }, // SE corner
  { x: 180, y: 600 }, // SW corner
  { x: 800, y: 190 },
  { x: 220, y: 170 },
];

function midLightsState() {
  const s = createLightState();
  for (let i = 1; i <= 5; i++) {
    const res = hangLight(s, `user-${i}`, SPOTS[i - 1]);
    expect(res.ok).toBe(true);
  }
  hangLight(s, 'user-1', SPOTS[5]); // second hang — counts too (v1.2)
  hangLight(s, 'user-2', SPOTS[6]); // second hang — counts too (v1.2)
  return s;
}

function finishedLightsState(completedAt = NOW) {
  const s = createLightState();
  for (let i = 1; i <= LIGHTS_TOTAL; i++) {
    const res = hangLight(s, `user-${i % 5}`, SPOTS[i % SPOTS.length]);
    if (i === LIGHTS_TOTAL) expect(res.finished).toBe(true);
  }
  // hangLight stamps Date.now(); pin the completion time so the
  // round trip is exact.
  s.completedAt = completedAt;
  return s;
}

describe('constants', () => {
  it('carries the v1 marker and the table name', () => {
    expect(LIGHTS_PERSIST_MARKER).toBe('sq-lights-persist-v1');
    expect(LIGHTS_ROOM_STATE_TABLE).toBe('lights_room_state');
  });

  it('creates one row per room with the serialized state as JSONB', () => {
    expect(LIGHTS_ROOM_STATE_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS lights_room_state/);
    expect(LIGHTS_ROOM_STATE_TABLE_SQL).toMatch(/room_id TEXT PRIMARY KEY/);
    expect(LIGHTS_ROOM_STATE_TABLE_SQL).toMatch(/data JSONB NOT NULL/);
  });
});

describe('save/load round-trip', () => {
  it('restores bare strands exactly', async () => {
    const pool = makeFakePool();
    const before = createLightState();
    expect(await saveLightState(pool, ROOM, before)).toBe(true);
    const loaded = await loadLightState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeLightState(loaded)).toEqual(serializeLightState(before));
  });

  it('restores a mid-room state: counted, lit slots, hungBy, contributors', async () => {
    const pool = makeFakePool();
    const before = midLightsState();
    expect(before.counted).toBe(7);
    expect(before.lit).toHaveLength(7);
    await saveLightState(pool, ROOM, before);
    const loaded = await loadLightState(pool, ROOM);
    // The loaded row drives exactly the counted/lit the client
    // shows from the serialized state — same slots, same order.
    expect(serializeLightState(loaded)).toEqual(serializeLightState(before));
    expect(loaded.counted).toBe(7);
    expect(loaded.lit).toEqual(before.lit);
    expect(loaded.contributors).toEqual(['user-1', 'user-2', 'user-3', 'user-4', 'user-5']);
    expect(loaded.hungBy).toEqual({ 'user-1': 2, 'user-2': 2, 'user-3': 1, 'user-4': 1, 'user-5': 1 });
    expect(loaded.completed).toBe(false);
  });

  it('restores a finished room: 25 counted, all slots lit', async () => {
    const pool = makeFakePool();
    const before = finishedLightsState(NOW - 10000);
    expect(before.counted).toBe(LIGHTS_TOTAL);
    expect(before.completed).toBe(true);
    await saveLightState(pool, ROOM, before);
    const loaded = await loadLightState(pool, ROOM);
    expect(serializeLightState(loaded)).toEqual(serializeLightState(before));
    expect(loaded.counted).toBe(LIGHTS_TOTAL);
    expect(loaded.completed).toBe(true);
    expect(loaded.completedAt).toBe(NOW - 10000);
    expect(loaded.lit).toHaveLength(LIGHTS_TOTAL);
    expect([...loaded.lit].sort((a, b) => a - b)).toEqual(
      Array.from({ length: LIGHTS_TOTAL }, (_, i) => i)
    );
  });

  it('writes an upsert (INSERT ... ON CONFLICT), one row per room', async () => {
    const pool = makeFakePool();
    await saveLightState(pool, ROOM, createLightState());
    await saveLightState(pool, ROOM, midLightsState());
    expect(pool.store.size).toBe(1);
    expect(pool.queries.filter((q) => /INSERT INTO lights_room_state/i.test(q.text))).toHaveLength(2);
    expect(pool.queries[0].text).toMatch(/ON CONFLICT \(room_id\)/);
    const loaded = await loadLightState(pool, ROOM);
    expect(loaded.counted).toBe(7);
  });
});

describe('load of a missing row', () => {
  it('returns null — the caller starts with bare strands, as today', async () => {
    const pool = makeFakePool();
    expect(await loadLightState(pool, ROOM)).toBeNull();
    expect(await loadLightState(pool, 'somewhere-else')).toBeNull();
  });
});

describe('no pool (local dev without Postgres)', () => {
  it('save is a no-op that never throws; load returns null', async () => {
    await expect(saveLightState(null, ROOM, createLightState())).resolves.toBe(false);
    await expect(loadLightState(null, ROOM)).resolves.toBeNull();
    await expect(saveLightState(undefined, ROOM, createLightState())).resolves.toBe(false);
  });
});

describe('bad-row repair (never trust the row blindly)', () => {
  it('repairs a junk row to bare strands', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        counted: 'nope',
        contributors: 'nope',
        hungBy: 42,
        lit: 'junk',
      },
    });
    const loaded = await loadLightState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeLightState(loaded)).toEqual(serializeLightState(createLightState()));
  });

  it('repairs a missing lit list to the first N slots', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        counted: 5,
        contributors: ['user-1'],
        hungBy: { 'user-1': 5 },
        completed: false,
        completedAt: 0,
      },
    });
    const loaded = await loadLightState(pool, ROOM);
    expect(loaded.counted).toBe(5);
    expect(loaded.lit).toEqual([0, 1, 2, 3, 4]);
  });

  it('repairs a short lit list by filling the first unlit slots', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        counted: 5,
        lit: [10, 3],
        contributors: ['user-1'],
        hungBy: { 'user-1': 5 },
        completed: false,
        completedAt: 0,
      },
    });
    const loaded = await loadLightState(pool, ROOM);
    expect(loaded.counted).toBe(5);
    // The two real slots keep their order; the shortfall fills
    // with the first unlit slots in the old fixed order.
    expect(loaded.lit).toEqual([10, 3, 0, 1, 2]);
  });

  it('repairs a lit list with duplicates and out-of-range slots', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        counted: 5,
        lit: [0, 0, 99, -1, 3],
        contributors: ['user-1'],
        hungBy: { 'user-1': 5 },
        completed: false,
        completedAt: 0,
      },
    });
    const loaded = await loadLightState(pool, ROOM);
    expect(loaded.lit).toEqual([0, 3, 1, 2, 4]);
  });

  it('forces a completed room claiming fewer than 25 up to 25', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        counted: 3,
        lit: [0, 1, 2],
        contributors: ['user-1'],
        hungBy: { 'user-1': 3 },
        completed: true,
        completedAt: NOW,
      },
    });
    const loaded = await loadLightState(pool, ROOM);
    expect(loaded.counted).toBe(LIGHTS_TOTAL);
    expect(loaded.completed).toBe(true);
    expect(loaded.lit).toHaveLength(LIGHTS_TOTAL);
  });

  it('returns null for a row with no usable data', async () => {
    const pool = makeFakePool({ [ROOM]: 'not an object' });
    expect(await loadLightState(pool, ROOM)).toBeNull();
    const pool2 = makeFakePool({ [ROOM]: null });
    expect(await loadLightState(pool2, ROOM)).toBeNull();
  });

  it('returns null instead of throwing when the query fails', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(loadLightState(pool, ROOM)).resolves.toBeNull();
  });
});

describe('restart-restore flow', () => {
  it('save, drop the in-memory entry, load again: same strands', async () => {
    const pool = makeFakePool();
    const before = midLightsState();
    await saveLightState(pool, ROOM, before);
    // The restart drops the in-memory entry entirely; the load
    // rebuilds it from the row alone.
    const after = await loadLightState(pool, ROOM);
    expect(serializeLightState(after)).toEqual(serializeLightState(before));
    expect(after.lit).toEqual(before.lit);
  });

  it('a finished room survives a restart with all 25 slots lit', async () => {
    const pool = makeFakePool();
    const before = finishedLightsState(NOW - 10000);
    await saveLightState(pool, ROOM, before);
    const after = await loadLightState(pool, ROOM);
    expect(after.counted).toBe(LIGHTS_TOTAL);
    expect(after.completed).toBe(true);
    expect(after.lit).toHaveLength(LIGHTS_TOTAL);
  });
});

describe('load-before-mutate simulation', () => {
  it('persisted mid-room state + fresh cache -> load -> hang -> save -> reload shows the hang', async () => {
    const pool = makeFakePool();
    // Before the "restart": seven counted hangs, saved (five first
    // hangs + two repeat hangs — every hang counts in v1.2).
    await saveLightState(pool, ROOM, midLightsState());
    // The restart drops the in-memory cache; the first touch after
    // it loads the row (ensureLightLoaded) BEFORE mutating.
    const cache = await loadLightState(pool, ROOM);
    expect(cache.counted).toBe(7);
    expect(cache.lit).toHaveLength(7);
    const res = hangLight(cache, 'user-6', { x: 800, y: 190 });
    expect(res.ok).toBe(true);
    expect(res.counted).toBe(true);
    await saveLightState(pool, ROOM, cache);
    // A second restart (or another device) sees eight counted
    // hangs, eight lit slots, and the new contributor — the
    // pre-restart progress was not overwritten by the bare strands.
    const after = await loadLightState(pool, ROOM);
    expect(after.counted).toBe(8);
    expect(after.lit).toHaveLength(8);
    expect(after.contributors).toContain('user-6');
  });

  it('a hang after a restart does not resurrect a finished room', async () => {
    const pool = makeFakePool();
    await saveLightState(pool, ROOM, finishedLightsState(NOW - 10000));
    const cache = await loadLightState(pool, ROOM);
    expect(cache.completed).toBe(true);
    const res = hangLight(cache, 'user-1', { x: 800, y: 190 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('already-complete');
    const after = await loadLightState(pool, ROOM);
    expect(after.counted).toBe(LIGHTS_TOTAL);
    expect(after.completed).toBe(true);
  });
});

describe('save errors', () => {
  it('saveLightState propagates a DB error (the socket.js caller catches it)', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(saveLightState(pool, ROOM, createLightState())).rejects.toThrow('db down');
  });
});
