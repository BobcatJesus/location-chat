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
    radiusMeters: 40,
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

// User-created rooms can be anchored to a GPS position and enriched by contributors.
export const USER_CREATED_ROOMS = [
  {
    id: 'campfire-circle',
    name: 'Campfire Circle',
    lat: 29.7612,
    lng: -95.3710,
    radiusMeters: 90,
    kind: 'user-created',
    contributors: ['guest']
  }
];

export function createUserRoom({ id, name, lat, lng, radiusMeters = 50, contributor }) {
  const room = {
    id,
    name,
    lat,
    lng,
    radiusMeters,
    kind: 'user-created',
    contributors: contributor ? [contributor] : ['anonymous']
  };

  USER_CREATED_ROOMS.push(room);
  return room;
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


