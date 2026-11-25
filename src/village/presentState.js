// presentState.js — Santa's Lost Present (Santa's Lost Present v1,
// `sq-santas-lost-present-v1`).
//
// Pure logic, no Phaser and no Node APIs, so BOTH sides import it:
//   - server/socket.js (canonical daily rule: one find per player
//     per America/Chicago day, badge once ever)
//   - src/village/SantasPresentSystem.js (click counting + instant
//     feedback + the date-keyed coin guard)
//
// The loop: ONE present hides in Agora, one per player per day —
// it is a hidden search like the Santa hat (3 clicks within 140px
// of the spot, functionally invisible until found). Find it and it
// is revealed (a 🎁 at the spot, briefly) + a toast + 5 coins +
// the badge, once ever. It re-hides for you the next Chicago day:
// the server tracks each player's last-found Chicago date, and a
// second find the same day is refused.
//
// DESIGN NOTE — why this lives OUTSIDE QuestManager's one-time
// flow (the Hungry Cat precedent: "the hunger quest is repeatable,
// twice a day, so it lives outside the one-time quest flow"):
// QuestManager completes a quest once ever and never advances it
// again, so it cannot express "found today / findable again
// tomorrow" in the tracker. The badge therefore follows the
// snowman/lights/tree pattern instead — an explicit def in
// badges.js (SANTAS_PRESENT_BADGE), the id in BADGE_QUEST_IDS
// (client + server), and a getBadgeDef branch, all asserted by
// test. The tracker line reads the system's getProgress() like the
// other group quests.
//
// The state is IN-MEMORY only in v1 (like the other quests at
// birth — the badge is persisted by the badge system; the
// daily-found date is NOT). A server restart resets the daily
// find (a player could re-find it that day) but the badge stays.
// A persistence piece can follow the same pattern later.

export const PRESENT_ID = 'santas-lost-present';
export const PRESENT_MARKER_V1 = 'sq-santas-lost-present-v1';
// BUILDER DEFAULT — the user never set the amount: 5 coins per
// find, same as the other Christmas quests. Say so if it should change.
export const PRESENT_REWARD_COINS = 5;
export const PRESENT_SEARCH_CLICKS = 3; // clicks at the hiding spot to find it (hat/puzzle pattern)
export const PRESENT_SEARCH_RANGE = 140; // px the player must stand from the hiding spot
export const PRESENT_HIDE_RADIUS = 50; // click zone around the hiding spot
export const PRESENT_PENDING_TIMEOUT_MS = 5000; // a find waits 5s for the server (decor pattern)
export const PRESENT_TIMEZONE = 'America/Chicago';

// Hiding spot: at the FOOT of tree 2 (west side, 190,470), mirroring
// the hat at tree 1's foot (1400,430). Derived from _drawTree in
// TrimTreeQuest.js: the trunk is fillRect(-14, -34, 28, 38) relative
// to the tree spot, so tree 2's trunk spans x 176–204, y 436–474.
// The spot sits 16px north of the trunk's top edge (436), centred
// on the trunk's x — (190, 420) — tucked under the lowest tier's
// foliage at the foot of the tree, exactly like the hat.
// Clear of everything else in Agora (all distances from the spot):
//   hat spot (1400,430) 1210px · lights box (1430,770) 1290px ·
//   tree box (170,760) 341px · lights SW hang spot (180,600) 180px ·
//   Table 4 (300,640) 246px · SW plant (130,690) 277px · puzzle
//   table (800,410) 610px · cat sunbeam (~1117,583) 940px.
// The tree is NOT solid (TrimTreeQuest), so the player can walk
// right up to the trunk and stand within the 140px search range.
// Cross-talk, accepted like the hat: the spot sits inside tree 2's
// own click zone, so clicks here count toward BOTH a present tap
// and hanging an ornament — the player is standing at the foot of
// the tree clicking the tree, and the present is right there
// behind the wood.
export const PRESENT_HIDE_SPOT = { x: 190, y: 420 };
// Agora bounds (1600x900, RoomLayout.js roomBoundary): the spot
// must sit inside them, and the search range must be reachable.
export const PRESENT_ROOM_BOUNDS = { xMin: 0, yMin: 0, xMax: 1600, yMax: 900 };

/** Chicago wall-clock date for a Date, 'YYYY-MM-DD' via Intl —
//  the same pattern as catHunger.js chicagoDateParts. Falls back
//  to local time if Intl has no such timezone. */
export function chicagoDateString(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: PRESENT_TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    const d = date instanceof Date ? date : new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

/** Is `value` a 'YYYY-MM-DD' date string? */
export function isDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function createPresentState() {
  return {
    // userId -> 'YYYY-MM-DD' of that player's last find. Entries
    // from earlier days are pruned on serialize — the map only ever
    // holds today's finders.
    foundBy: {},
  };
}

/** Did this player already find the present on `dateStr`? */
export function foundToday(state, userId, dateStr) {
  if (!state || !userId || !isDateString(dateStr)) return false;
  return String(state.foundBy?.[String(userId)] || '') === dateStr;
}

/**
 * One player found the present. Only works if they have not
 * already found it on `dateStr` — one find per player per Chicago
 * day. Returns { ok } or { ok: false, reason } — 'bad-user' /
 * 'bad-date' / 'already-found-today'.
 */
export function findPresent(state, userId, dateStr) {
  if (!state) return { ok: false, reason: 'bad-state' };
  const uid = String(userId || '');
  if (!uid) return { ok: false, reason: 'bad-user' };
  if (!isDateString(dateStr)) return { ok: false, reason: 'bad-date' };
  if (foundToday(state, uid, dateStr)) return { ok: false, reason: 'already-found-today' };
  state.foundBy[uid] = dateStr;
  return { ok: true };
}

/** Plain JSON copy safe to send over the socket. `todayStr`
 *  prunes the map to today's finders only — yesterday's entries
 *  never ride the wire. */
export function serializePresentState(state, todayStr) {
  const s = state || createPresentState();
  const today = isDateString(todayStr) ? todayStr : '';
  const foundBy = {};
  for (const [u, d] of Object.entries(s.foundBy || {})) {
    if (!u || !isDateString(d)) continue;
    if (today && d !== today) continue;
    foundBy[u] = d;
    if (Object.keys(foundBy).length >= 50) break;
  }
  return { foundBy, date: today };
}

/** Validate an incoming state object (never trust the wire). */
export function parsePresentState(raw) {
  const s = createPresentState();
  if (!raw || typeof raw !== 'object') return s;
  if (raw.foundBy && typeof raw.foundBy === 'object') {
    for (const [u, d] of Object.entries(raw.foundBy)) {
      if (!u || !isDateString(d)) continue;
      s.foundBy[u] = d;
      if (Object.keys(s.foundBy).length >= 50) break;
    }
  }
  return s;
}

// ---- per-find coin payment (mirrors lights v1.2,
// `sq-christmas-multi-v1.2`) ----
// Coins pay +5 per find, client-side, tracked per profile in
// localStorage as the LAST PAID Chicago date ({ owner ->
// 'YYYY-MM-DD' }), so a find pays exactly once — including across
// a refresh/reconnect (the client re-applies the server state and
// the diff below pays only when the stored date differs from
// today). Same caveat as the lights: localStorage is per-browser,
// so exactly-once covers a refresh/reconnect on the same browser,
// not two devices on the same profile — server-side coin awarding
// would be a much bigger change and is out of scope. The server
// is authoritative for the daily rule (it refuses a second find),
// so the only thing a tampered client can do is pay itself coins
// it didn't earn — the same trust boundary as coins elsewhere.
export const PRESENT_PAID_DATES_KEY = 'sidequest-present-paid-dates';

export function loadPaidPresentDates() {
  try {
    const raw = localStorage.getItem(PRESENT_PAID_DATES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function savePaidPresentDates(paid) {
  try {
    localStorage.setItem(PRESENT_PAID_DATES_KEY, JSON.stringify(paid || {}));
  } catch {}
}

/**
 * Pure diff: is this find still unpaid? Returns { owed, newPaid }
 * — `owed` is 1 when the stored paid date differs from today (pay
 * +5 once), 0 when it already matches; `newPaid` is the date to
 * store. A stored date that is NOT today means either a new day
 * (pay) or a stale record (pay — the server already refused a
 * same-day second find, so a mismatch always means a fresh find).
 */
export function owedPresentFind(todayStr, paidDate) {
  if (!isDateString(todayStr)) return { owed: 0, newPaid: paidDate || '' };
  if (String(paidDate || '') === todayStr) return { owed: 0, newPaid: todayStr };
  return { owed: 1, newPaid: todayStr };
}
