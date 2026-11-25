// litterbugQuest.test.js — Catch a Litterbug quest v1
// (`sq-litterbug-quest-v1`). Pure-logic tests for
// src/village/litterbugState.js (same shape as
// tests/floorLitter.test.js: the module has no Phaser / Node
// deps). The socket.js wiring (npc_litter_drop + litterbug_catch
// handlers, QUEST_DEFS entry) and the client wiring ("!"
// markers, catch tap, LITTERBUG labels, NPC roll) are verified
// by node --check + code read: socket.js boots a server on
// import and cannot run in vitest, and the label rendering is
// canvas behavior whose live check is the real verification.

import { describe, it, expect } from 'vitest';
import {
  LITTERBUG_QUEST_MARKER,
  LITTERBUG_QUEST_ID,
  LITTERBUG_CATCH_EVENT,
  LITTERBUG_CATCH_WINDOW_MS,
  LITTERBUG_LABEL_MS,
  LITTERBUG_NPC_ROOM_ID,
  LITTERBUG_NPC_LABELS,
  LITTERBUG_NPC_COOLDOWN_MS,
  LITTERBUG_NPC_ROLL_MIN_MS,
  LITTERBUG_NPC_ROLL_MAX_MS,
  LITTERBUG_NPC_CUP,
  isFreshLitter,
  isNpcLitter,
  npcIdForLabel,
  isLitterbugNpcLabel,
  validateLitterbugCatch,
} from '../src/village/litterbugState.js';
import {
  createFloorLitterState,
  addFloorLitter,
  claimFloorLitter,
} from '../src/village/floorLitterState.js';

const entry = (over = {}) => ({
  id: over.id || `l-${Math.random().toString(36).slice(2, 8)}`,
  type: over.type || 'food',
  label: over.label || 'a dropped croissant',
  x: over.x ?? 500,
  y: over.y ?? 300,
  droppedBy: over.droppedBy || 'alice@example.com',
  droppedByName: over.droppedByName || 'Alice',
  droppedAt: over.droppedAt ?? 10_000,
  ...over,
});

const stateWith = (...entries) => {
  const s = createFloorLitterState();
  for (const e of entries) s.items.push(e);
  return s;
};

describe('catch a litterbug v1', () => {
  it('carries the v1 marker and the builder defaults', () => {
    expect(LITTERBUG_QUEST_MARKER).toBe('sq-litterbug-quest-v1');
    expect(LITTERBUG_QUEST_ID).toBe('litterbug');
    expect(LITTERBUG_CATCH_EVENT).toBe('litterbug-caught');
    expect(LITTERBUG_CATCH_WINDOW_MS).toBe(15_000);
    expect(LITTERBUG_LABEL_MS).toBe(60_000);
    expect(LITTERBUG_NPC_ROOM_ID).toBe('shepherd-park');
    expect(LITTERBUG_NPC_LABELS).toEqual(['Morning Jogger', 'Park Regular', 'Pond Watcher']);
    expect(LITTERBUG_NPC_COOLDOWN_MS).toBe(120_000);
    expect(LITTERBUG_NPC_ROLL_MIN_MS).toBe(120_000);
    expect(LITTERBUG_NPC_ROLL_MAX_MS).toBe(300_000);
  });

  it('freshness: fresh at the drop, fresh at the window edge, stale one ms past', () => {
    const e = entry({ droppedAt: 10_000 });
    expect(isFreshLitter(e, 10_000)).toBe(true);
    expect(isFreshLitter(e, 10_000 + LITTERBUG_CATCH_WINDOW_MS)).toBe(true);
    expect(isFreshLitter(e, 10_000 + LITTERBUG_CATCH_WINDOW_MS + 1)).toBe(false);
    expect(isFreshLitter(e, 10_000 + 60_000)).toBe(false);
  });

  it('freshness: missing or future droppedAt is never fresh', () => {
    // (The entry() helper defaults droppedAt, so strip it here.)
    expect(isFreshLitter({ ...entry(), droppedAt: undefined }, 10_000)).toBe(false);
    expect(isFreshLitter(entry({ droppedAt: NaN }), 10_000)).toBe(false);
    // A drop stamped in the future (clock wobble) is not fresh —
    // the server re-validates anyway.
    expect(isFreshLitter(entry({ droppedAt: 20_000 }), 10_000)).toBe(false);
    expect(isFreshLitter(null, 10_000)).toBe(false);
  });

  it('NPC helpers: npc ids, labels, and the cup snapshot', () => {
    expect(npcIdForLabel('Morning Jogger')).toBe('npc:Morning Jogger');
    expect(isLitterbugNpcLabel('Pond Watcher')).toBe(true);
    expect(isLitterbugNpcLabel('The Bartender')).toBe(false);
    expect(isLitterbugNpcLabel('')).toBe(false);
    expect(isNpcLitter(entry({ droppedBy: 'npc:Morning Jogger' }))).toBe(true);
    expect(isNpcLitter(entry({ droppedBy: 'alice@example.com' }))).toBe(false);
    expect(LITTERBUG_NPC_CUP.type).toBe('trash');
    expect(LITTERBUG_NPC_CUP.label).toBe('a dropped coffee cup');
  });

  it('an NPC cup drops through the shared-litter path', () => {
    const s = createFloorLitterState();
    const res = addFloorLitter(s, {
      ...LITTERBUG_NPC_CUP,
      id: 'litter-npc-1',
      x: 820,
      y: 1480,
      droppedBy: npcIdForLabel('Pond Watcher'),
      droppedByName: 'Pond Watcher',
      droppedAt: 10_000,
    });
    expect(res.ok).toBe(true);
    expect(res.entry.emoji).toBe('🗑️');
    expect(res.entry.droppedBy).toBe('npc:Pond Watcher');
  });

  it('catch validation: fresh player litter is catchable', () => {
    const s = stateWith(entry({ id: 'l1', droppedAt: 10_000 }));
    const res = validateLitterbugCatch(s, 'l1', 'bob@example.com', 20_000);
    expect(res.ok).toBe(true);
    expect(res.entry.id).toBe('l1');
  });

  it('catch validation: stale litter is refused', () => {
    const s = stateWith(entry({ id: 'l1', droppedAt: 10_000 }));
    const res = validateLitterbugCatch(s, 'l1', 'bob@example.com', 26_000);
    expect(res).toEqual({ ok: false, reason: 'stale' });
  });

  it('catch validation: your own litter is refused', () => {
    const s = stateWith(entry({ id: 'l1', droppedAt: 10_000, droppedBy: 'alice@example.com' }));
    const res = validateLitterbugCatch(s, 'l1', 'alice@example.com', 12_000);
    expect(res).toEqual({ ok: false, reason: 'own-litter' });
  });

  it('catch validation: a missing entry is gone', () => {
    const s = stateWith(entry({ id: 'l1', droppedAt: 10_000 }));
    const res = validateLitterbugCatch(s, 'nope', 'bob@example.com', 12_000);
    expect(res).toEqual({ ok: false, reason: 'gone' });
  });

  it('catch validation: NPC litter is catchable, and never self-caught', () => {
    const npc = entry({
      id: 'l-npc',
      droppedAt: 10_000,
      droppedBy: npcIdForLabel('Morning Jogger'),
      droppedByName: 'Morning Jogger',
    });
    const s = stateWith(npc);
    // Any real player can catch the NPC's cup.
    expect(validateLitterbugCatch(s, 'l-npc', 'bob@example.com', 12_000).ok).toBe(true);
    // Even a catcher whose id is the bare label is not the NPC —
    // the 'npc:' prefix is what identifies the dropper.
    expect(validateLitterbugCatch(s, 'l-npc', 'Morning Jogger', 12_000).ok).toBe(true);
  });

  it('catch validation: a picked-up (claimed) entry is gone, not catchable', () => {
    // No progress on pickup: once the litter is claimed for
    // pickup it leaves the visible list, so a catch attempt
    // after a pickup finds nothing to catch.
    const s = stateWith(entry({ id: 'l1', droppedAt: 10_000 }));
    const claimed = claimFloorLitter(s, 'l1', 'bob@example.com', 12_000);
    expect(claimed.ok).toBe(true);
    const res = validateLitterbugCatch(s, 'l1', 'carol@example.com', 12_000);
    expect(res).toEqual({ ok: false, reason: 'gone' });
  });

  it('catch validation: the same litter can be caught by a second witness', () => {
    // Catching does not consume the litter — two witnesses can
    // each catch the same fresh drop (each earns their own
    // progress; quest_progress is idempotent per player).
    const s = stateWith(entry({ id: 'l1', droppedAt: 10_000 }));
    expect(validateLitterbugCatch(s, 'l1', 'bob@example.com', 12_000).ok).toBe(true);
    expect(validateLitterbugCatch(s, 'l1', 'carol@example.com', 13_000).ok).toBe(true);
    expect(s.items).toHaveLength(1);
  });
});
