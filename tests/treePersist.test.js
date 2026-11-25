// treePersist.test.js — Trim the Tree persistence
// (`sq-tree-persist-v1`; v1.2 `sq-christmas-multi-v1.2` — every
// hang counts, so the mid-tree fixture is 7 counted, not 5+2).
//
// Piece 4 of the room-state persistence fix: the trees are saved
// to Postgres on every hang and loaded back lazily, so a server
// restart restores them instead of wiping the group effort toward
// 25.
//
// These tests cover the persistence layer
// (server/treePersist.js) against a fake in-memory pool — no
// real Postgres needed. The socket.js wiring (ensureTreeLoaded /
// persistTree in the tree handlers) is verified by node --check +
// code read: socket.js boots a server on import and cannot run in
// vitest.

import { describe, it, expect } from 'vitest';
import {
  TREE_PERSIST_MARKER,
  TREE_ROOM_STATE_TABLE,
  TREE_ROOM_STATE_TABLE_SQL,
  saveTreeState,
  loadTreeState,
} from '../server/treePersist.js';
import {
  TREE_TOTAL,
  createTreeState,
  hangOrnament,
  serializeTreeState,
} from '../src/village/treeState.js';

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
      if (/SELECT data FROM tree_room_state/i.test(sql)) {
        const data = store.get(params[0]);
        return { rows: data !== undefined ? [{ data }] : [] };
      }
      if (/INSERT INTO tree_room_state/i.test(sql)) {
        store.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

const ROOM = 'agora-houston';
const NOW = Date.now();

function midTreeState() {
  const s = createTreeState();
  for (let i = 1; i <= 5; i++) hangOrnament(s, `user-${i}`);
  hangOrnament(s, 'user-1'); // second hang — counts too (v1.2)
  hangOrnament(s, 'user-2'); // second hang — counts too (v1.2)
  return s;
}

function finishedTree1State(completedAt = NOW) {
  const s = createTreeState();
  for (let i = 1; i <= TREE_TOTAL; i++) {
    const res = hangOrnament(s, `user-${i}`);
    if (i === TREE_TOTAL) expect(res.treeFinished).toBe(true);
  }
  // hangOrnament stamps Date.now(); pin the completion time so
  // the round trip is exact.
  s.trees[0].completedAt = completedAt;
  return s;
}

function bothDoneState() {
  const s = finishedTree1State(NOW - 10000);
  for (let i = 1; i <= TREE_TOTAL; i++) {
    const res = hangOrnament(s, `user-${i}`);
    if (i === TREE_TOTAL) expect(res.treeFinished).toBe(true);
  }
  s.trees[1].completedAt = NOW;
  return s;
}

describe('constants', () => {
  it('carries the v1 marker and the table name', () => {
    expect(TREE_PERSIST_MARKER).toBe('sq-tree-persist-v1');
    expect(TREE_ROOM_STATE_TABLE).toBe('tree_room_state');
  });

  it('creates one row per room with the serialized state as JSONB', () => {
    expect(TREE_ROOM_STATE_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS tree_room_state/);
    expect(TREE_ROOM_STATE_TABLE_SQL).toMatch(/room_id TEXT PRIMARY KEY/);
    expect(TREE_ROOM_STATE_TABLE_SQL).toMatch(/data JSONB NOT NULL/);
  });
});

describe('save/load round-trip', () => {
  it('restores bare trees exactly', async () => {
    const pool = makeFakePool();
    const before = createTreeState();
    expect(await saveTreeState(pool, ROOM, before)).toBe(true);
    const loaded = await loadTreeState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeTreeState(loaded)).toEqual(serializeTreeState(before));
  });

  it('restores a mid-tree-1 state: counted, hungBy, contributors', async () => {
    const pool = makeFakePool();
    const before = midTreeState();
    expect(before.active).toBe(0);
    expect(before.trees[0].counted).toBe(7);
    expect(before.trees[0]).not.toHaveProperty('extras');
    await saveTreeState(pool, ROOM, before);
    const loaded = await loadTreeState(pool, ROOM);
    expect(serializeTreeState(loaded)).toEqual(serializeTreeState(before));
    expect(loaded.active).toBe(0);
    expect(loaded.trees[0].counted).toBe(7);
    expect(loaded.trees[0]).not.toHaveProperty('extras');
    expect(loaded.trees[0].contributors).toEqual(['user-1', 'user-2', 'user-3', 'user-4', 'user-5']);
    expect(loaded.trees[0].hungBy).toEqual({ 'user-1': 2, 'user-2': 2, 'user-3': 1, 'user-4': 1, 'user-5': 1 });
    expect(loaded.trees[0].completed).toBe(false);
    expect(loaded.trees[1].counted).toBe(0);
  });

  it('restores tree 1 finished with tree 2 active', async () => {
    const pool = makeFakePool();
    const before = finishedTree1State(NOW - 10000);
    expect(before.active).toBe(1);
    expect(before.trees[0].completed).toBe(true);
    await saveTreeState(pool, ROOM, before);
    const loaded = await loadTreeState(pool, ROOM);
    expect(serializeTreeState(loaded)).toEqual(serializeTreeState(before));
    expect(loaded.active).toBe(1);
    expect(loaded.trees[0].counted).toBe(TREE_TOTAL);
    expect(loaded.trees[0].completedAt).toBe(NOW - 10000);
    expect(loaded.trees[1].counted).toBe(0);
    expect(loaded.trees[1].completed).toBe(false);
  });

  it('restores both trees done with active -1', async () => {
    const pool = makeFakePool();
    const before = bothDoneState();
    expect(before.active).toBe(-1);
    await saveTreeState(pool, ROOM, before);
    const loaded = await loadTreeState(pool, ROOM);
    expect(serializeTreeState(loaded)).toEqual(serializeTreeState(before));
    expect(loaded.active).toBe(-1);
    expect(loaded.trees[0].completed).toBe(true);
    expect(loaded.trees[1].completed).toBe(true);
  });

  it('writes an upsert (INSERT ... ON CONFLICT), one row per room', async () => {
    const pool = makeFakePool();
    await saveTreeState(pool, ROOM, createTreeState());
    await saveTreeState(pool, ROOM, midTreeState());
    expect(pool.store.size).toBe(1);
    expect(pool.queries.filter((q) => /INSERT INTO tree_room_state/i.test(q.text))).toHaveLength(2);
    expect(pool.queries[0].text).toMatch(/ON CONFLICT \(room_id\)/);
    const loaded = await loadTreeState(pool, ROOM);
    expect(loaded.trees[0].counted).toBe(7);
  });
});

describe('load of a missing row', () => {
  it('returns null — the caller starts with bare trees, as today', async () => {
    const pool = makeFakePool();
    expect(await loadTreeState(pool, ROOM)).toBeNull();
    expect(await loadTreeState(pool, 'somewhere-else')).toBeNull();
  });
});

describe('no pool (local dev without Postgres)', () => {
  it('save is a no-op that never throws; load returns null', async () => {
    await expect(saveTreeState(null, ROOM, createTreeState())).resolves.toBe(false);
    await expect(loadTreeState(null, ROOM)).resolves.toBeNull();
    await expect(saveTreeState(undefined, ROOM, createTreeState())).resolves.toBe(false);
  });
});

describe('bad-row repair (never trust the row blindly)', () => {
  it('repairs a junk row to bare trees', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        active: 7,
        trees: 'nope',
      },
    });
    const loaded = await loadTreeState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeTreeState(loaded)).toEqual(serializeTreeState(createTreeState()));
  });

  it('repairs an active pointer that disagrees with the trees', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        active: 0,
        trees: [
          { counted: 25, extras: 0, contributors: ['user-1'], hungBy: { 'user-1': 1 }, completed: true, completedAt: NOW },
          { counted: 0, extras: 0, contributors: [], hungBy: {}, completed: false, completedAt: 0 },
        ],
      },
    });
    const loaded = await loadTreeState(pool, ROOM);
    // Tree 1 is done but active still said 0 — the first
    // unfinished tree is tree 2.
    expect(loaded.active).toBe(1);
    expect(loaded.trees[0].completed).toBe(true);
  });

  it('forces a completed tree claiming fewer than 25 up to 25', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        active: 1,
        trees: [
          { counted: 3, extras: 0, contributors: ['user-1'], hungBy: { 'user-1': 1 }, completed: true, completedAt: NOW },
          { counted: 0, extras: 0, contributors: [], hungBy: {}, completed: false, completedAt: 0 },
        ],
      },
    });
    const loaded = await loadTreeState(pool, ROOM);
    expect(loaded.trees[0].counted).toBe(TREE_TOTAL);
    expect(loaded.trees[0].completed).toBe(true);
    expect(loaded.active).toBe(1);
  });

  it('repairs an active of -1 with an unfinished tree back to that tree', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        active: -1,
        trees: [
          { counted: 25, extras: 0, contributors: [], hungBy: {}, completed: true, completedAt: NOW },
          { counted: 4, extras: 0, contributors: [], hungBy: {}, completed: false, completedAt: 0 },
        ],
      },
    });
    const loaded = await loadTreeState(pool, ROOM);
    expect(loaded.active).toBe(1);
    expect(loaded.trees[1].counted).toBe(4);
  });

  it('returns null for a row with no usable data', async () => {
    const pool = makeFakePool({ [ROOM]: 'not an object' });
    expect(await loadTreeState(pool, ROOM)).toBeNull();
    const pool2 = makeFakePool({ [ROOM]: null });
    expect(await loadTreeState(pool2, ROOM)).toBeNull();
  });

  it('returns null instead of throwing when the query fails', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(loadTreeState(pool, ROOM)).resolves.toBeNull();
  });
});

describe('restart-restore flow', () => {
  it('save, drop the in-memory entry, load again: same trees', async () => {
    const pool = makeFakePool();
    const before = midTreeState();
    await saveTreeState(pool, ROOM, before);
    // The restart drops the in-memory entry entirely; the load
    // rebuilds it from the row alone.
    const after = await loadTreeState(pool, ROOM);
    expect(serializeTreeState(after)).toEqual(serializeTreeState(before));
  });

  it('a finished tree 1 survives a restart with tree 2 still active', async () => {
    const pool = makeFakePool();
    const before = finishedTree1State(NOW - 10000);
    await saveTreeState(pool, ROOM, before);
    const after = await loadTreeState(pool, ROOM);
    expect(after.active).toBe(1);
    expect(after.trees[0].completed).toBe(true);
    expect(after.trees[1].counted).toBe(0);
  });
});

describe('load-before-mutate simulation', () => {
  it('persisted mid-tree state + fresh cache -> load -> hang -> save -> reload shows the hang', async () => {
    const pool = makeFakePool();
    // Before the "restart": seven counted hangs, saved (five first
    // hangs + two repeat hangs — every hang counts in v1.2).
    await saveTreeState(pool, ROOM, midTreeState());
    // The restart drops the in-memory cache; the first touch after
    // it loads the row (ensureTreeLoaded) BEFORE mutating.
    const cache = await loadTreeState(pool, ROOM);
    expect(cache.trees[0].counted).toBe(7);
    const res = hangOrnament(cache, 'user-6');
    expect(res.ok).toBe(true);
    expect(res.counted).toBe(true);
    await saveTreeState(pool, ROOM, cache);
    // A second restart (or another device) sees eight counted hangs
    // and the new contributor — the pre-restart progress was not
    // overwritten by the bare trees.
    const after = await loadTreeState(pool, ROOM);
    expect(after.trees[0].counted).toBe(8);
    expect(after.trees[0].contributors).toContain('user-6');
  });

  it('a hang after a restart does not resurrect a finished tree 1', async () => {
    const pool = makeFakePool();
    await saveTreeState(pool, ROOM, finishedTree1State(NOW - 10000));
    const cache = await loadTreeState(pool, ROOM);
    expect(cache.active).toBe(1);
    const res = hangOrnament(cache, 'user-1');
    expect(res.ok).toBe(true);
    expect(res.tree).toBe(2);
    await saveTreeState(pool, ROOM, cache);
    const after = await loadTreeState(pool, ROOM);
    expect(after.active).toBe(1);
    expect(after.trees[0].completed).toBe(true);
    expect(after.trees[1].counted).toBe(1);
  });
});

describe('save errors', () => {
  it('saveTreeState propagates a DB error (the socket.js caller catches it)', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(saveTreeState(pool, ROOM, createTreeState())).rejects.toThrow('db down');
  });
});
