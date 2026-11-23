// breadShop.test.js — Bread Shop v1 (`sq-bread-shop-v1`).
// Pure-logic tests for the stock table (src/village/breadShop.js),
// the buyBread pocket flow (src/village/items.js), the
// DecorSystem buy/state methods, and the breadKind round trips
// (mailState / homeStorage). The store reads localStorage lazily,
// so a stub installed in beforeEach is enough (no import-time
// access). Note getCoins() grants the +10 daily bonus on a fresh
// stub — enough for a 3-coin loaf; earnCoins funds the rest.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BREAD_SHOP_MARKER_V1,
  BREAD_KINDS,
  BREAD_KIND_IDS,
  BREAD_PRICE_COINS,
  breadStockFor,
} from '../src/village/breadShop.js';
import {
  ITEM_TYPES,
  buyBread,
  getInventory,
  getItem,
  _setInventoryForTest,
} from '../src/village/items.js';
import { earnCoins, getCoins } from '../src/village/CoinWallet.js';
import { DecorSystem } from '../src/village/DecorSystem.js';
import { cleanMailItem } from '../src/village/mailState.js';
import { normalizeHomeItems, normalizeFloorItems } from '../src/village/homeStorage.js';

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

function stubScene(room) {
  return {
    roomId: room.roomId || '',
    roomName: room.roomName || '',
    amenityTag: room.amenityTag || '',
    shopTag: room.shopTag || '',
    onSystemNotice: () => {},
  };
}

describe('bread catalogue', () => {
  it('carries the v1 marker', () => {
    expect(BREAD_SHOP_MARKER_V1).toBe('sq-bread-shop-v1');
  });

  it('sells three breads, all 3 coins', () => {
    expect(BREAD_KIND_IDS).toEqual(['roll', 'croissant', 'baguette']);
    for (const id of BREAD_KIND_IDS) {
      expect(BREAD_KINDS[id].price).toBe(3);
    }
    expect(BREAD_PRICE_COINS).toBe(3);
  });

  it('each bread has its own emoji and label', () => {
    expect(BREAD_KINDS.roll.emoji).toBe('🍞');
    expect(BREAD_KINDS.roll.label).toBe('Bread roll');
    expect(BREAD_KINDS.croissant.emoji).toBe('🥐');
    expect(BREAD_KINDS.croissant.label).toBe('Croissant');
    expect(BREAD_KINDS.baguette.emoji).toBe('🥖');
    expect(BREAD_KINDS.baguette.label).toBe('Baguette');
  });
});

describe('breadStockFor — the one stock table', () => {
  it('Agora bar sells all three', () => {
    expect(breadStockFor({ roomId: 'agora-houston' })).toEqual(['roll', 'croissant', 'baguette']);
  });

  it('bakery sells all three', () => {
    expect(breadStockFor({ shopTag: 'bakery' })).toEqual(['roll', 'croissant', 'baguette']);
  });

  it('supermarket and convenience sell only the roll', () => {
    expect(breadStockFor({ shopTag: 'supermarket' })).toEqual(['roll']);
    expect(breadStockFor({ shopTag: 'convenience' })).toEqual(['roll']);
  });

  it('deli sells roll + baguette', () => {
    expect(breadStockFor({ shopTag: 'deli' })).toEqual(['roll', 'baguette']);
  });

  it('cafe / coffee_shop / coffee sell only the croissant', () => {
    expect(breadStockFor({ shopTag: 'cafe' })).toEqual(['croissant']);
    expect(breadStockFor({ shopTag: 'coffee_shop' })).toEqual(['croissant']);
    expect(breadStockFor({ shopTag: 'coffee' })).toEqual(['croissant']);
    expect(breadStockFor({ amenityTag: 'cafe' })).toEqual(['croissant']);
  });

  it('coffee in the room name sells only the croissant', () => {
    expect(breadStockFor({ shopTag: 'cafe', roomName: 'Starbucks on Main' })).toEqual(['croissant']);
    expect(breadStockFor({ roomName: 'Dunkin Donuts' })).toEqual(['croissant']);
    expect(breadStockFor({ roomName: 'Corner Coffee House' })).toEqual(['croissant']);
  });

  it('any other shop sells no bread at all', () => {
    expect(breadStockFor({ shopTag: 'books' })).toEqual([]);
    expect(breadStockFor({ shopTag: 'clothes' })).toEqual([]);
    expect(breadStockFor({ shopTag: 'pharmacy' })).toEqual([]);
    expect(breadStockFor({ shopTag: '' })).toEqual([]);
    expect(breadStockFor({})).toEqual([]);
  });

  it('matching is case-insensitive, and the specific shop type wins over the name', () => {
    expect(breadStockFor({ shopTag: 'Bakery' })).toEqual(['roll', 'croissant', 'baguette']);
    expect(breadStockFor({ shopTag: 'bakery', roomName: 'Coffee & Croissants' })).toEqual(['roll', 'croissant', 'baguette']);
    expect(breadStockFor({ shopTag: 'supermarket', roomName: 'Coffee Corner Market' })).toEqual(['roll']);
  });
});

describe('buyBread — the pocket flow', () => {
  it('buys a baguette for 3 coins as a FOOD item with 3 feeds', () => {
    const before = getCoins();
    const res = buyBread('baguette');
    expect(res.ok).toBe(true);
    expect(res.price).toBe(3);
    expect(getCoins()).toBe(before - 3);
    expect(res.item.type).toBe(ITEM_TYPES.FOOD);
    expect(res.item.breadKind).toBe('baguette');
    expect(res.item.label).toBe('Baguette');
    expect(res.item.emoji).toBe('🥖');
    expect(res.item.usesLeft).toBe(3);
    expect(res.item.usable).toBe(true);
  });

  it('the three breads are distinguishable in the pocket', () => {
    earnCoins(10, 'test');
    buyBread('roll');
    buyBread('croissant');
    buyBread('baguette');
    const labels = getInventory().items.map((it) => getItem(it.id).label);
    expect(labels).toEqual(['Bread roll', 'Croissant', 'Baguette']);
    const emojis = getInventory().items.map((it) => getItem(it.id).emoji);
    expect(emojis).toEqual(['🍞', '🥐', '🥖']);
  });

  it('refuses an unknown kind', () => {
    expect(buyBread('sourdough')).toEqual({ ok: false, reason: 'bad-kind' });
    expect(buyBread('')).toEqual({ ok: false, reason: 'bad-kind' });
    expect(getInventory().items).toHaveLength(0);
  });

  it('a full pocket refuses BEFORE any coins move', () => {
    _setInventoryForTest({
      items: [
        { id: 't1', type: 'trash' },
        { id: 't2', type: 'trash' },
        { id: 't3', type: 'trash' },
      ],
      hasBag: false,
    });
    const before = getCoins();
    expect(buyBread('roll')).toEqual({ ok: false, reason: 'inventory-full' });
    expect(getCoins()).toBe(before);
  });

  it('insufficient coins refuses and buys nothing', () => {
    // Fresh stub grants +10 on first getCoins(); spend it down
    // with three rolls (9 coins) so only 1 coin is left. The bag
    // (10 slots) keeps the pocket-full check out of the way, so
    // the refusal is the coin check, not the capacity check.
    _setInventoryForTest({ items: [], hasBag: true });
    buyBread('roll');
    buyBread('roll');
    buyBread('roll');
    expect(getCoins()).toBe(1);
    expect(buyBread('croissant')).toEqual({ ok: false, reason: 'not-enough-coins' });
    expect(getInventory().items).toHaveLength(3);
  });
});

describe('DecorSystem buyBread / getBreadShopState', () => {
  it('Agora sells all three through the bar', () => {
    const sys = new DecorSystem(stubScene({ roomId: 'agora-houston', roomName: 'Agora' }));
    expect(sys.getBreadShopState().breads.map((b) => b.kind)).toEqual(['roll', 'croissant', 'baguette']);
    const res = sys.buyBread('croissant');
    expect(res.ok).toBe(true);
    expect(res.item.label).toBe('Croissant');
  });

  it('a bakery sells all three at the Register', () => {
    const sys = new DecorSystem(stubScene({ roomId: 'bakery-1', roomName: 'Le Pain', shopTag: 'bakery' }));
    expect(sys.getBreadShopState().breads.map((b) => b.kind)).toEqual(['roll', 'croissant', 'baguette']);
    expect(sys.buyBread('baguette').ok).toBe(true);
  });

  it('a supermarket sells only the roll — a baguette is refused', () => {
    const sys = new DecorSystem(stubScene({ roomId: 'market-1', roomName: 'HEB', shopTag: 'supermarket' }));
    expect(sys.getBreadShopState().breads.map((b) => b.kind)).toEqual(['roll']);
    expect(sys.buyBread('roll').ok).toBe(true);
    expect(sys.buyBread('baguette')).toEqual({ ok: false, reason: 'bad-kind' });
    expect(sys.buyBread('croissant')).toEqual({ ok: false, reason: 'bad-kind' });
  });

  it('a deli sells roll + baguette, not the croissant', () => {
    const sys = new DecorSystem(stubScene({ roomId: 'deli-1', roomName: 'Deli', shopTag: 'deli' }));
    expect(sys.getBreadShopState().breads.map((b) => b.kind)).toEqual(['roll', 'baguette']);
    expect(sys.buyBread('croissant')).toEqual({ ok: false, reason: 'bad-kind' });
  });

  it('a cafe sells only the croissant', () => {
    const sys = new DecorSystem(stubScene({ roomId: 'cafe-1', roomName: 'Starbucks', shopTag: 'cafe' }));
    expect(sys.getBreadShopState().breads.map((b) => b.kind)).toEqual(['croissant']);
    expect(sys.buyBread('roll')).toEqual({ ok: false, reason: 'bad-kind' });
  });

  it('a bookshop sells nothing — every kind is refused', () => {
    const sys = new DecorSystem(stubScene({ roomId: 'books-1', roomName: 'Barnes & Noble', shopTag: 'books' }));
    expect(sys.getBreadShopState().breads).toEqual([]);
    expect(sys.buyBread('roll')).toEqual({ ok: false, reason: 'bad-kind' });
    expect(sys.buyBread('croissant')).toEqual({ ok: false, reason: 'bad-kind' });
    expect(sys.buyBread('baguette')).toEqual({ ok: false, reason: 'bad-kind' });
    expect(getInventory().items).toHaveLength(0);
  });
});

describe('breadKind survives the round trips', () => {
  it('mail preserves the kind and the remaining feeds', () => {
    const cleaned = cleanMailItem({
      id: 'm1', type: 'food', breadKind: 'baguette', usesLeft: 2,
    });
    expect(cleaned.breadKind).toBe('baguette');
    expect(cleaned.usesLeft).toBe(2);
  });

  it('home storage preserves the kind and the remaining feeds', () => {
    const out = normalizeHomeItems([
      { id: 'h1', type: 'food', breadKind: 'croissant', usesLeft: 1 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].breadKind).toBe('croissant');
    expect(out[0].usesLeft).toBe(1);
  });

  it('floor items preserve the kind and the remaining feeds', () => {
    const out = normalizeFloorItems([
      { id: 'f1', type: 'food', breadKind: 'roll', usesLeft: 3, x: 100, y: 100 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].breadKind).toBe('roll');
    expect(out[0].usesLeft).toBe(3);
  });

  it('a kindless food item stays kindless (bits of food)', () => {
    const cleaned = cleanMailItem({ id: 'm2', type: 'food', usesLeft: 3 });
    expect(cleaned.breadKind).toBeNull();
  });
});
