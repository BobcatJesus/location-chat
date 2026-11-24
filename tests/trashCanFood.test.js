// trashCanFood.test.js — Hunger v1.1 (`sq-hunger-v1.1`).
// The Agora trash can sometimes (1-in-3 digs) yields bits of food
// instead of trash. The food is trash food: eating it triggers the
// queasy gag (Hunger v1).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ITEM_TYPES,
  addItem,
  _setInventoryForTest,
} from '../src/village/items.js';
import {
  ItemsSystem,
  TRASH_CAN_FOOD_CHANCE,
  rollTrashCanYield,
} from '../src/village/ItemsSystem.js';

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

describe('rollTrashCanYield', () => {
  it('is a 1-in-3 chance', () => {
    expect(TRASH_CAN_FOOD_CHANCE).toBeCloseTo(1 / 3);
  });

  it('yields trash food below the chance', () => {
    expect(rollTrashCanYield(0)).toEqual({ type: ITEM_TYPES.FOOD, trashFood: true });
    expect(rollTrashCanYield(0.32)).toEqual({ type: ITEM_TYPES.FOOD, trashFood: true });
  });

  it('yields plain trash at or above the chance', () => {
    expect(rollTrashCanYield(1 / 3)).toEqual({ type: ITEM_TYPES.TRASH });
    expect(rollTrashCanYield(0.99)).toEqual({ type: ITEM_TYPES.TRASH });
  });
});

describe('trash-can food in the pocket', () => {
  it('stores as Bits of food with 3 feeds and the trashFood flag', () => {
    const res = addItem(rollTrashCanYield(0.1));
    expect(res.ok).toBe(true);
    expect(res.item.label).toBe('Bits of food');
    expect(res.item.usesLeft).toBe(3);
    expect(res.item.trashFood).toBe(true);
  });
});

describe('_itemForSpot trash can', () => {
  it('rolls the yield (stubbed Math.random)', () => {
    const sys = new ItemsSystem(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    expect(sys._itemForSpot({ kind: ITEM_TYPES.TRASH })).toEqual({
      type: ITEM_TYPES.FOOD,
      trashFood: true,
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    expect(sys._itemForSpot({ kind: ITEM_TYPES.TRASH })).toEqual({
      type: ITEM_TYPES.TRASH,
    });
    vi.restoreAllMocks();
  });
});
