// strikeState.test.js — Notes Strike System v1
// (`sq-notes-strikes-v1`).
//
// Graduated strikes, moderator-decided, NEVER automatic:
// auto-hide (3 flags) hides a note but does NOT strike its
// author — a moderator reviews the flagged note and decides.
//   Strike 1: the note is removed + a warning. No mute.
//   Strike 2: the player cannot write notes for 24 hours.
//   Strike 3: the player cannot write notes for 7 days.
// Strikes expire 30 days after they are issued; expired strikes
// do not count. The mute is note-writing ONLY — the player can
// still play, chat, and do quests.
//
// These tests cover the pure mute logic
// (src/village/strikeState.js), which both sides import. The
// socket.js handler wiring (note_strike / note_clear_strikes /
// get_my_note_status, the note_drop mute enforcement) is verified
// by node --check + code read: socket.js boots a server on
// import and cannot run in vitest, same as the jukebox guard.

import { describe, it, expect } from 'vitest';
import {
  STRIKE_MARKER,
  STRIKE_EXPIRE_MS,
  STRIKE_MUTE_2_MS,
  STRIKE_MUTE_3_MS,
  cleanStrike,
  activeStrikes,
  computeNoteMute,
  muteUntilLabel,
  mutedRefusalMessage,
  strikeNoticeMessage,
  STRIKES_CLEARED_MESSAGE,
} from '../src/village/strikeState.js';

const NOW = 1800000000000; // a fixed "now" so every window is exact
const DAY = 24 * 60 * 60 * 1000;

function strike(n, struckAt = NOW, overrides = {}) {
  return {
    playerId: 'troll@example.com',
    noteId: `note-${n}`,
    struckBy: 'tfkelleher3@gmail.com',
    struckAt,
    expiresAt: struckAt + STRIKE_EXPIRE_MS,
    ...overrides,
  };
}

describe('constants', () => {
  it('carries the v1 marker and the builder-default durations', () => {
    expect(STRIKE_MARKER).toBe('sq-notes-strikes-v1');
    // Builder defaults (the user can change them): strikes live
    // 30 days, the 2nd-strike mute is 24h, the 3rd-strike mute
    // is 7 days.
    expect(STRIKE_EXPIRE_MS).toBe(30 * DAY);
    expect(STRIKE_MUTE_2_MS).toBe(DAY);
    expect(STRIKE_MUTE_3_MS).toBe(7 * DAY);
  });
});

describe('cleanStrike', () => {
  it('keeps a well-formed strike and normalises ids and times', () => {
    const s = cleanStrike(strike(1, NOW));
    expect(s).not.toBeNull();
    expect(s.playerId).toBe('troll@example.com');
    expect(s.noteId).toBe('note-1');
    expect(s.struckAt).toBe(NOW);
    expect(s.expiresAt).toBe(NOW + STRIKE_EXPIRE_MS);
  });

  it('returns null with no player or no struck time', () => {
    expect(cleanStrike({ ...strike(1), playerId: '' })).toBeNull();
    expect(cleanStrike({ ...strike(1), struckAt: 0 })).toBeNull();
    expect(cleanStrike(null)).toBeNull();
    expect(cleanStrike('nope')).toBeNull();
  });

  it('derives expiresAt from struckAt when it is missing', () => {
    const s = cleanStrike({ playerId: 'a@b.c', struckBy: 'm', struckAt: NOW });
    expect(s.expiresAt).toBe(NOW + STRIKE_EXPIRE_MS);
  });

  it('accepts Date objects for times (what pg returns for TIMESTAMPTZ)', () => {
    const s = cleanStrike({
      playerId: 'a@b.c', struckBy: 'm',
      struckAt: new Date(NOW), expiresAt: new Date(NOW + STRIKE_EXPIRE_MS),
    });
    expect(s.struckAt).toBe(NOW);
    expect(s.expiresAt).toBe(NOW + STRIKE_EXPIRE_MS);
  });
});

describe('activeStrikes', () => {
  it('keeps only unexpired strikes, oldest first', () => {
    const list = [
      strike(2, NOW - DAY),
      strike(1, NOW - 2 * DAY),
      // Expired 30 days ago — dead, does not count.
      strike(0, NOW - 31 * DAY),
    ];
    const active = activeStrikes(list, NOW);
    expect(active.map((s) => s.noteId)).toEqual(['note-1', 'note-2']);
  });

  it('drops malformed entries', () => {
    expect(activeStrikes([null, 'x', strike(1)], NOW)).toHaveLength(1);
    expect(activeStrikes(null, NOW)).toEqual([]);
  });
});

describe('computeNoteMute', () => {
  it('0 strikes: not muted', () => {
    expect(computeNoteMute([], NOW)).toEqual({ muted: false, mutedUntil: 0, activeCount: 0 });
  });

  it('1 strike: warning only, NOT muted', () => {
    const res = computeNoteMute([strike(1, NOW - 1000)], NOW);
    expect(res.muted).toBe(false);
    expect(res.activeCount).toBe(1);
    expect(res.mutedUntil).toBe(0);
  });

  it('2 strikes: muted 24h from the LATEST strike', () => {
    const first = NOW - 2 * DAY;
    const second = NOW - 60 * 60 * 1000;
    const res = computeNoteMute([strike(1, first), strike(2, second)], NOW);
    expect(res.muted).toBe(true);
    expect(res.activeCount).toBe(2);
    expect(res.mutedUntil).toBe(second + STRIKE_MUTE_2_MS);
  });

  it('3 strikes: muted 7 days from the LATEST strike', () => {
    const res = computeNoteMute([
      strike(1, NOW - 3 * DAY),
      strike(2, NOW - 2 * DAY),
      strike(3, NOW - 60 * 60 * 1000),
    ], NOW);
    expect(res.muted).toBe(true);
    expect(res.activeCount).toBe(3);
    expect(res.mutedUntil).toBe(NOW - 60 * 60 * 1000 + STRIKE_MUTE_3_MS);
  });

  it('a new strike while already at 2+ extends the mute from the new strike', () => {
    const before = computeNoteMute([strike(1, NOW - 2 * DAY), strike(2, NOW - 23 * 60 * 60 * 1000)], NOW);
    expect(before.muted).toBe(true);
    // The 3rd strike lands now: the mute restarts from now, for 7 days.
    const after = computeNoteMute([
      strike(1, NOW - 2 * DAY),
      strike(2, NOW - 23 * 60 * 60 * 1000),
      strike(3, NOW),
    ], NOW);
    expect(after.mutedUntil).toBe(NOW + STRIKE_MUTE_3_MS);
    expect(after.mutedUntil).toBeGreaterThan(before.mutedUntil);
  });

  it('the mute window can run out while the strikes are still active', () => {
    // Two strikes, the latest 2 days ago: the 24h mute is over,
    // but both strikes still count until they expire at 30 days.
    const res = computeNoteMute([strike(1, NOW - 3 * DAY), strike(2, NOW - 2 * DAY)], NOW);
    expect(res.muted).toBe(false);
    expect(res.activeCount).toBe(2);
    expect(res.mutedUntil).toBe(NOW - 2 * DAY + STRIKE_MUTE_2_MS);
  });

  it('expired strikes do not count — even a 3-strike history is clean after 30 days', () => {
    const old = [strike(1, NOW - 31 * DAY), strike(2, NOW - 32 * DAY), strike(3, NOW - 33 * DAY)];
    expect(computeNoteMute(old, NOW)).toEqual({ muted: false, mutedUntil: 0, activeCount: 0 });
  });

  it('an expired strike plus one fresh strike is warning-only, not muted', () => {
    const res = computeNoteMute([strike(1, NOW - 31 * DAY), strike(2, NOW - 1000)], NOW);
    expect(res.muted).toBe(false);
    expect(res.activeCount).toBe(1);
  });
});

describe('muteUntilLabel + messages', () => {
  it('labels the wait in minutes, hours, or days — never a raw timestamp', () => {
    expect(muteUntilLabel(NOW + 30 * 60 * 1000, NOW)).toMatch(/30 minutes/);
    expect(muteUntilLabel(NOW + 5 * 60 * 60 * 1000, NOW)).toMatch(/5 hours/);
    expect(muteUntilLabel(NOW + 3 * DAY, NOW)).toMatch(/3 days/);
    expect(muteUntilLabel(NOW - 1000, NOW)).toBe('already over');
  });

  it('the muted refusal says why and when, in plain words', () => {
    const msg = mutedRefusalMessage(NOW + 2 * DAY, NOW);
    expect(msg).toMatch(/can't leave notes right now/);
    expect(msg).toMatch(/breaking the rules/);
    expect(msg).toMatch(/2 days/);
  });

  it('the strike notice escalates with the count', () => {
    const first = strikeNoticeMessage({ strikeCount: 1, muted: false, mutedUntil: 0 }, NOW);
    expect(first).toMatch(/strike 1/);
    expect(first).toMatch(/warning/i);
    expect(first).not.toMatch(/can't leave notes/);
    const second = strikeNoticeMessage({ strikeCount: 2, muted: true, mutedUntil: NOW + DAY }, NOW);
    expect(second).toMatch(/strike 2/);
    expect(second).toMatch(/24 hours/);
    const third = strikeNoticeMessage({ strikeCount: 3, muted: true, mutedUntil: NOW + 7 * DAY }, NOW);
    expect(third).toMatch(/strike 3/);
    expect(third).toMatch(/7 days/);
  });

  it('the cleared message says notes are open again', () => {
    expect(STRIKES_CLEARED_MESSAGE).toMatch(/cleared/i);
    expect(STRIKES_CLEARED_MESSAGE).toMatch(/leave notes again/);
  });
});
