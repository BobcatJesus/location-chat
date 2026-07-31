import { isWithinRadius } from '../utils/geo.js';

// Pre-defined GPS-anchored locations
export const ROOMS = [
  {
    id: 'downtown-hub',
    name: 'Downtown Plaza',
    lat: 29.7604,
    lng: -95.3698,
    radiusMeters: 200 // User must be within 200m to join
  }
];

/**
 * Matches user coordinates to the first eligible location room.
 */
export function getRoomForCoordinates(userLat, userLng) {
  const matchedRoom = ROOMS.find(room => 
    isWithinRadius(userLat, userLng, room.lat, room.lng, room.radiusMeters)
  );

  return matchedRoom || null;
}
