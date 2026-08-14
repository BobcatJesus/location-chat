import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { io } from 'socket.io-client';
import { getDistanceMeters } from '../geo';

const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.PROD ? 'https://location-chat-production.up.railway.app' : 'http://localhost:4000');

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Map OpenStreetMap amenity/tag → emoji + colour
const POI_TYPES = [
  // Food & drink
  { tag: 'amenity', value: 'cafe',             emoji: '☕', color: '#00704a', label: 'Café' },
  { tag: 'amenity', value: 'restaurant',       emoji: '🍽️', color: '#f59e0b', label: 'Restaurant' },
  { tag: 'amenity', value: 'fast_food',        emoji: '🍔', color: '#f97316', label: 'Fast Food' },
  { tag: 'amenity', value: 'bar',              emoji: '🍺', color: '#a855f7', label: 'Bar' },
  { tag: 'amenity', value: 'pub',              emoji: '🍺', color: '#a855f7', label: 'Pub' },
  { tag: 'amenity', value: 'ice_cream',        emoji: '🍦', color: '#fbcfe8', label: 'Ice Cream' },
  { tag: 'amenity', value: 'food_court',       emoji: '🍱', color: '#fbbf24', label: 'Food Court' },
  // Culture & learning
  { tag: 'tourism', value: 'museum',           emoji: '🏛️', color: '#c084fc', label: 'Museum' },
  { tag: 'tourism', value: 'gallery',          emoji: '🖼️', color: '#818cf8', label: 'Art Gallery' },
  { tag: 'tourism', value: 'artwork',          emoji: '🗿', color: '#a78bfa', label: 'Artwork' },
  { tag: 'tourism', value: 'information',      emoji: '🛈', color: '#38bdf8', label: 'Info Point' },
  { tag: 'amenity', value: 'library',          emoji: '📚', color: '#6366f1', label: 'Library' },
  { tag: 'amenity', value: 'theatre',          emoji: '🎭', color: '#f43f5e', label: 'Theatre' },
  { tag: 'amenity', value: 'cinema',           emoji: '🎬', color: '#ef4444', label: 'Cinema' },
  // Nature & outdoors
  { tag: 'leisure', value: 'park',             emoji: '🌳', color: '#4ade80', label: 'Park' },
  { tag: 'leisure', value: 'garden',           emoji: '🌸', color: '#86efac', label: 'Garden' },
  { tag: 'leisure', value: 'nature_reserve',   emoji: '🌿', color: '#16a34a', label: 'Nature Reserve' },
  { tag: 'leisure', value: 'dog_park',         emoji: '🐕', color: '#a3e635', label: 'Dog Park' },
  { tag: 'leisure', value: 'playground',       emoji: '🛝', color: '#fbbf24', label: 'Playground' },
  { tag: 'leisure', value: 'swimming_pool',    emoji: '🏊', color: '#0ea5e9', label: 'Pool' },
  { tag: 'leisure', value: 'marina',           emoji: '⛵', color: '#0369a1', label: 'Marina' },
  { tag: 'leisure', value: 'fishing',          emoji: '🎣', color: '#0891b2', label: 'Fishing Spot' },
  { tag: 'natural', value: 'beach',            emoji: '🏖️', color: '#fcd34d', label: 'Beach' },
  { tag: 'natural', value: 'peak',             emoji: '⛰️', color: '#78716c', label: 'Peak' },
  { tag: 'natural', value: 'waterfall',        emoji: '💧', color: '#7dd3fc', label: 'Waterfall' },
  { tag: 'natural', value: 'water',            emoji: '🏞️', color: '#3b82f6', label: 'Lake / Pond' },
  { tag: 'natural', value: 'spring',           emoji: '💦', color: '#93c5fd', label: 'Spring' },
  // Trails & viewpoints
  { tag: 'tourism', value: 'viewpoint',        emoji: '🔭', color: '#f97316', label: 'Viewpoint' },
  { tag: 'tourism', value: 'picnic_site',      emoji: '🧺', color: '#84cc16', label: 'Picnic Spot' },
  { tag: 'tourism', value: 'camp_site',        emoji: '⛺', color: '#65a30d', label: 'Campsite' },
  { tag: 'tourism', value: 'wilderness_hut',   emoji: '🛖', color: '#92400e', label: 'Wilderness Hut' },
  { tag: 'highway', value: 'trailhead',        emoji: '🥾', color: '#a16207', label: 'Trailhead' },
  // Spiritual & historic
  { tag: 'amenity', value: 'place_of_worship', emoji: '🙏', color: '#e2b46c', label: 'Place of Worship' },
  { tag: 'historic', value: 'monument',        emoji: '🗽', color: '#d97706', label: 'Monument' },
  { tag: 'historic', value: 'ruins',           emoji: '🏚️', color: '#92400e', label: 'Ruins' },
  { tag: 'historic', value: 'memorial',        emoji: '🕯️', color: '#b45309', label: 'Memorial' },
  { tag: 'historic', value: 'castle',          emoji: '🏰', color: '#7c3aed', label: 'Castle' },
  // Fitness & sport
  { tag: 'amenity', value: 'gym',              emoji: '💪', color: '#ec4899', label: 'Gym' },
  { tag: 'leisure', value: 'sports_centre',    emoji: '🏟️', color: '#e11d48', label: 'Sports Centre' },
  { tag: 'leisure', value: 'stadium',          emoji: '🏟️', color: '#be123c', label: 'Stadium' },
  { tag: 'leisure', value: 'golf_course',      emoji: '⛳', color: '#15803d', label: 'Golf Course' },
  { tag: 'leisure', value: 'skate_park',       emoji: '🛹', color: '#6b7280', label: 'Skate Park' },
  // Practical
  { tag: 'amenity', value: 'school',           emoji: '🏫', color: '#60a5fa', label: 'School' },
  { tag: 'amenity', value: 'pharmacy',         emoji: '💊', color: '#10b981', label: 'Pharmacy' },
  { tag: 'amenity', value: 'bank',             emoji: '🏦', color: '#64748b', label: 'Bank' },
  { tag: 'amenity', value: 'fuel',             emoji: '⛽', color: '#ef4444', label: 'Gas Station' },
  { tag: 'amenity', value: 'marketplace',      emoji: '🏪', color: '#f59e0b', label: 'Market' },
  { tag: 'shop',    value: 'supermarket',      emoji: '🛒', color: '#60a5fa', label: 'Supermarket' },
  { tag: 'shop',    value: 'convenience',      emoji: '🏪', color: '#94a3b8', label: 'Store' },
  { tag: 'shop',    value: 'deli',             emoji: '🥪', color: '#f59e0b', label: 'Deli' },
  { tag: 'shop',    value: 'bakery',           emoji: '🥐', color: '#fcd34d', label: 'Bakery' },
  { tag: 'shop',    value: 'butcher',          emoji: '🥩', color: '#ef4444', label: 'Butcher' },
  { tag: 'shop',    value: 'seafood',          emoji: '🦞', color: '#0ea5e9', label: 'Seafood' },
  { tag: 'shop',    value: 'wine',             emoji: '🍷', color: '#9333ea', label: 'Wine Shop' },
  { tag: 'shop',    value: 'coffee',           emoji: '☕', color: '#00704a', label: 'Coffee Shop' },
  { tag: 'shop',    value: 'clothes',          emoji: '👕', color: '#ec4899', label: 'Clothing' },
  { tag: 'shop',    value: 'books',            emoji: '📚', color: '#6366f1', label: 'Bookstore' },
  { tag: 'shop',    value: 'music',            emoji: '🎵', color: '#a855f7', label: 'Music' },
  { tag: 'shop',    value: 'art',              emoji: '🎨', color: '#818cf8', label: 'Art Shop' },
  { tag: 'amenity', value: 'deli',             emoji: '🥪', color: '#f59e0b', label: 'Deli' },
  { tag: 'amenity', value: 'juice_bar',        emoji: '🥤', color: '#4ade80', label: 'Juice Bar' },
  { tag: 'amenity', value: 'hookah_lounge',    emoji: '💨', color: '#a78bfa', label: 'Lounge' },
];

const POI_RADIUS = 40; // metres

function deriveElementCoords(element) {
  if (Number.isFinite(element?.lat) && Number.isFinite(element?.lon)) {
    return { lat: element.lat, lng: element.lon };
  }
  if (Number.isFinite(element?.center?.lat) && Number.isFinite(element?.center?.lon)) {
    return { lat: element.center.lat, lng: element.center.lon };
  }
  if (Array.isArray(element?.geometry) && element.geometry.length > 0) {
    const points = element.geometry.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon));
    if (!points.length) return { lat: null, lng: null };
    const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
    const lng = points.reduce((sum, point) => sum + point.lon, 0) / points.length;
    return { lat, lng };
  }
  return { lat: null, lng: null };
}

// Fetch nearby POIs from OpenStreetMap Overpass API (free, no key)
async function fetchNearbyPOIs(lat, lng, radiusMeters = 800) {
  try {
    const res = await fetch(`${SOCKET_SERVER_URL}/api/nearby-places?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius=${encodeURIComponent(radiusMeters)}`);
    if (!res.ok) return [];
    const elements = await res.json();
    return (Array.isArray(elements) ? elements : []).map((el) => {
      const coords = deriveElementCoords(el);
      const typeInfo = POI_TYPES.find((t) => el.tags?.[t.tag] === t.value) || { emoji: '📍', color: '#94a3b8', label: 'Place', value: 'default' };
      return {
        id: `osm-${el.id}`,
        name: el.tags?.name || typeInfo.label,
        lat: coords.lat,
        lng: coords.lng,
        radiusMeters: POI_RADIUS,
        kind: 'osm',
        amenity: typeInfo.value,
        emoji: typeInfo.emoji,
        color: typeInfo.color,
      };
    }).filter((poi) => Number.isFinite(poi.lat) && Number.isFinite(poi.lng));
  } catch {
    return [];
  }
}

// Fetch the building polygon footprint nearest to a given point
async function fetchBuildingFootprint(lat, lng) {
  try {
    const res = await fetch(`${SOCKET_SERVER_URL}/api/building-footprint?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const ROOM_STYLES = {
  'starbucks-spring': { color: '#00704a', emoji: '☕' },
  'agora-houston':    { color: '#9333ea', emoji: '🍷' },
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
  const allPinsRef = useRef([]);
  const [poiCount, setPoiCount] = useState(0);
  const [poiStatus, setPoiStatus] = useState('loading');
  const poiLoadedRef = useRef(false);
  const lastFetchPosRef = useRef(null);
  const roomCountsRef = useRef({});

  const loadPOIs = (lat, lng) => {
    if (!leafletRef.current) return;
    setPoiStatus('loading');
    fetchNearbyPOIs(lat, lng, 1000).then(pois => {
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
          () => {
            onEnterRoomRef.current(poi.id, { ...poi });
            fetchBuildingFootprint(poi.lat, poi.lng).then(footprint => {
              if (footprint) onEnterRoomRef.current(poi.id, { ...poi, footprint });
            });
          }, true);
      });
      // Re-evaluate all pins with current position
      const lat2 = playerMarkerRef.current?.getLatLng()?.lat || lat;
      const lng2 = playerMarkerRef.current?.getLatLng()?.lng || lng;
      updateAllPins(lat2, lng2);
      setPoiCount(filtered.length);
      setPoiStatus(filtered.length > 0 ? 'found' : 'none');
      poiLoadedRef.current = true;
      lastFetchPosRef.current = { lat, lng };
    }).catch(() => setPoiStatus('error'));
  };

  useEffect(() => { onEnterRoomRef.current = onEnterRoom; });

  // Subscribe to live room counts from the server
  useEffect(() => {
    const socket = io(SOCKET_SERVER_URL, { transports: ['websocket'] });
    socket.on('room_counts', (counts) => {
      roomCountsRef.current = counts;
      const pos = playerMarkerRef.current?.getLatLng();
      if (pos) updateAllPins(pos.lat, pos.lng);
    });
    socket.on('community_location_added', (loc) => {
      if (!leafletRef.current) return;
      addPin(leafletRef.current, loc.lat, loc.lng, loc.name, loc.emoji || '📍', loc.color || '#f97316', loc.radius || 50,
        () => {
          onEnterRoomRef.current(loc.id, { ...loc });
          fetchBuildingFootprint(loc.lat, loc.lng).then(footprint => {
            if (footprint) onEnterRoomRef.current(loc.id, { ...loc, footprint });
          });
        }, false, loc.id);
      const pos = playerMarkerRef.current?.getLatLng();
      if (pos) updateAllPins(pos.lat, pos.lng);
    });
    return () => socket.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch existing community locations on mount
  useEffect(() => {
    fetch(`${SOCKET_SERVER_URL}/api/community-locations`)
      .then(r => r.json())
      .then(locs => {
        if (!leafletRef.current) return;
        locs.forEach(loc => {
          addPin(leafletRef.current, loc.lat, loc.lng, loc.name, loc.emoji || '📍', loc.color || '#f97316', loc.radius || 50,
            () => {
              onEnterRoomRef.current(loc.id, { ...loc });
              fetchBuildingFootprint(loc.lat, loc.lng).then(footprint => {
                if (footprint) onEnterRoomRef.current(loc.id, { ...loc, footprint });
              });
            }, false, loc.id);
        });
        const pos = playerMarkerRef.current?.getLatLng();
        if (pos) updateAllPins(pos.lat, pos.lng);
      }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Build icon HTML based on current in-range state
  const makeIcon = (emoji, color, name, inRange, count) => L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;cursor:${inRange ? 'pointer' : 'default'};filter:${inRange ? 'none' : 'grayscale(60%) opacity(0.5)'}">
      <div style="background:${color};font-size:16px;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid #2b2b33;box-shadow:2px 2px 0 #2b2b33">${emoji}</div>
      <div style="background:#faf0d7;color:#2b2b33;font-size:9px;padding:2px 6px;border-radius:3px;margin-top:2px;white-space:nowrap;font-family:'Courier New',monospace;max-width:90px;overflow:hidden;text-overflow:ellipsis;border:1.5px solid #2b2b33;box-shadow:1px 1px 0 #2b2b33">${name}${inRange ? ' ✦' : ''}${count ? ` · 👤${count}` : ''}</div>
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #2b2b33"></div>
    </div>`,
    iconSize: [80, 58], iconAnchor: [40, 58],
  });

  // Re-evaluate every pin's visual against current player position — CSS only, no DOM replacement
  const updateAllPins = (playerLat, playerLng) => {
    allPinsRef.current.forEach(pin => {
      const dist = getDistanceMeters(playerLat, playerLng, pin.lat, pin.lng);
      const inRange = dist <= pin.radiusMeters;
      const count = roomCountsRef.current[pin.roomId] || 0;
      const el = pin.marker.getElement();
      if (el) {
        el.style.filter = inRange ? 'none' : 'grayscale(80%) opacity(0.4)';
        el.style.cursor = inRange ? 'pointer' : 'default';
        const dot = el.querySelector('div > div:first-child');
        if (dot) dot.style.boxShadow = inRange ? `0 0 10px ${pin.color}cc` : `0 0 3px ${pin.color}33`;
        const label = el.querySelector('div > div:nth-child(2)');
        if (label) label.textContent = pin.name + (inRange ? ' ✦' : '') + (count ? ` · 👤${count}` : '');
      }
      pin.circle.setStyle({
        fillOpacity: inRange ? 0.15 : 0.05,
        weight: inRange ? 2 : 1,
        opacity: inRange ? 0.8 : 0.3,
        dashArray: inRange ? null : '6',
      });
    });
  };

  const addPin = (layer, lat, lng, name, emoji, color, radiusMeters, onTap, isOSM = false, roomId = null) => {
    const dist = location ? getDistanceMeters(location.latitude, location.longitude, lat, lng) : Infinity;
    const inRange = dist <= radiusMeters;
    const count = roomCountsRef.current[roomId] || 0;

    const circle = L.circle([lat, lng], {
      radius: radiusMeters, color, fillColor: color,
      fillOpacity: inRange ? 0.15 : 0.05,
      weight: inRange ? 2 : 1,
      opacity: inRange ? 0.8 : 0.3,
      dashArray: inRange ? null : '6',
      interactive: false, // never intercept clicks
    }).addTo(layer);

    const marker = L.marker([lat, lng], { icon: makeIcon(emoji, color, name, inRange, count) }).addTo(layer);

    // Bind directly on DOM element so both mouse and touch work reliably
    const bindTap = () => {
      const el = marker.getElement();
      if (!el) return;
      let touchMoved = false;
      el.addEventListener('touchstart', () => { touchMoved = false; }, { passive: true });
      el.addEventListener('touchmove', () => { touchMoved = true; }, { passive: true });
      el.addEventListener('touchend', (e) => {
        if (touchMoved) return;
        e.preventDefault();
        e.stopPropagation();
        onTap();
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onTap();
      });
    };
    if (marker.getElement()) bindTap();
    else marker.once('add', bindTap);

    allPinsRef.current.push({ marker, circle, lat, lng, radiusMeters, name, emoji, color, onTap, isOSM, roomId });
  };

  useEffect(() => {
    if (leafletRef.current) return;

    const lat = location?.latitude || 29.8368;
    const lng = location?.longitude || -95.4201;

    const map = L.map(mapRef.current, { center: [lat, lng], zoom: 17, zoomControl: false, clickTolerance: 5 });
    leafletRef.current = map;

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 20,
    }).addTo(map);

    // Player dot
    const playerIcon = L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;border-radius:50%;background:#e85d5d;border:3px solid #fff;box-shadow:0 0 0 3px rgba(232,93,93,0.4)"></div>`,
      iconSize: [16, 16], iconAnchor: [8, 8],
    });
    playerMarkerRef.current = L.marker([lat, lng], { icon: playerIcon }).addTo(map);

    // Manual rooms
    rooms.forEach(room => {
      if (!room.lat || !room.lng) return;
      const style = ROOM_STYLES[room.id] || { color: '#a78bfa', emoji: '📍' };
      addPin(map, room.lat, room.lng, room.name, style.emoji, style.color, room.radiusMeters,
        () => {
          onEnterRoomRef.current(room.id, null);
          fetchBuildingFootprint(room.lat, room.lng).then(footprint => {
            if (footprint) onEnterRoomRef.current(room.id, { ...room, footprint });
          });
        }, false, room.id);
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

  const [nearbyRoom, setNearbyRoom] = useState(null); // name of room you're currently inside

  // Update player position AND re-evaluate all pin states when GPS moves
  // Also re-fetch POIs if moved more than 500m from last fetch location
  useEffect(() => {
    if (!leafletRef.current || !location) return;
    const { latitude: lat, longitude: lng } = location;
    playerMarkerRef.current?.setLatLng([lat, lng]);
    leafletRef.current.setView([lat, lng], leafletRef.current.getZoom(), { animate: true, duration: 1 });
    updateAllPins(lat, lng);

    // Check if inside any named room
    const inside = allPinsRef.current.find(pin =>
      !pin.isOSM && getDistanceMeters(lat, lng, pin.lat, pin.lng) <= pin.radiusMeters
    );
    setNearbyRoom(inside?.name || null);

    // Re-fetch if moved >300m, or if initial mount used fallback coords (no real GPS yet)
    if (lastFetchPosRef.current && poiLoadedRef.current) {
      const moved = getDistanceMeters(lat, lng, lastFetchPosRef.current.lat, lastFetchPosRef.current.lng);
      if (moved > 300) loadPOIs(lat, lng);
    } else if (!poiLoadedRef.current) {
      loadPOIs(lat, lng);
    }
  }, [location?.latitude, location?.longitude]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* "You're here" banner when inside a named room's radius */}
      {nearbyRoom && (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: '#faf0d7', color: '#2b2b33', fontFamily: 'Courier New', fontSize: 13, fontWeight: 'bold', padding: '6px 16px', borderRadius: 6, border: '2px solid #2b2b33', boxShadow: '2px 2px 0 #2b2b33', whiteSpace: 'nowrap' }}>
          📍 You're at {nearbyRoom} — tap the pin to enter
        </div>
      )}
      {/* Legend */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 1000, background: '#faf0d7', border: '2px solid #2b2b33', borderRadius: 8, padding: '8px 12px', fontFamily: 'Courier New', fontSize: 11, color: '#2b2b33', boxShadow: '2px 2px 0 #2b2b33' }}>
        <div style={{ color: '#5a3e2b', fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 2 }}>Nearby places</div>
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
            }} style={{ background: '#faf0d7', border: '2px solid #2b2b33', color: '#2b2b33', padding: '3px 8px', cursor: 'pointer', fontFamily: 'Courier New', fontSize: 10, borderRadius: 4, boxShadow: '1px 1px 0 #2b2b33' }}>
              ↺ Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
