// noticeBoardPersist.test.js — Notice Board persistence
// (`sq-notice-board-persist-v1`).
//
// Piece 5 of the room-state persistence fix: the boards are saved
// to Postgres on every pin and removal and loaded back lazily, so
// a server restart restores the pinned flyers instead of wiping
// every board clean.
//
// These tests cover the persistence layer
// (server/noticeBoardPersist.js) against a fake in-memory pool —
// no real Postgres needed. The socket.js wiring
// (ensureNoticeBoardLoaded / persistNoticeBoard in the board
// handlers) is verified by node --check + code read: socket.js
// boots a server on import and cannot run in vitest.

import { describe, it, expect } from 'vitest';
import {
  NOTICE_BOARD_PERSIST_MARKER,
  NOTICE_BOARD_STATE_TABLE,
  NOTICE_BOARD_STATE_TABLE_SQL,
  saveNoticeBoardState,
  loadNoticeBoardState,
} from '../server/noticeBoardPersist.js';
import {
  NOTICE_BOARD_MAX_FLYERS,
  createNoticeBoardState,
  pinFlyer,
  removeFlyer,
  serializeNoticeBoardState,
} from '../src/village/noticeBoardState.js';

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
      if (/SELECT data FROM notice_board_state/i.test(sql)) {
        const data = store.get(params[0]);
        return { rows: data !== undefined ? [{ data }] : [] };
      }
      if (/INSERT INTO notice_board_state/i.test(sql)) {
        store.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

const ROOM = 'agora-houston';
const OTHER_ROOM = 'shepherd-park';

function flyer(n, by = `user-${n}`) {
  return {
    id: `flyer-${n}`,
    title: `Flyer ${n}`,
    text: `Come to my thing number ${n}.`,
    addedBy: by,
    addedByName: `Person ${n}`,
    createdAt: 1000 + n,
  };
}

function midBoardState() {
  const s = createNoticeBoardState();
  for (let i = 1; i <= 5; i++) {
    const res = pinFlyer(s, flyer(i));
    expect(res.ok).toBe(true);
  }
  return s;
}

function fullBoardState() {
  const s = createNoticeBoardState();
  for (let i = 1; i <= NOTICE_BOARD_MAX_FLYERS; i++) {
    const res = pinFlyer(s, flyer(i));
    expect(res.ok).toBe(true);
  }
  return s;
}

describe('constants', () => {
  it('carries the v1 marker and the table name', () => {
    expect(NOTICE_BOARD_PERSIST_MARKER).toBe('sq-notice-board-persist-v1');
    expect(NOTICE_BOARD_STATE_TABLE).toBe('notice_board_state');
  });

  it('creates one row per room with the serialized state as JSONB', () => {
    expect(NOTICE_BOARD_STATE_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS notice_board_state/);
    expect(NOTICE_BOARD_STATE_TABLE_SQL).toMatch(/room_id TEXT PRIMARY KEY/);
    expect(NOTICE_BOARD_STATE_TABLE_SQL).toMatch(/data JSONB NOT NULL/);
  });
});

describe('save/load round-trip', () => {
  it('restores an empty board exactly', async () => {
    const pool = makeFakePool();
    const before = createNoticeBoardState();
    expect(await saveNoticeBoardState(pool, ROOM, before)).toBe(true);
    const loaded = await loadNoticeBoardState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeNoticeBoardState(loaded)).toEqual(serializeNoticeBoardState(before));
    expect(loaded.flyers).toEqual([]);
  });

  it('restores a mid board: flyers in order, all fields kept', async () => {
    const pool = makeFakePool();
    const before = midBoardState();
    expect(before.flyers).toHaveLength(5);
    await saveNoticeBoardState(pool, ROOM, before);
    const loaded = await loadNoticeBoardState(pool, ROOM);
    expect(serializeNoticeBoardState(loaded)).toEqual(serializeNoticeBoardState(before));
    expect(loaded.flyers.map((f) => f.id)).toEqual(['flyer-1', 'flyer-2', 'flyer-3', 'flyer-4', 'flyer-5']);
    expect(loaded.flyers[2]).toEqual(flyer(3));
    expect(loaded.flyers[4].addedByName).toBe('Person 5');
  });

  it('restores a full board of 10, and the 11th pin drops the oldest', async () => {
    const pool = makeFakePool();
    const before = fullBoardState();
    expect(before.flyers).toHaveLength(10);
    const res = pinFlyer(before, flyer(11));
    expect(res.ok).toBe(true);
    expect(res.dropped.id).toBe('flyer-1');
    expect(before.flyers).toHaveLength(10);
    expect(before.flyers[0].id).toBe('flyer-2');
    expect(before.flyers[9].id).toBe('flyer-11');
    await saveNoticeBoardState(pool, ROOM, before);
    const loaded = await loadNoticeBoardState(pool, ROOM);
    expect(serializeNoticeBoardState(loaded)).toEqual(serializeNoticeBoardState(before));
    expect(loaded.flyers.map((f) => f.id)[0]).toBe('flyer-2');
    expect(loaded.flyers.map((f) => f.id)[9]).toBe('flyer-11');
  });

  it('writes an upsert (INSERT ... ON CONFLICT), one row per room', async () => {
    const pool = makeFakePool();
    await saveNoticeBoardState(pool, ROOM, createNoticeBoardState());
    await saveNoticeBoardState(pool, ROOM, midBoardState());
    expect(pool.store.size).toBe(1);
    expect(pool.queries.filter((q) => /INSERT INTO notice_board_state/i.test(q.text))).toHaveLength(2);
    expect(pool.queries[0].text).toMatch(/ON CONFLICT \(room_id\)/);
    const loaded = await loadNoticeBoardState(pool, ROOM);
    expect(loaded.flyers).toHaveLength(5);
  });

  it('keeps different rooms independent', async () => {
    const pool = makeFakePool();
    await saveNoticeBoardState(pool, ROOM, midBoardState());
    await saveNoticeBoardState(pool, OTHER_ROOM, fullBoardState());
    expect(pool.store.size).toBe(2);
    const loaded = await loadNoticeBoardState(pool, ROOM);
    const other = await loadNoticeBoardState(pool, OTHER_ROOM);
    expect(loaded.flyers).toHaveLength(5);
    expect(other.flyers).toHaveLength(10);
    expect(other.flyers[0].id).toBe('flyer-1');
  });
});

describe('load of a missing row', () => {
  it('returns null — the caller starts with an empty board, as today', async () => {
    const pool = makeFakePool();
    expect(await loadNoticeBoardState(pool, ROOM)).toBeNull();
    expect(await loadNoticeBoardState(pool, 'somewhere-else')).toBeNull();
  });
});

describe('no pool (local dev without Postgres)', () => {
  it('save is a no-op that never throws; load returns null', async () => {
    await expect(saveNoticeBoardState(null, ROOM, createNoticeBoardState())).resolves.toBe(false);
    await expect(loadNoticeBoardState(null, ROOM)).resolves.toBeNull();
    await expect(saveNoticeBoardState(undefined, ROOM, createNoticeBoardState())).resolves.toBe(false);
  });
});

describe('bad-row repair (never trust the row blindly)', () => {
  it('repairs a junk row to an empty board', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        flyers: 'nope',
      },
    });
    const loaded = await loadNoticeBoardState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeNoticeBoardState(loaded)).toEqual(serializeNoticeBoardState(createNoticeBoardState()));
  });

  it('drops malformed flyer entries and keeps the good ones', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        flyers: [
          flyer(1),
          { id: 'bad-1', title: '', text: 'No title, no pin.' },
          { id: 'bad-2', title: 'No text here', text: '' },
          'not a flyer at all',
          null,
          flyer(2),
        ],
      },
    });
    const loaded = await loadNoticeBoardState(pool, ROOM);
    expect(loaded.flyers.map((f) => f.id)).toEqual(['flyer-1', 'flyer-2']);
  });

  it('caps a stored row of 11 flyers down to the 10 oldest', async () => {
    const flyers = [];
    for (let i = 1; i <= 11; i++) flyers.push(flyer(i));
    const pool = makeFakePool({ [ROOM]: { flyers } });
    const loaded = await loadNoticeBoardState(pool, ROOM);
    expect(loaded.flyers).toHaveLength(NOTICE_BOARD_MAX_FLYERS);
    expect(loaded.flyers[0].id).toBe('flyer-1');
    expect(loaded.flyers[9].id).toBe('flyer-10');
  });

  it('dedupes flyers sharing an id in the stored row', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        flyers: [flyer(1), flyer(2), { ...flyer(1), title: 'Copy of flyer 1' }, flyer(3)],
      },
    });
    const loaded = await loadNoticeBoardState(pool, ROOM);
    expect(loaded.flyers.map((f) => f.id)).toEqual(['flyer-1', 'flyer-2', 'flyer-3']);
    expect(loaded.flyers[0].title).toBe('Flyer 1');
  });

  it('trims over-long titles and text on load', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        flyers: [
          {
            id: 'long-1',
            title: 'T'.repeat(100),
            text: 'X'.repeat(300),
            addedBy: 'user-1',
            addedByName: 'Person 1',
            createdAt: 1001,
          },
        ],
      },
    });
    const loaded = await loadNoticeBoardState(pool, ROOM);
    expect(loaded.flyers).toHaveLength(1);
    expect(loaded.flyers[0].title).toHaveLength(60);
    expect(loaded.flyers[0].text).toHaveLength(200);
  });

  it('returns null for a row with no usable data', async () => {
    const pool = makeFakePool({ [ROOM]: 'not an object' });
    expect(await loadNoticeBoardState(pool, ROOM)).toBeNull();
    const pool2 = makeFakePool({ [ROOM]: null });
    expect(await loadNoticeBoardState(pool2, ROOM)).toBeNull();
  });

  it('returns null instead of throwing when the query fails', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(loadNoticeBoardState(pool, ROOM)).resolves.toBeNull();
  });
});

describe('restart-restore flow', () => {
  it('save, drop the in-memory entry, load again: same flyers', async () => {
    const pool = makeFakePool();
    const before = midBoardState();
    await saveNoticeBoardState(pool, ROOM, before);
    // The restart drops the in-memory entry entirely; the load
    // rebuilds it from the row alone.
    const after = await loadNoticeBoardState(pool, ROOM);
    expect(serializeNoticeBoardState(after)).toEqual(serializeNoticeBoardState(before));
  });

  it('a full board survives a restart with all 10 flyers', async () => {
    const pool = makeFakePool();
    const before = fullBoardState();
    await saveNoticeBoardState(pool, ROOM, before);
    const after = await loadNoticeBoardState(pool, ROOM);
    expect(after.flyers).toHaveLength(10);
    expect(after.flyers[9].id).toBe('flyer-10');
  });
});

describe('load-before-mutate simulation', () => {
  it('persisted board + fresh cache -> load -> pin -> save -> reload shows the pin', async () => {
    const pool = makeFakePool();
    // Before the "restart": three flyers pinned, saved.
    const before = createNoticeBoardState();
    for (let i = 1; i <= 3; i++) pinFlyer(before, flyer(i));
    await saveNoticeBoardState(pool, ROOM, before);
    // The restart drops the in-memory cache; the first touch after
    // it loads the row (ensureNoticeBoardLoaded) BEFORE mutating.
    const cache = await loadNoticeBoardState(pool, ROOM);
    expect(cache.flyers).toHaveLength(3);
    const res = pinFlyer(cache, flyer(4));
    expect(res.ok).toBe(true);
    await saveNoticeBoardState(pool, ROOM, cache);
    // A second restart (or another device) sees four flyers — the
    // pre-restart pins were not overwritten by the empty board.
    const after = await loadNoticeBoardState(pool, ROOM);
    expect(after.flyers.map((f) => f.id)).toEqual(['flyer-1', 'flyer-2', 'flyer-3', 'flyer-4']);
  });

  it('a removal after a restart does not resurrect the removed flyer', async () => {
    const pool = makeFakePool();
    await saveNoticeBoardState(pool, ROOM, midBoardState());
    const cache = await loadNoticeBoardState(pool, ROOM);
    expect(cache.flyers).toHaveLength(5);
    const removed = removeFlyer(cache, 'flyer-2', 'user-2', false);
    expect(removed.ok).toBe(true);
    await saveNoticeBoardState(pool, ROOM, cache);
    // Pin another flyer after the removal, then reload: flyer-2
    // stays gone, the new one is there.
    const res = pinFlyer(cache, flyer(6));
    expect(res.ok).toBe(true);
    await saveNoticeBoardState(pool, ROOM, cache);
    const after = await loadNoticeBoardState(pool, ROOM);
    expect(after.flyers.map((f) => f.id)).toEqual(['flyer-1', 'flyer-3', 'flyer-4', 'flyer-5', 'flyer-6']);
  });
});

describe('save errors', () => {
  it('saveNoticeBoardState propagates a DB error (the socket.js caller catches it)', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(saveNoticeBoardState(pool, ROOM, createNoticeBoardState())).rejects.toThrow('db down');
  });
});
