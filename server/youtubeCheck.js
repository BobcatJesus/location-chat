// youtubeCheck.js — YouTube video guard for the jukebox
// (`sq-jukebox-guard-v1`).
//
// The jukebox let any player paste any YouTube link and it played
// for the whole room — no check on what the video was. A troll
// could queue a screamer, an explicit video, or a 10-hour video.
// Now the server asks the YouTube Data API what the video is
// BEFORE it goes in, and refuses anything that is not a music
// video under 10 minutes, or is age-restricted. With no API key
// the guard fails closed: YouTube adds are refused, never silently
// allowed unchecked.
//
// Pure and side-effect-free: the fetch is injectable so tests need
// no real key or network. The caller (server/socket.js, add_song)
// reads the key from process.env.YOUTUBE_API_KEY and passes it in.
//
// No side effects on import.

// sq-jukebox-guard-v1 — marker for the v1 landing check.

/** YouTube category id for Music. */
export const YOUTUBE_MUSIC_CATEGORY_ID = '10';

/** Longest video the jukebox accepts, in seconds (10 minutes). */
export const YOUTUBE_MAX_DURATION_SECONDS = 600;

const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3/videos';

/** Refusal messages, keyed by reason — shown to the player as a
 *  song_error, so they must say plainly what was wrong. */
export const YOUTUBE_REFUSAL_MESSAGES = {
  'not-music': "That video isn't music — the jukebox only plays music videos.",
  'age-restricted': 'That video is age-restricted — the jukebox only plays videos anyone can watch.',
  'too-long': 'That video is over 10 minutes long — the jukebox only plays shorter music videos.',
  'not-found': "YouTube couldn't find that video, or it is private.",
  'api-error': "YouTube didn't answer the check — try again in a moment.",
  'no-key': "YouTube checks aren't set up yet — the room owner needs to add a YouTube API key.",
};

/**
 * Parse an ISO 8601 duration (PT1H2M3S, PT10M, PT45S, P1DT2H)
 * into seconds. Returns NaN for anything that is not one.
 */
export function parseIso8601Duration(value) {
  if (typeof value !== 'string') return NaN;
  const m = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return NaN;
  const days = Number(m[1] || 0);
  const hours = Number(m[2] || 0);
  const minutes = Number(m[3] || 0);
  const seconds = Number(m[4] || 0);
  if (!m[1] && !m[2] && !m[3] && !m[4]) return NaN;
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/**
 * Decide whether a YouTube video (one `items[]` entry from
 * videos.list, part=contentDetails,snippet,status) may go on the
 * jukebox. Pure: no network, no key.
 * Returns { ok: true } or { ok: false, reason }.
 */
export function decideYouTubeVideo(video) {
  if (!video || typeof video !== 'object') return { ok: false, reason: 'not-found' };
  const snippet = video.snippet;
  const details = video.contentDetails;
  if (!snippet || typeof snippet !== 'object' || !details || typeof details !== 'object') {
    return { ok: false, reason: 'not-found' };
  }
  if (String(snippet.categoryId) !== YOUTUBE_MUSIC_CATEGORY_ID) {
    return { ok: false, reason: 'not-music' };
  }
  const rating = details.contentRating && details.contentRating.ytRating;
  if (rating === 'ytAgeRestricted') return { ok: false, reason: 'age-restricted' };
  const seconds = parseIso8601Duration(details.duration);
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'not-found' };
  if (seconds > YOUTUBE_MAX_DURATION_SECONDS) return { ok: false, reason: 'too-long' };
  return { ok: true };
}

/**
 * Check a YouTube video id against the YouTube Data API.
 * Fails closed: no key, a missing video, or any API/network error
 * all refuse. fetchImpl is injectable for tests (defaults to the
 * global fetch, the same pattern socket.js uses elsewhere).
 * Returns { ok: true } or { ok: false, reason }.
 */
export async function checkYouTubeVideo(videoId, { apiKey, fetchImpl } = {}) {
  if (!apiKey) return { ok: false, reason: 'no-key' };
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'api-error' };
  const url =
    `${YOUTUBE_API_URL}?part=contentDetails,snippet,status` +
    `&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;
  let res;
  try {
    res = await fetchFn(url);
  } catch {
    return { ok: false, reason: 'api-error' };
  }
  if (!res || !res.ok) return { ok: false, reason: 'api-error' };
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'api-error' };
  }
  const items = body && Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return { ok: false, reason: 'not-found' };
  return decideYouTubeVideo(items[0]);
}
