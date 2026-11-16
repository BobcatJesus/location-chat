// items.test.js — Items + Inventory v1 (`sq-items-inventory-v1`).
// Pure-logic tests for src/village/items.js. The store reads
// localStorage lazily, so a stub installed in beforeEach is enough
// (no import-time access). Note getCoins() grants the +10 daily
// bonus on a fresh stub — tests use that plus earnCoins to fund
// the bag / flyer purchases.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ITEMS_MARKER_V1,
  POCKET_CAPACITY,
  BAG_CAPACITY,
  BAG_PRICE_COINS,
  FLYER_CREATE_COST,
  ITEM_TYPES,
  INVENTORY_FULL_MESSAGE,
  DIARY_ENTRIES,
  SEEDED_FLYERS,
  SEEDED_NOTES,
  getInventory,
  getInventoryState,
  capacity,
  hasBag,
  isFull,
  canAddItem,
  addItem,
  removeItem,
  getItem,
  addPuzzlePiece,
  removePuzzlePiece,
  carriedPuzzlePieces,
  clearPuzzlePieces,
  buyBag,
  createFlyer,
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

describe('items inventory v1 marker + capacities', () => {
  it('carries the v1 marker', () => {
    expect(ITEMS_MARKER_V1).toBe('sq-items-inventory-v1');
  });

  it('pocket holds 3, bag holds 10', () => {
    expect(POCKET_CAPACITY).toBe(3);
    expect(BAG_CAPACITY).toBe(10);
    expect(capacity(getInventory())).toBe(3);
  });
});

describe('pocket capacity (3)', () => {
  it('refuses the 4th item with reason inventory-full', () => {
    expect(addItem({ type: ITEM_TYPES.TRASH }).ok).toBe(true);
    expect(addItem({ type: ITEM_TYPES.FOOD }).ok).toBe(true);
    expect(addItem({ type: ITEM_TYPES.CIGARETTES }).ok).toBe(true);
    expect(isFull()).toBe(true);
    const fourth = addItem({ type: ITEM_TYPES.NOTE, title: 'n', text: 't' });
    expect(fourth.ok).toBe(false);
    expect(fourth.reason).toBe('inventory-full');
    expect(getInventory().items).toHaveLength(3);
  });

  it('canAddItem is false when full', () => {
    addItem({ type: ITEM_TYPES.TRASH });
    addItem({ type: ITEM_TYPES.TRASH });
    addItem({ type: ITEM_TYPES.TRASH });
    expect(canAddItem({ type: ITEM_TYPES.FOOD })).toBe(false);
  });

  it('removing an item makes room again', () => {
    const a = addItem({ type: ITEM_TYPES.TRASH }).item;
    addItem({ type: ITEM_TYPES.TRASH });
    addItem({ type: ITEM_TYPES.TRASH });
    expect(removeItem(a.id)).not.toBeNull();
    expect(addItem({ type: ITEM_TYPES.FOOD }).ok).toBe(true);
  });
});

describe('bag upgrade (20 coins -> 10 slots)', () => {
  it('costs 20 coins', () => {
    expect(BAG_PRICE_COINS).toBe(20);
  });

  it('refuses the bag when broke', () => {
    // Fresh stub: getCoins() grants the +10 daily bonus, so spend
    // it down first via a flyer + ... instead just check the
    // broke path with a stub that has no daily bonus left: call
    // getCoins() once (claims +10), then buy two flyers (5 each)
    // to reach 0, then the bag must fail.
    expect(getCoins()).toBe(10);
    expect(createFlyer('A', 'a').ok).toBe(true);
    expect(createFlyer('B', 'b').ok).toBe(true);
    expect(getCoins()).toBe(0);
    const res = buyBag();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-enough-coins');
    expect(hasBag()).toBe(false);
  });

  it('buys the bag and raises capacity to 10', () => {
    earnCoins(20, 'test'); // +10 daily bonus + 20 = 30
    expect(getCoins()).toBe(30);
    const res = buyBag();
    expect(res.ok).toBe(true);
    expect(res.capacity).toBe(BAG_CAPACITY);
    expect(hasBag()).toBe(true);
    expect(capacity(getInventory())).toBe(10);
    expect(getCoins()).toBe(10); // 30 - 20
    for (let i = 0; i < 10; i++) {
      expect(addItem({ type: ITEM_TYPES.TRASH }).ok).toBe(true);
    }
    expect(addItem({ type: ITEM_TYPES.TRASH }).reason).toBe('inventory-full');
  });

  it('refuses a second bag', () => {
    earnCoins(50, 'test');
    expect(buyBag().ok).toBe(true);
    expect(buyBag().reason).toBe('already-owned');
  });
});

describe('puzzle pieces occupy pocket slots', () => {
  it('a piece takes one slot; placing it (removing it) frees the slot', () => {
    expect(addPuzzlePiece(5).ok).toBe(true);
    expect(carriedPuzzlePieces()).toEqual([5]);
    expect(getInventory().items).toHaveLength(1);
    addItem({ type: ITEM_TYPES.TRASH });
    addItem({ type: ITEM_TYPES.TRASH });
    expect(isFull()).toBe(true);
    // Full pocket: no more pieces either.
    expect(addPuzzlePiece(0).reason).toBe('inventory-full');
    // Placing piece 5 on the board frees its slot.
    expect(removePuzzlePiece(5)).not.toBeNull();
    expect(carriedPuzzlePieces()).toEqual([]);
    expect(addPuzzlePiece(0).ok).toBe(true);
  });

  it('clearPuzzlePieces drops carried pieces on a new round, keeps the rest', () => {
    addPuzzlePiece(2);
    addItem({ type: ITEM_TYPES.FOOD });
    expect(clearPuzzlePieces()).toBe(1);
    expect(carriedPuzzlePieces()).toEqual([]);
    expect(getInventory().items).toHaveLength(1);
    expect(getInventory().items[0].type).toBe(ITEM_TYPES.FOOD);
  });

  it('the full-pocket message names the puzzle board', () => {
    expect(INVENTORY_FULL_MESSAGE).toContain('place a piece on the puzzle board');
  });
});

describe('flyer creation (5 coins)', () => {
  it('costs 5 coins and lands in the pocket', () => {
    expect(FLYER_CREATE_COST).toBe(5);
    expect(getCoins()).toBe(10); // daily bonus
    const res = createFlyer('Guitar lessons!', 'First lesson free.');
    expect(res.ok).toBe(true);
    expect(res.item.type).toBe(ITEM_TYPES.FLYER);
    expect(res.item.title).toBe('Guitar lessons!');
    expect(getCoins()).toBe(5);
    expect(getItem(res.item.id).readable).toBe(true);
  });

  it('refuses an empty flyer without charging', () => {
    expect(createFlyer('', '').reason).toBe('empty-flyer');
    expect(getCoins()).toBe(10);
  });

  it('refuses when the pocket is full', () => {
    addItem({ type: ITEM_TYPES.TRASH });
    addItem({ type: ITEM_TYPES.TRASH });
    addItem({ type: ITEM_TYPES.TRASH });
    expect(createFlyer('T', 'x').reason).toBe('inventory-full');
  });
});

describe('readable content', () => {
  it('the diary has entries (in-world flavor, no real person)', () => {
    expect(DIARY_ENTRIES.length).toBeGreaterThanOrEqual(3);
    for (const entry of DIARY_ENTRIES) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.text.length).toBeGreaterThan(20);
    }
  });

  it('seeded flyers and notes exist', () => {
    expect(SEEDED_FLYERS.length).toBeGreaterThanOrEqual(1);
    expect(SEEDED_NOTES.length).toBeGreaterThanOrEqual(1);
    expect(SEEDED_NOTES[0].text.length).toBeGreaterThan(0);
  });

  it('getInventoryState reports count / capacity / coins', () => {
    addItem({ type: ITEM_TYPES.TRASH });
    const state = getInventoryState();
    expect(state.count).toBe(1);
    expect(state.capacity).toBe(3);
    expect(state.hasBag).toBe(false);
    expect(state.full).toBe(false);
    expect(state.bagPrice).toBe(BAG_PRICE_COINS);
    expect(state.flyerCost).toBe(FLYER_CREATE_COST);
  });
});
