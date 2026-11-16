// badges.test.js — Quest Completions / Badges v1
// (`sq-quest-badges-v1`). Pure logic only: defs, merge, list, dates.

import { describe, it, expect } from 'vitest';
import {
  BADGES_MARKER_V1,
  GROUP_PUZZLE_BADGE,
  BADGE_QUEST_IDS,
  isBadgeQuestId,
  getBadgeDef,
  normalizeBadgeMap,
  mergeBadgeMaps,
  badgeListFrom,
  formatBadgeDate,
} from '../src/village/badges.js';

describe('badge defs', () => {
  it('carries the v1 marker', () => {
    expect(BADGES_MARKER_V1).toBe('sq-quest-badges-v1');
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
  });

  it('resolves the group puzzle def (not a QuestManager quest)', () => {
    const def = getBadgeDef('group-puzzle');
    expect(def).toMatchObject({ id: 'group-puzzle', emoji: '🧩' });
    expect(def.title).toBe(GROUP_PUZZLE_BADGE.title);
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
    const withIds = normalizeBadgeMap(['duck-roundup']);
    expect(Object.keys(withIds)).toEqual(['duck-roundup']);
    expect(withIds['duck-roundup']).toBeGreaterThan(0);
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
