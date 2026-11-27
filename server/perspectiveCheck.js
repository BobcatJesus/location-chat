// perspectiveCheck.js — Google Perspective API content check
// for pick-up notes (`sq-notes-moderation-v1`).
//
// A pick-up note is public and anonymous, so it is the easiest
// place in the game to be nasty. Before a note is placed, the
// server asks Perspective whether the text is toxic and refuses
// hurtful text. The check runs in server/socket.js, in the
// note_drop handler, BEFORE the note is placed.
//
// FAIL OPEN — a deliberate, documented deviation from the
// jukebox guard's fail-closed: with no API key, an API error, a
// 429, a timeout, or an unexpected response shape, the note is
// placed unchecked. Fail-closed would break the notes feature
// entirely whenever the key is missing or the API is down, and
// the report system (report + auto-hide at 3 flags) is the
// backstop for anything that slips through. The skip is logged
// by the caller so it shows in the Railway logs.
//
// The API is free (Perspective's standard tier has no charge for
// this volume) but it still needs a key: enable the Perspective
// API in the Google Cloud "SideQuest" project and add
// PERSPECTIVE_API_KEY to Railway Variables. The key is read only
// from process.env on the server and is never sent to a client.
//
// doNotStore: true is set on every request, so the text is never
// stored by the API.
//
// Pure and side-effect-free: the fetch is injectable so tests
// need no real key or network, and the timeout is injectable so
// tests need not wait the full 4 seconds.
//
// No side effects on import.

// sq-notes-moderation-v1 — marker for the v1 landing check.
export const PERSPECTIVE_MARKER = 'sq-notes-moderation-v1';

export const PERSPECTIVE_API_URL =
  'https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze';

/** The attributes Perspective scores. Every one is requested on
 * every check, so a note that is toxic in any of these ways is
 * caught — not just the headline TOXICITY score. */
export const PERSPECTIVE_ATTRIBUTES = [
  'TOXICITY',
  'SEVERE_TOXICITY',
  'IDENTITY_ATTACK',
  'INSULT',
  'PROFANITY',
  'THREAT',
];

/** Refuse when ANY attribute's summary score reaches this.
 * Builder default — Perspective scores run 0 to 1, and 0.7 is
 * its own "likely toxic" line. Lower it (0.6) to catch more, at
 * the cost of more false refusals; raise it (0.8) to refuse only
 * the clearest cases. */
export const PERSPECTIVE_TOXICITY_THRESHOLD = 0.7;

/** How long to wait for Perspective before giving up and
 * placing the note unchecked (fail open). Short on purpose: the
 * client's pending drop gives up after 5 seconds, so a slow API
 * must never eat the whole window. */
export const PERSPECTIVE_TIMEOUT_MS = 4000;

/** Refusal message, shown to the player as the note_drop_result
 * reason 'content-refused'. Plain and not preachy — it says what
 * happened and what to do instead. The server sends this exact
 * string in the refusal payload, so the client never hardcodes
 * its own copy. */
export const PERSPECTIVE_REFUSAL_MESSAGE =
  'That note looks hurtful — try writing something kinder.';

/**
 * Decide whether Perspective's scores allow a note. Pure: no
 * network, no key. `attributeSummaries` is the response's
 * attributeSummaries map ({ TOXICITY: { summaryScore: { value } },
 * ... }). Returns { ok: true } or { ok: false, reason } — 'content'
 * when any requested attribute scores at or above the threshold,
 * 'bad-shape' when the map is missing or carries no usable score
 * at all (the caller treats that as an API error and fails open).
 */
export function decidePerspectiveScores(attributeSummaries) {
  if (!attributeSummaries || typeof attributeSummaries !== 'object') {
    return { ok: false, reason: 'bad-shape' };
  }
  let seenAny = false;
  for (const attr of PERSPECTIVE_ATTRIBUTES) {
    const value = Number(attributeSummaries?.[attr]?.summaryScore?.value);
    if (!Number.isFinite(value)) continue;
    seenAny = true;
    if (value >= PERSPECTIVE_TOXICITY_THRESHOLD) {
      return { ok: false, reason: 'content' };
    }
  }
  if (!seenAny) return { ok: false, reason: 'bad-shape' };
  return { ok: true };
}

/**
 * Check one note's text against Perspective. Returns
 * { ok: true } when the text may be placed — clean, or skipped
 * (fail open) — or { ok: false, reason: 'content' } when it must
 * be refused. A skip carries `skipped`: 'no-key' (no
 * PERSPECTIVE_API_KEY), or 'api-error' (network error, a non-2xx
 * status — including a 429 — a timeout, an unparseable body, or
 * an unexpected response shape). fetchImpl and timeoutMs are
 * injectable for tests.
 */
export async function checkPerspectiveText(text, { apiKey, fetchImpl, timeoutMs } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return { ok: true, skipped: null };
  if (!apiKey) return { ok: true, skipped: 'no-key' };
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') return { ok: true, skipped: 'api-error' };
  const requestedAttributes = {};
  for (const attr of PERSPECTIVE_ATTRIBUTES) requestedAttributes[attr] = {};
  const body = {
    comment: { text: clean },
    languages: ['en'],
    requestedAttributes,
    doNotStore: true,
  };
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : PERSPECTIVE_TIMEOUT_MS;
  let res;
  try {
    res = await fetchFn(`${PERSPECTIVE_API_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    return { ok: true, skipped: 'api-error' };
  }
  if (!res || !res.ok) return { ok: true, skipped: 'api-error' };
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: true, skipped: 'api-error' };
  }
  const decision = decidePerspectiveScores(data && data.attributeSummaries);
  if (decision.reason === 'bad-shape') return { ok: true, skipped: 'api-error' };
  return decision;
}
