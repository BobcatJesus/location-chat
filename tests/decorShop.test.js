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

// Decoration Shop v1.1 (`sq-dec-shop-v1-1`): the place flow no longer
// waits forever for a server confirm that may never come. A pending
// place/pickup times out, state is re-requested, and placing is gated
// on the room join being confirmed. The fake scene below stands in
// for VillageScene (socket stub records emits; graphics stubs are
// no-ops). Timers use the _pendingTimeoutMs test seam so the
// timeout paths run in tens of ms instead of the real 5s.
import { DecorSystem, DECOR_PENDING_TIMEOUT_MS } from '../src/village/DecorSystem.js';
import { DEC_SHOP_MARKER_V11 } from '../src/village/decorState.js';
import { removeItem } from '../src/village/items.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFakeGraphics() {
  const noop = () => {};
  return {
    lineStyle: noop, lineBetween: noop, fillStyle: noop, fillRect: noop,
    fillCircle: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    closePath: noop, fillPath: noop,
  };
}

function makeFakeScene({ joined = true, connected = true } = {}) {
  const emitted = [];
  const notices = [];
  const scene = {
    roomId: 'agora-houston',
    userId: 'owner@x.y',
    player: { gx: 800, gy: 450 },
    socket: {
      connected,
      emit: (event, payload) => { emitted.push({ event, payload }); },
    },
    roomLayout: { clampPointToRoom: (x, y) => ({ x, y }) },
    isRoomJoined: () => joined,
    onSystemNotice: (msg) => { notices.push(msg); },
    itemsSystem: {
      confirmPlacedDecoration: (itemId) => {
        const removed = removeItem(itemId);
        return { ok: Boolean(removed), item: removed };
      },
      returnDecorationToPocket: (decor) => addItem({ type: ITEM_TYPES.DECORATION, decorKind: decor.kind }),
    },
    add: {
      graphics: () => makeFakeGraphics(),
      container: (x, y) => ({ x, y, setDepth() {}, setSize() {}, destroy() {} }),
    },
    isModerator: false,
  };
  scene._emitted = emitted;
  scene._notices = notices;
  return scene;
}

function buyTreeForTest() {
  earnCoins(30, 'test');
  const res = buyDecoration('tree');
  expect(res.ok).toBe(true);
  return res.item;
}

// Feed the system a server state containing one decoration with the
// given id (as if the server stored the place and broadcast it).
function serverStateWith(id, kind, addedBy = 'owner@x.y') {
  const serverState = createDecorState();
  placeDecoration(serverState, { id, kind, x: 800, y: 502, addedBy, addedByName: 'Owner' });
  return serializeDecorState(serverState);
}

describe('decoration shop v1.1 marker + timeout', () => {
  it('carries the v1.1 marker and a 5s pending timeout', () => {
    expect(DEC_SHOP_MARKER_V11).toBe('sq-dec-shop-v1-1');
    expect(DECOR_PENDING_TIMEOUT_MS).toBe(5000);
  });

  it('refuses a place before the room join is confirmed — no emit, no stuck pending', () => {
    const scene = makeFakeScene({ joined: false });
    const sys = new DecorSystem(scene);
    const item = buyTreeForTest();
    const res = sys.placeDecoration(item.id);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-joined');
    expect(scene._emitted).toHaveLength(0);
    expect(sys._pendingPlace).toBeNull();
    expect(getItem(item.id)).not.toBeNull();
    sys.destroy();
  });

  it('proceeds when the scene has no isRoomJoined method (old stubs stay working)', () => {
    const scene = makeFakeScene({ joined: true });
    delete scene.isRoomJoined;
    const sys = new DecorSystem(scene);
    const item = buyTreeForTest();
    const res = sys.placeDecoration(item.id);
    expect(res.ok).toBe(true);
    expect(res.pending).toBe(true);
    expect(scene._emitted.some((e) => e.event === 'decor_place')).toBe(true);
    sys.destroy();
  });

  it('times out a place with no server confirm — notice, re-request, item kept, retry works', async () => {
    const scene = makeFakeScene();
    const sys = new DecorSystem(scene);
    sys._pendingTimeoutMs = 40;
    const item = buyTreeForTest();
    const res = sys.placeDecoration(item.id);
    expect(res.ok).toBe(true);
    expect(sys._pendingPlace).not.toBeNull();
    await sleep(90);
    expect(sys._pendingPlace).toBeNull();
    expect(sys._unconfirmedPlace).not.toBeNull();
    expect(sys._unconfirmedPlace.id).toBe(res.id);
    expect(scene._emitted.filter((e) => e.event === 'get_decor')).toHaveLength(1);
    const notice = sys.getPlaceNotice();
    expect(notice.text).toMatch(/didn't answer/);
    expect(notice.seq).toBeGreaterThan(0);
    expect(getItem(item.id)).not.toBeNull();
    // The recheck state says the place never landed — the
    // unconfirmed record clears and a retry works.
    sys.applyState(serializeDecorState(createDecorState()));
    expect(sys._unconfirmedPlace).toBeNull();
    expect(getItem(item.id)).not.toBeNull();
    const retry = sys.placeDecoration(item.id);
    expect(retry.ok).toBe(true);
    expect(retry.id).not.toBe(res.id);
    sys.applyState(serverStateWith(retry.id, 'tree'));
    expect(getItem(item.id)).toBeNull();
    expect(sys.getPlaceNotice().text).toMatch(/Placed!/);
    sys.destroy();
  });

  it('confirms a timed-out place after the fact when the server DID store it', async () => {
    const scene = makeFakeScene();
    const sys = new DecorSystem(scene);
    sys._pendingTimeoutMs = 40;
    const item = buyTreeForTest();
    const res = sys.placeDecoration(item.id);
    await sleep(90);
    expect(sys._unconfirmedPlace).not.toBeNull();
    // The broadcast was only lost: the recheck state has the id.
    sys.applyState(serverStateWith(res.id, 'tree'));
    expect(sys._unconfirmedPlace).toBeNull();
    expect(getItem(item.id)).toBeNull();
    expect(sys.getPlaceNotice().text).toMatch(/Placed!/);
    sys.destroy();
  });

  it('tree end to end: buy → place → confirm → drawn, pocket freed', () => {
    const scene = makeFakeScene();
    const sys = new DecorSystem(scene);
    const item = buyTreeForTest();
    const res = sys.placeDecoration(item.id);
    expect(res.ok).toBe(true);
    sys.applyState(serverStateWith(res.id, 'tree'));
    expect(getItem(item.id)).toBeNull();
    expect(sys.state.decorations).toHaveLength(1);
    expect(sys.state.decorations[0].kind).toBe('tree');
    expect(sys._containers.size).toBe(1);
    expect(sys.getPlaceNotice().text).toMatch(/Placed!/);
    sys.destroy();
  });

  it('all five kinds still place and confirm', () => {
    for (const kind of ['ornament', 'lights', 'snowman', 'tree', 'santa']) {
      const scene = makeFakeScene();
      const sys = new DecorSystem(scene);
      earnCoins(30, 'test');
      const bought = buyDecoration(kind);
      expect(bought.ok).toBe(true);
      const res = sys.placeDecoration(bought.item.id);
      expect(res.ok).toBe(true);
      sys.applyState(serverStateWith(res.id, kind));
      expect(getItem(bought.item.id)).toBeNull();
      expect(sys.state.decorations[0].kind).toBe(kind);
      sys.destroy();
      _setInventoryForTest({ items: [], hasBag: false });
    }
  });

  it('times out a take-back with no confirm — recheck returns it to the pocket when the removal landed', async () => {
    const scene = makeFakeScene();
    const sys = new DecorSystem(scene);
    sys._pendingTimeoutMs = 40;
    const item = buyTreeForTest();
    const placed = sys.placeDecoration(item.id);
    sys.applyState(serverStateWith(placed.id, 'tree'));
    expect(getItem(item.id)).toBeNull();
    const take = sys.pickupDecoration(placed.id);
    expect(take.ok).toBe(true);
    await sleep(90);
    expect(sys._pendingPickup).toBeNull();
    expect(sys._unconfirmedPickup).not.toBeNull();
    expect(scene._emitted.filter((e) => e.event === 'get_decor')).toHaveLength(1);
    // The recheck state no longer has the decoration: the removal
    // landed, only the broadcast was lost — back to the pocket.
    sys.applyState(serializeDecorState(createDecorState()));
    expect(sys._unconfirmedPickup).toBeNull();
    expect(getInventory().items).toHaveLength(1);
    expect(getInventory().items[0].decorKind).toBe('tree');
    sys.destroy();
  });

  it('a timed-out take-back stays placed when the recheck still shows it', async () => {
    const scene = makeFakeScene();
    const sys = new DecorSystem(scene);
    sys._pendingTimeoutMs = 40;
    const item = buyTreeForTest();
    const placed = sys.placeDecoration(item.id);
    sys.applyState(serverStateWith(placed.id, 'tree'));
    sys.pickupDecoration(placed.id);
    await sleep(90);
    expect(sys._unconfirmedPickup).not.toBeNull();
    // Still in the room: the removal never landed.
    sys.applyState(serverStateWith(placed.id, 'tree'));
    expect(sys._unconfirmedPickup).toBeNull();
    expect(sys.state.decorations).toHaveLength(1);
    expect(getInventory().items).toHaveLength(0);
    sys.destroy();
  });

  it('destroy clears pending timers and records', () => {
    const scene = makeFakeScene();
    const sys = new DecorSystem(scene);
    const item = buyTreeForTest();
    sys.placeDecoration(item.id);
    expect(sys._pendingPlace).not.toBeNull();
    expect(sys._placeTimer).not.toBeNull();
    sys.destroy();
    expect(sys._pendingPlace).toBeNull();
    expect(sys._placeTimer).toBeNull();
    expect(sys._unconfirmedPlace).toBeNull();
  });
});
