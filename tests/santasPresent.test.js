// santasPresent.test.js — Santa's Lost Present v1
// (`sq-santas-lost-present-v1`). Quest-level tests with a stubbed
// scene (no Phaser needed — the drawing calls go through a
// chainable `add` stub). 3 clicks at the foot of tree 2, one find
// per player per Chicago day, badge once ever, +5 coins per find.
// The hiding spot is checked against the REAL Agora layout, not
// hardcoded guesses (see presentState.test.js).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SantasPresentSystem,
} from '../src/village/SantasPresentSystem.js';
import {
  PRESENT_HIDE_SPOT,
  PRESENT_REWARD_COINS,
  chicagoDateString,
  createPresentState,
  findPresent,
  serializePresentState,
  loadPaidPresentDates,
} from '../src/village/presentState.js';

// Chainable stand-in for a Phaser GameObject: every draw call used
// by _showReveal returns itself.
function chainable() {
  const o = {};
  for (const m of [
    'fillStyle', 'fillRect', 'lineStyle', 'strokeRect', 'strokeCircle', 'fillCircle',
    'lineBetween', 'setOrigin', 'setPosition', 'setAlpha', 'setDepth', 'setSize',
    'beginPath', 'moveTo', 'lineTo', 'closePath', 'fillPath',
  ]) o[m] = () => o;
  o.destroy = () => {};
  return o;
}

function fakeScene(overrides = {}) {
  const notices = [];
  const emitted = [];
  const banners = [];
  let badgeRecords = 0;
  const scene = {
    roomId: 'agora-houston',
    userId: 'u1',
    socket: { connected: true, emit: (ev, data) => emitted.push([ev, data]) },
    player: { gx: PRESENT_HIDE_SPOT.x, gy: PRESENT_HIDE_SPOT.y },
    onSystemNotice: (m) => notices.push(m),
    questManager: {
      bumpHud() {},
      showToast: (m) => notices.push(m),
      showQuestBannerFor: (b) => banners.push(b),
      recordSantasPresentCompletion: () => { badgeRecords += 1; return true; },
    },
    add: {
      graphics: () => chainable(),
      text: () => chainable(),
      container: () => chainable(),
    },
    ...overrides,
  };
  return { scene, notices, emitted, banners, badgeRecords: () => badgeRecords };
}

function tapThrice(q) {
  q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y);
  q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y);
  return q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y);
}

function serverStateWithFind(userId, dateStr) {
  const s = createPresentState();
  findPresent(s, userId, dateStr);
  return serializePresentState(s, dateStr);
}

describe('tap counting', () => {
  it('1–2 taps count silently, the 3rd sends the find to the server', () => {
    const { scene, emitted } = fakeScene();
    const q = new SantasPresentSystem(scene);
    expect(q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y))
      .toMatchObject({ ok: true, tapped: true, remaining: 2 });
    expect(q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y))
      .toMatchObject({ ok: true, tapped: true, remaining: 1 });
    expect(q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y))
      .toMatchObject({ ok: true, finding: true });
    // The find went out exactly once.
    expect(emitted.filter(([ev]) => ev === 'present_find')).toHaveLength(1);
    expect(emitted).toContainEqual(['present_find', { roomId: 'agora-houston' }]);
    q.destroy();
  });

  it('a click away from the spot does not count', () => {
    const { scene } = fakeScene();
    const q = new SantasPresentSystem(scene);
    expect(q.searchTapAt(PRESENT_HIDE_SPOT.x + 100, PRESENT_HIDE_SPOT.y))
      .toMatchObject({ ok: false, reason: 'no-spot' });
    expect(q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y))
      .toMatchObject({ ok: true, remaining: 2 });
    q.destroy();
  });

  it('a click at the spot from across the room refuses as too-far', () => {
    const { scene } = fakeScene({ player: { gx: 800, gy: 500 } });
    const q = new SantasPresentSystem(scene);
    expect(q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y))
      .toMatchObject({ ok: false, reason: 'too-far' });
    q.destroy();
  });

  it('does nothing outside Agora', () => {
    const { scene } = fakeScene({ roomId: 'shepherd-park' });
    const q = new SantasPresentSystem(scene);
    expect(q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y))
      .toMatchObject({ ok: false, reason: 'not-available' });
    expect(q.getProgress()).toBeNull();
    q.destroy();
  });

  it('offline, the 3rd tap refuses instead of sending a phantom find', () => {
    const { scene, emitted } = fakeScene({ socket: { connected: false, emit: () => {} } });
    const q = new SantasPresentSystem(scene);
    q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y);
    q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y);
    expect(q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y))
      .toMatchObject({ ok: false, reason: 'offline' });
    expect(emitted).toHaveLength(0);
    q.destroy();
  });
});

describe('find confirm — coins, badge, banner, reveal', () => {
  // localStorage does not exist in the node test env; install a
  // tiny stub so the paid-date guard can be observed, and remove
  // it afterwards so no other suite sees it.
  let storage;
  let prevLocalStorage;
  beforeEach(() => {
    const store = {};
    storage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
    prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = storage;
  });
  afterEach(() => {
    if (prevLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLocalStorage;
  });

  function paidDate() {
    return loadPaidPresentDates().shared || '';
  }

  it('the server confirm pays +5 once, records the badge once, shows the banner', () => {
    const today = chicagoDateString(new Date());
    const { scene, notices, banners, badgeRecords } = fakeScene();
    const q = new SantasPresentSystem(scene);
    tapThrice(q);
    q.applyState(serverStateWithFind('u1', today));
    expect(notices).toContain(`🎁 You found Santa's lost present! +${PRESENT_REWARD_COINS} coins.`);
    expect(banners).toHaveLength(1);
    expect(banners[0]).toMatchObject({ id: 'santas-lost-present', emoji: '🎁' });
    expect(badgeRecords()).toBe(1);
    expect(paidDate()).toBe(today);
    // A duplicate broadcast pays nothing and records nothing again.
    q.applyState(serverStateWithFind('u1', today));
    expect(banners).toHaveLength(1);
    expect(badgeRecords()).toBe(1);
    expect(paidDate()).toBe(today);
    q.destroy();
  });

  it('a re-join load that already says I found it today stays silent', () => {
    const today = chicagoDateString(new Date());
    const { scene, notices, banners, badgeRecords } = fakeScene();
    const q = new SantasPresentSystem(scene);
    // No taps, no pending find — just the state arriving (e.g. a
    // re-join after finding it earlier today).
    q.applyState(serverStateWithFind('u1', today));
    expect(notices).toHaveLength(0);
    expect(banners).toHaveLength(0);
    expect(badgeRecords()).toBe(0);
    expect(paidDate()).toBe('');
    expect(q.getProgress()).toMatchObject({ foundToday: true, date: today });
    q.destroy();
  });

  it('someone else finding it toasts once — never on the first load', () => {
    const today = chicagoDateString(new Date());
    const { scene, notices } = fakeScene();
    const q = new SantasPresentSystem(scene);
    // First load: u2 already found it today — stale news, silent.
    q.applyState(serverStateWithFind('u2', today));
    expect(notices).toHaveLength(0);
    // A NEW finder lands while I am here: announced.
    const s = createPresentState();
    findPresent(s, 'u2', today);
    findPresent(s, 'u3', today);
    q.applyState(serializePresentState(s, today));
    expect(notices).toContain("🎁 Someone found Santa's lost present!");
    q.destroy();
  });

  it('a second find the same day is refused, and never emits', () => {
    const today = chicagoDateString(new Date());
    const { scene, emitted } = fakeScene();
    const q = new SantasPresentSystem(scene);
    tapThrice(q);
    q.applyState(serverStateWithFind('u1', today));
    const before = emitted.length;
    // Search again deliberately: taps 1–2 are silent, the 3rd
    // refuses with the reason — the SCENE shows the notice from
    // it (the hat pattern: tap returns carry the reason, the
    // scene owns the notice text).
    q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y);
    q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y);
    expect(q.searchTapAt(PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y))
      .toMatchObject({ ok: false, reason: 'already-found-today' });
    expect(emitted.length).toBe(before);
    q.destroy();
  });

  it('the server refusal backstop clears the pending find', () => {
    const { scene, notices } = fakeScene();
    const q = new SantasPresentSystem(scene);
    tapThrice(q);
    q.onFindResult({ ok: false, reason: 'already-found-today', questId: 'santas-lost-present' });
    expect(notices).toContain("🎁 You already found Santa's present today — it hides again tomorrow!");
    q.destroy();
  });

  it('the next day the same player can find it again — and it pays again', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-12-25T15:00:00Z')); // Dec 25, 09:00 CST
      const day1 = chicagoDateString(new Date());
      expect(day1).toBe('2026-12-25');
      const { scene, emitted } = fakeScene();
      const q = new SantasPresentSystem(scene);
      tapThrice(q);
      q.applyState(serverStateWithFind('u1', day1));
      expect(paidDate()).toBe('2026-12-25');
      // Tomorrow: the present hides again for me.
      vi.setSystemTime(new Date('2026-12-26T15:00:00Z')); // Dec 26, 09:00 CST
      expect(q.getProgress()).toMatchObject({ foundToday: false, date: '2026-12-26' });
      const res = tapThrice(q);
      expect(res).toMatchObject({ ok: true, finding: true });
      expect(emitted.filter(([ev]) => ev === 'present_find')).toHaveLength(2);
      q.applyState(serverStateWithFind('u1', '2026-12-26'));
      expect(paidDate()).toBe('2026-12-26');
      q.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the tracker shows 0/1 before the find and the found state after', () => {
    const today = chicagoDateString(new Date());
    const { scene } = fakeScene();
    const q = new SantasPresentSystem(scene);
    expect(q.getProgress()).toMatchObject({ foundToday: false, date: today });
    tapThrice(q);
    q.applyState(serverStateWithFind('u1', today));
    expect(q.getProgress()).toMatchObject({ foundToday: true, date: today });
    q.destroy();
  });
});
