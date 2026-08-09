import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { VillageScene } from './VillageScene.js';

export default function VillageCanvas({ room, profile, onLeave }) {
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  const [editorActive, setEditorActive] = useState(false);

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
      onEditorChange: setEditorActive,
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
      setEditorActive(false);
    };
  }, []);

  const toggleEditor = () => {
    const scene = gameRef.current?.scene?.getScene('VillageScene');
    if (scene?.sys?.isActive()) {
      scene.toggleEditor?.();
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute',
        top: 'calc(12px + env(safe-area-inset-top, 0px))',
        left: 'calc(12px + env(safe-area-inset-left, 0px))',
        zIndex: 1000,
        display: 'flex',
        gap: 8,
      }}>
        <button
          onClick={onLeave}
          style={{
            background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
            borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 14,
          }}
        >
          ← Leave
        </button>
        <button
          onClick={toggleEditor}
          style={{
            background: editorActive ? '#fbbf24' : 'rgba(0,0,0,0.55)',
            color: editorActive ? '#000' : '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 'bold',
          }}
        >
          {editorActive ? 'Done' : 'Edit'}
        </button>
      </div>
    </div>
  );
}
