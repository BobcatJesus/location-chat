export const ZOOM = 17;
export const TILE_SIZE = 256;

/** Convert WGS-84 lat/lng to absolute Mercator world pixels at ZOOM. */
export function latLngToWorld(lat, lng) {
  const n = 1 << ZOOM;
  const x = (lng + 180) / 360 * n * TILE_SIZE;
  const sinLat = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n * TILE_SIZE;
  return { x, y };
}

export function tileUrl(tx, ty) {
  const s = ['a', 'b', 'c'][Math.abs(tx + ty * 3) % 3];
  return `https://${s}.basemaps.cartocdn.com/light_nolabels/${ZOOM}/${tx}/${ty}.png`;
}
