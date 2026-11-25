// lightState.js — shared Christmas Lights rules (Christmas Lights v1,
// `sq-christmas-lights-v1`).
//
// Pure logic, no Phaser and no Node APIs, so BOTH sides import it:
//   - server/socket.js (canonical room state, validates every hang)
//   - src/village/ChristmasLightsQuest.js (local fallback + instant
//     feedback when the socket is down)
//
// The quest: a box of FREE light strings sits in the south-east
// corner of Agora. Take one, walk to the north wall above the
// coffee bar, hang it. 25 counted strings light the room — the
// bulbs appear along the walls as more people contribute. One
// room, one round: when the 25th counted string lands, the room
// is fully lit (the counter-front strand switches on too) and the
// quest is done for the venue until a server restart wipes the
// in-memory state.
//
// HIDDEN RULE (never explained in the UI): a player can hang as
// many strings as they like and the process always works, but only
// their FIRST string counts toward the 25. Extras still render as
// bulbs on the walls (the player sees their lights go up) — they
// just do not advance the X/25 counter. So the room needs 25
// DIFFERENT people to light up.
//
// This mirrors Trim the Tree (treeState.js) exactly, minus the
// second tree: the tree has two rounds per venue, the lights have
// one. The state is in-memory only in v1 (a server restart wipes
// it, exactly like the tree before `sq-tree-persist-v1`) — a
// persistence piece can follow the same pattern later.

export const LIGHTS_ID = 'christmas-lights';
export const LIGHTS_MARKER_V1 = 'sq-christmas-lights-v1';
export const LIGHTS_TOTAL = 25; // counted strings that light the room
export const LIGHTS_REWARD_COINS = 5; // same as Trim the Tree / Group Puzzle
export const LIGHTS_BOX_TAKE_RANGE = 140; // px from the box to take a string
export const LIGHTS_HANG_RANGE = 170; // px from the hang spot to hang it

// Fill stages for the room, by COUNTED strings (firsts only).
// Stage 0 covers 0-1 counted: the first string alone leaves the
// walls looking bare — the strands fill in only as more PEOPLE
// contribute. Individual counted bulbs still render in their slots
// from the first hang (that is the feedback that a hang worked);
// the STAGE is what stays bare.
export const LIGHTS_STAGE_THRESHOLDS = [2, 7, 13, 19, 25];

/** Fill stage 0..5 for `counted` counted strings. */
export function lightsStage(counted) {
  const c = Number(counted) || 0;
  let stage = 0;
  for (const t of LIGHTS_STAGE_THRESHOLDS) {
    if (c >= t) stage += 1;
  }
  return stage;
}

// Bulb slots on the walls: absolute room coordinates (the room is
// 1600x900, boundary 80..1520 x 80..820). 25 slots, one per counted
// string, spread along the north wall (above the coffee bar), then
// the east wall, then the west wall, so the room lights up evenly
// as the count grows. Deterministic — every client renders the
// same slots.
export const LIGHTS_BULB_SLOTS = [
  // North wall (above the coffee bar), 10 bulbs, slight sag.
  { x: 200, y: 100 }, { x: 333, y: 112 }, { x: 466, y: 100 }, { x: 600, y: 112 },
  { x: 733, y: 100 }, { x: 866, y: 112 }, { x: 1000, y: 100 }, { x: 1133, y: 112 },
  { x: 1266, y: 100 }, { x: 1400, y: 112 },
  // East wall, 7 bulbs.
  { x: 1500, y: 180 }, { x: 1490, y: 267 }, { x: 1500, y: 353 }, { x: 1490, y: 440 },
  { x: 1500, y: 527 }, { x: 1490, y: 613 }, { x: 1500, y: 700 },
  // West wall, 8 bulbs.
  { x: 100, y: 180 }, { x: 110, y: 255 }, { x: 100, y: 330 }, { x: 110, y: 405 },
  { x: 100, y: 480 }, { x: 110, y: 555 }, { x: 100, y: 630 }, { x: 110, y: 705 },
];

// Extra slots for strings past a player's first: extras render as
// bulbs too (same sizes — the hidden rule must not be visible), at
// these positions, cycling if there are more extras than slots.
// Counted and extra slots never overlap.
export const LIGHTS_EXTRA_SLOTS = [
  { x: 266, y: 106 }, { x: 533, y: 106 }, { x: 800, y: 106 }, { x: 1066, y: 106 }, { x: 1333, y: 106 },
  { x: 1495, y: 223 }, { x: 1495, y: 396 }, { x: 1495, y: 570 }, { x: 1495, y: 656 },
  { x: 105, y: 217 }, { x: 105, y: 367 }, { x: 105, y: 517 }, { x: 105, y: 667 },
  { x: 400, y: 100 }, { x: 666, y: 112 }, { x: 933, y: 100 }, { x: 1200, y: 112 },
  { x: 1490, y: 310 }, { x: 110, y: 442 }, { x: 1495, y: 483 },
];

// Bulb colours cycle so the strands are not 25 identical dots.
export const LIGHTS_BULB_COLORS = [0xfef08a, 0xef4444, 0x3b82f6, 0x22c55e, 0xec4899, 0xf97316];

/** Colour for bulb slot `index` (0-based). */
export function bulbColor(index) {
  const i = Number(index) || 0;
  return LIGHTS_BULB_COLORS[i % LIGHTS_BULB_COLORS.length];
}

export function createLightState() {
  return {
    counted: 0, // first-strings hung (0..25) — the X/25 number
    extras: 0, // hangs past a player's first — render only, never counted
    contributors: [], // user ids whose FIRST string counted
    hungBy: {}, // userId -> total hangs (enforces first-only)
    completed: false,
    completedAt: 0, // Date.now() when the 25th counted string landed
  };
}

/** Is the room fully lit? */
export function isLightsComplete(state) {
  return Boolean(state?.completed) || (Number(state?.counted) || 0) >= LIGHTS_TOTAL;
}

/** Progress for the tracker: { counted, total, completed }. */
export function lightsProgress(state) {
  const s = state || createLightState();
  return {
    counted: Math.max(0, Math.min(LIGHTS_TOTAL, Number(s.counted) || 0)),
    total: LIGHTS_TOTAL,
    completed: isLightsComplete(s),
  };
}

/** Plain JSON copy safe to send over the socket. */
export function serializeLightState(state) {
  const s = state || createLightState();
  return {
    counted: Math.max(0, Math.min(LIGHTS_TOTAL, Number(s.counted) || 0)),
    extras: Math.max(0, Math.min(999, Number(s.extras) || 0)),
    contributors: [...new Set((s.contributors || []).map((u) => String(u)).filter(Boolean))].slice(0, 50),
    hungBy: Object.fromEntries(
      Object.entries(s.hungBy || {})
        .filter(([u, n]) => u && Number.isFinite(Number(n)) && Number(n) > 0)
        .slice(0, 50),
    ),
    completed: Boolean(s.completed),
    completedAt: Number(s.completedAt) || 0,
    total: LIGHTS_TOTAL,
  };
}

/** Validate an incoming state object (never trust the wire). */
export function parseLightState(raw) {
  const s = createLightState();
  if (!raw || typeof raw !== 'object') return s;
  s.counted = Math.max(0, Math.min(LIGHTS_TOTAL, Number(raw.counted) || 0));
  s.extras = Math.max(0, Math.min(999, Number(raw.extras) || 0));
  if (Array.isArray(raw.contributors)) {
    s.contributors = [...new Set(raw.contributors.map((u) => String(u)).filter(Boolean))].slice(0, 50);
  }
  if (raw.hungBy && typeof raw.hungBy === 'object') {
    for (const [u, n] of Object.entries(raw.hungBy)) {
      if (!u || !Number.isFinite(Number(n)) || Number(n) <= 0) continue;
      s.hungBy[u] = Math.min(999, Number(n));
    }
  }
  s.completed = Boolean(raw.completed) || s.counted >= LIGHTS_TOTAL;
  if (Number.isFinite(Number(raw.completedAt))) s.completedAt = Number(raw.completedAt);
  // A completed room's counted number is always the full 25 — a
  // wire state that claims "complete" with fewer is repaired.
  if (s.completed) s.counted = LIGHTS_TOTAL;
  return s;
}

/**
 * One player hung a light string on the wall. Returns
 * { ok, counted, finished, contributors }.
 *
 * HIDDEN RULE: only the player's FIRST hang counts toward the 25.
 * Later hangs by the same player still succeed (ok: true,
 * counted: false) and render as extra bulbs — the caller must show
 * the SAME feedback for a counted hang and an extra one, or the
 * rule leaks. The 25th counted string finishes the room.
 */
export function hangLight(state, userId) {
  const s = state || createLightState();
  if (s.completed) return { ok: false, reason: 'already-complete' };
  const uid = String(userId || '');
  if (!uid) return { ok: false, reason: 'bad-user' };
  s.hungBy[uid] = (Number(s.hungBy[uid]) || 0) + 1;
  let counted = false;
  if (!s.contributors.includes(uid)) {
    s.contributors.push(uid);
    s.counted += 1;
    counted = true;
  } else {
    s.extras += 1;
  }
  let finished = false;
  if (s.counted >= LIGHTS_TOTAL) {
    s.completed = true;
    s.completedAt = Date.now();
    finished = true;
  }
  return { ok: true, counted, finished, contributors: [...s.contributors] };
}
