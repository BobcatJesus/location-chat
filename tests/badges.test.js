// badges.test.js — Quest Completions / Badges v1
// (`sq-quest-badges-v1`). Pure logic only: defs, merge, list, dates.

import { describe, it, expect } from 'vitest';
import {
  BADGES_MARKER_V1,
  BADGES_BACKFILL_MARKER_V1_1,
  GROUP_PUZZLE_BADGE,
  TRIM_TREE_BADGE,
  BADGE_QUEST_IDS,
  isBadgeQuestId,
  getBadgeDef,
  normalizeBadgeMap,
  mergeBadgeMaps,
  badgeListFrom,
  formatBadgeDate,
  completionsFromSaved,
  backfilledBadgesFromQuestState,
} from '../src/village/badges.js';

describe('badge defs', () => {
  it('carries the v1 marker', () => {
    expect(BADGES_MARKER_V1).toBe('sq-quest-badges-v1');
  });

  it('carries the v1.1 backfill marker', () => {
    expect(BADGES_BACKFILL_MARKER_V1_1).toBe('sq-quest-badges-v1-1');
  });

  it('covers every solo quest plus the group puzzle', () => {
    expect(BADGE_QUEST_IDS).toContain('duck-roundup');
    expect(BADGE_QUEST_IDS).toContain('cat-cuddles');
    expect(BADGE_QUEST_IDS).toContain('first-round');
    expect(BADGE_QUEST_IDS).toContain('barfly');
    expect(BADGE_QUEST_IDS).toContain('golden-key');
    expect(BADGE_QUEST_IDS).toContain('wanderer');
    expect(BADGE_QUEST_IDS).toContain('bartenders-errand');
    expect(BADGE_QUEST_IDS).toContain('group-puzzle');
    expect(BADGE_QUEST_IDS).toContain('trim-tree');
  });

  it('resolves the group puzzle def (not a QuestManager quest)', () => {
    const def = getBadgeDef('group-puzzle');
    expect(def).toMatchObject({ id: 'group-puzzle', emoji: '🧩' });
    expect(def.title).toBe(GROUP_PUZZLE_BADGE.title);
  });

  it('resolves the trim the tree def (not a QuestManager quest)', () => {
    const def = getBadgeDef('trim-tree');
    expect(def).toMatchObject({ id: 'trim-tree', emoji: '🎄' });
    expect(def.title).toBe(TRIM_TREE_BADGE.title);
  });

  it('resolves a solo quest def from quests.js', () => {
    expect(getBadgeDef('duck-roundup')).toMatchObject({
      id: 'duck-roundup', title: 'The Duck Roundup', emoji: '🦆',
    });
  });

  it('returns null for an unknown quest id', () => {
    expect(getBadgeDef('not-a-quest')).toBeNull();
    expect(isBadgeQuestId('not-a-quest')).toBe(false);
  });
});

describe('normalizeBadgeMap', () => {
  it('accepts a map, an array of objects, and an array of ids', () => {
    expect(normalizeBadgeMap({ 'duck-roundup': 1000 })).toEqual({ 'duck-roundup': 1000 });
    expect(normalizeBadgeMap([{ questId: 'duck-roundup', completedAt: 1000 }]))
      .toEqual({ 'duck-roundup': 1000 });
    // A bare id has no finish time — it stays unknown (null), never
    // a made-up "today" date.
    const withIds = normalizeBadgeMap(['duck-roundup']);
    expect(withIds).toEqual({ 'duck-roundup': null });
  });

  it('keeps an unknown timestamp unknown instead of inventing one', () => {
    expect(normalizeBadgeMap({ 'duck-roundup': null })).toEqual({ 'duck-roundup': null });
    expect(normalizeBadgeMap({ 'duck-roundup': 'garbage' })).toEqual({ 'duck-roundup': null });
    expect(normalizeBadgeMap({ 'duck-roundup': 0 })).toEqual({ 'duck-roundup': null });
  });

  it('a real timestamp beats an unknown one, and the earliest real one wins', () => {
    expect(mergeBadgeMaps({ 'duck-roundup': null }, { 'duck-roundup': 5000 }))
      .toEqual({ 'duck-roundup': 5000 });
    expect(mergeBadgeMaps({ 'duck-roundup': 5000 }, { 'duck-roundup': null }))
      .toEqual({ 'duck-roundup': 5000 });
    expect(mergeBadgeMaps({ 'duck-roundup': 9000 }, { 'duck-roundup': 2000 }))
      .toEqual({ 'duck-roundup': 2000 });
    expect(mergeBadgeMaps({ 'duck-roundup': null }, { 'duck-roundup': null }))
      .toEqual({ 'duck-roundup': null });
  });

  it('drops unknown ids and keeps the earliest timestamp per quest', () => {
    const out = normalizeBadgeMap([
      { questId: 'duck-roundup', completedAt: 5000 },
      { questId: 'duck-roundup', completedAt: 2000 },
      { questId: 'invented-quest', completedAt: 1000 },
    ]);
    expect(out).toEqual({ 'duck-roundup': 2000 });
  });

  it('returns an empty map for junk input', () => {
    expect(normalizeBadgeMap(null)).toEqual({});
    expect(normalizeBadgeMap('nope')).toEqual({});
    expect(normalizeBadgeMap(undefined)).toEqual({});
  });
});

describe('mergeBadgeMaps', () => {
  it('unions two records, earliest timestamp wins', () => {
    const merged = mergeBadgeMaps(
      { 'duck-roundup': 3000, 'cat-cuddles': 1000 },
      { 'duck-roundup': 2000, 'barfly': 4000 },
    );
    expect(merged).toEqual({
      'duck-roundup': 2000,
      'cat-cuddles': 1000,
      'barfly': 4000,
    });
  });

  it('completing the same quest twice never duplicates it', () => {
    const merged = mergeBadgeMaps({ 'duck-roundup': 1000 }, { 'duck-roundup': 9000 });
    expect(Object.keys(merged)).toEqual(['duck-roundup']);
  });
});

describe('badgeListFrom', () => {
  it('lists newest first with def details', () => {
    const list = badgeListFrom({
      'duck-roundup': 1000,
      'cat-cuddles': 3000,
      'barfly': 2000,
    });
    expect(list.map((b) => b.questId)).toEqual(['cat-cuddles', 'barfly', 'duck-roundup']);
    expect(list[0]).toMatchObject({ emoji: '🐱', title: 'Cat Cuddles' });
  });

  it('skips unknown ids', () => {
    expect(badgeListFrom({ 'duck-roundup': 1000, 'invented-quest': 2000 }))
      .toHaveLength(1);
  });

  it('is empty with no completions', () => {
    expect(badgeListFrom({})).toEqual([]);
  });

  it('sorts badges with unknown dates last', () => {
    const list = badgeListFrom({
      'duck-roundup': null,
      'cat-cuddles': 3000,
      'barfly': 2000,
    });
    expect(list.map((b) => b.questId)).toEqual(['cat-cuddles', 'barfly', 'duck-roundup']);
  });
});

describe('formatBadgeDate', () => {
  it('formats a real timestamp as a short date', () => {
    expect(formatBadgeDate(new Date('2026-11-16T12:00:00Z').getTime()))
      .toBe('Nov 16, 2026');
  });

  it('falls back for a missing timestamp', () => {
    expect(formatBadgeDate(null)).toBe('Completed');
    expect(formatBadgeDate('garbage')).toBe('Completed');
  });
});

describe('completionsFromSaved (v1.1 backfill source)', () => {
  it('turns every finished quest in the local record into a badge', () => {
    expect(completionsFromSaved({
      'duck-roundup': { count: 3, completed: true },
      'cat-cuddles': { count: 3, completed: true, completedAt: 1700000000000 },
      'barfly': { count: 2, completed: false },
      'wanderer': { count: 0, completed: false },
    })).toEqual({
      'duck-roundup': null,
      'cat-cuddles': 1700000000000,
    });
  });

  it('returns an empty map for junk input', () => {
    expect(completionsFromSaved(null)).toEqual({});
    expect(completionsFromSaved('nope')).toEqual({});
  });
});

describe('backfilledBadgesFromQuestState (v1.1 server source)', () => {
  const questState = {
    'shepherd-park': {
      'duck-roundup': { shared: 3, users: { 'u1': { count: 3, completed: true }, 'u2': { count: 1, completed: false } } },
    },
    'agora-houston': {
      'cat-cuddles': { shared: 3, users: { 'u1': { count: 3, completed: true } } },
      'golden-key': { shared: 0, users: { 'u1': { count: 0, completed: false } } },
    },
  };

  it('lists quests the server remembers this player finishing, across rooms', () => {
    expect(backfilledBadgesFromQuestState(questState, 'u1')).toEqual([
      { questId: 'duck-roundup', completedAt: null },
      { questId: 'cat-cuddles', completedAt: null },
    ]);
  });

  it('returns nothing for a player with no completions, or junk input', () => {
    expect(backfilledBadgesFromQuestState(questState, 'u2')).toEqual([]);
    expect(backfilledBadgesFromQuestState(questState, null)).toEqual([]);
    expect(backfilledBadgesFromQuestState(null, 'u1')).toEqual([]);
  });
});
