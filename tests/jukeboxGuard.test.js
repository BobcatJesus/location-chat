// jukeboxGuard.test.js — Jukebox Guard v1 (`sq-jukebox-guard-v1`).
//
// The jukebox let any player paste any YouTube link and it played
// for the whole room — no check on what the video was, and no
// moderator way to pull a bad song. Two guards:
//   (1) the server checks the video with the YouTube Data API
//       before it goes in (Music category, under 10 minutes, not
//       age-restricted) and fails closed with no API key;
//   (2) moderators can remove one song or clear the queue.
// These tests cover the pure decision helpers (server/youtubeCheck.js
// and server/jukeboxPersist.js) — socket.js boots a server on
// import and cannot run in vitest. The handler wiring (add_song
// check, jukebox_remove_song / jukebox_clear in socket.js, the
// panel buttons) is verified by node --check + code read.

import { describe, it, expect, vi } from 'vitest';
import {
  parseIso8601Duration,
  decideYouTubeVideo,
  checkYouTubeVideo,
  YOUTUBE_MUSIC_CATEGORY_ID,
  YOUTUBE_MAX_DURATION_SECONDS,
  YOUTUBE_REFUSAL_MESSAGES,
} from '../server/youtubeCheck.js';
import {
  takeJukeboxSong,
  clearJukeboxState,
} from '../server/jukeboxPersist.js';
import {
  getVenuePermissions,
  buildModeratorEmails,
  OWNER_MODERATOR_EMAIL,
} from '../server/moderators.js';

const musicVideo = (overrides = {}) => ({
  id: 'dQw4w9WgXcQ',
  snippet: { categoryId: '10', title: 'A Song', channelTitle: 'An Artist', ...(overrides.snippet || {}) },
  contentDetails: { duration: 'PT3M30S', ...(overrides.contentDetails || {}) },
  status: { ...(overrides.status || {}) },
  ...(overrides.rest || {}),
});

describe('parseIso8601Duration', () => {
  it('parses minutes and seconds', () => {
    expect(parseIso8601Duration('PT3M30S')).toBe(210);
    expect(parseIso8601Duration('PT45S')).toBe(45);
  });

  it('parses hours', () => {
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3723);
  });

  it('parses days', () => {
    expect(parseIso8601Duration('P1DT2H')).toBe(93600);
  });

  it('accepts the 10-minute boundary exactly', () => {
    expect(parseIso8601Duration('PT10M')).toBe(600);
  });

  it('returns NaN for garbage', () => {
    expect(parseIso8601Duration('not-a-duration')).toBeNaN();
    expect(parseIso8601Duration('')).toBeNaN();
    expect(parseIso8601Duration(null)).toBeNaN();
    expect(parseIso8601Duration(undefined)).toBeNaN();
  });
});

describe('decideYouTubeVideo', () => {
  it('allows a music video under 10 minutes that is not age-restricted', () => {
    expect(decideYouTubeVideo(musicVideo())).toEqual({ ok: true });
  });

  it('allows a video exactly 10 minutes long', () => {
    expect(decideYouTubeVideo(musicVideo({ contentDetails: { duration: 'PT10M' } }))).toEqual({ ok: true });
  });

  it('refuses a non-music category', () => {
    expect(decideYouTubeVideo(musicVideo({ snippet: { categoryId: '22' } }))).toEqual({
      ok: false, reason: 'not-music',
    });
  });

  it('refuses an age-restricted video', () => {
    expect(decideYouTubeVideo(musicVideo({
      contentDetails: { duration: 'PT3M30S', contentRating: { ytRating: 'ytAgeRestricted' } },
    }))).toEqual({ ok: false, reason: 'age-restricted' });
  });

  it('refuses a video over 10 minutes', () => {
    expect(decideYouTubeVideo(musicVideo({ contentDetails: { duration: 'PT11M' } }))).toEqual({
      ok: false, reason: 'too-long',
    });
  });

  it('refuses a video with missing metadata', () => {
    expect(decideYouTubeVideo({})).toEqual({ ok: false, reason: 'not-found' });
    expect(decideYouTubeVideo({ snippet: { categoryId: '10' } })).toEqual({ ok: false, reason: 'not-found' });
    expect(decideYouTubeVideo(musicVideo({ contentDetails: { duration: 'junk' } }))).toEqual({
      ok: false, reason: 'not-found',
    });
  });

  it('keeps the guard constants in one place', () => {
    expect(YOUTUBE_MUSIC_CATEGORY_ID).toBe('10');
    expect(YOUTUBE_MAX_DURATION_SECONDS).toBe(600);
  });

  it('has a clear refusal message for every reason', () => {
    for (const reason of ['not-music', 'age-restricted', 'too-long', 'not-found', 'api-error', 'no-key']) {
      expect(typeof YOUTUBE_REFUSAL_MESSAGES[reason]).toBe('string');
      expect(YOUTUBE_REFUSAL_MESSAGES[reason].length).toBeGreaterThan(0);
    }
  });
});

describe('checkYouTubeVideo', () => {
  const apiKey = 'test-key';

  it('fails closed with no API key and never calls the network', async () => {
    const fetchImpl = vi.fn();
    const res = await checkYouTubeVideo('dQw4w9WgXcQ', { apiKey: '', fetchImpl });
    expect(res).toEqual({ ok: false, reason: 'no-key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed with a missing API key', async () => {
    const fetchImpl = vi.fn();
    const res = await checkYouTubeVideo('dQw4w9WgXcQ', { fetchImpl });
    expect(res).toEqual({ ok: false, reason: 'no-key' });
  });

  it('allows a music video from the API', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [musicVideo()] }),
    }));
    const res = await checkYouTubeVideo('dQw4w9WgXcQ', { apiKey, fetchImpl });
    expect(res).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain('dQw4w9WgXcQ');
    expect(url).toContain('youtube');
  });

  it('refuses when the API finds no video', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [] }),
    }));
    const res = await checkYouTubeVideo('nope1234567', { apiKey, fetchImpl });
    expect(res).toEqual({ ok: false, reason: 'not-found' });
  });

  it('refuses a non-music video from the API', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [musicVideo({ snippet: { categoryId: '20' } })] }),
    }));
    const res = await checkYouTubeVideo('dQw4w9WgXcQ', { apiKey, fetchImpl });
    expect(res).toEqual({ ok: false, reason: 'not-music' });
  });

  it('refuses when the API answers with an error', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    const res = await checkYouTubeVideo('dQw4w9WgXcQ', { apiKey, fetchImpl });
    expect(res).toEqual({ ok: false, reason: 'api-error' });
  });

  it('refuses when the network throws', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('boom'); });
    const res = await checkYouTubeVideo('dQw4w9WgXcQ', { apiKey, fetchImpl });
    expect(res).toEqual({ ok: false, reason: 'api-error' });
  });
});

describe('takeJukeboxSong', () => {
  const queued = (id) => ({ id, title: `Song ${id}`, votes: 0, votedBy: new Set(), createdAt: 1 });
  const state = () => ({
    queue: [queued('a'), queued('b'), queued('c')],
    nowPlaying: { id: 'np', title: 'Playing', startedAt: Date.now(), skipVotes: new Set() },
    timer: null,
  });

  it('removes a queued song and leaves the rest alone', () => {
    const st = state();
    const res = takeJukeboxSong(st, 'b');
    expect(res).toEqual({ removed: expect.objectContaining({ id: 'b' }), wasNowPlaying: false });
    expect(st.queue.map((s) => s.id)).toEqual(['a', 'c']);
    expect(st.nowPlaying.id).toBe('np');
  });

  it('takes the now-playing song and clears it so the caller advances', () => {
    const st = state();
    const res = takeJukeboxSong(st, 'np');
    expect(res).toEqual({ removed: expect.objectContaining({ id: 'np' }), wasNowPlaying: true });
    expect(st.nowPlaying).toBeNull();
    expect(st.queue.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('reports nothing removed for an unknown id', () => {
    const st = state();
    const res = takeJukeboxSong(st, 'zzz');
    expect(res).toEqual({ removed: null, wasNowPlaying: false });
    expect(st.queue).toHaveLength(3);
    expect(st.nowPlaying.id).toBe('np');
  });
});

describe('clearJukeboxState', () => {
  it('empties the queue and stops what is playing', () => {
    const st = {
      queue: [{ id: 'a' }, { id: 'b' }],
      nowPlaying: { id: 'np', title: 'Playing' },
      timer: null,
    };
    const res = clearJukeboxState(st);
    expect(res).toEqual({ hadNowPlaying: true, removedCount: 2 });
    expect(st.queue).toEqual([]);
    expect(st.nowPlaying).toBeNull();
  });

  it('is a no-op on an already-empty jukebox', () => {
    const st = { queue: [], nowPlaying: null, timer: null };
    const res = clearJukeboxState(st);
    expect(res).toEqual({ hadNowPlaying: false, removedCount: 0 });
  });
});

describe('moderator gate for jukebox remove/clear', () => {
  const ownerOf = () => '';
  // The head moderator is in the set even with no env var.
  const emails = buildModeratorEmails('');

  it('a non-moderator cannot manage the venue', () => {
    expect(getVenuePermissions('agora-houston', 'guest', emails, ownerOf).canManage).toBe(false);
    expect(getVenuePermissions('agora-houston', 'someone@example.com', emails, ownerOf).canManage).toBe(false);
  });

  it('the head moderator can manage any venue', () => {
    expect(getVenuePermissions('agora-houston', OWNER_MODERATOR_EMAIL, emails, ownerOf).canManage).toBe(true);
  });
});
