import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { VillageScene } from './VillageScene.js';

export default function VillageCanvas({ room, profile, onLeave }) {
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  const [editorActive, setEditorActive] = useState(false);
  const [nearbyCount, setNearbyCount] = useState(0);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !room?.id) return;

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
      onNearbyChange: setNearbyCount,
      onChatMessage: (msg) => {
        setMessages((prev) => [...prev.slice(-9), msg]);
      },
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
      setNearbyCount(0);
      setMessages([]);
      setDraft('');
    };
  }, [room?.id, room?.name, room?.amenity, room?.shop, profile]);

  const toggleEditor = () => {
    const scene = gameRef.current?.scene?.getScene('VillageScene');
    if (scene?.sys?.isActive()) {
      scene.toggleEditor?.();
    }
  };

  const sendChat = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const scene = gameRef.current?.scene?.getScene('VillageScene');
    if (scene?.sys?.isActive()) {
      scene.sendChatMessage?.(text);
      setDraft('');
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

      <div style={{
        position: 'absolute',
        right: 'calc(12px + env(safe-area-inset-right, 0px))',
        top: isMobile ? 'calc(60px + env(safe-area-inset-top, 0px))' : 'auto',
        bottom: isMobile ? 'auto' : 'calc(64px + env(safe-area-inset-bottom, 0px))',
        width: 'min(280px, calc(100vw - 24px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        maxHeight: '45vh',
      }}>
        <div style={{
          background: '#0f172acc',
          border: '1px solid #334155',
          borderRadius: 6,
          padding: '6px 10px',
          color: nearbyCount > 0 ? '#4ade80' : '#64748b',
          fontFamily: 'Courier New, monospace',
          fontSize: 11,
        }}>
          {nearbyCount > 0 ? `Chat unlocked: ${nearbyCount} nearby` : 'Approach someone to chat'}
        </div>

        {messages.length > 0 && (
          <div style={{
            maxHeight: '22vh',
            overflowY: 'auto',
            background: '#0f172acc',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '8px 10px',
            fontFamily: 'Courier New, monospace',
            fontSize: 11,
            color: '#f8fafc',
          }}>
            {messages.map((m, i) => (
              <div key={`${m.timestamp || i}-${i}`} style={{ marginBottom: 4 }}>
                <strong style={{ color: m.isSelf ? '#fbbf24' : '#93c5fd' }}>{m.isSelf ? 'You' : m.senderName}</strong>
                <span style={{ color: '#64748b', fontSize: 10 }}> ({m.distance}px)</span>: {m.message}
              </div>
            ))}
          </div>
        )}

        <form onSubmit={sendChat} style={{ display: 'flex', gap: 6 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={nearbyCount > 0 ? 'Say something nearby…' : 'No one nearby'}
            disabled={nearbyCount === 0}
            style={{
              flex: 1,
              padding: '7px 10px',
              border: '1px solid #475569',
              borderRadius: 6,
              background: '#111827cc',
              color: '#f8fafc',
              fontFamily: 'Courier New, monospace',
              fontSize: 12,
            }}
          />
          <button
            type="submit"
            disabled={nearbyCount === 0 || !draft.trim()}
            style={{
              padding: '7px 12px',
              border: 'none',
              background: nearbyCount > 0 ? '#e2b46c' : '#475569',
              color: '#0f172a',
              cursor: nearbyCount > 0 ? 'pointer' : 'not-allowed',
              fontWeight: 'bold',
              fontFamily: 'Courier New, monospace',
              borderRadius: 6,
            }}
          >
            ↩
          </button>
        </form>
      </div>
    </div>
  );
}
