// hatState.test.js — Santa Hat v1 (`sq-santa-hat-v1`).
// Pure logic only: one hat per room, find -> carry -> place on the
// cat -> slip off to the ground -> pick up -> place again; slip
// timing; release safety valve; serialize / parse. Hat reset v1
// (`sq-hat-reset-v1`): a moderator can reset the hat to hidden from
// any status, and a carrier who leaves the Agora with the hat in
// their pocket sends it back behind the tree on their own.

import { describe, it, expect } from 'vitest';
// sq-santa-hat-v1.2: slip-off widened from 4 minutes to 30 minutes.
import {
  HAT_MARKER_V1,
  HAT_MARKER_V11,
  HAT_RESET_MARKER,
  HAT_REWARD_COINS,
  HAT_SLIP_MS,
  HAT_SEARCH_CLICKS,
  HAT_SEARCH_RANGE,
  HAT_HIDE_SPOT,
  createHatState,
  isSlipDue,
  findHat,
  placeHat,
  slipHat,
  pickupHat,
  releaseHat,
  resetHat,
  returnCarriedHat,
  serializeHatState,
  parseHatState,
} from '../src/village/hatState.js';

describe('hat constants', () => {
  it('carries the v1 marker', () => {
    expect(HAT_MARKER_V1).toBe('sq-santa-hat-v1');
  });

  it('carries the v1.1 marker (spot moved to the foot of the tree)', () => {
    expect(HAT_MARKER_V11).toBe('sq-santa-hat-v1-1');
  });

  it('pays 3 coins, slips off after 30 minutes, takes 3 search clicks', () => {
    expect(HAT_REWARD_COINS).toBe(3);
    expect(HAT_SLIP_MS).toBe(30 * 60 * 1000);
    expect(HAT_SEARCH_CLICKS).toBe(3);
    expect(HAT_SEARCH_RANGE).toBe(140);
  });

  it('hides at the foot of tree 1 (east side), behind the trunk', () => {
    // v1.1: trunk spans y 446–484 (fillRect(-14,-34,28,38) at spot
    // 1400,480); the spot sits 16px north of its top edge, centred
    // on the trunk's x — and inside the tree's own click zone
    // (x 1285–1515, y 195–510), so clicks count for both.
    expect(HAT_HIDE_SPOT.x).toBe(1400);
    expect(HAT_HIDE_SPOT.y).toBe(430);
    expect(HAT_HIDE_SPOT.y).toBeLessThan(446);
    expect(HAT_HIDE_SPOT.y).toBeGreaterThan(195);
  });
});

describe('findHat', () => {
  it('starts hidden, one finder carries it', () => {
    const s = createHatState();
    expect(s.status).toBe('hidden');
    expect(findHat(s, 'alice')).toEqual({ ok: true });
    expect(s.status).toBe('carried');
    expect(s.carriedBy).toBe('alice');
  });

  it('a second finder gets nothing while it is in play', () => {
    const s = createHatState();
    findHat(s, 'alice');
    expect(findHat(s, 'bob')).toEqual({ ok: false, reason: 'not-hidden' });
    expect(s.carriedBy).toBe('alice');
  });

  it('refuses an empty user', () => {
    expect(findHat(createHatState(), '')).toEqual({ ok: false, reason: 'bad-user' });
  });
});

describe('placeHat', () => {
  it('only the carrier can put it on the cat, and sets the slip time', () => {
    const s = createHatState();
    findHat(s, 'alice');
    expect(placeHat(s, 'bob', 1000)).toEqual({ ok: false, reason: 'not-yours' });
    const res = placeHat(s, 'alice', 1000);
    expect(res.ok).toBe(true);
    expect(res.slipAt).toBe(1000 + HAT_SLIP_MS);
    expect(s.status).toBe('onCat');
    expect(s.placedBy).toBe('alice');
    expect(s.carriedBy).toBe(null);
  });

  it('refuses when nobody carries it', () => {
    expect(placeHat(createHatState(), 'alice', 1000))
      .toEqual({ ok: false, reason: 'not-carried' });
  });
});

describe('slipHat', () => {
  function wornState(now = 1000) {
    const s = createHatState();
    findHat(s, 'alice');
    placeHat(s, 'alice', now);
    return s;
  }

  it('cannot slip early, slips when due, lands clamped in the room', () => {
    const s = wornState(1000);
    expect(isSlipDue(s, 1000)).toBe(false);
    expect(slipHat(s, 500, 500, 1000)).toEqual({ ok: false, reason: 'not-due' });
    expect(s.status).toBe('onCat');
    const res = slipHat(s, 500, 500, 1000 + HAT_SLIP_MS);
    expect(res.ok).toBe(true);
    expect(res.x).toBe(500);
    expect(res.y).toBe(500);
    expect(s.status).toBe('ground');
    expect(isSlipDue(s, 1000 + HAT_SLIP_MS)).toBe(false);
  });

  it('clamps wild coordinates into the room', () => {
    const s = wornState(1000);
    const res = slipHat(s, -500, 99999, 1000 + HAT_SLIP_MS);
    expect(res.ok).toBe(true);
    expect(res.x).toBeGreaterThanOrEqual(40);
    expect(res.x).toBeLessThanOrEqual(1560);
    expect(res.y).toBeGreaterThanOrEqual(40);
    expect(res.y).toBeLessThanOrEqual(860);
  });

  it('refuses when the hat is not on the cat', () => {
    expect(slipHat(createHatState(), 1, 1, Date.now()))
      .toEqual({ ok: false, reason: 'not-on-cat' });
  });
});

describe('pickupHat', () => {
  it('anyone can pick it up off the ground, then place it again', () => {
    const s = createHatState();
    findHat(s, 'alice');
    placeHat(s, 'alice', 1000);
    slipHat(s, 700, 400, 1000 + HAT_SLIP_MS);
    expect(pickupHat(s, 'bob')).toEqual({ ok: true });
    expect(s.status).toBe('carried');
    expect(s.carriedBy).toBe('bob');
    // And bob can put it on the cat too.
    expect(placeHat(s, 'bob', 2000).ok).toBe(true);
    expect(s.placedBy).toBe('bob');
  });

  it('refuses when the hat is not on the ground', () => {
    const s = createHatState();
    expect(pickupHat(s, 'alice')).toEqual({ ok: false, reason: 'not-on-ground' });
    findHat(s, 'alice');
    expect(pickupHat(s, 'bob')).toEqual({ ok: false, reason: 'not-on-ground' });
  });
});

describe('releaseHat', () => {
  it('gives the hat back to hidden; only the carrier can release it', () => {
    const s = createHatState();
    findHat(s, 'alice');
    expect(releaseHat(s, 'bob')).toEqual({ ok: false, reason: 'not-yours' });
    expect(releaseHat(s, 'alice')).toEqual({ ok: true });
    expect(s.status).toBe('hidden');
    expect(s.carriedBy).toBe(null);
    // And it can be found again.
    expect(findHat(s, 'bob')).toEqual({ ok: true });
  });

  it('refuses when nothing is carried', () => {
    expect(releaseHat(createHatState(), 'alice'))
      .toEqual({ ok: false, reason: 'not-carried' });
  });
});

describe('resetHat', () => {
  it('carries the reset marker', () => {
    expect(HAT_RESET_MARKER).toBe('sq-hat-reset-v1');
  });

  it('resets to hidden from carried, and it can be found again', () => {
    const s = createHatState();
    findHat(s, 'alice');
    expect(resetHat(s)).toEqual({ ok: true });
    expect(s.status).toBe('hidden');
    expect(s.carriedBy).toBe(null);
    expect(findHat(s, 'bob')).toEqual({ ok: true });
  });

  it('resets to hidden from onCat, clearing the slip time', () => {
    const s = createHatState();
    findHat(s, 'alice');
    placeHat(s, 'alice', 1000);
    expect(s.status).toBe('onCat');
    expect(s.slipAt).toBe(1000 + HAT_SLIP_MS);
    expect(resetHat(s)).toEqual({ ok: true });
    expect(s.status).toBe('hidden');
    expect(s.wornAt).toBe(0);
    expect(s.slipAt).toBe(0);
    expect(findHat(s, 'bob')).toEqual({ ok: true });
  });

  it('resets to hidden from the ground, clearing the spot', () => {
    const s = createHatState();
    findHat(s, 'alice');
    placeHat(s, 'alice', 1000);
    slipHat(s, 600, 300, 1000 + HAT_SLIP_MS);
    expect(s.status).toBe('ground');
    expect(resetHat(s)).toEqual({ ok: true });
    expect(s.status).toBe('hidden');
    expect(s.groundX).toBe(0);
    expect(s.groundY).toBe(0);
    expect(findHat(s, 'bob')).toEqual({ ok: true });
  });

  it('is a no-op on an already hidden hat', () => {
    const s = createHatState();
    expect(resetHat(s)).toEqual({ ok: true });
    expect(s.status).toBe('hidden');
  });

  it('refuses a bad state', () => {
    expect(resetHat(null)).toEqual({ ok: false, reason: 'bad-state' });
  });
});

describe('returnCarriedHat', () => {
  it('returns the hat to hidden when the carrier leaves', () => {
    const s = createHatState();
    findHat(s, 'alice');
    expect(returnCarriedHat(s, 'alice', false)).toEqual({ ok: true });
    expect(s.status).toBe('hidden');
    expect(s.carriedBy).toBe(null);
    // And it can be found again.
    expect(findHat(s, 'bob')).toEqual({ ok: true });
  });

  it('changes nothing when someone else leaves', () => {
    const s = createHatState();
    findHat(s, 'alice');
    expect(returnCarriedHat(s, 'bob', false))
      .toEqual({ ok: false, reason: 'not-yours' });
    expect(s.status).toBe('carried');
    expect(s.carriedBy).toBe('alice');
  });

  it('changes nothing when the carrier still has a socket in the room', () => {
    const s = createHatState();
    findHat(s, 'alice');
    expect(returnCarriedHat(s, 'alice', true))
      .toEqual({ ok: false, reason: 'still-here' });
    expect(s.status).toBe('carried');
    expect(s.carriedBy).toBe('alice');
  });

  it('changes nothing when the hat is not carried', () => {
    expect(returnCarriedHat(createHatState(), 'alice', false))
      .toEqual({ ok: false, reason: 'not-carried' });
    const s = createHatState();
    findHat(s, 'alice');
    placeHat(s, 'alice', 1000);
    expect(returnCarriedHat(s, 'alice', false))
      .toEqual({ ok: false, reason: 'not-carried' });
    expect(s.status).toBe('onCat');
  });

  it('refuses a bad state', () => {
    expect(returnCarriedHat(null, 'alice', false))
      .toEqual({ ok: false, reason: 'bad-state' });
  });
});

describe('full loop', () => {
  it('hidden -> carried -> onCat -> ground -> carried -> onCat', () => {
    const s = createHatState();
    expect(findHat(s, 'alice').ok).toBe(true);
    expect(placeHat(s, 'alice', 1000).ok).toBe(true);
    expect(slipHat(s, 600, 300, 1000 + HAT_SLIP_MS).ok).toBe(true);
    expect(pickupHat(s, 'bob').ok).toBe(true);
    expect(placeHat(s, 'bob', 5000).ok).toBe(true);
    expect(s.status).toBe('onCat');
    expect(s.slipAt).toBe(5000 + HAT_SLIP_MS);
  });
});

describe('serialize / parse', () => {
  it('round-trips every status', () => {
    for (const setup of [
      (s) => s,
      (s) => { findHat(s, 'alice'); return s; },
      (s) => { findHat(s, 'alice'); placeHat(s, 'alice', 1000); return s; },
      (s) => {
        findHat(s, 'alice');
        placeHat(s, 'alice', 1000);
        slipHat(s, 700, 400, 1000 + HAT_SLIP_MS);
        return s;
      },
    ]) {
      const s = setup(createHatState());
      const back = parseHatState(serializeHatState(s));
      expect(back.status).toBe(s.status);
      expect(back.carriedBy || '').toBe(s.carriedBy || '');
      expect(back.placedBy || '').toBe(s.placedBy || '');
    }
  });

  it('repairs junk: unknown status, carried without a carrier, onCat without a slip time', () => {
    expect(parseHatState({ status: 'banana' }).status).toBe('hidden');
    expect(parseHatState({ status: 'carried' }).status).toBe('hidden');
    expect(parseHatState({ status: 'onCat' }).status).toBe('hidden');
    expect(parseHatState(null).status).toBe('hidden');
    expect(parseHatState('nope').status).toBe('hidden');
  });
});
