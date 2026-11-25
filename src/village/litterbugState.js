// litterbugState.js — Catch a Litterbug quest v1
// (`sq-litterbug-quest-v1`).
//
// Pure logic, no Phaser and no Node APIs, so BOTH sides import it:
//   - server/socket.js (validates every catch + NPC litter drop)
//   - src/village/FloorLitterSystem.js (freshness, the "!" marker,
//     the catch tap)
//
// THE IDEA: litter is only "fresh" for 15 seconds after the drop —
// while it is fresh it carries a "!" and tapping it CATCHES the
// litterer instead of picking the litter up. The catch works for
// both kinds of litterer: a real player (whose drop went through
// the shared floor litter) and a Shepherd Park NPC (who drops a
// cup on a timer — see the NPC section below). One quest, either
// catch completes it.
//
// FRESHNESS: computed from the entry's droppedAt, which the server
// stamps (a client must not be able to fake when litter dropped).
// The client compares against server time, not its own clock
// alone — serializeFloorLitterState carries `now`, and the client
// keeps the offset (see FloorLitterSystem._now). A few seconds of
// clock wobble either way is harmless: the server re-validates
// every catch, so a client that thinks litter is fresh a moment
// too long just gets a 'stale' answer.
//
// THE CATCH: the litter STAYS on the floor after a catch (catch
// is not cleanup — someone still has to bin it, and the catcher
// can pick it up afterwards). The same litter can be caught by
// more than one witness; the same player catching the same litter
// twice is harmless — quest_progress is idempotent on both sides
// (the client bails on completed quests, the server bails on
// completed users), so nothing double-counts. The litterer loses
// no coins, ever — only a 🚨 LITTERBUG! label for a minute.
//
// NPC LITTERING (Shepherd Park only): the park NPCs are
// client-side layout entities — the server does not track them —
// so each client rolls its own timer (2–5 minutes) and, on a
// roll, reports a drop for a random patrolling NPC at the NPC's
// CURRENT position. The drop goes through the SAME shared-litter
// path as a player drop (droppedBy 'npc:<label>'), so the cup is
// visible to EVERYONE in the room and the catch validation is
// uniform. The server gates it: shepherd-park only, the label
// must be one of the three known patrollers, and a per-NPC
// cooldown (2 minutes) dedupes the many clients rolling at once.
// An NPC cup is a trash-type item ("a dropped coffee cup") —
// picking it up gives a trash item, like trash-can trash.
//
// NUMBERS THE USER DID NOT DECIDE (picked here, documented):
//   - LITTERBUG_CATCH_WINDOW_MS = 15_000: litter is fresh (and
//     catchable) for 15 seconds after the drop.
//   - LITTERBUG_LABEL_MS = 60_000: the 🚨 LITTERBUG! label rides
//     above the litterer for one minute.
//   - LITTERBUG_NPC_COOLDOWN_MS = 120_000: one cup per NPC per
//     2 minutes, server-side — many clients rolling at once can
//     never flood the room.
//   - LITTERBUG_NPC_ROLL_MIN/MAX_MS = 120_000 / 300_000: each
//     client rolls for an NPC drop every 2–5 minutes.

export const LITTERBUG_QUEST_MARKER = 'sq-litterbug-quest-v1';
// Live reference so the marker survives minification (same pattern
// as the puzzle / tree / floor-litter markers).
export const LITTERBUG_MARKER_V1 = 'sq-litterbug-quest-v1';

export const LITTERBUG_QUEST_ID = 'litterbug';
export const LITTERBUG_CATCH_EVENT = 'litterbug-caught';

export const LITTERBUG_CATCH_WINDOW_MS = 15_000;
export const LITTERBUG_LABEL_MS = 60_000;

export const LITTERBUG_NPC_ROOM_ID = 'shepherd-park';
export const LITTERBUG_NPC_LABELS = ['Morning Jogger', 'Park Regular', 'Pond Watcher'];
export const LITTERBUG_NPC_COOLDOWN_MS = 120_000;
export const LITTERBUG_NPC_ROLL_MIN_MS = 120_000;
export const LITTERBUG_NPC_ROLL_MAX_MS = 300_000;

/** The litter snapshot an NPC drop carries (trash-type, so picking
 * it up gives a trash item — same as trash-can trash). */
export const LITTERBUG_NPC_CUP = {
  type: 'trash',
  title: 'a dropped coffee cup',
  label: 'a dropped coffee cup',
};

/** Is this litter entry fresh (still inside the catch window)? */
export function isFreshLitter(entry, now = Date.now()) {
  const at = Number(entry?.droppedAt);
  if (!Number.isFinite(at)) return false;
  const age = Number(now) - at;
  return age >= 0 && age <= LITTERBUG_CATCH_WINDOW_MS;
}

/** Was this entry dropped by an NPC (droppedBy 'npc:<label>')? */
export function isNpcLitter(entry) {
  return String(entry?.droppedBy || '').startsWith('npc:');
}

/** The droppedBy value for an NPC drop. */
export function npcIdForLabel(label) {
  return `npc:${String(label || '')}`;
}

/** Is this label one of the known Shepherd Park patrollers? */
export function isLitterbugNpcLabel(label) {
  return LITTERBUG_NPC_LABELS.includes(String(label || ''));
}

/**
 * Validate a catch against the room's floor-litter state.
 * Returns { ok, entry?, reason? } — reason is 'gone' (no such
 * entry — picked up, claimed, or never there), 'stale' (the
 * window passed), or 'own-litter' (the catcher dropped it).
 * NPC drops can never be self-caught: their droppedBy is
 * 'npc:<label>', never a user id.
 */
export function validateLitterbugCatch(state, litterId, catcherId, now = Date.now()) {
  const items = state?.items || [];
  const entry = items.find((e) => e.id === String(litterId));
  if (!entry) return { ok: false, reason: 'gone' };
  if (!isFreshLitter(entry, now)) return { ok: false, reason: 'stale' };
  if (String(entry.droppedBy || '') === String(catcherId || '')) {
    return { ok: false, reason: 'own-litter' };
  }
  return { ok: true, entry };
}
