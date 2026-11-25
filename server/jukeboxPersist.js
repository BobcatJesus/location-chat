// jukeboxPersist.js — Jukebox now-playing persistence (Room-State
// Persistence v8, `sq-jukebox-persist-v1`).
//
// Piece 8 of the room-state persistence fix — the last one. The
// jukebox queue already persists: the songs table
// (jukebox_songs in server/socket.js) holds every queued song
// with its votes, and loadJukebox reloads the unplayed ones after
// a restart. What did NOT persist was what is playing RIGHT NOW:
// jukeboxRooms[roomId].nowPlaying (the song + startedAt + skip
// votes), the advance timer, and the house-song cooldown. So a
// restart cut the current song off mid-play — and worse, the song
// had already been marked played=TRUE when it started, so the
// queue SELECT excludes it and it never came back: skipped
// entirely, unheard to the end. These helpers save a snapshot of
// the now-playing song (plus skip votes, the cooldown, and the
// queue's votedBy flags) to Postgres on every advance, skip, and
// vote, and load it back lazily, so a restart resumes the same
// song for its remaining time instead of skipping it.
//
// ONE row per room. The stored shape is:
//   { nowPlaying: { id, title, artist, addedBy, addedByName,
//                   youtubeVideoId, startedAt, skipVotes: [...] }
//                 | null,
//     defaultCooldownUntil: number | null,
//     votedBy: { [songId]: [userId, ...] } }
// The snapshot is the ONLY copy of the playing song — the queue
// SELECT excludes it (played=TRUE) — so the restore rebuilds
// nowPlaying from the snapshot, never from the queue. A snapshot
// of the house song (id 'default-time-is-running-out') is
// reconstructed from DEFAULT_JUKEBOX_SONG in socket.js; the row
// only carries its startedAt + skip votes.
//
// addedBy rides in the snapshot even though the wire shape
// (publicJukeboxState) drops it: the person who queued the song
// can skip it outright, and that check must still work after a
// restart. votedBy rides too: the votes COUNT already persists
// via the songs table, but who voted lives only in memory —
// without it, a restart would let the same user vote twice on
// the same song and double-count.
//
// Resume semantics: the server timer is re-armed for the
// REMAINING time (full duration minus elapsed since startedAt:
// 10 minutes for a YouTube song, 3 minutes simulated otherwise
// — the same durations advanceJukebox uses). A song that already
// ran out while the server was down is NOT resumed: the caller
// advances to the next song instead. Note the client never reads
// startedAt (VillageScene._syncYouTubeJukebox just loads the
// video id from the start, and skips reloading when the same id
// is already playing) — so a client that stayed in the room keeps
// hearing the same video uninterrupted, while a client that
// reloads starts the video from 0:00 and hears it for the
// remaining time. That matches what the client already does;
// adding a seek offset is out of scope for this kit.
//
// No side effects on import: the pool is passed in by the caller
// (server/socket.js). With no pool (local dev without Postgres)
// every helper is a no-op and the jukebox behaves exactly as
// before — in-memory only, never a crash.
//
// The table mirrors the cat pattern (catPersist.js): one row per
// room_id, the serialized state as JSONB, updated_at for
// debugging. The caller in socket.js (persistJukebox /
// ensureJukeboxNowPlayingLoaded) owns the try/catch, so a DB
// failure warns and never blocks a live broadcast.
//
// DEC 19 RESET NOTE: the deliberate pre-showcase reset (a later
// piece) clears this table — the jukebox IS room state, unlike
// mail, which is excluded from that reset by default.

// sq-jukebox-persist-v1 — marker for the v1 landing check.
export const JUKEBOX_PERSIST_MARKER = 'sq-jukebox-persist-v1';

export const JUKEBOX_ROOM_STATE_TABLE = 'jukebox_room_state';

export const JUKEBOX_ROOM_STATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS jukebox_room_state (
      room_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

// Durations mirror advanceJukebox in server/socket.js (kept as
// literals here so this pure module never imports the server):
// a YouTube song plays up to 10 minutes (the timer is a backstop
// — the client's youtube_ended advances sooner when the video
// actually ends); anything else is simulated at 3 minutes.
export const JUKEBOX_YOUTUBE_MS = 10 * 60 * 1000;
export const JUKEBOX_SONG_MS = 3 * 60 * 1000;
// A song with less than this left is not worth resuming — the
// caller advances to the next song instead.
export const JUKEBOX_MIN_REMAINING_MS = 5 * 1000;

/** Full duration of one song, by whether it has a YouTube video. */
export function jukeboxSongDurationMs(song) {
  return song && song.youtubeVideoId ? JUKEBOX_YOUTUBE_MS : JUKEBOX_SONG_MS;
}

/** Milliseconds left on a started song, or 0 when it cannot
 *  resume (no usable startedAt, or already past its duration). */
export function jukeboxRemainingMs(song, now = Date.now()) {
  if (!song || !Number.isFinite(Number(song.startedAt))) return 0;
  return jukeboxSongDurationMs(song) - (Number(now) - Number(song.startedAt));
}

// Jukebox Solo Skip v1 (`sq-jukebox-solo-skip-v1`): skipping needs
// 2 votes, so a player ALONE in a room could never skip someone
// else's song — one vote, two needed, adder gone. One vote is
// enough when the room holds a single player.
/** Distinct votes needed to skip when the room is not solo. */
export const SKIP_VOTES_NEEDED = 2;

/** Votes needed to skip: 1 when alone in the room, else 2. An
 *  unknown room size (missing / NaN) counts as solo — demanding
 *  2 votes from an unknown room could strand a song forever. */
export function votesNeededToSkip(roomSize) {
  const n = Number(roomSize);
  return Number.isFinite(n) && n > 1 ? SKIP_VOTES_NEEDED : 1;
}

/** Whether the song should advance after a skip vote: the adder
 *  always skips outright; anyone else needs votesNeededToSkip
 *  distinct votes. skipVotes is a count, not a Set. */
export function shouldSkipSong({ skipVotes, roomSize, isAdder }) {
  if (isAdder) return true;
  return Number(skipVotes) >= votesNeededToSkip(roomSize);
}

/** Fresh jukebox room state: nothing playing, no cooldown, no votes. */
export function createJukeboxRoomState() {
  return { nowPlaying: null, defaultCooldownUntil: null, votedBy: {} };
}

function cleanString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function cleanSkipVotes(value) {
  const list = value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
  return [...new Set(list.filter((v) => typeof v === 'string' && v))];
}

function cleanVotedBy(value) {
  const out = {};
  const map = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  for (const [songId, voters] of Object.entries(map)) {
    if (typeof songId !== 'string' || !songId) continue;
    const clean = cleanSkipVotes(voters);
    if (clean.length) out[songId] = clean;
  }
  return out;
}

/** The stored shape: the full now-playing snapshot (including
 *  addedBy, which the wire shape drops — the owner-skip check
 *  needs it after a restart), the cooldown, and the queue's
 *  votedBy flags. Sets are converted to arrays. */
export function serializeJukeboxRoomState(state = {}) {
  const np = state.nowPlaying && typeof state.nowPlaying === 'object' ? state.nowPlaying : null;
  const hasSong = np && typeof np.id === 'string' && np.id && Number.isFinite(Number(np.startedAt));
  return {
    nowPlaying: hasSong
      ? {
          id: np.id,
          title: cleanString(np.title, ''),
          artist: cleanString(np.artist, ''),
          addedBy: typeof np.addedBy === 'string' && np.addedBy ? np.addedBy : null,
          addedByName: cleanString(np.addedByName, 'Someone') || 'Someone',
          youtubeVideoId: typeof np.youtubeVideoId === 'string' && np.youtubeVideoId ? np.youtubeVideoId : null,
          startedAt: Number(np.startedAt),
          skipVotes: cleanSkipVotes(np.skipVotes),
        }
      : null,
    defaultCooldownUntil: Number.isFinite(Number(state.defaultCooldownUntil))
      ? Number(state.defaultCooldownUntil)
      : null,
    votedBy: cleanVotedBy(state.votedBy),
  };
}

/** Repair a stored jukebox state: never trust the row blindly.
 *  A song without an id or a usable startedAt cannot resume, so
 *  it comes back as null; strings fall back to '' (title/artist)
 *  or 'Someone' (addedByName); skipVotes and votedBy keep only
 *  real user-id strings, deduped. */
export function parseJukeboxRoomState(raw = {}) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return serializeJukeboxRoomState({
    nowPlaying: r.nowPlaying,
    defaultCooldownUntil: r.defaultCooldownUntil,
    votedBy: r.votedBy,
  });
}

/**
 * Save one room's jukebox now-playing snapshot. No-op (returns
 * false) without a pool or room. Throws on a DB error, same as
 * saveCatState — the caller catches and warns. Returns true when
 * the row was written.
 */
export async function saveJukeboxNowPlaying(pool, roomId, state) {
  if (!pool) return false;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return false;
  await pool.query(
    `INSERT INTO jukebox_room_state (room_id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (room_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [safeRoom, JSON.stringify(serializeJukeboxRoomState(state))]
  );
  return true;
}

/**
 * Load one room's jukebox now-playing snapshot. Returns the
 * parsed state, or null when there is no pool, no row, or the row
 * cannot be read — the caller starts with nothing playing in all
 * of those cases, exactly as today. A row that repairs to nothing
 * usable (no resumable song, no live cooldown, no votedBy flags)
 * also returns null: there is nothing to restore.
 */
export async function loadJukeboxNowPlaying(pool, roomId) {
  if (!pool) return null;
  const safeRoom = String(roomId || '');
  if (!safeRoom) return null;
  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT data FROM jukebox_room_state WHERE room_id = $1',
      [safeRoom]
    ));
  } catch (e) {
    console.error('loadJukeboxNowPlaying failed:', e && e.message);
    return null;
  }
  const raw = rows && rows[0] ? rows[0].data : null;
  if (!raw || typeof raw !== 'object') return null;
  const parsed = parseJukeboxRoomState(raw);
  if (!parsed.nowPlaying && !parsed.defaultCooldownUntil && Object.keys(parsed.votedBy).length === 0) {
    return null;
  }
  return parsed;
}
