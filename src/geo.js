/**
 * Calculates distance in meters between two lat/lng coordinates (Haversine formula)
 */


/**
 * Checks if user coordinates fall within radius
 */
export function isWithinRadius(userLat, userLng, targetLat, targetLng, radiusMeters) {
  const distance = getDistanceMeters(userLat, userLng, targetLat, targetLng);
  return distance <= radiusMeters;
}
/**
 * Calculates distance between two GPS points in meters
 */
export function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
}
