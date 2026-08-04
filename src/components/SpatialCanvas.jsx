import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { io } from 'socket.io-client';
import ModularAvatar from '../game/entities/ModularAvatar';

const SOCKET_SERVER_URL = process.env.NODE_ENV === 'production'
  ? 'https://location-chat-production.up.railway.app'
  : 'http://localhost:4000';

export const AVATAR_SKINS = [
  { id: 'blue',   label: 'Ocean',   shirt: 0x3b82f6, pants: 0x1e3a5f, hair: 0x7c4a1e, swatch: '#3b82f6' },
  { id: 'red',    label: 'Ember',   shirt: 0xe53e3e, pants: 0x4a1a1a, hair: 0x2d1a0e, swatch: '#e53e3e' },
  { id: 'green',  label: 'Forest',  shirt: 0x16a34a, pants: 0x0a2a10, hair: 0x5c3d1e, swatch: '#16a34a' },
  { id: 'purple', label: 'Dusk',    shirt: 0x7c3aed, pants: 0x2a0a5a, hair: 0x2d1a0e, swatch: '#7c3aed' },
  { id: 'orange', label: 'Blaze',   shirt: 0xea580c, pants: 0x3a1a0a, hair: 0x7c4a1e, swatch: '#ea580c' },
  { id: 'pink',   label: 'Sakura',  shirt: 0xec4899, pants: 0x4a1a2a, hair: 0x7c4a1e, swatch: '#ec4899' },
  { id: 'teal',   label: 'Tide',    shirt: 0x0891b2, pants: 0x0a2a3a, hair: 0x2d1a0e, swatch: '#0891b2' },
  { id: 'slate',  label: 'Shadow',  shirt: 0x475569, pants: 0x111827, hair: 0xd1d5db, swatch: '#475569' },
];

export default function SpatialCanvas({ room, profile, onLeave }) {
  const gameRef = useRef(null);
  const socketRef = useRef(null);
  const sceneRef = useRef(null);
  const localPlayerRef = useRef(null);
  const remotePlayersRef = useRef(new Map());
  const playersRef = useRef({});
  const inputRef = useRef(null);
  const lastMoveAtRef = useRef(0);

  const [players, setPlayers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [connectionState, setConnectionState] = useState('Connecting…');
  const [nearbyCount, setNearbyCount] = useState(0);
  const localPlayerPosRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const PROXIMITY_RADIUS = 150;

  useEffect(() => {
    const socket = io(SOCKET_SERVER_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    const displayName = profile?.profile?.characterName || profile?.mode || 'Guest';
    const playerId = profile?.profile?.email || `guest-${socket.id}`;

    const syncPlayerList = (state) => {
      const nextPlayers = Object.entries(state || {}).map(([socketId, player]) => ({ socketId, ...player }));
      playersRef.current = Object.fromEntries(nextPlayers.map((player) => [player.socketId, player]));
      setPlayers(nextPlayers.filter((player) => player.socketId !== socket.id));
    };

    const ensureRemoteSprite = (socketId, player) => {
      const scene = sceneRef.current;
      if (!scene || !player || socketId === socket.id) return;

      if (remotePlayersRef.current.has(socketId)) {
        const sprite = remotePlayersRef.current.get(socketId);
        sprite.x = player.x;
        sprite.y = player.y;
        sprite.syncLabel();
        return;
      }

      // Remote player — built from ModularAvatar class
      const playerGroup = new ModularAvatar(scene, player.x, player.y, {
        skinId: player.skinId || 'red',
        name: player.name || 'Traveler',
        isLocal: false,
      });
      if (player.photo) playerGroup.attachPhoto(scene, player.photo);

      scene.physics.add.existing(playerGroup);
      playerGroup.body.setCircle(8);
      playerGroup.body.setCollideWorldBounds(true);
      playerGroup.body.setBounce(0);

      remotePlayersRef.current.set(socketId, playerGroup);
    };

    const removeRemoteSprite = (socketId) => {
      const sprite = remotePlayersRef.current.get(socketId);
      if (sprite) {
        sprite.destroy();
        remotePlayersRef.current.delete(socketId);
      }
    };

    const syncRemotePlayers = (state) => {
      const currentIds = new Set(Object.keys(state || {}));
      for (const id of remotePlayersRef.current.keys()) {
        if (!currentIds.has(id)) {
          removeRemoteSprite(id);
        }
      }
      Object.entries(state || {}).forEach(([socketId, player]) => {
        if (socketId !== socket.id) {
          ensureRemoteSprite(socketId, player);
        }
      });
      syncPlayerList(state);
    };

    socket.on('connect', () => {
      setConnectionState('Connected');
      socket.emit('join_room', {
        roomId: room?.id || 'default-room',
        user: {
          id: playerId,
          name: displayName,
          photo: profile?.profile?.photo || null,
          skinId: profile?.profile?.skinId || 'blue',
        },
      });
    });

    socket.on('connect_error', () => {
      setConnectionState('Connection failed');
    });

    socket.on('room_state', (state) => {
      syncRemotePlayers(state);
    });

    socket.on('player_joined', ({ socketId, player }) => {
      if (socketId === socket.id) return;
      const nextPlayer = { socketId, ...player };
      const nextState = { ...playersRef.current, [socketId]: nextPlayer };
      syncRemotePlayers(nextState);
    });

    socket.on('player_moved', ({ socketId, x, y }) => {
      if (socketId === socket.id) return;
      const playerState = playersRef.current[socketId];
      if (playerState) {
        const nextPlayer = { ...playerState, x, y };
        playersRef.current[socketId] = nextPlayer;
        setPlayers(Object.values(playersRef.current).filter((player) => player.socketId !== socket.id));
        ensureRemoteSprite(socketId, nextPlayer);
      }
    });

    socket.on('player_left', ({ socketId }) => {
      if (playersRef.current[socketId]) {
        delete playersRef.current[socketId];
        setPlayers(Object.values(playersRef.current).filter((player) => player.socketId !== socket.id));
      }
      removeRemoteSprite(socketId);
    });

    socket.on('receive_message', (payload) => {
      if (payload.position) {
        const dx = payload.position.x - localPlayerPosRef.current.x;
        const dy = payload.position.y - localPlayerPosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= PROXIMITY_RADIUS) {
          setMessages((prev) => [...prev.slice(-9), { ...payload, distance: Math.round(distance) }]);
        }
      } else {
        setMessages((prev) => [...prev.slice(-9), payload]);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setMessages([]);
      setPlayers([]);
      remotePlayersRef.current.forEach((sprite) => sprite.destroy());
      remotePlayersRef.current.clear();
    };
  }, [room?.id, profile?.profile?.email, profile?.profile?.characterName, profile?.mode]);

  useEffect(() => {
    const config = {
      type: Phaser.AUTO,
      width: '100%',
      height: '100%',
      parent: 'phaser-container',
      pixelArt: true,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%',
      },
      physics: {
        default: 'arcade',
        arcade: {
          debug: false,
          gravity: { y: 0 },
        },
      },
      scene: {
        create() {
          sceneRef.current = this;
          const W = this.scale.width;
          const H = this.scale.height;
          const T = 32; // tile size

          // --- Environment themes per room ---
          const themes = {
            'downtown-hub':  { floor1: 0x2a2a2e, floor2: 0x323238, accent: 0x4a4a52, wall: 0x1a1a1e, decor: 0x5c5c6a },
            'forest-gate':   { floor1: 0x1a3a10, floor2: 0x143008, accent: 0x4a7a20, wall: 0x2d1a08, decor: 0x5a3a10 },
            'sunset-temple': { floor1: 0x2a1a3a, floor2: 0x1e1228, accent: 0x7a3a6a, wall: 0x4a1a3a, decor: 0x9a5a8a },
            'campfire-circle': { floor1: 0x2a1a0a, floor2: 0x1e1208, accent: 0x6a3a1a, wall: 0x3a1a08, decor: 0x8a5a2a },
            'your-room':     { floor1: 0x0a1828, floor2: 0x0c1e30, accent: 0x1a3a5a, wall: 0x0a1020, decor: 0x2a4a6a },
          };
          const th = themes[room?.id] || themes['your-room'];

          // Base floor tiles
          for (let row = 0; row < Math.ceil(H / T); row++) {
            for (let col = 0; col < Math.ceil(W / T); col++) {
              const color = (row + col) % 2 === 0 ? th.floor1 : th.floor2;
              this.add.rectangle(col * T + T / 2, row * T + T / 2, T, T, color);
            }
          }

          // Subtle inner grid lines
          for (let x = T; x < W; x += T) {
            this.add.rectangle(x, H / 2, 1, H, th.accent, 0.25);
          }
          for (let y = T; y < H; y += T) {
            this.add.rectangle(W / 2, y, W, 1, th.accent, 0.25);
          }

          // Room-specific decorations
          const roomId = room?.id || 'your-room';

          if (roomId === 'downtown-hub') {
            // Stone path across center
            for (let i = 2; i < Math.ceil(W / T) - 2; i++) {
              this.add.rectangle(i * T + T / 2, H / 2, T, T * 3, 0x3a3a42).setAlpha(0.6);
            }
            // Street lights
            [[100, 100], [W - 100, 100], [100, H - 100], [W - 100, H - 100]].forEach(([x, y]) => {
              this.add.rectangle(x, y + 8, 4, 24, 0x888890);
              this.add.circle(x, y - 2, 7, 0xffee88).setAlpha(0.9);
              this.add.circle(x, y - 2, 12, 0xffee88).setAlpha(0.2);
            });
            // Benches
            [[180, 160], [W - 180, 160], [180, H - 160], [W - 180, H - 160]].forEach(([x, y]) => {
              this.add.rectangle(x, y, 24, 8, 0x8B6914);
              this.add.rectangle(x, y - 6, 24, 4, 0x6B4A10);
            });

          } else if (roomId === 'forest-gate') {
            // Tree clusters
            const trees = [[80,80],[150,120],[W-90,90],[W-160,70],[60,H-80],[200,H-110],[W-80,H-90],[W-200,H-70],[W/2-100,60],[W/2+80,H-70]];
            trees.forEach(([x, y]) => {
              this.add.circle(x, y + 6, 14, 0x1a3a10);
              this.add.circle(x, y, 18, 0x2d6e1a);
              this.add.circle(x, y - 4, 13, 0x4a9a2a);
              this.add.rectangle(x, y + 20, 6, 14, 0x5c3d1e);
            });
            // Dirt path
            for (let i = 0; i < 12; i++) {
              const px = (W / 13) * (i + 1);
              this.add.ellipse(px, H / 2, T - 4, T / 2, 0x5c3d1e).setAlpha(0.5);
            }
            // Flowers
            [[200,200],[300,350],[W-200,250],[W/2,150]].forEach(([x,y]) => {
              this.add.circle(x, y, 4, 0xffaacc);
              this.add.circle(x, y, 2, 0xffee44);
            });

          } else if (roomId === 'sunset-temple') {
            // Stone floor pattern
            for (let row = 1; row < Math.ceil(H / T) - 1; row++) {
              for (let col = 1; col < Math.ceil(W / T) - 1; col++) {
                if ((row + col) % 4 === 0) {
                  this.add.rectangle(col * T + T / 2, row * T + T / 2, T - 2, T - 2, 0x4a1a6a).setAlpha(0.4);
                }
              }
            }
            // Pillars
            [[80,80],[W-80,80],[80,H-80],[W-80,H-80]].forEach(([x,y]) => {
              this.add.rectangle(x, y, 20, 20, 0x6a2a8a);
              this.add.rectangle(x, y, 16, 16, 0x8a4aaa);
              this.add.rectangle(x, y, 8, 8, 0xaa6acc);
              this.add.circle(x, y, 14, 0xaa6acc).setAlpha(0.15);
            });
            // Altar center
            this.add.circle(W / 2, H / 2, 40, 0x4a1a6a).setAlpha(0.5);
            this.add.circle(W / 2, H / 2, 28, 0x6a3a8a).setAlpha(0.6);
            this.add.circle(W / 2, H / 2, 10, 0xcc88ee).setAlpha(0.8);

          } else if (roomId === 'campfire-circle') {
            // Central fire
            this.add.circle(W / 2, H / 2, 30, 0x3a1a08).setAlpha(0.8);
            this.add.circle(W / 2, H / 2, 16, 0xff6600).setAlpha(0.9);
            this.add.circle(W / 2, H / 2, 10, 0xffaa00);
            this.add.circle(W / 2, H / 2, 5, 0xffee88);
            // Glow halo
            this.add.circle(W / 2, H / 2, 70, 0xff6600).setAlpha(0.06);
            // Logs
            this.add.rectangle(W / 2 - 12, H / 2 + 2, 24, 6, 0x5c3d1e).setAngle(20);
            this.add.rectangle(W / 2 + 8, H / 2 + 2, 24, 6, 0x5c3d1e).setAngle(-30);
            // Stones ring
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              this.add.circle(W / 2 + Math.cos(a) * 35, H / 2 + Math.sin(a) * 35, 5, 0x6a5a4a);
            }
            // Log seats around fire
            [[W/2-90, H/2-50],[W/2+90, H/2-50],[W/2-90, H/2+50],[W/2+90, H/2+50]].forEach(([x,y]) => {
              this.add.rectangle(x, y, 30, 12, 0x5c3d1e);
              this.add.rectangle(x, y - 5, 30, 6, 0x8B6914);
            });

          } else {
            // your-room: minimal grid with glowing center
            this.add.circle(W / 2, H / 2, 80, 0x1a3a5a).setAlpha(0.2);
            this.add.circle(W / 2, H / 2, 40, 0x2a5a8a).setAlpha(0.15);
            // Corner markers
            [[T*2,T*2],[W-T*2,T*2],[T*2,H-T*2],[W-T*2,H-T*2]].forEach(([x,y]) => {
              this.add.rectangle(x, y, 12, 12, 0x2a4a6a);
              this.add.rectangle(x, y, 6, 6, 0x4a8aaa);
            });
          }

          // Border wall
          const wt = 8;
          this.add.rectangle(W / 2, wt / 2, W, wt, th.wall);
          this.add.rectangle(W / 2, H - wt / 2, W, wt, th.wall);
          this.add.rectangle(wt / 2, H / 2, wt, H, th.wall);
          this.add.rectangle(W - wt / 2, H / 2, wt, H, th.wall);

          // Inner wall highlight
          this.add.rectangle(W / 2, wt + 1, W, 2, th.decor).setAlpha(0.4);
          this.add.rectangle(W / 2, H - wt - 1, W, 2, th.decor).setAlpha(0.4);

          // Realm name label
          this.add.text(16, 12, room?.name || 'Unknown', {
            fontFamily: 'Courier New', fontSize: '13px',
            color: '#fef3c7', backgroundColor: '#00000099',
            padding: { x: 8, y: 4 },
          });

          // WASD hint
          this.add.text(W / 2, H - 6, 'WASD / arrows to move', {
            fontFamily: 'Courier New', fontSize: '10px',
            color: '#ffffff55',
          }).setOrigin(0.5, 1);

          // Local player — built from ModularAvatar class
          const playerGroup = new ModularAvatar(this, W / 2, H / 2, {
            skinId: profile?.profile?.skinId || 'blue',
            name: profile?.profile?.characterName || 'YOU',
            isLocal: true,
          });
          if (profile?.profile?.photo) playerGroup.attachPhoto(this, profile.profile.photo);

          localPlayerRef.current = playerGroup;

          this.physics.add.existing(playerGroup);
          playerGroup.body.setCircle(8);
          playerGroup.body.setCollideWorldBounds(true);
          playerGroup.body.setBounce(0);

          this.input.keyboard.createCursorKeys();
        },
        update() {
          const speed = 160 / 60;
          if (!localPlayerRef.current) return;
          // Don't move while the chat input is focused
          const active = document.activeElement;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
          const cursors = this.input.keyboard.createCursorKeys();
          
          let moveX = 0;
          let moveY = 0;

          if (cursors.left.isDown || this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A).isDown) {
            moveX = -speed;
          } else if (cursors.right.isDown || this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D).isDown) {
            moveX = speed;
          }

          if (cursors.up.isDown || this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W).isDown) {
            moveY = -speed;
          } else if (cursors.down.isDown || this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S).isDown) {
            moveY = speed;
          }

          if (moveX !== 0 || moveY !== 0) {
            const nextX = localPlayerRef.current.x + moveX;
            const nextY = localPlayerRef.current.y + moveY;
            
            // Check collision with remote players before moving
            let canMove = true;
            const COLLISION_DISTANCE = 16; // Avatar size + small buffer
            
            for (const remotePlayer of remotePlayersRef.current.values()) {
              const dx = nextX - remotePlayer.x;
              const dy = nextY - remotePlayer.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              if (distance < COLLISION_DISTANCE) {
                canMove = false;
                break;
              }
            }
            
            if (canMove) {
              localPlayerRef.current.x = nextX;
              localPlayerRef.current.y = nextY;

              // Clamp to canvas bounds (inside border wall)
              localPlayerRef.current.x = Math.max(16, Math.min((sceneRef.current?.scale?.width ?? 640) - 16, localPlayerRef.current.x));
              localPlayerRef.current.y = Math.max(16, Math.min((sceneRef.current?.scale?.height ?? 480) - 16, localPlayerRef.current.y));

              // Keep "YOU" label above the local avatar
              const youLabel = localPlayerRef.current.getData('youLabel');
              if (youLabel) youLabel.setPosition(localPlayerRef.current.x, localPlayerRef.current.y - 20);

              // Keep photo above label
              localPlayerPosRef.current = { x: localPlayerRef.current.x, y: localPlayerRef.current.y };
              localPlayerRef.current.syncLabel();
            }
          }

          // Recount nearby players each frame so chat UI reacts to proximity
          let nearby = 0;
          for (const rp of remotePlayersRef.current.values()) {
            const dx = localPlayerRef.current.x - rp.x;
            const dy = localPlayerRef.current.y - rp.y;
            if (Math.sqrt(dx * dx + dy * dy) <= 150) nearby++;
          }
          setNearbyCount(nearby);

          // Separate all remote players from each other
          const remotePlayers = Array.from(remotePlayersRef.current.values());
          for (let i = 0; i < remotePlayers.length; i++) {
            for (let j = i + 1; j < remotePlayers.length; j++) {
              const p1 = remotePlayers[i];
              const p2 = remotePlayers[j];
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              const COLLISION_DISTANCE = 16;
              
              if (distance < COLLISION_DISTANCE && distance > 0) {
                const angle = Math.atan2(dy, dx);
                const overlap = COLLISION_DISTANCE - distance;
                const push = overlap / 2 + 0.5;
                
                p1.x -= Math.cos(angle) * push;
                p1.y -= Math.sin(angle) * push;
                p2.x += Math.cos(angle) * push;
                p2.y += Math.sin(angle) * push;
              }
            }
          }

          if (Date.now() - lastMoveAtRef.current > 80) {
            const socket = socketRef.current;
            if (socket && socket.connected) {
              socket.emit('send_move', {
                roomId: room?.id || 'default-room',
                x: localPlayerRef.current.x,
                y: localPlayerRef.current.y,
                direction: moveX < 0 ? 'left' : moveX > 0 ? 'right' : 'idle',
              });
              lastMoveAtRef.current = Date.now();
            }
          }
        },
      },
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    // Auto-focus the canvas so WASD works immediately on room entry
    const focusTimer = setTimeout(() => {
      document.getElementById('phaser-container')?.querySelector('canvas')?.focus();
    }, 300);

    return () => {
      clearTimeout(focusTimer);
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
      localPlayerRef.current = null;
    };
  }, [room?.id, room?.name]);

  const handleSendMessage = (event) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;

    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('send_message', {
        roomId: room?.id || 'default-room',
        message: trimmed,
      });
    }
    setDraft('');
    // Return focus to canvas so WASD works immediately after sending
    document.getElementById('phaser-container')?.querySelector('canvas')?.focus();
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#111', overflow: 'hidden' }}>

      {/* Game canvas — fills the container */}
      <div id="phaser-container" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', outline: 'none' }}
        onClick={(e) => e.currentTarget.querySelector('canvas')?.focus()}
        ref={(el) => {
          if (el) {
            const canvas = el.querySelector('canvas');
            if (canvas && !canvas.getAttribute('tabindex')) {
              canvas.setAttribute('tabindex', '0');
              canvas.style.outline = 'none';
            }
          }
        }}
      ></div>

      {/* Top-left HUD: room name + status */}
      <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: '8px', alignItems: 'center', pointerEvents: 'none' }}>
        <div style={{ background: '#00000099', color: '#e2b46c', fontFamily: 'Courier New', fontSize: '12px', padding: '4px 10px', border: '1px solid #e2b46c' }}>
          {connectionState} · {players.length + 1} in room
        </div>
      </div>

      {/* Top-right: exit button */}
      <button
        onClick={onLeave}
        style={{ position: 'absolute', top: 10, right: 10, zIndex: 50, background: '#e2b46c', border: 'none', padding: '6px 14px', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'Courier New', whiteSpace: 'nowrap' }}
      >
        ← Exit
      </button>

      {/* Bottom-right overlay: nearby travelers + chat */}
      <div style={{ position: 'absolute', bottom: 12, right: 12, width: 280, display: 'flex', flexDirection: 'column', gap: '6px' }}>

        {/* Nearby travelers */}
        {players.length > 0 && (
          <div style={{ background: '#0f172acc', border: '1px solid #334155', borderRadius: '6px', padding: '8px 10px' }}>
            <div style={{ fontSize: '10px', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '4px' }}>Nearby</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {players.map((player) => (
                <div key={player.socketId} style={{ fontSize: '12px', color: '#f8fafc', background: '#1e293b', border: '1px solid #475569', borderRadius: '4px', padding: '2px 7px' }}>
                  {player.name || 'Traveler'}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages — only when someone is in range */}
        {nearbyCount > 0 && messages.length > 0 && (
          <div style={{ background: '#0f172acc', border: '1px solid #334155', borderRadius: '6px', padding: '8px 10px', maxHeight: 160, overflowY: 'auto' }}>
            {messages.map((message, index) => (
              <div key={`${message.socketId}-${message.timestamp || index}`} style={{ marginBottom: '4px', color: '#f8fafc', fontSize: '12px', fontFamily: 'Courier New' }}>
                <strong style={{ color: message.socketId === socketRef.current?.id ? '#fbbf24' : '#93c5fd' }}>
                  {message.socketId === socketRef.current?.id ? 'You' : message.senderName || 'Traveler'}
                </strong>
                {message.distance !== undefined && <span style={{ color: '#64748b', fontSize: '10px' }}> ({message.distance}px)</span>}
                : {message.message}
              </div>
            ))}
          </div>
        )}

        {/* Chat input — only when someone is in range */}
        {nearbyCount > 0 ? (
        <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '6px' }}>
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Say something nearby…"
            style={{ flex: 1, padding: '7px 10px', border: '1px solid #475569', borderRadius: '6px', background: '#111827cc', color: '#f8fafc', fontFamily: 'Courier New', fontSize: '12px' }}
            onBlur={() => document.getElementById('phaser-container')?.querySelector('canvas')?.focus()}
          />
          <button type="submit" style={{ padding: '7px 12px', border: 'none', background: '#e2b46c', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'Courier New' }}>
            ↩
          </button>
        </form>
        ) : (
          <div style={{ background: '#0f172acc', border: '1px solid #334155', borderRadius: '6px', padding: '8px 10px', color: '#64748b', fontFamily: 'Courier New', fontSize: '11px', textAlign: 'center' }}>
            approach someone to chat
          </div>
        )}
      </div>
    </div>
  );
}
