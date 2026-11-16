// homeStorage.test.js — Your Place v1 (`sq-your-place-v1`).
// Pure-logic tests for src/village/homeStorage.js (same shape as
// tests/items.test.js: the module has no Phaser / Node deps, and its
// localStorage access falls back to memory in node).

import { describe, it, expect } from 'vitest';
import {
  HOME_STORAGE_MARKER_V1,
  HOME_STORAGE_MARKER_V1_1,
  HOME_DROP_MARKER_V1,
  HOME_ROOM_PREFIX,
  HOME_ROOM_RADIUS,
  HOME_STORAGE_MAX_ITEMS,
  homeRoomIdFor,
  isHomeRoom,
  homeOwnerOf,
  normalizeHomeOwner,
  ownerKeyFromProfile,
  findHomeRoom,
  homeCreateState,
  normalizeHomeItems,
  mergeHomeItems,
  storeIntoHome,
  takeFromHome,
  unloadPocketIntoHome,
  getHomeItems,
  _setHomeItemsForTest,
  normalizeFloorItems,
  mergeFloorItems,
  dropOnFloor,
  pickupFromFloor,
  getFloorItems,
  _setFloorItemsForTest,
} from '../src/village/homeStorage.js';

const trash = (over = {}) => ({
  id: over.id || 'trash-1',
  type: 'trash',
  label: 'Piece of trash',
  ...over,
});
const food = (over = {}) => ({
  id: over.id || 'food-1',
  type: 'food',
  label: 'Bits of food',
  ...over,
});
const piece = (over = {}) => ({
  id: over.id || 'piece-1',
  type: 'puzzle-piece',
  pieceId: 3,
  ...over,
});

describe('your place v1', () => {
  it('carries the v1 marker and the home- prefix', () => {
    expect(HOME_STORAGE_MARKER_V1).toBe('sq-your-place-v1');
    expect(HOME_ROOM_PREFIX).toBe('home-');
  });

  it('derives a home room id from the profile email', () => {
    expect(homeRoomIdFor('tfkelleher3@gmail.com')).toBe('home-tfkelleher3-gmail-com');
    expect(homeRoomIdFor({ profile: { email: 'TFKelleher3@Gmail.com' } })).toBe('home-tfkelleher3-gmail-com');
    expect(homeRoomIdFor({ email: 'jules@example.com' })).toBe('home-jules-example-com');
    expect(homeRoomIdFor({ id: 'Some One' })).toBe('home-some-one');
    // Guests get a unique guest email when they enter, so a guest
    // email still makes a home room — only a fully anonymous
    // session (no email, no id) has none.
    expect(homeRoomIdFor({ profile: { email: 'guest_123@side.quest' } })).toBe('home-guest-123-side-quest');
  });

  it('has no home room for a fully anonymous session', () => {
    expect(homeRoomIdFor(null)).toBe(null);
    expect(homeRoomIdFor({})).toBe(null);
    expect(homeRoomIdFor('guest')).toBe(null);
    expect(homeRoomIdFor({ profile: { email: '' }, mode: 'guest' })).toBe(null);
  });

  it('recognizes home rooms and their owners', () => {
    expect(isHomeRoom('home-tfkelleher3-gmail-com')).toBe(true);
    expect(isHomeRoom('home-jules-example-com')).toBe(true);
    expect(isHomeRoom('agora-houston')).toBe(false);
    expect(isHomeRoom('home-')).toBe(false);
    expect(isHomeRoom('home')).toBe(false);
    expect(isHomeRoom(null)).toBe(false);
    expect(homeOwnerOf('home-tfkelleher3-gmail-com')).toBe('tfkelleher3-gmail-com');
    expect(homeOwnerOf('agora-houston')).toBe('');
    expect(normalizeHomeOwner('  Jules@Example.COM ')).toBe('jules-example-com');
    expect(ownerKeyFromProfile({ profile: { email: 'a@b.co' } })).toBe('a-b-co');
  });

  it('normalizes stored items and drops unknown types', () => {
    const out = normalizeHomeItems([
      trash(),
      { id: 'bad-1', type: 'gold-bar' },
      { type: 'trash' },
      food({ id: 'food-1' }),
      trash(), // duplicate id — first wins
      { id: 'x', type: 'note', title: 'Hi', text: 'Hello' },
    ]);
    expect(out.map((it) => it.id)).toEqual(['trash-1', 'food-1', 'x']);
    expect(out[2].title).toBe('Hi');
    expect(out[2].text).toBe('Hello');
    expect(normalizeHomeItems(null)).toEqual([]);
    expect(normalizeHomeItems('nope')).toEqual([]);
  });

  it('caps the stored list against a flooding client', () => {
    const many = Array.from({ length: 250 }, (_, i) => trash({ id: `t-${i}` }));
    expect(normalizeHomeItems(many)).toHaveLength(HOME_STORAGE_MAX_ITEMS);
    expect(HOME_STORAGE_MAX_ITEMS).toBe(200);
  });

  it('merges two stored lists by id, first list wins', () => {
    const a = [trash({ label: 'server copy' })];
    const b = [trash({ label: 'client copy' }), food()];
    const merged = mergeHomeItems(a, b);
    expect(merged.map((it) => it.id)).toEqual(['trash-1', 'food-1']);
    expect(merged[0].label).toBe('server copy');
    expect(mergeHomeItems([], b)).toHaveLength(2);
  });

  it('stores an item at home', () => {
    const res = storeIntoHome([], trash());
    expect(res.ok).toBe(true);
    expect(res.list).toHaveLength(1);
    expect(res.item.id).toBe('trash-1');
  });

  it('refuses to store a puzzle piece at home', () => {
    const res = storeIntoHome([], piece());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('puzzle-piece-no-store');
    expect(res.list).toHaveLength(0);
  });

  it('refuses a duplicate store and a bad item', () => {
    expect(storeIntoHome([trash()], trash()).reason).toBe('already-stored');
    expect(storeIntoHome([], null).reason).toBe('bad-item');
    expect(storeIntoHome([], { id: 'x', type: 'gold-bar' }).reason).toBe('bad-item');
  });

  it('takes an item back out of home storage', () => {
    const { list, item } = takeFromHome([trash(), food()], 'food-1');
    expect(item.id).toBe('food-1');
    expect(list.map((it) => it.id)).toEqual(['trash-1']);
    expect(takeFromHome([trash()], 'missing').item).toBe(null);
  });

  it('unloads a whole pocket at once, leaving puzzle pieces behind', () => {
    const pocket = [trash(), food(), piece(), trash({ id: 'trash-2' })];
    const { list, moved, left } = unloadPocketIntoHome([], pocket);
    expect(moved.map((it) => it.id)).toEqual(['trash-1', 'food-1', 'trash-2']);
    expect(left.map((it) => it.id)).toEqual(['piece-1']);
    expect(list).toHaveLength(3);
  });

  it('unload-all moves nothing when the pocket holds only pieces', () => {
    const { list, moved, left } = unloadPocketIntoHome([], [piece()]);
    expect(moved).toEqual([]);
    expect(left).toHaveLength(1);
    expect(list).toEqual([]);
  });

  it('keeps the local home record round-tripping', () => {
    _setHomeItemsForTest([trash(), food()]);
    expect(getHomeItems().map((it) => it.id)).toEqual(['trash-1', 'food-1']);
    _setHomeItemsForTest([]);
    expect(getHomeItems()).toEqual([]);
  });
});

describe('create home v1.1', () => {
  const profile = 'tfkelleher3@gmail.com';
  const homeId = 'home-tfkelleher3-gmail-com';
  const loc = { latitude: 29.75, longitude: -95.4 };
  const homeRoom = { id: homeId, name: 'Your Place', kind: 'home', lat: 29.75, lng: -95.4 };
  const otherRoom = { id: 'agora-houston', name: 'Agora', kind: 'gps' };

  it('carries the v1.1 marker (v1 marker kept)', () => {
    expect(HOME_STORAGE_MARKER_V1_1).toBe('sq-your-place-v1-1');
    expect(HOME_STORAGE_MARKER_V1).toBe('sq-your-place-v1');
    expect(HOME_ROOM_RADIUS).toBe(60);
  });

  it('finds the home room in a rooms list, or null when not created', () => {
    expect(findHomeRoom([otherRoom], profile)).toBe(null);
    expect(findHomeRoom([otherRoom, homeRoom], profile)).toBe(homeRoom);
    expect(findHomeRoom([], profile)).toBe(null);
    expect(findHomeRoom([homeRoom], null)).toBe(null);
    // Another player's home is not mine.
    expect(findHomeRoom([{ id: 'home-jules-example-com', kind: 'home' }], profile)).toBe(null);
  });

  it('says ready when there is no home yet, GPS is locked, profile known', () => {
    const state = homeCreateState({ location: loc, profile, rooms: [otherRoom] });
    expect(state).toEqual({ status: 'ready', homeId });
  });

  it('says already-exists once the home room is in the list', () => {
    const state = homeCreateState({ location: loc, profile, rooms: [otherRoom, homeRoom] });
    expect(state.status).toBe('already-exists');
    expect(state.homeId).toBe(homeId);
  });

  it('refuses without GPS, and without a profile', () => {
    expect(homeCreateState({ location: null, profile, rooms: [] }).status).toBe('no-location');
    expect(homeCreateState({ location: {}, profile, rooms: [] }).status).toBe('no-location');
    expect(homeCreateState({ location: loc, profile: null, rooms: [] }).status).toBe('no-profile');
    expect(homeCreateState({ location: loc, profile: 'guest', rooms: [] }).status).toBe('no-profile');
  });

  it('a second create is refused even with a fresh GPS fix', () => {
    // The modal hides the option, but the state function is the
    // backstop: calling it again with the home already in the list
    // still says already-exists.
    const first = homeCreateState({ location: loc, profile, rooms: [] });
    expect(first.status).toBe('ready');
    const second = homeCreateState({ location: { latitude: 29.8, longitude: -95.5 }, profile, rooms: [homeRoom] });
    expect(second.status).toBe('already-exists');
  });
});

describe('drop on the home floor v1', () => {
  it('carries the drop marker', () => {
    expect(HOME_DROP_MARKER_V1).toBe('sq-home-drop-v1');
  });

  it('drops an item on the floor at the given position', () => {
    const res = dropOnFloor([], trash(), 800, 450);
    expect(res.ok).toBe(true);
    expect(res.item.x).toBe(800);
    expect(res.item.y).toBe(450);
    expect(res.list).toHaveLength(1);
  });

  it('refuses puzzle pieces on the floor, like the chest', () => {
    const res = dropOnFloor([], piece(), 800, 450);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('puzzle-piece-no-drop');
    expect(res.list).toEqual([]);
  });

  it('refuses a duplicate drop and a bad item', () => {
    const first = dropOnFloor([], trash(), 800, 450);
    expect(first.ok).toBe(true);
    expect(dropOnFloor(first.list, trash(), 810, 460).reason).toBe('already-dropped');
    expect(dropOnFloor([], { type: 'unknown-thing' }, 800, 450).reason).toBe('bad-item');
    expect(dropOnFloor([], null, 800, 450).reason).toBe('bad-item');
  });

  it('picks a dropped item back up, and reports a miss', () => {
    const dropped = dropOnFloor([], food(), 500, 300);
    const picked = pickupFromFloor(dropped.list, 'food-1');
    expect(picked.item.id).toBe('food-1');
    expect(picked.item.x).toBe(500);
    expect(picked.list).toEqual([]);
    expect(pickupFromFloor(dropped.list, 'nope').item).toBe(null);
  });

  it('normalize drops items with no usable position and clamps the rest', () => {
    const out = normalizeFloorItems([
      trash({ id: 'a', x: 100, y: 100 }),
      trash({ id: 'b' }), // no position — dropped
      trash({ id: 'c', x: 99999, y: -50 }), // clamped to the room
      { id: 'd', type: 'nope', x: 1, y: 1 }, // unknown type — dropped
    ]);
    expect(out.map((it) => it.id)).toEqual(['a', 'c']);
    expect(out[1].x).toBe(1600);
    expect(out[1].y).toBe(0);
  });

  it('merges floor lists add-only by id, first list wins', () => {
    const a = dropOnFloor([], trash(), 100, 100).list;
    const b = dropOnFloor([], food(), 200, 200).list;
    const merged = mergeFloorItems(a, b);
    expect(merged.map((it) => it.id)).toEqual(['trash-1', 'food-1']);
    // A re-sync never resurrects a picked-up item when both sides
    // agree it is gone, but a stale side still wins the union.
    expect(mergeFloorItems([], b).map((it) => it.id)).toEqual(['food-1']);
  });

  it('the floor record round-trips through local storage', () => {
    _setFloorItemsForTest([trash({ x: 700, y: 500 })]);
    expect(getFloorItems().map((it) => it.id)).toEqual(['trash-1']);
    expect(getFloorItems()[0].x).toBe(700);
    _setFloorItemsForTest([]);
    expect(getFloorItems()).toEqual([]);
  });

  it('a drop followed by a pickup leaves the floor empty', () => {
    const res = dropOnFloor(getFloorItems(), trash(), 800, 450);
    expect(res.ok).toBe(true);
    const after = pickupFromFloor(res.list, 'trash-1');
    expect(after.list).toEqual([]);
    expect(after.item.type).toBe('trash');
  });
});
