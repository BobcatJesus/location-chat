// floorLitterState.js — shared floor-litter rules for Side Quest
// (Shared Floor Litter v1, `sq-shared-litter-v1`).
//
// Pure logic, no Phaser and no Node APIs, so BOTH sides import it:
//   - server/socket.js (canonical room state, validates every drop
//     and pickup)
//   - src/village/FloorLitterSystem.js (local state + instant
//     feedback)
//
// THE IDEA: dropping a pocket item puts it on the floor where you
// stand, and EVERYONE in the room sees it and can pick it up —
// the litter is shared, not session-local like the old dropItem.
// That is what the "Catch a Litterbug" quest stands on: a real
// player littering is a visible event with a dropper and a time.
//
// WHAT IS STORED: one entry per dropped item — the item snapshot
// (type / title / text / label / blurb / decorKind / breadKind /
// trashFood / usesLeft, exactly what dropItem already carried),
// where it landed, and WHO dropped it and WHEN (droppedBy /
// droppedByName / droppedAt — the quest kit needs both for its
// freshness window). The emoji is derived from the type HERE, so
// a client can never smuggle a misleading emoji through.
//
// IN-MEMORY ONLY: there is no Postgres table and no persistence
// module for litter. A Railway restart wipes floor litter. That is
// fine on purpose: it is litter, and the item already left the
// dropper's pocket either way — a restart never resurrects a
// dropped item back into a pocket. Home rooms never use this:
// their drops go through the per-player home floor store.
//
// PICKUP (first-come-wins): anyone can pick up anyone's litter —
// that is how litter gets cleaned up, and informal giving. A
// pickup CLAIMS the entry first (10s, see below) so two players
// grabbing the same item cannot both get it: the first claim
// wins, the second is told it is gone. The claim only becomes
// final when the picker confirms the item landed in their pocket
// (the mail_collect_confirm pattern); a picker that never
// confirms — crashed tab, lost packet — has the entry restored
// after the claim expires, so a litter item is never eaten by a
// failed pickup. The server sweeps expired claims lazily on every
// floor-litter handler call, so no timer process is needed.
//
// NUMBERS THE USER DID NOT DECIDE (picked here, documented):
//   - FLOOR_LITTER_MAX_PER_ROOM = 30: a room can hold 30 dropped
//     items, same as placed decorations. When a room is full, a
//     drop REFUSES ('room-full') and the item stays in the pocket
//     — a full room never silently destroys an item.
//   - FLOOR_LITTER_CLAIM_MS = 10_000: a pickup claim lives 10s.
//     Far above a healthy round trip, far below "stuck forever".

export const FLOOR_LITTER_MARKER_V1 = 'sq-shared-litter-v1';
// Live reference so the marker survives minification (same pattern
// as the puzzle / tree markers).
export const FLOOR_LITTER_MARKER = 'sq-shared-litter-v1';

export const FLOOR_LITTER_MAX_PER_ROOM = 30;
export const FLOOR_LITTER_CLAIM_MS = 10_000;

// Room bounds are generous on purpose: Agora is 1600x900, parks
// are much bigger. The client clamps to its own room; the server
// only refuses nonsense coordinates.
const MAX_X = 4000;
const MAX_Y = 3000;

// The emoji for a dropped item, by type — derived here, never
// taken from the wire.
export const FLOOR_LITTER_EMOJI_BY_TYPE = {
  trash: '🗑️',
  flyer: '📄',
  note: '📝',
  diary: '📖',
  food: '🥐',
  cigarettes: '🚬',
  decoration: '🎄',
};

// The never-drop list, inlined as plain strings so this module
// stays importable by the server without pulling items.js in
// (same reason mailState.js inlines its food-charge constant).
// These three can never be dropped — the mailbox key would lock
// you out of your own mail, puzzle pieces belong on the board,
// and the Santa hat is a shared room item with server state.
export const FLOOR_LITTER_NEVER_DROP_TYPES = new Set([
  'mailbox-key',
  'puzzle-piece',
  'santa-hat',
]);

/** May this item type be dropped on the floor? */
export function isNeverDropType(type) {
  return FLOOR_LITTER_NEVER_DROP_TYPES.has(String(type || '').trim());
}

/** A room's floor litter: { items: [entry, ...] (oldest first),
 *  claims: { litterId: { entry, pickerId, at } } }. Claimed
 *  entries are NOT in `items` — they are invisible until the
 *  claim is confirmed (gone for good) or cancelled / expired
 *  (back on the floor). */
export function createFloorLitterState() {
  return {
    items: [],
    claims: {},
  };
}

function sliceStr(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : null;
}

/** Clean a litter payload the way the server accepts it.
 * Returns the cleaned entry or null when unusable. The emoji is
 * derived from the type here — a client-supplied emoji is ignored.
 * droppedBy / droppedByName / droppedAt are server-set on drop;
 * a payload that already carries them (a re-serialised entry)
 * keeps them, cleaned. */
export function cleanFloorLitterEntry(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const type = String(r.type || '').trim();
  if (!type) return null;
  const x = Number(r.x);
  const y = Number(r.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const droppedAt = Number(r.droppedAt);
  const item = (r.item && typeof r.item === 'object') ? r.item : r;
  return {
    id: String(r.id || '').trim()
      || `litter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    title: sliceStr(item.title, 120),
    label: sliceStr(item.label, 120) || sliceStr(r.label, 120),
    blurb: sliceStr(item.blurb, 200) || sliceStr(r.blurb, 200),
    text: sliceStr(item.text, 2000) || sliceStr(r.text, 2000),
    decorKind: typeof item.decorKind === 'string' ? item.decorKind : (typeof r.decorKind === 'string' ? r.decorKind : null),
    breadKind: typeof item.breadKind === 'string' ? item.breadKind : (typeof r.breadKind === 'string' ? r.breadKind : null),
    trashFood: type === 'food' ? Boolean(item.trashFood ?? r.trashFood) : null,
    // Feed the Ducks v2: food keeps its remaining feeds (clamped
    // to 3); non-food keeps null. Food without a usable count
    // arrives full (addItem defaults it to 3 on pickup).
    usesLeft: type === 'food' && Number.isFinite(Number(item.usesLeft ?? r.usesLeft)) && Number(item.usesLeft ?? r.usesLeft) >= 1
      ? Math.min(Math.floor(Number(item.usesLeft ?? r.usesLeft)), 3)
      : null,
    emoji: FLOOR_LITTER_EMOJI_BY_TYPE[type] || '📦',
    x: Math.max(0, Math.min(MAX_X, Math.round(x))),
    y: Math.max(0, Math.min(MAX_Y, Math.round(y))),
    droppedBy: String(r.droppedBy || ''),
    droppedByName: String(r.droppedByName || 'Someone').slice(0, 80) || 'Someone',
    droppedAt: Number.isFinite(droppedAt) ? droppedAt : Date.now(),
  };
}

/** The pocket item a picked-up entry becomes (what addItem
 * takes). Food picked up off the ground is trash food — a
 * dropped croissant by the bar, bits by the pond, or anything
 * dropped on the floor — unless it is a bought bread (breadKind
 * set), which is never trash food. Same rule as
 * ItemsSystem.pickupTapAt for spawned litter. */
export function litterPocketItem(entry) {
  if (!entry) return null;
  const item = {
    type: entry.type,
    title: entry.title ?? null,
    text: entry.text ?? null,
    label: entry.label ?? null,
    blurb: entry.blurb ?? null,
    decorKind: entry.decorKind ?? null,
    breadKind: entry.breadKind ?? null,
    trashFood: entry.trashFood ?? null,
    usesLeft: entry.usesLeft ?? null,
  };
  if (item.type === 'food' && !item.breadKind) item.trashFood = true;
  return item;
}

/**
 * Drop an item on the floor. Returns { ok, entry?, reason? }.
 * Fails on a bad entry ('bad-entry'), a never-drop type
 * ('not-droppable'), a duplicate id ('duplicate'), or a full
 * room ('room-full' — the item stays in the pocket, it is never
 * silently destroyed).
 */
export function addFloorLitter(state, raw) {
  const entry = cleanFloorLitterEntry(raw);
  if (!entry) return { ok: false, reason: 'bad-entry' };
  if (isNeverDropType(entry.type)) return { ok: false, reason: 'not-droppable' };
  const list = state.items || (state.items = []);
  if (list.some((e) => e.id === entry.id)) return { ok: false, reason: 'duplicate' };
  if (list.length >= FLOOR_LITTER_MAX_PER_ROOM) return { ok: false, reason: 'room-full' };
  list.push(entry);
  return { ok: true, entry };
}

/**
 * Remove a litter entry outright (moderator / cleanup paths).
 * Returns { ok, entry?, reason? } — reason is 'not-found'.
 */
export function removeFloorLitter(state, litterId) {
  const list = state.items || (state.items = []);
  const idx = list.findIndex((e) => e.id === String(litterId));
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const [entry] = list.splice(idx, 1);
  return { ok: true, entry };
}

/**
 * Claim an entry for pickup (first-come-wins). The entry leaves
 * the visible list and waits in `claims` until the picker
 * confirms it landed in their pocket (or cancels / times out).
 * Returns { ok, entry?, reason? } — reason is 'not-found' when
 * the entry is gone or already claimed by someone else.
 */
export function claimFloorLitter(state, litterId, pickerId, now = Date.now()) {
  const list = state.items || (state.items = []);
  const idx = list.findIndex((e) => e.id === String(litterId));
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const [entry] = list.splice(idx, 1);
  const claims = state.claims || (state.claims = {});
  claims[entry.id] = { entry, pickerId: String(pickerId || ''), at: Number(now) || Date.now() };
  return { ok: true, entry };
}

/**
 * The picker confirmed the item landed in their pocket: the claim
 * is settled and the entry is gone for good. Returns
 * { ok, entry?, reason? } — 'not-found' (no such claim) or
 * 'not-allowed' (someone else's claim).
 */
export function confirmFloorLitterClaim(state, litterId, pickerId) {
  const claims = state.claims || (state.claims = {});
  const claim = claims[String(litterId)];
  if (!claim) return { ok: false, reason: 'not-found' };
  if (String(claim.pickerId) !== String(pickerId || '')) return { ok: false, reason: 'not-allowed' };
  delete claims[String(litterId)];
  return { ok: true, entry: claim.entry };
}

/**
 * The picker could not take the item (pocket filled in the
 * meantime): the entry goes back on the floor, visible again.
 * Returns { ok, entry?, reason? } — 'not-found' or 'not-allowed'
 * (same as confirm).
 */
export function cancelFloorLitterClaim(state, litterId, pickerId) {
  const claims = state.claims || (state.claims = {});
  const claim = claims[String(litterId)];
  if (!claim) return { ok: false, reason: 'not-found' };
  if (String(claim.pickerId) !== String(pickerId || '')) return { ok: false, reason: 'not-allowed' };
  delete claims[String(litterId)];
  const list = state.items || (state.items = []);
  list.push(claim.entry);
  return { ok: true, entry: claim.entry };
}

/**
 * Restore claims older than FLOOR_LITTER_CLAIM_MS (a picker that
 * never confirmed — crashed tab, lost packet): their entries go
 * back on the floor. Returns { restored } — the count restored,
 * so the caller knows whether to broadcast. Never mutates the
 * input's claim objects, only moves them.
 */
export function sweepFloorLitterClaims(state, now = Date.now()) {
  const claims = state.claims || (state.claims = {});
  const list = state.items || (state.items = []);
  let restored = 0;
  for (const id of Object.keys(claims)) {
    const claim = claims[id];
    if (!claim) { delete claims[id]; continue; }
    if (Number(now) - Number(claim.at || 0) > FLOOR_LITTER_CLAIM_MS) {
      delete claims[id];
      list.push(claim.entry);
      restored += 1;
    }
  }
  return { restored };
}

/** Plain JSON copy safe to send over the socket. Claimed entries
 * are invisible — they are neither on the floor nor in anyone's
 * pocket yet. `now` is the server's clock at serialize time, so
 * clients can judge freshness (Catch a Litterbug v1,
 * `sq-litterbug-quest-v1`) against server time instead of their
 * own clock alone. */
export function serializeFloorLitterState(state) {
  const s = state || createFloorLitterState();
  return {
    now: Date.now(),
    items: (s.items || []).map((e) => ({
      id: String(e.id),
      type: String(e.type || ''),
      title: e.title ?? null,
      label: e.label ?? null,
      blurb: e.blurb ?? null,
      text: e.text ?? null,
      decorKind: e.decorKind ?? null,
      breadKind: e.breadKind ?? null,
      trashFood: e.trashFood ?? null,
      usesLeft: e.usesLeft ?? null,
      emoji: String(e.emoji || '📦'),
      x: Number(e.x) || 0,
      y: Number(e.y) || 0,
      droppedBy: String(e.droppedBy || ''),
      droppedByName: String(e.droppedByName || 'Someone'),
      droppedAt: Number(e.droppedAt) || 0,
    })),
    count: (s.items || []).length,
    max: FLOOR_LITTER_MAX_PER_ROOM,
  };
}

/** Validate an incoming state object (never trust the wire).
 * Claims never arrive over the wire — they start empty. */
export function parseFloorLitterState(raw) {
  const s = createFloorLitterState();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return s;
  for (const entry of raw.items.slice(0, FLOOR_LITTER_MAX_PER_ROOM)) {
    const clean = cleanFloorLitterEntry(entry);
    if (!clean) continue;
    if (s.items.some((e) => e.id === clean.id)) continue;
    s.items.push(clean);
  }
  return s;
}
