// badges.js — Quest Completions / Badges v1 (`sq-quest-badges-v1`).
//
// One badge per completed quest. A badge is earned once, ever —
// completing the same quest again (or the puzzle finishing another
// round) never duplicates it. The badge list is the player's record
// of finished quests: the 7 solo quests in quests.js, plus the
// shared Group Puzzle (which is not a QuestManager quest — it lives
// in PuzzleQuest.js, so its badge def lives here, not in quests.js).
//
// Coffee purchases are quest STEPS, not badges: buying a coffee adds
// to the Coffee Quest's progress, and only completing that quest
// (buy 3, when it exists) earns its badge.
//
// This module is pure (no Phaser, no socket, no localStorage) so the
// merge / list logic is unit-testable. The client keeps its own
// record in QuestManager (localStorage, same profile scoping as
// quest progress); the server keeps a per-player copy (in-memory,
// server/socket.js `userBadges`) so other players can see your
// badges. A server restart wipes the server's copy, but the client
// re-syncs its own record on connect (badges_sync), so badges come
// back.

import { QUESTS, getQuest } from './quests.js';

// Landing marker for the v1 kit check.
export const BADGES_MARKER_V1 = 'sq-quest-badges-v1';

/** The shared Group Puzzle's badge — not a QuestManager quest, so
 *  its def lives here. id must match what PuzzleQuest and the
 *  server use ('group-puzzle'). */
export const GROUP_PUZZLE_BADGE = {
  id: 'group-puzzle',
  title: 'The Cat Puzzle',
  description: 'Help finish the shared cat puzzle in Agora.',
  emoji: '🧩',
};

/** Every quest id that can earn a badge (solo quests + group puzzle). */
export const BADGE_QUEST_IDS = [
  ...QUESTS.map((q) => q.id),
  GROUP_PUZZLE_BADGE.id,
];

const BADGE_ID_SET = new Set(BADGE_QUEST_IDS);

/** Is this a quest id that can earn a badge? (Server + client
 *  validation — a bad client can't invent badges.) */
export function isBadgeQuestId(questId) {
  return typeof questId === 'string' && BADGE_ID_SET.has(questId);
}

/** Badge def for a quest id: { id, title, description, emoji }, or
 *  null for an unknown id. */
export function getBadgeDef(questId) {
  if (questId === GROUP_PUZZLE_BADGE.id) return { ...GROUP_PUZZLE_BADGE };
  const q = getQuest(questId);
  if (!q) return null;
  return {
    id: q.id,
    title: q.title,
    description: q.description,
    emoji: q.emoji,
  };
}

/** A completions map is { [questId]: completedAt } (ms epoch).
 *  Normalize anything wire-shaped into that map, dropping unknown
 *  ids and unparseable timestamps (unknown timestamps become now). */
export function normalizeBadgeMap(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  let entries;
  if (Array.isArray(input)) {
    entries = input.map((b) => {
      if (typeof b === 'string') return [b, null];
      if (Array.isArray(b)) return [b[0], b[1]];
      return [b?.questId, b?.completedAt];
    });
  } else {
    entries = Object.entries(input);
  }
  for (const [id, at] of entries) {
    if (!isBadgeQuestId(id)) continue;
    const ts = Number.isFinite(Number(at)) && Number(at) > 0 ? Number(at) : Date.now();
    // Earliest completion wins — a badge is earned once, ever.
    if (!out[id] || ts < out[id]) out[id] = ts;
  }
  return out;
}

/** Merge two completions maps (earliest timestamp wins per quest). */
export function mergeBadgeMaps(a, b) {
  return normalizeBadgeMap([
    ...Object.entries(a || {}),
    ...Object.entries(b || {}),
  ]);
}

/** Turn a completions map into the display list, newest first:
 *  [{ questId, emoji, title, description, completedAt }]. Unknown
 *  ids are skipped (a quest removed since the badge was earned). */
export function badgeListFrom(completions) {
  const map = normalizeBadgeMap(completions);
  const list = [];
  for (const [questId, completedAt] of Object.entries(map)) {
    const def = getBadgeDef(questId);
    if (!def) continue;
    list.push({ ...def, questId, completedAt });
  }
  list.sort((a, b) => b.completedAt - a.completedAt);
  return list;
}

/** Short date for a badge ("Nov 16, 2026"). No time — the day is
 *  the part worth showing. Falls back to "Completed" for a missing
 *  or unparseable timestamp. */
export function formatBadgeDate(completedAt) {
  try {
    if (completedAt === null || completedAt === undefined || completedAt === '') {
      return 'Completed';
    }
    const d = new Date(Number(completedAt));
    if (Number.isNaN(d.getTime())) return 'Completed';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'Completed';
  }
}
