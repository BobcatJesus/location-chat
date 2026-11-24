// hungryCatV12.test.js — Hungry Cat v1.2 (`sq-hungry-cat-v1.2`).
// The bug: petCat no-op'd inside its 5s cooldown, but the treat path
// spent the food charge anyway and faked the success message — so it
// took 3 feeds to clear the hungry bubble. The fix: petCat reports
// whether the pet landed, and the treat path spends the charge ONLY
// when it landed. A tap during the cooldown keeps the food and
// refuses with 'cat-cooldown' (the pocket panel shows that line).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ITEM_TYPES,
  addItem,
  getItem,
  _setInventoryForTest,
} from '../src/village/items.js';
import { ItemsSystem } from '../src/village/ItemsSystem.js';

function makeLocalStorageStub() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

function makeScene(petResult) {
  return {
    player: { gx: 100, gy: 100 },
    duckPond: { nearestFeedablePond: () => null },
    cafeCat: {
      nearestCat: () => ({ x: 100, y: 100 }),
      nearestSleepingCat: () => null,
      petCat: vi.fn(() => petResult),
    },
    onSystemNotice: vi.fn(),
  };
}

beforeEach(() => {
  globalThis.localStorage = makeLocalStorageStub();
  _setInventoryForTest({ items: [], hasBag: false });
});

describe('useItem treat path (Hungry Cat v1.2)', () => {
  it('refuses during the pet cooldown and keeps the food', () => {
    const scene = makeScene(false);
    const sys = new ItemsSystem(scene);
    const added = addItem({ type: ITEM_TYPES.FOOD });
    expect(added.ok).toBe(true);
    const id = added.item.id;
    expect(getItem(id).usesLeft).toBe(3);

    const res = sys.useItem(id);

    expect(res).toEqual({ ok: false, reason: 'cat-cooldown' });
    expect(scene.cafeCat.petCat).toHaveBeenCalledWith(true, { fed: true });
    // No charge spent — the food is still whole.
    expect(getItem(id).usesLeft).toBe(3);
  });

  it('spends one charge when the pet lands', () => {
    const scene = makeScene(true);
    const sys = new ItemsSystem(scene);
    const added = addItem({ type: ITEM_TYPES.FOOD });
    const id = added.item.id;

    const res = sys.useItem(id);

    expect(res).toEqual({ ok: true, used: 'cat' });
    expect(getItem(id).usesLeft).toBe(2);
    expect(scene.onSystemNotice).toHaveBeenCalledWith('🐱 The cat gobbles up the treat!');
  });
});
