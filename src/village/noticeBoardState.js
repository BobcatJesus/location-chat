// noticeBoardState.js — shared notice-board rules for EVERY room
// (Notice Board v1, `sq-notice-board-v1`; boards in every location,
// `sq-notice-board-everywhere-v1`).
//
// Pure logic, no Phaser and no Node APIs, so BOTH sides import it:
//   - server/socket.js (canonical room state, validates every pin
//     and removal)
//   - src/village/NoticeBoardSystem.js (local state + instant feedback)
//
// The board hangs by the room's entrance — Agora's south wall west
// of the door (see layouts/agora.js), Lola's south wall, the Library
// ground floor, a post by the park entry, or a synthetic spot near
// the entrance in any other room (see noticeBoardPlacement.js).
// A flyer pinned here is visible to EVERYONE in the room, unlike a
// only its owner sees. Pinning is free; making the flyer still costs
// 5 coins (inventory v1 rule, unchanged), and pinning removes the
// flyer from your pocket (it frees the slot).
//
// NUMBERS THE USER DID NOT DECIDE (picked here, documented):
//   - NOTICE_BOARD_MAX_FLYERS = 10: when the 11th flyer is pinned,
//     the OLDEST one falls off the board (it is gone, not returned).
//   - Taking down your OWN flyer returns it to your pocket if there
//     is room; if your pocket is full, it is discarded.
//   - A moderator can take down ANY flyer (reuse of the existing
//     moderator check); a moderator removal discards the flyer —
//     it does NOT go back to its owner's pocket.
//   - State is IN-MEMORY per room, like the puzzle: a Railway
//     restart wipes the board clean.

export const NOTICE_BOARD_MARKER = 'sq-notice-board-v1';
// Boards in every location (not just Agora) — marker for the
// everywhere landing check.
export const NOTICE_BOARD_EVERYWHERE_MARKER = 'sq-notice-board-everywhere-v1';
export const NOTICE_BOARD_MAX_FLYERS = 10;
// Flyers are the inventory v1 flyers: same limits.
export const NOTICE_BOARD_TITLE_MAX = 60;
export const NOTICE_BOARD_TEXT_MAX = 200;

/** A pinned flyer: { id, title, text, addedBy, addedByName, createdAt }.
 * `addedBy` is the pinner's user id (their email, same as the puzzle's
 * contributors list) — it is what "your own flyer" means. */
export function createNoticeBoardState() {
  return {
    flyers: [], // oldest first; pinning past the cap drops flyers[0]
  };
}

/** Clean a flyer payload the way the server accepts it. Returns the
 * cleaned flyer or null when it has no usable title or text. */
export function cleanFlyer(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const title = String(r.title || '').trim().slice(0, NOTICE_BOARD_TITLE_MAX);
  const text = String(r.text || '').trim().slice(0, NOTICE_BOARD_TEXT_MAX);
  if (!title || !text) return null;
  return {
    id: String(r.id || '').trim()
      || `board-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    text,
    addedBy: String(r.addedBy || ''),
    addedByName: String(r.addedByName || 'Someone').slice(0, 80) || 'Someone',
    createdAt: Number(r.createdAt) || Date.now(),
  };
}

/**
 * Pin a flyer to the board. Returns { ok, flyer?, dropped?, reason? }.
 * Fails on an empty/duplicate flyer. When the board is full (10),
 * the OLDEST flyer falls off — `dropped` carries it, so the caller
 * can say so. The dropped flyer is gone, not returned to anyone.
 */
export function pinFlyer(state, raw) {
  const flyer = cleanFlyer(raw);
  if (!flyer) return { ok: false, reason: 'empty-flyer' };
  const list = state.flyers || (state.flyers = []);
  if (list.some((f) => f.id === flyer.id)) return { ok: false, reason: 'duplicate' };
  let dropped = null;
  if (list.length >= NOTICE_BOARD_MAX_FLYERS) {
    dropped = list.shift();
  }
  list.push(flyer);
  return { ok: true, flyer, dropped };
}

/** May this user take this flyer down? Own flyers, or any flyer for
 * a moderator. The server re-checks this — never trust the client. */
export function canRemoveFlyer(flyer, userId, isModerator) {
  if (!flyer) return false;
  if (isModerator) return true;
  return Boolean(userId) && String(flyer.addedBy) === String(userId);
}

/**
 * Take a flyer down. Returns { ok, flyer?, reason? } — reason is
 * 'not-found' or 'not-allowed'. The caller decides what happens to
 * the flyer afterwards: back to the owner's pocket if they took it
 * down themselves and have room, discarded otherwise (a moderator
 * removal always discards it).
 */
export function removeFlyer(state, flyerId, userId, isModerator) {
  const list = state.flyers || (state.flyers = []);
  const idx = list.findIndex((f) => f.id === String(flyerId));
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const flyer = list[idx];
  if (!canRemoveFlyer(flyer, userId, isModerator)) return { ok: false, reason: 'not-allowed' };
  list.splice(idx, 1);
  return { ok: true, flyer };
}

/** Plain JSON copy safe to send over the socket. */
export function serializeNoticeBoardState(state) {
  const s = state || createNoticeBoardState();
  return {
    flyers: (s.flyers || []).map((f) => ({
      id: String(f.id),
      title: String(f.title || ''),
      text: String(f.text || ''),
      addedBy: String(f.addedBy || ''),
      addedByName: String(f.addedByName || 'Someone'),
      createdAt: Number(f.createdAt) || 0,
    })),
    count: (s.flyers || []).length,
    max: NOTICE_BOARD_MAX_FLYERS,
  };
}

/** Validate an incoming state object (never trust the wire). */
export function parseNoticeBoardState(raw) {
  const s = createNoticeBoardState();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.flyers)) return s;
  for (const entry of raw.flyers.slice(0, NOTICE_BOARD_MAX_FLYERS)) {
    const flyer = cleanFlyer(entry);
    if (!flyer) continue;
    if (s.flyers.some((f) => f.id === flyer.id)) continue;
    s.flyers.push(flyer);
  }
  return s;
}
