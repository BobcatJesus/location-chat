// hatState.js — the Santa Hat (Santa Hat v1, `sq-santa-hat-v1`).
//
// Pure logic, no Phaser and no Node APIs, so BOTH sides import it:
//   - server/socket.js (canonical room state, validates every move)
//   - src/village/SantaHatSystem.js (local checks + instant feedback)
//
// The loop (decided in chat 2026-11-21): ONE Santa hat is hidden
// behind the Christmas tree in Agora, one for the whole room. Find
// it by clicking behind the tree a few times (hidden-search, same
// pattern as puzzle pieces), it goes into your pocket, and you can
// put it on the cafe cat — she wears it, everyone in the room sees
// it. After 30 minutes it SLIPS OFF and lands on the ground
// nearby, visible on the floor; anyone can pick it up and put it
// back on her. Placing it on the cat pays +3 coins the FIRST time
// each player does it (once ever per player — later placements are
// just for fun, so the loop cannot be farmed).
//
// The hat is a SHARED room item with server state (in-memory per
// room, like the puzzle / tree / board). A server restart wipes it:
// the hat hides behind the tree again. The hiding spot is spent
// once the hat is found — after that it circulates cat -> ground ->
// pocket -> cat, and never hides again until a restart. Later there
// may be more hats to find, or hats sold in a shop — NOT in v1.

export const HAT_MARKER_V1 = 'sq-santa-hat-v1';
export const HAT_MARKER_V11 = 'sq-santa-hat-v1-1'; // v1.1: hiding spot moved to the foot of the tree
export const HAT_REWARD_COINS = 3; // a few coins, first placement only
export const HAT_SLIP_MS = 30 * 60 * 1000; // 30 minutes on the cat, then it slips off
// sq-santa-hat-v1.2: slip-off widened from 4 minutes to 30 minutes.
export const HAT_SEARCH_CLICKS = 3; // clicks behind the tree to find it (puzzle pattern)
export const HAT_SEARCH_RANGE = 140; // px the player must stand from the hiding spot
export const HAT_GROUND_CLICK_RANGE = 44; // px a click must land from the hat on the floor
export const HAT_GROUND_STAND_RANGE = 90; // px the player must stand from the hat on the floor
export const HAT_PENDING_TIMEOUT_MS = 5000; // a place/pickup waits 5s for the server (decor pattern)

// Hiding spot (v1.1, `sq-santa-hat-v1-1`): at the FOOT of tree 1
// (east side, 1400,480), BEHIND the trunk. Derived from _drawTree
// in TrimTreeQuest.js: the trunk is fillRect(-14, -34, 28, 38)
// relative to the tree spot, so in world coords it spans x 1386–
// 1414, y 446–484. The spot sits 16px north of the trunk's top
// edge (446), centred on the trunk's x — (1400, 430) — tucked under
// the lowest tier's foliage at the foot of the tree. v1 hid it above
// the apex at (1400, 165) and the user could not find it live (the
// spot was a fiddly band above the tree, clicks landed on the tree
// instead). BUILDER DECISION: fixed behind tree 1, not the active
// tree — tree 1 always stands in the room (even finished), so the
// spot never moves when tree 2 appears. The foot of the tree is
// INSIDE the tree's own click zone (treeTapAt covers x 1285–1515,
// y 195–510), so clicks here count toward BOTH a hat tap and hanging
// an ornament — same accepted cross-talk as the trash can (puzzle
// piece 5 + trash item share a click). Not prevented, by design:
// the player is standing at the foot of the tree clicking the tree,
// and the hat is right there behind the wood.
export const HAT_HIDE_SPOT = { x: 1400, y: 430 };
export const HAT_HIDE_RADIUS = 50; // click zone around the hiding spot

// Where a slipped-off hat may land: clamped to the Agora floor.
export const HAT_GROUND_BOUNDS = { xMin: 40, xMax: 1560, yMin: 40, yMax: 860 };

export function createHatState() {
  return {
    // 'hidden' (behind the tree) | 'carried' (in someone's pocket)
    // | 'onCat' (the cat is wearing it) | 'ground' (slipped off,
    // lying on the floor for anyone to pick up).
    status: 'hidden',
    carriedBy: null, // userId carrying it (status 'carried')
    placedBy: null, // userId who last put it on the cat (coin payout)
    groundX: 0, // where it lies (status 'ground')
    groundY: 0,
    wornAt: 0, // Date.now() it went on the cat (status 'onCat')
    slipAt: 0, // Date.now() it slips off (status 'onCat')
  };
}

/** Is the hat due to slip off the cat yet? (Server timestamp rule.) */
export function isSlipDue(state, now = Date.now()) {
  if (!state || state.status !== 'onCat') return false;
  const slipAt = Number(state.slipAt) || 0;
  return slipAt > 0 && Number(now) >= slipAt;
}

/**
 * One player found the hat behind the tree. Only works while it is
 * hidden — one hat per room, so a second finder gets nothing.
 * Returns { ok, reason? } — 'not-hidden' when it is already in play.
 */
export function findHat(state, userId) {
  if (!state) return { ok: false, reason: 'bad-state' };
  const uid = String(userId || '');
  if (!uid) return { ok: false, reason: 'bad-user' };
  if (state.status !== 'hidden') return { ok: false, reason: 'not-hidden' };
  state.status = 'carried';
  state.carriedBy = uid;
  return { ok: true };
}

/**
 * Put the hat on the cat. Only the carrier can do it — the hat has
 * to be in YOUR pocket. Sets the slip-off time from `now`.
 * Returns { ok, reason? } — 'not-carried' / 'not-yours'.
 */
export function placeHat(state, userId, now = Date.now()) {
  if (!state) return { ok: false, reason: 'bad-state' };
  const uid = String(userId || '');
  if (!uid) return { ok: false, reason: 'bad-user' };
  if (state.status !== 'carried') return { ok: false, reason: 'not-carried' };
  if (String(state.carriedBy || '') !== uid) return { ok: false, reason: 'not-yours' };
  const t = Number(now) || Date.now();
  state.status = 'onCat';
  state.carriedBy = null;
  state.placedBy = uid;
  state.wornAt = t;
  state.slipAt = t + HAT_SLIP_MS;
  return { ok: true, slipAt: state.slipAt };
}

/**
 * The hat slips off the cat and lands on the ground at (x, y).
 * Only works while it is on the cat AND the slip time has come —
 * a client cannot knock it off early. Coordinates are clamped to
 * the room. Returns { ok, reason? } — 'not-on-cat' / 'not-due'.
 */
export function slipHat(state, x, y, now = Date.now()) {
  if (!state) return { ok: false, reason: 'bad-state' };
  if (state.status !== 'onCat') return { ok: false, reason: 'not-on-cat' };
  if (!isSlipDue(state, now)) return { ok: false, reason: 'not-due' };
  const gx = Number(x);
  const gy = Number(y);
  state.status = 'ground';
  state.groundX = Number.isFinite(gx)
    ? Math.max(HAT_GROUND_BOUNDS.xMin, Math.min(HAT_GROUND_BOUNDS.xMax, Math.round(gx)))
    : HAT_HIDE_SPOT.x;
  state.groundY = Number.isFinite(gy)
    ? Math.max(HAT_GROUND_BOUNDS.yMin, Math.min(HAT_GROUND_BOUNDS.yMax, Math.round(gy)))
    : HAT_HIDE_SPOT.y;
  state.wornAt = 0;
  state.slipAt = 0;
  return { ok: true, x: state.groundX, y: state.groundY };
}

/**
 * Pick the hat up off the ground. Only works while it is lying
 * there — anyone can take it, whoever gets there first.
 * Returns { ok, reason? } — 'not-on-ground'.
 */
export function pickupHat(state, userId) {
  if (!state) return { ok: false, reason: 'bad-state' };
  const uid = String(userId || '');
  if (!uid) return { ok: false, reason: 'bad-user' };
  if (state.status !== 'ground') return { ok: false, reason: 'not-on-ground' };
  state.status = 'carried';
  state.carriedBy = uid;
  state.groundX = 0;
  state.groundY = 0;
  return { ok: true };
}

/**
 * Give the hat back: carried -> hidden again. Safety valve for the
 * client when it cannot take a hat the server just gave it (pocket
 * filled in the instant between check and confirm) — the hat goes
 * back behind the tree instead of vanishing. Returns { ok }.
 */
export function releaseHat(state, userId) {
  if (!state) return { ok: false, reason: 'bad-state' };
  const uid = String(userId || '');
  if (state.status !== 'carried') return { ok: false, reason: 'not-carried' };
  if (uid && String(state.carriedBy || '') !== uid) return { ok: false, reason: 'not-yours' };
  state.status = 'hidden';
  state.carriedBy = null;
  return { ok: true };
}

/** Plain JSON copy safe to send over the socket. */
export function serializeHatState(state) {
  const s = state || createHatState();
  const status = ['hidden', 'carried', 'onCat', 'ground'].includes(s.status) ? s.status : 'hidden';
  return {
    status,
    carriedBy: status === 'carried' ? String(s.carriedBy || '') : '',
    placedBy: String(s.placedBy || ''),
    groundX: status === 'ground' ? (Number(s.groundX) || 0) : 0,
    groundY: status === 'ground' ? (Number(s.groundY) || 0) : 0,
    wornAt: status === 'onCat' ? (Number(s.wornAt) || 0) : 0,
    slipAt: status === 'onCat' ? (Number(s.slipAt) || 0) : 0,
  };
}

/** Validate an incoming state object (never trust the wire). */
export function parseHatState(raw) {
  const s = createHatState();
  if (!raw || typeof raw !== 'object') return s;
  if (['hidden', 'carried', 'onCat', 'ground'].includes(raw.status)) s.status = raw.status;
  if (typeof raw.carriedBy === 'string' && raw.carriedBy) s.carriedBy = raw.carriedBy;
  if (typeof raw.placedBy === 'string' && raw.placedBy) s.placedBy = raw.placedBy;
  if (Number.isFinite(Number(raw.groundX))) s.groundX = Number(raw.groundX);
  if (Number.isFinite(Number(raw.groundY))) s.groundY = Number(raw.groundY);
  if (Number.isFinite(Number(raw.wornAt))) s.wornAt = Number(raw.wornAt);
  if (Number.isFinite(Number(raw.slipAt))) s.slipAt = Number(raw.slipAt);
  // Repair contradictions a bad wire state could carry: a carried
  // hat needs a carrier, a ground hat needs a spot, an on-cat hat
  // needs a slip time — otherwise it is hidden again.
  if (s.status === 'carried' && !s.carriedBy) s.status = 'hidden';
  if (s.status === 'onCat' && !(s.slipAt > 0)) s.status = 'hidden';
  return s;
}
