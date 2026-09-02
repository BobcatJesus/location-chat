import { isWithinRadius } from '../src/geo.js';
import { getDistanceMeters } from '../src/geo.js';

// Pre-defined GPS-anchored locations
export const ROOMS = [
  {
    id: 'starbucks-spring',
    name: 'Starbucks 43rd',
    lat: 29.8287,
    lng: -95.4304,
    radiusMeters: 50,
    kind: 'gps',
    contributors: ['system']
  },
  {
    id: 'mcdonalds-practice',
    name: "McDonald's Practice",
    lat: 29.7608,
    lng: -95.3624,
    radiusMeters: 60,
    amenity: 'fast_food',
    tags: {
      name: "McDonald's Practice",
      brand: "McDonald's",
      amenity: 'fast_food',
    },
    kind: 'gps',
    contributors: ['system']
  },
  {
    id: 'md-anderson-library',
    name: 'MD Anderson Library',
    lat: 29.7218,
    lng: -95.3420,
    radiusMeters: 120,
    amenity: 'library',
    buildingLevels: 2,
    source: 'gps+osm',
    placeType: 'university-library',
    roomShape: [
      { lat: 29.7237, lon: -95.3441 },
      { lat: 29.7236, lon: -95.3405 },
      { lat: 29.7228, lon: -95.3401 },
      { lat: 29.7214, lon: -95.3404 },
      { lat: 29.7207, lon: -95.3417 },
      { lat: 29.7208, lon: -95.3438 },
      { lat: 29.7219, lon: -95.3447 },
      { lat: 29.7231, lon: -95.3448 },
    ],
    tags: {
      name: 'MD Anderson Library',
      amenity: 'library',
      building: 'library',
      brand: 'University of Houston',
      operator: 'University of Houston',
      'building:levels': '2',
      'addr:city': 'Houston',
      'addr:state': 'Texas',
      'addr:country': 'US',
      website: 'https://libraries.uh.edu/',
      wikipedia: 'MD Anderson Library',
      campus: 'University of Houston',
      'library:type': 'academic',
      'building:architecture': 'modern-quad',
      'source:geometry': 'gps+osm',
    },
    metadata: {
      campus: 'University of Houston',
      neighborhood: 'University District',
      city: 'Houston',
      state: 'TX',
      country: 'US',
      osmCategory: 'library',
      footprintConfidence: 'approximate',
      osmFootprintSource: 'gps+osm-building-footprint',
      parcelHint: 'UH central library cluster',
      architectureHint: 'central atrium with stack wings',
      circulationPattern: 'lobby -> service desk -> stacks -> reading lounge',
    },
    kind: 'gps',
    contributors: ['system']
  },
  {
    id: 'agora-houston',
    name: 'Agora',
    lat: 29.7429,
    lng: -95.4026,
    radiusMeters: 80,
    buildingLevels: 2,
    tags: {
      name: 'Agora',
      'building:levels': '2',
    },
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
    amenity: 'park',
    kind: 'gps',
    contributors: ['system']
  },
  {
    id: 'shepherd-park',
    name: 'Shepherd Park',
    lat: 29.834235,
    lng: -95.417500,
    radiusMeters: 220,
    amenity: 'park',
    roomShape: [
      { lat: 29.8335422, lon: -95.4186888 },
      { lat: 29.8335639, lon: -95.4163778 },
      { lat: 29.8349965, lon: -95.4163985 },
      { lat: 29.8349885, lon: -95.4182790 },
      { lat: 29.8348102, lon: -95.4182811 },
      { lat: 29.8346319, lon: -95.4183171 },
      { lat: 29.8343713, lon: -95.4184029 },
      { lat: 29.8340191, lon: -95.4185923 },
      { lat: 29.8337291, lon: -95.4186845 },
      { lat: 29.8335422, lon: -95.4186888 },
    ],
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
    // Load rooms owned by this user, invited rooms, and globally visible public rooms.
    const mine = all.filter((r) => r.ownerId === ownerId || r.invitedIds?.includes(ownerId) || r.isPublic === true);
    mine.forEach(r => { if (!USER_CREATED_ROOMS.find(x => x.id === r.id)) USER_CREATED_ROOMS.push(r); });
  } catch {}
}

export function createUserRoom({ id, name, lat, lng, radiusMeters = 50, contributor, ownerId, isPublic = false }) {
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
    isPublic: Boolean(isPublic),
  };
  USER_CREATED_ROOMS.push(room);
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    all.push(room);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
  return room;
}

export function deleteUserRoom(roomId, ownerId) {
  if (!roomId) return false;
  let removed = false;

  for (let i = USER_CREATED_ROOMS.length - 1; i >= 0; i -= 1) {
    const room = USER_CREATED_ROOMS[i];
    const ownerMatches = !ownerId || room.ownerId === ownerId;
    if (room.id === roomId && ownerMatches) {
      USER_CREATED_ROOMS.splice(i, 1);
      removed = true;
    }
  }

  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const next = all.filter((room) => {
      if (room.id !== roomId) return true;
      if (!ownerId) return false;
      return room.ownerId !== ownerId;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}

  return removed;
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


