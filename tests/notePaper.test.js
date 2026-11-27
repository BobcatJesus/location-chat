// notePaper.test.js — Pick-Up Notes v1.1 (`sq-pickup-notes-v1.1`).
//
//   - Buying: 2 coins for a pack of 3 sheets (the user-set price /
//     bundle), stacks in one pocket slot, topping up a stack works
//     with a full pocket.
//   - Leaving a note: refused without paper ('no-note-paper',
//     nothing emitted or spent), one sheet spent only on the
//     server's confirm (direct answer or broadcast), never on a
//     refusal or a timeout; a second drop while one is pending is
//     refused ('already-pending') so one landed note can never
//     cost less than one sheet.
//   - Note paper itself can never be sent by mail.
//   - Round-trips: a stored / dropped stack keeps its sheet count.
//
// The store reads localStorage lazily, so a stub installed in
// beforeEach is enough (no import-time access). getCoins() grants
// the +10 daily bonus on a fresh stub.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ITEM_TYPES,
  NOTE_PAPER_PRICE_COINS,
  NOTE_PAPER_SHEETS_PER_PACK,
  NOTE_PAPER_SHOP,
  NOTE_PAPER_MARKER_V1_1,
  buyNotePaper,
  spendNotePaperSheet,
  hasNotePaper,
  notePaperCount,
  notePaperSheets,
  findNotePaper,
  getInventory,
  getItem,
  addItem,
  _setInventoryForTest,
} from '../src/village/items.js';
import { earnCoins, getCoins, spendCoins } from '../src/village/CoinWallet.js';
import {
  MAIL_UNSENDABLE_TYPES,
  isSendableItemType,
  cleanMailItem,
} from '../src/village/mailState.js';
import { DecorSystem } from '../src/village/DecorSystem.js';
import { NoteSystem } from '../src/village/NoteSystem.js';
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- buying ---------------------------------------------------------------

describe('note paper: buying a pack', () => {
  it('carries the v1.1 marker and costs 2 coins for 3 sheets', () => {
    expect(NOTE_PAPER_MARKER_V1_1).toBe('sq-pickup-notes-v1.1');
    expect(NOTE_PAPER_PRICE_COINS).toBe(2);
    expect(NOTE_PAPER_SHEETS_PER_PACK).toBe(3);
    expect(NOTE_PAPER_SHOP.price).toBe(2);
    expect(NOTE_PAPER_SHOP.kind).toBe('note-paper');
  });

  it('first pack costs 2 coins, adds 3 sheets, takes one pocket slot', () => {
    const before = getCoins(); // fresh stub: 10
    const res = buyNotePaper();
    expect(res.ok).toBe(true);
    expect(res.price).toBe(2);
    expect(getCoins()).toBe(before - 2);
    expect(getInventory().items).toHaveLength(1);
    expect(notePaperCount()).toBe(3);
    expect(getItem(res.item.id).sheetsLeft).toBe(3);
  });

  it('a second pack stacks in the same slot (+3)', () => {
    buyNotePaper();
    const res = buyNotePaper();
    expect(res.ok).toBe(true);
    expect(getInventory().items).toHaveLength(1);
    expect(notePaperCount()).toBe(6);
    expect(getCoins()).toBe(10 - 4);
  });

  it('refuses when broke, and the refusal costs nothing', () => {
    expect(spendCoins(9)).toBe(true); // 10 -> 1 coin left
    expect(getCoins()).toBe(1);
    const res = buyNotePaper();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-enough-coins');
    expect(getCoins()).toBe(1);
    expect(notePaperCount()).toBe(0);
  });

  it('refuses a first pack with a full pocket, and the refusal costs nothing', () => {
    addItem({ type: 'trash' });
    addItem({ type: 'note' });
    addItem({ type: 'flyer' });
    expect(getInventory().items).toHaveLength(3);
    const before = getCoins();
    const res = buyNotePaper();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('inventory-full');
    expect(getCoins()).toBe(before);
  });

  it('tops up a stack even with a full pocket (no new slot needed)', () => {
    addItem({ type: ITEM_TYPES.NOTE_PAPER, sheetsLeft: 2 });
    addItem({ type: 'trash' });
    addItem({ type: 'note' });
    expect(getInventory().items).toHaveLength(3);
    const res = buyNotePaper();
    expect(res.ok).toBe(true);
    expect(getInventory().items).toHaveLength(3);
    expect(notePaperCount()).toBe(5);
  });

  it('legacy paper without a sheet count counts as one sheet', () => {
    _setInventoryForTest({ items: [{ id: 'p1', type: 'note-paper' }], hasBag: false });
    expect(notePaperSheets(findNotePaper())).toBe(1);
    expect(hasNotePaper()).toBe(true);
  });
});

// --- spending a sheet ------------------------------------------------------

describe('note paper: spending a sheet', () => {
  it('spends one sheet at a time and removes the stack at zero', () => {
    buyNotePaper();
    expect(notePaperCount()).toBe(3);
    let res = spendNotePaperSheet();
    expect(res.ok).toBe(true);
    expect(res.sheetsLeft).toBe(2);
    expect(res.removed).toBe(false);
    res = spendNotePaperSheet();
    expect(res.sheetsLeft).toBe(1);
    res = spendNotePaperSheet();
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(true);
    expect(notePaperCount()).toBe(0);
    expect(getInventory().items).toHaveLength(0);
  });

  it('refuses with no-note-paper when the pocket holds none', () => {
    const res = spendNotePaperSheet();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no-note-paper');
  });
});

// --- the paper itself can never be sent -------------------------------------

describe('note paper: never sendable', () => {
  it('is in the unsendable set and cleanMailItem refuses it', () => {
    expect(MAIL_UNSENDABLE_TYPES.has('note-paper')).toBe(true);
    expect(isSendableItemType('note-paper')).toBe(false);
    expect(cleanMailItem({ id: 'p1', type: 'note-paper' })).toBeNull();
  });
});

// --- the shop sells it ------------------------------------------------------

describe('note paper: the Agora bar sells it', () => {
  function makeScene(roomId = 'agora-houston') {
    return {
      roomId,
      userId: 'alice@example.com',
      socket: { connected: true, emit: () => {} },
      onSystemNotice: () => {},
    };
  }

  it('getShopState lists two supplies, note paper at 2 coins', () => {
    const decor = new DecorSystem(makeScene());
    const shop = decor.getShopState();
    expect(shop.supplies).toHaveLength(2);
    const paper = shop.supplies.find((s) => s.kind === 'note-paper');
    expect(paper).toBeTruthy();
    expect(paper.price).toBe(2);
    expect(shop.hasNotePaper).toBe(false);
    expect(shop.notePaperSheets).toBe(0);
  });

  it('buySupply buys a pack of 3; a foreign kind is bad-kind', () => {
    const decor = new DecorSystem(makeScene());
    const res = decor.buySupply('note-paper');
    expect(res.ok).toBe(true);
    expect(res.price).toBe(2);
    expect(notePaperCount()).toBe(3);
    expect(decor.buySupply('ornament').reason).toBe('bad-kind');
  });

  it('buySupply outside Agora is not-available', () => {
    const decor = new DecorSystem(makeScene('shepherd-park'));
    expect(decor.buySupply('note-paper').reason).toBe('not-available');
    expect(notePaperCount()).toBe(0);
  });
});

// --- leaving a note through NoteSystem ---------------------------------------

function makeNoteScene({ emits = [], notices = [] } = {}) {
  return {
    roomId: 'agora-houston',
    userId: 'alice@example.com',
    socket: { connected: true, emit: (...args) => emits.push(args) },
    player: { gx: 100, gy: 100 },
    onSystemNotice: (msg) => notices.push(msg),
  };
}

describe('note paper: leaving a note through NoteSystem', () => {
  it('refuses without paper, and nothing is emitted or spent', () => {
    const emits = [];
    const notes = new NoteSystem(makeNoteScene({ emits }));
    const res = notes.dropNote('hello there');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no-note-paper');
    expect(emits).toHaveLength(0);
    expect(notePaperCount()).toBe(0);
  });

  it('drops with paper held, and the confirm spends exactly one sheet', () => {
    const emits = [];
    const notes = new NoteSystem(makeNoteScene({ emits }));
    buyNotePaper();
    expect(notePaperCount()).toBe(3);
    const res = notes.dropNote('hello there');
    expect(res.ok).toBe(true);
    expect(res.pending).toBe(true);
    expect(emits).toHaveLength(1);
    expect(emits[0][0]).toBe('note_drop');
    expect(notePaperCount()).toBe(3); // not spent yet — only on confirm
    notes.onDropResult({ id: res.id, ok: true });
    expect(notePaperCount()).toBe(2); // exactly one sheet spent
  });

  it('a refused drop keeps the paper', () => {
    const emits = [];
    const notes = new NoteSystem(makeNoteScene({ emits }));
    buyNotePaper();
    const res = notes.dropNote('hello there');
    expect(res.ok).toBe(true);
    notes.onDropResult({ id: res.id, ok: false, reason: 'rate-limited' });
    expect(notePaperCount()).toBe(3);
  });

  it('a broadcast confirm settles and spends exactly one sheet', () => {
    const emits = [];
    const notes = new NoteSystem(makeNoteScene({ emits }));
    buyNotePaper();
    const res = notes.dropNote('hello there');
    expect(res.ok).toBe(true);
    notes.applyState({
      notes: [{ id: res.id, text: 'hello there', x: 100, y: 100, createdAt: Date.now() }],
      now: Date.now(),
    });
    expect(notePaperCount()).toBe(2);
  });

  it('a second drop while one is pending is refused, nothing emitted', () => {
    const emits = [];
    const notes = new NoteSystem(makeNoteScene({ emits }));
    buyNotePaper();
    const first = notes.dropNote('first note');
    expect(first.ok).toBe(true);
    const second = notes.dropNote('second note');
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('already-pending');
    expect(emits).toHaveLength(1);
    expect(notePaperCount()).toBe(3);
    // Settle the first drop so its timer does not outlive the test.
    notes.onDropResult({ id: first.id, ok: true });
    expect(notePaperCount()).toBe(2);
  });

  it('a timed-out drop that later lands via broadcast still spends exactly one sheet', async () => {
    const emits = [];
    const notes = new NoteSystem(makeNoteScene({ emits }));
    notes._pendingTimeoutMs = 10;
    buyNotePaper();
    const res = notes.dropNote('hello there');
    expect(res.ok).toBe(true);
    await sleep(40);
    expect(emits.some((e) => e[0] === 'get_notes')).toBe(true);
    expect(notePaperCount()).toBe(3); // timeout spends nothing
    notes.applyState({
      notes: [{ id: res.id, text: 'hello there', x: 100, y: 100, createdAt: Date.now() }],
      now: Date.now(),
    });
    expect(notePaperCount()).toBe(2); // the late landing spends one
  });
});

// --- round-trips: a stack survives storage and drops ------------------------

describe('note paper: round-trips', () => {
  it('home storage keeps the sheet count', () => {
    const stored = normalizeHomeItems([
      { id: 'p1', type: 'note-paper', sheetsLeft: 4 },
    ]);
    expect(stored).toHaveLength(1);
    expect(stored[0].sheetsLeft).toBe(4);
    const floored = normalizeFloorItems([
      { id: 'p1', type: 'note-paper', sheetsLeft: 4, x: 10, y: 10 },
    ]);
    expect(floored).toHaveLength(1);
    expect(floored[0].sheetsLeft).toBe(4);
  });

  it('a dropped stack comes back with its sheets', () => {
    const entry = cleanFloorLitterEntry({
      id: 'l1', type: 'note-paper', sheetsLeft: 3, x: 100, y: 100,
    });
    expect(entry.sheetsLeft).toBe(3);
    const pocket = litterPocketItem(entry);
    expect(pocket.sheetsLeft).toBe(3);
    const added = addItem(pocket);
    expect(added.ok).toBe(true);
    expect(notePaperCount()).toBe(3);
  });
});
