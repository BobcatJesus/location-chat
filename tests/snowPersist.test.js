// snowPersist.test.js — Build a Snowman persistence
// (Snowman Persistence v1, `sq-snowman-persist-v1`).
//
// The snowman is saved to Postgres on every snowball add and
// loaded back lazily, so a server restart restores the snowman
// instead of wiping the group effort toward 15 — the same gap
// as the lights, reported by the user Nov 25, 2026 right after
// the lights piece landed (lights he hung had disappeared
// when he logged back in, after the gift-wrap and gift-giver
// pushes restarted the server).
//
// These tests cover the persistence layer
// (server/snowPersist.js) against a fake in-memory pool — no
// real Postgres needed. The socket.js wiring (ensureSnowLoaded /
// persistSnow in the snow handlers) is verified by node --check
// + code read: socket.js boots a server on import and cannot run
// in vitest.

import { describe, it, expect } from 'vitest';
import {
  SNOWMAN_PERSIST_MARKER,
  SNOWMAN_ROOM_STATE_TABLE,
  SNOWMAN_ROOM_STATE_TABLE_SQL,
  saveSnowState,
  loadSnowState,
} from '../server/snowPersist.js';
import {
  SNOW_TOTAL,
  SNOW_STAGE_THRESHOLDS,
  createSnowState,
  addSnowball,
  snowStage,
  serializeSnowState,
} from '../src/village/snowState.js';

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
      if (/SELECT data FROM snowman_room_state/i.test(sql)) {
        const data = store.get(params[0]);
        return { rows: data !== undefined ? [{ data }] : [] };
      }
      if (/INSERT INTO snowman_room_state/i.test(sql)) {
        store.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

const ROOM = 'shepherd-park';
const NOW = Date.now();

// Five first adds (one per user) + two repeat adds — every add
// counts (multi-hang from the start), so 7 counted snowballs.
function midSnowState() {
  const s = createSnowState();
  for (let i = 1; i <= 5; i++) {
    const res = addSnowball(s, `user-${i}`);
    expect(res.ok).toBe(true);
  }
  addSnowball(s, 'user-1');
  addSnowball(s, 'user-1');
  return s;
}

function finishedSnowState(completedAt = NOW) {
  const s = createSnowState();
  for (let i = 1; i <= SNOW_TOTAL; i++) {
    const res = addSnowball(s, `user-${i % 5}`);
    if (i === SNOW_TOTAL) expect(res.finished).toBe(true);
  }
  // addSnowball stamps Date.now(); pin the completion time so
  // the round trip is exact.
  s.completedAt = completedAt;
  return s;
}

describe('constants', () => {
  it('carries the v1 marker and the table name', () => {
    expect(SNOWMAN_PERSIST_MARKER).toBe('sq-snowman-persist-v1');
    expect(SNOWMAN_ROOM_STATE_TABLE).toBe('snowman_room_state');
  });

  it('creates one row per room with the serialized state as JSONB', () => {
    expect(SNOWMAN_ROOM_STATE_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS snowman_room_state/);
    expect(SNOWMAN_ROOM_STATE_TABLE_SQL).toMatch(/room_id TEXT PRIMARY KEY/);
    expect(SNOWMAN_ROOM_STATE_TABLE_SQL).toMatch(/data JSONB NOT NULL/);
  });

  it('keeps the snowman numbers: 15 total, stages at 1/5/9/12', () => {
    expect(SNOW_TOTAL).toBe(15);
    expect(SNOW_STAGE_THRESHOLDS).toEqual([1, 5, 9, 12]);
  });
});

describe('save/load round-trip', () => {
  it('restores a bare snow patch exactly', async () => {
    const pool = makeFakePool();
    const before = createSnowState();
    expect(await saveSnowState(pool, ROOM, before)).toBe(true);
    const loaded = await loadSnowState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeSnowState(loaded)).toEqual(serializeSnowState(before));
    expect(snowStage(loaded.counted)).toBe(0);
  });

  it('restores a mid-build snowman: counted, hungBy, contributors, stage', async () => {
    const pool = makeFakePool();
    const before = midSnowState();
    expect(before.counted).toBe(7);
    expect(snowStage(before.counted)).toBe(2); // base + middle
    await saveSnowState(pool, ROOM, before);
    const loaded = await loadSnowState(pool, ROOM);
    // The loaded row drives exactly the counted the client
    // shows from the serialized state — and the same stage.
    expect(serializeSnowState(loaded)).toEqual(serializeSnowState(before));
    expect(loaded.counted).toBe(7);
    expect(loaded.contributors).toEqual(['user-1', 'user-2', 'user-3', 'user-4', 'user-5']);
    expect(loaded.hungBy).toEqual({ 'user-1': 3, 'user-2': 1, 'user-3': 1, 'user-4': 1, 'user-5': 1 });
    expect(loaded.completed).toBe(false);
    expect(snowStage(loaded.counted)).toBe(2);
    expect(snowStage(loaded.counted)).toBe(snowStage(before.counted));
  });

  it('restores a finished snowman: 15 counted, stage 4, face+scarf', async () => {
    const pool = makeFakePool();
    const before = finishedSnowState(NOW - 10000);
    expect(before.counted).toBe(SNOW_TOTAL);
    expect(before.completed).toBe(true);
    expect(snowStage(before.counted)).toBe(4);
    await saveSnowState(pool, ROOM, before);
    const loaded = await loadSnowState(pool, ROOM);
    expect(serializeSnowState(loaded)).toEqual(serializeSnowState(before));
    expect(loaded.counted).toBe(SNOW_TOTAL);
    expect(loaded.completed).toBe(true);
    expect(loaded.completedAt).toBe(NOW - 10000);
    expect(snowStage(loaded.counted)).toBe(4);
  });

  it('writes an upsert (INSERT ... ON CONFLICT), one row per room', async () => {
    const pool = makeFakePool();
    await saveSnowState(pool, ROOM, createSnowState());
    await saveSnowState(pool, ROOM, midSnowState());
    expect(pool.store.size).toBe(1);
    expect(pool.queries.filter((q) => /INSERT INTO snowman_room_state/i.test(q.text))).toHaveLength(2);
    expect(pool.queries[0].text).toMatch(/ON CONFLICT \(room_id\)/);
    const loaded = await loadSnowState(pool, ROOM);
    expect(loaded.counted).toBe(7);
  });
});

describe('load of a missing row', () => {
  it('returns null — the caller starts with a bare patch, as today', async () => {
    const pool = makeFakePool();
    expect(await loadSnowState(pool, ROOM)).toBeNull();
    expect(await loadSnowState(pool, 'somewhere-else')).toBeNull();
  });
});

describe('no pool (local dev without Postgres)', () => {
  it('save is a no-op that never throws; load returns null', async () => {
    await expect(saveSnowState(null, ROOM, createSnowState())).resolves.toBe(false);
    await expect(loadSnowState(null, ROOM)).resolves.toBeNull();
    await expect(saveSnowState(undefined, ROOM, createSnowState())).resolves.toBe(false);
  });
});

describe('bad-row repair (never trust the row blindly)', () => {
  it('repairs a junk row to a bare snow patch', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        counted: 'nope',
        contributors: 'nope',
        hungBy: 42,
        completed: false,
        completedAt: 'junk',
      },
    });
    const loaded = await loadSnowState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeSnowState(loaded)).toEqual(serializeSnowState(createSnowState()));
    expect(snowStage(loaded.counted)).toBe(0);
  });

  it('forces a completed snowman claiming fewer than 15 up to 15', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        counted: 3,
        contributors: ['user-1'],
        hungBy: { 'user-1': 3 },
        completed: true,
        completedAt: NOW,
      },
    });
    const loaded = await loadSnowState(pool, ROOM);
    expect(loaded.counted).toBe(SNOW_TOTAL);
    expect(loaded.completed).toBe(true);
    expect(snowStage(loaded.counted)).toBe(4);
  });

  it('clamps a counted above 15 down to 15', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        counted: 99,
        contributors: ['user-1'],
        hungBy: { 'user-1': 99 },
        completed: false,
        completedAt: 0,
      },
    });
    const loaded = await loadSnowState(pool, ROOM);
    expect(loaded.counted).toBe(SNOW_TOTAL);
    expect(snowStage(loaded.counted)).toBe(4);
  });

  it('returns null for a row with no usable data', async () => {
    const pool = makeFakePool({ [ROOM]: 'not an object' });
    expect(await loadSnowState(pool, ROOM)).toBeNull();
    const pool2 = makeFakePool({ [ROOM]: null });
    expect(await loadSnowState(pool2, ROOM)).toBeNull();
  });

  it('returns null instead of throwing when the query fails', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(loadSnowState(pool, ROOM)).resolves.toBeNull();
  });
});

describe('restart-restore flow', () => {
  it('save, drop the in-memory entry, load again: same snowman', async () => {
    const pool = makeFakePool();
    const before = midSnowState();
    await saveSnowState(pool, ROOM, before);
    // The restart drops the in-memory entry entirely; the load
    // rebuilds it from the row alone.
    const after = await loadSnowState(pool, ROOM);
    expect(serializeSnowState(after)).toEqual(serializeSnowState(before));
    expect(after.counted).toBe(7);
    expect(snowStage(after.counted)).toBe(2);
  });

  it('a finished snowman survives a restart with stage 4', async () => {
    const pool = makeFakePool();
    const before = finishedSnowState(NOW - 10000);
    await saveSnowState(pool, ROOM, before);
    const after = await loadSnowState(pool, ROOM);
    expect(after.counted).toBe(SNOW_TOTAL);
    expect(after.completed).toBe(true);
    expect(snowStage(after.counted)).toBe(4);
  });
});

describe('load-before-mutate simulation', () => {
  it('persisted mid-build state + fresh cache -> load -> add -> save -> reload shows the add', async () => {
    const pool = makeFakePool();
    // Before the "restart": seven counted snowballs, saved.
    await saveSnowState(pool, ROOM, midSnowState());
    // The restart drops the in-memory cache; the first touch after
    // it loads the row (ensureSnowLoaded) BEFORE mutating.
    const cache = await loadSnowState(pool, ROOM);
    expect(cache.counted).toBe(7);
    const res = addSnowball(cache, 'user-6');
    expect(res.ok).toBe(true);
    expect(cache.counted).toBe(8);
    await saveSnowState(pool, ROOM, cache);
    // A second restart (or another device) sees eight counted
    // snowballs and the new contributor — the pre-restart
    // progress was not overwritten by the bare patch.
    const after = await loadSnowState(pool, ROOM);
    expect(after.counted).toBe(8);
    expect(after.contributors).toContain('user-6');
    expect(after.hungBy['user-6']).toBe(1);
  });

  it('an add after a restart on a finished snowman is refused', async () => {
    const pool = makeFakePool();
    await saveSnowState(pool, ROOM, finishedSnowState(NOW - 10000));
    const cache = await loadSnowState(pool, ROOM);
    expect(cache.completed).toBe(true);
    const res = addSnowball(cache, 'user-1');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('already-complete');
    const after = await loadSnowState(pool, ROOM);
    expect(after.counted).toBe(SNOW_TOTAL);
    expect(after.completed).toBe(true);
  });
});

describe('save errors', () => {
  it('saveSnowState propagates a DB error (the socket.js caller catches it)', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(saveSnowState(pool, ROOM, createSnowState())).rejects.toThrow('db down');
  });
});
