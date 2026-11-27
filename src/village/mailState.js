// mailState.js — the Mailbox (Mailbox v1, `sq-mailbox-v1`).
//
// Pure logic, no Phaser and no Node APIs, so BOTH sides import it:
//   - server/socket.js (canonical inbox, validates every send and
//     collect)
//   - src/village/MailSystem.js (local state + instant feedback)
//
// THE USER'S RULES (decided in chat 2026-11-23 — do not invent others):
//   - Every player gets a short MAILBOX CODE (a game number). It is
//     shareable in-app and means NOTHING in the real world. Sending
//     uses the code only — NEVER a real-world address, and there is
//     no free-text address field anywhere. (Standing safety rule:
//     the app is minors-safe; the mailbox must not require or
//     encourage sharing any real address or personal information.)
//   - SEND: from your pocket, pick an item, type the recipient's
//     code, confirm → the package goes to their inbox. Sending
//     costs ONE SHEET of gift wrapping paper (Gift Wrapping Paper
//     v1, `sq-gift-wrap-v1` — 2 coins a sheet at the Agora bar), so
//     a gift never travels unwrapped. The sheet is spent only when
//     the server confirms the send (same pending pattern as the
//     item itself). A send with no paper is REFUSED ('no-paper')
//     and the item stays in your pocket. An unknown code refuses
//     the send and the item stays in your pocket (pending pattern,
//     like pinning a flyer: the item leaves only on server confirm).
//     The server requires the `wrapped` flag on every send — a raw
//     socket emit without it is refused ('not-wrapped'). Honest
//     limit: the inventory lives client-side (localStorage), so the
//     server can only verify the flag is present, not count the
//     sender's sheets — the same trust boundary as coins and pocket
//     contents everywhere else in the game.
//   - PICKUP: your mailbox sits at your nearest park; if no park
//     is close, at the nearest public place instead. Mail waits in
//     your inbox until you go there and collect it. The mailbox is
//     an interactable object in that room (notice-board pattern).
//     Mailbox v1.2 (`sq-mailbox-v1.2`): per-place mailboxes — each
//     of your places (up to 2) gets its OWN mailbox, at the nearest
//     park to THAT PLACE (not to where you happen to be standing);
//     if no park is within 5 km of a place, that place's mailbox
//     sits AT THE PLACE ITSELF (the Galveston case: no park rooms
//     there at all). Players with no places keep the v1 rule
//     (nearest park to current location, fallback nearest
//     open-access room). One shared inbox, one key, flag on every
//     mailbox.
//   - KEY: you need the mailbox key in your pocket to open the
//     mailbox. The key takes a pocket slot and can be left at your
//     place (home storage) when not needed.
//   - NOTIFICATIONS, ALL THREE: (1) a "📬 You've got mail!" toast
//     pops up on login if you have unread mail, and the moment mail
//     arrives while you're online; (2) an envelope dot on the 🎒
//     pocket button until you've collected the mail; (3) a red flag
//     up on the mailbox itself when you have mail.
//
// NUMBERS THE USER DID NOT DECIDE (picked here, documented):
//   - MAIL_CODE_LENGTH = 5, from a 31-character alphabet with no
//     lookalikes (no 0/O, 1/I/L). 31^5 ≈ 28.6M codes — plenty for
//     this player base. The code is deterministic from the player's
//     id (FNV-1a hash), so it is stable across sessions and devices
//     with no server round-trip to learn your own code.
//   - MAIL_MAX_PER_INBOX = 20 packages. When the inbox is full, a
//     new send is REFUSED ('inbox-full') — the oldest gift is never
//     silently dropped to make room.
//   - MAILBOX_PARK_RANGE_M = 5000 (5 km): a park room counts as
//     "your nearest park" inside this range. Beyond it, the mailbox
//     falls back to the nearest open-access room (Agora, Lola's,
//     the Library, Shepherd Park, Asgard Games) — always enterable
//     from anywhere, so the mailbox is reachable for EVERY player,
//     including one with no park anywhere near them. The fallback
//     trades the travel incentive for reachability; the park case
//     (the majority, in Houston) keeps the trip. Mailbox v1.2
//     (`sq-mailbox-v1.2`): the range is now measured from EACH
//     PLACE, not from the player's current location — and when no
//     park is within range of a place, that place's mailbox sits
//     AT THE PLACE ITSELF instead of falling back to a faraway
//     public room. The open-access fallback survives only for
//     players with NO places at all.
//   - The mailbox opens from the same 170px range as the notice
//     board and the storage chest.
//   - A collected package is removed from the inbox only when the
//     client confirms the item landed in the pocket
//     (mail_collect_confirm) — a full pocket can never eat a gift.
//   - Mail Persistence v1 (`sq-mail-persist-v1`): inboxes are
//     saved to Postgres (mail_inbox) on every send and collect, so
//     a Railway restart restores unread mail instead of wiping it.
//     There is no outbox re-sync (it would resurrect mail the
//     recipient already collected — the server forgets what was
//     collected across a restart, so re-sending would duplicate
//     gifts). Honest v1 limitation, same class as the boards.
//   - Puzzle pieces and the Santa hat CANNOT be sent (round-scoped
//     / one-per-room server state — sending them would fork their
//     state machines). The mailbox key cannot be sent either
//     (sending your only key would lock you out of your own mail).
//     Gift wrapping paper cannot be sent either (Gift Wrapping
//     Paper v1, `sq-gift-wrap-v1`): it is the supply, not a gift —
//     sending it would double-charge (the paper plus the wrap).
//     The refusal lives in cleanMailItem, so BOTH the client and
//     the server enforce it — a raw socket emit cannot smuggle one
//     through.

import { getDistanceMeters } from '../geo.js';
import { isOpenAccessRoom } from '../accessPolicy.js';

export const MAILBOX_MARKER_V1 = 'sq-mailbox-v1';
// Mailbox v1.1 (`sq-mailbox-v1.1`): live marker string, referenced by
// MailSystem so it survives minification into the built bundle (a
// comment alone would be stripped).
export const MAILBOX_MARKER_V1_1 = 'sq-mailbox-v1.1';
// Mailbox v1.2 (`sq-mailbox-v1.2`): live marker string, referenced by
// MailSystem so it survives minification into the built bundle (a
// comment alone would be stripped).
export const MAILBOX_MARKER_V1_2 = 'sq-mailbox-v1.2';
// Gift Wrapping Paper v1 (`sq-gift-wrap-v1`): live marker string,
// referenced by MailSystem the same way.
export const GIFT_WRAP_MARKER_V1 = 'sq-gift-wrap-v1';

// A park room counts as "nearby" inside this range; beyond it the
// mailbox falls back to the nearest open-access room.
export const MAILBOX_PARK_RANGE_M = 5000;
// Inbox cap: a full inbox refuses new sends ('inbox-full') — the
// oldest gift is never dropped to make room.
export const MAIL_MAX_PER_INBOX = 20;
// How close you must stand to open the mailbox (E key) or click it.
export const MAILBOX_OPEN_RANGE = 170; // px, same as the notice board
// Mailbox footprint in the room (drawn by MailSystem).
export const MAILBOX_W = 72;
export const MAILBOX_H = 84;

// --- the mailbox code -----------------------------------------------------
// 31 readable characters — no 0/O, no 1/I/L, so a code read aloud
// cannot be misheard into a different one.
export const MAIL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAIL_CODE_LENGTH = 5;

/** FNV-1a hash (32-bit) of a string — deterministic, no dependencies. */
export function hashUserId(value) {
  const s = String(value || '').trim().toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The player's mailbox code: 5 characters, deterministic from their
 *  id (email / guest id), stable across sessions and devices. */
export function mailboxCodeFor(userId) {
  const h = hashUserId(userId);
  const a = MAIL_CODE_ALPHABET;
  let out = '';
  let n = h;
  for (let i = 0; i < MAIL_CODE_LENGTH; i += 1) {
    out += a[n % a.length];
    n = Math.floor(n / a.length);
  }
  return out;
}

/** Clean a typed code: uppercase, alphabet characters only, max 5. */
export function normalizeMailboxCode(code) {
  return String(code || '')
    .toUpperCase()
    .split('')
    .filter((ch) => MAIL_CODE_ALPHABET.includes(ch))
    .join('')
    .slice(0, MAIL_CODE_LENGTH);
}

/** Is this a complete, well-formed code (5 alphabet characters)? */
export function isValidMailboxCode(code) {
  const c = normalizeMailboxCode(code);
  return c.length === MAIL_CODE_LENGTH;
}

// --- sendable items -------------------------------------------------------
// Everything EXCEPT puzzle pieces (round-scoped), the Santa hat
// (one-per-room server state), the mailbox key itself (sending
// your only key would lock you out of your own mail) and gift
// wrapping paper (Gift Wrapping Paper v1, `sq-gift-wrap-v1` — the
// supply, not a gift; sending it would double-charge).
export const MAIL_UNSENDABLE_TYPES = new Set(['puzzle-piece', 'santa-hat', 'mailbox-key', 'wrapping-paper',
// Pick-Up Notes v1.1 (`sq-pickup-notes-v1.1`): note paper is a
// supply, not a gift — it can never be sent, same as wrapping
// paper.
'note-paper']);

/** May this item type travel by mail at all? */
export function isSendableItemType(type) {
  return typeof type === 'string' && type.length > 0 && !MAIL_UNSENDABLE_TYPES.has(type);
}

// --- packages -------------------------------------------------------------
/** A mailed package: { id, fromUserId, fromName, item, sentAt, wrapped }.
 *  `item` is the stored-item shape the inventory keeps
 *  ({ id, type, label, blurb, text, title, decorKind, usesLeft }).
 *  `wrapped` is true when the gift travelled wrapped (Gift
 *  Wrapping Paper v1, `sq-gift-wrap-v1` — every send since then
 *  is wrapped; packages from before the kit have no flag and read
 *  as unwrapped). */
export function createMailState() {
  return {
    packages: [], // oldest first
  };
}

/** Clean a package's item the way the server accepts it. Returns
 *  the cleaned item or null when it is not a mailable item. The
 *  refusal lives here so BOTH sides enforce it — a bad client
 *  cannot smuggle a puzzle piece or the Santa hat through with a
 *  raw socket emit. */
export function cleanMailItem(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const type = typeof r.type === 'string' ? r.type.trim() : '';
  if (!isSendableItemType(type)) return null;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  if (!id) return null;
  return {
    id,
    type,
    label: typeof r.label === 'string' ? r.label : null,
    blurb: typeof r.blurb === 'string' ? r.blurb : null,
    text: typeof r.text === 'string' ? r.text : null,
    title: typeof r.title === 'string' ? r.title : null,
    decorKind: typeof r.decorKind === 'string' ? r.decorKind : null,
    // Bread Shop v1 (`sq-bread-shop-v1`): a mailed bread keeps
    // its kind (roll / croissant / baguette) so it still reads as
    // that bread when collected — otherwise it would degrade to
    // generic bits of food. Unknown kinds fall back to the FOOD
    // def when described (see items.describeItem).
    breadKind: typeof r.breadKind === 'string' ? r.breadKind : null,
    // Feed the Ducks v2 (`sq-feed-ducks-v2`): a mailed bits of food
    // keeps its remaining feeds (clamped to 3 — FOOD_FEEDS_PER_ITEM
    // in items.js, inlined here so this module stays importable by
    // the server without pulling items.js in). Food without a usable
    // count arrives full (addItem defaults it to 3 on collect).
    usesLeft: type === 'food' && Number.isFinite(Number(r.usesLeft)) && Number(r.usesLeft) >= 1
      ? Math.min(Math.floor(Number(r.usesLeft)), 3)
      : null,
    // Hunger System v1 (`sq-hunger-v1`): trash food stays trash
    // food through the mail — the recipient gets queasy too.
    // Bought breads (breadKind set) are never trash food.
    trashFood: type === 'food' ? Boolean(r.trashFood) : null,
    pieceId: null, // pieces never travel by mail (see above)
    createdAt: Number.isFinite(Number(r.createdAt)) && Number(r.createdAt) > 0
      ? Number(r.createdAt)
      : null,
  };
}

/** Clean a whole package the way the server accepts it. Returns the
 *  cleaned package or null. */
export function cleanPackage(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  if (!id) return null;
  const item = cleanMailItem(r.item);
  if (!item) return null;
  const fromUserId = typeof r.fromUserId === 'string' ? r.fromUserId.trim() : '';
  if (!fromUserId) return null;
  return {
    id,
    fromUserId,
    fromName: typeof r.fromName === 'string'
      ? r.fromName.trim().slice(0, 80) || 'Someone'
      : 'Someone',
    item,
    sentAt: Number.isFinite(Number(r.sentAt)) && Number(r.sentAt) > 0
      ? Number(r.sentAt)
      : Date.now(),
    // Gift Wrapping Paper v1 (`sq-gift-wrap-v1`): the wrapped flag
    // travels with the package so the recipient sees a wrapped
    // gift. Only an explicit true counts — a missing flag (a
    // package from before the kit, or a forged one) reads as
    // unwrapped. The server's mail_send handler refuses sends
    // without the flag, so a stored package from a live send is
    // always wrapped; this repair only covers legacy rows.
    wrapped: r.wrapped === true,
  };
}

/**
 * Add a package to an inbox. Returns { ok, package?, reason? } —
 * reason is 'bad-package' or 'inbox-full'. A full inbox refuses
 * the send; the oldest gift is never dropped.
 */
export function sendPackage(state, raw) {
  const list = state.packages || (state.packages = []);
  const pkg = cleanPackage(raw);
  if (!pkg) return { ok: false, reason: 'bad-package' };
  if (list.some((p) => p.id === pkg.id)) return { ok: false, reason: 'duplicate' };
  if (list.length >= MAIL_MAX_PER_INBOX) return { ok: false, reason: 'inbox-full' };
  list.push(pkg);
  return { ok: true, package: pkg };
}

/**
 * Take a package out of an inbox. Returns { ok, package?, reason? }
 * — reason is 'not-found'. The caller decides what happens to the
 * item afterwards (into the pocket if there is room — the server
 * only removes it on mail_collect_confirm, so a full pocket can
 * never eat a gift).
 */
export function collectPackage(state, packageId) {
  const list = state.packages || (state.packages = []);
  const idx = list.findIndex((p) => p.id === String(packageId));
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const [pkg] = list.splice(idx, 1);
  return { ok: true, package: pkg };
}

/** Plain JSON copy safe to send over the socket. */
export function serializeMailState(state) {
  const s = state || createMailState();
  return {
    packages: (s.packages || []).map((p) => ({
      id: String(p.id),
      fromUserId: String(p.fromUserId || ''),
      fromName: String(p.fromName || 'Someone'),
      item: { ...p.item },
      sentAt: Number(p.sentAt) || 0,
      // Gift Wrapping Paper v1 (`sq-gift-wrap-v1`): the wrapped
      // flag persists with the package (mail_inbox JSONB) so a
      // restart does not unwrap a gift.
      wrapped: p.wrapped === true,
    })),
    unread: (s.packages || []).length,
  };
}

/** Validate an incoming state object (never trust the wire). */
export function parseMailState(raw) {
  const s = createMailState();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.packages)) return s;
  for (const entry of raw.packages.slice(0, MAIL_MAX_PER_INBOX)) {
    const pkg = cleanPackage(entry);
    if (!pkg) continue;
    if (s.packages.some((p) => p.id === pkg.id)) continue;
    s.packages.push(pkg);
  }
  return s;
}

// --- Mailbox v1.1 (`sq-mailbox-v1.1`) --------------------------------------
// Toast text + the go-to-mailbox seam. Both are pure (no Phaser, no
// React) so tests can drive them without a DOM or a scene.
//
// TOAST NAMES THE PLACE (user-decided 2026-11-23): the "You've got
// mail!" toast used to say nothing about WHERE the mailbox is. It
// now names the room when the room is known, and falls back to the
// plain text when it is not — never a blank.
//   login (no sender):  "📬 You’ve got mail at Shepherd Park!"
//   live (has sender):  "📬 You’ve got mail from Alice at Shepherd Park!"
/** Toast text for "you've got mail". `fromName` is the sender and
 *  only applies to the live-arrival toast (the login toast has no
 *  sender). `roomName` is the mailbox room, or '' when unresolved. */
export function mailToastText({ roomName, fromName } = {}) {
  const place = typeof roomName === 'string' && roomName.trim() ? roomName.trim() : '';
  const from = typeof fromName === 'string' && fromName.trim() ? fromName.trim() : '';
  if (place && from) return `📬 You’ve got mail from ${from} at ${place}!`;
  if (place) return `📬 You’ve got mail at ${place}!`;
  if (from) return `📬 You’ve got mail from ${from}!`;
  return '📬 You’ve got mail!';
}

/** Go to my mailbox room: close the pocket panel first, then enter
 *  the room through the app-level entry (the same path as tapping
 *  the room's pin on the map — app.jsx openFeaturedRoomDirect calls
 *  handleEnterRoom with the canonical room, so the GPS gates behave
 *  exactly as the pin does). The close happens FIRST on purpose: on
 *  a GPS refusal the player is still in the current room and the
 *  too-far toast is visible — the same dismiss-first pattern as the
 *  landing room shortcuts. Pure seam: `closePanel` and
 *  `onEnterRoom` are callbacks, so this is testable without Phaser
 *  or React (VillageCanvas.jsx cannot be imported in node — Phaser
 *  touches the DOM at import time). */
export function goToMailboxRoom({ closePanel, onEnterRoom, roomId, roomName } = {}) {
  try { closePanel?.(); } catch {}
  try { onEnterRoom?.(roomId, roomName); } catch {}
}

// --- where the mailbox lives ----------------------------------------------
/** Is this room a park? Featured parks carry amenity 'park'; OSM
 *  rooms carry tags.leisure 'park' (or metadata.osmCategory). A
 *  user-created room without any park tag does NOT count — only
 *  rooms that actually say they are a park. */
export function isParkRoom(room = {}) {
  if (!room || typeof room !== 'object') return false;
  if (String(room.amenity || '').toLowerCase() === 'park') return true;
  const tags = room.tags || {};
  if (String(tags.leisure || '').toLowerCase() === 'park') return true;
  if (String(tags.amenity || '').toLowerCase() === 'park') return true;
  if (String(room.metadata?.osmCategory || '').toLowerCase() === 'park') return true;
  return false;
}

function roomLatLng(room) {
  const lat = Number(room?.lat);
  const lng = Number(room?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function locationLatLng(location) {
  if (!location || typeof location !== 'object') return null;
  const lat = Number(location.latitude ?? location.lat);
  const lng = Number(location.longitude ?? location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Resolve the player's mailbox room: the nearest park room within
 * MAILBOX_PARK_RANGE_M of their location; if none is close, the
 * nearest open-access room (always enterable from anywhere, so the
 * mailbox is reachable for EVERY player). With no location at all,
 * the first park room in the list (Shepherd Park first when it is
 * there) — a default the UI can name. Returns
 * { roomId, roomName, isPark, distanceM } or null when there is no
 * room to put a mailbox in at all.
 */
export function resolveMailboxRoom(rooms, location) {
  const list = Array.isArray(rooms) ? rooms.filter((r) => r && r.id) : [];
  if (!list.length) return null;
  const parks = list.filter(isParkRoom);
  const me = locationLatLng(location);
  if (!me) {
    const park = parks.find((r) => r.id === 'shepherd-park') || parks[0];
    if (park) {
      return { roomId: park.id, roomName: park.name || 'Shepherd Park', isPark: true, distanceM: null };
    }
    const open = list.find((r) => isOpenAccessRoom(r.id));
    if (!open) return null;
    return { roomId: open.id, roomName: open.name || open.id, isPark: false, distanceM: null };
  }
  let bestPark = null;
  let bestParkD = Infinity;
  for (const room of parks) {
    const at = roomLatLng(room);
    if (!at) continue;
    const d = getDistanceMeters(me.lat, me.lng, at.lat, at.lng);
    if (d < bestParkD) { bestParkD = d; bestPark = room; }
  }
  if (bestPark && bestParkD <= MAILBOX_PARK_RANGE_M) {
    return {
      roomId: bestPark.id,
      roomName: bestPark.name || bestPark.id,
      isPark: true,
      distanceM: Math.round(bestParkD),
    };
  }
  // No park close: the nearest open-access room — always enterable,
  // so the mailbox is reachable for every player.
  let bestOpen = null;
  let bestOpenD = Infinity;
  for (const room of list) {
    if (!isOpenAccessRoom(room.id)) continue;
    const at = roomLatLng(room);
    if (!at) continue;
    const d = getDistanceMeters(me.lat, me.lng, at.lat, at.lng);
    if (d < bestOpenD) { bestOpenD = d; bestOpen = room; }
  }
  if (bestOpen) {
    return {
      roomId: bestOpen.id,
      roomName: bestOpen.name || bestOpen.id,
      isPark: false,
      distanceM: Math.round(bestOpenD),
    };
  }
  // No open-access room with coordinates (should not happen — the
  // featured rooms are always in the list): fall back to the
  // nearest park regardless of range.
  if (bestPark) {
    return {
      roomId: bestPark.id,
      roomName: bestPark.name || bestPark.id,
      isPark: true,
      distanceM: Math.round(bestParkD),
    };
  }
  return null;
}

// --- Mailbox v1.2 (`sq-mailbox-v1.2`): per-place mailboxes -----------
// The v1 rule resolved ONE mailbox from the player's CURRENT
// location — which stranded a player in Galveston (~50 miles from
// the Houston parks) at the MD Anderson Library fallback. Now each
// of the player's places gets its OWN mailbox, resolved from THAT
// PLACE's coordinates, so the mailbox rooms are stable per player
// instead of moving as they travel (design consequence, flagged).
// A mailbox-room entry is
//   { roomId, roomName, isPark, isHome, placeIndex, placeId, distanceM }
// where `isHome` means the mailbox sits AT the place itself (no
// park within range of that place — the Galveston case), and
// `distanceM` is the place-to-park distance (0 for an at-home box).

/** The default name for a place ("Your Place" / "Your Place 2") —
 *  mirrors defaultHomeName in homeStorage.js, inlined here because
 *  this module is also imported by the server and must not pull in
 *  homeStorage.js. */
export function defaultMailboxPlaceName(placeIndex = 1) {
  return placeIndex === 2 ? 'Your Place 2' : 'Your Place';
}

/**
 * Resolve ONE place's mailbox room: the nearest park room within
 * MAILBOX_PARK_RANGE_M of the place's own coordinates; if none is
 * close — or the place has no coordinates at all (a legacy room) —
 * the mailbox sits AT THE PLACE ITSELF, so it is always reachable.
 * Returns null only when the place itself is unusable (no id).
 */
export function resolveMailboxRoomForPlace(place, rooms, placeIndex = 1) {
  if (!place || !place.id) return null;
  const list = Array.isArray(rooms) ? rooms.filter((r) => r && r.id) : [];
  const parks = list.filter(isParkRoom);
  const placeName = typeof place.name === 'string' && place.name.trim()
    ? place.name.trim()
    : '';
  const homeName = placeName || defaultMailboxPlaceName(placeIndex);
  const at = roomLatLng(place);
  if (at) {
    let bestPark = null;
    let bestParkD = Infinity;
    for (const room of parks) {
      const pat = roomLatLng(room);
      if (!pat) continue;
      const d = getDistanceMeters(at.lat, at.lng, pat.lat, pat.lng);
      if (d < bestParkD) { bestParkD = d; bestPark = room; }
    }
    if (bestPark && bestParkD <= MAILBOX_PARK_RANGE_M) {
      return {
        roomId: bestPark.id,
        roomName: bestPark.name || bestPark.id,
        isPark: true,
        isHome: false,
        placeIndex,
        placeId: place.id,
        distanceM: Math.round(bestParkD),
      };
    }
  }
  // No park close (or no coordinates to measure from): the mailbox
  // lives at the place itself. The place is owner-only and always
  // enterable by its owner, so the mailbox is reachable by
  // construction — no library 50 miles away.
  return {
    roomId: place.id,
    roomName: homeName,
    isPark: false,
    isHome: true,
    placeIndex,
    placeId: place.id,
    distanceM: 0,
  };
}

/**
 * Resolve ALL of the player's mailbox rooms. `places` is the
 * player's places (place #1 first, then #2 — see findHomeRooms in
 * homeStorage.js; the caller supplies them, so this stays pure and
 * server-safe). With no places, the v1 rule applies unchanged: one
 * mailbox from the player's current location. With places, one
 * mailbox per place, deduped by room id — two places near the same
 * park share one mailbox room (the first place's entry wins), so
 * the player never sees two boxes in one room.
 */
export function resolveMailboxRooms(rooms, location, places) {
  const list = Array.isArray(rooms) ? rooms.filter((r) => r && r.id) : [];
  if (!list.length) return [];
  const myPlaces = (Array.isArray(places) ? places : []).filter((p) => p && p.id);
  if (!myPlaces.length) {
    const single = resolveMailboxRoom(list, location);
    return single ? [{ ...single, isHome: false, placeIndex: 0, placeId: '' }] : [];
  }
  const out = [];
  const seen = new Set();
  myPlaces.forEach((place, i) => {
    const resolved = resolveMailboxRoomForPlace(place, list, i + 1);
    if (!resolved || seen.has(resolved.roomId)) return;
    seen.add(resolved.roomId);
    out.push(resolved);
  });
  return out;
}

/**
 * The nearest of the player's mailbox rooms to their current
 * location (by room coordinates, looked up in `rooms` by id).
 * One room → it. No location, or no room with coordinates → the
 * first entry (place #1's). This is the room the toast names, the
 * pocket line leads with, and the "Go to my mailbox" button takes
 * you to. Returns the entry or null when there is no mailbox room.
 */
export function nearestMailboxRoom(mailboxRooms, rooms, location) {
  const entries = (Array.isArray(mailboxRooms) ? mailboxRooms : [])
    .filter((r) => r && r.roomId);
  if (!entries.length) return null;
  if (entries.length === 1) return entries[0];
  const me = locationLatLng(location);
  if (!me) return entries[0];
  const byId = new Map(
    (Array.isArray(rooms) ? rooms : [])
      .filter((r) => r && r.id)
      .map((r) => [r.id, r]),
  );
  let best = entries[0];
  let bestD = Infinity;
  for (const entry of entries) {
    const at = roomLatLng(byId.get(entry.roomId));
    if (!at) continue;
    const d = getDistanceMeters(me.lat, me.lng, at.lat, at.lng);
    if (d < bestD) { bestD = d; best = entry; }
  }
  return best;
}

/**
 * The pocket line naming where your mailbox(es) are — the real
 * room name(s), never a generic "at the park". One room:
 * "Your mailbox is at Shepherd Park". Two: "Your mailboxes are at
 * Shepherd Park and Your Place 2". `fallbackName` is the single
 * nearest room's name, used only when the list itself is empty
 * (defensive — getState always supplies the list). Returns '' when
 * nothing is known.
 */
export function mailboxRoomsLine(mailboxRooms, fallbackName = '') {
  const list = (Array.isArray(mailboxRooms) ? mailboxRooms : [])
    .filter((r) => r && typeof r.roomName === 'string' && r.roomName.trim());
  if (list.length === 1) return `Your mailbox is at ${list[0].roomName.trim()}`;
  if (list.length > 1) {
    const names = list.map((r) => r.roomName.trim());
    return `Your mailboxes are at ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  const fb = typeof fallbackName === 'string' && fallbackName.trim() ? fallbackName.trim() : '';
  return fb ? `Your mailbox is at ${fb}` : '';
}

/**
 * The mailbox key's blurb — Places Sync v1 (`sq-places-sync-v1`).
 * The static blurb in items.js used to say "The key to your
 * mailbox at the park", hardcoded from when the mailbox was always
 * at a park; wrong now that a mailbox can sit at a place (or, via
 * the v1 fallback, a library). This names the actual room(s), the
 * same names as the pocket line, and falls back to the place-less
 * version when nothing is resolved yet — never a generic "at the
 * park". One room: "…at Shepherd Park." Two: "…at Shepherd Park
 * and Your Place 2."
 */
export function mailboxKeyBlurb(mailboxRooms, fallbackName = '') {
  const names = (Array.isArray(mailboxRooms) ? mailboxRooms : [])
    .filter((r) => r && typeof r.roomName === 'string' && r.roomName.trim())
    .map((r) => r.roomName.trim());
  if (!names.length && typeof fallbackName === 'string' && fallbackName.trim()) {
    names.push(fallbackName.trim());
  }
  const at = names.length ? ` at ${names.join(' and ')}` : '';
  return `The key to your mailbox${at}. Keep it in your pocket to open your mail — or leave it at home until you need it.`;
}

/**
 * Pick a spot for the mailbox inside a room. `entry` is the room's
 * entry zone { x, y, w, h } (or null); `spawn` the spawn point
 * { x, y }; `bounds` the boundary rect { x, y, w, h }. `isInside`
 * is an optional point-in-room check. Returns { x, y, w, h } —
 * always a spot, never null. Candidates, in order: just east of
 * the entry (the notice board takes the west side in parks), just
 * west of the entry, south-east of the spawn, then a default near
 * the entrance. Mirrors resolveNoticeBoardSpot (noticeBoardPlacement.js).
 */
export function resolveMailboxSpot({ entry, spawn, bounds, isInside } = {}) {
  const b = bounds || { x: 0, y: 0, w: 1600, h: 900 };
  const clamp = (x, y) => ({
    x: Math.max(b.x + 20, Math.min(b.x + b.w - MAILBOX_W - 20, x)),
    y: Math.max(b.y + 20, Math.min(b.y + b.h - MAILBOX_H - 20, y)),
  });
  const candidates = [];
  if (entry) {
    candidates.push({ x: entry.x + (entry.w || 200) + 40, y: entry.y - 10 });
    candidates.push({ x: entry.x - MAILBOX_W - 40, y: entry.y - 10 });
  }
  if (spawn) {
    candidates.push({ x: spawn.x + 140, y: spawn.y + 60 });
  }
  candidates.push({ x: 1240, y: 745 });
  for (const c of candidates) {
    const p = clamp(c.x, c.y);
    if (!isInside || isInside(p.x + MAILBOX_W / 2, p.y + MAILBOX_H / 2)) {
      return { ...p, w: MAILBOX_W, h: MAILBOX_H };
    }
  }
  const p = clamp(1240, 745);
  return { ...p, w: MAILBOX_W, h: MAILBOX_H };
}
