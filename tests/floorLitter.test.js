// floorLitter.test.js — Shared Floor Litter v1
// (`sq-shared-litter-v1`). Pure-logic tests for
// src/village/floorLitterState.js (same shape as
// tests/noticeBoard.test.js: the module has no Phaser / Node deps).

import { describe, it, expect } from 'vitest';
import {
  FLOOR_LITTER_MARKER_V1,
  FLOOR_LITTER_MAX_PER_ROOM,
  FLOOR_LITTER_CLAIM_MS,
  createFloorLitterState,
  cleanFloorLitterEntry,
  isNeverDropType,
  addFloorLitter,
  removeFloorLitter,
  claimFloorLitter,
  confirmFloorLitterClaim,
  cancelFloorLitterClaim,
  sweepFloorLitterClaims,
  serializeFloorLitterState,
  parseFloorLitterState,
  litterPocketItem,
} from '../src/village/floorLitterState.js';

const entry = (over = {}) => ({
  id: over.id || `l-${Math.random().toString(36).slice(2, 8)}`,
  type: over.type || 'trash',
  label: over.label || 'a crumpled wrapper',
  x: over.x ?? 500,
  y: over.y ?? 300,
  droppedBy: over.droppedBy || 'alice@example.com',
  droppedByName: over.droppedByName || 'Alice',
  droppedAt: over.droppedAt ?? 1000,
  ...over,
});

describe('shared floor litter v1', () => {
  it('carries the v1 marker and the builder defaults', () => {
    expect(FLOOR_LITTER_MARKER_V1).toBe('sq-shared-litter-v1');
    expect(FLOOR_LITTER_MAX_PER_ROOM).toBe(30);
    expect(FLOOR_LITTER_CLAIM_MS).toBe(10_000);
  });

  it('cleans an entry and derives the emoji from the type', () => {
    const clean = cleanFloorLitterEntry(entry({ id: 'l1', type: 'food', emoji: '💣', usesLeft: 2, breadKind: 'croissant' }));
    expect(clean.id).toBe('l1');
    expect(clean.emoji).toBe('🥐'); // the client-supplied 💣 is ignored
    expect(clean.usesLeft).toBe(2);
    expect(clean.breadKind).toBe('croissant');
    expect(clean.droppedByName).toBe('Alice');
    expect(clean.droppedAt).toBe(1000);
  });

  it('clamps usesLeft to 3 and drops it for non-food', () => {
    expect(cleanFloorLitterEntry(entry({ type: 'food', usesLeft: 9 })).usesLeft).toBe(3);
    expect(cleanFloorLitterEntry(entry({ type: 'food', usesLeft: 0 })).usesLeft).toBe(null);
    expect(cleanFloorLitterEntry(entry({ type: 'trash', usesLeft: 2 })).usesLeft).toBe(null);
  });

  it('refuses nonsense coordinates and a missing type', () => {
    expect(cleanFloorLitterEntry(entry({ x: NaN }))).toBe(null);
    expect(cleanFloorLitterEntry(entry({ type: '' }))).toBe(null);
    expect(cleanFloorLitterEntry(null)).toBe(null);
  });

  it('clamps coordinates into the room', () => {
    const clean = cleanFloorLitterEntry(entry({ x: 99999, y: -5 }));
    expect(clean.x).toBe(4000);
    expect(clean.y).toBe(0);
  });

  it('refuses the never-drop types', () => {
    expect(isNeverDropType('mailbox-key')).toBe(true);
    expect(isNeverDropType('puzzle-piece')).toBe(true);
    expect(isNeverDropType('santa-hat')).toBe(true);
    expect(isNeverDropType('trash')).toBe(false);
    const state = createFloorLitterState();
    expect(addFloorLitter(state, entry({ type: 'mailbox-key' })).reason).toBe('not-droppable');
    expect(addFloorLitter(state, entry({ type: 'puzzle-piece' })).reason).toBe('not-droppable');
    expect(addFloorLitter(state, entry({ type: 'santa-hat' })).reason).toBe('not-droppable');
    expect(state.items).toHaveLength(0);
  });

  it('adds an entry and carries droppedBy / droppedAt through serialize', () => {
    const state = createFloorLitterState();
    const res = addFloorLitter(state, entry({ id: 'l1' }));
    expect(res.ok).toBe(true);
    expect(res.entry.id).toBe('l1');
    const s = serializeFloorLitterState(state);
    expect(s.count).toBe(1);
    expect(s.max).toBe(30);
    expect(s.items[0].droppedBy).toBe('alice@example.com');
    expect(s.items[0].droppedByName).toBe('Alice');
    expect(s.items[0].droppedAt).toBe(1000);
  });

  it('refuses a duplicate id and a bad entry', () => {
    const state = createFloorLitterState();
    expect(addFloorLitter(state, entry({ id: 'l1' })).ok).toBe(true);
    expect(addFloorLitter(state, entry({ id: 'l1' })).reason).toBe('duplicate');
    expect(addFloorLitter(state, { type: 'trash' }).reason).toBe('bad-entry');
    expect(state.items).toHaveLength(1);
  });

  it('refuses the 31st entry — a full room never eats an item', () => {
    const state = createFloorLitterState();
    for (let i = 0; i < 30; i++) {
      expect(addFloorLitter(state, entry({ id: `l${i}` })).ok).toBe(true);
    }
    const res = addFloorLitter(state, entry({ id: 'l30' }));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('room-full');
    expect(state.items).toHaveLength(30);
  });

  it('removes an entry, and refuses a missing one', () => {
    const state = createFloorLitterState();
    addFloorLitter(state, entry({ id: 'l1' }));
    expect(removeFloorLitter(state, 'l1').ok).toBe(true);
    expect(removeFloorLitter(state, 'l1').reason).toBe('not-found');
    expect(state.items).toHaveLength(0);
  });

  it('a refused drop never enters the state (the no-lose invariant, pure side)', () => {
    const state = createFloorLitterState();
    for (let i = 0; i < 30; i++) addFloorLitter(state, entry({ id: `l${i}` }));
    const before = serializeFloorLitterState(state);
    expect(addFloorLitter(state, entry({ id: 'l31' })).ok).toBe(false);
    // Test fix (sq-floor-litter-test-fix-v1): serialize() carries a
    // live `now` timestamp, so two serializes only match within the
    // same millisecond — under load the clock ticks and this failed
    // even though the state never changed. Compare the items, which
    // are the state this test is about.
    expect(serializeFloorLitterState(state).items).toEqual(before.items);
  });

  it('claim hides the entry; a second claim is told it is gone', () => {
    const state = createFloorLitterState();
    addFloorLitter(state, entry({ id: 'l1' }));
    const res = claimFloorLitter(state, 'l1', 'bob@example.com', 5000);
    expect(res.ok).toBe(true);
    expect(res.entry.id).toBe('l1');
    expect(serializeFloorLitterState(state).items).toHaveLength(0);
    expect(claimFloorLitter(state, 'l1', 'carol@example.com', 5001).reason).toBe('not-found');
  });

  it('confirm settles the claim; cancel puts the entry back', () => {
    const state = createFloorLitterState();
    addFloorLitter(state, entry({ id: 'l1' }));
    addFloorLitter(state, entry({ id: 'l2' }));
    claimFloorLitter(state, 'l1', 'bob@example.com', 5000);
    claimFloorLitter(state, 'l2', 'bob@example.com', 5000);
    expect(confirmFloorLitterClaim(state, 'l1', 'bob@example.com').ok).toBe(true);
    expect(serializeFloorLitterState(state).items).toHaveLength(0);
    expect(cancelFloorLitterClaim(state, 'l2', 'bob@example.com').ok).toBe(true);
    expect(serializeFloorLitterState(state).items).toHaveLength(1);
    expect(serializeFloorLitterState(state).items[0].id).toBe('l2');
  });

  it('a claim from the wrong picker cannot confirm or cancel', () => {
    const state = createFloorLitterState();
    addFloorLitter(state, entry({ id: 'l1' }));
    claimFloorLitter(state, 'l1', 'bob@example.com', 5000);
    expect(confirmFloorLitterClaim(state, 'l1', 'carol@example.com').reason).toBe('not-allowed');
    expect(cancelFloorLitterClaim(state, 'l1', 'carol@example.com').reason).toBe('not-allowed');
    expect(confirmFloorLitterClaim(state, 'nope', 'bob@example.com').reason).toBe('not-found');
  });

  it('sweep restores expired claims and leaves fresh ones alone', () => {
    const state = createFloorLitterState();
    addFloorLitter(state, entry({ id: 'l1' }));
    addFloorLitter(state, entry({ id: 'l2' }));
    claimFloorLitter(state, 'l1', 'bob@example.com', 1000);
    claimFloorLitter(state, 'l2', 'bob@example.com', 9000);
    // 10s claim life: at 11001 the first claim (from 1000) is
    // expired, the second (from 9000) is still fresh.
    expect(sweepFloorLitterClaims(state, 11001).restored).toBe(1);
    expect(serializeFloorLitterState(state).items.map((e) => e.id)).toEqual(['l1']);
    expect(sweepFloorLitterClaims(state, 11002).restored).toBe(0);
  });

  it('parse round-trips a state, caps at 30, dedupes, drops junk', () => {
    // 28 valid + a duplicate + a junk row + 2 more valid = 32
    // on the wire; parse slices to the first 30 first (same as
    // the decor parser), then cleans/dedupes — the duplicate and
    // the junk drop out, leaving 28, and the two extras past the
    // slice never arrive.
    const wire = { items: [] };
    for (let i = 0; i < 28; i++) wire.items.push(entry({ id: `l${i}` }));
    wire.items.push(entry({ id: 'l0' })); // duplicate
    wire.items.push({ type: 'trash' }); // junk: no coordinates
    wire.items.push(entry({ id: 'extra-1' }));
    wire.items.push(entry({ id: 'extra-2' }));
    const parsed = parseFloorLitterState(wire);
    expect(parsed.items).toHaveLength(28);
    expect(new Set(parsed.items.map((e) => e.id)).size).toBe(28);
    expect(parsed.items.some((e) => e.id === 'extra-2')).toBe(false);
    // And a wire state with 35 valid unique entries is capped.
    const big = { items: [] };
    for (let i = 0; i < 35; i++) big.items.push(entry({ id: `b${i}` }));
    expect(parseFloorLitterState(big).items).toHaveLength(30);
    expect(parseFloorLitterState(null).items).toHaveLength(0);
    expect(parseFloorLitterState({ items: 'nope' }).items).toHaveLength(0);
  });

  it('parse never restores claims (they never cross the wire)', () => {
    const state = createFloorLitterState();
    addFloorLitter(state, entry({ id: 'l1' }));
    claimFloorLitter(state, 'l1', 'bob@example.com', 5000);
    const parsed = parseFloorLitterState(serializeFloorLitterState(state));
    expect(parsed.items).toHaveLength(0);
    expect(Object.keys(parsed.claims)).toHaveLength(0);
  });

  it('litterPocketItem marks ground food as trash food, never bread', () => {
    expect(litterPocketItem(cleanFloorLitterEntry(entry({ type: 'food' }))).trashFood).toBe(true);
    expect(litterPocketItem(cleanFloorLitterEntry(entry({ type: 'food', breadKind: 'croissant' }))).trashFood).toBe(false);
    expect(litterPocketItem(cleanFloorLitterEntry(entry({ type: 'food', usesLeft: 2 }))).usesLeft).toBe(2);
    expect(litterPocketItem(cleanFloorLitterEntry(entry({ type: 'trash' }))).trashFood).toBe(null);
    expect(litterPocketItem(null)).toBe(null);
  });

  it('a fresh state starts empty — a restart wipes floor litter by design', () => {
    const state = createFloorLitterState();
    expect(state.items).toEqual([]);
    expect(state.claims).toEqual({});
    expect(serializeFloorLitterState(state).count).toBe(0);
  });
});
