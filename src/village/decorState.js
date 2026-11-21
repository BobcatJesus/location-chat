// decorState.js — shared decoration-shop rules for Side Quest
// (Decoration Shop v1, `sq-dec-shop-v1`).
//
// Pure logic, no Phaser and no Node APIs, so BOTH sides import it:
//   - server/socket.js (canonical room state, validates every place
//     and removal)
//   - src/village/DecorSystem.js (local state + instant feedback)
//
// THE SHOP (user-decided 2026-11-16): buy Christmas decorations at
// the Agora coffee bar. Approaching the bar offers "buy a coffee"
// (-2 coins, existing) or "buy a decoration". Buying COSTS coins
// (a coin sink, same rule as coffee) — no coin reward for buying or
// placing. A bought decoration goes into the pocket as an inventory
// item (one slot: pocket 3 / bag 10, same as other items). From the
// pocket, "Place" puts it where you are standing, and EVERYONE in
// the room sees it. Decorations are NOT limited to Your Place —
// placeable anywhere: your place, a park tree, anywhere.
//
// PRICES (user-set): ornament 5, lights 10, snowman 15. Krampus 50
// is DEFERRED ("we'll figure out krampus later") — he is NOT in
// this kit at all. Tree and Santa figure prices were never set:
//   - TREE = 25 coins, SANTA = 20 coins (BUILDER PICKS — flagged:
//     "relatively expensive", the tree is the biggest decoration,
//     Santa a character figure, both above the snowman's 15).
//
// NUMBERS THE USER DID NOT DECIDE (picked here, documented):
//   - DECOR_MAX_PER_ROOM = 30: a room can hold 30 placed
//     decorations. Boards cap at 10 flyers, but decorations are
//     smaller and a room (especially a park) can hold more. When a
//     room is full, placing REFUSES ('room-full') and the item stays
//     in your pocket — a bought item is never silently dropped the
//     way an 11th flyer falls off a board.
//   - Taking back: the owner picks their own decoration back up
//     (tap it / E near it) — it returns to the pocket if there is
//     room, otherwise it stays placed and the pocket-full message
//     shows. A moderator can remove ANY decoration; a moderator
//     removal always discards it (same rule as the notice board).
//   - State is IN-MEMORY per room, like the notice board, the
//     puzzle and the trees: a Railway restart wipes placed
//     decorations everywhere, INCLUDING Your Place. Home persistence
//     (decorations at home surviving a restart) is NOT in v1 — it
//     belongs with the 5-decoration Your Place badge kit, which
//     needs to count home decorations persistently anyway.

export const DEC_SHOP_MARKER_V1 = 'sq-dec-shop-v1';
// Live reference so the marker survives minification (same pattern
// as the puzzle / tree markers).
export const DECOR_MARKER_V1 = 'sq-dec-shop-v1';
// Decoration Shop v1.1 (`sq-dec-shop-v1-1`): the place flow no longer
// waits forever for a server confirm that may never come — a pending
// place/pickup times out (~5s), the client re-requests decor state,
// and placing is gated on the room join being confirmed. Prices,
// kinds, cap and take-back rules are exactly v1.
export const DEC_SHOP_MARKER_V11 = 'sq-dec-shop-v1-1';

export const DECOR_MAX_PER_ROOM = 30;

// The five decorations the Agora bar sells in v1. Krampus is NOT
// here (deferred by the user). Prices are the user's for ornament /
// lights / snowman; tree and Santa are builder picks (see above).
export const DECOR_KINDS = {
  ornament: {
    kind: 'ornament', emoji: '🔴', label: 'Ornament',
    blurb: 'A shiny bauble for a tree, a wall, or wherever it lands.',
    price: 5,
  },
  lights: {
    kind: 'lights', emoji: '💡', label: 'Christmas lights',
    blurb: 'A string of warm little bulbs. Instant festive.',
    price: 10,
  },
  snowman: {
    kind: 'snowman', emoji: '⛄', label: 'Snowman',
    blurb: 'A small snowman. He does not melt. Probably.',
    price: 15,
  },
  tree: {
    kind: 'tree', emoji: '🎄', label: 'Mini Christmas tree',
    blurb: 'A little tree of your very own, star included.',
    price: 25,
  },
  santa: {
    kind: 'santa', emoji: '🎅', label: 'Santa figure',
    blurb: 'A jolly Santa figure, ready to watch over the room.',
    price: 20,
  },
};

export const DECOR_KIND_IDS = Object.keys(DECOR_KINDS);

// Room bounds are generous on purpose: Agora is 1600x900, parks
// are much bigger. The client clamps to its own room; the server
// only refuses nonsense coordinates.
const MAX_X = 4000;
const MAX_Y = 3000;

/** A placed decoration: { id, kind, x, y, addedBy, addedByName, createdAt }. */
export function createDecorState() {
  return {
    decorations: [], // oldest first
  };
}

/** Clean a decoration payload the way the server accepts it.
 * Returns the cleaned decoration or null when unusable. */
export function cleanDecoration(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const kind = String(r.kind || '').trim();
  if (!DECOR_KINDS[kind]) return null;
  const x = Number(r.x);
  const y = Number(r.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    id: String(r.id || '').trim()
      || `decor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    x: Math.max(0, Math.min(MAX_X, Math.round(x))),
    y: Math.max(0, Math.min(MAX_Y, Math.round(y))),
    addedBy: String(r.addedBy || ''),
    addedByName: String(r.addedByName || 'Someone').slice(0, 80) || 'Someone',
    createdAt: Number(r.createdAt) || Date.now(),
  };
}

/**
 * Place a decoration in the room. Returns { ok, decoration?, reason? }.
 * Fails on a bad kind / duplicate id / full room. A full room
 * REFUSES — the bought item stays in the pocket (it is never
 * silently dropped the way an 11th flyer falls off a board).
 */
export function placeDecoration(state, raw) {
  const decor = cleanDecoration(raw);
  if (!decor) return { ok: false, reason: 'bad-kind' };
  const list = state.decorations || (state.decorations = []);
  if (list.some((d) => d.id === decor.id)) return { ok: false, reason: 'duplicate' };
  if (list.length >= DECOR_MAX_PER_ROOM) return { ok: false, reason: 'room-full' };
  list.push(decor);
  return { ok: true, decoration: decor };
}

/** May this user take this decoration down? Its owner, or any
 * decoration for a moderator. The server re-checks this — never
 * trust the client. */
export function canRemoveDecoration(decor, userId, isModerator) {
  if (!decor) return false;
  if (isModerator) return true;
  return Boolean(userId) && String(decor.addedBy) === String(userId);
}

/**
 * Take a decoration down. Returns { ok, decoration?, reason? } —
 * reason is 'not-found' or 'not-allowed'. The caller decides what
 * happens afterwards: back to the owner's pocket if they took it
 * down themselves and have room, discarded otherwise (a moderator
 * removal always discards it).
 */
export function removeDecoration(state, decorId, userId, isModerator) {
  const list = state.decorations || (state.decorations = []);
  const idx = list.findIndex((d) => d.id === String(decorId));
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const decor = list[idx];
  if (!canRemoveDecoration(decor, userId, isModerator)) return { ok: false, reason: 'not-allowed' };
  list.splice(idx, 1);
  return { ok: true, decoration: decor };
}

/** Plain JSON copy safe to send over the socket. */
export function serializeDecorState(state) {
  const s = state || createDecorState();
  return {
    decorations: (s.decorations || []).map((d) => ({
      id: String(d.id),
      kind: String(d.kind || ''),
      x: Number(d.x) || 0,
      y: Number(d.y) || 0,
      addedBy: String(d.addedBy || ''),
      addedByName: String(d.addedByName || 'Someone'),
      createdAt: Number(d.createdAt) || 0,
    })),
    count: (s.decorations || []).length,
    max: DECOR_MAX_PER_ROOM,
  };
}

/** Validate an incoming state object (never trust the wire). */
export function parseDecorState(raw) {
  const s = createDecorState();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.decorations)) return s;
  for (const entry of raw.decorations.slice(0, DECOR_MAX_PER_ROOM)) {
    const decor = cleanDecoration(entry);
    if (!decor) continue;
    if (s.decorations.some((d) => d.id === decor.id)) continue;
    s.decorations.push(decor);
  }
  return s;
}
