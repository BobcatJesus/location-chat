// homeStorage.js — "Your Place" (Your Place v1, `sq-your-place-v1`).
//
// PURE LOGIC + localStorage store: no Phaser, no React, no Node APIs,
// so it is unit-testable (tests/homeStorage.test.js) and importable
// from both the scene system and the server (server/socket.js).
//
// THE USER'S RULES (decided in chat 2026-11-16 — do not invent others):
//   - "Your place" is a personal home room, ONE PER PLAYER:
//     roomId `home-<ownerId>`, where <ownerId> is the player's
//     profile email (same key the inventory and coins use), lowercased
//     and sanitized. Private: ONLY the owner can join — anyone else
//     is refused by the server (join_denied).
//   - Storage: you can leave stuff at your place, and ONLY at your
//     place (a storage chest). Examples the user named: the mailbox
//     key, a fishing pole, a metal detector — plus any inventory item.
//   - UNLOAD ALL: at your place you can unload your whole pocket/bag
//     into storage at once, freeing up space for the day's quest.
//   - The MAILBOX is NOT part of this kit: the mailbox lives at the
//     nearest park, not outside your place (separate build later).
//     Do NOT add a mailbox to your place.
//   - Puzzle pieces are NOT storable: a piece belongs on the puzzle
//     board (it is round-scoped — a new round clears carried pieces),
//     so Store / Unload All leave pieces in your pocket. This is a
//     v1 safety rule, not a user decision — say so if it is ever
//     questioned.
//
// CREATE HOME (v1.1, `sq-your-place-v1-1`):
//   - The way IN to "home" is the map page: the Create a Place flow
//     ("+ Create room here" → the 📍 Create a Place modal) carries a
//     "🏠 Create Home here" option that creates the player's home at
//     their real current GPS location — the same capture as creating
//     a location. The home is a user room (kind 'home', id
//     `home-<owner>`, radius 60m, private), so it shows up on the map
//     like any other created location (MapView pins every room in
//     allRooms) and in the room list.
//   - ONE HOME PER PLAYER, expressed as UI: once a home exists, the
//     "Create Home" option DISAPPEARS from the create-location flow
//     entirely — not disabled, not replaced by a label, just gone.
//     The 🏠 Home top-bar button is the way back after that, and it
//     only shows once a home exists (before that it would lead
//     nowhere). It still hides while already home and for fully
//     anonymous sessions, as in v1.
//

export const HOME_STORAGE_MARKER_V1 = 'sq-your-place-v1';
export const HOME_STORAGE_MARKER_V1_1 = 'sq-your-place-v1-1';

// GPS radius of a home room on the map (same as a created place).
export const HOME_ROOM_RADIUS = 60;

// NUMBERS THE USER DID NOT DECIDE (picked here, documented):
//   - Home storage has NO capacity limit (your place is your place)
//     — only a 200-item sanity cap against a bad client flooding the
//     server store. The pocket/bag limits (3 / 10) still apply when
//     TAKING something back out.
//   - The chest opens from the same 170px range as the notice board
//     and the bartender's talk range.
//   - The server is AUTHORITATIVE for what is stored (same pattern
//     as badges): the client keeps its own localStorage record and
//     re-syncs it on connect (home_sync), so a Railway restart does
//     not wipe stored items. Merges are add-only unions by item id —
//     removals only happen via explicit store / take / unload-all
//     events. Honest edge: a STALE second device/tab whose local
//     record still lists an item you took out elsewhere can bring
//     it back on its next re-sync. The merge favors never LOSING an
//     item over strict removal consistency — a resurrected item is
//     annoying, a vanished one is worse.

// Room id prefix for personal home rooms.
export const HOME_ROOM_PREFIX = 'home-';

// How close you must stand to open the chest (E key) or click it.
export const HOME_CHEST_OPEN_RANGE = 170; // px, same as the notice board

// Sanity cap on stored items (a bad client can't flood the server
// store). The user set no limit — your place holds what it holds.
export const HOME_STORAGE_MAX_ITEMS = 200;

// Item types that can be stored at home. Mirrors ITEM_TYPES in
// items.js (kept as its own list so this module stays importable
// from the server without pulling in CoinWallet).
export const HOME_ITEM_TYPES = [
  'trash',
  'flyer',
  'note',
  'diary',
  'food',
  'cigarettes',
  'puzzle-piece',
];

const HOME_ITEM_TYPE_SET = new Set(HOME_ITEM_TYPES);

// --- room ids -------------------------------------------------------------
// The owner key is the player's profile email (same key the inventory
// and CoinWallet use), lowercased, with anything that is not a letter
// or a digit turned into a dash. Guests get a unique guest email when
// they enter, so their home rooms are unique too. A fully anonymous
// session (no email, no id at all) has NO home room — homeRoomIdFor
// returns null and the 🏠 button hides.
/** Normalize any owner value (email, id, …) into a room-id-safe key. */
export function normalizeHomeOwner(value) {
  const clean = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!clean || clean === 'guest') return '';
  return clean;
}

/** The owner key for a profile object (or a plain email/id string). */
export function ownerKeyFromProfile(profile) {
  if (typeof profile === 'string') return normalizeHomeOwner(profile);
  if (!profile || typeof profile !== 'object') return '';
  const p = profile.profile && typeof profile.profile === 'object' ? profile.profile : profile;
  const raw = p?.email || profile?.email
    || p?.id || profile?.id
    || p?.userId || profile?.userId
    || profile?.mode;
  return normalizeHomeOwner(raw);
}

/** The home room id for a player (`home-<ownerKey>`), or null when
 *  the player has no usable owner key (fully anonymous session). */
export function homeRoomIdFor(profile) {
  const key = ownerKeyFromProfile(profile);
  if (!key) return null;
  return `${HOME_ROOM_PREFIX}${key}`;
}

/** Is this room id a personal home room? */
export function isHomeRoom(roomId) {
  return /^home-[a-z0-9][a-z0-9-]*$/.test(String(roomId || ''));
}

/** The owner key of a home room id ('' when it is not a home room). */
export function homeOwnerOf(roomId) {
  if (!isHomeRoom(roomId)) return '';
  return String(roomId).slice(HOME_ROOM_PREFIX.length);
}

// --- create home (v1.1, pure — no storage access, so unit-testable) -----
// The home is a user room (kind 'home') whose id is `home-<owner>`.
// These helpers work on a plain rooms list (allRooms in app.jsx),
// so the one-home-per-player rule and the "option disappears" UI
// both read from the same source of truth: whether the home room
// is in the list.
/** The player's home room from a rooms list, or null when no home
 *  has been created yet. */
export function findHomeRoom(rooms, profile) {
  const homeId = homeRoomIdFor(profile);
  if (!homeId) return null;
  if (!Array.isArray(rooms)) return null;
  return rooms.find((r) => r && r.id === homeId) || null;
}

/** Is the home option available, and if not, why? Returns
 *  { status, homeId } — status is 'ready' (no home yet, GPS locked,
 *  profile known), 'no-location', 'no-profile', or
 *  'already-exists'. The app uses 'already-exists' to hide the
 *  Create Home option entirely (user's rule: it disappears). */
export function homeCreateState({ location, profile, rooms } = {}) {
  const homeId = homeRoomIdFor(profile);
  if (!homeId) return { status: 'no-profile', homeId: null };
  if (findHomeRoom(rooms, profile)) return { status: 'already-exists', homeId };
  const lat = Number(location?.latitude);
  const lng = Number(location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { status: 'no-location', homeId };
  return { status: 'ready', homeId };
}

// --- storage (per profile, localStorage; in-memory fallback when
// localStorage is unavailable, e.g. node tests / private mode) ------------
const PROFILE_KEY = 'sidequest_profile';
const HOME_STORAGE_PREFIX = 'sidequest-home-storage';

const _memory = new Map();

function _store() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {}
  return null;
}

function _get(key) {
  const s = _store();
  try {
    if (s) return s.getItem(key);
  } catch {}
  return _memory.has(key) ? _memory.get(key) : null;
}

function _set(key, value) {
  const s = _store();
  try {
    if (s) { s.setItem(key, value); return; }
  } catch {}
  _memory.set(key, value);
}

function currentOwner() {
  try {
    const raw = _get(PROFILE_KEY);
    if (!raw) return 'shared';
    const p = JSON.parse(raw);
    const id = p?.email || p?.profile?.email || p?.id || p?.profile?.id || p?.userId || p?.profile?.userId;
    return String(id || '').trim().toLowerCase() || 'shared';
  } catch {
    return 'shared';
  }
}

function homeStorageKey() {
  return `${HOME_STORAGE_PREFIX}:${currentOwner()}`;
}

function emptyHomeStorage() {
  return [];
}

/** The items stored at home, as raw stored shapes (see normalize). */
export function getHomeItems() {
  try {
    const raw = _get(homeStorageKey());
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeHomeItems(parsed);
  } catch {
    return emptyHomeStorage();
  }
}

/** Replace the whole home store (the system persists after every
 *  store / take / unload-all, and after applying a server state). */
export function setHomeItems(items) {
  try {
    _set(homeStorageKey(), JSON.stringify(normalizeHomeItems(items)));
  } catch {}
}

/** Test/support hook: replace the whole home store (used by tests). */
export function _setHomeItemsForTest(items) {
  setHomeItems(items);
}

// --- wire shape -----------------------------------------------------------
// A stored item is the same shape the inventory keeps: { id, type,
// label, blurb, text, title, pieceId, createdAt }. normalize drops
// anything with an unknown type or no id, dedupes by id (first wins),
// and caps the list — a bad client can't invent item types or flood
// the store. Timestamps are kept when present, never invented.
/** Clean any wire-shaped value into a stored-items list. */
export function normalizeHomeItems(input) {
  const out = [];
  if (!Array.isArray(input)) return out;
  const seen = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const type = typeof raw.type === 'string' ? raw.type.trim() : '';
    if (!id || !HOME_ITEM_TYPE_SET.has(type)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      type,
      label: typeof raw.label === 'string' ? raw.label : null,
      blurb: typeof raw.blurb === 'string' ? raw.blurb : null,
      text: typeof raw.text === 'string' ? raw.text : null,
      title: typeof raw.title === 'string' ? raw.title : null,
      pieceId: typeof raw.pieceId === 'number' ? raw.pieceId : null,
      createdAt: Number.isFinite(Number(raw.createdAt)) && Number(raw.createdAt) > 0
        ? Number(raw.createdAt)
        : null,
    });
    if (out.length >= HOME_STORAGE_MAX_ITEMS) break;
  }
  return out;
}

/** Union of two stored-items lists, by id — the first list wins on a
 *  conflict. Used for the client/server re-sync (add-only: removals
 *  only happen via explicit take / store / unload-all events). */
export function mergeHomeItems(a, b) {
  const merged = normalizeHomeItems(a);
  const seen = new Set(merged.map((it) => it.id));
  for (const it of normalizeHomeItems(b)) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    merged.push(it);
    if (merged.length >= HOME_STORAGE_MAX_ITEMS) break;
  }
  return merged;
}

// --- pure operations (on plain lists — the system persists + emits) ------

/** Store one item at home. Puzzle pieces are refused (they belong on
 *  the puzzle board — see the header). Returns { list, ok, item?,
 *  reason? } — reason is 'puzzle-piece-no-store', 'already-stored'
 *  or 'bad-item'. */
export function storeIntoHome(homeList, item) {
  const home = normalizeHomeItems(homeList);
  if (!item || typeof item !== 'object' || typeof item.type !== 'string') {
    return { list: home, ok: false, reason: 'bad-item' };
  }
  if (item.type === 'puzzle-piece') {
    return { list: home, ok: false, reason: 'puzzle-piece-no-store' };
  }
  const clean = normalizeHomeItems([item]);
  if (!clean.length) return { list: home, ok: false, reason: 'bad-item' };
  if (home.some((it) => it.id === clean[0].id)) {
    return { list: home, ok: false, reason: 'already-stored' };
  }
  if (home.length >= HOME_STORAGE_MAX_ITEMS) {
    return { list: home, ok: false, reason: 'home-full' };
  }
  return { list: [...home, clean[0]], ok: true, item: clean[0] };
}

/** Take one item back out of home storage. Returns { list, item } —
 *  item is null when the id is not stored here. */
export function takeFromHome(homeList, itemId) {
  const home = normalizeHomeItems(homeList);
  const idx = home.findIndex((it) => it.id === itemId);
  if (idx < 0) return { list: home, item: null };
  const [item] = home.splice(idx, 1);
  return { list: home, item };
}

/** Unload a whole pocket/bag into home storage at once — the user's
 *  "freeing up space for the day's quest". Everything moves EXCEPT
 *  puzzle pieces (they stay in the pocket — see the header) and items
 *  already stored here. Returns { list, moved, left } — moved is
 *  what went home, left is what stayed in the pocket. */
export function unloadPocketIntoHome(homeList, pocketItems) {
  let home = normalizeHomeItems(homeList);
  const moved = [];
  const left = [];
  for (const raw of Array.isArray(pocketItems) ? pocketItems : []) {
    if (!raw || typeof raw !== 'object') continue;
    if (raw.type === 'puzzle-piece') { left.push(raw); continue; }
    const res = storeIntoHome(home, raw);
    if (res.ok) {
      home = res.list;
      moved.push(res.item);
    } else {
      left.push(raw);
    }
  }
  return { list: home, moved, left };
}
