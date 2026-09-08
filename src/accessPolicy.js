export const OPEN_ACCESS_ROOM_IDS = Object.freeze([
  'md-anderson-library',
  'shepherd-park',
]);

const openAccessRoomIds = new Set(OPEN_ACCESS_ROOM_IDS);

export function isOpenAccessRoom(roomId) {
  return openAccessRoomIds.has(String(roomId || ''));
}

export function getRoomAccessRadius(room = {}) {
  const radius = Number(room.radiusMeters ?? room.radius);
  return Number.isFinite(radius) && radius > 0 ? radius : null;
}

export function requiresGpsProximity(room = {}) {
  return !isOpenAccessRoom(room.id) && Boolean(getRoomAccessRadius(room));
}