// presentState.test.js — Santa's Lost Present v1
// (`sq-santas-lost-present-v1`). Pure logic only: the Chicago
// date, the one-find-per-day rule, serialize/parse, and the
// date-keyed coin guard.

import { describe, it, expect } from 'vitest';
import {
  PRESENT_ID,
  PRESENT_MARKER_V1,
  PRESENT_REWARD_COINS,
  PRESENT_SEARCH_CLICKS,
  PRESENT_SEARCH_RANGE,
  PRESENT_HIDE_RADIUS,
  PRESENT_HIDE_SPOT,
  PRESENT_ROOM_BOUNDS,
  chicagoDateString,
  isDateString,
  createPresentState,
  foundToday,
  findPresent,
  serializePresentState,
  parsePresentState,
  owedPresentFind,
} from '../src/village/presentState.js';

describe('identity + constants', () => {
  it('is the santas-lost-present quest', () => {
    expect(PRESENT_ID).toBe('santas-lost-present');
    expect(PRESENT_MARKER_V1).toBe('sq-santas-lost-present-v1');
  });

  it('pays 5 coins per find (builder default)', () => {
    expect(PRESENT_REWARD_COINS).toBe(5);
  });

  it('finds in 3 clicks within 140px, click zone 50px', () => {
    expect(PRESENT_SEARCH_CLICKS).toBe(3);
    expect(PRESENT_SEARCH_RANGE).toBe(140);
    expect(PRESENT_HIDE_RADIUS).toBe(50);
  });
});

describe('chicagoDateString', () => {
  it('is the Chicago wall-clock date, not UTC', () => {
    // 06:00 UTC on Dec 25 is midnight CST (UTC-6) — still Dec 25.
    expect(chicagoDateString(new Date('2026-12-25T06:00:00Z'))).toBe('2026-12-25');
    // 05:30 UTC on Dec 25 is 23:30 CST on Dec 24 — the day before.
    expect(chicagoDateString(new Date('2026-12-25T05:30:00Z'))).toBe('2026-12-24');
  });

  it('follows daylight time in summer (CDT, UTC-5)', () => {
    // 05:00 UTC on Jun 1 is midnight CDT — Jun 1.
    expect(chicagoDateString(new Date('2026-06-01T05:00:00Z'))).toBe('2026-06-01');
    // 04:30 UTC on Jun 1 is 23:30 CDT on May 31.
    expect(chicagoDateString(new Date('2026-06-01T04:30:00Z'))).toBe('2026-05-31');
  });

  it('validates date strings', () => {
    expect(isDateString('2026-12-25')).toBe(true);
    expect(isDateString('2026-1-5')).toBe(false);
    expect(isDateString('')).toBe(false);
    expect(isDateString(null)).toBe(false);
    expect(isDateString(20261225)).toBe(false);
  });
});

describe('findPresent — one find per player per Chicago day', () => {
  it('a first find lands', () => {
    const s = createPresentState();
    expect(findPresent(s, 'u1', '2026-12-25')).toEqual({ ok: true });
    expect(foundToday(s, 'u1', '2026-12-25')).toBe(true);
  });

  it('a second find the same day is refused', () => {
    const s = createPresentState();
    findPresent(s, 'u1', '2026-12-25');
    expect(findPresent(s, 'u1', '2026-12-25')).toEqual({ ok: false, reason: 'already-found-today' });
    expect(foundToday(s, 'u1', '2026-12-25')).toBe(true);
  });

  it('the next day the same player can find it again', () => {
    const s = createPresentState();
    findPresent(s, 'u1', '2026-12-25');
    expect(findPresent(s, 'u1', '2026-12-26')).toEqual({ ok: true });
    expect(foundToday(s, 'u1', '2026-12-25')).toBe(false);
    expect(foundToday(s, 'u1', '2026-12-26')).toBe(true);
  });

  it('one player finding it does not block another', () => {
    const s = createPresentState();
    findPresent(s, 'u1', '2026-12-25');
    expect(findPresent(s, 'u2', '2026-12-25')).toEqual({ ok: true });
  });

  it('refuses a missing user or a bad date', () => {
    const s = createPresentState();
    expect(findPresent(s, '', '2026-12-25')).toEqual({ ok: false, reason: 'bad-user' });
    expect(findPresent(s, 'u1', 'not-a-date')).toEqual({ ok: false, reason: 'bad-date' });
    expect(findPresent(null, 'u1', '2026-12-25')).toEqual({ ok: false, reason: 'bad-state' });
  });
});

describe('serialize / parse', () => {
  it('round-trips today’s finders', () => {
    const s = createPresentState();
    findPresent(s, 'u1', '2026-12-25');
    findPresent(s, 'u2', '2026-12-25');
    const wire = serializePresentState(s, '2026-12-25');
    expect(wire).toEqual({ foundBy: { u1: '2026-12-25', u2: '2026-12-25' }, date: '2026-12-25' });
    expect(parsePresentState(wire)).toEqual({ foundBy: { u1: '2026-12-25', u2: '2026-12-25' } });
  });

  it('serialize prunes yesterday’s finders — they never ride the wire', () => {
    const s = createPresentState();
    findPresent(s, 'u1', '2026-12-24');
    findPresent(s, 'u2', '2026-12-25');
    expect(serializePresentState(s, '2026-12-25')).toEqual({
      foundBy: { u2: '2026-12-25' },
      date: '2026-12-25',
    });
  });

  it('parse repairs junk to a fresh state', () => {
    expect(parsePresentState(null)).toEqual({ foundBy: {} });
    expect(parsePresentState({ foundBy: { u1: 'junk' } })).toEqual({ foundBy: {} });
    expect(parsePresentState({ foundBy: 'nope' })).toEqual({ foundBy: {} });
    expect(parsePresentState({})).toEqual({ foundBy: {} });
  });
});

describe('owedPresentFind — the date-keyed coin guard', () => {
  it('owes one payment for a fresh find', () => {
    expect(owedPresentFind('2026-12-25', '')).toEqual({ owed: 1, newPaid: '2026-12-25' });
    expect(owedPresentFind('2026-12-25', undefined)).toEqual({ owed: 1, newPaid: '2026-12-25' });
  });

  it('owes nothing when today is already paid', () => {
    expect(owedPresentFind('2026-12-25', '2026-12-25')).toEqual({ owed: 0, newPaid: '2026-12-25' });
  });

  it('owes one payment again the next day', () => {
    expect(owedPresentFind('2026-12-26', '2026-12-25')).toEqual({ owed: 1, newPaid: '2026-12-26' });
  });

  it('owes nothing for a bad date', () => {
    expect(owedPresentFind('junk', '')).toEqual({ owed: 0, newPaid: '' });
  });
});

describe('hiding spot — inside the Agora and clear of the room', () => {
  // The REAL Agora spots, imported from the modules that own them
  // (not hardcoded guesses): tree 1 + tree 2, both ornament boxes,
  // the lights box + hang spots, the hat spot, the puzzle table.
  it('sits inside the 1600x900 Agora bounds with room to stand', () => {
    expect(PRESENT_HIDE_SPOT.x).toBeGreaterThanOrEqual(PRESENT_ROOM_BOUNDS.xMin + 40);
    expect(PRESENT_HIDE_SPOT.x).toBeLessThanOrEqual(PRESENT_ROOM_BOUNDS.xMax - 40);
    expect(PRESENT_HIDE_SPOT.y).toBeGreaterThanOrEqual(PRESENT_ROOM_BOUNDS.yMin + 40);
    expect(PRESENT_HIDE_SPOT.y).toBeLessThanOrEqual(PRESENT_ROOM_BOUNDS.yMax - 40);
  });

  it('is the foot of tree 2, mirroring the hat at tree 1', async () => {
    const { TREE_SPOTS } = await import('../src/village/TrimTreeQuest.js');
    const { HAT_HIDE_SPOT } = await import('../src/village/hatState.js');
    const tree2 = TREE_SPOTS[1];
    // 16px north of tree 2's trunk top (trunk top = spot y - 34),
    // centred on the trunk's x — the same derivation as the hat.
    expect(PRESENT_HIDE_SPOT.x).toBe(tree2.x);
    expect(PRESENT_HIDE_SPOT.y).toBe(tree2.y - 34 - 16);
    // And the hat is the same shape at tree 1.
    expect(HAT_HIDE_SPOT.x).toBe(TREE_SPOTS[0].x);
    expect(HAT_HIDE_SPOT.y).toBe(TREE_SPOTS[0].y - 34 - 16);
  });

  it('is clear of the hat, both boxes, the lights, and the tables', async () => {
    const { HAT_HIDE_SPOT } = await import('../src/village/hatState.js');
    const { TREE_BOX_POS } = await import('../src/village/TrimTreeQuest.js');
    const { LIGHTS_BOX_POS, LIGHTS_HANG_SPOTS } = await import('../src/village/ChristmasLightsQuest.js');
    const near = (p, min) => {
      const d = Math.hypot(PRESENT_HIDE_SPOT.x - p.x, PRESENT_HIDE_SPOT.y - p.y);
      expect(d).toBeGreaterThan(min);
    };
    near(HAT_HIDE_SPOT, 500); // the hat hides at tree 1
    near(TREE_BOX_POS, 150); // the ornament box
    near(LIGHTS_BOX_POS, 500); // the lights box
    for (const spot of LIGHTS_HANG_SPOTS) near(spot, 100); // every hang spot
    // Cafe tables (TrimTreeQuest builder comment): Table 1
    // (300,280), Table 3 (1260,640), Table 4 (300,640).
    for (const table of [{ x: 300, y: 280 }, { x: 1260, y: 640 }, { x: 300, y: 640 }]) {
      near(table, 150);
    }
    // The SW plant (130,690 — puzzle piece 6) and the puzzle table (800,410).
    near({ x: 130, y: 690 }, 150);
    near({ x: 800, y: 410 }, 300);
  });
});
