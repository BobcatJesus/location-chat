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

const POI_RADIUS = 30; // metres — must be at or near the entrance

// Fetch nearby POIs from OpenStreetMap Overpass API (free, no key)
async function fetchNearbyPOIs(lat, lng, radiusMeters = 500) {
  const types = POI_TYPES.map(t => `node["${t.tag}"="${t.value}"](around:${radiusMeters},${lat},${lng});`).join('');
  const query = `[out:json][timeout:15];(${types});out body;`;
  // Try mirrors in order if one fails
  const endpoints = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`);
      if (!res.ok) continue;
      const data = await res.json();
      return (data.elements || []).map(el => {
        const typeInfo = POI_TYPES.find(t => el.tags?.[t.tag] === t.value) || { emoji: '📍', color: '#94a3b8', label: 'Place', value: 'default' };
        return {
          id: `osm-${el.id}`,
          name: el.tags?.name || typeInfo.label,
          lat: el.lat,
          lng: el.lon,
          radiusMeters: POI_RADIUS,
          kind: 'osm',
          amenity: typeInfo.value,
          emoji: typeInfo.emoji,
          color: typeInfo.color,
        };
      });
    } catch { continue; }
  }
  return [];
}

// Fetch the building polygon footprint nearest to a given point
async function fetchBuildingFootprint(lat, lng) {
  const query = `[out:json][timeout:8];way["building"](around:60,${lat},${lng});out geom;`;
  const endpoints = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`);
      if (!res.ok) continue;
      const data = await res.json();
    const ways = (data.elements || []).filter(el => el.geometry?.length > 3);
    if (!ways.length) return null;
    // Pick the closest way by centroid
    const closest = ways.reduce((best, w) => {
      const clat = w.geometry.reduce((s, p) => s + p.lat, 0) / w.geometry.length;
      const clng = w.geometry.reduce((s, p) => s + p.lon, 0) / w.geometry.length;
      const d = Math.abs(clat - lat) + Math.abs(clng - lng);
      return (!best || d < best.d) ? { w, d } : best;
    }, null)?.w;
      return closest?.geometry?.map(p => ({ lat: p.lat, lng: p.lon })) || null;
    } catch { continue; }
  }
  return null;
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
  const onEnterRoomRef = useRef(onEnterRoom);
  const allPinsRef = useRef([]); // [{ marker, circle, lat, lng, radiusMeters, name, emoji, color, onTap }]
  const [poiCount, setPoiCount] = useState(0);
  const [poiStatus, setPoiStatus] = useState('loading');
  const poiLoadedRef = useRef(false);

  const loadPOIs = (lat, lng) => {
    if (!leafletRef.current) return;
    setPoiStatus('loading');
    fetchNearbyPOIs(lat, lng, 1500).then(pois => {
      if (!leafletRef.current) return;
      // Remove old POI markers
      allPinsRef.current = allPinsRef.current.filter(pin => {
        if (pin.isOSM) { pin.marker.remove(); pin.circle.remove(); return false; }
        return true;
      });
      const manualCoords = rooms.filter(r => r.lat).map(r => [r.lat, r.lng]);
      const filtered = pois.filter(poi =>
        !manualCoords.some(([rlat, rlng]) => getDistanceMeters(poi.lat, poi.lng, rlat, rlng) < 40)
      );
      filtered.forEach(poi => {
        addPin(leafletRef.current, poi.lat, poi.lng, poi.name, poi.emoji, poi.color, poi.radiusMeters,
          async () => {
            const footprint = await fetchBuildingFootprint(poi.lat, poi.lng);
            onEnterRoomRef.current(poi.id, { ...poi, footprint });
          }, true);
      });
      // Re-evaluate all pins with current position
      const lat2 = playerMarkerRef.current?.getLatLng()?.lat || lat;
      const lng2 = playerMarkerRef.current?.getLatLng()?.lng || lng;
      updateAllPins(lat2, lng2);
      setPoiCount(filtered.length);
      setPoiStatus(filtered.length > 0 ? 'found' : 'none');
      poiLoadedRef.current = true;
    }).catch(() => setPoiStatus('error'));
  };

  useEffect(() => { onEnterRoomRef.current = onEnterRoom; });

  // Build icon HTML based on current in-range state
  const makeIcon = (emoji, color, name, inRange) => L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;cursor:${inRange ? 'pointer' : 'default'};filter:${inRange ? 'none' : 'grayscale(80%) opacity(0.4)'}">
      <div style="background:${color};font-size:16px;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 0 ${inRange ? '10px' : '3px'} ${color}${inRange ? 'cc' : '33'}">${emoji}</div>
      <div style="background:rgba(0,0,0,0.85);color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;margin-top:1px;white-space:nowrap;font-family:'Courier New',monospace;max-width:90px;overflow:hidden;text-overflow:ellipsis">${name}${inRange ? ' ✦' : ''}</div>
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid rgba(0,0,0,0.85)"></div>
    </div>`,
    iconSize: [80, 55], iconAnchor: [40, 55],
  });

  // Re-evaluate every pin's visual against current player position — CSS only, no DOM replacement
  const updateAllPins = (playerLat, playerLng) => {
    allPinsRef.current.forEach(pin => {
      const dist = getDistanceMeters(playerLat, playerLng, pin.lat, pin.lng);
      const inRange = dist <= pin.radiusMeters;
      const el = pin.marker.getElement();
      if (el) {
        el.style.filter = inRange ? 'none' : 'grayscale(80%) opacity(0.4)';
        el.style.cursor = inRange ? 'pointer' : 'default';
        const dot = el.querySelector('div > div:first-child');
        if (dot) dot.style.boxShadow = inRange ? `0 0 10px ${pin.color}cc` : `0 0 3px ${pin.color}33`;
        const label = el.querySelector('div > div:nth-child(2)');
        if (label) label.textContent = pin.name + (inRange ? ' ✦' : '');
      }
      pin.circle.setStyle({
        fillOpacity: inRange ? 0.15 : 0.05,
        weight: inRange ? 2 : 1,
        opacity: inRange ? 0.8 : 0.3,
        dashArray: inRange ? null : '6',
      });
    });
  };

  const addPin = (layer, lat, lng, name, emoji, color, radiusMeters, onTap, isOSM = false) => {
    const dist = location ? getDistanceMeters(location.latitude, location.longitude, lat, lng) : Infinity;
    const inRange = dist <= radiusMeters;

    const circle = L.circle([lat, lng], {
      radius: radiusMeters, color, fillColor: color,
      fillOpacity: inRange ? 0.15 : 0.05,
      weight: inRange ? 2 : 1,
      opacity: inRange ? 0.8 : 0.3,
      dashArray: inRange ? null : '6',
    }).addTo(layer);

    const marker = L.marker([lat, lng], { icon: makeIcon(emoji, color, name, inRange) }).addTo(layer);

    // Click always fires onTap — GPS gating in handleEnterRoom blocks entry if too far
    marker.on('click', onTap);

    allPinsRef.current.push({ marker, circle, lat, lng, radiusMeters, name, emoji, color, onTap, isOSM });
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
      addPin(map, room.lat, room.lng, room.name, style.emoji, style.color, room.radiusMeters,
        async () => {
          const footprint = await fetchBuildingFootprint(room.lat, room.lng);
          onEnterRoomRef.current(room.id, footprint ? { ...room, footprint } : null);
        });
    });

    // Fetch nearby POIs
    loadPOIs(lat, lng);

    return () => {
      if (leafletRef.current) {
        leafletRef.current.remove();
        leafletRef.current = null;
      }
      playerMarkerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update player position AND re-evaluate all pin states when GPS moves
  useEffect(() => {
    if (!leafletRef.current || !location) return;
    const { latitude: lat, longitude: lng } = location;
    playerMarkerRef.current?.setLatLng([lat, lng]);
    leafletRef.current.setView([lat, lng], leafletRef.current.getZoom(), { animate: true, duration: 1 });
    updateAllPins(lat, lng);
  }, [location?.latitude, location?.longitude]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      {/* Legend */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 1000, background: 'rgba(0,0,0,0.75)', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontFamily: 'Courier New', fontSize: 11, color: '#94a3b8' }}>
        <div style={{ color: '#fbbf24', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 2 }}>Nearby places</div>
        <div>✦ Tap a lit pin to enter</div>
        {poiStatus === 'loading' && <div style={{ marginTop: 4, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>Discovering…</span>
          <span style={{ animation: 'pulse 1s infinite', fontSize: 14 }}>⟳</span>
        </div>}
        {poiStatus === 'found' && <div style={{ marginTop: 4, color: '#4ade80' }}>{poiCount} places found</div>}
        {(poiStatus === 'none' || poiStatus === 'error') && (
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ color: poiStatus === 'error' ? '#ef4444' : '#f97316' }}>
              {poiStatus === 'error' ? 'Load failed' : 'None found nearby'}
            </div>
            <button onClick={() => {
              const pos = playerMarkerRef.current?.getLatLng();
              if (pos) loadPOIs(pos.lat, pos.lng);
            }} style={{ background: '#1e293b', border: '1px solid #475569', color: '#94a3b8', padding: '3px 8px', cursor: 'pointer', fontFamily: 'Courier New', fontSize: 10, borderRadius: 4 }}>
              ↺ Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
