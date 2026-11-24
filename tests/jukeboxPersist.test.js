// jukeboxPersist.test.js — Jukebox now-playing persistence
// (`sq-jukebox-persist-v1`).
//
// Piece 8 of the room-state persistence fix — the last one. The
// queue already persists (jukebox_songs table), but what was
// playing RIGHT NOW did not: a restart cut the current song off
// mid-play, and because the song had already been marked
// played=TRUE when it started, the queue SELECT excludes it, so
// it never came back — skipped entirely, unheard to the end.
// These helpers save a snapshot of the now-playing song (plus
// skip votes, the house-song cooldown, and the queue's votedBy
// flags) to Postgres on every advance, skip, and vote, and load
// it back lazily, so a restart resumes the same song for its
// remaining time instead of skipping it.
//
// These tests cover the persistence layer
// (server/jukeboxPersist.js) against a fake in-memory pool —
// no real Postgres needed. The socket.js wiring
// (ensureJukeboxNowPlayingLoaded / persistJukebox in
// loadJukebox, advanceJukebox, vote_song, skip_song) is verified
// by node --check + code read: socket.js boots a server on
// import and cannot run in vitest. The remaining-time math is
// tested through the REAL jukeboxRemainingMs helper, not a
// reimplementation.

import { describe, it, expect } from 'vitest';
import {
  JUKEBOX_PERSIST_MARKER,
  JUKEBOX_ROOM_STATE_TABLE,
  JUKEBOX_ROOM_STATE_TABLE_SQL,
  JUKEBOX_MIN_REMAINING_MS,
  createJukeboxRoomState,
  serializeJukeboxRoomState,
  parseJukeboxRoomState,
  jukeboxRemainingMs,
  saveJukeboxNowPlaying,
  loadJukeboxNowPlaying,
} from '../server/jukeboxPersist.js';

// Tiny in-memory stand-in for a pg Pool: one Map keyed by room_id,
// answering only the two queries the persistence layer issues.
function makeFakePool(initial = {}) {
  const store = new Map(Object.entries(initial));
  const queries = [];
  return {
    store,
    queries,
    async query(text, params = []) {
      queries.push({ text, params });
      const sql = String(text);
      if (/SELECT data FROM jukebox_room_state/i.test(sql)) {
        const data = store.get(params[0]);
        return { rows: data !== undefined ? [{ data }] : [] };
      }
      if (/INSERT INTO jukebox_room_state/i.test(sql)) {
        store.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

const ROOM = 'lolas-depot';
const OTHER_ROOM = 'agora-houston';

// Fixed clock: 2026-11-24 20:00:00 UTC.
const STARTED_AT = Date.UTC(2026, 10, 24, 20, 0, 0);
const ONE_MIN_LATER = STARTED_AT + 60 * 1000;

function midSongState() {
  return {
    nowPlaying: {
      id: 'song-abc',
      title: 'Test Song',
      artist: 'Test Artist',
      addedBy: 'alice@test',
      addedByName: 'Alice',
      youtubeVideoId: 'dQw4w9WgXcQ',
      startedAt: STARTED_AT,
      skipVotes: ['alice@test'],
    },
    defaultCooldownUntil: null,
    votedBy: {},
  };
}

function houseSongState() {
  return {
    nowPlaying: {
      id: 'default-time-is-running-out',
      title: 'Time Is Running Out',
      artist: 'Muse',
      addedBy: 'house',
      addedByName: 'Side Quest',
      youtubeVideoId: 'O2IuJPh6h_A',
      startedAt: STARTED_AT,
      skipVotes: [],
    },
    defaultCooldownUntil: null,
    votedBy: {},
  };
}

describe('constants', () => {
  it('carries the v1 marker and the table name', () => {
    expect(JUKEBOX_PERSIST_MARKER).toBe('sq-jukebox-persist-v1');
    expect(JUKEBOX_ROOM_STATE_TABLE).toBe('jukebox_room_state');
    expect(JUKEBOX_MIN_REMAINING_MS).toBe(5000);
  });

  it('creates one row per room with the serialized state as JSONB', () => {
    expect(JUKEBOX_ROOM_STATE_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS jukebox_room_state/);
    expect(JUKEBOX_ROOM_STATE_TABLE_SQL).toMatch(/room_id TEXT PRIMARY KEY/);
    expect(JUKEBOX_ROOM_STATE_TABLE_SQL).toMatch(/data JSONB NOT NULL/);
  });
});

describe('save/load round-trip', () => {
  it('restores a fresh room (nothing playing) exactly', async () => {
    const pool = makeFakePool();
    const before = createJukeboxRoomState();
    expect(await saveJukeboxNowPlaying(pool, ROOM, before)).toBe(true);
    // Nothing to restore: a row with no song, no cooldown, and no
    // votes loads back as null, and the caller starts fresh.
    expect(await loadJukeboxNowPlaying(pool, ROOM)).toBeNull();
  });

  it('restores a mid-song user song with startedAt + skipVotes', async () => {
    const pool = makeFakePool();
    const before = midSongState();
    await saveJukeboxNowPlaying(pool, ROOM, before);
    const loaded = await loadJukeboxNowPlaying(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeJukeboxRoomState(loaded)).toEqual(serializeJukeboxRoomState(before));
    expect(loaded.nowPlaying.id).toBe('song-abc');
    expect(loaded.nowPlaying.startedAt).toBe(STARTED_AT);
    expect(loaded.nowPlaying.skipVotes).toEqual(['alice@test']);
    // addedBy rides in the snapshot even though the wire shape
    // drops it — the owner-skip check needs it after a restart.
    expect(loaded.nowPlaying.addedBy).toBe('alice@test');
  });

  it('restores a house-song snapshot', async () => {
    const pool = makeFakePool();
    const before = houseSongState();
    await saveJukeboxNowPlaying(pool, ROOM, before);
    const loaded = await loadJukeboxNowPlaying(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(loaded.nowPlaying.id).toBe('default-time-is-running-out');
    expect(loaded.nowPlaying.youtubeVideoId).toBe('O2IuJPh6h_A');
    expect(loaded.nowPlaying.startedAt).toBe(STARTED_AT);
  });

  it('restores a live cooldown with nothing playing', async () => {
    const pool = makeFakePool();
    const before = {
      nowPlaying: null,
      defaultCooldownUntil: STARTED_AT + 5 * 60 * 1000,
      votedBy: {},
    };
    await saveJukeboxNowPlaying(pool, ROOM, before);
    const loaded = await loadJukeboxNowPlaying(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(loaded.nowPlaying).toBeNull();
    expect(loaded.defaultCooldownUntil).toBe(STARTED_AT + 5 * 60 * 1000);
  });

  it('restores queue votedBy flags', async () => {
    const pool = makeFakePool();
    const before = {
      nowPlaying: null,
      defaultCooldownUntil: null,
      votedBy: { 'song-1': ['alice@test', 'bob@test'], 'song-2': ['carol@test'] },
    };
    await saveJukeboxNowPlaying(pool, ROOM, before);
    const loaded = await loadJukeboxNowPlaying(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(loaded.votedBy).toEqual({
      'song-1': ['alice@test', 'bob@test'],
      'song-2': ['carol@test'],
    });
  });

  it('writes an upsert (INSERT ... ON CONFLICT), one row per room', async () => {
    const pool = makeFakePool();
    await saveJukeboxNowPlaying(pool, ROOM, createJukeboxRoomState());
    await saveJukeboxNowPlaying(pool, ROOM, midSongState());
    expect(pool.store.size).toBe(1);
    expect(pool.queries.filter((q) => /INSERT INTO jukebox_room_state/i.test(q.text))).toHaveLength(2);
    expect(pool.queries[0].text).toMatch(/ON CONFLICT \(room_id\)/);
    const loaded = await loadJukeboxNowPlaying(pool, ROOM);
    expect(loaded.nowPlaying.id).toBe('song-abc');
  });

  it('keeps different rooms independent', async () => {
    const pool = makeFakePool();
    await saveJukeboxNowPlaying(pool, ROOM, midSongState());
    await saveJukeboxNowPlaying(pool, OTHER_ROOM, houseSongState());
    expect(pool.store.size).toBe(2);
    const loaded = await loadJukeboxNowPlaying(pool, ROOM);
    const other = await loadJukeboxNowPlaying(pool, OTHER_ROOM);
    expect(loaded.nowPlaying.id).toBe('song-abc');
    expect(other.nowPlaying.id).toBe('default-time-is-running-out');
  });
});

describe('load of a missing row', () => {
  it('returns null — the caller starts with nothing playing, as today', async () => {
    const pool = makeFakePool();
    expect(await loadJukeboxNowPlaying(pool, ROOM)).toBeNull();
    expect(await loadJukeboxNowPlaying(pool, 'somewhere-else')).toBeNull();
  });
});

describe('no pool (local dev without Postgres)', () => {
  it('save is a no-op that never throws; load returns null', async () => {
    await expect(saveJukeboxNowPlaying(null, ROOM, createJukeboxRoomState())).resolves.toBe(false);
    await expect(loadJukeboxNowPlaying(null, ROOM)).resolves.toBeNull();
    await expect(saveJukeboxNowPlaying(undefined, ROOM, createJukeboxRoomState())).resolves.toBe(false);
  });
});

describe('bad-row repair (never trust the row blindly)', () => {
  it('a junk row with nothing usable returns null', async () => {
    const pool = makeFakePool({
      [ROOM]: { nowPlaying: 'nope', defaultCooldownUntil: 'soon', votedBy: 'nope' },
    });
    expect(await loadJukeboxNowPlaying(pool, ROOM)).toBeNull();
    const pool2 = makeFakePool({ [ROOM]: 'not an object' });
    expect(await loadJukeboxNowPlaying(pool2, ROOM)).toBeNull();
    const pool3 = makeFakePool({ [ROOM]: null });
    expect(await loadJukeboxNowPlaying(pool3, ROOM)).toBeNull();
  });

  it('a song without a usable startedAt does not resume — but a live cooldown still loads', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        nowPlaying: { id: 'song-abc', title: 'T', artist: 'A', startedAt: 'yesterday' },
        defaultCooldownUntil: STARTED_AT + 5 * 60 * 1000,
        votedBy: {},
      },
    });
    const loaded = await loadJukeboxNowPlaying(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(loaded.nowPlaying).toBeNull();
    expect(loaded.defaultCooldownUntil).toBe(STARTED_AT + 5 * 60 * 1000);
    const pool2 = makeFakePool({
      [ROOM]: {
        nowPlaying: { id: 'song-abc', title: 'T', artist: 'A' },
        defaultCooldownUntil: null,
        votedBy: {},
      },
    });
    expect(await loadJukeboxNowPlaying(pool2, ROOM)).toBeNull();
  });

  it('cleans skipVotes: drops non-strings, dedupes, keeps order', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        nowPlaying: { ...midSongState().nowPlaying, skipVotes: ['alice@test', 42, 'alice@test', null, 'bob@test'] },
        defaultCooldownUntil: null,
        votedBy: {},
      },
    });
    const loaded = await loadJukeboxNowPlaying(pool, ROOM);
    expect(loaded.nowPlaying.skipVotes).toEqual(['alice@test', 'bob@test']);
  });

  it('cleans votedBy: drops non-string voters, dedupes, drops empty songs', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        nowPlaying: null,
        defaultCooldownUntil: null,
        votedBy: { 'song-1': ['alice@test', 7, 'alice@test'], 'song-2': [], 'song-3': 'nope' },
      },
    });
    const loaded = await loadJukeboxNowPlaying(pool, ROOM);
    expect(loaded.votedBy).toEqual({ 'song-1': ['alice@test'] });
  });

  it('returns null instead of throwing when the query fails', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(loadJukeboxNowPlaying(pool, ROOM)).resolves.toBeNull();
  });
});

describe('remaining-time math (real jukeboxRemainingMs)', () => {
  it('a YouTube song 60s in has ~9 minutes left', () => {
    expect(jukeboxRemainingMs(midSongState().nowPlaying, ONE_MIN_LATER)).toBe(9 * 60 * 1000);
  });

  it('a non-YouTube song 60s in has 2 minutes left', () => {
    const song = { ...midSongState().nowPlaying, youtubeVideoId: null };
    expect(jukeboxRemainingMs(song, ONE_MIN_LATER)).toBe(2 * 60 * 1000);
  });

  it('a song past its duration has nothing left (caller advances)', () => {
    expect(jukeboxRemainingMs(midSongState().nowPlaying, STARTED_AT + 11 * 60 * 1000)).toBeLessThanOrEqual(0);
    const short = { ...midSongState().nowPlaying, youtubeVideoId: null };
    expect(jukeboxRemainingMs(short, STARTED_AT + 3 * 60 * 1000 + 1)).toBeLessThanOrEqual(0);
  });

  it('a song without a usable startedAt has nothing left', () => {
    expect(jukeboxRemainingMs({ id: 'x' })).toBe(0);
    expect(jukeboxRemainingMs(null)).toBe(0);
  });
});

describe('restart-restore flow', () => {
  it('save, drop the in-memory entry, load again: same song + skip votes', async () => {
    const pool = makeFakePool();
    const before = midSongState();
    await saveJukeboxNowPlaying(pool, ROOM, before);
    // The restart drops the in-memory entry entirely; the load
    // rebuilds it from the row alone.
    const after = await loadJukeboxNowPlaying(pool, ROOM);
    expect(serializeJukeboxRoomState(after)).toEqual(serializeJukeboxRoomState(before));
  });

  it('a skip vote and a queue votedBy flag survive a restart', async () => {
    const pool = makeFakePool();
    const before = {
      nowPlaying: { ...midSongState().nowPlaying, skipVotes: ['alice@test'] },
      defaultCooldownUntil: null,
      votedBy: { 'song-1': ['bob@test'] },
    };
    await saveJukeboxNowPlaying(pool, ROOM, before);
    const after = await loadJukeboxNowPlaying(pool, ROOM);
    expect(after.nowPlaying.skipVotes).toEqual(['alice@test']);
    expect(after.votedBy).toEqual({ 'song-1': ['bob@test'] });
  });
});

describe('load-before-mutate simulation', () => {
  it('a skip vote after a restart does not wipe the restored song', async () => {
    const pool = makeFakePool();
    await saveJukeboxNowPlaying(pool, ROOM, midSongState());
    // The restart drops the in-memory cache; the first touch after
    // it loads the row (ensureJukeboxNowPlayingLoaded) BEFORE
    // mutating.
    const cache = await loadJukeboxNowPlaying(pool, ROOM);
    expect(cache.nowPlaying.id).toBe('song-abc');
    expect(cache.nowPlaying.skipVotes).toEqual(['alice@test']);
    // A second user's skip vote — the same mutation the skip_song
    // handler makes — then saves.
    cache.nowPlaying.skipVotes.push('bob@test');
    await saveJukeboxNowPlaying(pool, ROOM, cache);
    // A second restart (or another device) sees the same song
    // with both skip votes — the vote did not overwrite the
    // snapshot with a fresh default.
    const after = await loadJukeboxNowPlaying(pool, ROOM);
    expect(after.nowPlaying.id).toBe('song-abc');
    expect(after.nowPlaying.startedAt).toBe(STARTED_AT);
    expect(after.nowPlaying.skipVotes).toEqual(['alice@test', 'bob@test']);
  });

  it('a vote after a restart does not let the same user vote twice', async () => {
    const pool = makeFakePool();
    await saveJukeboxNowPlaying(pool, ROOM, {
      nowPlaying: null,
      defaultCooldownUntil: null,
      votedBy: { 'song-1': ['alice@test'] },
    });
    const cache = await loadJukeboxNowPlaying(pool, ROOM);
    expect(cache.votedBy['song-1']).toEqual(['alice@test']);
    // The vote gate is "one vote per user per song": with the
    // restored flag, Alice voting again is a no-op, and Bob's
    // first vote lands.
    expect(cache.votedBy['song-1'].includes('alice@test')).toBe(true);
    cache.votedBy['song-1'].push('bob@test');
    await saveJukeboxNowPlaying(pool, ROOM, cache);
    const after = await loadJukeboxNowPlaying(pool, ROOM);
    expect(after.votedBy['song-1']).toEqual(['alice@test', 'bob@test']);
  });
});

describe('save errors', () => {
  it('saveJukeboxNowPlaying propagates a DB error (the socket.js caller catches it)', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(saveJukeboxNowPlaying(pool, ROOM, createJukeboxRoomState())).rejects.toThrow('db down');
  });
});
