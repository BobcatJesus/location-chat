// mailState.test.js — Mailbox v1 (`sq-mailbox-v1`).
//
// Pure-logic tests for the mailbox code, the sendable-item rules,
// the inbox (send / collect / cap), and the nearest-park
// resolution with its open-access fallback.

import { describe, expect, it } from 'vitest';
import {
  MAIL_CODE_ALPHABET,
  MAIL_CODE_LENGTH,
  MAIL_MAX_PER_INBOX,
  MAILBOX_PARK_RANGE_M,
  mailboxCodeFor,
  normalizeMailboxCode,
  isValidMailboxCode,
  cleanMailItem,
  cleanPackage,
  createMailState,
  sendPackage,
  collectPackage,
  serializeMailState,
  parseMailState,
  isParkRoom,
  resolveMailboxRoom,
  resolveMailboxSpot,
} from '../src/village/mailState.js';

const PARK_A = { id: 'park-a', name: 'Park A', lat: 29.8, lng: -95.4, amenity: 'park' };
const PARK_B = { id: 'park-b', name: 'Park B', lat: 29.9, lng: -95.5, amenity: 'park' };
const LIBRARY = { id: 'md-anderson-library', name: 'Library', lat: 29.72, lng: -95.34 };
const AGORA = { id: 'agora-houston', name: 'Agora', lat: 29.74, lng: -95.4 };
const ROOMS = [PARK_A, PARK_B, LIBRARY, AGORA];

const NOTE = { id: 'note-1', type: 'note', label: 'Note', blurb: 'hi', text: 'hello' };

function pkg(id, item = NOTE) {
  return { id, fromUserId: 'a@b.c', fromName: 'Alice', item, sentAt: 1 };
}

describe('mailbox code', () => {
  it('is 5 readable characters, with no lookalikes', () => {
    const code = mailboxCodeFor('tfkelleher3@gmail.com');
    expect(code).toHaveLength(MAIL_CODE_LENGTH);
    for (const ch of code) expect(MAIL_CODE_ALPHABET).toContain(ch);
    expect(code).not.toMatch(/[01IL]/);
  });

  it('is stable across sessions and case-insensitive', () => {
    expect(mailboxCodeFor('User@Example.com')).toBe(mailboxCodeFor('user@example.com'));
    expect(mailboxCodeFor('user@example.com')).toBe(mailboxCodeFor('user@example.com'));
  });

  it('is distinct per player', () => {
    const codes = new Set([
      mailboxCodeFor('alice@example.com'),
      mailboxCodeFor('bob@example.com'),
      mailboxCodeFor('carol@example.com'),
      mailboxCodeFor('dave@example.com'),
      mailboxCodeFor('erin@example.com'),
    ]);
    expect(codes.size).toBe(5);
  });

  it('normalizes typed codes (lowercase, junk stripped, max 5)', () => {
    // '1' is not in the alphabet (no 1/I/L lookalikes), so it is
    // stripped along with the dash.
    expect(normalizeMailboxCode('ab12-')).toBe('AB2');
    expect(normalizeMailboxCode('ab23-')).toBe('AB23');
    expect(normalizeMailboxCode('  abcde f ')).toBe('ABCDE');
    expect(normalizeMailboxCode('abcdef')).toBe('ABCDE');
    expect(isValidMailboxCode('ABCDE')).toBe(true);
    expect(isValidMailboxCode('ABC')).toBe(false);
    expect(isValidMailboxCode('')).toBe(false);
  });
});

describe('cleanMailItem', () => {
  it('accepts ordinary pocket items', () => {
    expect(cleanMailItem(NOTE)).toMatchObject({ id: 'note-1', type: 'note' });
    expect(cleanMailItem({ id: 'f1', type: 'flyer', title: 'T', text: 'x' })).toMatchObject({ type: 'flyer' });
  });

  it('refuses puzzle pieces, the Santa hat and the mailbox key', () => {
    expect(cleanMailItem({ id: 'p1', type: 'puzzle-piece', pieceId: 0 })).toBeNull();
    expect(cleanMailItem({ id: 'h1', type: 'santa-hat' })).toBeNull();
    expect(cleanMailItem({ id: 'k1', type: 'mailbox-key' })).toBeNull();
  });

  it('refuses items with no id or no type', () => {
    expect(cleanMailItem({ type: 'note' })).toBeNull();
    expect(cleanMailItem({ id: 'x' })).toBeNull();
    expect(cleanMailItem(null)).toBeNull();
  });

  it('never lets a pieceId travel', () => {
    const cleaned = cleanMailItem({ id: 'n1', type: 'note', pieceId: 3 });
    expect(cleaned.pieceId).toBeNull();
  });
});

describe('inbox (send / collect / cap)', () => {
  it('sends and collects a package', () => {
    const state = createMailState();
    const sent = sendPackage(state, pkg('mail-1'));
    expect(sent.ok).toBe(true);
    expect(state.packages).toHaveLength(1);
    const taken = collectPackage(state, 'mail-1');
    expect(taken.ok).toBe(true);
    expect(taken.package.item.type).toBe('note');
    expect(state.packages).toHaveLength(0);
  });

  it('refuses a collect for an unknown package id', () => {
    const state = createMailState();
    expect(collectPackage(state, 'nope')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('refuses a duplicate package id (a replayed emit)', () => {
    const state = createMailState();
    expect(sendPackage(state, pkg('mail-1')).ok).toBe(true);
    expect(sendPackage(state, pkg('mail-1'))).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('refuses a bad package (unsendable item) without adding it', () => {
    const state = createMailState();
    const res = sendPackage(state, pkg('mail-1', { id: 'p1', type: 'puzzle-piece' }));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('bad-package');
    expect(state.packages).toHaveLength(0);
  });

  it(`caps the inbox at ${MAIL_MAX_PER_INBOX} — the 21st send is refused, never silently dropped`, () => {
    const state = createMailState();
    for (let i = 0; i < MAIL_MAX_PER_INBOX; i += 1) {
      expect(sendPackage(state, pkg(`mail-${i}`)).ok).toBe(true);
    }
    const res = sendPackage(state, pkg('mail-overflow'));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('inbox-full');
    expect(state.packages).toHaveLength(MAIL_MAX_PER_INBOX);
    expect(state.packages[0].id).toBe('mail-0');
  });

  it('round-trips through serialize / parse, and parse drops bad entries', () => {
    const state = createMailState();
    sendPackage(state, pkg('mail-1'));
    const parsed = parseMailState(serializeMailState(state));
    expect(parsed.packages).toHaveLength(1);
    expect(parsed.packages[0].fromName).toBe('Alice');
    const dirty = parseMailState({
      packages: [
        pkg('good'),
        pkg('bad-piece', { id: 'p1', type: 'puzzle-piece' }),
        { id: '', item: NOTE },
        pkg('good'),
      ],
    });
    expect(dirty.packages.map((p) => p.id)).toEqual(['good']);
  });
});

describe('isParkRoom', () => {
  it('counts featured parks (amenity), OSM leisure tags and OSM metadata', () => {
    expect(isParkRoom({ amenity: 'park' })).toBe(true);
    expect(isParkRoom({ amenity: 'Park' })).toBe(true);
    expect(isParkRoom({ tags: { leisure: 'park' } })).toBe(true);
    expect(isParkRoom({ tags: { amenity: 'park' } })).toBe(true);
    expect(isParkRoom({ metadata: { osmCategory: 'park' } })).toBe(true);
  });

  it('does not count cafes, libraries or user rooms without a park tag', () => {
    expect(isParkRoom({ id: 'agora-houston', name: 'Agora' })).toBe(false);
    expect(isParkRoom({ id: 'user-1', name: 'My Park', kind: 'user-created' })).toBe(false);
    expect(isParkRoom(null)).toBe(false);
  });
});

describe('resolveMailboxRoom', () => {
  it('picks the nearest park room within range', () => {
    const res = resolveMailboxRoom(ROOMS, { latitude: 29.8005, longitude: -95.4005 });
    expect(res.roomId).toBe('park-a');
    expect(res.isPark).toBe(true);
    expect(res.distanceM).toBeLessThan(MAILBOX_PARK_RANGE_M);
  });

  it('picks the nearer of two parks', () => {
    const res = resolveMailboxRoom(ROOMS, { latitude: 29.899, longitude: -95.499 });
    expect(res.roomId).toBe('park-b');
  });

  it('falls back to the nearest open-access room when no park is close', () => {
    // Far from every Houston room: the fallback must still be
    // reachable for every player. Agora IS open-access (like the
    // Library and Lola's), so it is the nearest fallback here.
    const res = resolveMailboxRoom(ROOMS, { latitude: 31.0, longitude: -97.0 });
    expect(res).not.toBeNull();
    expect(res.isPark).toBe(false);
    expect(res.roomId).toBe('agora-houston');
  });

  it('falls back when the only park is beyond range', () => {
    const far = [{ id: 'far-park', name: 'Far Park', lat: 30.5, lng: -96.0, amenity: 'park' }, LIBRARY, AGORA];
    const res = resolveMailboxRoom(far, { latitude: 29.8, longitude: -95.4 });
    expect(res.roomId).toBe('agora-houston');
    expect(res.isPark).toBe(false);
  });

  it('defaults to the first park room with no location at all', () => {
    const res = resolveMailboxRoom(ROOMS, null);
    expect(res.roomId).toBe('park-a');
    expect(res.isPark).toBe(true);
    expect(res.distanceM).toBeNull();
  });

  it('returns null when there is no room at all', () => {
    expect(resolveMailboxRoom([], { latitude: 29.8, longitude: -95.4 })).toBeNull();
    expect(resolveMailboxRoom(null, null)).toBeNull();
  });
});

describe('resolveMailboxSpot', () => {
  const bounds = { x: 0, y: 0, w: 1600, h: 900 };
  const inside = () => true;

  it('sits east of the entry (the notice board takes the west side)', () => {
    const spot = resolveMailboxSpot({
      entry: { x: 700, y: 780, w: 200, h: 40 },
      spawn: { x: 800, y: 750 },
      bounds,
      isInside: inside,
    });
    expect(spot.x).toBeGreaterThan(900);
    expect(spot.y).toBe(770);
    expect(spot.w).toBeGreaterThan(0);
    expect(spot.h).toBeGreaterThan(0);
  });

  it('falls back to near the spawn with no entry', () => {
    const spot = resolveMailboxSpot({ spawn: { x: 800, y: 750 }, bounds, isInside: inside });
    expect(spot.x).toBe(940);
    // 750 + 60 = 810, clamped to the bounds (900 - 84 - 20 = 796).
    expect(spot.y).toBe(796);
  });

  it('always returns a spot inside the bounds, even with nothing to anchor on', () => {
    const spot = resolveMailboxSpot({ bounds, isInside: inside });
    expect(spot.x).toBeGreaterThanOrEqual(20);
    expect(spot.y).toBeGreaterThanOrEqual(20);
    expect(spot.x + spot.w).toBeLessThanOrEqual(1580);
    expect(spot.y + spot.h).toBeLessThanOrEqual(880);
  });
});

describe('cleanPackage', () => {
  it('trims the sender name and caps it', () => {
    const cleaned = cleanPackage(pkg('m1'));
    expect(cleaned.fromName).toBe('Alice');
    const long = cleanPackage({ ...pkg('m2'), fromName: '  x'.repeat(100) });
    expect(long.fromName.length).toBeLessThanOrEqual(80);
  });
});
