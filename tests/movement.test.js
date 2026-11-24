// movement.test.js — Mobile movement v1 (`sq-mobile-move-v1`).
// Tap-to-move stuck detection: a blocked target is dropped after no
// progress for STUCK_DROP_MS, so the player stops pushing furniture
// and taps a clear spot instead.

import { describe, it, expect } from 'vitest';
import {
  STUCK_DROP_MS,
  STUCK_PROGRESS_PX,
  stuckDropCheck,
} from '../src/village/movement.js';

describe('stuckDropCheck', () => {
  it('initialises state on first call and never drops', () => {
    const r = stuckDropCheck(null, 100, 0);
    expect(r.drop).toBe(false);
    expect(r.state).toEqual({ bestDist: 100, since: 0 });
  });

  it('resets the timer when the player gets meaningfully closer', () => {
    const s = { bestDist: 100, since: 0 };
    const r = stuckDropCheck(s, 90, 1400);
    expect(r.drop).toBe(false);
    expect(r.state).toEqual({ bestDist: 90, since: 1400 });
  });

  it('does not reset the timer for tiny progress', () => {
    const s = { bestDist: 100, since: 0 };
    const r = stuckDropCheck(s, 98, 1400);
    expect(r.drop).toBe(false);
    expect(r.state).toEqual({ bestDist: 100, since: 0 });
  });

  it('drops the target after no progress for STUCK_DROP_MS', () => {
    const s = { bestDist: 100, since: 0 };
    expect(stuckDropCheck(s, 100, STUCK_DROP_MS - 1).drop).toBe(false);
    const r = stuckDropCheck(s, 100, STUCK_DROP_MS);
    expect(r.drop).toBe(true);
    expect(r.state).toBe(null);
  });

  it('keeps walking while sliding closer, however slowly', () => {
    let state = null;
    let now = 0;
    let dist = 200;
    // Slide 5px per 500ms — each bit of progress resets the timer,
    // so a slow slide around a long table never falsely drops.
    for (let i = 0; i < 10; i++) {
      dist -= 5;
      now += 500;
      const r = stuckDropCheck(state, dist, now);
      expect(r.drop).toBe(false);
      state = r.state;
    }
  });

  it('exposes the tuned constants', () => {
    expect(STUCK_DROP_MS).toBe(1500);
    expect(STUCK_PROGRESS_PX).toBe(4);
  });
});
