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
//     code, confirm → the package goes to their inbox. Sending is
//     FREE in v1 (no coins). An unknown code refuses the send and
//     the item stays in your pocket (pending pattern, like pinning
//     a flyer: the item leaves only on server confirm).
//   - PICKUP: your mailbox sits at your nearest park; if no park
//     is close, at the nearest public place instead. Mail waits in
//     your inbox until you go there and collect it. The mailbox is
//     an interactable object in that room (notice-board pattern).
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
//     (the majority, in Houston) keeps the trip.
//   - The mailbox opens from the same 170px range as the notice
//     board and the storage chest.
//   - A collected package is removed from the inbox only when the
//     client confirms the item landed in the pocket
//     (mail_collect_confirm) — a full pocket can never eat a gift.
//   - State is IN-MEMORY on the server, like the notice boards: a
//     Railway restart wipes unread mail in the inbox. There is no
//     outbox re-sync (it would resurrect mail the recipient already
//     collected — the server forgets what was collected across a
//     restart, so re-sending would duplicate gifts). Honest v1
//     limitation, same class as the boards.
//   - Puzzle pieces and the Santa hat CANNOT be sent (round-scoped
//     / one-per-room server state — sending them would fork their
//     state machines). The mailbox key cannot be sent either
//     (sending your only key would lock you out of your own mail).
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
// (one-per-room server state) and the mailbox key itself (sending
// your only key would lock you out of your own mail).
export const MAIL_UNSENDABLE_TYPES = new Set(['puzzle-piece', 'santa-hat', 'mailbox-key']);

/** May this item type travel by mail at all? */
export function isSendableItemType(type) {
  return typeof type === 'string' && type.length > 0 && !MAIL_UNSENDABLE_TYPES.has(type);
}

// --- packages -------------------------------------------------------------
/** A mailed package: { id, fromUserId, fromName, item, sentAt }.
 *  `item` is the stored-item shape the inventory keeps
 *  ({ id, type, label, blurb, text, title, decorKind }). */
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
