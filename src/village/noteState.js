// noteState.js — pick-up notes, shared version (Pick-Up Notes v1,
// `sq-pickup-notes-v1`).
//
// Pure logic, no Phaser and no Node APIs, so BOTH sides import it:
//   - server/socket.js (canonical room state, validates every drop
//     and removal)
//   - src/village/NoteSystem.js (local state + instant feedback)
//
// A player writes a note (up to 280 characters) and leaves it on
// the floor where they are standing. The note stays in the room
// and ANYONE can pick it up and read it, repeatedly — it does NOT
// disappear after one read. It fades away on its own after 48
// hours, even across restarts (the server prunes expired notes on
// load and on every touch; the client also filters them on render).
//
// ANONYMOUS (user decision, Nov 26, 2026): no author name is shown
// to any reader, ever. The server still stores the author's id —
// it needs it for the "writer can delete their own note" gate —
// but the wire state carries NO authorId and NO authorName, and the
// read popup shows only the text and how long until it fades. The
// writer knows which notes are theirs because the client remembers
// the ids it dropped (NoteSystem._myNoteIds, localStorage-backed);
// the server re-checks authorship on every delete, so a bad
// client cannot delete what is not theirs.
//
// NO CAP (user decision, Nov 26, 2026): there is no per-room limit
// for now. A room holds as many notes as people leave. One can be
// added later if rooms get cluttered.
//
// NUMBERS THE USER DID NOT DECIDE (picked here, documented):
//   - NOTE_TTL_MS = 48h: a note fades away 48 hours after it is
//     left. Stored as createdAt; expiresAt is derived, never
//     stored separately.
//   - NOTE_TEXT_MAX = 280: overlong text is trimmed to 280, like
//     the notice board trims flyer text — never refused for length.
//   - Writing is free (no coins). Notes are world objects, NOT
//     inventory items — writing one takes no pocket slot, and a
//     note never goes into anyone's pocket.
//
// NOTES MODERATION v1 (`sq-notes-moderation-v1`): notes are public
// and anonymous, so they are the easiest place in the game to be
// nasty. Two guards:
//   (1) REPORT + AUTO-HIDE: any player can flag a note (the
//       author cannot flag their own, one flag per player). At
//       NOTE_FLAG_HIDE_THRESHOLD flags from different players the
//       note hides itself — it leaves the floor and cannot be read
//       by non-moderators — and waits in storage for a moderator
//       to restore (flags cleared, back on the floor) or delete.
//       Moderators see flagged/hidden notes in a review list that
//       DOES show the author id (moderators only — the wire state
//       never carries it).
//   (2) PERSPECTIVE CHECK: the server asks Google Perspective
//       whether the text is toxic before it is placed (see
//       server/perspectiveCheck.js) and refuses hurtful text.
//       That check fails OPEN with no key or a down API; the
//       report system is the backstop.
//   - NOTE_FLAG_HIDE_THRESHOLD = 3 flags from 3 different players
//     (builder default — change it here and the server follows).

export const NOTE_MARKER = 'sq-pickup-notes-v1';
export const NOTE_MODERATION_MARKER = 'sq-notes-moderation-v1';
export const NOTE_FLAG_HIDE_THRESHOLD = 3;
export const NOTE_TEXT_MAX = 280;
// 48 hours, in ms. A note left Monday at noon is gone by
// Wednesday at noon, even if the server restarted in between.
export const NOTE_TTL_MS = 48 * 60 * 60 * 1000;

/** A note: { id, text, authorId, x, y, createdAt, flaggedBy, hidden }.
 * `authorId` is the writer's user id (their email, or their
 * socket id for a guest — never 'guest' itself, since every guest
 * shares that id). It lives ONLY in the server's canonical state
 * and in the storage serialization; the wire serialization strips
 * it, so no reader can ever learn who wrote a note. `expiresAt`
 * is derived (createdAt + NOTE_TTL_MS) wherever it is needed.
 * `flaggedBy` (sq-notes-moderation-v1) is the list of player ids
 * who reported this note — one flag per player, the author never
 * included. `hidden` is true once the note reached
 * NOTE_FLAG_HIDE_THRESHOLD flags: it leaves the floor and cannot
 * be read by non-moderators until a moderator restores it. Both
 * live in the storage serialization and in the moderator-only
 * flagged list; the wire state carries neither. */
export function createNoteState() {
  return {
    notes: [], // oldest first
  };
}

export function noteExpiresAt(note) {
  return (Number(note?.createdAt) || 0) + NOTE_TTL_MS;
}

export function isNoteExpired(note, now = Date.now()) {
  return noteExpiresAt(note) <= (Number(now) || Date.now());
}

/** Clean a note payload the way the server accepts it. Returns
 * the cleaned note or null when it has no usable text. Text is
 * trimmed and sliced to NOTE_TEXT_MAX (overlong text is trimmed,
 * never refused); a missing id is generated; a bad position
 * repairs to the room's middle; a bad createdAt repairs to now. */
export function cleanNote(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const text = String(r.text || '').trim().slice(0, NOTE_TEXT_MAX);
  if (!text) return null;
  // A missing coordinate repairs to the room's middle. null /
  // undefined / '' count as missing — Number(null) is 0, which
  // would otherwise pin the note to the room's top edge.
  const numOr = (v, fallback) => {
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    id: String(r.id || '').trim()
      || `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    authorId: String(r.authorId || ''),
    x: numOr(r.x, 800),
    y: numOr(r.y, 450),
    createdAt: numOr(r.createdAt, Date.now()),
    // sq-notes-moderation-v1: flags and hidden survive a restart
    // through the storage serialization (parseNoteState below) —
    // a restart must never un-hide a flagged note. flaggedBy is
    // deduped here, so a stored row can never carry the same
    // player twice.
    flaggedBy: Array.isArray(r.flaggedBy)
      ? [...new Set(r.flaggedBy.map((v) => String(v)).filter(Boolean))]
      : [],
    hidden: Boolean(r.hidden),
  };
}

/**
 * Leave a note on the floor. Returns { ok, note?, reason? }.
 * Fails on empty text ('empty-note') or a duplicate id
 * ('duplicate'). There is NO per-room cap (user decision) — a
 * room holds as many notes as people leave.
 */
export function dropNote(state, raw) {
  const note = cleanNote(raw);
  if (!note) return { ok: false, reason: 'empty-note' };
  const list = state.notes || (state.notes = []);
  if (list.some((n) => n.id === note.id)) return { ok: false, reason: 'duplicate' };
  list.push(note);
  return { ok: true, note };
}

/** May this user take this note down? The writer, or any note
 * for a moderator. The server re-checks this — never trust the
 * client. A blank userId can never be the writer. */
export function canRemoveNote(note, userId, isModerator) {
  if (!note) return false;
  if (isModerator) return true;
  return Boolean(userId) && String(note.authorId) === String(userId);
}

/**
 * Take a note down. Returns { ok, note?, reason? } — reason is
 * 'not-found' or 'not-allowed'.
 */
export function removeNote(state, noteId, userId, isModerator) {
  const list = state.notes || (state.notes = []);
  const idx = list.findIndex((n) => n.id === String(noteId));
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const note = list[idx];
  if (!canRemoveNote(note, userId, isModerator)) return { ok: false, reason: 'not-allowed' };
  list.splice(idx, 1);
  return { ok: true, note };
}

// ---- notes moderation (`sq-notes-moderation-v1`) -------------------------

/** How many different players have flagged this note. */
export function noteFlagCount(note) {
  return Array.isArray(note?.flaggedBy) ? note.flaggedBy.length : 0;
}

/**
 * Report a note. Returns { ok, note?, flagCount?, hidden?, reason? }.
 * Reasons: 'not-found', 'own-note' (the author cannot report
 * their own note — reporting yourself would be a way to hide your
 * own note on demand), 'already-flagged' (one flag per player).
 * On success the player's id joins flaggedBy; when the count
 * reaches NOTE_FLAG_HIDE_THRESHOLD the note hides itself. A note
 * that is already hidden can still be flagged (more evidence for
 * the moderator) — hidden stays true.
 */
export function flagNote(state, noteId, userId) {
  const list = state.notes || (state.notes = []);
  const note = list.find((n) => n.id === String(noteId));
  if (!note) return { ok: false, reason: 'not-found' };
  const uid = String(userId || '');
  if (!uid) return { ok: false, reason: 'not-allowed' };
  if (String(note.authorId) === uid) return { ok: false, reason: 'own-note' };
  if (!Array.isArray(note.flaggedBy)) note.flaggedBy = [];
  if (note.flaggedBy.some((v) => String(v) === uid)) {
    return { ok: false, reason: 'already-flagged' };
  }
  note.flaggedBy.push(uid);
  if (noteFlagCount(note) >= NOTE_FLAG_HIDE_THRESHOLD) note.hidden = true;
  return { ok: true, note, flagCount: noteFlagCount(note), hidden: Boolean(note.hidden) };
}

/**
 * Restore a flagged/hidden note (moderator only). Clears every
 * flag and unhides it, so it is back on the floor and can be
 * flagged again from scratch. Returns { ok, note?, reason? } —
 * reason is 'not-found' or 'not-allowed'. Idempotent: restoring
 * a note with nothing to clear still succeeds.
 */
export function restoreNote(state, noteId, userId, isModerator) {
  if (!isModerator) return { ok: false, reason: 'not-allowed' };
  const list = state.notes || (state.notes = []);
  const note = list.find((n) => n.id === String(noteId));
  if (!note) return { ok: false, reason: 'not-found' };
  note.flaggedBy = [];
  note.hidden = false;
  return { ok: true, note };
}

/** Drop every note whose 48 hours are up. Returns how many were
 * pruned. The caller persists afterwards when the count is > 0. */
export function pruneExpiredNotes(state, now = Date.now()) {
  const list = state.notes || (state.notes = []);
  const before = list.length;
  const t = Number(now) || Date.now();
  state.notes = list.filter((n) => noteExpiresAt(n) > t);
  return before - state.notes.length;
}

/** Plain JSON copy safe to send over the socket — ANONYMOUS: no
 * authorId, no authorName, nothing that says who wrote it. The
 * client shows only the text and how long until it fades.
 * sq-notes-moderation-v1: a HIDDEN note is left out entirely —
 * it is not on the floor and cannot be read by non-moderators —
 * and flaggedBy never goes over the wire either. `count` is the
 * visible count, matching the list. */
export function serializeNoteState(state) {
  const s = state || createNoteState();
  const visible = (s.notes || []).filter((n) => !n.hidden);
  return {
    notes: visible.map((n) => ({
      id: String(n.id),
      text: String(n.text || ''),
      x: Number(n.x) || 0,
      y: Number(n.y) || 0,
      createdAt: Number(n.createdAt) || 0,
      expiresAt: noteExpiresAt(n),
    })),
    count: visible.length,
  };
}

/** Storage serialization: the same notes WITH authorId, so a
 * restart restores who may delete each note. Only the persist
 * layer uses this — it never goes over the socket.
 * sq-notes-moderation-v1: flaggedBy and hidden are stored too —
 * a restart must never un-hide a flagged note or forget who
 * already flagged it. */
export function serializeNoteStateForStorage(state) {
  const s = state || createNoteState();
  return {
    notes: (s.notes || []).map((n) => ({
      id: String(n.id),
      text: String(n.text || ''),
      authorId: String(n.authorId || ''),
      x: Number(n.x) || 0,
      y: Number(n.y) || 0,
      createdAt: Number(n.createdAt) || 0,
      flaggedBy: Array.isArray(n.flaggedBy) ? [...n.flaggedBy] : [],
      hidden: Boolean(n.hidden),
    })),
    count: (s.notes || []).length,
  };
}

/** Moderator-only review list (sq-notes-moderation-v1): every
 * note that has been flagged at least once, or is hidden. This
 * is the ONE place the author id is ever sent to a client — the
 * response goes only to a moderator (the server gates the
 * request), never to the room. Sorted most-flagged first, then
 * oldest first, so the worst note is on top. */
export function serializeFlaggedNotes(state, roomId) {
  const s = state || createNoteState();
  const flagged = (s.notes || [])
    .filter((n) => noteFlagCount(n) > 0 || n.hidden)
    .map((n) => ({
      id: String(n.id),
      text: String(n.text || ''),
      authorId: String(n.authorId || ''),
      flagCount: noteFlagCount(n),
      hidden: Boolean(n.hidden),
      createdAt: Number(n.createdAt) || 0,
      expiresAt: noteExpiresAt(n),
    }))
    .sort((a, b) => (b.flagCount - a.flagCount) || (a.createdAt - b.createdAt));
  return { roomId: String(roomId || ''), notes: flagged, count: flagged.length };
}

/** Validate an incoming state object (never trust the wire or the
 * row). Expired notes are dropped here too, so a load and a
 * broadcast both prune. authorId is preserved when present (the
 * storage shape) and empty otherwise (the wire shape).
 * sq-notes-moderation-v1: flaggedBy and hidden are preserved the
 * same way — cleanNote carries them — so a restart restores a
 * flagged note exactly as it was. */
export function parseNoteState(raw, now = Date.now()) {
  const s = createNoteState();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.notes)) return s;
  const t = Number(now) || Date.now();
  for (const entry of raw.notes) {
    const note = cleanNote(entry);
    if (!note) continue;
    if (noteExpiresAt(note) <= t) continue;
    if (s.notes.some((n) => n.id === note.id)) continue;
    s.notes.push(note);
  }
  return s;
}
