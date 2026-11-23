// temperature.test.js — Temperature System v1 (`sq-temperature-v1`).
//
// Fall + winter you are cold by default, spring + summer you are
// warm by default; a matching drink (warm: cocoa/coffee, cool:
// beer/iced coffee) fixes it for 30 minutes. The notification
// ("You're cold, get a warm drink" / "You're warm, get a cold
// drink") fires once per spell — on entering the app, and again
// when a drink's 30 minutes wear off — never nagging while the
// state persists. A wrong-season drink is just a drink.
//
// These tests cover the pure module (season boundaries, the
// 30-minute duration, the matching-state-only rule, the
// toast-once-per-spell machine, the localStorage round trip)
// plus the Phaser-side system against a stub scene (no Phaser
// import — the system only calls scene methods). The scene wiring
// (coffee buy, beer hand-off, bar panel) is verified by the Vite
// build + code read: VillageScene imports Phaser, which touches
// the DOM at import time and cannot run in vitest.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  TEMP_MARKER_V1,
  TEMP_EFFECT_MS,
  COLD_TOAST,
  WARM_TOAST,
  TEMP_DRINK_KINDS,
  TEMP_DRINK_KIND_IDS,
  TEMP_DRINK_PRICE,
  TEMP_STORAGE_KEY,
  chicagoMonth,
  seasonFor,
  createTemperatureState,
  exposureFor,
  refreshTemperature,
  applyDrink,
  loadTemperatureState,
  saveTemperatureState,
  _clearTemperatureMemoryForTest,
} from '../src/village/temperature.js';
import { TemperatureSystem } from '../src/village/TemperatureSystem.js';

// 2026-11-23 is CST (UTC-6); July is CDT (UTC-5). DST 2026 starts
// Mar 8, so Mar 1 is still CST.
const utc = (y, mo, d, h, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi));
const NOV_23_NOON = utc(2026, 11, 23, 18, 0); // 12:00 Chicago, Nov
const JAN_15_NOON = utc(2026, 1, 15, 18, 0); // 12:00 Chicago, Jan
const FEB_28_LATE = utc(2026, 3, 1, 5, 59); // 23:59 Chicago, Feb 28
const MAR_01_MIDNIGHT = utc(2026, 3, 1, 6, 0); // 00:00 Chicago, Mar 1
const SEP_01_MIDNIGHT = utc(2026, 9, 1, 5, 0); // 00:00 Chicago, Sep 1
const AUG_31_LATE = utc(2026, 9, 1, 4, 59); // 23:59 Chicago, Aug 31
const JUL_04_NOON = utc(2026, 7, 4, 17, 0); // 12:00 Chicago, Jul

describe('constants', () => {
  it('has the kit marker and the decided values', () => {
    expect(TEMP_MARKER_V1).toBe('sq-temperature-v1');
    expect(TEMP_EFFECT_MS).toBe(30 * 60 * 1000);
    expect(COLD_TOAST).toBe("You're cold, get a warm drink");
    expect(WARM_TOAST).toBe("You're warm, get a cold drink");
    expect(TEMP_DRINK_PRICE).toBe(2);
  });

  it('sells cocoa and iced coffee at the bar, 2 coins each', () => {
    expect(TEMP_DRINK_KIND_IDS).toEqual(['cocoa', 'iced-coffee']);
    expect(TEMP_DRINK_KINDS.cocoa).toMatchObject({ label: 'Hot cocoa', price: 2, temp: 'warm' });
    expect(TEMP_DRINK_KINDS['iced-coffee']).toMatchObject({ label: 'Iced coffee', price: 2, temp: 'cool' });
  });
});

describe('seasonFor', () => {
  it('is cold in fall and winter (Sep–Feb)', () => {
    for (const d of [
      utc(2026, 9, 15, 18, 0), utc(2026, 10, 15, 17, 0), NOV_23_NOON,
      utc(2026, 12, 25, 18, 0), JAN_15_NOON, utc(2026, 2, 15, 18, 0),
    ]) expect(seasonFor(d)).toBe('cold');
  });

  it('is warm in spring and summer (Mar–Aug)', () => {
    for (const d of [
      utc(2026, 3, 15, 17, 0), utc(2026, 4, 15, 17, 0), utc(2026, 5, 15, 17, 0),
      utc(2026, 6, 15, 17, 0), JUL_04_NOON, utc(2026, 8, 15, 17, 0),
    ]) expect(seasonFor(d)).toBe('warm');
  });

  it('flips at the month boundaries, not mid-month', () => {
    expect(chicagoMonth(FEB_28_LATE)).toBe(2);
    expect(seasonFor(FEB_28_LATE)).toBe('cold');
    expect(chicagoMonth(MAR_01_MIDNIGHT)).toBe(3);
    expect(seasonFor(MAR_01_MIDNIGHT)).toBe('warm');
    expect(seasonFor(AUG_31_LATE)).toBe('warm');
    expect(chicagoMonth(SEP_01_MIDNIGHT)).toBe(9);
    expect(seasonFor(SEP_01_MIDNIGHT)).toBe('cold');
  });
});

describe('refreshTemperature — toast once per spell', () => {
  const now = NOV_23_NOON.getTime();

  it('toasts exactly once per cold spell', () => {
    const first = refreshTemperature(createTemperatureState(), { now, date: NOV_23_NOON });
    expect(first.exposure).toBe('cold');
    expect(first.toast).toBe(COLD_TOAST);
    expect(first.state.notifiedSpell).toBe('cold');
    // Same spell, still cold: no nagging.
    const second = refreshTemperature(first.state, { now: now + 5000, date: NOV_23_NOON });
    expect(second.toast).toBeNull();
    expect(second.exposure).toBe('cold');
  });

  it('toasts exactly once per warm spell', () => {
    const t = JUL_04_NOON.getTime();
    const first = refreshTemperature(createTemperatureState(), { now: t, date: JUL_04_NOON });
    expect(first.exposure).toBe('warm');
    expect(first.toast).toBe(WARM_TOAST);
    const second = refreshTemperature(first.state, { now: t + 5000, date: JUL_04_NOON });
    expect(second.toast).toBeNull();
  });

  it('toasts again when the season flips mid-spell', () => {
    const cold = refreshTemperature(createTemperatureState(), { now, date: NOV_23_NOON });
    expect(cold.toast).toBe(COLD_TOAST);
    const warm = refreshTemperature(cold.state, { now: JUL_04_NOON.getTime(), date: JUL_04_NOON });
    expect(warm.toast).toBe(WARM_TOAST);
    expect(warm.state.notifiedSpell).toBe('warm');
  });
});

describe('applyDrink — matching state only, 30 minutes', () => {
  const now = NOV_23_NOON.getTime();

  it('a warm drink warms for exactly 30 minutes in the cold season', () => {
    const res = applyDrink(createTemperatureState(), { kind: 'warm', now, date: NOV_23_NOON });
    expect(res.applied).toBe(true);
    expect(res.state.warmUntil).toBe(now + TEMP_EFFECT_MS);
    // Comfortable until the 30 minutes are up…
    expect(exposureFor(res.state, { now: now + TEMP_EFFECT_MS - 1, date: NOV_23_NOON })).toBeNull();
    // …then the season catches up again.
    expect(exposureFor(res.state, { now: now + TEMP_EFFECT_MS, date: NOV_23_NOON })).toBe('cold');
  });

  it('a cool drink cools for exactly 30 minutes in the warm season', () => {
    const t = JUL_04_NOON.getTime();
    const res = applyDrink(createTemperatureState(), { kind: 'cool', now: t, date: JUL_04_NOON });
    expect(res.applied).toBe(true);
    expect(res.state.coolUntil).toBe(t + TEMP_EFFECT_MS);
    expect(exposureFor(res.state, { now: t + TEMP_EFFECT_MS - 1, date: JUL_04_NOON })).toBeNull();
    expect(exposureFor(res.state, { now: t + TEMP_EFFECT_MS, date: JUL_04_NOON })).toBe('warm');
  });

  it('a wrong-season drink is just a drink — no effect', () => {
    const warmInSummer = applyDrink(createTemperatureState(), { kind: 'warm', now: JUL_04_NOON.getTime(), date: JUL_04_NOON });
    expect(warmInSummer.applied).toBe(false);
    expect(warmInSummer.state.warmUntil).toBe(0);
    const coolInWinter = applyDrink(createTemperatureState(), { kind: 'cool', now, date: NOV_23_NOON });
    expect(coolInWinter.applied).toBe(false);
    expect(coolInWinter.state.coolUntil).toBe(0);
  });

  it('re-drinking while comfortable refreshes the 30 minutes', () => {
    const first = applyDrink(createTemperatureState(), { kind: 'warm', now, date: NOV_23_NOON });
    const second = applyDrink(first.state, { kind: 'warm', now: now + 10 * 60 * 1000, date: NOV_23_NOON });
    expect(second.applied).toBe(true);
    expect(second.state.warmUntil).toBe(now + 10 * 60 * 1000 + TEMP_EFFECT_MS);
  });

  it('a drink ends the spell, and the toast returns when it wears off', () => {
    const spell = refreshTemperature(createTemperatureState(), { now, date: NOV_23_NOON });
    expect(spell.toast).toBe(COLD_TOAST);
    const drank = applyDrink(spell.state, { kind: 'warm', now, date: NOV_23_NOON });
    expect(drank.state.notifiedSpell).toBeNull();
    const comfortable = refreshTemperature(drank.state, { now: now + 1000, date: NOV_23_NOON });
    expect(comfortable.toast).toBeNull();
    expect(comfortable.exposure).toBeNull();
    const wornOff = refreshTemperature(comfortable.state, { now: now + TEMP_EFFECT_MS + 1000, date: NOV_23_NOON });
    expect(wornOff.exposure).toBe('cold');
    expect(wornOff.toast).toBe(COLD_TOAST);
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

  it('round-trips the drink timers through storage', () => {
    const storage = memStorage();
    const state = { warmUntil: 123456789, coolUntil: 987654321, notifiedSpell: 'cold' };
    saveTemperatureState(state, storage);
    const loaded = loadTemperatureState(storage);
    expect(loaded.warmUntil).toBe(123456789);
    expect(loaded.coolUntil).toBe(987654321);
    // notifiedSpell is session-only — it does not survive a reload.
    expect(loaded.notifiedSpell).toBeNull();
  });

  it('loads as no drink in effect when the record is missing or garbage', () => {
    const storage = memStorage();
    expect(loadTemperatureState(storage)).toEqual(createTemperatureState());
    storage.setItem(TEMP_STORAGE_KEY, 'not json at all');
    expect(loadTemperatureState(storage)).toEqual(createTemperatureState());
    storage.setItem(TEMP_STORAGE_KEY, JSON.stringify({ warmUntil: 'soon', coolUntil: -5 }));
    const loaded = loadTemperatureState(storage);
    expect(loaded.warmUntil).toBe(0);
    expect(loaded.coolUntil).toBe(0);
  });
});

describe('TemperatureSystem (stub scene)', () => {
  // The system only calls scene methods — no Phaser import, so a
  // stub scene is enough. Season-dependent expectations are
  // computed from the real season, so these pass year-round.
  function makeScene() {
    const notices = [];
    const sweat = {
      alpha: 0, x: 0, y: 0,
      setOrigin() { return this; },
      setDepth() { return this; },
      setAlpha(a) { this.alpha = a; return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      destroy() { this.destroyed = true; },
    };
    const scene = {
      player: { gx: 100, gy: 200, avatar: { x: 100 } },
      onSystemNotice: (msg) => { notices.push(msg); },
      add: { text: () => sweat },
      _notices: notices,
      _sweat: sweat,
    };
    return scene;
  }

  beforeEach(() => { _clearTemperatureMemoryForTest(); });

  it('has the kit marker and toasts once on refresh', () => {
    const scene = makeScene();
    const sys = new TemperatureSystem(scene);
    expect(sys.marker).toBe('sq-temperature-v1');
    sys.refresh();
    const season = seasonFor(new Date());
    expect(scene._notices).toEqual([season === 'cold' ? COLD_TOAST : WARM_TOAST]);
    sys.refresh();
    expect(scene._notices).toHaveLength(1);
    sys.destroy();
  });

  it('drinks apply only in the matching season', () => {
    const scene = makeScene();
    const sys = new TemperatureSystem(scene);
    const season = seasonFor(new Date());
    expect(sys.drinkWarm()).toBe(season === 'cold');
    expect(sys.drinkCool()).toBe(season === 'warm');
    sys.destroy();
  });

  it('is calm while a drink is in effect, and the toast returns when it wears off', () => {
    const scene = makeScene();
    const sys = new TemperatureSystem(scene);
    const season = seasonFor(new Date());
    // A matching drink ends the spell and the toast.
    const applied = season === 'cold' ? sys.drinkWarm() : sys.drinkCool();
    expect(applied).toBe(true);
    expect(scene._notices).toHaveLength(0);
    // Fast-forward past the 30 minutes: the notification returns.
    sys.state = season === 'cold'
      ? { ...sys.state, warmUntil: Date.now() - 1000 }
      : { ...sys.state, coolUntil: Date.now() - 1000 };
    sys._lastCheckMs = 0;
    sys.update();
    expect(scene._notices).toEqual([season === 'cold' ? COLD_TOAST : WARM_TOAST]);
    sys.destroy();
  });

  it('shivers the avatar while cold and hides the sweat drop', () => {
    // Fake timers: the shiver is sin(Date.now() / 110) — a tight
    // real-time loop barely advances the clock, so step it by hand.
    vi.useFakeTimers();
    try {
      const scene = makeScene();
      const sys = new TemperatureSystem(scene);
      const season = seasonFor(new Date());
      if (season !== 'cold') { sys.destroy(); return; } // warm-season runs cover the sweat case below
      const seen = new Set();
      for (let i = 0; i < 40; i++) {
        vi.advanceTimersByTime(50);
        // The real scene re-syncs the avatar to gx every frame
        // (player.sync()) before the systems update — the stub
        // mimics that, so the shiver is always applied on top of
        // the synced position.
        scene.player.avatar.x = scene.player.gx;
        sys.update();
        seen.add(scene.player.avatar.x);
      }
      // The shake moves the avatar a few px either side of gx…
      for (const x of seen) expect(Math.abs(x - 100)).toBeLessThanOrEqual(3);
      // …and it actually oscillates, not a fixed offset.
      expect(seen.size).toBeGreaterThan(1);
      expect(scene._sweat.alpha).toBe(0);
      // A warm drink stops the shiver: the next sync leaves the
      // avatar at gx and the system no longer offsets it.
      sys.drinkWarm();
      scene.player.avatar.x = scene.player.gx;
      sys.update();
      expect(scene.player.avatar.x).toBe(100);
      sys.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the sweat drop while warm and hides it when cooled', () => {
    const scene = makeScene();
    const sys = new TemperatureSystem(scene);
    const season = seasonFor(new Date());
    if (season !== 'warm') { sys.destroy(); return; } // cold-season runs cover the shiver case above
    sys.update();
    expect(scene._sweat.alpha).toBe(1);
    expect(scene._sweat.x).toBe(100 + 14);
    expect(Math.abs(scene._sweat.y - (200 - 72))).toBeLessThanOrEqual(2);
    sys.drinkCool();
    sys.update();
    expect(scene._sweat.alpha).toBe(0);
    sys.destroy();
  });

  it('destroys the sweat drop and drops the scene', () => {
    const scene = makeScene();
    const sys = new TemperatureSystem(scene);
    sys.refresh();
    sys.destroy();
    expect(scene._sweat.destroyed).toBe(true);
    expect(sys.scene).toBeNull();
  });
});
