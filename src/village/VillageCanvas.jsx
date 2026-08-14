import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { VillageScene } from './VillageScene.js';

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'room';
}

function canonicalRoomId(room) {
  if (!room) return null;
  const rawId = String(room.id || '').trim();
  if (rawId) return rawId;

  const hasCoords = Number.isFinite(room.lat) && Number.isFinite(room.lng);
  if (hasCoords) {
    // Coarser precision avoids tiny GPS drift creating separate rooms.
    const lat = Number(room.lat).toFixed(3);
    const lng = Number(room.lng).toFixed(3);
    return `geo-${lat}-${lng}`;
  }

  const nameKey = slugify(room.name || room.shop || room.amenity || 'room');
  return `name-${nameKey}`;
}

export default function VillageCanvas({ room, profile, onLeave }) {
  const BASE_WIDTH = 1600;
  const BASE_HEIGHT = 900;
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const [editorActive, setEditorActive] = useState(false);
  const [nearbyCount, setNearbyCount] = useState(0);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [showEditHint, setShowEditHint] = useState(false);
  const [systemNotice, setSystemNotice] = useState('');
  const [roomPopulation, setRoomPopulation] = useState(1);
  const [cameraMode, setCameraMode] = useState('wide-follow');
  const roomId = canonicalRoomId(room);

  const zoomLabel = cameraMode === 'overview'
    ? 'Overview'
    : cameraMode === 'wide-follow'
      ? 'Wide'
      : 'Follow';
  const isOutdoorRoom = (room = {}) => {
    const amenity = String(room.amenity || '').toLowerCase();
    const shop = String(room.shop || '').toLowerCase();
    const text = `${room.id || ''} ${room.name || ''}`.toLowerCase();
    return amenity === 'park'
      || amenity === 'garden'
      || amenity === 'nature_reserve'
      || shop === 'park'
      || text.includes('park')
      || text.includes('garden')
      || text.includes('trail')
      || text.includes('greenway');
  };
  const outdoorMode = isOutdoorRoom(room);

  useEffect(() => {
    window.__chatInputFocused = false;
    return () => { window.__chatInputFocused = false; };
  }, []);

  useEffect(() => {
    setShowEditHint(true);
    const timer = setTimeout(() => setShowEditHint(false), 7000);
    return () => clearTimeout(timer);
  }, [roomId]);

  useEffect(() => {
    setCameraMode('wide-follow');
  }, [roomId]);

  useEffect(() => {
    if (!containerRef.current || !roomId) return;

    const el = containerRef.current;

    VillageScene._boot = {
      roomId,
      roomName:   room?.name   || '',
      roomOwnerId: room?.ownerId || '',
      amenityTag: room?.amenity || '',
      shopTag:    room?.shop    || '',
      roomShape:  room?.footprint || null,
      profile,
      preferredCameraMode: 'wide-follow',
      onEditorChange: setEditorActive,
      onNearbyChange: setNearbyCount,
      onRoomPopulationChange: (count) => {
        setRoomPopulation(Math.max(0, Number(count) || 0));
      },
      onChatMessage: (msg) => {
        setMessages((prev) => [...prev.slice(-9), msg]);
      },
      onSystemNotice: (message) => {
        if (!message) return;
        setSystemNotice(message);
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = setTimeout(() => setSystemNotice(''), 2600);
      },
    };

    const config = {
      type: Phaser.AUTO,
      parent: el,
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
      backgroundColor: '#0f172a',
      scene: VillageScene,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
      setEditorActive(false);
      setNearbyCount(0);
      setMessages([]);
      setDraft('');
      setSystemNotice('');
      setRoomPopulation(1);
      setCameraMode('wide-follow');
    };
  }, [roomId, room?.name, room?.amenity, room?.shop, profile]);

  const toggleEditor = () => {
    const scene = gameRef.current?.scene?.getScene('VillageScene');
    if (scene?.sys?.isActive()) {
      scene.toggleEditor?.();
      setShowEditHint(false);
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

  const toggleZoom = () => {
    const scene = gameRef.current?.scene?.getScene('VillageScene');
    if (!scene?.sys?.isActive()) return;
    const nextMode = scene.toggleCameraMode?.();
    if (nextMode) setCameraMode(nextMode);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {showEditHint && (
        <div style={{
          position: 'absolute',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1001,
          background: '#0f172aee',
          border: '1px solid #334155',
          borderRadius: 8,
          padding: '8px 12px',
          color: '#e2e8f0',
          fontFamily: 'Courier New, monospace',
          fontSize: 12,
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        }}>
          {outdoorMode ? 'Outdoor Edit Mode' : 'Edit Mode'}: press <strong>~</strong> to toggle
        </div>
      )}
      {systemNotice && (
        <div style={{
          position: 'absolute',
          top: showEditHint ? 52 : 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1002,
          background: '#7f1d1dcc',
          border: '1px solid #ef4444',
          borderRadius: 8,
          padding: '8px 12px',
          color: '#fee2e2',
          fontFamily: 'Courier New, monospace',
          fontSize: 12,
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        }}>
          {systemNotice}
        </div>
      )}
      <div style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 1000,
        display: 'flex',
        gap: 6,
        flexWrap: 'nowrap',
      }}>
        <button
          onClick={onLeave}
          style={{
            background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            minHeight: 0,
            cursor: 'pointer',
            fontSize: 14,
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
            minHeight: 0,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 'bold',
          }}
        >
          {editorActive ? 'Done' : (outdoorMode ? 'Outdoor Edit' : 'Edit')}
        </button>
        <button
          onClick={toggleZoom}
          style={{
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            minHeight: 0,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 'bold',
          }}
        >
          Zoom: {zoomLabel}
        </button>
      </div>

      <div style={{
        position: 'absolute',
        top: 52,
        left: 12,
        zIndex: 1000,
        background: '#0f172acc',
        border: '1px solid #334155',
        borderRadius: 6,
        padding: '5px 8px',
        color: '#cbd5e1',
        fontFamily: 'Courier New, monospace',
        fontSize: 11,
      }}>
        Press ~ to toggle {outdoorMode ? 'Outdoor Edit Mode' : 'Edit Mode'}
      </div>

      <div style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 1000,
        background: '#0f172acc',
        border: '1px solid #334155',
        borderRadius: 8,
        padding: '6px 10px',
        color: '#e2e8f0',
        fontFamily: 'Courier New, monospace',
        fontSize: 11,
        fontWeight: 'bold',
      }}>
        In room: {roomPopulation}
      </div>

      <div style={{
        position: 'absolute',
        right: 12,
        left: 'auto',
        bottom: 64,
        width: 'min(280px, calc(100vw - 24px))',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        maxHeight: '45vh',
        overflowY: 'visible',
        paddingBottom: 0,
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

        <form onSubmit={sendChat} style={{ display: 'flex', gap: 6, position: 'sticky', bottom: 0, background: 'linear-gradient(180deg, rgba(15,23,42,0.25) 0%, rgba(15,23,42,0.92) 60%)', paddingTop: 4 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => { window.__chatInputFocused = true; }}
            onBlur={() => { window.__chatInputFocused = false; }}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
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
