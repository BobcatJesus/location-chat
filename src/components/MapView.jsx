import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getDistanceMeters } from '../geo';

// Fix Leaflet default marker icon paths broken by bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

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

  useEffect(() => {
    if (leafletRef.current) return; // already initialized

    const lat = location?.latitude || 29.8368;
    const lng = location?.longitude || -95.4201;

    const map = L.map(mapRef.current, {
      center: [lat, lng],
      zoom: 17,
      zoomControl: false,
    });
    leafletRef.current = map;

    // Dark-themed OpenStreetMap tiles (no API key needed)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      maxZoom: 20,
    }).addTo(map);

    // Player dot
    const playerIcon = L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;border-radius:50%;background:#fbbf24;border:3px solid #fff;box-shadow:0 0 0 3px rgba(251,191,36,0.4)"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    playerMarkerRef.current = L.marker([lat, lng], { icon: playerIcon }).addTo(map);

    // Room pins + radius circles
    rooms.forEach(room => {
      if (!room.lat || !room.lng) return;
      const style = ROOM_STYLES[room.id] || { color: '#a78bfa', emoji: '📍' };
      const dist = location ? getDistanceMeters(lat, lng, room.lat, room.lng) : Infinity;
      const inRange = dist <= room.radiusMeters;

      // Radius circle
      L.circle([room.lat, room.lng], {
        radius: room.radiusMeters,
        color: style.color,
        fillColor: style.color,
        fillOpacity: inRange ? 0.15 : 0.05,
        weight: inRange ? 2 : 1,
        opacity: inRange ? 0.8 : 0.3,
        dashArray: inRange ? null : '6',
      }).addTo(map);

      // Pin
      const pinIcon = L.divIcon({
        className: '',
        html: `<div style="
          display:flex;flex-direction:column;align-items:center;cursor:pointer;
          filter:${inRange ? 'none' : 'grayscale(100%) opacity(0.4)'};
        ">
          <div style="
            background:${style.color};color:#fff;font-size:18px;
            width:36px;height:36px;border-radius:50%;display:flex;align-items:center;
            justify-content:center;border:3px solid #fff;
            box-shadow:0 0 ${inRange ? '12px' : '4px'} ${style.color}${inRange ? 'cc' : '44'};
          ">${style.emoji}</div>
          <div style="
            background:rgba(0,0,0,0.8);color:#fff;font-size:10px;
            padding:2px 6px;border-radius:3px;margin-top:2px;white-space:nowrap;
            font-family:'Courier New',monospace;border:1px solid ${style.color}55;
          ">${room.name}${inRange ? ' ✦' : ''}</div>
          <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid rgba(0,0,0,0.8);"></div>
        </div>`,
        iconSize: [80, 60],
        iconAnchor: [40, 60],
        popupAnchor: [0, -60],
      });

      const marker = L.marker([room.lat, room.lng], { icon: pinIcon }).addTo(map);

      if (inRange) {
        marker.on('click', () => onEnterRoom(room.id));
      } else {
        marker.bindPopup(
          `<div style="font-family:'Courier New',monospace;font-size:12px;text-align:center">
            <strong>${room.name}</strong><br/>
            ${Math.round(dist)}m away<br/>
            <span style="color:#9ca3af">(need to be within ${room.radiusMeters}m)</span>
          </div>`,
          { className: 'dark-popup' }
        );
      }
    });

  }, []); // build once

  // Update player marker position when GPS moves
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
        <div style={{ color: '#fbbf24', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 2 }}>Rooms nearby</div>
        <div>✦ Tap a lit pin to enter</div>
        <div style={{ marginTop: 2 }}>Dashed = out of range</div>
      </div>
    </div>
  );
}
