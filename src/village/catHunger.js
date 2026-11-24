// catHunger.js — Hungry Cat v1 (`sq-hungry-cat-v1`).
//
// The cafe cat gets hungry twice a day, morning and evening, on a
// SERVER timer, so every player in Agora sees the same hungry cat
// at the same time. When she is hungry she shows a thought bubble
// saying "hungry..."; feeding her a treat (food, one charge — the
// Feed the Ducks v2 treat path) completes the new "Feed the Hungry
// Cat" quest: +3 coins on top of the usual +1 pet coin. She is one
// shared cat, so the FIRST feeder while she is hungry ends the
// hunger — a second feeder gets the usual treat but no quest. The
// quest is repeatable: it comes back at the next window, twice a
// day, so it can be farmed. Hungry Cat v1.3
// (`sq-hungry-cat-v1.3`): hunger does NOT end when the window
// does — if nobody feeds her in the window, she stays hungry (the
// bubble stays up) until someone feeds her, and that feed pays the
// +3 whenever it lands, inside a window or between windows. A feed
// while she is NOT hungry never pays the quest (the treat still
// happens: pet + +1 coin + the charge). Each new window re-arms her
// if she was fed, so the quest comes back twice a day either way.
//
// This module is pure (no Phaser, no socket, no localStorage) so
// the window math and the hunger state machine are unit-testable,
// and the SERVER imports it directly (server/socket.js) — the same
// shape as mailState.js / puzzleState.js. The client uses the
// constants (quest id, reward, bubble text) and the window function
// only for display; the server is authoritative for hunger and for
// who completed a window.

export const HUNGRY_CAT_MARKER_V1 = 'sq-hungry-cat-v1';

/** The quest id — also the badge id (see badges.js). */
export const HUNGRY_CAT_QUEST_ID = 'hungry-cat';

/** Coins the quest pays, ON TOP of the usual +1 pet coin the treat
 *  already pays — a hungry feeding is 4 coins total. */
export const HUNGRY_CAT_REWARD_COINS = 3;

/** The exact text of the thought bubble she shows while hungry. */
export const HUNGRY_CAT_BUBBLE_TEXT = 'hungry...';

/** The cat lives in Agora, Houston — the timer runs on Houston time. */
export const HUNGRY_CAT_TIMEZONE = 'America/Chicago';

/** Hunger windows, as minutes since midnight in Chicago time.
 *  Morning 7:00–10:00, evening 17:00–20:00. A window STARTS a
 *  hunger spell (if she was fed); it does NOT end one — Hungry Cat
 *  v1.3 (`sq-hungry-cat-v1.3`): if nobody feeds her in the window,
 *  she stays hungry until fed, and that feed pays whenever it
 *  lands. */
// sq-hungry-cat-v1.1: windows widened from 8–10am + 6–8pm to
// 7–10am + 5–8pm (3 hours each) so they are easier to catch.
export const HUNGRY_CAT_WINDOWS = [
  { label: 'morning', startMin: 7 * 60, endMin: 10 * 60 },
  { label: 'evening', startMin: 17 * 60, endMin: 20 * 60 },
];

/** Parse an env override for the windows ("7-10,17-20" — start/end
 *  hours in Chicago time). Returns the window list, or null when
 *  the value is missing or unusable (the caller falls back to the
 *  default). This is the tuning seam AND the test seam: the
 *  protocol harness sets a window covering "now" so the full loop
 *  runs without waiting for 8am. Production default is the list
 *  above — the user-decided morning/evening schedule. */
export function parseHungerWindows(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const out = [];
  for (const part of value.split(',')) {
    const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(part);
    if (!m) return null;
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start < 0 || start > 23 || end < 0 || end > 24 || end <= start) return null;
    out.push({
      label: start < 12 ? 'morning' : 'evening',
      startMin: start * 60,
      endMin: end * 60,
    });
  }
  return out.length > 0 ? out : null;
}

/** Chicago wall-clock parts for a Date, via Intl — the same pattern
 *  as the day/night currentTimePhase in server/socket.js. Falls
 *  back to server-local time if Intl has no such timezone. */
export function chicagoDateParts(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: HUNGRY_CAT_TIMEZONE,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(date);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour') % 24,
      minute: get('minute'),
    };
  } catch {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Which hunger window (if any) a moment falls in. Returns
 *  { windowId, period, active } — windowId is the Chicago date +
 *  the window label ("2026-11-23-morning"), so a window is one
 *  identity a day and a new day resets it. Outside a window the
 *  id is null. End is exclusive: 10:00 sharp is no longer
 *  morning-hungry. */
export function hungerWindowFor(date = new Date(), windows = HUNGRY_CAT_WINDOWS) {
  const { year, month, day, hour, minute } = chicagoDateParts(date);
  const mins = hour * 60 + minute;
  const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
  for (const w of windows || []) {
    if (mins >= w.startMin && mins < w.endMin) {
      return { windowId: `${dateStr}-${w.label}`, period: w.label, active: true };
    }
  }
  return { windowId: null, period: null, active: false };
}

/** Fresh per-room hunger state. windowId is the window this
 *  state belongs to; fedBy is the user id that fed her this window
 *  (null until the first feeder ends it). Persisted to Postgres
 *  (Cat State Persistence v1, `sq-cat-persist-v1`) together with
 *  the cat's pets/asleep — a restart restores it instead of
 *  forgetting who fed her this window. */
export function createCatHungerState() {
  return { windowId: null, hungry: false, fedBy: null };
}

/** Repair a stored hunger state (Cat State Persistence v1,
 *  `sq-cat-persist-v1`): never trust the row blindly. windowId is
 *  a string or null, hungry a boolean, fedBy a user id string or
 *  null; anything else (missing pieces, wrong types) falls back
 *  to the fresh state. No window math here — the caller runs the
 *  refreshCatHunger tick after loading, so a window that opened
 *  or closed while the server was down applies through the same
 *  code path the live server already uses. */
export function parseCatHungerState(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    windowId: typeof r.windowId === 'string' && r.windowId ? r.windowId : null,
    hungry: r.hungry === true,
    fedBy: typeof r.fedBy === 'string' && r.fedBy ? r.fedBy : null,
  };
}

/** The wire shape for `cat_hunger`: hungry + which window, nothing
 *  else (the server adds fedByName on the fed broadcast). */
export function serializeCatHunger(state = {}) {
  return { hungry: Boolean(state.hungry), windowId: state.windowId || null };
}

/** The hunger tick: given the current state, the time, and whether
 *  the cat is asleep, work out the next state. Returns
 *  { state, changed } — `changed` is true only when the hungry
 *  flag flips, so the server only broadcasts on a real change.
 *
 *  - Outside a window: hunger does NOT turn on (a spell only
 *    starts at a window). Hungry Cat v1.3 (`sq-hungry-cat-v1.3`):
 *    it does NOT turn off either — if nobody fed her in the
 *    window, she stays hungry until fed.
 *  - A new window resets fedBy (a fresh chance for everyone) and
 *    hunger starts — unless she is asleep, in which case hunger
 *    WAITS: it does not activate until she wakes (the tick runs
 *    again after the wake, and the join_room wake path refreshes
 *    it immediately). Hunger CARRIES OVER into the new window when
 *    she was still hungry: she stays hungry, only fedBy resets.
 *  - If she falls asleep WHILE hungry, hunger stays true (it
 *    waits, it does not clear) — the bubble hides because she is
 *    asleep, and comes back when she wakes, whenever that is.
 *  - Once fed (fedBy set), hunger stays off until the next window. */
export function refreshCatHunger(state, { now = new Date(), asleep = false, windows = HUNGRY_CAT_WINDOWS } = {}) {
  const win = hungerWindowFor(now, windows);
  let { windowId, hungry, fedBy } = state || {};
  let changed = false;
  if (win.active) {
    if (win.windowId !== windowId) {
      windowId = win.windowId;
      fedBy = null;
    }
    if (!fedBy && !asleep && !hungry) { hungry = true; changed = true; }
    if (fedBy && hungry) { hungry = false; changed = true; }
  }
  // Outside a window there is nothing to do: hunger neither starts
  // nor ends here (v1.3 — it ends only on a feed).
  return { state: { windowId: windowId || null, hungry, fedBy: fedBy || null }, changed };
}

/** A player fed the cat a treat. Only the FIRST feeder while she
 *  is hungry completes the quest: returns { state, ok: true } and
 *  ends the hunger, or { state, ok: false, reason } — 'not-hungry'
 *  (she is not hungry right now), 'already-fed' (someone else fed
 *  her while she was hungry). Hungry Cat v1.3
 *  (`sq-hungry-cat-v1.3`): the feed pays WHENEVER she is hungry —
 *  inside a window or between windows (the window the hunger
 *  belongs to rides on the state, so a late feed still completes
 *  that window's quest). There is no 'window-over' refusal anymore.
 *  The caller's treat still happened either way (the pet + the +1
 *  coin + the charge) — only the quest is refused. */
export function feedCatHunger(state, { now = new Date(), userId, windows = HUNGRY_CAT_WINDOWS } = {}) {
  if (!state?.hungry) return { state: { ...(state || createCatHungerState()) }, ok: false, reason: 'not-hungry' };
  if (state.fedBy) return { state: { ...state }, ok: false, reason: 'already-fed' };
  return { state: { ...state, hungry: false, fedBy: userId || null }, ok: true };
}
