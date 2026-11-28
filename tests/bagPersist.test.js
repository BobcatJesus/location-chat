// bagPersist.test.js — Bag Persistence v1 (`sq-bag-persist-v1`).
//
// The bought bag (20 coins, pocket 3 -> bag 10) used to live only
// in the browser's localStorage, so a server restart, a cleared
// browser, or a profile change could downgrade it back to a
// pocket. The flag is now saved to Postgres per player, so a
// restart restores the bag and it follows the account across
// devices and browsers.
//
// These tests cover the persistence layer (server/bagPersist.js)
// against a fake in-memory pool — no real Postgres needed — plus
// the client-side apply (setHasBagFromServer in
// src/village/items.js). The socket.js wiring (syncBagForPlayer in
// join_room, the get_bag handler, the playerState one-liner) is
// pinned by source-content assertions at the bottom and verified
// by node --check + code read: socket.js boots a server on import
// and cannot run in vitest (same limitation as the other
// persistence kits).

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BAG_PERSIST_MARKER,
  PLAYER_BAGS_TABLE,
  PLAYER_BAGS_TABLE_SQL,
  mergeBagState,
  loadBag,
  saveBag,
} from '../server/bagPersist.js';
import {
  _setInventoryForTest,
  getInventory,
  hasBag,
  capacity,
  BAG_CAPACITY,
  POCKET_CAPACITY,
  setHasBagFromServer,
} from '../src/village/items.js';

// Tiny in-memory stand-in for a pg Pool: one Map keyed by
// player_id, answering only the two queries the persistence layer
// issues.
function makeFakePool(initial = {}) {
  const store = new Map(Object.entries(initial));
  const queries = [];
  return {
    store,
    queries,
    async query(text, params = []) {
      queries.push({ text, params });
      const sql = String(text);
      if (/SELECT has_bag FROM player_bags/i.test(sql)) {
        const value = store.get(params[0]);
        return { rows: value !== undefined ? [{ has_bag: value }] : [] };
      }
      if (/INSERT INTO player_bags/i.test(sql)) {
        store.set(params[0], params[1]);
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

function makeLocalStorageStub() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

beforeEach(() => {
  globalThis.localStorage = makeLocalStorageStub();
  _setInventoryForTest({ items: [], hasBag: false });
});

describe('bagPersist marker + table', () => {
  it('carries the v1 marker and the player_bags table', () => {
    expect(BAG_PERSIST_MARKER).toBe('sq-bag-persist-v1');
    expect(PLAYER_BAGS_TABLE).toBe('player_bags');
    expect(PLAYER_BAGS_TABLE_SQL).toContain('CREATE TABLE IF NOT EXISTS player_bags');
    expect(PLAYER_BAGS_TABLE_SQL).toContain('player_id TEXT PRIMARY KEY');
    expect(PLAYER_BAGS_TABLE_SQL).toContain('has_bag BOOLEAN NOT NULL');
  });
});

describe('mergeBagState — the once-a-bag-always-a-bag OR rule', () => {
  it('stored true + claimed false stays true (a stale client never un-buys a bag)', () => {
    expect(mergeBagState(true, false)).toBe(true);
  });

  it('stored false + claimed true is true (first join records the bag)', () => {
    expect(mergeBagState(false, true)).toBe(true);
  });

  it('stored true + claimed true is true', () => {
    expect(mergeBagState(true, true)).toBe(true);
  });

  it('stored false + claimed false is false (no bag anywhere)', () => {
    expect(mergeBagState(false, false)).toBe(false);
  });

  it('treats non-boolean inputs as booleans', () => {
    expect(mergeBagState(1, 0)).toBe(true);
    expect(mergeBagState(undefined, undefined)).toBe(false);
    expect(mergeBagState(null, 'yes')).toBe(true);
  });
});

describe('loadBag / saveBag against a fake pool', () => {
  it('round-trips a bag: save true, load true', async () => {
    const pool = makeFakePool();
    expect(await saveBag(pool, 'alice@example.com', true)).toBe(true);
    expect(await loadBag(pool, 'alice@example.com')).toBe(true);
  });

  it('a missing row loads as false (no bag on record)', async () => {
    const pool = makeFakePool();
    expect(await loadBag(pool, 'nobody@example.com')).toBe(false);
  });

  it('an upsert overwrites a stored value', async () => {
    const pool = makeFakePool({ 'alice@example.com': true });
    expect(await loadBag(pool, 'alice@example.com')).toBe(true);
    await saveBag(pool, 'alice@example.com', false);
    expect(await loadBag(pool, 'alice@example.com')).toBe(false);
  });

  it('no pool is a no-op: load false, save false, nothing thrown', async () => {
    expect(await loadBag(null, 'alice@example.com')).toBe(false);
    expect(await saveBag(null, 'alice@example.com', true)).toBe(false);
    expect(await loadBag(undefined, 'alice@example.com')).toBe(false);
  });

  it('an empty player id is a no-op', async () => {
    const pool = makeFakePool();
    expect(await loadBag(pool, '')).toBe(false);
    expect(await saveBag(pool, '', true)).toBe(false);
    expect(pool.queries).toEqual([]);
  });

  it('a DB error on load returns false instead of throwing', async () => {
    const pool = { async query() { throw new Error('boom'); } };
    expect(await loadBag(pool, 'alice@example.com')).toBe(false);
  });

  it('a DB error on save throws (the caller catches and warns)', async () => {
    const pool = { async query() { throw new Error('boom'); } };
    await expect(saveBag(pool, 'alice@example.com', true)).rejects.toThrow('boom');
  });

  it('bags are keyed per player, not shared', async () => {
    const pool = makeFakePool();
    await saveBag(pool, 'alice@example.com', true);
    expect(await loadBag(pool, 'alice@example.com')).toBe(true);
    expect(await loadBag(pool, 'bob@example.com')).toBe(false);
  });
});

describe('setHasBagFromServer — the client applies the server record', () => {
  it('server says bag + local pocket -> local bag, capacity 10', () => {
    expect(hasBag()).toBe(false);
    expect(capacity()).toBe(POCKET_CAPACITY);
    expect(setHasBagFromServer(true)).toBe(true);
    expect(hasBag()).toBe(true);
    expect(getInventory().hasBag).toBe(true);
    expect(capacity()).toBe(BAG_CAPACITY);
  });

  it('server says bag + local bag already -> stays a bag', () => {
    _setInventoryForTest({ items: [], hasBag: true });
    expect(setHasBagFromServer(true)).toBe(true);
    expect(hasBag()).toBe(true);
  });

  it('server says no record + local bag -> the local bag is KEPT, never wiped', () => {
    _setInventoryForTest({ items: [], hasBag: true });
    expect(setHasBagFromServer(false)).toBe(true);
    expect(hasBag()).toBe(true);
    expect(capacity()).toBe(BAG_CAPACITY);
  });

  it('server says no record + local pocket -> stays a pocket', () => {
    expect(setHasBagFromServer(false)).toBe(false);
    expect(hasBag()).toBe(false);
    expect(capacity()).toBe(POCKET_CAPACITY);
  });

  it('a missing server value (undefined) keeps the local value', () => {
    _setInventoryForTest({ items: [], hasBag: true });
    expect(setHasBagFromServer(undefined)).toBe(true);
    expect(hasBag()).toBe(true);
  });
});

describe('socket.js + VillageScene.js wiring (source pins)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const socketSrc = readFileSync(join(here, '..', 'server', 'socket.js'), 'utf8');
  const sceneSrc = readFileSync(join(here, '..', 'src', 'village', 'VillageScene.js'), 'utf8');

  it('initDb creates the player_bags table and logs it ready', () => {
    expect(socketSrc).toContain('PLAYER_BAGS_TABLE_SQL');
    expect(socketSrc).toContain('✅ Postgres player_bags table ready');
  });

  it('the playerState whitelist includes hasBag (the one-liner landed)', () => {
    expect(socketSrc).toContain('hasBag: Boolean(user?.hasBag),');
    // The old "NOT in this whitelist yet" note is gone.
    expect(socketSrc).not.toContain('hasBag is NOT in this whitelist');
  });

  it('join_room merges the bag into playerState via syncBagForPlayer', () => {
    expect(socketSrc).toContain('syncBagForPlayer(userId, user?.hasBag)');
    expect(socketSrc).toContain('playerState.hasBag = await syncBagForPlayer');
  });

  it('a get_bag handler answers with bag_state', () => {
    expect(socketSrc).toContain("socket.on('get_bag'");
    expect(socketSrc).toContain("socket.emit('bag_state'");
  });

  it('the client asks for its bag in the join burst and handles bag_state', () => {
    expect(sceneSrc).toContain("socket.emit('get_bag'");
    expect(sceneSrc).toContain("socket.on('bag_state'");
    expect(sceneSrc).toContain('setHasBagFromServer');
  });
});
