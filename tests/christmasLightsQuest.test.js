// christmasLightsQuest.test.js — Christmas Lights v1.1
// (`sq-christmas-lights-v1.1`): hang range 170 -> 100 (bar front in,
// tables out) and the hang toast carries the real lit count.
// v1.2 (`sq-christmas-multi-v1.2`): every hang counts, coins pay
// per counted hang, badge once per person.
// v1.3 (`sq-christmas-lights-v1.3`): the hang spot is a list — the
// bar wall plus a spot on the strands at each corner of the cafe.
// v1.4 (`sq-christmas-lights-v1.4`): the bulb lights nearest to
// where the player hung it — the hang spot rides with the emit and
// the strands draw state.lit instead of slots[0..counted).
// Quest-level tests with a stubbed scene (no Phaser needed — the
// drawing calls go through a chainable `add` stub).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ChristmasLightsQuest, LIGHTS_HANG_SPOT, LIGHTS_HANG_SPOTS, spotForTap,
} from '../src/village/ChristmasLightsQuest.js';
import {
  createLightState,
  hangLight,
  serializeLightState,
  owedLightHangs,
  loadPaidLightCounts,
} from '../src/village/lightState.js';

// Chainable stand-in for a Phaser GameObject: every draw call used
// by _drawBox / _drawStrands / _updateCarryIndicator returns itself.
function chainable() {
  const o = {};
  for (const m of [
    'fillStyle', 'fillRect', 'lineStyle', 'strokeRect', 'fillCircle',
    'lineBetween', 'setOrigin', 'setPosition', 'setAlpha', 'setDepth', 'setSize',
  ]) o[m] = () => o;
  o.destroy = () => {};
  return o;
}

function fakeScene(overrides = {}) {
  const notices = [];
  const questToasts = [];
  const emitted = [];
  const scene = {
    roomId: 'agora-houston',
    userId: 'u1',
    socket: { connected: false, emit: (ev, data) => emitted.push([ev, data]) },
    player: { gx: 800, gy: 250 },
    onSystemNotice: (m) => notices.push(m),
    questManager: {
      bumpHud() {},
      showToast: (m) => questToasts.push(m),
      showQuestBannerFor() {},
      recordLightsCompletion() {},
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

describe('v1.1 hang range — 100px from the wall spot', () => {
  it('the E-key spot is in range at 60px, out of range at 150px', () => {
    const { scene } = fakeScene();
    const q = new ChristmasLightsQuest(scene);
    // Bar front (~60px from the spot): in range.
    expect(q.nearestHangSpot(LIGHTS_HANG_SPOT.x, LIGHTS_HANG_SPOT.y + 60)).toBeTruthy();
    // Out by the tables (~150px): out of range in v1.1 (was in at 170).
    expect(q.nearestHangSpot(LIGHTS_HANG_SPOT.x, LIGHTS_HANG_SPOT.y + 150)).toBeNull();
  });

  it('the boundary is 100: in at exactly 100, out at 101', () => {
    const { scene } = fakeScene();
    const q = new ChristmasLightsQuest(scene);
    expect(q.nearestHangSpot(LIGHTS_HANG_SPOT.x, LIGHTS_HANG_SPOT.y + 100)).toBeTruthy();
    expect(q.nearestHangSpot(LIGHTS_HANG_SPOT.x, LIGHTS_HANG_SPOT.y + 101)).toBeNull();
  });

  it('a wall click from 150px away refuses as too-far, silently', () => {
    const { scene } = fakeScene({ player: { gx: 800, gy: 340 } });
    const q = new ChristmasLightsQuest(scene);
    q.carrying = true;
    const res = q.hangTapAt(800, 190);
    expect(res).toMatchObject({ ok: false, reason: 'too-far' });
    expect(q.carrying).toBe(true);
  });
});

describe('v1.1 hang toast carries the lit count', () => {
  it('offline hang toasts "(1 of 25 lit)" from the updated local state', () => {
    const { scene, notices } = fakeScene();
    const q = new ChristmasLightsQuest(scene);
    expect(q.takeLight()).toMatchObject({ ok: true });
    expect(q.hangLight()).toMatchObject({ ok: true });
    expect(notices).toContain('💡 You hung a string of lights! (1 of 25 lit)');
  });

  it('online hang toasts only once the server state lands, with the real total', () => {
    const { scene, notices, emitted } = fakeScene({
      socket: { connected: true, emit: (ev, data) => emitted.push([ev, data]) },
    });
    const q = new ChristmasLightsQuest(scene);
    expect(q.takeLight()).toMatchObject({ ok: true });
    expect(q.hangLight()).toMatchObject({ ok: true, pending: true });
    // v1.4 (`sq-christmas-lights-v1.4`): the hang spot rides with
    // the emit — the fake player stands at the bar front (800,
    // 250), so the bar spot (800, 190) goes with it.
    expect(emitted).toEqual([['light_hang', { roomId: 'agora-houston', x: 800, y: 190 }]]);
    // No toast yet — the count is not known until the server answers.
    expect(notices.join('\n')).not.toContain('You hung a string of lights!');
    // Server confirms: three counted in the room, I am one of them.
    const s = createLightState();
    hangLight(s, 'u1');
    hangLight(s, 'u2');
    hangLight(s, 'u3');
    q.applyState(serializeLightState(s));
    expect(notices).toContain('💡 You hung a string of lights! (3 of 25 lit)');
  });

  it('a second hang by the same player toasts the new count (v1.2)', () => {
    const { scene, notices } = fakeScene({
      socket: { connected: true, emit: () => {} },
    });
    const q = new ChristmasLightsQuest(scene);
    // I already counted once; the room total is 1.
    const seed = createLightState();
    hangLight(seed, 'u1');
    q.applyState(serializeLightState(seed));
    // Carry a second string and hang it: it counts too now.
    q.carrying = true;
    expect(q.hangLight()).toMatchObject({ ok: true, pending: true });
    const seed2 = createLightState();
    hangLight(seed2, 'u1');
    hangLight(seed2, 'u1');
    q.applyState(serializeLightState(seed2));
    expect(notices).toContain('💡 You hung a string of lights! (2 of 25 lit)');
  });

  it('no count toast when the hang finishes the room — the completion toast speaks instead', () => {
    const { scene, notices, questToasts } = fakeScene({
      socket: { connected: true, emit: () => {} },
    });
    const q = new ChristmasLightsQuest(scene);
    const seed = createLightState();
    hangLight(seed, 'u1');
    q.applyState(serializeLightState(seed));
    q.carrying = true;
    expect(q.hangLight()).toMatchObject({ ok: true, pending: true });
    // 24 more players light the room while my extra is pending.
    const done = createLightState();
    hangLight(done, 'u1');
    for (let i = 2; i <= 25; i++) hangLight(done, `user${i}`);
    q.applyState(serializeLightState(done));
    expect(notices.join('\n')).not.toContain('of 25 lit');
    expect(questToasts).toContain('🎉 Agora is fully lit for Christmas!');
  });
});

describe('v1.2 multi-hang — repeat takes and per-hang payment', () => {
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
    return loadPaidLightCounts().shared || 0;
  }

  it('the same player can take a second string after hanging one', () => {
    const { scene } = fakeScene();
    const q = new ChristmasLightsQuest(scene);
    const seed = createLightState();
    hangLight(seed, 'u1');
    q.applyState(serializeLightState(seed));
    // No "already hung" refusal any more — the box hands out seconds.
    expect(q.takeLight()).toMatchObject({ ok: true });
    expect(q.carrying).toBe(true);
  });

  it('pays for each counted hang exactly once — a duplicate broadcast pays nothing', () => {
    const { scene } = fakeScene();
    const q = new ChristmasLightsQuest(scene);
    const seed1 = createLightState();
    hangLight(seed1, 'u1');
    q.applyState(serializeLightState(seed1));
    expect(paidCount()).toBe(1);
    // Same state again (a duplicate broadcast): no second payment.
    q.applyState(serializeLightState(seed1));
    expect(paidCount()).toBe(1);
    // A second counted hang lands: pays for exactly that one.
    const seed2 = createLightState();
    hangLight(seed2, 'u1');
    hangLight(seed2, 'u1');
    q.applyState(serializeLightState(seed2));
    expect(paidCount()).toBe(2);
  });

  it('a refresh pays only the hangs that landed while away', () => {
    const { scene } = fakeScene();
    const seed1 = createLightState();
    hangLight(seed1, 'u1');
    const q1 = new ChristmasLightsQuest(scene);
    q1.applyState(serializeLightState(seed1));
    expect(paidCount()).toBe(1);
    // Fresh quest instance, same browser (same stubbed storage):
    // re-applying the same state pays nothing more.
    const q2 = new ChristmasLightsQuest(scene);
    q2.applyState(serializeLightState(seed1));
    expect(paidCount()).toBe(1);
    // A second hang landed while I was away: pays for exactly that one.
    const seed2 = createLightState();
    hangLight(seed2, 'u1');
    hangLight(seed2, 'u1');
    q2.applyState(serializeLightState(seed2));
    expect(paidCount()).toBe(2);
  });

  it('a room reset (server restart) re-arms payment from zero', () => {
    const { scene } = fakeScene();
    const q = new ChristmasLightsQuest(scene);
    // I was paid for 3 hangs in the old room epoch.
    storage.setItem('sidequest-lights-paid-counts', JSON.stringify({ shared: 3 }));
    // The room restarted: I have 1 counted hang in the fresh room.
    const seed = createLightState();
    hangLight(seed, 'u1');
    q.applyState(serializeLightState(seed));
    // Paid count resets to 1 — the fresh hang pays, the old 3 do not carry over.
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
        recordLightsCompletion: () => { calls += 1; },
      },
    });
    const q = new ChristmasLightsQuest(scene);
    const seed = createLightState();
    hangLight(seed, 'u1');
    q.applyState(serializeLightState(seed));
    q.carrying = true;
    expect(q.hangLight()).toMatchObject({ ok: true, pending: true });
    const done = createLightState();
    hangLight(done, 'u1');
    for (let i = 2; i <= 25; i++) hangLight(done, `user${i}`);
    q.applyState(serializeLightState(done));
    expect(calls).toBe(1);
    // A repeat of the completed state does not re-record it.
    q.applyState(serializeLightState(done));
    expect(calls).toBe(1);
  });
});

describe('owedLightHangs — the paid-count diff', () => {
  it('pays the difference, and resets when the room epoch restarted', () => {
    expect(owedLightHangs(0, 0)).toEqual({ owed: 0, newPaid: 0 });
    expect(owedLightHangs(1, 0)).toEqual({ owed: 1, newPaid: 1 });
    expect(owedLightHangs(2, 1)).toEqual({ owed: 1, newPaid: 2 });
    expect(owedLightHangs(5, 5)).toEqual({ owed: 0, newPaid: 5 });
    expect(owedLightHangs(3, undefined)).toEqual({ owed: 3, newPaid: 3 });
    // Counted LOWER than paid means the room state was wiped and
    // started over: the fresh hangs pay in full.
    expect(owedLightHangs(1, 3)).toEqual({ owed: 1, newPaid: 1 });
  });
});

describe('v1.3 multi-spot hangs — the bar wall plus each corner', () => {
  // The spots, in list order: bar, NW, NE, SE, SW.
  const [BAR, NW, NE, SE, SW] = LIGHTS_HANG_SPOTS;

  it('there are five hang spots, the bar first', () => {
    expect(LIGHTS_HANG_SPOTS).toHaveLength(5);
    expect(BAR).toEqual(LIGHTS_HANG_SPOT);
    expect(BAR).toEqual({ x: 800, y: 190 });
  });

  it('nearestHangSpot returns the nearest in-range spot at every corner', () => {
    const { scene } = fakeScene();
    const q = new ChristmasLightsQuest(scene);
    // Standing on each spot: that spot, and only that spot, answers.
    expect(q.nearestHangSpot(NW.x, NW.y)).toEqual({ x: NW.x, y: NW.y });
    expect(q.nearestHangSpot(NE.x, NE.y)).toEqual({ x: NE.x, y: NE.y });
    expect(q.nearestHangSpot(SE.x, SE.y)).toEqual({ x: SE.x, y: SE.y });
    expect(q.nearestHangSpot(SW.x, SW.y)).toEqual({ x: SW.x, y: SW.y });
    // Between two spots the nearer one wins: (300,170) is 80px from
    // NW and 500px from the bar, so NW answers.
    expect(q.nearestHangSpot(300, 170)).toEqual({ x: NW.x, y: NW.y });
    // Mid-room: no spot in range at all.
    expect(q.nearestHangSpot(800, 500)).toBeNull();
  });

  it('out of range at a corner: 150px south of the NW spot answers null', () => {
    const { scene } = fakeScene();
    const q = new ChristmasLightsQuest(scene);
    expect(q.nearestHangSpot(NW.x, NW.y + 150)).toBeNull();
    expect(q.nearestHangSpot(SE.x, SE.y - 150)).toBeNull();
  });

  it('the bar wall spot still works (v1.1 range, unchanged)', () => {
    const { scene } = fakeScene();
    const q = new ChristmasLightsQuest(scene);
    expect(q.nearestHangSpot(BAR.x, BAR.y + 60)).toEqual({ x: BAR.x, y: BAR.y });
    expect(q.nearestHangSpot(BAR.x, BAR.y + 150)).toBeNull();
  });

  it('spotForTap finds the bar rect and each corner tap box', () => {
    expect(spotForTap(800, 190)).toEqual(BAR);
    expect(spotForTap(500, 200)).toEqual(BAR); // anywhere on the bar span
    expect(spotForTap(NW.x, NW.y)).toEqual(NW);
    expect(spotForTap(NE.x, NE.y)).toEqual(NE);
    expect(spotForTap(SE.x, SE.y)).toEqual(SE);
    expect(spotForTap(SW.x, SW.y)).toEqual(SW);
    expect(spotForTap(800, 500)).toBeNull(); // mid-room: no strand here
  });

  it('a click on a corner strand zone hangs, when standing at that corner', () => {
    const { scene, notices } = fakeScene({ player: { gx: NW.x, gy: NW.y } });
    const q = new ChristmasLightsQuest(scene);
    q.carrying = true;
    expect(q.hangTapAt(NW.x, NW.y)).toMatchObject({ ok: true, hung: true });
    expect(notices).toContain('💡 You hung a string of lights! (1 of 25 lit)');
  });

  it('a click on the SE corner strand zone hangs too', () => {
    const { scene } = fakeScene({ player: { gx: SE.x, gy: SE.y } });
    const q = new ChristmasLightsQuest(scene);
    q.carrying = true;
    expect(q.hangTapAt(SE.x, SE.y)).toMatchObject({ ok: true, hung: true });
  });

  it('a corner click from across the room refuses as too-far', () => {
    const { scene } = fakeScene({ player: { gx: 800, gy: 500 } });
    const q = new ChristmasLightsQuest(scene);
    q.carrying = true;
    const res = q.hangTapAt(NW.x, NW.y);
    expect(res).toMatchObject({ ok: false, reason: 'too-far' });
    expect(q.carrying).toBe(true);
  });

  it('a second hang at a different corner counts (multi-hang, v1.2)', () => {
    const { scene } = fakeScene({ player: { gx: NW.x, gy: NW.y } });
    const q = new ChristmasLightsQuest(scene);
    q.carrying = true;
    expect(q.hangTapAt(NW.x, NW.y)).toMatchObject({ ok: true, hung: true });
    // Walk to the NE corner with a second string: it hangs too.
    scene.player = { gx: NE.x, gy: NE.y };
    q.carrying = true;
    expect(q.hangTapAt(NE.x, NE.y)).toMatchObject({ ok: true, hung: true });
    expect(q.state.counted).toBe(2);
  });
});

describe('v1.4 — the bulb lights where the player hung it', () => {
  it('an offline tap-hang at the SE corner lights an east-wall slot, not slot 0', () => {
    const { scene } = fakeScene({ player: { gx: 1420, gy: 690 } });
    const q = new ChristmasLightsQuest(scene);
    q.carrying = true;
    const res = q.hangTapAt(1420, 620);
    expect(res).toMatchObject({ ok: true, hung: true });
    expect(q.state.counted).toBe(1);
    // Nearest slot to the SE spot (1420, 620) is (1490, 613), index 15.
    expect(q.state.lit).toEqual([15]);
  });

  it('the E-key hang at the bar lights a north-wall slot offline', () => {
    const { scene } = fakeScene(); // player at the bar front (800, 250)
    const q = new ChristmasLightsQuest(scene);
    q.carrying = true;
    const res = q.hangLight();
    expect(res).toMatchObject({ ok: true });
    expect(q.state.counted).toBe(1);
    // Nearest slot to the bar spot (800, 190) is (866, 112), index 5.
    expect(q.state.lit).toEqual([5]);
  });

  it('a second hang at a different corner lights a different nearby slot', () => {
    const { scene } = fakeScene();
    const q = new ChristmasLightsQuest(scene);
    q.carrying = true;
    q.hangLight(); // bar -> slot 5
    expect(q.state.lit).toEqual([5]);
    // Walk to the SE corner and tap-hang there.
    scene.player = { gx: 1420, gy: 690 };
    q.carrying = true;
    const res = q.hangTapAt(1420, 620);
    expect(res).toMatchObject({ ok: true, hung: true });
    expect(q.state.counted).toBe(2);
    expect(q.state.lit).toEqual([5, 15]);
  });

  it('the online E-key hang sends the hang spot with the emit', () => {
    const { scene, emitted } = fakeScene({
      player: { gx: 1420, gy: 690 },
      socket: { connected: true, emit: (ev, data) => emitted.push([ev, data]) },
    });
    const q = new ChristmasLightsQuest(scene);
    q.carrying = true;
    const res = q.hangLight();
    expect(res).toMatchObject({ ok: true, pending: true });
    expect(emitted).toHaveLength(1);
    expect(emitted[0][0]).toBe('light_hang');
    expect(emitted[0][1]).toEqual({ roomId: 'agora-houston', x: 1420, y: 620 });
  });

  it('the online tap-hang sends the tapped spot with the emit', () => {
    const { scene, emitted } = fakeScene({
      player: { gx: 220, gy: 240 },
      socket: { connected: true, emit: (ev, data) => emitted.push([ev, data]) },
    });
    const q = new ChristmasLightsQuest(scene);
    q.carrying = true;
    const res = q.hangTapAt(220, 170);
    expect(res).toMatchObject({ ok: true, hung: true });
    expect(emitted[0][1]).toEqual({ roomId: 'agora-houston', x: 220, y: 170 });
  });
});
