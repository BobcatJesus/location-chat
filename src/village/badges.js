// badges.js — Quest Completions / Badges v1 (`sq-quest-badges-v1`).
//
// One badge per completed quest. A badge is earned once, ever —
// completing the same quest again (or the puzzle finishing another
// round) never duplicates it. The badge list is the player's record
// of finished quests: the 7 solo quests in quests.js, plus the
// shared Group Puzzle (which is not a QuestManager quest — it lives
// in PuzzleQuest.js, so its badge def lives here, not in quests.js),
// the Trim the Tree group quest, and the repeatable Hungry Cat
// quest (also not a QuestManager quest — see catHunger.js).
//
// Coffee purchases are quest STEPS, not badges: buying a coffee adds
// to the Coffee Quest's progress, and only completing that quest
// (buy 3, when it exists) earns its badge.
//
// Backfill v1.1 (`sq-quest-badges-v1-1`): a quest finished BEFORE
// badges existed still earns its badge. Two recovery paths:
//   1. The client's own record — QuestManager's localStorage saved
//      record already knows which quests are finished
//      (completionsFromSaved), so loading the game after the kit
//      turns every pre-existing completion into a badge.
//   2. The server's own record — its in-memory quest-progress store
//      remembers completions the client's localStorage lost (another
//      browser, cleared storage). backfilledBadgesFromQuestState
//      lists them; server/socket.js awards them from badges_sync /
//      get_badges / join_room. Only completions since the last server
//      restart can be recovered this way.
// A backfilled badge with no stored finish time keeps an UNKNOWN
// timestamp (null) and the list shows "Completed" — never a made-up
// date. A real timestamp, when one exists anywhere, always beats
// null; the earliest real timestamp wins.
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
import { HUNGRY_CAT_QUEST_ID } from './catHunger.js';

// Landing marker for the v1 kit check.
export const BADGES_MARKER_V1 = 'sq-quest-badges-v1';

// Landing marker for the v1.1 backfill kit check.
export const BADGES_BACKFILL_MARKER_V1_1 = 'sq-quest-badges-v1-1';

/** The shared Group Puzzle's badge — not a QuestManager quest, so
 *  its def lives here. id must match what PuzzleQuest and the
 *  server use ('group-puzzle'). */
export const GROUP_PUZZLE_BADGE = {
  id: 'group-puzzle',
  title: 'The Cat Puzzle',
  description: 'Help finish the shared cat puzzle in Agora.',
  emoji: '🧩',
};

/** The Trim the Tree badge — not a QuestManager quest either (the
 *  tree is a shared group quest like the puzzle, so its def lives
 *  here). id must match what TrimTreeQuest and the server use
 *  ('trim-tree'). Earned once ever for helping finish either tree. */
export const TRIM_TREE_BADGE = {
  id: 'trim-tree',
  title: 'Trim the Tree',
  description: 'Help trim a Christmas tree in Agora.',
  emoji: '🎄',
};

/** The Christmas Lights badge — Christmas Lights v1
 *  (`sq-christmas-lights-v1`): not a QuestManager quest either
 *  (the lights are a shared group quest like the tree and the
 *  puzzle, so its def lives here). id must match what
 *  ChristmasLightsQuest and the server use ('christmas-lights').
 *  Earned once ever for helping light the Agora. */
export const CHRISTMAS_LIGHTS_BADGE = {
  id: 'christmas-lights',
  title: 'Christmas Lights',
  description: 'Help light up the Agora for Christmas.',
  emoji: '💡',
};

/** The Build a Snowman badge — Build a Snowman v1
 *  (`sq-build-snowman-v1`): not a QuestManager quest either
 *  (the snowman is a shared group quest like the tree and the
 *  lights, so its def lives here). id must match what
 *  SnowmanQuest and the server use ('build-a-snowman').
 *  Earned once ever for helping build the snowman in Shepherd
 *  Park. */
export const BUILD_A_SNOWMAN_BADGE = {
  id: 'build-a-snowman',
  title: 'Build a Snowman',
  description: 'Help build a snowman in Shepherd Park.',
  emoji: '⛄',
};

/** The Hungry Cat badge — Hungry Cat v1 (`sq-hungry-cat-v1`): not
 *  a QuestManager quest either (the hunger quest is repeatable,
 *  twice a day, so it lives outside the one-time quest flow — see
 *  catHunger.js and QuestManager's recordHungryCatCompletion). id
 *  must match what the server uses ('hungry-cat'). Earned once
 *  ever, on the FIRST hungry feeding; the +3 coins still come
 *  every window after that. */
export const HUNGRY_CAT_BADGE = {
  id: HUNGRY_CAT_QUEST_ID,
  title: 'Feed the Hungry Cat',
  description: 'Feed the cafe cat when she is hungry.',
  emoji: '🐱',
};

/** Every quest id that can earn a badge (solo quests + group puzzle + trim the tree). */
export const BADGE_QUEST_IDS = [
  ...QUESTS.map((q) => q.id),
  GROUP_PUZZLE_BADGE.id,
  TRIM_TREE_BADGE.id,
  // Lights badge display fix (sq-lights-badge-fix-v1): the def
  // existed but this id was missing from the list (and from
  // getBadgeDef below), so an earned lights badge never rendered.
  CHRISTMAS_LIGHTS_BADGE.id,
  BUILD_A_SNOWMAN_BADGE.id,
  HUNGRY_CAT_BADGE.id,
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
  if (questId === TRIM_TREE_BADGE.id) return { ...TRIM_TREE_BADGE };
  if (questId === CHRISTMAS_LIGHTS_BADGE.id) return { ...CHRISTMAS_LIGHTS_BADGE };
  if (questId === BUILD_A_SNOWMAN_BADGE.id) return { ...BUILD_A_SNOWMAN_BADGE };
  if (questId === HUNGRY_CAT_BADGE.id) return { ...HUNGRY_CAT_BADGE };
  const q = getQuest(questId);
  if (!q) return null;
  return {
    id: q.id,
    title: q.title,
    description: q.description,
    emoji: q.emoji,
  };
}

/** A completions map is { [questId]: completedAt | null } (ms epoch,
 *  or null when the finish time is unknown). Normalize anything
 *  wire-shaped into that map, dropping unknown ids. A missing or
 *  unparseable timestamp stays UNKNOWN (null) — the list shows
 *  "Completed" for it. Never invent a date: a badge backfilled from
 *  an old save must not claim it was earned today. */
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
    const ts = Number.isFinite(Number(at)) && Number(at) > 0 ? Number(at) : null;
    // Earliest REAL completion wins — a badge is earned once, ever.
    // A real timestamp beats an unknown one; unknown stays unknown.
    if (!(id in out)) out[id] = ts;
    else if (out[id] == null && ts != null) out[id] = ts;
    else if (out[id] != null && ts != null && ts < out[id]) out[id] = ts;
  }
  return out;
}

/** Backfill source (Quest Badges v1.1): turn a QuestManager saved
 *  record ({ [questId]: { count, completed, completedAt } }) into
 *  the completions map { [questId]: completedAt | null }. Every
 *  entry with completed: true is a badge — including quests finished
 *  BEFORE badges existed, which is the whole point of the backfill.
 *  The stored finish time is used when one exists; otherwise the
 *  timestamp is null and the list shows "Completed" (never a made-up
 *  date). Unknown quest ids pass through here and are filtered by
 *  normalizeBadgeMap / getBadgeDef downstream. */
export function completionsFromSaved(saved) {
  const out = {};
  if (!saved || typeof saved !== 'object') return out;
  for (const [id, entry] of Object.entries(saved)) {
    if (!entry?.completed) continue;
    const at = entry.completedAt;
    out[id] = Number.isFinite(Number(at)) && Number(at) > 0 ? Number(at) : null;
  }
  return out;
}

/** Backfill source (Quest Badges v1.1, server side): scan the
 *  server's own quest-progress store (questState[roomId][questId].
 *  users[userId].completed) and list the quests it remembers this
 *  player finishing, across ALL rooms. The server never recorded
 *  WHEN a quest finished, so completedAt is null ("Completed").
 *  Returns [{ questId, completedAt: null }]. Pure — the server
 *  (server/socket.js) calls this from badges_sync / get_badges /
 *  join_room, so completions the client's localStorage lost (another
 *  browser, cleared storage) still come back as badges. Only
 *  completions since the last server restart can be recovered this
 *  way — the store is in-memory. */
export function backfilledBadgesFromQuestState(questState, userId) {
  const out = [];
  if (!questState || typeof questState !== 'object' || !userId) return out;
  for (const room of Object.values(questState)) {
    if (!room || typeof room !== 'object') continue;
    for (const [questId, q] of Object.entries(room)) {
      if (!isBadgeQuestId(questId)) continue;
      if (q?.users?.[userId]?.completed) out.push({ questId, completedAt: null });
    }
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
  list.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)); // newest first, unknown dates last
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
