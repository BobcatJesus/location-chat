// strikeState.js — Notes Strike System v1
// (`sq-notes-strikes-v1`).
//
// Graduated strikes for pick-up notes, moderator-decided, NEVER
// automatic. Auto-hide (3 flags) hides a note but does NOT strike
// its author — a moderator reviews the flagged note and decides
// whether it earns a strike. That keeps three people from ganging
// up to strike someone over a harmless note.
//
//   Strike 1: the note is removed + the player gets a warning.
//     No mute.
//   Strike 2: the player cannot write notes for 24 hours.
//   Strike 3: the player cannot write notes for 7 days.
// Strikes expire 30 days after they are issued; expired strikes
// do not count. The mute is NOTE-WRITING ONLY — the player can
// still play, chat, and do quests. It targets the tool they
// abused.
//
// NUMBERS THE USER DID NOT DECIDE (picked here, documented):
//   - STRIKE_EXPIRE_MS = 30 days: a strike stops counting a
//     month after it was issued, so one bad note does not follow
//     someone forever.
//   - STRIKE_MUTE_2_MS = 24h, STRIKE_MUTE_3_MS = 7 days: the
//     mute runs from the LATEST strike, so each new strike while
//     at 2+ extends it.
//   - The mute window can run out while the strikes are still
//     active (e.g. 2 strikes, latest 2 days ago): the player can
//     write notes again, but both strikes still count toward the
//     next one until they expire.
//
// GUEST LIMITATION (honest, do not work around it): strikes key
// on authorId — the same id stored on each note. For a signed-in
// player that is their email (stable, so a strike sticks). For a
// guest it is their socket id, which changes on reconnect, so a
// guest can dodge a strike by leaving and coming back. Removal
// and the Perspective content check are still the main levers
// for guests. There is NO IP-based banning in this kit.
//
// Pure logic, no Phaser and no Node APIs, so BOTH sides import
// it: the server (socket.js — strike decisions and the note_drop
// mute enforcement) and the client (NoteSystem — the write-form
// mute display and the client-side drop gate; the server still
// enforces it).

export const STRIKE_MARKER = 'sq-notes-strikes-v1';
// 30 days. A strike stops counting a month after it was issued.
export const STRIKE_EXPIRE_MS = 30 * 24 * 60 * 60 * 1000;
// 24 hours. The 2nd-strike mute.
export const STRIKE_MUTE_2_MS = 24 * 60 * 60 * 1000;
// 7 days. The 3rd-strike mute (and every strike after that).
export const STRIKE_MUTE_3_MS = 7 * 24 * 60 * 60 * 1000;

/** A strike: { playerId, noteId?, struckBy, struckAt, expiresAt }.
 * `playerId` is the struck player's authorId (their email, or
 * their socket id for a guest — see the guest limitation above).
 * `noteId` is the note that earned it (for audit; null when the
 * strike was recorded without a note). `struckBy` is the
 * moderator's id. Times are ms since epoch; `expiresAt` is
 * derived (struckAt + STRIKE_EXPIRE_MS) when it is missing. */
export function cleanStrike(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const playerId = String(r.playerId || '').trim();
  const struckAt = Number(new Date(r.struckAt ?? 0));
  if (!playerId || !Number.isFinite(struckAt) || struckAt <= 0) return null;
  const expiresRaw = r.expiresAt === null || r.expiresAt === undefined
    ? struckAt + STRIKE_EXPIRE_MS
    : Number(new Date(r.expiresAt));
  return {
    playerId,
    noteId: r.noteId ? String(r.noteId) : null,
    struckBy: String(r.struckBy || ''),
    struckAt,
    expiresAt: Number.isFinite(expiresRaw) ? expiresRaw : struckAt + STRIKE_EXPIRE_MS,
  };
}

/** The strikes that still count: expiresAt in the future, oldest
 * first. Malformed entries are dropped. */
export function activeStrikes(strikes, now = Date.now()) {
  const t = Number(now) || Date.now();
  const list = Array.isArray(strikes) ? strikes : [];
  return list
    .map((s) => cleanStrike(s))
    .filter((s) => s && s.expiresAt > t)
    .sort((a, b) => a.struckAt - b.struckAt);
}

/**
 * Is this player muted from writing notes right now?
 * Returns { muted, mutedUntil, activeCount }.
 *   0–1 active strikes: not muted (1 strike is warning-only).
 *   2+ active strikes: muted until the LATEST strike's struckAt
 *     + 24h (2 strikes) or + 7 days (3+ strikes). `muted` is
 *     false once that window has passed, even though the strikes
 *     still count until they expire — so a player whose mute ran
 *     out can write again, but their next strike lands harder.
 * `mutedUntil` is 0 when there is no mute window at all.
 */
export function computeNoteMute(strikes, now = Date.now()) {
  const t = Number(now) || Date.now();
  const active = activeStrikes(strikes, t);
  const activeCount = active.length;
  if (activeCount < 2) return { muted: false, mutedUntil: 0, activeCount };
  const latest = active[activeCount - 1];
  const windowMs = activeCount >= 3 ? STRIKE_MUTE_3_MS : STRIKE_MUTE_2_MS;
  const mutedUntil = latest.struckAt + windowMs;
  return { muted: mutedUntil > t, mutedUntil, activeCount };
}

/** Plain-words wait for a mutedUntil ("in ~30 minutes",
 * "in ~5 hours", "in ~3 days"). Relative only — no raw
 * timestamp, no timezone-dependent date formatting, so the
 * wording is the same on every device and in every test. */
export function muteUntilLabel(mutedUntil, now = Date.now()) {
  const ms = Number(mutedUntil) - (Number(now) || Date.now());
  if (!Number.isFinite(ms) || ms <= 0) return 'already over';
  if (ms < 60 * 60 * 1000) return `in ~${Math.max(1, Math.round(ms / 60000))} minutes`;
  if (ms < 48 * 60 * 60 * 1000) return `in ~${Math.round(ms / 3600000)} hours`;
  return `in ~${Math.round(ms / 86400000)} days`;
}

/** The exact words a muted player sees when they try to leave a
 * note (server sends this verbatim in the note_drop_result, so
 * the client never hardcodes its own copy). */
export function mutedRefusalMessage(mutedUntil, now = Date.now()) {
  return `📝 You can't leave notes right now — your notes were removed for breaking the rules. Try again ${muteUntilLabel(mutedUntil, now)}.`;
}

/**
 * The exact words a struck player sees (server sends this
 * verbatim in the note_strike_notice, so the client never
 * hardcodes its own copy). Strike 1 is a warning with no mute;
 * strike 2 names the 24h mute; strike 3+ names the 7-day mute.
 */
export function strikeNoticeMessage({ strikeCount, muted, mutedUntil } = {}, now = Date.now()) {
  const n = Number(strikeCount) || 1;
  if (n <= 1) {
    return '⚠️ A moderator removed one of your notes for breaking the rules. That’s strike 1 — a warning. Another strike could stop you leaving notes for a while.';
  }
  const days = n >= 3 ? '7 days' : '24 hours';
  const when = muted && Number(mutedUntil) > 0
    ? ` Try again ${muteUntilLabel(mutedUntil, now)}.`
    : '';
  return `⚠️ A moderator removed one of your notes for breaking the rules. That’s strike ${n} — you can’t leave notes for ${days}.${when}`;
}

/** The exact words a player sees when a moderator clears their
 * strikes (server sends this verbatim in the note_strike_notice,
 * so the client never hardcodes its own copy). */
export const STRIKES_CLEARED_MESSAGE = '✅ Your note strikes were cleared — you can leave notes again.';
