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

// TWO PLACES (v1, `sq-two-places-v1`):
//   - Up to TWO "your places" per player, both the SAME as the
//     home above: a private room with a storage chest (Store / Take
//     / Unload All) and drop-on-the-floor. The current single home
//     becomes place #1; place #2 gets id `home-<owner>_2`.
//   - Created from the map page's create-location flow ("+ Create
//     room here" → the 📍 Create a Place modal), option labelled
//     "🏠 Create your place here", WITH A NAME FIELD (the modal's
//     existing name input — same as creating any location).
//     Blank name defaults to "Your Place" (place #1) / "Your Place 2"
//     (place #2). The name shows on the map pin and the room-list
//     card. The option stays visible until the player has 2 places,
//     then disappears entirely (same as Create Home at 1).
//   - ACCESS RULE (the big change): you can ONLY enter your place
//     by being next to it on the map — GPS proximity, tap its pin
//     or card when in range, like any other place. NO TELEPORT.
//     The 🏠 Home top-bar button that teleported you home from
//     anywhere is GONE (removed from VillageCanvas + app.jsx).
//     Concretely: the `home-` open-access exemption in
//     accessPolicy.js is removed, so the normal GPS gate in
//     handleEnterRoom applies to your places (pin tap, card,
//     ?openRoom deep link — all pass the room with lat/lng).
//     The server still refuses strangers at the door (join_denied,
//     owner-only); the server-side GPS check can't apply to user
//     rooms (the server doesn't know their coords — same as all
//     user-created rooms), so the client gate is the enforcement.
//   - Both places share the ONE per-player storage (chest store +
//     floor items): your stuff is your stuff, accessible from
//     either place. Builder decision — the server store is keyed
//     by player, not by room, so nothing about the store changes.
//   - Existing homes migrate as place #1 with their existing name
//     preserved (place #1 keeps id `home-<owner>`).
//
// DROP ON THE HOME FLOOR (v1, `sq-home-drop-v1`):
//   - The user asked for a method to drop items from his bag onto
//     the floor of his home. Dropping works ONLY in your own home
//     room: the Drop button in the inventory popup (which already
//     dropped session-only litter anywhere) now drops a PERSISTED
//     floor item at home, and keeps dropping session litter
//     everywhere else. The routing lives in VillageCanvas.jsx.
//   - A dropped item is VISIBLE on the home floor (its emoji, like
//     the litter in ItemsSystem) and is picked back up by clicking
//     it or pressing E near it — refused with the standard
//     full-pocket message when there is no room.
//   - Floor items are part of your home state on the server
//     (per-player store, same authoritative + localStorage re-sync
//     pattern as home storage), so they survive a restart and a
//     reload. A drop never loses an item: the floor list is
//     persisted locally BEFORE the item leaves the pocket, and the
//     server gets it on the next sync even if the socket is down.
//   - Puzzle pieces CANNOT be dropped on the floor (same rule as
//     the chest — they belong on the puzzle board; round-scoped).
//     Builder decision, not a user decision — say so if questioned.
//

export const HOME_STORAGE_MARKER_V1 = 'sq-your-place-v1';
export const HOME_STORAGE_MARKER_V1_1 = 'sq-your-place-v1-1';
export const HOME_DROP_MARKER_V1 = 'sq-home-drop-v1';
export const HOME_TWO_PLACES_MARKER_V1 = 'sq-two-places-v1';

// Two Places v1 (`sq-two-places-v1`): how many personal places one
// player can have. Place #1 keeps id `home-<owner>`; place #2 is
// `home-<owner>_2` (see homePlaceIdFor — the `_2` suffix, not `-2`,
// because an underscore can never appear in a sanitized owner key,
// so parsing the owner back out of a place-2 id is unambiguous).
export const HOME_MAX_PLACES = 2;

// How close a click must land to a floor item to pick it up, and how
// close the player must stand — same numbers as the visible litter
// in items.js (LITTER_CLICK_RANGE / LITTER_PICKUP_RANGE).
export const HOME_FLOOR_CLICK_RANGE = 44;
export const HOME_FLOOR_PICKUP_RANGE = 90;
// Loose bounds for validating a dropped item's floor position (the
// home room is 1600x900; the scene clamps to the real room).
export const HOME_FLOOR_W = 1600;
export const HOME_FLOOR_H = 900;

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
// Mailbox v1 (`sq-mailbox-v1`): the mailbox key IS storable — the
// user leaves it at home until they need it. (Decorations and the
// Santa hat are not in this list: they are room items, not storage.)
export const HOME_ITEM_TYPES = [
  'trash',
  'flyer',
  'note',
  'diary',
  'food',
  'cigarettes',
  'puzzle-piece',
  'mailbox-key',
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
 *  the player has no usable owner key (fully anonymous session).
 *  This is place #1 — see homePlaceIdFor for both places. */
export function homeRoomIdFor(profile) {
  const key = ownerKeyFromProfile(profile);
  if (!key) return null;
  return `${HOME_ROOM_PREFIX}${key}`;
}

/** The room id for one of a player's places (Two Places v1).
 *  Index 1 is `home-<ownerKey>` (the original home); index 2 is
 *  `home-<ownerKey>_2`. The `_2` suffix — not `-2` — because an
 *  underscore can never appear in a sanitized owner key (the
 *  sanitizer turns every non-alphanumeric into a dash), so the
 *  owner can always be parsed back out of a place-2 id. A `-2`
 *  suffix would collide with an owner key that itself ends in
 *  `-2` (e.g. email `jane-2@…`). Returns null for a bad index or
 *  no usable owner key. */
export function homePlaceIdFor(profile, index = 1) {
  const key = ownerKeyFromProfile(profile);
  if (!key) return null;
  if (index === 1) return `${HOME_ROOM_PREFIX}${key}`;
  if (index === 2) return `${HOME_ROOM_PREFIX}${key}_2`;
  return null;
}

/** Which place number a room id is (1 or 2), or 0 when it is not a
 *  personal home room. */
export function homePlaceIndex(roomId) {
  if (!isHomeRoom(roomId)) return 0;
  return String(roomId).endsWith('_2') ? 2 : 1;
}

/** The default name for a place ("Your Place" / "Your Place 2") —
 *  used when the player leaves the name field blank at creation. */
export function defaultHomeName(index = 1) {
  return index === 2 ? 'Your Place 2' : 'Your Place';
}

/** Is this room id a personal home room? Accepts both places
 *  (`home-<owner>` and `home-<owner>_2`). */
export function isHomeRoom(roomId) {
  return /^home-[a-z0-9][a-z0-9-]*(?:_2)?$/.test(String(roomId || ''));
}

/** The owner key of a home room id ('' when it is not a home room).
 *  Strips the place-2 `_2` suffix first, so place #2 reports the
 *  same owner as place #1 — the server's join guard and store
 *  handlers compare this against the actor key, so both places
 *  stay owner-only with no changes on their side. */
export function homeOwnerOf(roomId) {
  if (!isHomeRoom(roomId)) return '';
  let suffix = String(roomId).slice(HOME_ROOM_PREFIX.length);
  if (suffix.endsWith('_2')) suffix = suffix.slice(0, -2);
  return suffix;
}

// --- create home (v1.1, pure — no storage access, so unit-testable) -----
// The home is a user room (kind 'home') whose id is `home-<owner>`.
// These helpers work on a plain rooms list (allRooms in app.jsx),
// so the one-home-per-player rule and the "option disappears" UI
// both read from the same source of truth: whether the home room
// is in the list.
/** The player's home room from a rooms list, or null when no home
 *  has been created yet. This is place #1 — see findHomeRooms for
 *  both places. Kept for backwards compatibility. */
export function findHomeRoom(rooms, profile) {
  const homeId = homeRoomIdFor(profile);
  if (!homeId) return null;
  if (!Array.isArray(rooms)) return null;
  return rooms.find((r) => r && r.id === homeId) || null;
}

/** The player's personal places from a rooms list, place #1 first
 *  then place #2 (Two Places v1). An existing single home
 *  (`home-<owner>`) comes back as place #1 with its stored name
 *  preserved — that is the migration: nothing is renamed or moved.
 *  Returns [] for a fully anonymous session. */
export function findHomeRooms(rooms, profile) {
  if (!Array.isArray(rooms)) return [];
  if (!ownerKeyFromProfile(profile)) return [];
  const out = [];
  for (let index = 1; index <= HOME_MAX_PLACES; index += 1) {
    const id = homePlaceIdFor(profile, index);
    if (!id) continue;
    const room = rooms.find((r) => r && r.id === id);
    if (room) out.push(room);
  }
  return out;
}

/** Is the create-a-place option available, and if not, why?
 *  Returns { status, homeId, placeIndex, defaultName } — status is
 *  'ready' (fewer than 2 places, GPS locked, profile known),
 *  'no-location', 'no-profile', or 'already-exists' (2 places
 *  already). homeId is the NEXT place's id, placeIndex its number
 *  (1 or 2), defaultName its blank-name default. The app uses
 *  'already-exists' to hide the option entirely (user's rule: it
 *  disappears). */
export function homeCreateState({ location, profile, rooms } = {}) {
  const existing = findHomeRooms(rooms, profile);
  if (!ownerKeyFromProfile(profile)) return { status: 'no-profile', homeId: null, placeIndex: 0, defaultName: null };
  if (existing.length >= HOME_MAX_PLACES) {
    return { status: 'already-exists', homeId: null, placeIndex: 0, defaultName: null };
  }
  const placeIndex = existing.length + 1;
  const homeId = homePlaceIdFor(profile, placeIndex);
  const lat = Number(location?.latitude);
  const lng = Number(location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { status: 'no-location', homeId, placeIndex, defaultName: defaultHomeName(placeIndex) };
  }
  return { status: 'ready', homeId, placeIndex, defaultName: defaultHomeName(placeIndex) };
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

// --- dropped floor items (Drop on the home floor v1) ----------------------
// A floor item is a stored item shape (see normalizeHomeItems) PLUS
// its floor position { x, y }. Same per-profile localStorage record
// pattern as the chest store, same server re-sync.
const HOME_FLOOR_PREFIX = 'sidequest-home-floor';

function homeFloorKey() {
  return `${HOME_FLOOR_PREFIX}:${currentOwner()}`;
}

/** The items dropped on the floor of your home, with positions. */
export function getFloorItems() {
  try {
    const raw = _get(homeFloorKey());
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeFloorItems(parsed);
  } catch {
    return [];
  }
}

/** Replace the whole floor record (the system persists after every
 *  drop / pickup, and after applying a server state). */
export function setFloorItems(items) {
  try {
    _set(homeFloorKey(), JSON.stringify(normalizeFloorItems(items)));
  } catch {}
}

/** Test/support hook: replace the whole floor record (used by tests). */
export function _setFloorItemsForTest(items) {
  setFloorItems(items);
}

/** Clean any wire-shaped value into a floor-items list. Same item
 *  validation as normalizeHomeItems, plus a floor position — an item
 *  with no usable x/y is dropped (a bad client cannot place items
 *  off the floor), and positions are clamped to the room. */
export function normalizeFloorItems(input) {
  const out = [];
  if (!Array.isArray(input)) return out;
  const seen = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const type = typeof raw.type === 'string' ? raw.type.trim() : '';
    if (!id || !HOME_ITEM_TYPE_SET.has(type)) continue;
    // Floor items are never puzzle pieces (they belong on the
    // puzzle board) — the rule lives here so BOTH the client and
    // the server enforce it, not just the drop button: a bad client
    // cannot smuggle a piece onto the floor with a raw socket emit.
    if (type === 'puzzle-piece') continue;
    if (seen.has(id)) continue;
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    seen.add(id);
    out.push({
      id,
      type,
      label: typeof raw.label === 'string' ? raw.label : null,
      blurb: typeof raw.blurb === 'string' ? raw.blurb : null,
      text: typeof raw.text === 'string' ? raw.text : null,
      title: typeof raw.title === 'string' ? raw.title : null,
      pieceId: typeof raw.pieceId === 'number' ? raw.pieceId : null,
      // Bread Shop v1 (`sq-bread-shop-v1`): dropped bread keeps
      // its kind, same as the chest store.
      breadKind: typeof raw.breadKind === 'string' ? raw.breadKind : null,
      createdAt: Number.isFinite(Number(raw.createdAt)) && Number(raw.createdAt) > 0
        ? Number(raw.createdAt)
        : null,
      // Feed the Ducks v2 (`sq-feed-ducks-v2`): food dropped on the
      // floor keeps its remaining feeds, same as the chest store.
      usesLeft: type === 'food' && Number.isFinite(Number(raw.usesLeft)) && Number(raw.usesLeft) >= 1
        ? Math.min(Math.floor(Number(raw.usesLeft)), 3)
        : null,
      x: Math.max(0, Math.min(HOME_FLOOR_W, x)),
      y: Math.max(0, Math.min(HOME_FLOOR_H, y)),
    });
    if (out.length >= HOME_STORAGE_MAX_ITEMS) break;
  }
  return out;
}

/** Union of two floor-items lists, by id — first list wins on a
 *  conflict. Same add-only re-sync rule as mergeHomeItems: removals
 *  only happen via explicit drop / pickup events, so a stale
 *  reconnect can resurrect a picked-up item (same honest edge as
 *  the chest store — a resurrected item is annoying, a vanished
 *  one is worse). */
export function mergeFloorItems(a, b) {
  const merged = normalizeFloorItems(a);
  const seen = new Set(merged.map((it) => it.id));
  for (const it of normalizeFloorItems(b)) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    merged.push(it);
    if (merged.length >= HOME_STORAGE_MAX_ITEMS) break;
  }
  return merged;
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
      // Bread Shop v1 (`sq-bread-shop-v1`): stored bread keeps its
      // kind, same as mail — otherwise a baguette taken back out
      // of the chest would read as generic bits of food.
      breadKind: typeof raw.breadKind === 'string' ? raw.breadKind : null,
      // Feed the Ducks v2 (`sq-feed-ducks-v2`): stored food keeps its
      // remaining feeds (clamped to 3 — FOOD_FEEDS_PER_ITEM in
      // items.js, inlined so this module stays server-importable).
      // Food without a usable count is full when taken back out
      // (addItem defaults it to 3).
      usesLeft: type === 'food' && Number.isFinite(Number(raw.usesLeft)) && Number(raw.usesLeft) >= 1
        ? Math.min(Math.floor(Number(raw.usesLeft)), 3)
        : null,
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

/** Drop one item on the floor of your home, at (x, y). Puzzle
 *  pieces are refused (they belong on the puzzle board — see the
 *  header). Returns { list, ok, item?, reason? } — reason is
 *  'puzzle-piece-no-drop', 'already-dropped', 'bad-item' or
 *  'home-full'. The caller persists the floor list BEFORE removing
 *  the item from the pocket, so a failed save never loses it. */
export function dropOnFloor(floorList, item, x, y) {
  const floor = normalizeFloorItems(floorList);
  if (!item || typeof item !== 'object' || typeof item.type !== 'string') {
    return { list: floor, ok: false, reason: 'bad-item' };
  }
  if (item.type === 'puzzle-piece') {
    return { list: floor, ok: false, reason: 'puzzle-piece-no-drop' };
  }
  const clean = normalizeFloorItems([{ ...item, x, y }]);
  if (!clean.length) return { list: floor, ok: false, reason: 'bad-item' };
  if (floor.some((it) => it.id === clean[0].id)) {
    return { list: floor, ok: false, reason: 'already-dropped' };
  }
  if (floor.length >= HOME_STORAGE_MAX_ITEMS) {
    return { list: floor, ok: false, reason: 'home-full' };
  }
  return { list: [...floor, clean[0]], ok: true, item: clean[0] };
}

/** Pick one dropped item back up off the floor. Returns
 *  { list, item } — item is null when the id is not on the floor. */
export function pickupFromFloor(floorList, itemId) {
  const floor = normalizeFloorItems(floorList);
  const idx = floor.findIndex((it) => it.id === itemId);
  if (idx < 0) return { list: floor, item: null };
  const [item] = floor.splice(idx, 1);
  return { list: floor, item };
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
