// snowState.test.js — Build a Snowman v1 (`sq-build-snowman-v1`).
// Pure logic only: multi-add counting (every add counts from the
// start), 15 to build the snowman, one round per venue, growth
// stages, serialize / parse, per-add payment diff.

import { describe, it, expect } from 'vitest';
import {
  SNOW_MARKER_V1,
  SNOW_TOTAL,
  SNOW_PILE_TAKE_RANGE,
  SNOW_ADD_RANGE,
  SNOWMAN_POS,
  SNOW_PILE_POS,
  createSnowState,
  isSnowComplete,
  snowProgress,
  snowStage,
  addSnowball,
  serializeSnowState,
  parseSnowState,
  owedSnowAdds,
} from '../src/village/snowState.js';

function addMany(state, users) {
  const results = [];
  for (const u of users) results.push(addSnowball(state, u));
  return results;
}

describe('snow constants', () => {
  it('carries the v1 marker', () => {
    expect(SNOW_MARKER_V1).toBe('sq-build-snowman-v1');
  });

  it('needs 15 counted snowballs to build the snowman', () => {
    expect(SNOW_TOTAL).toBe(15);
  });

  it('take range is 140, add range is 100 — same as the lights box/hang', () => {
    expect(SNOW_PILE_TAKE_RANGE).toBe(140);
    expect(SNOW_ADD_RANGE).toBe(100);
  });

  it('the pile and the snowman are a short walk apart', () => {
    const d = Math.hypot(SNOW_PILE_POS.x - SNOWMAN_POS.x, SNOW_PILE_POS.y - SNOWMAN_POS.y);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(400);
  });
});

describe('growth stages', () => {
  it('grows base, middle, head, then face at 12+', () => {
    expect(snowStage(0)).toBe(0); // just a snow patch
    expect(snowStage(1)).toBe(1); // base ball
    expect(snowStage(4)).toBe(1);
    expect(snowStage(5)).toBe(2); // + middle ball
    expect(snowStage(8)).toBe(2);
    expect(snowStage(9)).toBe(3); // + head
    expect(snowStage(11)).toBe(3);
    expect(snowStage(12)).toBe(4); // + face, scarf, arms
    expect(snowStage(15)).toBe(4);
  });
});

describe('addSnowball — every add counts', () => {
  it('counts every add, including repeats by the same player', () => {
    const s = createSnowState();
    const r1 = addSnowball(s, 'alice');
    expect(r1).toMatchObject({ ok: true, counted: true, finished: false });
    expect(s.counted).toBe(1);
    const r2 = addSnowball(s, 'alice');
    expect(r2).toMatchObject({ ok: true, counted: true, finished: false });
    expect(s.counted).toBe(2);
    expect(s.hungBy.alice).toBe(2);
    expect(s.contributors).toEqual(['alice']);
  });

  it('completes at 15 and refuses further adds', () => {
    const s = createSnowState();
    for (let i = 0; i < 14; i++) addSnowball(s, `user${i}`);
    expect(isSnowComplete(s)).toBe(false);
    const last = addSnowball(s, 'user14');
    expect(last).toMatchObject({ ok: true, finished: true });
    expect(s.counted).toBe(15);
    expect(s.completed).toBe(true);
    expect(Number.isFinite(s.completedAt) && s.completedAt > 0).toBe(true);
    expect(addSnowball(s, 'late')).toMatchObject({ ok: false, reason: 'already-complete' });
    expect(s.counted).toBe(15);
  });

  it('the badge list is every contributor, once each', () => {
    const s = createSnowState();
    addMany(s, ['alice', 'bob', 'alice', 'carol', 'bob']);
    expect(s.contributors).toEqual(['alice', 'bob', 'carol']);
    expect(s.hungBy).toEqual({ alice: 2, bob: 2, carol: 1 });
  });

  it('refuses an empty user id', () => {
    const s = createSnowState();
    expect(addSnowball(s, '')).toMatchObject({ ok: false, reason: 'bad-user' });
    expect(s.counted).toBe(0);
  });
});

describe('serialize / parse', () => {
  it('round-trips a mid-build state', () => {
    const s = createSnowState();
    addMany(s, ['alice', 'alice', 'bob']);
    const out = serializeSnowState(s);
    expect(out).toMatchObject({ counted: 3, total: 15, completed: false });
    expect(parseSnowState(out)).toEqual(s);
  });

  it('repairs a completed state that claims fewer than 15', () => {
    const s = parseSnowState({ counted: 9, completed: true, contributors: ['alice'], hungBy: { alice: 9 } });
    expect(s.counted).toBe(15);
    expect(s.completed).toBe(true);
  });

  it('repairs garbage into a fresh state', () => {
    expect(parseSnowState(null)).toEqual(createSnowState());
    expect(parseSnowState('nope')).toEqual(createSnowState());
    expect(parseSnowState({ counted: 99, contributors: 'x', hungBy: [] })).toMatchObject({ counted: 15, completed: true });
  });

  it('snowProgress clamps and reports completion', () => {
    expect(snowProgress(createSnowState())).toEqual({ counted: 0, total: 15, completed: false });
    const s = createSnowState();
    for (let i = 0; i < 15; i++) addSnowball(s, `u${i}`);
    expect(snowProgress(s)).toEqual({ counted: 15, total: 15, completed: true });
  });
});

describe('owedSnowAdds — the paid-count diff', () => {
  it('pays the difference, and resets when the room epoch restarted', () => {
    expect(owedSnowAdds(0, 0)).toEqual({ owed: 0, newPaid: 0 });
    expect(owedSnowAdds(1, 0)).toEqual({ owed: 1, newPaid: 1 });
    expect(owedSnowAdds(2, 1)).toEqual({ owed: 1, newPaid: 2 });
    expect(owedSnowAdds(5, 5)).toEqual({ owed: 0, newPaid: 5 });
    expect(owedSnowAdds(3, undefined)).toEqual({ owed: 3, newPaid: 3 });
    // Counted LOWER than paid means the room state was wiped and
    // started over: the fresh adds pay in full.
    expect(owedSnowAdds(1, 3)).toEqual({ owed: 1, newPaid: 1 });
  });
});
