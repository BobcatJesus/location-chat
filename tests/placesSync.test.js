// placesSync.test.js — Places Sync v1 (`sq-places-sync-v1`).
//
// The user's places lived in each browser's localStorage and never
// synced: his Galveston device only knew his Galveston place, his
// Houston place lived in another browser. These tests cover the
// sync model end to end at the pure-function level, plus a
// two-device integration test (fresh module instances per device,
// via vi.resetModules) and the mailbox key blurb fix.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  PLACES_SYNC_MARKER_V1,
  isGuestProfile,
  isGuestOwnerKey,
  toPlaceRecord,
  normalizePlaceRecord,
  mergeServerPlaces,
  homePlacesForUpload,
  applyPlacesState,
  placesSignature,
  parseBlockedIds,
  getBlockedPlaceIds,
  addBlockedPlaceIds,
  _resetBlockedForTest,
} from '../src/village/placesSync.js';
import {
  findHomeRooms,
  homeCreateState,
  ownerKeyFromProfile,
} from '../src/village/homeStorage.js';
import {
  resolveMailboxRooms,
  mailboxRoomsLine,
  mailboxKeyBlurb,
} from '../src/village/mailState.js';
import { ITEM_DEFS } from '../src/village/items.js';

const OWNER = 'tfkelleher3@gmail.com';
const PROFILE = { mode: 'user', profile: { email: OWNER, characterName: 'Thomas' } };
const GUEST_PROFILE = { mode: 'guest', profile: { email: 'guest_1234@side.quest', characterName: 'guest_1234' } };

const KEY = ownerKeyFromProfile(PROFILE); // 'tfkelleher3-gmail-com'
const HOME_1 = `home-${KEY}`;
const HOME_2 = `home-${KEY}_2`;

// The user's real places (from the live report): Houston ~29.815,
// -95.4497 (Shepherd Park ~3.7 km away); Galveston 18715 Warrior
// Drive ~29.55, -94.98 (no park room near it at all).
const HOUSTON_PLACE = { id: HOME_1, name: 'Your Place', lat: 29.815, lng: -95.4497, radiusMeters: 60, kind: 'home', ownerId: KEY };
const GALVESTON_PLACE = { id: HOME_2, name: 'Your Place 2', lat: 29.55, lng: -94.98, radiusMeters: 60, kind: 'home', ownerId: KEY };
const SHEPHERD_PARK = { id: 'shepherd-park', name: 'Shepherd Park', lat: 29.834235, lng: -95.4175, amenity: 'park' };

beforeEach(() => {
  _resetBlockedForTest();
});

// --- wire shape + validation ----------------------------------------------

describe('toPlaceRecord / normalizePlaceRecord', () => {
  it('keeps a valid home room, stripped to the wire shape', () => {
    const rec = toPlaceRecord(HOUSTON_PLACE);
    expect(rec).toMatchObject({ id: HOME_1, name: 'Your Place', lat: 29.815, lng: -95.4497, kind: 'home', ownerId: KEY });
  });
  it('rejects a non-home room', () => {
    expect(toPlaceRecord({ id: 'agora-houston', name: 'Agora', lat: 29.74, lng: -95.4 })).toBeNull();
  });
  it('rejects a home room with unusable coordinates', () => {
    expect(toPlaceRecord({ ...HOUSTON_PLACE, lat: null })).toBeNull();
    expect(toPlaceRecord({ ...HOUSTON_PLACE, lng: 'nowhere' })).toBeNull();
  });
  it('defaults a blank name and a missing radius', () => {
    const rec = toPlaceRecord({ id: HOME_2, name: '  ', lat: 29.55, lng: -94.98 });
    expect(rec.name).toBe('Your Place 2');
    expect(rec.radiusMeters).toBe(60);
  });
  it('normalizePlaceRecord rejects another owner\'s place id', () => {
    expect(normalizePlaceRecord(HOUSTON_PLACE, 'someone-else')).toBeNull();
    expect(normalizePlaceRecord(HOUSTON_PLACE, KEY)).toMatchObject({ id: HOME_1 });
  });
  it('normalizePlaceRecord rejects a missing owner key', () => {
    expect(normalizePlaceRecord(HOUSTON_PLACE, '')).toBeNull();
    expect(normalizePlaceRecord(HOUSTON_PLACE, null)).toBeNull();
  });
});

// --- guests -----------------------------------------------------------------

describe('guest handling', () => {
  it('isGuestProfile detects guest mode and guest stamp emails', () => {
    expect(isGuestProfile(GUEST_PROFILE)).toBe(true);
    expect(isGuestProfile({ mode: 'guest', profile: { email: 'x@y.z' } })).toBe(true);
    expect(isGuestProfile(PROFILE)).toBe(false);
    expect(isGuestProfile(null)).toBe(false);
  });
  it('isGuestOwnerKey detects the normalized guest stamp key only', () => {
    expect(isGuestOwnerKey('guest-1234-side-quest')).toBe(true);
    expect(isGuestOwnerKey(KEY)).toBe(false);
    expect(isGuestOwnerKey('guest-1234-example-com')).toBe(false);
  });
  it('homePlacesForUpload is empty for guests and for no profile', () => {
    expect(homePlacesForUpload([HOUSTON_PLACE], GUEST_PROFILE)).toEqual([]);
    expect(homePlacesForUpload([HOUSTON_PLACE], null)).toEqual([]);
    expect(homePlacesForUpload([HOUSTON_PLACE], PROFILE)).toHaveLength(1);
  });
});

// --- server merge (first-writer wins) ---------------------------------------

describe('mergeServerPlaces', () => {
  it('stores a first upload', () => {
    const { places, conflicts } = mergeServerPlaces([], [HOUSTON_PLACE], KEY);
    expect(places).toHaveLength(1);
    expect(places[0].id).toBe(HOME_1);
    expect(conflicts).toEqual([]);
  });
  it('an identical re-upload is a no-op, not a conflict', () => {
    const first = mergeServerPlaces([], [HOUSTON_PLACE], KEY);
    const second = mergeServerPlaces(first.places, [HOUSTON_PLACE], KEY);
    expect(second.places).toHaveLength(1);
    expect(second.conflicts).toEqual([]);
  });
  it('a conflicting upload keeps the stored record and reports the id', () => {
    const first = mergeServerPlaces([], [HOUSTON_PLACE], KEY);
    const moved = { ...HOUSTON_PLACE, lat: 29.55, lng: -94.98, name: 'Your Place' };
    const second = mergeServerPlaces(first.places, [moved], KEY);
    expect(second.places[0].lat).toBe(29.815);
    expect(second.conflicts).toEqual([HOME_1]);
  });
  it('drops another owner\'s place and a non-home room', () => {
    const { places } = mergeServerPlaces([], [
      { ...HOUSTON_PLACE, id: 'home-someone-else' },
      { id: 'agora-houston', name: 'Agora', lat: 29.74, lng: -95.4 },
      GALVESTON_PLACE,
    ], KEY);
    expect(places.map((p) => p.id)).toEqual([HOME_2]);
  });
  it('never stores more than two places per owner', () => {
    const { places } = mergeServerPlaces([], [HOUSTON_PLACE, GALVESTON_PLACE, HOUSTON_PLACE], KEY);
    expect(places).toHaveLength(2);
  });
});

// --- client apply -------------------------------------------------------------

describe('applyPlacesState', () => {
  it('the user\'s live case: device with only #2 + server with both -> both, no conflicts', () => {
    const { rooms, newConflicts } = applyPlacesState({
      localRooms: [GALVESTON_PLACE],
      serverPlaces: [HOUSTON_PLACE, GALVESTON_PLACE],
      blockedIds: [],
    });
    expect(rooms.map((r) => r.id)).toEqual([HOME_1, HOME_2]);
    expect(newConflicts).toEqual([]);
  });
  it('a local place the server has not seen yet is kept', () => {
    const { rooms } = applyPlacesState({ localRooms: [HOUSTON_PLACE], serverPlaces: [], blockedIds: [] });
    expect(rooms.map((r) => r.id)).toEqual([HOME_1]);
  });
  it('a conflicting local place wins display here and is reported once', () => {
    const moved = { ...HOUSTON_PLACE, lat: 29.55, lng: -94.98 };
    const first = applyPlacesState({ localRooms: [moved], serverPlaces: [HOUSTON_PLACE], blockedIds: [] });
    expect(first.rooms[0].lat).toBe(29.55);
    expect(first.newConflicts).toEqual([HOME_1]);
    // Already blocked: the same state reports no NEW conflict.
    const second = applyPlacesState({ localRooms: [moved], serverPlaces: [HOUSTON_PLACE], blockedIds: [HOME_1] });
    expect(second.rooms[0].lat).toBe(29.55);
    expect(second.newConflicts).toEqual([]);
  });
  it('server-only places are adopted, empty stays empty', () => {
    expect(applyPlacesState({ localRooms: [], serverPlaces: [HOUSTON_PLACE], blockedIds: [] }).rooms.map((r) => r.id)).toEqual([HOME_1]);
    expect(applyPlacesState({ localRooms: [], serverPlaces: [], blockedIds: [] }).rooms).toEqual([]);
  });
  it('the merged list is place #1 first, then #2', () => {
    const { rooms } = applyPlacesState({ localRooms: [GALVESTON_PLACE], serverPlaces: [HOUSTON_PLACE], blockedIds: [] });
    expect(rooms.map((r) => r.id)).toEqual([HOME_1, HOME_2]);
  });
});

describe('placesSignature', () => {
  it('is stable for the same list and changes when a place moves', () => {
    expect(placesSignature([HOUSTON_PLACE])).toBe(placesSignature([HOUSTON_PLACE]));
    expect(placesSignature([HOUSTON_PLACE])).not.toBe(placesSignature([{ ...HOUSTON_PLACE, lat: 29.0 }]));
    expect(placesSignature([HOUSTON_PLACE, GALVESTON_PLACE])).toBe(placesSignature([GALVESTON_PLACE, HOUSTON_PLACE]));
  });
});

describe('conflict blocklist', () => {
  it('parseBlockedIds tolerates junk', () => {
    expect(parseBlockedIds('["a","b"]')).toEqual(['a', 'b']);
    expect(parseBlockedIds('not json')).toEqual([]);
    expect(parseBlockedIds('')).toEqual([]);
    expect(parseBlockedIds(null)).toEqual([]);
  });
  it('add/get round-trips and dedupes', () => {
    addBlockedPlaceIds([HOME_1]);
    addBlockedPlaceIds([HOME_1, HOME_2]);
    expect(getBlockedPlaceIds()).toEqual([HOME_1, HOME_2]);
  });
  it('blocked ids are excluded from upload', () => {
    const rooms = [HOUSTON_PLACE, GALVESTON_PLACE];
    expect(homePlacesForUpload(rooms, PROFILE, [HOME_1]).map((r) => r.id)).toEqual([HOME_2]);
  });
});

// --- mailbox key blurb ---------------------------------------------------------

describe('mailboxKeyBlurb', () => {
  it('names both rooms', () => {
    expect(mailboxKeyBlurb(
      [{ roomName: 'Shepherd Park' }, { roomName: 'Your Place 2' }],
    )).toBe('The key to your mailbox at Shepherd Park and Your Place 2. Keep it in your pocket to open your mail — or leave it at home until you need it.');
  });
  it('names one room, and falls back to the nearest name', () => {
    expect(mailboxKeyBlurb([{ roomName: 'Your Place 2' }])).toContain('at Your Place 2');
    expect(mailboxKeyBlurb([], 'Shepherd Park')).toContain('at Shepherd Park');
  });
  it('is place-less, never "at the park", when nothing resolves', () => {
    const text = mailboxKeyBlurb([], '');
    expect(text).toBe('The key to your mailbox. Keep it in your pocket to open your mail — or leave it at home until you need it.');
    expect(text).not.toContain('at the park');
  });
  it('the static def no longer says "at the park"', () => {
    expect(ITEM_DEFS['mailbox-key'].blurb).not.toContain('at the park');
    expect(ITEM_DEFS['mailbox-key'].blurb).toContain('The key to your mailbox.');
  });
});

// --- two-device integration -----------------------------------------------------
// Each device gets FRESH module instances (fresh USER_CREATED_ROOMS,
// fresh blocklist memory) via vi.resetModules + dynamic import —
// the closest node gets to two separate browsers.

async function freshDevice() {
  vi.resetModules();
  const roomsMod = await import('../rooms/rooms.js');
  const syncMod = await import('../src/village/placesSync.js');
  const homeMod = await import('../src/village/homeStorage.js');
  const mailMod = await import('../src/village/mailState.js');
  return { roomsMod, syncMod, homeMod, mailMod };
}

describe('two devices, one player', () => {
  it('device A (Houston #1) + device B (Galveston #2) converge to both places on both', async () => {
    // Device A: only the Houston place.
    const A = await freshDevice();
    A.roomsMod.createUserRoom({ ...HOUSTON_PLACE, contributor: 'Thomas', ownerId: OWNER });
    // Device B: only the Galveston place.
    const B = await freshDevice();
    B.roomsMod.createUserRoom({ ...GALVESTON_PLACE, contributor: 'Thomas', ownerId: OWNER });

    // Server store, built by merging each device's upload in turn.
    let serverStore = [];
    const upA = A.syncMod.homePlacesForUpload(A.roomsMod.getAllRooms(), PROFILE, []);
    expect(upA.map((r) => r.id)).toEqual([HOME_1]);
    serverStore = A.syncMod.mergeServerPlaces(serverStore, upA, KEY).places;
    const upB = B.syncMod.homePlacesForUpload(B.roomsMod.getAllRooms(), PROFILE, []);
    expect(upB.map((r) => r.id)).toEqual([HOME_2]);
    serverStore = B.syncMod.mergeServerPlaces(serverStore, upB, KEY).places;
    expect(serverStore.map((r) => r.id)).toEqual([HOME_1, HOME_2]);

    // Both devices apply the merged list.
    for (const D of [A, B]) {
      const localRooms = D.homeMod.findHomeRooms(D.roomsMod.getAllRooms(), PROFILE);
      const { rooms, newConflicts } = D.syncMod.applyPlacesState({
        localRooms, serverPlaces: serverStore, blockedIds: D.syncMod.getBlockedPlaceIds(),
      });
      expect(newConflicts).toEqual([]);
      D.roomsMod.replaceOwnerHomeRooms(KEY, rooms);
      const found = D.homeMod.findHomeRooms(D.roomsMod.getAllRooms(), PROFILE);
      expect(found.map((r) => r.id)).toEqual([HOME_1, HOME_2]);
      // The create option now hides: two places already exist.
      expect(D.homeMod.homeCreateState({ location: { latitude: 29.8, longitude: -95.44 }, profile: PROFILE, rooms: D.roomsMod.getAllRooms() }).status).toBe('already-exists');
      // The mailbox line lists BOTH rooms, with no mailbox changes.
      const mailboxRooms = D.mailMod.resolveMailboxRooms(D.roomsMod.getAllRooms(), null, found);
      expect(mailboxRooms.map((r) => r.roomName)).toEqual(['Shepherd Park', 'Your Place 2']);
      expect(D.mailMod.mailboxRoomsLine(mailboxRooms, '')).toBe('Your mailboxes are at Shepherd Park and Your Place 2');
      expect(D.mailMod.mailboxKeyBlurb(mailboxRooms, '')).toContain('at Shepherd Park and Your Place 2');
    }
  });

  it('a place created on one device appears on the other after sync', async () => {
    const A = await freshDevice();
    const B = await freshDevice();
    // B starts with nothing; A creates the Houston place.
    A.roomsMod.createUserRoom({ ...HOUSTON_PLACE, contributor: 'Thomas', ownerId: OWNER });
    let serverStore = A.syncMod.mergeServerPlaces(
      [], A.syncMod.homePlacesForUpload(A.roomsMod.getAllRooms(), PROFILE, []), KEY,
    ).places;
    // B applies: the place appears, even though B never created it.
    const { rooms } = B.syncMod.applyPlacesState({
      localRooms: B.homeMod.findHomeRooms(B.roomsMod.getAllRooms(), PROFILE),
      serverPlaces: serverStore, blockedIds: [],
    });
    B.roomsMod.replaceOwnerHomeRooms(KEY, rooms);
    expect(B.homeMod.findHomeRooms(B.roomsMod.getAllRooms(), PROFILE).map((r) => r.id)).toEqual([HOME_1]);
    expect(B.roomsMod.getAllRooms().some((r) => r.id === HOME_1)).toBe(true);
    // And B's own upload afterwards does not duplicate it.
    serverStore = B.syncMod.mergeServerPlaces(
      serverStore, B.syncMod.homePlacesForUpload(B.roomsMod.getAllRooms(), PROFILE, []), KEY,
    ).places;
    expect(serverStore).toHaveLength(1);
  });

  it('two devices each creating place #1: first writer wins, loser keeps its copy locally', async () => {
    const A = await freshDevice();
    const B = await freshDevice();
    A.roomsMod.createUserRoom({ ...HOUSTON_PLACE, contributor: 'Thomas', ownerId: OWNER });
    B.roomsMod.createUserRoom({ ...HOUSTON_PLACE, lat: 29.55, lng: -94.98, name: 'Your Place', contributor: 'Thomas', ownerId: OWNER });
    let serverStore = [];
    const first = A.syncMod.mergeServerPlaces(serverStore, A.syncMod.homePlacesForUpload(A.roomsMod.getAllRooms(), PROFILE, []), KEY);
    serverStore = first.places;
    const second = B.syncMod.mergeServerPlaces(serverStore, B.syncMod.homePlacesForUpload(B.roomsMod.getAllRooms(), PROFILE, []), KEY);
    expect(second.conflicts).toEqual([HOME_1]);
    expect(second.places[0].lat).toBe(29.815);
    // B applies: its own Galveston #1 stays visible on B only.
    const applied = B.syncMod.applyPlacesState({
      localRooms: B.homeMod.findHomeRooms(B.roomsMod.getAllRooms(), PROFILE),
      serverPlaces: second.places, blockedIds: [],
    });
    expect(applied.rooms[0].lat).toBe(29.55);
    expect(applied.newConflicts).toEqual([HOME_1]);
    B.syncMod.addBlockedPlaceIds(applied.newConflicts);
    // B never uploads the blocked id again.
    expect(B.syncMod.homePlacesForUpload(B.roomsMod.getAllRooms(), PROFILE, B.syncMod.getBlockedPlaceIds())).toEqual([]);
  });

  it('server restart: places survive via client re-upload', async () => {
    const A = await freshDevice();
    const B = await freshDevice();
    A.roomsMod.createUserRoom({ ...HOUSTON_PLACE, contributor: 'Thomas', ownerId: OWNER });
    B.roomsMod.createUserRoom({ ...GALVESTON_PLACE, contributor: 'Thomas', ownerId: OWNER });
    let serverStore = A.syncMod.mergeServerPlaces([], A.syncMod.homePlacesForUpload(A.roomsMod.getAllRooms(), PROFILE, []), KEY).places;
    serverStore = B.syncMod.mergeServerPlaces(serverStore, B.syncMod.homePlacesForUpload(B.roomsMod.getAllRooms(), PROFILE, []), KEY).places;
    expect(serverStore).toHaveLength(2);
    // Restart wipes the in-memory server store.
    serverStore = [];
    // Both devices reconnect and re-upload: everything comes back.
    serverStore = A.syncMod.mergeServerPlaces(serverStore, A.syncMod.homePlacesForUpload(A.roomsMod.getAllRooms(), PROFILE, []), KEY).places;
    serverStore = B.syncMod.mergeServerPlaces(serverStore, B.syncMod.homePlacesForUpload(B.roomsMod.getAllRooms(), PROFILE, []), KEY).places;
    expect(serverStore.map((r) => r.id)).toEqual([HOME_1, HOME_2]);
  });

  it('offline: with no server reply, local places still work and nothing is wiped', async () => {
    const B = await freshDevice();
    B.roomsMod.createUserRoom({ ...GALVESTON_PLACE, contributor: 'Thomas', ownerId: OWNER });
    // No server reply at all: apply with an empty server list.
    const { rooms } = B.syncMod.applyPlacesState({
      localRooms: B.homeMod.findHomeRooms(B.roomsMod.getAllRooms(), PROFILE),
      serverPlaces: [], blockedIds: [],
    });
    expect(rooms.map((r) => r.id)).toEqual([HOME_2]);
    B.roomsMod.replaceOwnerHomeRooms(KEY, rooms);
    expect(B.homeMod.findHomeRooms(B.roomsMod.getAllRooms(), PROFILE)).toHaveLength(1);
  });

  it('guest places stay local-only', async () => {
    const G = await freshDevice();
    const guestKey = G.homeMod.ownerKeyFromProfile(GUEST_PROFILE);
    const guestHome = { id: `home-${guestKey}`, name: 'Your Place', lat: 29.8, lng: -95.44, radiusMeters: 60, kind: 'home', ownerId: guestKey };
    G.roomsMod.createUserRoom({ ...guestHome, contributor: 'guest', ownerId: GUEST_PROFILE.profile.email });
    // The guest's own device still sees the place…
    expect(G.homeMod.findHomeRooms(G.roomsMod.getAllRooms(), GUEST_PROFILE)).toHaveLength(1);
    // …but nothing is ever uploaded for it.
    expect(G.syncMod.homePlacesForUpload(G.roomsMod.getAllRooms(), GUEST_PROFILE, [])).toEqual([]);
  });
});

describe('marker', () => {
  it('carries the kit marker', () => {
    expect(PLACES_SYNC_MARKER_V1).toBe('sq-places-sync-v1');
  });
});
