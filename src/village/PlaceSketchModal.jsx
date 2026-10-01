import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// PlaceSketchModal — draw a place boundary on a Leaflet map.
// Modes: free (tap points), rectangle (tap 2 corners), circle (tap center + edge).
// On Done: returns { points: [{lat,lng}], shape, name, type } via onSubmit.

const PLACE_TYPES = [
  { value: 'bar', label: '🍺 Bar' },
  { value: 'cafe', label: '☕ Café' },
  { value: 'restaurant', label: '🍽️ Restaurant' },
  { value: 'park', label: '🌳 Park' },
  { value: 'library', label: '📚 Library' },
  { value: 'shop', label: '🛍️ Shop' },
  { value: 'other', label: '📍 Other' },
];

export default function PlaceSketchModal({ center, onSubmit, onClose }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const drawnLayer = useRef(null);
  const [mode, setMode] = useState('free'); // free | rectangle | circle
  const [points, setPoints] = useState([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('bar');
  const [step, setStep] = useState('draw'); // draw | details
  const [error, setError] = useState('');

  const lat = center?.latitude || 29.74831;
  const lng = center?.longitude || -95.39097;

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current).setView([lat, lng], 18);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 20,
    }).addTo(map);
    // User location marker
    L.circleMarker([lat, lng], { radius: 8, color: '#35e0ff', fillColor: '#35e0ff', fillOpacity: 0.8 }).addTo(map);
    mapInstance.current = map;

    map.on('click', (e) => {
      const { lat: clat, lng: clng } = e.latlng;
      setPoints((prev) => {
        if (mode === 'free') return [...prev, { lat: clat, lng: clng }];
        if (mode === 'rectangle' && prev.length < 2) return [...prev, { lat: clat, lng: clng }];
        if (mode === 'circle' && prev.length < 2) return [...prev, { lat: clat, lng: clng }];
        return prev;
      });
    });

    return () => { map.remove(); mapInstance.current = null; };
  }, []);

  // Redraw polygon/circle on points change
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (drawnLayer.current) { map.removeLayer(drawnLayer.current); drawnLayer.current = null; }
    if (points.length === 0) return;

    const latlngs = points.map((p) => [p.lat, p.lng]);
    if (mode === 'free' && points.length >= 3) {
      drawnLayer.current = L.polygon(latlngs, { color: '#ff3da6', weight: 3, fillOpacity: 0.2 }).addTo(map);
    } else if (mode === 'rectangle' && points.length === 2) {
      const bounds = L.latLngBounds(latlngs[0], latlngs[1]);
      drawnLayer.current = L.rectangle(bounds, { color: '#ff3da6', weight: 3, fillOpacity: 0.2 }).addTo(map);
    } else if (mode === 'circle' && points.length === 2) {
      const radius = map.distance(latlngs[0], latlngs[1]);
      drawnLayer.current = L.circle(latlngs[0], { radius, color: '#ff3da6', weight: 3, fillOpacity: 0.2 }).addTo(map);
    } else {
      // Show markers for in-progress
      latlngs.forEach((ll) => {
        L.circleMarker(ll, { radius: 5, color: '#ff3da6', fillOpacity: 1 }).addTo(map);
      });
    }
    // Also draw markers
    points.forEach((p) => {
      L.circleMarker([p.lat, p.lng], { radius: 5, color: '#ffb02e', fillColor: '#ffb02e', fillOpacity: 1 }).addTo(map);
    });
  }, [points, mode]);

  const canProceed = () => {
    if (mode === 'free') return points.length >= 3;
    return points.length === 2;
  };

  const handleDone = () => {
    if (!canProceed()) {
      setError(mode === 'free' ? 'Tap at least 3 points.' : 'Tap 2 points.');
      return;
    }
    setError('');
    setStep('details');
  };

  const handleSubmit = () => {
    if (!name.trim()) { setError('Give the place a name.'); return; }
    // Convert to polygon points
    let finalPoints = points;
    if (mode === 'rectangle') {
      const [a, b] = points;
      finalPoints = [
        { lat: a.lat, lng: a.lng },
        { lat: a.lat, lng: b.lng },
        { lat: b.lat, lng: b.lng },
        { lat: b.lat, lng: a.lng },
      ];
    } else if (mode === 'circle') {
      // Approximate circle as 16-gon
      const [c, e] = points;
      const map = mapInstance.current;
      const radius = map ? map.distance([c.lat, c.lng], [e.lat, e.lng]) : 50;
      finalPoints = [];
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * 2 * Math.PI;
        // Rough meters-to-degrees
        const dLat = (radius * Math.cos(angle)) / 111320;
        const dLng = (radius * Math.sin(angle)) / (111320 * Math.cos(c.lat * Math.PI / 180));
        finalPoints.push({ lat: c.lat + dLat, lng: c.lng + dLng });
      }
    }
    onSubmit({ points: finalPoints, shape: mode, name: name.trim(), type });
  };

  const undo = () => setPoints((prev) => prev.slice(0, -1));
  const clear = () => setPoints([]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.7)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: '#14101e', borderRadius: 14, border: '3px solid #ffb02e',
        width: '100%', maxWidth: 600, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        color: '#f4f1e6', fontFamily: 'Courier New, monospace',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '2px solid #ffb02e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {step === 'draw' ? '📍 Sketch Place Boundary' : '📝 Place Details'}
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#f4f1e6', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {step === 'draw' ? (
          <>
            <div style={{ padding: '8px 16px', display: 'flex', gap: 8, borderBottom: '1px solid rgba(255,176,46,0.2)' }}>
              {['free', 'rectangle', 'circle'].map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setPoints([]); }}
                  style={{
                    padding: '6px 12px', fontSize: 12, cursor: 'pointer',
                    background: mode === m ? '#ffb02e' : 'transparent',
                    color: mode === m ? '#14101e' : '#f4f1e6',
                    border: '2px solid #ffb02e', borderRadius: 8, fontWeight: 700, fontFamily: 'inherit',
                  }}
                >
                  {m === 'free' ? '✏️ Free draw' : m === 'rectangle' ? '▭ Rectangle' : '⭕ Circle'}
                </button>
              ))}
            </div>
            <div ref={mapRef} style={{ height: 350, width: '100%' }} />
            <div style={{ padding: '12px 16px', borderTop: '2px solid #ffb02e' }}>
              <div style={{ fontSize: 12, color: '#8a8296', marginBottom: 8 }}>
                {mode === 'free' ? 'Tap 3+ points to outline the place.' :
                 mode === 'rectangle' ? 'Tap two opposite corners.' :
                 'Tap center, then edge for radius.'}
                {' '}({points.length} point{points.length === 1 ? '' : 's'})
              </div>
              {error && <div style={{ color: '#ff3da6', fontSize: 12, marginBottom: 8 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={undo} disabled={points.length === 0}
                  style={{ padding: '8px 16px', fontSize: 13, cursor: 'pointer', background: 'transparent', border: '2px solid #35e0ff', color: '#35e0ff', borderRadius: 8, fontFamily: 'inherit', opacity: points.length === 0 ? 0.4 : 1 }}>
                  ↩ Undo
                </button>
                <button onClick={clear} disabled={points.length === 0}
                  style={{ padding: '8px 16px', fontSize: 13, cursor: 'pointer', background: 'transparent', border: '2px solid #8a8296', color: '#8a8296', borderRadius: 8, fontFamily: 'inherit', opacity: points.length === 0 ? 0.4 : 1 }}>
                  Clear
                </button>
                <button onClick={handleDone} disabled={!canProceed()}
                  style={{ flex: 1, padding: '8px 16px', fontSize: 14, cursor: canProceed() ? 'pointer' : 'not-allowed', background: canProceed() ? '#ffb02e' : '#3a3348', border: 'none', color: '#14101e', borderRadius: 8, fontWeight: 700, fontFamily: 'inherit', opacity: canProceed() ? 1 : 0.5 }}>
                  Done →
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{ padding: '16px' }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#35e0ff', marginBottom: 4, letterSpacing: '0.1em' }}>NAME</div>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lola's Depot"
                maxLength={80}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px', fontSize: 14, fontFamily: 'inherit', background: '#1e1830', color: '#f4f1e6', border: '2px solid #35e0ff', borderRadius: 8 }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#35e0ff', marginBottom: 4, letterSpacing: '0.1em' }}>TYPE</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {PLACE_TYPES.map((t) => (
                  <button key={t.value} onClick={() => setType(t.value)}
                    style={{ padding: '8px 14px', fontSize: 13, cursor: 'pointer', background: type === t.value ? '#ffb02e' : 'transparent', color: type === t.value ? '#14101e' : '#f4f1e6', border: '2px solid #ffb02e', borderRadius: 8, fontFamily: 'inherit', fontWeight: type === t.value ? 700 : 400 }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            {error && <div style={{ color: '#ff3da6', fontSize: 12, marginBottom: 8 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setStep('draw')}
                style={{ padding: '10px 20px', fontSize: 13, cursor: 'pointer', background: 'transparent', border: '2px solid #8a8296', color: '#8a8296', borderRadius: 8, fontFamily: 'inherit' }}>
                ← Back
              </button>
              <button onClick={handleSubmit}
                style={{ flex: 1, padding: '10px 20px', fontSize: 14, cursor: 'pointer', background: '#35e0ff', border: 'none', color: '#14101e', borderRadius: 8, fontWeight: 700, fontFamily: 'inherit' }}>
                Submit for Review
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#8a8296', marginTop: 12, textAlign: 'center' }}>
              A moderator will review your submission. You'll earn 🪙 5 coins if approved!
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
