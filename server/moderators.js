// moderators.js — global-moderator permission logic, pure and
// side-effect-free so it can be unit-tested.
//
// sq-head-moderator-v1: server/socket.js starts listening on import
// and cannot be imported in a test, so the permission predicate lives
// here and socket.js imports it. The logic is byte-for-byte the
// behaviour socket.js had inline, plus one addition: the app owner's
// email is always a global moderator ("head moderator"), so the owner
// can manage any room even when the MODERATOR_EMAILS env var is
// unset. The env-var mechanism is unchanged — env emails still work
// exactly as before, and nothing else is granted (in particular never
// 'guest': every guest shares one id, so granting it would make every
// guest a moderator).

// The app owner (Thomas Kelleher). This is his public client-facing
// contact email; it is normalized the same way as env-var emails, so
// case never matters.
export const OWNER_MODERATOR_EMAIL = 'tfkelleher3@gmail.com';

export function normalizeActorId(value) {
  return String(value || '').trim().toLowerCase();
}

// Build the global moderator set: MODERATOR_EMAILS env var
// (comma-separated, trimmed, lowercased, empties dropped) PLUS the
// app owner's email. The env-var parsing is exactly what socket.js
// did inline before this extraction.
export function buildModeratorEmails(envValue) {
  const emails = new Set(
    String(envValue || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
  emails.add(normalizeActorId(OWNER_MODERATOR_EMAIL));
  return emails;
}

export function isGlobalModerator(actorId, moderatorEmails) {
  return moderatorEmails.has(normalizeActorId(actorId));
}

// Pure permission predicate. getVenueOwnerId is injected because it
// reads the room list (socket.js passes its own, which looks the room
// up in getAllRooms and returns its ownerId/creator, '' when the room
// has none — e.g. the Agora is system-owned, so isOwner is false for
// everyone there and only a global moderator can manage it).
export function getVenuePermissions(roomId, actorId, moderatorEmails, getVenueOwnerId) {
  const actor = normalizeActorId(actorId);
  const isModerator = moderatorEmails.has(actor);
  const isOwner = Boolean(actor && actor === getVenueOwnerId(roomId));
  return { isModerator, isOwner, canManage: isModerator || isOwner };
}
