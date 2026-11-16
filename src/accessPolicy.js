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
  // Your Place (Your Place v1, `sq-your-place-v1`): a personal home
  // room (`home-<owner>`) is always open to its owner — no GPS gate,
  // no OSM strict block. The server still enforces owner-only access
  // on join (join_denied for anyone else), so this only removes the
  // client-side gates, never the access control itself.
  if (id.startsWith('home-')) return true;
  return openAccessRoomIds.has(id);
}

export function getRoomAccessRadius(room = {}) {
  const radius = Number(room.radiusMeters ?? room.radius);
  return Number.isFinite(radius) && radius > 0 ? radius : null;
}

export function requiresGpsProximity(room = {}) {
  return !isOpenAccessRoom(room.id) && Boolean(getRoomAccessRadius(room));
}