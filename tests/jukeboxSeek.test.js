// jukeboxSeek.test.js — Jukebox Seek v1 (`sq-jukebox-seek-v1`).
// jukeboxElapsedSeconds turns the server's nowPlaying.startedAt into a
// clamped seek offset (whole seconds), so a late joiner — or a client
// rejoining after a restart — starts a YouTube song mid-song instead of
// at 0:00. The Phaser scene and the IFrame player itself are not tested
// here; the live check on a second device is the real verification.

import { describe, it, expect } from 'vitest';
import {
  JUKEBOX_SEEK_MAX_SECONDS,
  jukeboxElapsedSeconds,
} from '../src/village/YouTubePlayer.js';

describe('jukeboxElapsedSeconds', () => {
  const now = 1_700_000_000_000;

  it('returns 0 when startedAt is missing', () => {
    expect(jukeboxElapsedSeconds(undefined, now)).toBe(0);
    expect(jukeboxElapsedSeconds(null, now)).toBe(0);
  });

  it('returns 0 when startedAt is not a number', () => {
    expect(jukeboxElapsedSeconds('yesterday', now)).toBe(0);
    expect(jukeboxElapsedSeconds(NaN, now)).toBe(0);
    expect(jukeboxElapsedSeconds({}, now)).toBe(0);
  });

  it('returns 0 when the song has not started yet', () => {
    expect(jukeboxElapsedSeconds(now + 60_000, now)).toBe(0);
    expect(jukeboxElapsedSeconds(now, now)).toBe(0);
  });

  it('returns whole seconds elapsed', () => {
    expect(jukeboxElapsedSeconds(now - 60_000, now)).toBe(60);
    expect(jukeboxElapsedSeconds(now - 61_700, now)).toBe(61);
  });

  it('caps at the 10-minute server window', () => {
    expect(JUKEBOX_SEEK_MAX_SECONDS).toBe(600);
    expect(jukeboxElapsedSeconds(now - 700_000, now)).toBe(600);
    expect(jukeboxElapsedSeconds(now - 600_000, now)).toBe(600);
    expect(jukeboxElapsedSeconds(now - 599_000, now)).toBe(599);
  });

  it('returns 0 when now is unusable', () => {
    expect(jukeboxElapsedSeconds(now - 60_000, NaN)).toBe(0);
    // (undefined `now` intentionally falls back to Date.now() via the
    // default parameter, so it is not asserted here.)
  });
});
