// homeStorage.test.js — Your Place v1 (`sq-your-place-v1`).
// Pure-logic tests for src/village/homeStorage.js (same shape as
// tests/items.test.js: the module has no Phaser / Node deps, and its
// localStorage access falls back to memory in node).

import { describe, it, expect } from 'vitest';
import {
  HOME_STORAGE_MARKER_V1,
  HOME_ROOM_PREFIX,
  HOME_STORAGE_MAX_ITEMS,
  homeRoomIdFor,
  isHomeRoom,
  homeOwnerOf,
  normalizeHomeOwner,
  ownerKeyFromProfile,
  normalizeHomeItems,
  mergeHomeItems,
  storeIntoHome,
  takeFromHome,
  unloadPocketIntoHome,
  getHomeItems,
  _setHomeItemsForTest,
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
