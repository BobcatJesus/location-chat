// snowfall.test.js — Snowfall v1 (`sq-snowfall-v1`), v1.1 (`sq-snowfall-v1.1`).
//
// These tests cover the pure module only: the November +
// December gate (v1.1 widened it from December-only),
// the `?snow=` override, the outdoor gate (including Downtown
// Plaza), and the combined shouldSnow decision. The visual
// flake rendering itself has no unit tests — the live check on
// a phone / in the browser is the real verification for it.

import { describe, it, expect } from 'vitest';
import {
  isSnowMonth,
  snowOverride,
  isSnowOutdoor,
  shouldSnow,
} from '../src/village/snowfall.js';

// Midday Chicago times, so the UTC/Chicago offset can never
// flip the month on us.
const DEC_15 = new Date('2026-12-15T12:00:00-06:00');
const NOV_30 = new Date('2026-11-30T12:00:00-06:00');
const OCT_31 = new Date('2026-10-31T12:00:00-05:00');
const JAN_05 = new Date('2027-01-05T12:00:00-06:00');

describe('isSnowMonth', () => {
  it('snows in December', () => {
    expect(isSnowMonth(DEC_15)).toBe(true);
  });
  it('snows in November (v1.1)', () => {
    expect(isSnowMonth(NOV_30)).toBe(true);
  });
  it('does not snow in October', () => {
    expect(isSnowMonth(OCT_31)).toBe(false);
  });
  it('does not snow in January', () => {
    expect(isSnowMonth(JAN_05)).toBe(false);
  });
});

describe('snowOverride', () => {
  it('?snow=1 forces on', () => {
    expect(snowOverride('?snow=1')).toBe(true);
    expect(snowOverride('?foo=bar&snow=1')).toBe(true);
  });
  it('?snow=0 forces off', () => {
    expect(snowOverride('?snow=0')).toBe(false);
  });
  it('no param (or any other value) means no override', () => {
    expect(snowOverride('')).toBeUndefined();
    expect(snowOverride('?snow=2')).toBeUndefined();
    expect(snowOverride('?snow=yes')).toBeUndefined();
  });
});

describe('isSnowOutdoor', () => {
  it('parks are outdoor', () => {
    expect(isSnowOutdoor('shepherd-park', 'Shepherd Park', 'park', '')).toBe(true);
    expect(isSnowOutdoor('hermann-park', 'Hermann Park', 'park', '')).toBe(true);
    expect(isSnowOutdoor('forest-gate', 'Forest Gate', 'park', '')).toBe(true);
  });
  it('Downtown Plaza is outdoor even though "plaza" is not in the shared keyword list', () => {
    expect(isSnowOutdoor('downtown-hub', 'Downtown Plaza', '', '')).toBe(true);
  });
  it('the Agora is not outdoor', () => {
    expect(isSnowOutdoor('agora-houston', 'Agora', 'cafe', '')).toBe(false);
  });
  it('a shop is not outdoor', () => {
    expect(isSnowOutdoor('osm-123', 'Corner Store', 'convenience', 'shop')).toBe(false);
  });
});

describe('shouldSnow', () => {
  it('outdoor + December snows', () => {
    expect(shouldSnow({ outdoor: true, date: DEC_15 })).toBe(true);
  });
  it('indoor + December does not snow', () => {
    expect(shouldSnow({ outdoor: false, date: DEC_15 })).toBe(false);
  });
  it('outdoor + November snows (v1.1)', () => {
    expect(shouldSnow({ outdoor: true, date: NOV_30 })).toBe(true);
  });
  it('outdoor + October does not snow', () => {
    expect(shouldSnow({ outdoor: true, date: OCT_31 })).toBe(false);
  });
  it('?snow=1 forces snow on indoors, out of season', () => {
    expect(shouldSnow({ outdoor: false, date: NOV_30, override: true })).toBe(true);
  });
  it('?snow=0 forces snow off outdoors, in December', () => {
    expect(shouldSnow({ outdoor: true, date: DEC_15, override: false })).toBe(false);
  });
});
