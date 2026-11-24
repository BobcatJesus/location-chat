// hunger.test.js — Hunger System v1 (`sq-hunger-v1`).
//
// Hungry by default; any food feeds you — one bite per charge,
// one bite leaves you still hungry ("Still hungry... eat more."),
// three bites fill you for 8 hours ("😋 Ahhh... full for most of
// the day."). Bites accumulate across different foods while
// hungry, and reset when hunger returns after the 8 hours expire.
// The "you're hungry..." notification fires once per spell — on
// entering the app, and again when the 8 fed hours wear off —
// never nagging while the state persists. No penalty for being
// hungry: this is a nudge, like the Temperature System.
//
// The queasy gag: trash food (litter / pond bits, never a bought
// bread) still counts as a bite and works fine, but it also shows
// a 🤢 marker above the head plus a "you feel a tiny bit queasy"
// line for about 1 minute — cosmetic only, no effect, no cure.
//
// These tests cover the pure module (the bite math, the 8-hour
// duration, the toast-once-per-spell machine, the localStorage
// round trip) plus the Phaser-side system against a stub scene
// (no Phaser import — the system only calls scene methods). The
// scene wiring (pocket Eat button, Eat path) is verified by the
// Vite build + code read: VillageScene imports Phaser, which
// touches the DOM at import time and cannot run in vitest.

import { describe, expect, it, beforeEach } from 'vitest';
import {
  HUNGER_MARKER_V1,
  HUNGER_FED_MS,
  HUNGER_BITES_TO_FULL,
  QUEASY_MS,
  HUNGER_TOAST,
  STILL_HUNGRY_TOAST,
  FULL_TOAST,
  ALREADY_FULL_TOAST,
  QUEASY_TOAST,
  HUNGER_BUBBLE_TEXT,
  HUNGER_STORAGE_KEY,
  createHungerState,
  isHungry,
  refreshHunger,
  takeBite,
  loadHungerState,
  saveHungerState,
  _clearHungerMemoryForTest,
} from '../src/village/hunger.js';
import { HungerSystem } from '../src/village/HungerSystem.js';

const NOW = Date.UTC(2026, 10, 23, 18, 0); // 12:00 Chicago, Nov 23

describe('constants', () => {
  it('has the kit marker and the decided values', () => {
    expect(HUNGER_MARKER_V1).toBe('sq-hunger-v1');
    expect(HUNGER_FED_MS).toBe(8 * 60 * 60 * 1000);
    expect(HUNGER_BITES_TO_FULL).toBe(3);
    expect(QUEASY_MS).toBe(60 * 1000);
    expect(HUNGER_TOAST).toBe("you're hungry...");
    expect(STILL_HUNGRY_TOAST).toBe('Still hungry... eat more.');
    expect(FULL_TOAST).toBe('😋 Ahhh... full for most of the day.');
    expect(ALREADY_FULL_TOAST).toBe("You're already full.");
    expect(QUEASY_TOAST).toBe('🤢 You feel a tiny bit queasy.');
    expect(HUNGER_BUBBLE_TEXT).toBe('hungry...');
  });
});

describe('isHungry', () => {
  it('is hungry by default, full after three bites, hungry again when the 8 hours expire', () => {
    expect(isHungry(createHungerState(), { now: NOW })).toBe(true);
    let state = createHungerState();
    state = takeBite(state, { now: NOW }).state;
    state = takeBite(state, { now: NOW }).state;
    state = takeBite(state, { now: NOW }).state;
    expect(isHungry(state, { now: NOW + HUNGER_FED_MS - 1 })).toBe(false);
    expect(isHungry(state, { now: NOW + HUNGER_FED_MS })).toBe(true);
  });
});

describe('takeBite — one bite per charge, three bites to full', () => {
  it('counts bites up, and the third bite fills you for exactly 8 hours', () => {
    const first = takeBite(createHungerState(), { now: NOW });
    expect(first).toMatchObject({ applied: true, full: false, bites: 1 });
    const second = takeBite(first.state, { now: NOW });
    expect(second).toMatchObject({ applied: true, full: false, bites: 2 });
    const third = takeBite(second.state, { now: NOW });
    expect(third).toMatchObject({ applied: true, full: true, bites: 0 });
    expect(third.state.fedUntil).toBe(NOW + HUNGER_FED_MS);
    // Full until the 8 hours are up…
    expect(isHungry(third.state, { now: NOW + HUNGER_FED_MS - 1 })).toBe(false);
    // …then hunger returns, with the bite count reset.
    expect(isHungry(third.state, { now: NOW + HUNGER_FED_MS })).toBe(true);
    expect(third.state.bites).toBe(0);
  });

  it('a bite while already full does not land — the caller must not spend a charge for it', () => {
    let state = createHungerState();
    for (let i = 0; i < 3; i++) state = takeBite(state, { now: NOW }).state;
    const extra = takeBite(state, { now: NOW });
    expect(extra).toMatchObject({ applied: false, full: false, reason: 'already-full' });
    expect(extra.state.fedUntil).toBe(NOW + HUNGER_FED_MS);
  });

  it('bites accumulate across foods — the counter is the spell, not the item', () => {
    // One bite, then a long pause (still hungry), then two more:
    // the first bite still counts toward the same full.
    let state = takeBite(createHungerState(), { now: NOW }).state;
    expect(state.bites).toBe(1);
    state = takeBite(state, { now: NOW + 60 * 60 * 1000 }).state;
    expect(state.bites).toBe(2);
    const third = takeBite(state, { now: NOW + 2 * 60 * 60 * 1000 });
    expect(third.full).toBe(true);
  });
});

describe('refreshHunger — toast once per spell', () => {
  it('toasts exactly once per hunger spell', () => {
    const first = refreshHunger(createHungerState(), { now: NOW });
    expect(first.hungry).toBe(true);
    expect(first.toast).toBe(HUNGER_TOAST);
    expect(first.state.notifiedSpell).toBe('hungry');
    // Same spell, still hungry: no nagging.
    const second = refreshHunger(first.state, { now: NOW + 5000 });
    expect(second.toast).toBeNull();
    expect(second.hungry).toBe(true);
  });

  it('stays quiet while full, and toasts again when the 8 hours wear off', () => {
    let state = createHungerState();
    const spell = refreshHunger(state, { now: NOW });
    expect(spell.toast).toBe(HUNGER_TOAST);
    state = spell.state;
    for (let i = 0; i < 3; i++) state = takeBite(state, { now: NOW }).state;
    const full = refreshHunger(state, { now: NOW + 1000 });
    expect(full.toast).toBeNull();
    expect(full.hungry).toBe(false);
    expect(full.state.notifiedSpell).toBeNull();
    const wornOff = refreshHunger(full.state, { now: NOW + HUNGER_FED_MS + 1000 });
    expect(wornOff.hungry).toBe(true);
    expect(wornOff.toast).toBe(HUNGER_TOAST);
  });
});

describe('persistence', () => {
  const memStorage = () => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
    };
  };

  it('round-trips the fed timer and the bite count through storage', () => {
    const storage = memStorage();
    const state = { fedUntil: 123456789, bites: 2, notifiedSpell: 'hungry' };
    saveHungerState(state, storage);
    const loaded = loadHungerState(storage);
    expect(loaded.fedUntil).toBe(123456789);
    expect(loaded.bites).toBe(2);
    // notifiedSpell is session-only — it does not survive a reload.
    expect(loaded.notifiedSpell).toBeNull();
  });

  it('loads as hungry when the record is missing or garbage', () => {
    const storage = memStorage();
    expect(loadHungerState(storage)).toEqual(createHungerState());
    storage.setItem(HUNGER_STORAGE_KEY, 'not json at all');
    expect(loadHungerState(storage)).toEqual(createHungerState());
    storage.setItem(HUNGER_STORAGE_KEY, JSON.stringify({ fedUntil: 'soon', bites: 9 }));
    const loaded = loadHungerState(storage);
    expect(loaded.fedUntil).toBe(0);
    expect(loaded.bites).toBe(0);
  });
});

describe('HungerSystem (stub scene)', () => {
  // The system only calls scene methods — no Phaser import, so a
  // stub scene is enough.
  function makeScene() {
    const notices = [];
    const makeText = () => ({
      alpha: 0, x: 0, y: 0,
      setOrigin() { return this; },
      setDepth() { return this; },
      setAlpha(a) { this.alpha = a; return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      destroy() { this.destroyed = true; },
    });
    const bubble = makeText();
    const queasy = makeText();
    let textCalls = 0;
    const scene = {
      player: { gx: 100, gy: 200, avatar: { x: 100 } },
      onSystemNotice: (msg) => { notices.push(msg); },
      // _ensureVisuals creates the bubble first, then the 🤢
      // marker — the first text call is the bubble, the second
      // is the queasy marker.
      add: { text: () => (textCalls++ === 0 ? bubble : queasy) },
      _notices: notices,
      _bubble: bubble,
      _queasy: queasy,
    };
    return scene;
  }

  beforeEach(() => { _clearHungerMemoryForTest(); });

  it('has the kit marker and toasts once on refresh', () => {
    const scene = makeScene();
    const sys = new HungerSystem(scene);
    expect(sys.marker).toBe('sq-hunger-v1');
    expect(sys.isHungry()).toBe(true);
    sys.refresh();
    expect(scene._notices).toEqual([HUNGER_TOAST]);
    sys.refresh();
    expect(scene._notices).toHaveLength(1);
    sys.destroy();
  });

  it('eating three bites of clean food fills you, with the right notice each time', () => {
    const scene = makeScene();
    const sys = new HungerSystem(scene);
    const first = sys.eatBite(false);
    expect(first).toMatchObject({ applied: true, full: false, bites: 1 });
    expect(first.notice).toBe(STILL_HUNGRY_TOAST);
    const second = sys.eatBite(false);
    expect(second).toMatchObject({ applied: true, full: false, bites: 2 });
    expect(second.notice).toBe(STILL_HUNGRY_TOAST);
    const third = sys.eatBite(false);
    expect(third).toMatchObject({ applied: true, full: true, bites: 0 });
    expect(third.notice).toBe(FULL_TOAST);
    expect(sys.isHungry()).toBe(false);
    // Clean food never makes you queasy.
    expect(sys.queasyUntil).toBe(0);
    expect(scene._queasy.alpha).toBe(0);
    sys.destroy();
  });

  it('a bite while already full does not land and says so', () => {
    const scene = makeScene();
    const sys = new HungerSystem(scene);
    sys.eatBite(false);
    sys.eatBite(false);
    sys.eatBite(false);
    const extra = sys.eatBite(false);
    expect(extra.applied).toBe(false);
    expect(extra.notice).toBe(ALREADY_FULL_TOAST);
    expect(sys.isHungry()).toBe(false);
    sys.destroy();
  });

  it('trash food still counts as a bite, and adds the queasy line + marker for about a minute', () => {
    const scene = makeScene();
    const sys = new HungerSystem(scene);
    const before = Date.now();
    const bite = sys.eatBite(true);
    expect(bite).toMatchObject({ applied: true, full: false, bites: 1 });
    expect(bite.notice).toBe(`${STILL_HUNGRY_TOAST} ${QUEASY_TOAST}`);
    expect(sys.queasyUntil).toBeGreaterThanOrEqual(before + QUEASY_MS);
    expect(sys.queasyUntil).toBeLessThanOrEqual(Date.now() + QUEASY_MS);
    // The 🤢 marker shows right away…
    sys.update();
    expect(scene._queasy.alpha).toBe(1);
    expect(scene._queasy.x).toBe(100 + 44);
    expect(Math.abs(scene._queasy.y - (200 - 72))).toBeLessThanOrEqual(2);
    // …and clears on its own once the minute is up.
    sys.queasyUntil = Date.now() - 1000;
    sys.update();
    expect(scene._queasy.alpha).toBe(0);
    sys.destroy();
  });

  it('a trash-food third bite fills you AND makes you queasy', () => {
    const scene = makeScene();
    const sys = new HungerSystem(scene);
    sys.eatBite(false);
    sys.eatBite(false);
    const third = sys.eatBite(true);
    expect(third).toMatchObject({ applied: true, full: true });
    expect(third.notice).toBe(`${FULL_TOAST} ${QUEASY_TOAST}`);
    expect(sys.isHungry()).toBe(false);
    sys.update();
    expect(scene._queasy.alpha).toBe(1);
    expect(scene._bubble.alpha).toBe(0);
    sys.destroy();
  });

  it('shows the "hungry..." bubble while hungry and hides it when full', () => {
    const scene = makeScene();
    const sys = new HungerSystem(scene);
    sys.update();
    expect(scene._bubble.alpha).toBe(1);
    expect(scene._bubble.x).toBe(100);
    expect(Math.abs(scene._bubble.y - (200 - 72))).toBeLessThanOrEqual(2);
    sys.eatBite(false);
    sys.eatBite(false);
    sys.eatBite(false);
    sys.update();
    expect(scene._bubble.alpha).toBe(0);
    sys.destroy();
  });

  it('is calm while full, and the toast returns when the 8 hours wear off', () => {
    const scene = makeScene();
    const sys = new HungerSystem(scene);
    sys.eatBite(false);
    sys.eatBite(false);
    sys.eatBite(false);
    expect(scene._notices).toEqual([]);
    // Fast-forward past the 8 hours: the notification returns.
    sys.state = { ...sys.state, fedUntil: Date.now() - 1000 };
    sys._lastCheckMs = 0;
    sys.update();
    expect(scene._notices).toEqual([HUNGER_TOAST]);
    sys.destroy();
  });

  it('destroys the bubble and the queasy marker and drops the scene', () => {
    const scene = makeScene();
    const sys = new HungerSystem(scene);
    sys.refresh();
    sys.destroy();
    expect(scene._bubble.destroyed).toBe(true);
    expect(scene._queasy.destroyed).toBe(true);
    expect(sys.scene).toBeNull();
  });
});
