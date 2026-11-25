// giftGiver.test.js — Gift Giver v1 (`sq-gift-giver-v1`).
//
//   - Quest def: anywhere quest, 3 gifts, +5 coins on completion
//     (builder default — the user never set the amount).
//   - Badge wiring: the def, BADGE_QUEST_IDS and getBadgeDef all
//     contain 'gift-giver' (the Christmas Lights bug was exactly a
//     def that existed but never rendered).
//   - Counting: mailed gifts count on the send confirm; direct
//     gifts count on the recipient's confirm; 3 → badge + 5 coins
//     once. Declines, expiries and failures count nothing and
//     spend nothing.
//   - The handshake: offer → accept → receipt → confirm moves the
//     item and spends exactly one sheet, only on confirm.
//   - The server's QUEST_DEFS entry ('gift-giver') cannot be
//     unit-imported (server/socket.js starts listening on import),
//     so it is verified by grep at kit verification, not here.
//
// The store reads localStorage lazily, so stubs installed in
// beforeEach are enough. The giver and the recipient get SEPARATE
// stubs in the handshake tests (two browsers in real life) — the
// active stub is swapped per call, since the store reads the
// global stub lazily on every call.

import { describe, it, expect, beforeEach } from 'vitest';
import { getQuest } from '../src/village/quests.js';
import {
  BADGE_QUEST_IDS,
  getBadgeDef,
  isBadgeQuestId,
  badgeListFrom,
} from '../src/village/badges.js';
import { QuestManager } from '../src/village/QuestManager.js';
import { MailSystem } from '../src/village/MailSystem.js';
import { GiftSystem, NO_PAPER_TEXT } from '../src/village/GiftSystem.js';
import {
  ITEM_TYPES,
  buyWrappingPaper,
  hasWrappingPaper,
  wrappingPaperCount,
  getItem,
  addItem,
  _setInventoryForTest,
} from '../src/village/items.js';
import { getCoins } from '../src/village/CoinWallet.js';

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

function capturingScene() {
  const delays = [];
  return {
    scene: {
      roomId: 'agora-houston',
      socket: null,
      time: {
        delayedCall: (ms) => {
          delays.push(ms);
          return { remove() {} };
        },
      },
      cafeCat: { asleep: false },
    },
    delays,
  };
}

// --- the quest def + badge wiring ------------------------------------------

describe('gift giver: quest def and badge wiring', () => {
  it('is an anywhere quest: 3 gifts, +5 coins, 🎁', () => {
    const q = getQuest('gift-giver');
    expect(q).not.toBeNull();
    expect(q.title).toBe('Gift Giver');
    expect(q.roomId).toBe('*');
    expect(q.kind).toBe('solo');
    expect(q.event).toBe('gift-given');
    expect(q.target).toBe(3);
    expect(q.rewardCoins).toBe(5);
    expect(q.emoji).toBe('🎁');
  });

  it('the badge is wired in all three places (the lights-bug shape)', () => {
    expect(BADGE_QUEST_IDS).toContain('gift-giver');
    expect(isBadgeQuestId('gift-giver')).toBe(true);
    const def = getBadgeDef('gift-giver');
    expect(def).not.toBeNull();
    expect(def.id).toBe('gift-giver');
    expect(def.title).toBe('Gift Giver');
    expect(def.emoji).toBe('🎁');
    const list = badgeListFrom({ 'gift-giver': 123 });
    expect(list.map((b) => b.questId)).toContain('gift-giver');
  });
});

// --- counting on the quest loop --------------------------------------------

describe('gift giver: counting', () => {
  it('counts 3 gifts, then completes once with badge + 5 coins', async () => {
    const { scene } = capturingScene();
    const qm = new QuestManager(scene);
    qm.domHud = true;
    qm.recordGlobalEvent('gift-given');
    expect(qm.getHudState().trackerSections.anywhere.join('\n')).toContain('Gift Giver');
    expect(qm.getHudState().trackerSections.anywhere.join('\n')).toContain('1/3');
    qm.recordGlobalEvent('gift-given');
    qm.recordGlobalEvent('gift-given');
    expect(qm.getCompletedIds()).toContain('gift-giver');
    expect(qm.getCompletions().map((b) => b.questId)).toContain('gift-giver');
    // A fourth gift after completion counts nothing and pays nothing.
    qm.recordGlobalEvent('gift-given');
    // Completion pays via a dynamic CoinWallet import — await it.
    await new Promise((r) => setTimeout(r, 50));
    expect(getCoins()).toBe(15); // fresh stub: 10 daily + 5 quest, once
  });

  it('mailed gifts count on the send confirm', () => {
    const events = [];
    const emits = [];
    const scene = {
      roomId: 'agora-houston',
      userId: 'alice@example.com',
      userLocation: { latitude: 29.834, longitude: -95.417 },
      allRooms: [],
      socket: { connected: true, emit: (...args) => emits.push(args) },
      profile: { profile: { email: 'alice@example.com', characterName: 'Alice' } },
      onSystemNotice: () => {},
      questManager: { recordGlobalEvent: (e) => events.push(e) },
    };
    const mail = new MailSystem(scene);
    buyWrappingPaper();
    const note = addItem({ type: 'note', label: 'A note' }).item;
    const res = mail.sendMail(note.id, 'ABCDE');
    expect(res.ok).toBe(true);
    expect(events).toHaveLength(0); // not counted yet — only on confirm
    mail.onSendResult({ packageId: res.packageId, ok: true, recipientName: 'Bob' });
    expect(events).toEqual(['gift-given']);
    expect(getItem(note.id)).toBeNull();
    expect(wrappingPaperCount()).toBe(0);
  });

  it('a refused mail send counts nothing', () => {
    const events = [];
    const scene = {
      roomId: 'agora-houston',
      userId: 'alice@example.com',
      userLocation: { latitude: 29.834, longitude: -95.417 },
      allRooms: [],
      socket: { connected: true, emit: () => {} },
      profile: { profile: { email: 'alice@example.com', characterName: 'Alice' } },
      onSystemNotice: () => {},
      questManager: { recordGlobalEvent: (e) => events.push(e) },
    };
    const mail = new MailSystem(scene);
    buyWrappingPaper();
    const note = addItem({ type: 'note', label: 'A note' }).item;
    const res = mail.sendMail(note.id, 'ABCDE');
    mail.onSendResult({ packageId: res.packageId, ok: false, reason: 'unknown-code' });
    expect(events).toHaveLength(0);
    expect(getItem(note.id)).not.toBeNull();
    expect(wrappingPaperCount()).toBe(1);
  });
});

// --- the direct-give handshake ----------------------------------------------

function makeGiftScene({ emits = [], notices = [], offers = [], questEvents = [] } = {}) {
  return {
    roomId: 'agora-houston',
    userId: 'alice@example.com',
    socket: { connected: true, id: 'socket-alice', emit: (...args) => emits.push(args) },
    profile: { profile: { email: 'alice@example.com', characterName: 'Alice' } },
    onSystemNotice: (msg) => notices.push(msg),
    questManager: { recordGlobalEvent: (e) => questEvents.push(e) },
    onGiftOffer: (offer) => offers.push(offer),
    onGiftOfferGone: () => offers.push(null),
  };
}

describe('gift giver: direct give', () => {
  it('refuses without paper, and nothing is emitted or spent', () => {
    const emits = [];
    const gift = new GiftSystem(makeGiftScene({ emits }));
    const note = addItem({ type: 'note', label: 'A note' }).item;
    const res = gift.offerGift('socket-bob', note.id);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no-paper');
    expect(emits).toHaveLength(0);
    expect(getItem(note.id)).not.toBeNull();
  });

  it('refuses an unsendable item, and refuses giving to yourself', () => {
    const emits = [];
    const gift = new GiftSystem(makeGiftScene({ emits }));
    const piece = addItem({ type: 'puzzle-piece', pieceId: 1 }).item;
    expect(gift.offerGift('socket-bob', piece.id).reason).toBe('not-sendable');
    const note = addItem({ type: 'note', label: 'A note' }).item;
    expect(gift.offerGift('socket-alice', note.id).reason).toBe('self-give');
    expect(emits).toHaveLength(0);
  });

  it('the give picker lists only sendable items', () => {
    // A bag (capacity 10) so every add below lands — the
    // exclusions must be the picker's doing, not a full pocket.
    _setInventoryForTest({ items: [], hasBag: true });
    const gift = new GiftSystem(makeGiftScene());
    addItem({ type: 'note', label: 'A note' });
    addItem({ type: 'puzzle-piece', pieceId: 2 });
    addItem({ type: 'santa-hat' });
    addItem({ type: 'mailbox-key' });
    const listed = gift.getSendableItems().map((it) => it.type);
    expect(listed).toContain('note');
    expect(listed).not.toContain('puzzle-piece');
    expect(listed).not.toContain('santa-hat');
    expect(listed).not.toContain('mailbox-key');
    // Wrapping paper is the supply, not a gift.
    buyWrappingPaper();
    expect(gift.getSendableItems().map((it) => it.type)).not.toContain('wrapping-paper');
  });

  it('offers a wrapped gift; the server answer clears a refused offer', () => {
    const emits = [];
    const notices = [];
    const gift = new GiftSystem(makeGiftScene({ emits, notices }));
    buyWrappingPaper();
    const note = addItem({ type: 'note', label: 'A note' }).item;
    const res = gift.offerGift('socket-bob', note.id);
    expect(res.ok).toBe(true);
    expect(res.pending).toBe(true);
    expect(emits).toHaveLength(1);
    expect(emits[0][0]).toBe('gift_offer');
    expect(emits[0][1].wrapped).toBe(true);
    expect(emits[0][1].toSocketId).toBe('socket-bob');
    expect(gift.isOfferPendingTo('socket-bob')).toBe(true);
    expect(wrappingPaperCount()).toBe(1); // not spent yet — only on confirm
    expect(getItem(note.id)).not.toBeNull(); // still in the pocket
    gift.onOfferResult({ offerId: res.offerId, ok: false, reason: 'not-in-room' });
    expect(gift.isOfferPendingTo('socket-bob')).toBe(false);
    expect(notices.length).toBeGreaterThan(0);
    expect(wrappingPaperCount()).toBe(1);
    expect(getItem(note.id)).not.toBeNull();
  });

  it('a decline moves nothing and spends nothing', () => {
    const emits = [];
    const gift = new GiftSystem(makeGiftScene({ emits }));
    buyWrappingPaper();
    const note = addItem({ type: 'note', label: 'A note' }).item;
    const res = gift.offerGift('socket-bob', note.id);
    gift.onGiftDeclined({ offerId: res.offerId });
    expect(gift.isOfferPendingTo('socket-bob')).toBe(false);
    expect(getItem(note.id)).not.toBeNull();
    expect(wrappingPaperCount()).toBe(1);
  });

  it('an expired offer clears silently — no notice', () => {
    const emits = [];
    const notices = [];
    const gift = new GiftSystem(makeGiftScene({ emits, notices }));
    buyWrappingPaper();
    const note = addItem({ type: 'note', label: 'A note' }).item;
    const res = gift.offerGift('socket-bob', note.id);
    gift.onGiftOfferGone({ offerId: res.offerId });
    expect(gift.isOfferPendingTo('socket-bob')).toBe(false);
    expect(notices).toHaveLength(0);
    expect(getItem(note.id)).not.toBeNull();
    expect(wrappingPaperCount()).toBe(1);
  });

  it('an incoming offer accepts, and a full pocket auto-declines', () => {
    const emits = [];
    const gift = new GiftSystem(makeGiftScene({ emits }));
    gift.onGiftOffered({
      offerId: 'gift-1', fromSocketId: 'socket-alice', fromName: 'Alice',
      item: { type: 'note', label: 'A note', emoji: '📝' },
    });
    expect(gift.getIncomingOffer().fromName).toBe('Alice');
    const res = gift.acceptOffer();
    expect(res.ok).toBe(true);
    expect(emits).toHaveLength(1);
    expect(emits[0][0]).toBe('gift_accept');
    expect(emits[0][1].offerId).toBe('gift-1');

    // Full pocket: the accept auto-declines instead of eating the gift.
    const emits2 = [];
    const gift2 = new GiftSystem(makeGiftScene({ emits: emits2 }));
    addItem({ type: 'trash' });
    addItem({ type: 'note' });
    addItem({ type: 'flyer' });
    gift2.onGiftOffered({
      offerId: 'gift-2', fromSocketId: 'socket-alice', fromName: 'Alice',
      item: { type: 'note', label: 'A note', emoji: '📝' },
    });
    const res2 = gift2.acceptOffer();
    expect(res2.ok).toBe(false);
    expect(res2.reason).toBe('inventory-full');
    expect(emits2[0][0]).toBe('gift_decline');
  });

  it('the full handshake: accept → receipt → confirm moves the gift and spends exactly one sheet', () => {
    // Two browsers: separate localStorage stubs per side.
    const stubGiver = makeLocalStorageStub();
    const stubRecipient = makeLocalStorageStub();

    // Giver side: paper + a note.
    globalThis.localStorage = stubGiver;
    _setInventoryForTest({ items: [], hasBag: false });
    const giverEmits = [];
    const giverNotices = [];
    const giverQuestEvents = [];
    const giver = new GiftSystem(makeGiftScene({
      emits: giverEmits, notices: giverNotices, questEvents: giverQuestEvents,
    }));
    buyWrappingPaper();
    buyWrappingPaper();
    const note = addItem({ type: 'note', label: 'A note' }).item;

    // Recipient side: empty pocket.
    globalThis.localStorage = stubRecipient;
    _setInventoryForTest({ items: [], hasBag: false });
    const recipientEmits = [];
    const recipientOffers = [];
    const recipient = new GiftSystem(makeGiftScene({
      emits: recipientEmits, offers: recipientOffers,
    }));

    // Offer (giver's stub active).
    globalThis.localStorage = stubGiver;
    const res = giver.offerGift('socket-bob', note.id);
    expect(res.ok).toBe(true);
    expect(giverEmits[0][0]).toBe('gift_offer');
    expect(giverEmits[0][1].item.label).toBe('A note');

    // The offer arrives; the recipient accepts (recipient stub active).
    globalThis.localStorage = stubRecipient;
    recipient.onGiftOffered({
      offerId: res.offerId,
      fromSocketId: 'socket-alice',
      fromName: 'Alice',
      item: { type: 'note', label: 'A note', emoji: '📝' },
    });
    expect(recipientOffers).toHaveLength(1);
    expect(recipient.acceptOffer().ok).toBe(true);
    expect(recipientEmits[0][0]).toBe('gift_accept');

    // The server hands the gift over; the recipient pockets it and
    // confirms (recipient stub active).
    recipient.onGiftReceived({
      offerId: res.offerId,
      item: { id: note.id, type: 'note', label: 'A note' },
      fromName: 'Alice',
    });
    expect(recipientEmits[1][0]).toBe('gift_received_confirm');
    expect(getItem(note.id)).not.toBeNull(); // the recipient's copy

    // The giver hears the confirm: the original leaves, one sheet
    // goes, the quest counts (giver stub active).
    globalThis.localStorage = stubGiver;
    giver.onGiftConfirmed({ offerId: res.offerId });
    expect(getItem(note.id)).toBeNull();
    expect(wrappingPaperCount()).toBe(1); // exactly one of two spent
    expect(giverQuestEvents).toEqual(['gift-given']);
    expect(giver.isOfferPendingTo('socket-bob')).toBe(false);

    // A duplicate confirm can never double-spend.
    giver.onGiftConfirmed({ offerId: res.offerId });
    expect(wrappingPaperCount()).toBe(1);
    expect(giverQuestEvents).toEqual(['gift-given']);
  });

  it('a failed receipt keeps everything with the giver', () => {
    const stubGiver = makeLocalStorageStub();
    const stubRecipient = makeLocalStorageStub();

    globalThis.localStorage = stubGiver;
    _setInventoryForTest({ items: [], hasBag: false });
    const giverEmits = [];
    const giverQuestEvents = [];
    const giver = new GiftSystem(makeGiftScene({
      emits: giverEmits, questEvents: giverQuestEvents,
    }));
    buyWrappingPaper();
    const note = addItem({ type: 'note', label: 'A note' }).item;
    const res = giver.offerGift('socket-bob', note.id);

    // Recipient's pocket is full by the time the gift arrives.
    globalThis.localStorage = stubRecipient;
    _setInventoryForTest({ items: [], hasBag: false });
    const recipientEmits = [];
    const recipient = new GiftSystem(makeGiftScene({ emits: recipientEmits }));
    addItem({ type: 'trash' });
    addItem({ type: 'note' });
    addItem({ type: 'flyer' });
    recipient.onGiftOffered({
      offerId: res.offerId, fromSocketId: 'socket-alice', fromName: 'Alice',
      item: { type: 'note', label: 'A note', emoji: '📝' },
    });
    recipient.onGiftReceived({
      offerId: res.offerId,
      item: { id: note.id, type: 'note', label: 'A note' },
      fromName: 'Alice',
    });
    expect(recipientEmits[0][0]).toBe('gift_receive_failed');

    globalThis.localStorage = stubGiver;
    giver.onGiftFailed({ offerId: res.offerId, reason: 'inventory-full' });
    expect(getItem(note.id)).not.toBeNull();
    expect(wrappingPaperCount()).toBe(1);
    expect(giverQuestEvents).toHaveLength(0);
  });

  it('the no-paper refusal uses the mail words', () => {
    expect(NO_PAPER_TEXT).toBe('You need gift wrapping paper to send a gift — buy some at the Agora bar.');
    expect(hasWrappingPaper()).toBe(false);
  });
});
