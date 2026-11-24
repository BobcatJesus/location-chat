// decorPersist.test.js — Placed Decorations persistence
// (`sq-decor-persist-v1`).
//
// Piece 6 of the room-state persistence fix: placed decorations
// are saved to Postgres on every place and removal and loaded
// back lazily, so a server restart restores the decorations
// instead of wiping every room clean.
//
// These tests cover the persistence layer
// (server/decorPersist.js) against a fake in-memory pool —
// no real Postgres needed. The socket.js wiring
// (ensureDecorLoaded / persistDecor in the decor handlers) is
// verified by node --check + code read: socket.js boots a server
// on import and cannot run in vitest.

import { describe, it, expect } from 'vitest';
import {
  DECOR_PERSIST_MARKER,
  DECOR_ROOM_STATE_TABLE,
  DECOR_ROOM_STATE_TABLE_SQL,
  saveDecorState,
  loadDecorState,
} from '../server/decorPersist.js';
import {
  DECOR_MAX_PER_ROOM,
  createDecorState,
  placeDecoration,
  removeDecoration,
  serializeDecorState,
} from '../src/village/decorState.js';

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
      if (/SELECT data FROM decor_room_state/i.test(sql)) {
        const data = store.get(params[0]);
        return { rows: data !== undefined ? [{ data }] : [] };
      }
      if (/INSERT INTO decor_room_state/i.test(sql)) {
        store.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

const ROOM = 'agora-houston';
const OTHER_ROOM = 'shepherd-park';

const KINDS = ['ornament', 'lights', 'snowman', 'tree', 'santa'];

function decor(n, by = `user-${n}`) {
  return {
    id: `decor-${n}`,
    kind: KINDS[(n - 1) % KINDS.length],
    x: 100 + n * 10,
    y: 200 + n * 5,
    addedBy: by,
    addedByName: `Person ${n}`,
    createdAt: 1000 + n,
  };
}

function midRoomState() {
  const s = createDecorState();
  for (let i = 1; i <= 5; i++) {
    const res = placeDecoration(s, decor(i));
    expect(res.ok).toBe(true);
  }
  return s;
}

function fullRoomState() {
  const s = createDecorState();
  for (let i = 1; i <= DECOR_MAX_PER_ROOM; i++) {
    const res = placeDecoration(s, decor(i));
    expect(res.ok).toBe(true);
  }
  return s;
}

describe('constants', () => {
  it('carries the v1 marker and the table name', () => {
    expect(DECOR_PERSIST_MARKER).toBe('sq-decor-persist-v1');
    expect(DECOR_ROOM_STATE_TABLE).toBe('decor_room_state');
  });

  it('creates one row per room with the serialized state as JSONB', () => {
    expect(DECOR_ROOM_STATE_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS decor_room_state/);
    expect(DECOR_ROOM_STATE_TABLE_SQL).toMatch(/room_id TEXT PRIMARY KEY/);
    expect(DECOR_ROOM_STATE_TABLE_SQL).toMatch(/data JSONB NOT NULL/);
  });
});

describe('save/load round-trip', () => {
  it('restores an empty room exactly', async () => {
    const pool = makeFakePool();
    const before = createDecorState();
    expect(await saveDecorState(pool, ROOM, before)).toBe(true);
    const loaded = await loadDecorState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeDecorState(loaded)).toEqual(serializeDecorState(before));
    expect(loaded.decorations).toEqual([]);
  });

  it('restores a mid room: decorations in order, all fields kept', async () => {
    const pool = makeFakePool();
    const before = midRoomState();
    expect(before.decorations).toHaveLength(5);
    await saveDecorState(pool, ROOM, before);
    const loaded = await loadDecorState(pool, ROOM);
    expect(serializeDecorState(loaded)).toEqual(serializeDecorState(before));
    expect(loaded.decorations.map((d) => d.id)).toEqual(['decor-1', 'decor-2', 'decor-3', 'decor-4', 'decor-5']);
    expect(loaded.decorations[2]).toEqual(decor(3));
    expect(loaded.decorations[4].addedByName).toBe('Person 5');
  });

  it('restores a full room of 30, and the 31st place is refused', async () => {
    const pool = makeFakePool();
    const before = fullRoomState();
    expect(before.decorations).toHaveLength(30);
    // Unlike a board, a full room REFUSES — the bought item stays
    // in the pocket, nothing is dropped.
    const res = placeDecoration(before, decor(31));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('room-full');
    expect(before.decorations).toHaveLength(30);
    expect(before.decorations[0].id).toBe('decor-1');
    expect(before.decorations[29].id).toBe('decor-30');
    await saveDecorState(pool, ROOM, before);
    const loaded = await loadDecorState(pool, ROOM);
    expect(serializeDecorState(loaded)).toEqual(serializeDecorState(before));
    expect(loaded.decorations.map((d) => d.id)[0]).toBe('decor-1');
    expect(loaded.decorations.map((d) => d.id)[29]).toBe('decor-30');
  });

  it('writes an upsert (INSERT ... ON CONFLICT), one row per room', async () => {
    const pool = makeFakePool();
    await saveDecorState(pool, ROOM, createDecorState());
    await saveDecorState(pool, ROOM, midRoomState());
    expect(pool.store.size).toBe(1);
    expect(pool.queries.filter((q) => /INSERT INTO decor_room_state/i.test(q.text))).toHaveLength(2);
    expect(pool.queries[0].text).toMatch(/ON CONFLICT \(room_id\)/);
    const loaded = await loadDecorState(pool, ROOM);
    expect(loaded.decorations).toHaveLength(5);
  });

  it('keeps different rooms independent', async () => {
    const pool = makeFakePool();
    await saveDecorState(pool, ROOM, midRoomState());
    await saveDecorState(pool, OTHER_ROOM, fullRoomState());
    expect(pool.store.size).toBe(2);
    const loaded = await loadDecorState(pool, ROOM);
    const other = await loadDecorState(pool, OTHER_ROOM);
    expect(loaded.decorations).toHaveLength(5);
    expect(other.decorations).toHaveLength(30);
    expect(other.decorations[0].id).toBe('decor-1');
  });
});

describe('load of a missing row', () => {
  it('returns null — the caller starts with an empty room, as today', async () => {
    const pool = makeFakePool();
    expect(await loadDecorState(pool, ROOM)).toBeNull();
    expect(await loadDecorState(pool, 'somewhere-else')).toBeNull();
  });
});

describe('no pool (local dev without Postgres)', () => {
  it('save is a no-op that never throws; load returns null', async () => {
    await expect(saveDecorState(null, ROOM, createDecorState())).resolves.toBe(false);
    await expect(loadDecorState(null, ROOM)).resolves.toBeNull();
    await expect(saveDecorState(undefined, ROOM, createDecorState())).resolves.toBe(false);
  });
});

describe('bad-row repair (never trust the row blindly)', () => {
  it('repairs a junk row to an empty room', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        decorations: 'nope',
      },
    });
    const loaded = await loadDecorState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeDecorState(loaded)).toEqual(serializeDecorState(createDecorState()));
  });

  it('drops malformed decoration entries and keeps the good ones', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        decorations: [
          decor(1),
          { id: 'bad-1', kind: 'krampus', x: 100, y: 200, addedBy: 'user-1' },
          { id: 'bad-2', kind: 'ornament', addedBy: 'user-1' },
          { id: 'bad-3', kind: 'lights', x: 'far', y: 200, addedBy: 'user-1' },
          'not a decoration at all',
          null,
          decor(2),
        ],
      },
    });
    const loaded = await loadDecorState(pool, ROOM);
    expect(loaded.decorations.map((d) => d.id)).toEqual(['decor-1', 'decor-2']);
  });

  it('caps a stored row of 35 decorations down to the 30 oldest', async () => {
    const decorations = [];
    for (let i = 1; i <= 35; i++) decorations.push(decor(i));
    const pool = makeFakePool({ [ROOM]: { decorations } });
    const loaded = await loadDecorState(pool, ROOM);
    expect(loaded.decorations).toHaveLength(DECOR_MAX_PER_ROOM);
    expect(loaded.decorations[0].id).toBe('decor-1');
    expect(loaded.decorations[29].id).toBe('decor-30');
  });

  it('dedupes decorations sharing an id in the stored row', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        decorations: [decor(1), decor(2), { ...decor(1), x: 999 }, decor(3)],
      },
    });
    const loaded = await loadDecorState(pool, ROOM);
    expect(loaded.decorations.map((d) => d.id)).toEqual(['decor-1', 'decor-2', 'decor-3']);
    expect(loaded.decorations[0].x).toBe(110);
  });

  it('clamps out-of-bounds coordinates on load', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        decorations: [
          { ...decor(1), x: 99999, y: -50 },
        ],
      },
    });
    const loaded = await loadDecorState(pool, ROOM);
    expect(loaded.decorations).toHaveLength(1);
    expect(loaded.decorations[0].x).toBe(4000);
    expect(loaded.decorations[0].y).toBe(0);
  });

  it('returns null for a row with no usable data', async () => {
    const pool = makeFakePool({ [ROOM]: 'not an object' });
    expect(await loadDecorState(pool, ROOM)).toBeNull();
    const pool2 = makeFakePool({ [ROOM]: null });
    expect(await loadDecorState(pool2, ROOM)).toBeNull();
  });

  it('returns null instead of throwing when the query fails', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(loadDecorState(pool, ROOM)).resolves.toBeNull();
  });
});

describe('restart-restore flow', () => {
  it('save, drop the in-memory entry, load again: same decorations', async () => {
    const pool = makeFakePool();
    const before = midRoomState();
    await saveDecorState(pool, ROOM, before);
    // The restart drops the in-memory entry entirely; the load
    // rebuilds it from the row alone.
    const after = await loadDecorState(pool, ROOM);
    expect(serializeDecorState(after)).toEqual(serializeDecorState(before));
  });

  it('a full room survives a restart with all 30 decorations', async () => {
    const pool = makeFakePool();
    const before = fullRoomState();
    await saveDecorState(pool, ROOM, before);
    const after = await loadDecorState(pool, ROOM);
    expect(after.decorations).toHaveLength(30);
    expect(after.decorations[29].id).toBe('decor-30');
  });
});

describe('load-before-mutate simulation', () => {
  it('persisted room + fresh cache -> load -> place -> save -> reload shows the place', async () => {
    const pool = makeFakePool();
    // Before the "restart": three decorations placed, saved.
    const before = createDecorState();
    for (let i = 1; i <= 3; i++) placeDecoration(before, decor(i));
    await saveDecorState(pool, ROOM, before);
    // The restart drops the in-memory cache; the first touch after
    // it loads the row (ensureDecorLoaded) BEFORE mutating.
    const cache = await loadDecorState(pool, ROOM);
    expect(cache.decorations).toHaveLength(3);
    const res = placeDecoration(cache, decor(4));
    expect(res.ok).toBe(true);
    await saveDecorState(pool, ROOM, cache);
    // A second restart (or another device) sees four decorations —
    // the pre-restart places were not overwritten by the empty room.
    const after = await loadDecorState(pool, ROOM);
    expect(after.decorations.map((d) => d.id)).toEqual(['decor-1', 'decor-2', 'decor-3', 'decor-4']);
  });

  it('a removal after a restart does not resurrect the removed decoration', async () => {
    const pool = makeFakePool();
    await saveDecorState(pool, ROOM, midRoomState());
    const cache = await loadDecorState(pool, ROOM);
    expect(cache.decorations).toHaveLength(5);
    const removed = removeDecoration(cache, 'decor-2', 'user-2', false);
    expect(removed.ok).toBe(true);
    await saveDecorState(pool, ROOM, cache);
    // Place another decoration after the removal, then reload:
    // decor-2 stays gone, the new one is there.
    const res = placeDecoration(cache, decor(6));
    expect(res.ok).toBe(true);
    await saveDecorState(pool, ROOM, cache);
    const after = await loadDecorState(pool, ROOM);
    expect(after.decorations.map((d) => d.id)).toEqual(['decor-1', 'decor-3', 'decor-4', 'decor-5', 'decor-6']);
  });
});

describe('save errors', () => {
  it('saveDecorState propagates a DB error (the socket.js caller catches it)', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(saveDecorState(pool, ROOM, createDecorState())).rejects.toThrow('db down');
  });
});
