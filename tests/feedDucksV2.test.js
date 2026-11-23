// feedDucksV2.test.js — Feed the Ducks v2 (`sq-feed-ducks-v2`).
//
// Pure-logic tests: one bits of food lasts 3 feeds (ducks or cat),
// each feed spends ONE charge, and the item leaves the pocket at 0.
// The gate is by FOOD TYPE, not a specific item id. Charges survive
// the mail and home-storage round trips (both clean/normalize
// functions whitelist the usesLeft field).
//
// The scene-level gate itself (VillageScene._tryFeedDucks refusing
// with NO_FOOD_MESSAGE when the pocket holds no food) cannot run in
// vitest — VillageScene imports Phaser, which touches the DOM at
// import time. It is covered by the /tmp harness driving the exact
// helpers the scene calls (findFoodItem / spendFoodCharge), plus a
// code read of _tryFeedDucks and the live E-key check.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ITEM_TYPES,
  FEED_DUCKS_V2_MARKER,
  FOOD_FEEDS_PER_ITEM,
  NO_FOOD_MESSAGE,
  addItem,
  getItem,
  getInventory,
  getInventoryState,
  foodUsesLeft,
  findFoodItem,
  spendFoodCharge,
  _setInventoryForTest,
} from '../src/village/items.js';
import { cleanMailItem, cleanPackage } from '../src/village/mailState.js';
import {
  normalizeHomeItems,
  normalizeFloorItems,
  takeFromHome,
} from '../src/village/homeStorage.js';

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

const food = (over = {}) => ({ id: over.id || 'food-1', type: 'food', ...over });

describe('food charges (3 feeds per item)', () => {
  it('carries the v2 marker', () => {
    expect(FEED_DUCKS_V2_MARKER).toBe('sq-feed-ducks-v2');
  });

  it('a fresh bits of food starts with 3 feeds', () => {
    const res = addItem({ type: ITEM_TYPES.FOOD });
    expect(res.ok).toBe(true);
    expect(res.item.usesLeft).toBe(3);
    expect(FOOD_FEEDS_PER_ITEM).toBe(3);
  });

  it('a supplied count is kept, clamped to 3', () => {
    expect(addItem({ type: ITEM_TYPES.FOOD, usesLeft: 2 }).item.usesLeft).toBe(2);
    expect(addItem({ type: ITEM_TYPES.FOOD, usesLeft: 9 }).item.usesLeft).toBe(3);
    expect(addItem({ type: ITEM_TYPES.FOOD, usesLeft: 0 }).item.usesLeft).toBe(3);
  });

  it('each spend drops one charge; the item leaves at 0', () => {
    const id = addItem({ type: ITEM_TYPES.FOOD }).item.id;
    expect(spendFoodCharge(id)).toEqual(
      expect.objectContaining({ ok: true, chargesLeft: 2, removed: false }),
    );
    expect(getItem(id).usesLeft).toBe(2);
    expect(spendFoodCharge(id).chargesLeft).toBe(1);
    expect(getItem(id).usesLeft).toBe(1);
    expect(spendFoodCharge(id)).toEqual(
      expect.objectContaining({ ok: true, chargesLeft: 0, removed: true }),
    );
    expect(getItem(id)).toBeNull();
    expect(getInventory().items).toHaveLength(0);
  });

  it('legacy food without a usesLeft field counts as full (3)', () => {
    _setInventoryForTest({
      items: [{ id: 'food-old', type: 'food', label: 'Bits of food', createdAt: 1 }],
      hasBag: false,
    });
    expect(foodUsesLeft(getItem('food-old'))).toBe(3);
    expect(getInventoryState().items[0].usesLeft).toBe(3);
    expect(spendFoodCharge('food-old').chargesLeft).toBe(2);
    expect(getItem('food-old').usesLeft).toBe(2);
  });

  it('no food in the pocket refuses with no-food', () => {
    addItem({ type: ITEM_TYPES.TRASH });
    expect(spendFoodCharge()).toEqual({ ok: false, reason: 'no-food' });
    expect(findFoodItem()).toBeNull();
    expect(NO_FOOD_MESSAGE).toBe('You need bits of food to feed the ducks');
  });

  it('non-food items never carry charges', () => {
    const trash = addItem({ type: ITEM_TYPES.TRASH }).item;
    expect(trash.usesLeft).toBeNull();
    expect(foodUsesLeft(trash)).toBeNull();
    expect(foodUsesLeft(null)).toBeNull();
  });
});

describe('which food spends the charge', () => {
  it('with no preferred id, the fewest-charges food goes first', () => {
    const nearlyEmpty = addItem({ type: ITEM_TYPES.FOOD, usesLeft: 1 }).item;
    const fresh = addItem({ type: ITEM_TYPES.FOOD }).item;
    expect(spendFoodCharge().itemId).toBe(nearlyEmpty.id);
    expect(getItem(nearlyEmpty.id)).toBeNull(); // spent its last charge
    expect(getItem(fresh.id).usesLeft).toBe(3); // untouched
  });

  it('a preferred id (the tapped Use item) wins over fewest-first', () => {
    const nearlyEmpty = addItem({ type: ITEM_TYPES.FOOD, usesLeft: 1 }).item;
    const fresh = addItem({ type: ITEM_TYPES.FOOD }).item;
    expect(spendFoodCharge(fresh.id).itemId).toBe(fresh.id);
    expect(getItem(fresh.id).usesLeft).toBe(2);
    expect(getItem(nearlyEmpty.id).usesLeft).toBe(1);
  });

  it('an unknown preferred id falls back to fewest-first', () => {
    const only = addItem({ type: ITEM_TYPES.FOOD }).item;
    expect(spendFoodCharge('food-nope').itemId).toBe(only.id);
  });
});

describe('charges survive the mail round trip', () => {
  it('cleanMailItem keeps a food item\'s remaining feeds', () => {
    expect(cleanMailItem(food({ usesLeft: 2 })).usesLeft).toBe(2);
    expect(cleanMailItem(food({ usesLeft: 9 })).usesLeft).toBe(3);
    expect(cleanMailItem(food()).usesLeft).toBeNull();
  });

  it('cleanMailItem drops usesLeft for non-food', () => {
    expect(cleanMailItem({ id: 'n-1', type: 'note', usesLeft: 2 }).usesLeft).toBeNull();
  });

  it('a collected package lands in the pocket with its charges', () => {
    const cleaned = cleanMailItem(food({ id: 'food-mailed', usesLeft: 2 }));
    const res = addItem(cleaned);
    expect(res.ok).toBe(true);
    expect(res.item.usesLeft).toBe(2);
    // And food mailed without a count arrives full.
    const res2 = addItem(cleanMailItem(food({ id: 'food-mailed-2' })));
    expect(res2.item.usesLeft).toBe(3);
  });

  it('cleanPackage keeps the item charges too', () => {
    const pkg = cleanPackage({
      id: 'pkg-1', fromUserId: 'a@b.c', fromName: 'Alice',
      item: food({ id: 'food-pkg', usesLeft: 1 }), sentAt: 1,
    });
    expect(pkg.item.usesLeft).toBe(1);
  });
});

describe('charges survive home storage', () => {
  it('normalizeHomeItems keeps a stored food item\'s feeds', () => {
    const out = normalizeHomeItems([food({ usesLeft: 2 }), food({ id: 'food-9', usesLeft: 9 }), food({ id: 'food-x' })]);
    expect(out.find((i) => i.id === 'food-1').usesLeft).toBe(2);
    expect(out.find((i) => i.id === 'food-9').usesLeft).toBe(3);
    expect(out.find((i) => i.id === 'food-x').usesLeft).toBeNull();
  });

  it('taking food back out of home keeps its charges', () => {
    const { item } = takeFromHome([food({ usesLeft: 1 })], 'food-1');
    expect(item.usesLeft).toBe(1);
    expect(addItem(item).item.usesLeft).toBe(1);
  });

  it('normalizeFloorItems keeps a dropped food item\'s feeds', () => {
    const out = normalizeFloorItems([{ ...food({ usesLeft: 2 }), x: 10, y: 20 }]);
    expect(out[0].usesLeft).toBe(2);
  });
});
