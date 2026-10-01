import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { WorldMapScene } from './WorldMapScene.js';

const spinnerStyle = `
@keyframes wm-spin { to { transform: rotate(360deg); } }
@keyframes wm-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
`;

export default function WorldMapCanvas({ location, rooms, onEnterRoom, profile }) {
  const containerRef = useRef(null);
  const gameRef      = useRef(null);
  const onEnterRef   = useRef(onEnterRoom);
  const roomsHashRef = useRef('');
  onEnterRef.current = onEnterRoom;

  const [loadState, setLoadState] = useState('gps'); // 'gps' | 'tiles' | 'ready'
  const [effectiveLoc, setEffectiveLoc] = useState(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState('');

  // Get GPS directly — bypasses the geofence hook which may stall on mobile
  useEffect(() => {
    if (!navigator.geolocation) {
      setEffectiveLoc({ latitude: 29.8368, longitude: -95.4201 });
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setEffectiveLoc({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => setEffectiveLoc({ latitude: 29.8368, longitude: -95.4201 }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
    // Fallback if GPS takes too long
    const t = setTimeout(() => {
      setEffectiveLoc(prev => prev || { latitude: 29.8368, longitude: -95.4201 });
    }, 15000);
    return () => { navigator.geolocation.clearWatch(watchId); clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (!effectiveLoc || gameRef.current || !containerRef.current) return;
    setLoadState('tiles');
    const el = containerRef.current;

    // Write boot data before game creation so WorldMapScene.init() can read it
    WorldMapScene._boot = {
      lat: effectiveLoc.latitude,
      lng: effectiveLoc.longitude,
      profile,
      rooms,
      onEnterRoom: (id, meta) => onEnterRef.current(id, meta),
      onReady: () => setLoadState('ready'),
    };

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: el,
      width: el.clientWidth || window.innerWidth,
      height: el.clientHeight || window.innerHeight,
      backgroundColor: '#f0ebe0',
      scene: WorldMapScene,
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    });
    gameRef.current = game;

    return () => { game.destroy(true); gameRef.current = null; };
  }, [!!effectiveLoc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Forward GPS updates to the running scene
  useEffect(() => {
    if (!effectiveLoc || !gameRef.current) return;
    const scene = gameRef.current.scene.getScene('WorldMapScene');
    if (scene?.sys?.isActive()) {
      scene.updateGPS(effectiveLoc.latitude, effectiveLoc.longitude);
    }
  }, [effectiveLoc?.latitude, effectiveLoc?.longitude]);

  useEffect(() => {
    if (!effectiveLoc || !gameRef.current) return;
    const nextHash = JSON.stringify((rooms || []).map((r) => `${r.id}:${r.lat}:${r.lng}:${r.radiusMeters}`).sort());
    if (roomsHashRef.current === nextHash) return;
    roomsHashRef.current = nextHash;

    const scene = gameRef.current.scene.getScene('WorldMapScene');
    if (scene?.sys?.isActive()) {
      setLoadState('tiles');
      scene.scene.restart({
        lat: effectiveLoc.latitude,
        lng: effectiveLoc.longitude,
        profile,
        rooms,
        onEnterRoom: (id, meta) => onEnterRef.current(id, meta),
        onReady: () => setLoadState('ready'),
      });
    }
  }, [rooms, profile, effectiveLoc]);

  const recenterToGPS = () => {
    if (!navigator.geolocation || gpsBusy) return;
    setGpsBusy(true);
    setGpsError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const next = { latitude: lat, longitude: lng };
        setEffectiveLoc(next);

        const scene = gameRef.current?.scene?.getScene('WorldMapScene');
        if (scene?.sys?.isActive()) {
          setLoadState('tiles');
          scene.scene.restart({
            lat,
            lng,
            profile,
            rooms,
            onEnterRoom: (id, meta) => onEnterRef.current(id, meta),
            onReady: () => setLoadState('ready'),
          });
        }

        setGpsBusy(false);
      },
      () => {
        setGpsBusy(false);
        setGpsError('GPS blocked or unavailable');
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const showOverlay = loadState !== 'ready';
  const msg = loadState === 'gps' ? 'Acquiring GPS… (or waiting for permission)' : 'Loading map…';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'linear-gradient(180deg, rgba(9,17,14,0.9), rgba(12,21,18,0.95))' }}>
      <style>{spinnerStyle}</style>
      {showOverlay && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14,
          background: 'radial-gradient(circle at center, rgba(17,28,23,0.75), rgba(7,19,15,0.94))',
          color: '#edf5f0',
          fontFamily: 'Space Grotesk, sans-serif', fontSize: 13, zIndex: 10,
          backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            border: '2px solid rgba(180,255,205,0.18)', borderTopColor: '#b8ff5c',
            animation: 'wm-spin 0.8s linear infinite',
          }} />
          <span style={{ animation: 'wm-pulse 1.4s ease-in-out infinite', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a7bdb0' }}>{msg}</span>
          {loadState === 'gps' && (
            <button
              type="button"
              onClick={() => setEffectiveLoc({ latitude: 29.8368, longitude: -95.4201 })}
              style={{
                marginTop: 8, background: 'rgba(184,255,92,0.12)', color: '#edf5f0',
                border: '1px solid rgba(184,255,92,0.35)', borderRadius: 999, padding: '9px 18px',
                fontFamily: 'DM Mono, monospace', fontSize: 11, cursor: 'pointer',
                letterSpacing: '0.08em', textTransform: 'uppercase',
              }}
            >
              Load without GPS
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={recenterToGPS}
        disabled={gpsBusy}
        style={{
          position: 'absolute',
          right: 12,
          top: 'calc(12px + env(safe-area-inset-top, 0px))',
          zIndex: 12,
          background: 'rgba(16,27,23,0.8)',
          color: '#edf5f0',
          border: '1px solid rgba(180,255,205,0.16)',
          borderRadius: 12,
          padding: '9px 12px',
          fontFamily: 'DM Mono, monospace',
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: gpsBusy ? 'default' : 'pointer',
          opacity: gpsBusy ? 0.6 : 1,
          boxShadow: '0 10px 24px rgba(0,0,0,0.2)',
        }}
      >
        {gpsBusy ? 'Locating…' : 'Recenter to GPS'}
      </button>
      {gpsError && (
        <div style={{
          position: 'absolute',
          right: 12,
          top: 'calc(52px + env(safe-area-inset-top, 0px))',
          zIndex: 12,
          background: 'rgba(16,27,23,0.8)',
          color: '#ffd9dc',
          border: '1px solid rgba(255,107,114,0.32)',
          borderRadius: 12,
          padding: '7px 10px',
          fontFamily: 'DM Mono, monospace',
          fontSize: 10,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          {gpsError}
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
