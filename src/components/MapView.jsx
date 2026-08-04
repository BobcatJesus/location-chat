import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getDistanceMeters } from '../geo';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Map OpenStreetMap amenity/tag → emoji + colour
const POI_TYPES = [
  { tag: 'amenity', value: 'cafe',          emoji: '☕', color: '#00704a', label: 'Café' },
  { tag: 'amenity', value: 'restaurant',    emoji: '🍽️', color: '#f59e0b', label: 'Restaurant' },
  { tag: 'amenity', value: 'fast_food',     emoji: '🍔', color: '#f97316', label: 'Fast Food' },
  { tag: 'amenity', value: 'bar',           emoji: '🍺', color: '#a855f7', label: 'Bar' },
  { tag: 'amenity', value: 'pub',           emoji: '🍺', color: '#a855f7', label: 'Pub' },
  { tag: 'amenity', value: 'library',       emoji: '📚', color: '#6366f1', label: 'Library' },
  { tag: 'amenity', value: 'gym',           emoji: '💪', color: '#ec4899', label: 'Gym' },
  { tag: 'amenity', value: 'school',        emoji: '🏫', color: '#60a5fa', label: 'School' },
  { tag: 'amenity', value: 'place_of_worship', emoji: '⛪', color: '#e2b46c', label: 'Church' },
  { tag: 'amenity', value: 'pharmacy',      emoji: '💊', color: '#10b981', label: 'Pharmacy' },
  { tag: 'amenity', value: 'bank',          emoji: '🏦', color: '#64748b', label: 'Bank' },
  { tag: 'amenity', value: 'fuel',          emoji: '⛽', color: '#ef4444', label: 'Gas Station' },
  { tag: 'leisure', value: 'park',          emoji: '🌳', color: '#4ade80', label: 'Park' },
  { tag: 'leisure', value: 'playground',    emoji: '🛝', color: '#fbbf24', label: 'Playground' },
  { tag: 'shop',    value: 'supermarket',   emoji: '🛒', color: '#60a5fa', label: 'Supermarket' },
  { tag: 'shop',    value: 'convenience',   emoji: '🏪', color: '#94a3b8', label: 'Store' },
];

const POI_RADIUS = 100; // metres — radius for auto-discovered POIs

// Fetch nearby POIs from OpenStreetMap Overpass API (free, no key)
async function fetchNearbyPOIs(lat, lng, radiusMeters = 500) {
  const types = POI_TYPES.map(t => `node["${t.tag}"="${t.value}"](around:${radiusMeters},${lat},${lng});`).join('');
  const query = `[out:json][timeout:10];(${types});out body;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return (data.elements || []).map(el => {
      const typeInfo = POI_TYPES.find(t => el.tags?.[t.tag] === t.value) || { emoji: '📍', color: '#94a3b8', label: 'Place' };
      return {
        id: `osm-${el.id}`,
        name: el.tags?.name || typeInfo.label,
        lat: el.lat,
        lng: el.lon,
        radiusMeters: POI_RADIUS,
        kind: 'osm',
        emoji: typeInfo.emoji,
        color: typeInfo.color,
      };
    });
  } catch {
    return [];
  }
}

const ROOM_STYLES = {
  'starbucks-spring': { color: '#00704a', emoji: '☕' },
  'downtown-hub':     { color: '#60a5fa', emoji: '🏙️' },
  'forest-gate':      { color: '#4ade80', emoji: '🌲' },
  'sunset-temple':    { color: '#f472b6', emoji: '⛩️' },
  'campfire-circle':  { color: '#f97316', emoji: '🔥' },
};

export default function MapView({ location, rooms, onEnterRoom }) {
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const playerMarkerRef = useRef(null);
  const poiLayerRef = useRef(null);
  const onEnterRoomRef = useRef(onEnterRoom);
  const [poiCount, setPoiCount] = useState(0);
  const [poiStatus, setPoiStatus] = useState('loading');

  // Keep ref current without re-triggering effects
  useEffect(() => { onEnterRoomRef.current = onEnterRoom; });

  const addPin = (map, lat, lng, name, emoji, color, radiusMeters, inRange, onTap) => {
    L.circle([lat, lng], {
      radius: radiusMeters,
      color, fillColor: color,
      fillOpacity: inRange ? 0.15 : 0.05,
      weight: inRange ? 2 : 1,
      opacity: inRange ? 0.8 : 0.3,
      dashArray: inRange ? null : '6',
    }).addTo(map);

    const pinIcon = L.divIcon({
      className: '',
      html: `<div style="display:flex;flex-direction:column;align-items:center;cursor:${inRange ? 'pointer' : 'default'};filter:${inRange ? 'none' : 'grayscale(80%) opacity(0.4)'}">
        <div style="background:${color};font-size:16px;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 0 ${inRange ? '10px' : '3px'} ${color}${inRange ? 'cc' : '33'}">${emoji}</div>
        <div style="background:rgba(0,0,0,0.85);color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;margin-top:1px;white-space:nowrap;font-family:'Courier New',monospace;max-width:90px;overflow:hidden;text-overflow:ellipsis">${name}${inRange ? ' ✦' : ''}</div>
        <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid rgba(0,0,0,0.85)"></div>
      </div>`,
      iconSize: [80, 55],
      iconAnchor: [40, 55],
    });

    const marker = L.marker([lat, lng], { icon: pinIcon }).addTo(map);
    if (inRange && onTap) {
      marker.on('click', onTap);
    } else {
      marker.bindPopup(`<div style="font-family:'Courier New',monospace;font-size:11px;text-align:center"><b>${name}</b><br/><span style="color:#9ca3af">Walk closer to enter</span></div>`);
    }
  };

  useEffect(() => {
    if (leafletRef.current) return;

    const lat = location?.latitude || 29.8368;
    const lng = location?.longitude || -95.4201;

    const map = L.map(mapRef.current, { center: [lat, lng], zoom: 17, zoomControl: false });
    leafletRef.current = map;

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 20,
    }).addTo(map);

    // Player dot
    const playerIcon = L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;border-radius:50%;background:#fbbf24;border:3px solid #fff;box-shadow:0 0 0 3px rgba(251,191,36,0.4)"></div>`,
      iconSize: [16, 16], iconAnchor: [8, 8],
    });
    playerMarkerRef.current = L.marker([lat, lng], { icon: playerIcon }).addTo(map);

    // Manual rooms
    rooms.forEach(room => {
      if (!room.lat || !room.lng) return;
      const style = ROOM_STYLES[room.id] || { color: '#a78bfa', emoji: '📍' };
      const dist = location ? getDistanceMeters(lat, lng, room.lat, room.lng) : Infinity;
      addPin(map, room.lat, room.lng, room.name, style.emoji, style.color, room.radiusMeters,
        dist <= room.radiusMeters, () => onEnterRoomRef.current(room.id));
    });

    // Fetch nearby POIs — use ref check only, not cancelled flag
    fetchNearbyPOIs(lat, lng, 1500).then(pois => {
      if (!leafletRef.current) return;
      const manualCoords = rooms.filter(r => r.lat).map(r => [r.lat, r.lng]);
      const filtered = pois.filter(poi =>
        !manualCoords.some(([rlat, rlng]) => getDistanceMeters(poi.lat, poi.lng, rlat, rlng) < 40)
      );
      const group = L.layerGroup().addTo(leafletRef.current);
      poiLayerRef.current = group;
      filtered.forEach(poi => {
        const dist = getDistanceMeters(lat, lng, poi.lat, poi.lng);
        addPin(group, poi.lat, poi.lng, poi.name, poi.emoji, poi.color, poi.radiusMeters,
          dist <= poi.radiusMeters, () => onEnterRoomRef.current(poi.id, poi));
      });
      setPoiCount(filtered.length);
      setPoiStatus(filtered.length > 0 ? 'found' : 'none');
    }).catch(() => setPoiStatus('error'));

    return () => {
      if (leafletRef.current) {
        leafletRef.current.remove();
        leafletRef.current = null;
      }
      playerMarkerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update player marker position when GPS moves — no map rebuild
  useEffect(() => {
    if (!leafletRef.current || !location) return;
    const { latitude: lat, longitude: lng } = location;
    playerMarkerRef.current?.setLatLng([lat, lng]);
    leafletRef.current.setView([lat, lng], leafletRef.current.getZoom(), { animate: true, duration: 1 });
  }, [location?.latitude, location?.longitude]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      {/* Legend */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 1000, background: 'rgba(0,0,0,0.75)', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontFamily: 'Courier New', fontSize: 11, color: '#94a3b8' }}>
        <div style={{ color: '#fbbf24', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 2 }}>Nearby places</div>
        <div>✦ Tap a lit pin to enter</div>
        {poiStatus === 'loading' && <div style={{ marginTop: 2, color: '#60a5fa' }}>Discovering places…</div>}
        {poiStatus === 'found' && <div style={{ marginTop: 2, color: '#4ade80' }}>{poiCount} places found</div>}
        {poiStatus === 'none' && <div style={{ marginTop: 2, color: '#f97316' }}>No places found nearby</div>}
        {poiStatus === 'error' && <div style={{ marginTop: 2, color: '#ef4444' }}>Could not load places</div>}
      </div>
    </div>
  );
}
