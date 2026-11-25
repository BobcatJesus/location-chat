// snowState.js — shared Build a Snowman rules (Build a Snowman v1,
// `sq-build-snowman-v1`).
//
// Pure logic, no Phaser and no Node APIs, so BOTH sides import it:
//   - server/socket.js (canonical room state, validates every add)
//   - src/village/SnowmanQuest.js (local fallback + instant
//     feedback when the socket is down)
//
// The quest: a FREE snow pile sits in Shepherd Park. Take a
// snowball, walk to the snowman spot nearby, and add it. 15 counted
// snowballs build the snowman — he grows in stages as more balls
// land (base, then middle, then head, then face at 12+). One room,
// one round: when the 15th counted snowball lands, the snowman
// stands complete and the quest is done for the venue until a
// server restart wipes the in-memory state.
//
// MULTI-HANG FROM THE START: every add counts toward the 15, no
// per-person cap — the same user decision as the lights/tree
// (`sq-christmas-multi-v1.2`): there are not 15 users yet to finish
// a room the old way, so a few players adding several snowballs
// each can build him. `contributors` still lists everyone who added
// at least once (the badge list); `hungBy` counts each player's
// total adds (the per-snowball coin payment reads it).
//
// This mirrors Trim the Tree / Christmas Lights exactly: the lights
// have one round per venue, the tree has two; the snowman has one.
// The state is in-memory only in v1 (a server restart wipes it,
// exactly like the lights/tree before their persistence pieces) — a
// persistence piece can follow the same pattern later (a
// snowman_room_state table + lazy load + save on add).

export const SNOW_ID = 'build-a-snowman';
export const SNOW_MARKER_V1 = 'sq-build-snowman-v1';
export const SNOW_TOTAL = 15; // counted snowballs that build the snowman
export const SNOW_REWARD_COINS = 5; // same as Trim the Tree / Christmas Lights
export const SNOW_PILE_TAKE_RANGE = 140; // px from the pile to take a snowball
export const SNOW_ADD_RANGE = 100; // px from the snowman to add a snowball

// BUILDER DECISION — pile + snowman spots in Shepherd Park, picked
// from the REAL layout (buildAutoLayout run in Node for
// roomId 'shepherd-park' with the SHEPHERD_PARK_FOOTPRINT, 3600x2400):
//   pond — x 1659-2615, y 812-1261 (solid, ducks swim here)
//   spawn — (1800, 2033); entry — (1800, 2340); notice board —
//     (1560, 2260); mailbox — just east of the entry, ~(2120, 2330)
//   employees — Morning Jogger patrols y 1540-1640, x 1040-2140;
//     Park Regular patrols x 2380-2860, y 820-1200 (by the pond's
//     east edge); Pond Watcher patrols x 620-1080, y 1180-1480.
//   trees — 72 seeded-random, scattered across the footprint.
//   snowman — (1100, 2100): nearest tree 201px away; south of the
//     pond (ends y 1261) and south of every patrol path (max y
//     1640); 700px from the spawn, clear of the entry, the board,
//     and the mailbox.
//   pile — (1300, 2000): nearest tree 140px away; a ~224px walk
//     from the snowman (take a snowball, walk a few seconds, add
//     it); clear of the same features. Changeable — but re-check
//     the layout (pond, patrols, trees) before moving either spot.
export const SNOWMAN_POS = { x: 1100, y: 2100 };
export const SNOW_PILE_POS = { x: 1300, y: 2000 };

// Growth stages for the snowman, by counted snowballs.
// Stage 0 covers 0: just a flat snow patch where he will stand.
// Stage 1 (1-4): the base ball only. Stage 2 (5-8): + middle ball.
// Stage 3 (9-11): + head. Stage 4 (12-15): + face (carrot nose,
// coal eyes), scarf, and stick arms — the finished snowman.
export const SNOW_STAGE_THRESHOLDS = [1, 5, 9, 12];

/** Growth stage 0..4 for `counted` counted snowballs. */
export function snowStage(counted) {
  const c = Number(counted) || 0;
  let stage = 0;
  for (const t of SNOW_STAGE_THRESHOLDS) {
    if (c >= t) stage += 1;
  }
  return stage;
}

export function createSnowState() {
  return {
    counted: 0, // snowballs added (0..15) — the X/15 number; every add counts
    contributors: [], // user ids who added at least once (the badge list)
    hungBy: {}, // userId -> total adds (per-snowball coin payment reads this)
    completed: false,
    completedAt: 0, // Date.now() when the 15th counted snowball landed
  };
}

/** Is the snowman built? */
export function isSnowComplete(state) {
  return Boolean(state?.completed) || (Number(state?.counted) || 0) >= SNOW_TOTAL;
}

/** Progress for the tracker: { counted, total, completed }. */
export function snowProgress(state) {
  const s = state || createSnowState();
  return {
    counted: Math.max(0, Math.min(SNOW_TOTAL, Number(s.counted) || 0)),
    total: SNOW_TOTAL,
    completed: isSnowComplete(s),
  };
}

/** Plain JSON copy safe to send over the socket. */
export function serializeSnowState(state) {
  const s = state || createSnowState();
  const counted = Math.max(0, Math.min(SNOW_TOTAL, Number(s.counted) || 0));
  return {
    counted,
    contributors: [...new Set((s.contributors || []).map((u) => String(u)).filter(Boolean))].slice(0, 50),
    hungBy: Object.fromEntries(
      Object.entries(s.hungBy || {})
        .filter(([u, n]) => u && Number.isFinite(Number(n)) && Number(n) > 0)
        .slice(0, 50),
    ),
    completed: Boolean(s.completed),
    completedAt: Number(s.completedAt) || 0,
    total: SNOW_TOTAL,
  };
}

/** Validate an incoming state object (never trust the wire). */
export function parseSnowState(raw) {
  const s = createSnowState();
  if (!raw || typeof raw !== 'object') return s;
  s.counted = Math.max(0, Math.min(SNOW_TOTAL, Number(raw.counted) || 0));
  if (Array.isArray(raw.contributors)) {
    s.contributors = [...new Set(raw.contributors.map((u) => String(u)).filter(Boolean))].slice(0, 50);
  }
  if (raw.hungBy && typeof raw.hungBy === 'object') {
    for (const [u, n] of Object.entries(raw.hungBy)) {
      if (!u || !Number.isFinite(Number(n)) || Number(n) <= 0) continue;
      s.hungBy[u] = Math.min(999, Number(n));
    }
  }
  s.completed = Boolean(raw.completed) || s.counted >= SNOW_TOTAL;
  if (Number.isFinite(Number(raw.completedAt))) s.completedAt = Number(raw.completedAt);
  // A completed snowman's counted number is always the full 15 — a
  // wire state that claims "complete" with fewer is repaired.
  if (s.completed) s.counted = SNOW_TOTAL;
  return s;
}

/**
 * One player added a snowball to the snowman. Returns
 * { ok, counted, finished, contributors }.
 *
 * Every add counts toward the 15 — no per-person cap, no extras.
 * The 15th add finishes the snowman. `counted` is always true on a
 * successful add.
 */
export function addSnowball(state, userId) {
  const s = state || createSnowState();
  if (s.completed) return { ok: false, reason: 'already-complete' };
  const uid = String(userId || '');
  if (!uid) return { ok: false, reason: 'bad-user' };
  s.hungBy[uid] = (Number(s.hungBy[uid]) || 0) + 1;
  if (!s.contributors.includes(uid)) s.contributors.push(uid);
  s.counted += 1;
  let finished = false;
  if (s.counted >= SNOW_TOTAL) {
    s.completed = true;
    s.completedAt = Date.now();
    finished = true;
  }
  return { ok: true, counted: true, finished, contributors: [...s.contributors] };
}

// ---- per-snowball coin payment (mirrors lights v1.2, `sq-christmas-multi-v1.2`) ----
// Coins pay +5 per COUNTED add, client-side, tracked per profile
// in localStorage so an add pays exactly once — including across a
// refresh/reconnect (the client re-applies the server state and the
// diff below pays only what is still unpaid). Same caveat as the
// lights: localStorage is per-browser, so exactly-once covers a
// refresh/reconnect on the same browser, not two devices on the
// same profile — server-side coin awarding would be a much bigger
// change and is out of scope.
export const SNOW_PAID_COUNTS_KEY = 'sidequest-snow-paid-counts';

export function loadPaidSnowCounts() {
  try {
    const raw = localStorage.getItem(SNOW_PAID_COUNTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function savePaidSnowCounts(paid) {
  try {
    localStorage.setItem(SNOW_PAID_COUNTS_KEY, JSON.stringify(paid || {}));
  } catch {}
}

/**
 * Pure diff: how many of my counted adds are still unpaid?
 * Returns { owed, newPaid } — `owed` is what to pay now (×5
 * coins), `newPaid` is the paid count to store. A counted total
 * LOWER than the paid count means the room state was wiped (a
 * server restart) and started over, so the paid count resets to
 * 0 and the current adds pay in full.
 */
export function owedSnowAdds(myCounted, paidCount) {
  const counted = Number(myCounted) || 0;
  const paid = Number(paidCount) || 0;
  if (counted <= paid) {
    return counted > 0 && paid > counted
      ? { owed: counted, newPaid: counted }
      : { owed: 0, newPaid: paid };
  }
  return { owed: counted - paid, newPaid: counted };
}
