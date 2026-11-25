// jukeboxSoloSkip.test.js — Jukebox Solo Skip v1
// (`sq-jukebox-solo-skip-v1`).
//
// Skipping needed 2 votes, so a player ALONE in a room could never
// skip someone else's song — one vote, two needed, adder gone.
// The middle-ground fix: one vote is enough when the room holds a
// single player; otherwise the usual 2 distinct votes. The adder
// still skips outright, alone, instantly.
//
// These tests cover the pure decision helpers
// (server/jukeboxPersist.js) — socket.js boots a server on import
// and cannot run in vitest. The handler wiring (skip_song in
// socket.js, roomSize in publicJukeboxState, the panel label) is
// verified by node --check + code read. The house-song bench is
// untouched code: a solo skip goes through the same benchDefault()
// + advanceJukebox() branch as a 2-vote skip.

import { describe, it, expect } from 'vitest';
import {
  SKIP_VOTES_NEEDED,
  votesNeededToSkip,
  shouldSkipSong,
} from '../server/jukeboxPersist.js';

describe('votesNeededToSkip', () => {
  it('needs 1 vote when alone in the room', () => {
    expect(votesNeededToSkip(1)).toBe(1);
  });

  it('needs 1 vote for a degenerate room size', () => {
    expect(votesNeededToSkip(0)).toBe(1);
    expect(votesNeededToSkip(undefined)).toBe(1);
    expect(votesNeededToSkip(NaN)).toBe(1);
  });

  it('needs 2 votes with anyone else in the room', () => {
    expect(votesNeededToSkip(2)).toBe(2);
    expect(votesNeededToSkip(5)).toBe(2);
  });

  it('keeps the 2-vote default in one place', () => {
    expect(SKIP_VOTES_NEEDED).toBe(2);
    expect(votesNeededToSkip(2)).toBe(SKIP_VOTES_NEEDED);
  });
});

describe('shouldSkipSong', () => {
  it('the adder always skips outright, even with no votes', () => {
    expect(shouldSkipSong({ skipVotes: 0, roomSize: 5, isAdder: true })).toBe(true);
  });

  it('a solo vote skips when alone in the room', () => {
    expect(shouldSkipSong({ skipVotes: 1, roomSize: 1, isAdder: false })).toBe(true);
  });

  it('no votes means no skip, even alone', () => {
    expect(shouldSkipSong({ skipVotes: 0, roomSize: 1, isAdder: false })).toBe(false);
  });

  it('one vote does not skip with two people in the room', () => {
    expect(shouldSkipSong({ skipVotes: 1, roomSize: 2, isAdder: false })).toBe(false);
  });

  it('two votes skip with two or more people in the room', () => {
    expect(shouldSkipSong({ skipVotes: 2, roomSize: 2, isAdder: false })).toBe(true);
    expect(shouldSkipSong({ skipVotes: 2, roomSize: 5, isAdder: false })).toBe(true);
  });
});
