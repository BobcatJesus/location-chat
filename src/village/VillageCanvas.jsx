import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { VillageScene } from './VillageScene.js';

export default function VillageCanvas({ room, profile, onLeave }) {
  const containerRef = useRef(null);
  const gameRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const el = containerRef.current;
    const width = el.clientWidth || window.innerWidth;
    const height = el.clientHeight || window.innerHeight;

    VillageScene._boot = {
      roomId:     room?.id,
      roomName:   room?.name   || '',
      amenityTag: room?.amenity || '',
      shopTag:    room?.shop    || '',
      profile,
    };

    const config = {
      type: Phaser.AUTO,
      parent: el,
      width,
      height,
      backgroundColor: '#6aab45',
      scene: VillageScene,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <button
        onClick={onLeave}
        style={{
          position: 'absolute', top: 12, left: 12, zIndex: 1000,
          background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
          borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 14,
        }}
      >
        ← Leave
      </button>
    </div>
  );
}
