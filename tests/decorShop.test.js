// decorShop.test.js — Decoration Shop v1 (`sq-dec-shop-v1`).
// Pure-logic tests for src/village/decorState.js and the
// buyDecoration pocket flow in src/village/items.js. The store
// reads localStorage lazily, so a stub installed in beforeEach is
// enough (no import-time access). Note getCoins() grants the +10
// daily bonus on a fresh stub — tests use that plus earnCoins to
// fund the purchases.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEC_SHOP_MARKER_V1,
  DECOR_KINDS,
  DECOR_KIND_IDS,
  DECOR_MAX_PER_ROOM,
  createDecorState,
  cleanDecoration,
  placeDecoration,
  canRemoveDecoration,
  removeDecoration,
  serializeDecorState,
  parseDecorState,
} from '../src/village/decorState.js';
import {
  ITEM_TYPES,
  buyDecoration,
  getInventory,
  getItem,
  addItem,
  _setInventoryForTest,
} from '../src/village/items.js';
import { earnCoins, getCoins } from '../src/village/CoinWallet.js';

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

describe('decoration shop v1 marker + catalogue', () => {
  it('carries the v1 marker', () => {
    expect(DEC_SHOP_MARKER_V1).toBe('sq-dec-shop-v1');
  });

  it('sells five decorations, Krampus NOT among them', () => {
    expect(DECOR_KIND_IDS).toEqual(['ornament', 'lights', 'snowman', 'tree', 'santa']);
    expect(DECOR_KINDS.krampus).toBeUndefined();
  });

  it('charges the user-set prices for ornament / lights / snowman', () => {
    expect(DECOR_KINDS.ornament.price).toBe(5);
    expect(DECOR_KINDS.lights.price).toBe(10);
    expect(DECOR_KINDS.snowman.price).toBe(15);
  });

  it('tree and Santa are the expensive builder picks', () => {
    expect(DECOR_KINDS.tree.price).toBe(25);
    expect(DECOR_KINDS.santa.price).toBe(20);
    expect(DECOR_KINDS.tree.price).toBeGreaterThan(DECOR_KINDS.snowman.price);
    expect(DECOR_KINDS.santa.price).toBeGreaterThan(DECOR_KINDS.snowman.price);
  });
});

describe('decorState: placing', () => {
  it('places a valid decoration', () => {
    const state = createDecorState();
    const res = placeDecoration(state, { id: 'd1', kind: 'tree', x: 800, y: 450, addedBy: 'a@b.c', addedByName: 'A' });
    expect(res.ok).toBe(true);
    expect(res.decoration.kind).toBe('tree');
    expect(state.decorations).toHaveLength(1);
  });

  it('refuses an unknown kind (Krampus cannot be placed)', () => {
    const state = createDecorState();
    const res = placeDecoration(state, { id: 'd1', kind: 'krampus', x: 800, y: 450 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('bad-kind');
    expect(state.decorations).toHaveLength(0);
  });

  it('refuses a duplicate id', () => {
    const state = createDecorState();
    placeDecoration(state, { id: 'd1', kind: 'tree', x: 800, y: 450 });
    const res = placeDecoration(state, { id: 'd1', kind: 'lights', x: 100, y: 100 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('duplicate');
  });

  it('refuses the 31st decoration — the room is full, nothing is dropped', () => {
    const state = createDecorState();
    expect(DECOR_MAX_PER_ROOM).toBe(30);
    for (let i = 0; i < DECOR_MAX_PER_ROOM; i++) {
      expect(placeDecoration(state, { id: `d${i}`, kind: 'ornament', x: i, y: i }).ok).toBe(true);
    }
    const res = placeDecoration(state, { id: 'd30', kind: 'tree', x: 1, y: 1 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('room-full');
    expect(state.decorations).toHaveLength(30);
  });

  it('clamps nonsense coordinates into the room', () => {
    const decor = cleanDecoration({ id: 'd1', kind: 'lights', x: -500, y: 99999 });
    expect(decor.x).toBe(0);
    expect(decor.y).toBe(3000);
  });

  it('serializes and parses back to the same room', () => {
    const state = createDecorState();
    placeDecoration(state, { id: 'd1', kind: 'santa', x: 300, y: 400, addedBy: 'a@b.c', addedByName: 'A' });
    placeDecoration(state, { id: 'd2', kind: 'lights', x: 500, y: 600, addedBy: 'd@e.f', addedByName: 'D' });
    const parsed = parseDecorState(serializeDecorState(state));
    expect(parsed.decorations).toHaveLength(2);
    expect(parsed.decorations[0].kind).toBe('santa');
    expect(parsed.decorations[1].addedByName).toBe('D');
  });

  it('parse caps at the room max and drops bad kinds', () => {
    const raw = {
      decorations: [
        ...Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, kind: 'ornament', x: i, y: i })),
        { id: 'bad', kind: 'krampus', x: 1, y: 1 },
      ],
    };
    expect(parseDecorState(raw).decorations).toHaveLength(DECOR_MAX_PER_ROOM);
  });
});

describe('decorState: removing', () => {
  function oneDecor() {
    const state = createDecorState();
    placeDecoration(state, { id: 'd1', kind: 'tree', x: 800, y: 450, addedBy: 'owner@x.y', addedByName: 'Owner' });
    return state;
  }

  it('the owner can remove their own decoration', () => {
    const state = oneDecor();
    expect(canRemoveDecoration(state.decorations[0], 'owner@x.y', false)).toBe(true);
    expect(removeDecoration(state, 'd1', 'owner@x.y', false).ok).toBe(true);
    expect(state.decorations).toHaveLength(0);
  });

  it('a stranger cannot remove it', () => {
    const state = oneDecor();
    expect(canRemoveDecoration(state.decorations[0], 'stranger@x.y', false)).toBe(false);
    const res = removeDecoration(state, 'd1', 'stranger@x.y', false);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-allowed');
    expect(state.decorations).toHaveLength(1);
  });

  it('a moderator can remove any decoration', () => {
    const state = oneDecor();
    expect(canRemoveDecoration(state.decorations[0], 'mod@x.y', true)).toBe(true);
    expect(removeDecoration(state, 'd1', 'mod@x.y', true).ok).toBe(true);
  });

  it('removing a missing decoration says not-found', () => {
    const state = oneDecor();
    expect(removeDecoration(state, 'nope', 'owner@x.y', false).reason).toBe('not-found');
  });
});

describe('buyDecoration: coins + pocket', () => {
  it('buys an ornament for 5 coins and pockets it as a decoration item', () => {
    const before = getCoins(); // fresh stub grants the +10 daily bonus
    const res = buyDecoration('ornament');
    expect(res.ok).toBe(true);
    expect(res.price).toBe(5);
    expect(getCoins()).toBe(before - 5);
    expect(getInventory().items).toHaveLength(1);
    const item = getItem(getInventory().items[0].id);
    expect(item.type).toBe(ITEM_TYPES.DECORATION);
    expect(item.decorKind).toBe('ornament');
    expect(item.label).toBe('Ornament');
    expect(item.emoji).toBe('🔴');
  });

  it('buys a tree for 25 coins', () => {
    earnCoins(30, 'test');
    const before = getCoins();
    const res = buyDecoration('tree');
    expect(res.ok).toBe(true);
    expect(getCoins()).toBe(before - 25);
    expect(getItem(getInventory().items[0].id).label).toBe('Mini Christmas tree');
  });

  it('refuses when short on coins — and takes nothing', () => {
    // Fresh stub: 10 coins. Santa costs 20.
    const before = getCoins();
    const res = buyDecoration('santa');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-enough-coins');
    expect(getCoins()).toBe(before);
    expect(getInventory().items).toHaveLength(0);
  });

  it('refuses when the pocket is full — and takes no coins', () => {
    earnCoins(50, 'test');
    addItem({ type: ITEM_TYPES.TRASH });
    addItem({ type: ITEM_TYPES.FOOD });
    addItem({ type: ITEM_TYPES.CIGARETTES });
    const before = getCoins();
    const res = buyDecoration('ornament');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('inventory-full');
    expect(getCoins()).toBe(before);
    expect(getInventory().items).toHaveLength(3);
  });

  it('refuses an unknown kind', () => {
    const before = getCoins();
    const res = buyDecoration('krampus');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('bad-kind');
    expect(getCoins()).toBe(before);
  });
});
