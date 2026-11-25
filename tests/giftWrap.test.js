// giftWrap.test.js — Gift Wrapping Paper v1 (`sq-gift-wrap-v1`).
//
//   - Buying: 2 coins a sheet (the user-approved price), stacks in
//     one pocket slot, topping up a stack works with a full pocket.
//   - Sending: refused without paper ('no-paper', nothing spent),
//     one sheet spent only on the server's confirm, the send
//     carries `wrapped: true`, and the received package is marked
//     wrapped (legacy packages repair to unwrapped).
//   - Wrapping paper itself can never be sent.
//   - Round-trips: a stored / dropped stack keeps its sheet count.
//
// The store reads localStorage lazily, so a stub installed in
// beforeEach is enough (no import-time access). getCoins() grants
// the +10 daily bonus on a fresh stub.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ITEM_TYPES,
  WRAPPING_PAPER_PRICE_COINS,
  WRAPPING_PAPER_SHOP,
  buyWrappingPaper,
  spendWrappingSheet,
  hasWrappingPaper,
  wrappingPaperCount,
  wrappingPaperSheets,
  findWrappingPaper,
  getInventory,
  getItem,
  addItem,
  _setInventoryForTest,
} from '../src/village/items.js';
import { earnCoins, getCoins, spendCoins } from '../src/village/CoinWallet.js';
import {
  GIFT_WRAP_MARKER_V1,
  MAIL_UNSENDABLE_TYPES,
  isSendableItemType,
  cleanMailItem,
  cleanPackage,
  sendPackage,
  serializeMailState,
  parseMailState,
  createMailState,
} from '../src/village/mailState.js';
import { MailSystem } from '../src/village/MailSystem.js';
import { DecorSystem } from '../src/village/DecorSystem.js';
import { normalizeHomeItems, normalizeFloorItems } from '../src/village/homeStorage.js';
import { cleanFloorLitterEntry, litterPocketItem } from '../src/village/floorLitterState.js';

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

// --- buying ---------------------------------------------------------------

describe('gift wrapping paper: buying', () => {
  it('carries the v1 marker and costs 2 coins a sheet', () => {
    expect(GIFT_WRAP_MARKER_V1).toBe('sq-gift-wrap-v1');
    expect(WRAPPING_PAPER_PRICE_COINS).toBe(2);
    expect(WRAPPING_PAPER_SHOP.price).toBe(2);
    expect(WRAPPING_PAPER_SHOP.kind).toBe('wrapping-paper');
  });

  it('first sheet costs 2 coins and takes one pocket slot', () => {
    const before = getCoins(); // fresh stub: 10
    const res = buyWrappingPaper();
    expect(res.ok).toBe(true);
    expect(res.price).toBe(2);
    expect(getCoins()).toBe(before - 2);
    expect(getInventory().items).toHaveLength(1);
    expect(wrappingPaperCount()).toBe(1);
    expect(getItem(res.item.id).sheetsLeft).toBe(1);
  });

  it('a second sheet stacks in the same slot', () => {
    buyWrappingPaper();
    const res = buyWrappingPaper();
    expect(res.ok).toBe(true);
    expect(getInventory().items).toHaveLength(1);
    expect(wrappingPaperCount()).toBe(2);
    expect(getCoins()).toBe(10 - 4);
  });

  it('refuses when broke, and the refusal costs nothing', () => {
    expect(spendCoins(9)).toBe(true); // 10 -> 1 coin left
    expect(getCoins()).toBe(1);
    const res = buyWrappingPaper();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-enough-coins');
    expect(getCoins()).toBe(1);
    expect(wrappingPaperCount()).toBe(0);
  });

  it('refuses a first sheet with a full pocket, and the refusal costs nothing', () => {
    addItem({ type: 'trash' });
    addItem({ type: 'note' });
    addItem({ type: 'flyer' });
    expect(getInventory().items).toHaveLength(3);
    const before = getCoins();
    const res = buyWrappingPaper();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('inventory-full');
    expect(getCoins()).toBe(before);
  });

  it('tops up a stack even with a full pocket (no new slot needed)', () => {
    addItem({ type: ITEM_TYPES.WRAPPING_PAPER, sheetsLeft: 2 });
    addItem({ type: 'trash' });
    addItem({ type: 'note' });
    expect(getInventory().items).toHaveLength(3);
    const res = buyWrappingPaper();
    expect(res.ok).toBe(true);
    expect(getInventory().items).toHaveLength(3);
    expect(wrappingPaperCount()).toBe(3);
  });

  it('legacy paper without a sheet count counts as one sheet', () => {
    _setInventoryForTest({ items: [{ id: 'p1', type: 'wrapping-paper' }], hasBag: false });
    expect(wrappingPaperSheets(findWrappingPaper())).toBe(1);
    expect(hasWrappingPaper()).toBe(true);
  });
});

// --- spending a sheet ------------------------------------------------------

describe('gift wrapping paper: spending a sheet', () => {
  it('spends one sheet at a time and removes the stack at zero', () => {
    buyWrappingPaper();
    buyWrappingPaper();
    buyWrappingPaper();
    expect(wrappingPaperCount()).toBe(3);
    let res = spendWrappingSheet();
    expect(res.ok).toBe(true);
    expect(res.sheetsLeft).toBe(2);
    expect(res.removed).toBe(false);
    res = spendWrappingSheet();
    expect(res.sheetsLeft).toBe(1);
    res = spendWrappingSheet();
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(true);
    expect(wrappingPaperCount()).toBe(0);
    expect(getInventory().items).toHaveLength(0);
  });

  it('refuses with no-paper when the pocket holds none', () => {
    const res = spendWrappingSheet();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no-paper');
  });
});

// --- the paper itself can never be sent -------------------------------------

describe('gift wrapping paper: never sendable', () => {
  it('is in the unsendable set and cleanMailItem refuses it', () => {
    expect(MAIL_UNSENDABLE_TYPES.has('wrapping-paper')).toBe(true);
    expect(isSendableItemType('wrapping-paper')).toBe(false);
    expect(cleanMailItem({ id: 'p1', type: 'wrapping-paper' })).toBeNull();
  });
});

// --- the wrapped flag on packages ------------------------------------------

describe('gift wrapping paper: wrapped packages', () => {
  const NOTE = { id: 'n1', type: 'note', label: 'A note' };

  it('cleanPackage keeps wrapped: true', () => {
    const pkg = cleanPackage({
      id: 'm1', fromUserId: 'a@x', fromName: 'Alice',
      item: NOTE, sentAt: 1, wrapped: true,
    });
    expect(pkg.wrapped).toBe(true);
  });

  it('a legacy package without the flag repairs to unwrapped', () => {
    const pkg = cleanPackage({
      id: 'm1', fromUserId: 'a@x', fromName: 'Alice',
      item: NOTE, sentAt: 1,
    });
    expect(pkg.wrapped).toBe(false);
  });

  it('sendPackage stores the flag, serialize keeps it, parse repairs legacy rows', () => {
    const state = createMailState();
    const res = sendPackage(state, {
      id: 'm1', fromUserId: 'a@x', fromName: 'Alice',
      item: NOTE, sentAt: 1, wrapped: true,
    });
    expect(res.ok).toBe(true);
    expect(res.package.wrapped).toBe(true);
    const serial = serializeMailState(state);
    expect(serial.packages[0].wrapped).toBe(true);
    const parsed = parseMailState(serial);
    expect(parsed.packages[0].wrapped).toBe(true);
    const legacy = parseMailState({ packages: [{
      id: 'm2', fromUserId: 'a@x', fromName: 'Alice',
      item: NOTE, sentAt: 1,
    }] });
    expect(legacy.packages[0].wrapped).toBe(false);
  });
});

// --- the shop sells it ------------------------------------------------------

describe('gift wrapping paper: the Agora bar sells it', () => {
  function makeScene(roomId = 'agora-houston') {
    return {
      roomId,
      userId: 'alice@example.com',
      socket: { connected: true, emit: () => {} },
      onSystemNotice: () => {},
    };
  }

  it('getShopState lists one supply at 2 coins', () => {
    const decor = new DecorSystem(makeScene());
    const shop = decor.getShopState();
    expect(shop.supplies).toHaveLength(1);
    expect(shop.supplies[0].kind).toBe('wrapping-paper');
    expect(shop.supplies[0].price).toBe(2);
    expect(shop.hasPaper).toBe(false);
  });

  it('buySupply buys a sheet; a foreign kind is bad-kind', () => {
    const decor = new DecorSystem(makeScene());
    const res = decor.buySupply('wrapping-paper');
    expect(res.ok).toBe(true);
    expect(res.price).toBe(2);
    expect(wrappingPaperCount()).toBe(1);
    expect(decor.buySupply('ornament').reason).toBe('bad-kind');
  });

  it('buySupply outside Agora is not-available', () => {
    const decor = new DecorSystem(makeScene('shepherd-park'));
    expect(decor.buySupply('wrapping-paper').reason).toBe('not-available');
    expect(wrappingPaperCount()).toBe(0);
  });
});

// --- sending through MailSystem ---------------------------------------------

function makeMailScene({ emits = [], notices = [] } = {}) {
  return {
    roomId: 'agora-houston',
    userId: 'alice@example.com',
    userLocation: { latitude: 29.834, longitude: -95.417 },
    allRooms: [],
    socket: { connected: true, emit: (...args) => emits.push(args) },
    profile: { profile: { email: 'alice@example.com', characterName: 'Alice' } },
    onSystemNotice: (msg) => notices.push(msg),
  };
}

describe('gift wrapping paper: sending through MailSystem', () => {
  it('refuses without paper, and nothing is emitted or spent', () => {
    const emits = [];
    const mail = new MailSystem(makeMailScene({ emits }));
    const note = addItem({ type: 'note', label: 'A note' }).item;
    const res = mail.sendMail(note.id, 'ABCDE');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no-paper');
    expect(emits).toHaveLength(0);
    expect(getItem(note.id)).not.toBeNull();
  });

  it('sends wrapped when paper is held, and the confirm spends exactly one sheet', () => {
    const emits = [];
    const mail = new MailSystem(makeMailScene({ emits }));
    buyWrappingPaper();
    buyWrappingPaper();
    buyWrappingPaper();
    const note = addItem({ type: 'note', label: 'A note' }).item;
    const res = mail.sendMail(note.id, 'ABCDE');
    expect(res.ok).toBe(true);
    expect(res.pending).toBe(true);
    expect(emits).toHaveLength(1);
    expect(emits[0][0]).toBe('mail_send');
    expect(emits[0][1].wrapped).toBe(true);
    expect(wrappingPaperCount()).toBe(3); // not spent yet — only on confirm
    mail.onSendResult({ packageId: res.packageId, ok: true, recipientName: 'Bob' });
    expect(getItem(note.id)).toBeNull(); // the gift left the pocket
    expect(wrappingPaperCount()).toBe(2); // exactly one sheet spent
  });

  it('a refused send keeps both the gift and the paper', () => {
    const emits = [];
    const mail = new MailSystem(makeMailScene({ emits }));
    buyWrappingPaper();
    const note = addItem({ type: 'note', label: 'A note' }).item;
    const res = mail.sendMail(note.id, 'ABCDE');
    expect(res.ok).toBe(true);
    mail.onSendResult({ packageId: res.packageId, ok: false, reason: 'unknown-code' });
    expect(getItem(note.id)).not.toBeNull();
    expect(wrappingPaperCount()).toBe(1);
  });

  it('collecting a wrapped package says it was a wrapped gift', () => {
    const emits = [];
    const notices = [];
    const mail = new MailSystem(makeMailScene({ emits, notices }));
    mail.state = parseMailState({ packages: [{
      id: 'p1', fromUserId: 'bob@example.com', fromName: 'Bob',
      item: { id: 'i1', type: 'note', label: 'A note' }, sentAt: 1, wrapped: true,
    }] });
    const res = mail.collectPackage('p1');
    expect(res.ok).toBe(true);
    mail.onCollectResult({ packageId: 'p1', ok: true, item: { id: 'i1', type: 'note', label: 'A note' } });
    expect(getItem('i1')).not.toBeNull();
    expect(notices.some((n) => n.includes('wrapped gift'))).toBe(true);
  });
});

// --- round-trips: a stack survives storage and drops ------------------------

describe('gift wrapping paper: round-trips', () => {
  it('home storage keeps the sheet count', () => {
    const stored = normalizeHomeItems([
      { id: 'p1', type: 'wrapping-paper', sheetsLeft: 4 },
    ]);
    expect(stored).toHaveLength(1);
    expect(stored[0].sheetsLeft).toBe(4);
    const floored = normalizeFloorItems([
      { id: 'p1', type: 'wrapping-paper', sheetsLeft: 4, x: 10, y: 10 },
    ]);
    expect(floored).toHaveLength(1);
    expect(floored[0].sheetsLeft).toBe(4);
  });

  it('a dropped stack comes back with its sheets', () => {
    const entry = cleanFloorLitterEntry({
      id: 'l1', type: 'wrapping-paper', sheetsLeft: 3, x: 100, y: 100,
    });
    expect(entry.sheetsLeft).toBe(3);
    const pocket = litterPocketItem(entry);
    expect(pocket.sheetsLeft).toBe(3);
    const added = addItem(pocket);
    expect(added.ok).toBe(true);
    expect(wrappingPaperCount()).toBe(3);
  });
});
