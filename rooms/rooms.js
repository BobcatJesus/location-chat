import { isWithinRadius } from '../src/geo.js';
import { getDistanceMeters } from '../src/geo.js';

// Pre-defined GPS-anchored locations
export const ROOMS = [
  {
    id: 'starbucks-spring',
    name: 'Starbucks',
    lat: 29.8287,
    lng: -95.4304,
    radiusMeters: 50,
    kind: 'gps',
    contributors: ['system']
  },
  {
    id: 'agora-houston',
    name: 'Agora',
    lat: 29.7429,
    lng: -95.4026,
    radiusMeters: 80,
    kind: 'gps',
    contributors: ['system']
  },
  {
    id: 'downtown-hub',
    name: 'Downtown Plaza',
    lat: 29.7604,
    lng: -95.3698,
    radiusMeters: 200,
    kind: 'gps',
    contributors: ['system']
  },
  {
    id: 'forest-gate',
    name: 'Forest Gate',
    lat: 29.7630,
    lng: -95.3720,
    radiusMeters: 180,
    kind: 'gps',
    contributors: ['system']
  },
  {
    id: 'sunset-temple',
    name: 'Sunset Temple',
    lat: 29.7585,
    lng: -95.3670,
    radiusMeters: 180,
    kind: 'gps',
    contributors: ['system']
  }
];

// User-created rooms — private by default, persisted in localStorage per owner
export const USER_CREATED_ROOMS = [];

const STORAGE_KEY = 'sidequest_user_rooms';

export function loadUserRooms(ownerId) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    // Load rooms owned by this user OR shared via invite that they accepted
    const mine = all.filter(r => r.ownerId === ownerId || r.invitedIds?.includes(ownerId));
    mine.forEach(r => { if (!USER_CREATED_ROOMS.find(x => x.id === r.id)) USER_CREATED_ROOMS.push(r); });
  } catch {}
}

export function createUserRoom({ id, name, lat, lng, radiusMeters = 50, contributor, ownerId }) {
  const room = {
    id,
    name,
    lat,
    lng,
    radiusMeters,
    kind: 'user-created',
    contributors: contributor ? [contributor] : ['anonymous'],
    ownerId: ownerId || 'unknown',
    invitedIds: [],
  };
  USER_CREATED_ROOMS.push(room);
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    all.push(room);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
  return room;
}

// Accept a room shared via invite link and add it to this user's visible rooms
export function acceptRoomInvite(room, ownerId) {
  if (USER_CREATED_ROOMS.find(r => r.id === room.id)) return;
  USER_CREATED_ROOMS.push(room);
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!all.find(r => r.id === room.id)) {
      all.push({ ...room, invitedIds: [ownerId] });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }
  } catch {}
}

export function getAllRooms() {
  return [...ROOMS, ...USER_CREATED_ROOMS];
}

/**
 * Matches user coordinates to the first eligible location room.
 */
export function getRoomForCoordinates(userLat, userLng) {
  return getAllRooms().find((room) => isWithinRadius(userLat, userLng, room.lat, room.lng, room.radiusMeters)) || null;
}



/**
 * Finds the room matching the user's GPS coordinates
 */
export function findRoomByLocation(userLat, userLng) {
  const allRooms = getAllRooms();

  for (const room of allRooms) {
    const distance = getDistanceMeters(userLat, userLng, room.lat, room.lng);

    if (distance <= room.radiusMeters) {
      return { room, distance: Math.round(distance) };
    }
  }

  return null;
}


