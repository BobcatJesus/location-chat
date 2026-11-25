// presentState.test.js — Santa's Lost Present v1.1
// (`sq-santas-lost-present-v1.1`). Pure logic only: the Chicago
// date, the one-find-per-day rule, serialize/parse, and the
// date-keyed coin guard.

import { describe, it, expect } from 'vitest';
import {
  PRESENT_ID,
  PRESENT_MARKER,
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
    expect(PRESENT_MARKER).toBe('sq-santas-lost-present-v1.1');
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
  // (not hardcoded guesses): the hat spot, both ornament boxes,
  // the lights box + hang spots, the puzzle table, and — for the
  // present itself — Table 4, straight out of the Agora layout.
  it('sits inside the 1600x900 Agora bounds with room to stand', () => {
    expect(PRESENT_HIDE_SPOT.x).toBeGreaterThanOrEqual(PRESENT_ROOM_BOUNDS.xMin + 40);
    expect(PRESENT_HIDE_SPOT.x).toBeLessThanOrEqual(PRESENT_ROOM_BOUNDS.xMax - 40);
    expect(PRESENT_HIDE_SPOT.y).toBeGreaterThanOrEqual(PRESENT_ROOM_BOUNDS.yMin + 40);
    expect(PRESENT_HIDE_SPOT.y).toBeLessThanOrEqual(PRESENT_ROOM_BOUNDS.yMax - 40);
  });

  it('is under Table 4, at the table centre from the real Agora layout', async () => {
    const { agora } = await import('../src/village/layouts/agora.js');
    const { HAT_HIDE_SPOT } = await import('../src/village/hatState.js');
    const zones = agora.floors[0].zones;
    const table4 = zones.find((z) => z.type === 'cafe_table' && /Table 4/.test(z.label || ''));
    expect(table4).toBeTruthy();
    // The table is a static layout entry (always rendered — unlike
    // tree 2, which only appears after tree 1 completes), and a
    // cafe table is a 60px circle (r=30) centred on (x, y).
    expect(PRESENT_HIDE_SPOT.x).toBe(table4.x);
    expect(PRESENT_HIDE_SPOT.y).toBe(table4.y);
    // And the hat is the same shape at tree 1 (still there).
    const { TREE_SPOTS } = await import('../src/village/TrimTreeQuest.js');
    expect(HAT_HIDE_SPOT.x).toBe(TREE_SPOTS[0].x);
    expect(HAT_HIDE_SPOT.y).toBe(TREE_SPOTS[0].y - 34 - 16);
  });

  it('shares Table 4 with the note — same centre, by construction', async () => {
    // The note ('note-table4', ItemsSystem) resolves to
    // zoneCenter(Table 4), and cafe tables carry no w/h, so the
    // note's spot IS the table centre — exactly where the present
    // hides. One click under Table 4 counts toward both searches
    // (the trash-can precedent); the note is one-time per profile,
    // so after it is found the zone feeds the present alone.
    const { agora } = await import('../src/village/layouts/agora.js');
    const zones = agora.floors[0].zones;
    const table4 = zones.find((z) => z.type === 'cafe_table' && /Table 4/.test(z.label || ''));
    const noteSpot = { x: table4.x + (table4.w || 0) / 2, y: table4.y + (table4.h || 0) / 2 };
    expect(Math.hypot(PRESENT_HIDE_SPOT.x - noteSpot.x, PRESENT_HIDE_SPOT.y - noteSpot.y)).toBe(0);
  });

  it('is clear of the hat, both boxes, the lights, and the other tables', async () => {
    const { HAT_HIDE_SPOT } = await import('../src/village/hatState.js');
    const { TREE_BOX_POS, TREE_SPOTS } = await import('../src/village/TrimTreeQuest.js');
    const { LIGHTS_BOX_POS, LIGHTS_HANG_SPOTS } = await import('../src/village/ChristmasLightsQuest.js');
    const near = (p, min) => {
      const d = Math.hypot(PRESENT_HIDE_SPOT.x - p.x, PRESENT_HIDE_SPOT.y - p.y);
      expect(d).toBeGreaterThan(min);
    };
    near(HAT_HIDE_SPOT, 500); // the hat hides at tree 1
    near(TREE_BOX_POS, 150); // the ornament box
    near(LIGHTS_BOX_POS, 500); // the lights box
    for (const spot of LIGHTS_HANG_SPOTS) near(spot, 100); // every hang spot
    // The other cafe tables (Table 1 (300,280), Table 2
    // (1180,300), Table 3 (1260,640)) — Table 4 IS the spot now.
    for (const table of [{ x: 300, y: 280 }, { x: 1180, y: 300 }, { x: 1260, y: 640 }]) {
      near(table, 150);
    }
    // The SW plant (130,690 — puzzle piece 6) and the puzzle table (800,410).
    near({ x: 130, y: 690 }, 150);
    near({ x: 800, y: 410 }, 300);
    // And the old v1 spot — the foot of tree 2 (190,470) — the
    // present no longer hides there (tree 2 may not exist yet).
    near(TREE_SPOTS[1], 150);
  });
});
