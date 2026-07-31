/**
 * Calculates distance in meters between two lat/lng coordinates (Haversine formula)
 */
export function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Checks if user coordinates fall within radius
 */
export function isWithinRadius(userLat, userLng, targetLat, targetLng, radiusMeters) {
  const distance = getDistanceMeters(userLat, userLng, targetLat, targetLng);
  return distance <= radiusMeters;
}
