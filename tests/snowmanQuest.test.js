// snowmanQuest.test.js — Build a Snowman v1 (`sq-build-snowman-v1`).
// Quest-level tests with a stubbed scene (no Phaser needed — the
// drawing calls go through a chainable `add` stub). Multi-add from
// the start: every snowball counts, coins pay per counted add,
// badge once per person. Placement is checked against the REAL
// Shepherd Park layout, not hardcoded guesses.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SnowmanQuest,
} from '../src/village/SnowmanQuest.js';
import {
  SNOW_TOTAL,
  SNOWMAN_POS,
  SNOW_PILE_POS,
  createSnowState,
  addSnowball,
  serializeSnowState,
  loadPaidSnowCounts,
} from '../src/village/snowState.js';
import { buildAutoLayout } from '../src/village/AutoLayout.js';

// Chainable stand-in for a Phaser GameObject: every draw call used
// by _drawPile / _drawSnowman / _updateCarryIndicator returns itself.
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
  const questToasts = [];
  const emitted = [];
  const scene = {
    roomId: 'shepherd-park',
    userId: 'u1',
    socket: { connected: false, emit: (ev, data) => emitted.push([ev, data]) },
    player: { gx: SNOW_PILE_POS.x, gy: SNOW_PILE_POS.y },
    onSystemNotice: (m) => notices.push(m),
    questManager: {
      bumpHud() {},
      showToast: (m) => questToasts.push(m),
      showQuestBannerFor() {},
      recordSnowmanCompletion() {},
    },
    add: {
      graphics: () => chainable(),
      text: () => chainable(),
      container: () => chainable(),
    },
    ...overrides,
  };
  return { scene, notices, questToasts, emitted };
}

describe('take / add ranges', () => {
  it('the pile is in range at 60px, out of range at 150px', () => {
    const { scene } = fakeScene();
    const q = new SnowmanQuest(scene);
    expect(q.nearestPile(SNOW_PILE_POS.x, SNOW_PILE_POS.y + 60)).toBeTruthy();
    expect(q.nearestPile(SNOW_PILE_POS.x, SNOW_PILE_POS.y + 150)).toBeNull();
  });

  it('the pile boundary is 140: in at exactly 140, out at 141', () => {
    const { scene } = fakeScene();
    const q = new SnowmanQuest(scene);
    expect(q.nearestPile(SNOW_PILE_POS.x, SNOW_PILE_POS.y + 140)).toBeTruthy();
    expect(q.nearestPile(SNOW_PILE_POS.x, SNOW_PILE_POS.y + 141)).toBeNull();
  });

  it('the snowman is in range at 60px, out of range at 150px', () => {
    const { scene } = fakeScene();
    const q = new SnowmanQuest(scene);
    expect(q.nearestSnowman(SNOWMAN_POS.x, SNOWMAN_POS.y + 60)).toBeTruthy();
    expect(q.nearestSnowman(SNOWMAN_POS.x, SNOWMAN_POS.y + 150)).toBeNull();
  });

  it('the snowman boundary is 100: in at exactly 100, out at 101', () => {
    const { scene } = fakeScene();
    const q = new SnowmanQuest(scene);
    expect(q.nearestSnowman(SNOWMAN_POS.x, SNOWMAN_POS.y + 100)).toBeTruthy();
    expect(q.nearestSnowman(SNOWMAN_POS.x, SNOWMAN_POS.y + 101)).toBeNull();
  });

  it('a pile click from 150px away refuses as too-far, silently', () => {
    const { scene } = fakeScene({ player: { gx: SNOW_PILE_POS.x, gy: SNOW_PILE_POS.y + 150 } });
    const q = new SnowmanQuest(scene);
    const res = q.pileTapAt(SNOW_PILE_POS.x, SNOW_PILE_POS.y);
    expect(res).toMatchObject({ ok: false, reason: 'too-far' });
    expect(q.carrying).toBe(false);
  });
});

describe('take / add flow', () => {
  it('taking a snowball while already carrying refuses and speaks', () => {
    const { scene, notices } = fakeScene();
    const q = new SnowmanQuest(scene);
    expect(q.takeSnowball()).toMatchObject({ ok: true });
    expect(q.takeSnowball()).toMatchObject({ ok: false, reason: 'already-carrying' });
    expect(notices.join('\n')).toContain('already holding a snowball');
    expect(q.carrying).toBe(true);
  });

  it('adding with empty hands refuses', () => {
    const { scene } = fakeScene();
    const q = new SnowmanQuest(scene);
    expect(q.addSnowball()).toMatchObject({ ok: false, reason: 'no-snowball' });
  });

  it('offline add toasts "(1 of 15)" from the updated local state', () => {
    const { scene, notices } = fakeScene();
    const q = new SnowmanQuest(scene);
    expect(q.takeSnowball()).toMatchObject({ ok: true });
    expect(q.addSnowball()).toMatchObject({ ok: true });
    expect(notices).toContain('⛄ You added a snowball! (1 of 15)');
    expect(q.state.counted).toBe(1);
  });

  it('online add toasts only once the server state lands, with the real total', () => {
    const { scene, notices, emitted } = fakeScene({
      socket: { connected: true, emit: (ev, data) => emitted.push([ev, data]) },
    });
    const q = new SnowmanQuest(scene);
    expect(q.takeSnowball()).toMatchObject({ ok: true });
    expect(q.addSnowball()).toMatchObject({ ok: true, pending: true });
    expect(emitted).toEqual([['snow_add', { roomId: 'shepherd-park' }]]);
    // No toast yet — the count is not known until the server answers.
    expect(notices.join('\n')).not.toContain('You added a snowball!');
    // Server confirms: three counted in the room, I am one of them.
    const s = createSnowState();
    addSnowball(s, 'u1');
    addSnowball(s, 'u2');
    addSnowball(s, 'u3');
    q.applyState(serializeSnowState(s));
    expect(notices).toContain('⛄ You added a snowball! (3 of 15)');
  });

  it('a second add by the same player counts and toasts the new count', () => {
    const { scene, notices } = fakeScene({
      socket: { connected: true, emit: () => {} },
    });
    const q = new SnowmanQuest(scene);
    // I already counted once; the room total is 1.
    const seed = createSnowState();
    addSnowball(seed, 'u1');
    q.applyState(serializeSnowState(seed));
    // Carry a second snowball and add it: it counts too — no
    // one-per-person rule in v1.
    q.carrying = true;
    expect(q.addSnowball()).toMatchObject({ ok: true, pending: true });
    const seed2 = createSnowState();
    addSnowball(seed2, 'u1');
    addSnowball(seed2, 'u1');
    q.applyState(serializeSnowState(seed2));
    expect(notices).toContain('⛄ You added a snowball! (2 of 15)');
  });

  it('no count toast when the add finishes the snowman — the completion toast speaks instead', () => {
    const { scene, notices, questToasts } = fakeScene({
      socket: { connected: true, emit: () => {} },
    });
    const q = new SnowmanQuest(scene);
    const seed = createSnowState();
    addSnowball(seed, 'u1');
    q.applyState(serializeSnowState(seed));
    q.carrying = true;
    expect(q.addSnowball()).toMatchObject({ ok: true, pending: true });
    // 14 more players build the snowman while my extra is pending.
    const done = createSnowState();
    addSnowball(done, 'u1');
    for (let i = 2; i <= 15; i++) addSnowball(done, `user${i}`);
    q.applyState(serializeSnowState(done));
    expect(notices.join('\n')).not.toContain('of 15');
    expect(questToasts).toContain('🎉 A snowman stands in Shepherd Park!');
  });
});

describe('tap flow', () => {
  it('a click on the pile takes a snowball, a click on the snowman adds it', () => {
    const { scene, notices } = fakeScene({ player: { gx: SNOW_PILE_POS.x, gy: SNOW_PILE_POS.y } });
    const q = new SnowmanQuest(scene);
    expect(q.pileTapAt(SNOW_PILE_POS.x, SNOW_PILE_POS.y)).toMatchObject({ ok: true, took: true });
    expect(q.carrying).toBe(true);
    scene.player = { gx: SNOWMAN_POS.x, gy: SNOWMAN_POS.y };
    expect(q.addTapAt(SNOWMAN_POS.x, SNOWMAN_POS.y)).toMatchObject({ ok: true, added: true });
    expect(notices).toContain('⛄ You added a snowball! (1 of 15)');
  });

  it('a click on the snowman head counts — the tap zone is tall, not a square', () => {
    const { scene } = fakeScene({ player: { gx: SNOWMAN_POS.x, gy: SNOWMAN_POS.y } });
    const q = new SnowmanQuest(scene);
    q.carrying = true;
    expect(q.addTapAt(SNOWMAN_POS.x, SNOWMAN_POS.y - 100)).toMatchObject({ ok: true, added: true });
  });

  it('an add click from across the park refuses as too-far', () => {
    const { scene } = fakeScene({ player: { gx: 800, gy: 500 } });
    const q = new SnowmanQuest(scene);
    q.carrying = true;
    const res = q.addTapAt(SNOWMAN_POS.x, SNOWMAN_POS.y);
    expect(res).toMatchObject({ ok: false, reason: 'too-far' });
    expect(q.carrying).toBe(true);
  });
});

describe('per-add payment — each counted add pays exactly once', () => {
  // localStorage does not exist in the node test env; install a
  // tiny stub so the paid-count guard can be observed, and remove
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

  function paidCount() {
    return loadPaidSnowCounts().shared || 0;
  }

  it('pays for each counted add exactly once — a duplicate broadcast pays nothing', () => {
    const { scene } = fakeScene();
    const q = new SnowmanQuest(scene);
    const seed1 = createSnowState();
    addSnowball(seed1, 'u1');
    q.applyState(serializeSnowState(seed1));
    expect(paidCount()).toBe(1);
    // Same state again (a duplicate broadcast): no second payment.
    q.applyState(serializeSnowState(seed1));
    expect(paidCount()).toBe(1);
    // A second counted add lands: pays for exactly that one.
    const seed2 = createSnowState();
    addSnowball(seed2, 'u1');
    addSnowball(seed2, 'u1');
    q.applyState(serializeSnowState(seed2));
    expect(paidCount()).toBe(2);
  });

  it('a refresh pays only the adds that landed while away', () => {
    const { scene } = fakeScene();
    const seed1 = createSnowState();
    addSnowball(seed1, 'u1');
    const q1 = new SnowmanQuest(scene);
    q1.applyState(serializeSnowState(seed1));
    expect(paidCount()).toBe(1);
    // Fresh quest instance, same browser (same stubbed storage):
    // re-applying the same state pays nothing more.
    const q2 = new SnowmanQuest(scene);
    q2.applyState(serializeSnowState(seed1));
    expect(paidCount()).toBe(1);
    // A second add landed while I was away: pays for exactly that one.
    const seed2 = createSnowState();
    addSnowball(seed2, 'u1');
    addSnowball(seed2, 'u1');
    q2.applyState(serializeSnowState(seed2));
    expect(paidCount()).toBe(2);
  });

  it('a room reset (server restart) re-arms payment from zero', () => {
    const { scene } = fakeScene();
    const q = new SnowmanQuest(scene);
    // I was paid for 3 adds in the old room epoch.
    storage.setItem('sidequest-snow-paid-counts', JSON.stringify({ shared: 3 }));
    // The room restarted: I have 1 counted add in the fresh room.
    const seed = createSnowState();
    addSnowball(seed, 'u1');
    q.applyState(serializeSnowState(seed));
    // Paid count resets to 1 — the fresh add pays, the old 3 do not carry over.
    expect(paidCount()).toBe(1);
  });

  it('the badge is recorded once per person on completion', () => {
    let calls = 0;
    const questToasts = [];
    const { scene } = fakeScene({
      socket: { connected: true, emit: () => {} },
      questManager: {
        bumpHud() {},
        showToast: (m) => questToasts.push(m),
        showQuestBannerFor() {},
        recordSnowmanCompletion: () => { calls += 1; },
      },
    });
    const q = new SnowmanQuest(scene);
    const seed = createSnowState();
    addSnowball(seed, 'u1');
    q.applyState(serializeSnowState(seed));
    q.carrying = true;
    expect(q.addSnowball()).toMatchObject({ ok: true, pending: true });
    const done = createSnowState();
    addSnowball(done, 'u1');
    for (let i = 2; i <= 15; i++) addSnowball(done, `user${i}`);
    q.applyState(serializeSnowState(done));
    expect(calls).toBe(1);
    // A repeat of the completed state does not re-record it.
    q.applyState(serializeSnowState(done));
    expect(calls).toBe(1);
  });
});

describe('placement — pile + snowman against the real Shepherd Park layout', () => {
  // The same footprint VillageCanvas resolves for Shepherd Park
  // (SHEPHERD_PARK_FOOTPRINT, by OSM way id 289943234).
  const FOOTPRINT = [
    { lat: 29.8335422, lon: -95.4186888 },
    { lat: 29.8335639, lon: -95.4163778 },
    { lat: 29.8349965, lon: -95.4163985 },
    { lat: 29.8349885, lon: -95.4182790 },
    { lat: 29.8348102, lon: -95.4182811 },
    { lat: 29.8346319, lon: -95.4183171 },
    { lat: 29.8343713, lon: -95.4184029 },
    { lat: 29.8340191, lon: -95.4185923 },
    { lat: 29.8337291, lon: -95.4186845 },
    { lat: 29.8335422, lon: -95.4186888 },
  ];

  function layout() {
    return buildAutoLayout('shepherd-park', 'Shepherd Park', 'park', '', FOOTPRINT, null);
  }

  it('both spots sit inside the room and south of the pond', () => {
    const l = layout();
    expect(l.width).toBe(3600);
    expect(l.height).toBe(2400);
    const pond = l.floors[0].zones.find((z) => z.type === 'pond');
    expect(pond).toBeTruthy();
    for (const spot of [SNOWMAN_POS, SNOW_PILE_POS]) {
      expect(spot.x).toBeGreaterThanOrEqual(80);
      expect(spot.x).toBeLessThanOrEqual(3520);
      expect(spot.y).toBeGreaterThanOrEqual(80);
      expect(spot.y).toBeLessThanOrEqual(2320);
      // South of the pond, with 100px of shoreline to spare.
      expect(spot.y).toBeGreaterThan(pond.y + pond.h + 100);
    }
  });

  it('both spots are clear of the spawn, the entry, and the board', () => {
    const l = layout();
    const spawn = l.spawnF1;
    for (const spot of [SNOWMAN_POS, SNOW_PILE_POS]) {
      expect(Math.hypot(spot.x - spawn.x, spot.y - spawn.y)).toBeGreaterThan(200);
    }
    const entry = l.floors[0].zones.find((z) => z.type === 'entry');
    const board = l.floors[0].zones.find((z) => z.type === 'notice_board');
    for (const spot of [SNOWMAN_POS, SNOW_PILE_POS]) {
      expect(Math.hypot(spot.x - (entry.x + entry.w / 2), spot.y - (entry.y + entry.h / 2))).toBeGreaterThan(300);
      expect(Math.hypot(spot.x - (board.x + board.w / 2), spot.y - (board.y + board.h / 2))).toBeGreaterThan(200);
    }
  });

  it('both spots are clear of every employee patrol path', () => {
    const l = layout();
    const employees = l.floors[0].zones.filter((z) => z.type === 'employee');
    expect(employees).toHaveLength(3);
    for (const spot of [SNOWMAN_POS, SNOW_PILE_POS]) {
      for (const e of employees) {
        for (const [px, py] of e.patrol) {
          expect(Math.hypot(spot.x - px, spot.y - py)).toBeGreaterThan(150);
        }
      }
    }
  });

  it('no tree stands within 100px of either spot', () => {
    const l = layout();
    const trees = l.floors[0].zones.filter((z) => z.type === 'tree');
    expect(trees.length).toBeGreaterThan(0);
    for (const spot of [SNOWMAN_POS, SNOW_PILE_POS]) {
      let nearest = Infinity;
      for (const t of trees) nearest = Math.min(nearest, Math.hypot(spot.x - t.x, spot.y - t.y));
      expect(nearest).toBeGreaterThan(100);
    }
  });
});
