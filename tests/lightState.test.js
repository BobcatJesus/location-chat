// lightState.test.js — Christmas Lights v1 (`sq-christmas-lights-v1`),
// v1.1 (`sq-christmas-lights-v1.1` — hang range 170 -> 100),
// v1.2 (`sq-christmas-multi-v1.2` — every hang counts).
// v1.4 (`sq-christmas-lights-v1.4` — the bulb lights nearest to
// where the player hung it: `lit` lists the lit slots in hang order).
// Pure logic only: multi-hang counting, 25 to light the room,
// one round per venue, fill stages, bulb slots, serialize / parse.

import { describe, it, expect } from 'vitest';
import {
  LIGHTS_MARKER_V1,
  LIGHTS_TOTAL,
  LIGHTS_HANG_RANGE,
  LIGHTS_BULB_SLOTS,
  bulbColor,
  createLightState,
  isLightsComplete,
  lightsProgress,
  lightsStage,
  hangLight,
  nearestUnlitSlot,
  serializeLightState,
  parseLightState,
} from '../src/village/lightState.js';

function hangMany(state, users) {
  const results = [];
  for (const u of users) results.push(hangLight(state, u));
  return results;
}

describe('lights constants', () => {
  it('carries the v1 marker', () => {
    expect(LIGHTS_MARKER_V1).toBe('sq-christmas-lights-v1');
  });

  it('needs 25 counted strings to light the room', () => {
    expect(LIGHTS_TOTAL).toBe(25);
  });

  it('hang range is 100 in v1.1 — bar front in, tables out', () => {
    // v1.1 (`sq-christmas-lights-v1.1`): 170 covered the whole bar
    // front AND the nearby tables (~150px from the spot); 100 covers
    // standing at the bar front (~50-70px) and excludes the tables.
    expect(LIGHTS_HANG_RANGE).toBe(100);
  });

  it('has 25 bulb slots, all inside the room', () => {
    expect(LIGHTS_BULB_SLOTS).toHaveLength(25);
    for (const s of LIGHTS_BULB_SLOTS) {
      expect(s.x).toBeGreaterThanOrEqual(80);
      expect(s.x).toBeLessThanOrEqual(1520);
      expect(s.y).toBeGreaterThanOrEqual(80);
      expect(s.y).toBeLessThanOrEqual(820);
    }
  });

  it('cycles bulb colours so the strands are not identical dots', () => {
    const colors = new Set(Array.from({ length: 25 }, (_, i) => bulbColor(i)));
    expect(colors.size).toBeGreaterThanOrEqual(4);
    expect(bulbColor(0)).toBe(bulbColor(6));
  });
});

describe('fill stages', () => {
  it('stays bare on the first string, fills in as more strings go up', () => {
    expect(lightsStage(0)).toBe(0);
    expect(lightsStage(1)).toBe(0);
    expect(lightsStage(2)).toBe(1);
    expect(lightsStage(7)).toBe(2);
    expect(lightsStage(13)).toBe(3);
    expect(lightsStage(19)).toBe(4);
    expect(lightsStage(25)).toBe(5);
  });
});

describe('hangLight — every hang counts (v1.2)', () => {
  it('counts every hang, including repeats by the same player', () => {
    const s = createLightState();
    const r1 = hangLight(s, 'alice');
    expect(r1).toMatchObject({ ok: true, counted: true, finished: false });
    expect(s.counted).toBe(1);
    const r2 = hangLight(s, 'alice');
    expect(r2).toMatchObject({ ok: true, counted: true });
    expect(s.counted).toBe(2);
    expect(s).not.toHaveProperty('extras');
    expect(s.contributors).toEqual(['alice']);
    expect(s.hungBy.alice).toBe(2);
  });

  it('finishes the room on the 25th hang — one player alone can do it', () => {
    const s = createLightState();
    let r;
    for (let i = 0; i < 25; i++) r = hangLight(s, 'solo');
    expect(r).toMatchObject({ ok: true, counted: true, finished: true });
    expect(s.completed).toBe(true);
    expect(isLightsComplete(s)).toBe(true);
    expect(s.counted).toBe(25);
    expect(r.contributors).toEqual(['solo']);
  });

  it('finishes the room on the 25th hang across players', () => {
    const s = createLightState();
    const users = Array.from({ length: 24 }, (_, i) => `user-${i}`);
    hangMany(s, users);
    expect(s.counted).toBe(24);
    expect(isLightsComplete(s)).toBe(false);
    const r = hangLight(s, 'user-24');
    expect(r).toMatchObject({ ok: true, counted: true, finished: true });
    expect(s.completed).toBe(true);
    expect(isLightsComplete(s)).toBe(true);
    expect(s.counted).toBe(25);
    expect(r.contributors).toHaveLength(25);
  });

  it('refuses hangs once the room is lit', () => {
    const s = createLightState();
    hangMany(s, Array.from({ length: 25 }, (_, i) => `user-${i}`));
    expect(hangLight(s, 'latecomer')).toMatchObject({ ok: false, reason: 'already-complete' });
    expect(s.counted).toBe(25);
  });

  it('refuses a hang with no user id', () => {
    const s = createLightState();
    expect(hangLight(s, '')).toMatchObject({ ok: false, reason: 'bad-user' });
    expect(s.counted).toBe(0);
  });

  it('tracks progress for the tracker', () => {
    const s = createLightState();
    expect(lightsProgress(s)).toEqual({ counted: 0, total: 25, completed: false });
    hangLight(s, 'alice');
    expect(lightsProgress(s)).toEqual({ counted: 1, total: 25, completed: false });
    hangMany(s, Array.from({ length: 24 }, (_, i) => `user-${i}`));
    expect(lightsProgress(s)).toEqual({ counted: 25, total: 25, completed: true });
  });
});

describe('serialize / parse', () => {
  it('round-trips a mid-progress room', () => {
    const s = createLightState();
    hangMany(s, ['alice', 'bob', 'carol']);
    hangLight(s, 'alice'); // second hang by alice — counts too (v1.2)
    const back = parseLightState(serializeLightState(s));
    expect(back.counted).toBe(4);
    expect(back).not.toHaveProperty('extras');
    expect(back.contributors).toEqual(['alice', 'bob', 'carol']);
    expect(back.hungBy.alice).toBe(2);
    expect(back.completed).toBe(false);
  });

  it('repairs a bad row: completed with fewer than 25 counted', () => {
    const back = parseLightState({ counted: 3, completed: true, contributors: ['alice'] });
    expect(back.completed).toBe(true);
    expect(back.counted).toBe(25);
  });

  it('repairs garbage input to a fresh room', () => {
    expect(parseLightState(null)).toEqual(createLightState());
    expect(parseLightState('nope')).toEqual(createLightState());
    // A legacy row carrying `extras` is ignored (v1.2 has no extras).
    const back = parseLightState({ counted: -5, extras: 99999, contributors: 'alice' });
    expect(back.counted).toBe(0);
    expect(back).not.toHaveProperty('extras');
    expect(back.contributors).toEqual([]);
  });

  it('keeps a completed room completed through the wire', () => {
    const s = createLightState();
    hangMany(s, Array.from({ length: 25 }, (_, i) => `user-${i}`));
    const back = parseLightState(serializeLightState(s));
    expect(back.completed).toBe(true);
    expect(back.counted).toBe(25);
    expect(back.contributors).toHaveLength(25);
  });
});

describe('nearest-slot lighting — the bulb lights where the player hung it (v1.4)', () => {
  // Slot layout: north wall 0-9, east wall 10-16, west wall 17-24.
  it('a hang at the SE corner lights an east-wall slot, not slot 0', () => {
    const s = createLightState();
    // SE corner spot (1420, 620): nearest slot is (1490, 613), index 15.
    const r = hangLight(s, 'alice', { x: 1420, y: 620 });
    expect(r).toMatchObject({ ok: true, litSlot: 15 });
    expect(s.lit).toEqual([15]);
    expect(s.counted).toBe(1);
    expect(LIGHTS_BULB_SLOTS[15]).toEqual({ x: 1490, y: 613 });
  });

  it('a hang at the bar lights a north-wall slot', () => {
    const s = createLightState();
    // Bar spot (800, 190): nearest slot is (866, 112), index 5.
    const r = hangLight(s, 'alice', { x: 800, y: 190 });
    expect(r).toMatchObject({ ok: true, litSlot: 5 });
    expect(s.lit).toEqual([5]);
  });

  it('a second hang at a different corner lights a different nearby slot, never a duplicate', () => {
    const s = createLightState();
    hangLight(s, 'alice', { x: 800, y: 190 }); // bar -> slot 5
    const r = hangLight(s, 'alice', { x: 1420, y: 620 }); // SE corner -> slot 15
    expect(r).toMatchObject({ ok: true, litSlot: 15 });
    expect(s.lit).toEqual([5, 15]);
    expect(s.counted).toBe(2);
    expect(s.lit).toHaveLength(2);
    // Hang at the SE corner again: slot 15 is taken, so the NEXT
    // nearest east slot lights instead — still east, still not a dup.
    const r2 = hangLight(s, 'bob', { x: 1420, y: 620 });
    expect(r2.litSlot).not.toBe(15);
    expect(r2.litSlot).toBeGreaterThanOrEqual(10);
    expect(r2.litSlot).toBeLessThanOrEqual(16);
    expect(new Set(s.lit).size).toBe(s.lit.length);
  });

  it('no spot sent falls back to the first unlit slot — the old behaviour', () => {
    const s = createLightState();
    expect(hangLight(s, 'a')).toMatchObject({ ok: true, litSlot: 0 });
    expect(hangLight(s, 'b')).toMatchObject({ ok: true, litSlot: 1 });
    expect(s.lit).toEqual([0, 1]);
    // A garbage spot falls back the same way.
    const s2 = createLightState();
    expect(hangLight(s2, 'a', { x: 'nope', y: null })).toMatchObject({ ok: true, litSlot: 0 });
    expect(nearestUnlitSlot(s2, null)).toBe(1);
  });

  it('counted === lit.length after hangs, and 25 hangs light all 25 slots exactly once', () => {
    const s = createLightState();
    const spots = [
      { x: 800, y: 190 }, { x: 1420, y: 620 }, { x: 220, y: 170 },
      { x: 1380, y: 170 }, { x: 180, y: 600 },
    ];
    for (let i = 0; i < 25; i++) hangLight(s, `user-${i % 3}`, spots[i % spots.length]);
    expect(s.counted).toBe(25);
    expect(s.lit).toHaveLength(25);
    expect(new Set(s.lit).size).toBe(25);
    expect([...s.lit].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(s.completed).toBe(true);
  });

  it('parse repairs an old state without `lit` by filling the first N slots in fixed order', () => {
    const back = parseLightState({ counted: 3, contributors: ['alice'] });
    expect(back.lit).toEqual([0, 1, 2]);
    expect(back.counted).toBe(3);
    // A completed old state repairs to all 25 slots lit.
    const done = parseLightState({ counted: 3, completed: true });
    expect(done.counted).toBe(25);
    expect(done.lit).toHaveLength(25);
    expect([...done.lit].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  it('parse repairs a bad `lit`: dedupes, drops out-of-range slots, pads to counted', () => {
    const back = parseLightState({ counted: 2, lit: [2, 2, 99, -1] });
    expect(back.lit).toEqual([2, 0]);
    const over = parseLightState({ counted: 1, lit: [4, 5, 6] });
    expect(over.lit).toEqual([4]);
  });

  it('serialize round-trips `lit` in hang order', () => {
    const s = createLightState();
    hangLight(s, 'alice', { x: 1420, y: 620 }); // SE -> 15
    hangLight(s, 'bob', { x: 800, y: 190 }); // bar -> 5
    const back = parseLightState(serializeLightState(s));
    expect(back.lit).toEqual([15, 5]);
    expect(back.counted).toBe(2);
  });
});
