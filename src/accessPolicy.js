export const OPEN_ACCESS_ROOM_IDS = Object.freeze([
  'md-anderson-library',
  'shepherd-park',
  'asgard-games',
  'lolas-depot',
  'agora-houston',
]);

const openAccessRoomIds = new Set(OPEN_ACCESS_ROOM_IDS);

export function isOpenAccessRoom(roomId) {
  const id = String(roomId || '');
  // Two Places v1 (`sq-two-places-v1`): the `home-` exemption is
  // GONE. A personal place is a real location now — you can only
  // enter it by being next to it on the map (GPS proximity, like
  // any other place). The server still enforces owner-only access
  // on join (join_denied for anyone else), so removing this only
  // adds the client-side GPS gate, never weakens access control.
  return openAccessRoomIds.has(id);
}

export function getRoomAccessRadius(room = {}) {
  const radius = Number(room.radiusMeters ?? room.radius);
  return Number.isFinite(radius) && radius > 0 ? radius : null;
}

export function requiresGpsProximity(room = {}) {
  return !isOpenAccessRoom(room.id) && Boolean(getRoomAccessRadius(room));
}