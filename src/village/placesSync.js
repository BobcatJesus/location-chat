// placesSync.js — Places Sync v1 (`sq-places-sync-v1`).
//
// THE PROBLEM (user-reported live, 2026-11-23): a player's places
// ("Your Place" / "Your Place 2") lived in each browser's
// localStorage and never synced between devices. The user was in
// Galveston on a device that only knew his Galveston place; his
// Houston place lived in another browser's saved data. Result: the
// map on the Galveston device showed only the Galveston pin, and
// the mailbox pocket line listed only one mailbox room.
//
// THE FIX: sync the player's places server-side, so they follow the
// player between devices. Each device uploads its local home places
// on connect; the server merges by id and returns the merged list;
// the client stores the merged list locally, so the map, the
// create-option count, and the mailbox resolution all see both
// places. Modelled on the home-storage re-sync pattern (badges /
// home storage): the server store is in-memory, and each client
// keeps its own localStorage record and re-uploads it on connect,
// so a Railway restart loses nothing as long as a device still
// holds its local places.
//
// PURE LOGIC + localStorage blocklist: no Phaser, no React, no Node
// APIs at import time, so it is unit-testable (tests/placesSync
// .test.js) and importable from both the client (app.jsx) and the
// server (server/socket.js). The localStorage access is guarded
// (typeof checks + try/catch + an in-memory fallback), same pattern
// as homeStorage.js.

import {
  isHomeRoom,
  homeOwnerOf,
  normalizeHomeOwner,
  ownerKeyFromProfile,
  homePlaceIndex,
  defaultHomeName,
  findHomeRooms,
  HOME_MAX_PLACES,
} from './homeStorage.js';

export const PLACES_SYNC_MARKER_V1 = 'sq-places-sync-v1';

// How often the app re-syncs places while logged in (alongside the
// community-rooms poll): a place created on another device shows up
// here within one interval, or on the next connect, whichever is
// first. The creating device also uploads immediately (see app.jsx
// confirmCreatePlace), so the other side never waits for a full
// interval after a fresh create.
export const PLACES_SYNC_INTERVAL_MS = 30000;

// Guest profiles get a random per-session stamp email
// (`guest_NNNN@side.quest`), so a guest's identity is different on
// every device — cross-device sync is meaningless for them, and
// their places stay local-only by design (see isGuestProfile).
const GUEST_STAMP_EMAIL_RE = /^guest_\d+@side\.quest$/i;
// The same stamp, after owner-key normalization
// (`guest_1234@side.quest` -> `guest-1234-side-quest`): the server
// refuses syncs under such a key, so a guest client that bypassed
// the client-side gate still cannot pollute the store. A real user
// cannot hit this pattern — their email would have to be
// `guest_NNNN@side.quest`.
const GUEST_STAMP_KEY_RE = /^guest-\d+-side-quest$/;

/** Is this profile a guest (per-device random stamp identity)? */
export function isGuestProfile(profile) {
  if (!profile || typeof profile !== 'object') return false;
  if (profile.mode === 'guest') return true;
  const p = profile.profile && typeof profile.profile === 'object' ? profile.profile : profile;
  if (p?.mode === 'guest') return true;
  const email = String(p?.email || profile?.email || '').trim();
  return GUEST_STAMP_EMAIL_RE.test(email);
}

/** Is this owner key a guest stamp key (server-side guard)? */
export function isGuestOwnerKey(ownerKey) {
  return GUEST_STAMP_KEY_RE.test(String(ownerKey || '').trim());
}

// --- wire shape -----------------------------------------------------------
// A synced place is a home room, stripped to what the other device
// needs to enter it and draw its pin: id, name, lat, lng,
// radiusMeters, kind, ownerId, createdAt. Only home rooms sync —
// community rooms already have their own server path
// (/api/community-locations), invited rooms stay local-only.
/** Strip a room object to the synced-place wire shape (null when
 *  it is not a home room with usable coordinates). */
export function toPlaceRecord(room) {
  if (!room || typeof room !== 'object') return null;
  const id = typeof room.id === 'string' ? room.id.trim() : '';
  if (!isHomeRoom(id)) return null;
  // NB: Number(null) is 0 and Number('') is 0 — check for missing
  // values BEFORE coercing, or a room with no coordinates would
  // silently land on the equator.
  if (room.lat == null || room.lng == null || room.lat === '' || room.lng === '') return null;
  const lat = Number(room.lat);
  const lng = Number(room.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = typeof room.name === 'string' && room.name.trim()
    ? room.name.trim()
    : defaultHomeName(homePlaceIndex(id));
  return {
    id,
    name,
    lat,
    lng,
    radiusMeters: Number.isFinite(Number(room.radiusMeters)) && Number(room.radiusMeters) > 0
      ? Number(room.radiusMeters)
      : 60,
    kind: 'home',
    ownerId: homeOwnerOf(id),
    createdAt: Number.isFinite(Number(room.createdAt)) && Number(room.createdAt) > 0
      ? Number(room.createdAt)
      : null,
  };
}

/** Clean any wire-shaped value into a place record for one owner
 *  (null when it is not that owner's home room, or the coordinates
 *  are unusable). The id carries the owner, so a client can only
 *  sync its own places: a record whose owner does not match the
 *  claimed key is dropped. */
export function normalizePlaceRecord(raw, ownerKey) {
  const key = normalizeHomeOwner(ownerKey);
  if (!key) return null;
  const rec = toPlaceRecord(raw);
  if (!rec) return null;
  if (rec.ownerId !== key) return null;
  return { ...rec, ownerId: key };
}

// --- server merge (first-writer wins) -------------------------------------
// The server keeps one record per place id. The FIRST writer wins:
// a later upload of the same id at different coordinates is a
// conflict — the stored record is kept and the id is reported, so
// the losing device can keep its own copy locally (see
// applyPlacesState) instead of silently losing its place. An upload
// that matches the stored record exactly (same coords + name) is a
// no-op, not a conflict. Only the two deterministic ids per owner
// (`home-<key>`, `home-<key>_2`) can ever pass validation, so the
// store is naturally capped at HOME_MAX_PLACES.
/** Merge uploaded records into the server's stored list.
 *  Returns { places, conflicts } — conflicts are ids whose upload
 *  disagreed with the stored record. */
export function mergeServerPlaces(stored, uploaded, ownerKey) {
  const key = normalizeHomeOwner(ownerKey);
  const out = [];
  const byId = new Map();
  for (const raw of Array.isArray(stored) ? stored : []) {
    const rec = normalizePlaceRecord(raw, key);
    if (!rec || byId.has(rec.id)) continue;
    byId.set(rec.id, rec);
    out.push(rec);
  }
  const conflicts = [];
  for (const raw of Array.isArray(uploaded) ? uploaded : []) {
    const rec = normalizePlaceRecord(raw, key);
    if (!rec) continue;
    const existing = byId.get(rec.id);
    if (!existing) {
      if (out.length >= HOME_MAX_PLACES) continue;
      byId.set(rec.id, rec);
      out.push(rec);
      continue;
    }
    if (existing.lat === rec.lat && existing.lng === rec.lng && existing.name === rec.name) continue;
    conflicts.push(rec.id);
  }
  return { places: out, conflicts };
}

// --- client upload --------------------------------------------------------
/** The player's local home places, as wire records, ready to
 *  upload — excluding ids blocked after a sync conflict, and
 *  excluding guests entirely (their places stay local-only). */
export function homePlacesForUpload(rooms, profile, blockedIds = []) {
  if (!profile || typeof profile !== 'object') return [];
  if (isGuestProfile(profile)) return [];
  if (!ownerKeyFromProfile(profile)) return [];
  const blocked = new Set((Array.isArray(blockedIds) ? blockedIds : []).map(String));
  return findHomeRooms(rooms, profile)
    .map((room) => toPlaceRecord(room))
    .filter((rec) => rec && !blocked.has(rec.id));
}

// --- client apply (server state -> local rooms) ---------------------------
// Applying the server list must never delete a place this device
// knows about: a local place the server hasn't seen yet (created
// offline, or an upload that failed) stays until the next sync
// uploads it. And a local place that CONFLICTS with the server's
// record for the same id (two devices each created place #1 at
// different locations) stays too — the local copy wins display on
// THIS device only, the server's copy wins everywhere else, and the
// id is reported as a new conflict (unless it was already blocked)
// so the app can say so once. The server's copy is NOT added
// alongside it: one room per id, or the map would show two pins
// for the same place and findHomeRooms would return the first
// match. The two devices disagree about that place until the
// player sorts it out — an honest edge, flagged, not a crash.
/** Apply a server places list to this device's local home rooms.
 *  Returns { rooms, newConflicts } — rooms is the merged home-room
 *  list for this device (place #1 first, then #2). */
export function applyPlacesState({ localRooms = [], serverPlaces = [], blockedIds = [] } = {}) {
  const blocked = new Set((Array.isArray(blockedIds) ? blockedIds : []).map(String));
  const server = (Array.isArray(serverPlaces) ? serverPlaces : [])
    .map((raw) => toPlaceRecord(raw))
    .filter(Boolean);
  const local = (Array.isArray(localRooms) ? localRooms : [])
    .map((room) => toPlaceRecord(room))
    .filter(Boolean);
  const rooms = [];
  const seen = new Set();
  const newConflicts = [];
  for (const rec of server) {
    const localRec = local.find((l) => l.id === rec.id);
    if (localRec && (localRec.lat !== rec.lat || localRec.lng !== rec.lng)) {
      // Conflict: this device's copy differs from the server's.
      // Keep the local copy for display here; do not add the
      // server's copy (one room per id).
      if (!blocked.has(rec.id)) newConflicts.push(rec.id);
      rooms.push(localRec);
    } else {
      rooms.push(rec);
    }
    seen.add(rec.id);
  }
  // Local-only entries the server hasn't seen yet: keep them — they
  // upload on the next sync.
  for (const rec of local) {
    if (seen.has(rec.id)) continue;
    seen.add(rec.id);
    rooms.push(rec);
  }
  rooms.sort((a, b) => homePlaceIndex(a.id) - homePlaceIndex(b.id));
  return { rooms, newConflicts };
}

// --- change detection -----------------------------------------------------
/** A stable signature for a home-room list (ids + coords + names),
 *  so the app only re-renders / remounts the map when the merged
 *  list actually changes — not on every 30s re-sync. */
export function placesSignature(rooms) {
  return (Array.isArray(rooms) ? rooms : [])
    .map((room) => toPlaceRecord(room))
    .filter(Boolean)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => `${r.id}|${r.lat}|${r.lng}|${r.name}`)
    .join(';');
}

// --- conflict blocklist (localStorage, in-memory fallback) ----------------
// Ids that lost a sync conflict are remembered on THIS device, so
// they are never uploaded again (the server would ignore them
// anyway — first-writer wins) and never toast twice. The place
// itself stays in the device's local rooms (see applyPlacesState);
// the blocklist only gates the upload.
const PLACES_BLOCKED_KEY = 'sidequest_places_blocked';

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

/** Parse a stored blocklist value into an id array (pure). */
export function parseBlockedIds(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** The ids blocked from upload on this device. */
export function getBlockedPlaceIds() {
  return parseBlockedIds(_get(PLACES_BLOCKED_KEY));
}

/** Remember ids as blocked (union with what is already stored).
 *  Returns the full blocklist. */
export function addBlockedPlaceIds(ids) {
  const merged = [...new Set([
    ...getBlockedPlaceIds(),
    ...(Array.isArray(ids) ? ids : []).map(String).filter(Boolean),
  ])];
  try {
    _set(PLACES_BLOCKED_KEY, JSON.stringify(merged));
  } catch {}
  return merged;
}

/** Test/support hook: clear the blocklist. */
export function _resetBlockedForTest() {
  try {
    const s = _store();
    if (s) s.removeItem(PLACES_BLOCKED_KEY);
  } catch {}
  _memory.delete(PLACES_BLOCKED_KEY);
}
