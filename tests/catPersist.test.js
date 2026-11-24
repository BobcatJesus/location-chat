// catPersist.test.js — Cat State persistence
// (`sq-cat-persist-v1`).
//
// Piece 7 of the room-state persistence fix: the cafe cat's sleep
// state (pets/asleep) and hunger state (windowId/hungry/fedBy)
// are saved to Postgres on every pet, feed, wake, and hunger-tick
// change and loaded back lazily, so a server restart restores the
// cat instead of waking her, resetting the pet count, and
// forgetting who fed her this window (which would make the window
// completable again and the +3 payable twice).
//
// These tests cover the persistence layer
// (server/catPersist.js) against a fake in-memory pool —
// no real Postgres needed. The socket.js wiring
// (ensureCatLoaded / persistCat in the pet_cat, get_cat,
// get_cat_hunger handlers and the join wake path) is verified by
// node --check + code read: socket.js boots a server on import
// and cannot run in vitest. The window-boundary tests run the
// REAL refreshCatHunger, not a reimplementation.

import { describe, it, expect } from 'vitest';
import {
  CAT_PERSIST_MARKER,
  CAT_ROOM_STATE_TABLE,
  CAT_ROOM_STATE_TABLE_SQL,
  createCatRoomState,
  serializeCatRoomState,
  parseCatRoomState,
  saveCatState,
  loadCatState,
} from '../server/catPersist.js';
import {
  createCatHungerState,
  refreshCatHunger,
  feedCatHunger,
} from '../src/village/catHunger.js';

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
      if (/SELECT data FROM cat_room_state/i.test(sql)) {
        const data = store.get(params[0]);
        return { rows: data !== undefined ? [{ data }] : [] };
      }
      if (/INSERT INTO cat_room_state/i.test(sql)) {
        store.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

const ROOM = 'agora-houston';
const OTHER_ROOM = 'shepherd-park';

// 2026-11-23 is CST (UTC-6): 08:00 Chicago = 14:00 UTC,
// 18:30 Chicago = 00:30 UTC the next day.
const utc = (y, mo, d, h, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi));
const NOV_23_0800 = utc(2026, 11, 23, 14, 0); // 08:00 Chicago
const NOV_23_0930 = utc(2026, 11, 23, 15, 30); // 09:30 Chicago
const NOV_23_1830 = utc(2026, 11, 24, 0, 30); // 18:30 Chicago

const MORNING = '2026-11-23-morning';

function midCatState() {
  return {
    pets: 2,
    asleep: false,
    hunger: { windowId: MORNING, hungry: true, fedBy: null },
  };
}

function fedAsleepCatState() {
  return {
    pets: 3,
    asleep: true,
    hunger: { windowId: MORNING, hungry: false, fedBy: 'alice@test' },
  };
}

describe('constants', () => {
  it('carries the v1 marker and the table name', () => {
    expect(CAT_PERSIST_MARKER).toBe('sq-cat-persist-v1');
    expect(CAT_ROOM_STATE_TABLE).toBe('cat_room_state');
  });

  it('creates one row per room with the serialized state as JSONB', () => {
    expect(CAT_ROOM_STATE_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS cat_room_state/);
    expect(CAT_ROOM_STATE_TABLE_SQL).toMatch(/room_id TEXT PRIMARY KEY/);
    expect(CAT_ROOM_STATE_TABLE_SQL).toMatch(/data JSONB NOT NULL/);
  });
});

describe('save/load round-trip', () => {
  it('restores a fresh cat exactly', async () => {
    const pool = makeFakePool();
    const before = createCatRoomState();
    expect(await saveCatState(pool, ROOM, before)).toBe(true);
    const loaded = await loadCatState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeCatRoomState(loaded)).toEqual(serializeCatRoomState(before));
    expect(loaded).toEqual({ pets: 0, asleep: false, hunger: { windowId: null, hungry: false, fedBy: null } });
  });

  it('restores a mid state: 2 pets awake + hungry unfed', async () => {
    const pool = makeFakePool();
    const before = midCatState();
    await saveCatState(pool, ROOM, before);
    const loaded = await loadCatState(pool, ROOM);
    expect(serializeCatRoomState(loaded)).toEqual(serializeCatRoomState(before));
    expect(loaded.pets).toBe(2);
    expect(loaded.asleep).toBe(false);
    expect(loaded.hunger).toEqual({ windowId: MORNING, hungry: true, fedBy: null });
  });

  it('restores an asleep cat with 3 pets + fed with fedBy kept', async () => {
    const pool = makeFakePool();
    const before = fedAsleepCatState();
    await saveCatState(pool, ROOM, before);
    const loaded = await loadCatState(pool, ROOM);
    expect(serializeCatRoomState(loaded)).toEqual(serializeCatRoomState(before));
    expect(loaded.pets).toBe(3);
    expect(loaded.asleep).toBe(true);
    // fedBy is the whole point: the wire shape drops it, the
    // stored shape must not — or the +3 pays twice after restart.
    expect(loaded.hunger).toEqual({ windowId: MORNING, hungry: false, fedBy: 'alice@test' });
  });

  it('writes an upsert (INSERT ... ON CONFLICT), one row per room', async () => {
    const pool = makeFakePool();
    await saveCatState(pool, ROOM, createCatRoomState());
    await saveCatState(pool, ROOM, midCatState());
    expect(pool.store.size).toBe(1);
    expect(pool.queries.filter((q) => /INSERT INTO cat_room_state/i.test(q.text))).toHaveLength(2);
    expect(pool.queries[0].text).toMatch(/ON CONFLICT \(room_id\)/);
    const loaded = await loadCatState(pool, ROOM);
    expect(loaded.pets).toBe(2);
    expect(loaded.hunger.hungry).toBe(true);
  });

  it('keeps different rooms independent', async () => {
    const pool = makeFakePool();
    await saveCatState(pool, ROOM, midCatState());
    await saveCatState(pool, OTHER_ROOM, fedAsleepCatState());
    expect(pool.store.size).toBe(2);
    const loaded = await loadCatState(pool, ROOM);
    const other = await loadCatState(pool, OTHER_ROOM);
    expect(loaded.pets).toBe(2);
    expect(loaded.asleep).toBe(false);
    expect(other.pets).toBe(3);
    expect(other.asleep).toBe(true);
    expect(other.hunger.fedBy).toBe('alice@test');
  });
});

describe('load of a missing row', () => {
  it('returns null — the caller starts with a fresh cat, as today', async () => {
    const pool = makeFakePool();
    expect(await loadCatState(pool, ROOM)).toBeNull();
    expect(await loadCatState(pool, 'somewhere-else')).toBeNull();
  });
});

describe('no pool (local dev without Postgres)', () => {
  it('save is a no-op that never throws; load returns null', async () => {
    await expect(saveCatState(null, ROOM, createCatRoomState())).resolves.toBe(false);
    await expect(loadCatState(null, ROOM)).resolves.toBeNull();
    await expect(saveCatState(undefined, ROOM, createCatRoomState())).resolves.toBe(false);
  });
});

describe('bad-row repair (never trust the row blindly)', () => {
  it('repairs a junk row to a fresh cat', async () => {
    const pool = makeFakePool({
      [ROOM]: { pets: 'nope', asleep: 'yes', hunger: 'nope' },
    });
    const loaded = await loadCatState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeCatRoomState(loaded)).toEqual(serializeCatRoomState(createCatRoomState()));
    // A row with no usable data at all is null, not a fresh cat.
    const pool2 = makeFakePool({ [ROOM]: 'not an object' });
    expect(await loadCatState(pool2, ROOM)).toBeNull();
    const pool3 = makeFakePool({ [ROOM]: null });
    expect(await loadCatState(pool3, ROOM)).toBeNull();
  });

  it('repairs a row missing hunger: fresh hunger, pets/asleep kept', async () => {
    const pool = makeFakePool({ [ROOM]: { pets: 2, asleep: false } });
    const loaded = await loadCatState(pool, ROOM);
    expect(loaded.pets).toBe(2);
    expect(loaded.asleep).toBe(false);
    expect(loaded.hunger).toEqual(createCatHungerState());
  });

  it('clamps pets to 0..3 (3 pets puts her to sleep)', async () => {
    const pool = makeFakePool({
      [ROOM]: { pets: 5, asleep: false, hunger: { windowId: null, hungry: false, fedBy: null } },
    });
    expect((await loadCatState(pool, ROOM)).pets).toBe(3);
    const pool2 = makeFakePool({
      [ROOM]: { pets: -2, asleep: false, hunger: { windowId: null, hungry: false, fedBy: null } },
    });
    expect((await loadCatState(pool2, ROOM)).pets).toBe(0);
    const pool3 = makeFakePool({
      [ROOM]: { pets: 2.7, asleep: false, hunger: { windowId: null, hungry: false, fedBy: null } },
    });
    expect((await loadCatState(pool3, ROOM)).pets).toBe(2);
  });

  it('treats a non-boolean asleep as awake', async () => {
    const pool = makeFakePool({
      [ROOM]: { pets: 0, asleep: 'yes', hunger: { windowId: null, hungry: false, fedBy: null } },
    });
    expect((await loadCatState(pool, ROOM)).asleep).toBe(false);
    const pool2 = makeFakePool({
      [ROOM]: { pets: 0, asleep: 1, hunger: { windowId: null, hungry: false, fedBy: null } },
    });
    expect((await loadCatState(pool2, ROOM)).asleep).toBe(false);
  });

  it('drops a wrong-typed fedBy and windowId', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        pets: 1,
        asleep: false,
        hunger: { windowId: 123, hungry: true, fedBy: 42 },
      },
    });
    const loaded = await loadCatState(pool, ROOM);
    expect(loaded.hunger).toEqual({ windowId: null, hungry: true, fedBy: null });
  });

  it('returns null instead of throwing when the query fails', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(loadCatState(pool, ROOM)).resolves.toBeNull();
  });
});

describe('restart-restore flow', () => {
  it('save, drop the in-memory entry, load again: same sleep + hunger', async () => {
    const pool = makeFakePool();
    const before = fedAsleepCatState();
    await saveCatState(pool, ROOM, before);
    // The restart drops the in-memory entry entirely; the load
    // rebuilds it from the row alone.
    const after = await loadCatState(pool, ROOM);
    expect(serializeCatRoomState(after)).toEqual(serializeCatRoomState(before));
  });

  it('a fed window survives a restart with fedBy intact', async () => {
    const pool = makeFakePool();
    const before = {
      pets: 1,
      asleep: false,
      hunger: { windowId: MORNING, hungry: false, fedBy: 'alice@test' },
    };
    await saveCatState(pool, ROOM, before);
    const after = await loadCatState(pool, ROOM);
    expect(after.hunger.fedBy).toBe('alice@test');
    expect(after.hunger.hungry).toBe(false);
  });
});

describe('load-before-mutate simulation', () => {
  it('a pet after a restart does not wipe fedBy', async () => {
    const pool = makeFakePool();
    // Before the "restart": 2 pets, fed this window, saved.
    const before = {
      pets: 2,
      asleep: false,
      hunger: { windowId: MORNING, hungry: false, fedBy: 'alice@test' },
    };
    await saveCatState(pool, ROOM, before);
    // The restart drops the in-memory cache; the first touch after
    // it loads the row (ensureCatLoaded) BEFORE mutating.
    const cache = await loadCatState(pool, ROOM);
    expect(cache.hunger.fedBy).toBe('alice@test');
    // The third pet puts her to sleep — the same mutation the
    // pet_cat handler makes — then saves.
    cache.pets += 1;
    if (cache.pets >= 3) cache.asleep = true;
    await saveCatState(pool, ROOM, cache);
    // A second restart (or another device) sees 3 pets, asleep,
    // and the fed window still recorded — the pet did not
    // overwrite the hunger with a fresh default.
    const after = await loadCatState(pool, ROOM);
    expect(after.pets).toBe(3);
    expect(after.asleep).toBe(true);
    expect(after.hunger).toEqual({ windowId: MORNING, hungry: false, fedBy: 'alice@test' });
  });

  it('a feed after a restart is refused — no double +3', async () => {
    const pool = makeFakePool();
    await saveCatState(pool, ROOM, fedAsleepCatState());
    const cache = await loadCatState(pool, ROOM);
    expect(cache.hunger.fedBy).toBe('alice@test');
    // A second feeder's treat runs the REAL feed gate on the
    // loaded state: she is already fed (not hungry), so the quest
    // refuses — the +3 cannot pay twice after a restart.
    const res = feedCatHunger(cache.hunger, { now: NOV_23_0930, userId: 'bob@test' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-hungry');
    expect(res.state.fedBy).toBe('alice@test');
    // And the already-fed branch itself, reached from a stored
    // row that still says hungry with a feeder recorded (a row
    // the repair keeps as-is; the tick would clear it next):
    // the second feed is refused there too.
    const fedButHungry = { windowId: MORNING, hungry: true, fedBy: 'alice@test' };
    const res2 = feedCatHunger(fedButHungry, { now: NOV_23_0930, userId: 'bob@test' });
    expect(res2.ok).toBe(false);
    expect(res2.reason).toBe('already-fed');
    expect(res2.state.fedBy).toBe('alice@test');
  });
});

describe('window-boundary repair (real refreshCatHunger)', () => {
  it('a fed morning window re-ticked in the evening re-arms: fedBy reset, hungry again', async () => {
    const pool = makeFakePool();
    await saveCatState(pool, ROOM, {
      pets: 0,
      asleep: false,
      hunger: { windowId: MORNING, hungry: false, fedBy: 'alice@test' },
    });
    const loaded = await loadCatState(pool, ROOM);
    // This is what ensureCatLoaded does after a load: the tick
    // with now + asleep, through the real state machine.
    const { state, changed } = refreshCatHunger(loaded.hunger, { now: NOV_23_1830, asleep: false });
    expect(state).toEqual({ windowId: '2026-11-23-evening', hungry: true, fedBy: null });
    expect(changed).toBe(true);
  });

  it('a fed morning window re-ticked the same morning stays fed', async () => {
    const pool = makeFakePool();
    await saveCatState(pool, ROOM, {
      pets: 0,
      asleep: false,
      hunger: { windowId: MORNING, hungry: false, fedBy: 'alice@test' },
    });
    const loaded = await loadCatState(pool, ROOM);
    const { state, changed } = refreshCatHunger(loaded.hunger, { now: NOV_23_0930, asleep: false });
    expect(state).toEqual({ windowId: MORNING, hungry: false, fedBy: 'alice@test' });
    expect(changed).toBe(false);
  });

  it('an unfed hungry morning carries into the evening with fedBy reset', async () => {
    const pool = makeFakePool();
    await saveCatState(pool, ROOM, midCatState());
    const loaded = await loadCatState(pool, ROOM);
    const { state, changed } = refreshCatHunger(loaded.hunger, { now: NOV_23_1830, asleep: false });
    expect(state).toEqual({ windowId: '2026-11-23-evening', hungry: true, fedBy: null });
    expect(changed).toBe(false);
  });
});

describe('save errors', () => {
  it('saveCatState propagates a DB error (the socket.js caller catches it)', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(saveCatState(pool, ROOM, createCatRoomState())).rejects.toThrow('db down');
  });
});
