// lightState.test.js — Christmas Lights v1 (`sq-christmas-lights-v1`).
// Pure logic only: hidden first-only counting, 25 to light the room,
// one round per venue, fill stages, bulb slots, serialize / parse.

import { describe, it, expect } from 'vitest';
import {
  LIGHTS_MARKER_V1,
  LIGHTS_TOTAL,
  LIGHTS_BULB_SLOTS,
  LIGHTS_EXTRA_SLOTS,
  bulbColor,
  createLightState,
  isLightsComplete,
  lightsProgress,
  lightsStage,
  hangLight,
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

  it('has 25 bulb slots and 20 extra slots, all inside the room', () => {
    expect(LIGHTS_BULB_SLOTS).toHaveLength(25);
    expect(LIGHTS_EXTRA_SLOTS).toHaveLength(20);
    for (const s of [...LIGHTS_BULB_SLOTS, ...LIGHTS_EXTRA_SLOTS]) {
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
  it('stays bare on the first string, fills in as more people hang', () => {
    expect(lightsStage(0)).toBe(0);
    expect(lightsStage(1)).toBe(0);
    expect(lightsStage(2)).toBe(1);
    expect(lightsStage(7)).toBe(2);
    expect(lightsStage(13)).toBe(3);
    expect(lightsStage(19)).toBe(4);
    expect(lightsStage(25)).toBe(5);
  });
});

describe('hangLight — hidden first-only counting', () => {
  it('counts only the first hang per player toward the 25', () => {
    const s = createLightState();
    const r1 = hangLight(s, 'alice');
    expect(r1).toMatchObject({ ok: true, counted: true, finished: false });
    expect(s.counted).toBe(1);
    const r2 = hangLight(s, 'alice');
    expect(r2).toMatchObject({ ok: true, counted: false });
    expect(s.counted).toBe(1);
    expect(s.extras).toBe(1);
    expect(s.contributors).toEqual(['alice']);
    expect(s.hungBy.alice).toBe(2);
  });

  it('finishes the room on the 25th DIFFERENT player', () => {
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
    hangLight(s, 'alice'); // extra
    const back = parseLightState(serializeLightState(s));
    expect(back.counted).toBe(3);
    expect(back.extras).toBe(1);
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
    const back = parseLightState({ counted: -5, extras: 99999, contributors: 'alice' });
    expect(back.counted).toBe(0);
    expect(back.extras).toBe(999);
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
