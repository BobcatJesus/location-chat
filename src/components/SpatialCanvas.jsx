import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { io } from 'socket.io-client';

const SOCKET_SERVER_URL = 'http://localhost:4000';

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
        const label = sprite.getData('label');
        if (label) {
          label.setPosition(sprite.x, sprite.y - 20);
        }
        return;
      }

      // Create pixel art character using container and rectangles
      const playerGroup = scene.add.container(player.x, player.y);
      playerGroup.add([
        scene.add.rectangle(0, -5, 6, 5, 0x64b5f6), // Head (light blue)
        scene.add.rectangle(0, 2, 8, 6, 0x7dd3fc), // Body (cyan)
        scene.add.rectangle(-6, 2, 2, 3, 0x60a5fa), // Left arm
        scene.add.rectangle(4, 2, 2, 3, 0x60a5fa), // Right arm
        scene.add.rectangle(-3, 8, 2, 3, 0x3b82f6), // Left leg
        scene.add.rectangle(1, 8, 2, 3, 0x3b82f6) // Right leg
      ]);
      
      playerGroup.setData('name', player.name || 'Traveler');
      playerGroup.setData('socketId', socketId);
      
      const label = scene.add.text(playerGroup.x, playerGroup.y - 20, player.name || 'Traveler', {
        fontFamily: 'Courier New',
        fontSize: '10px',
        color: '#fef3c7',
        backgroundColor: '#111827',
        padding: { x: 2, y: 1 },
        align: 'center'
      }).setOrigin(0.5);
      
      playerGroup.setData('label', label);
      
      // Add physics body for collision detection
      scene.physics.add.existing(playerGroup);
      playerGroup.body.setCircle(8); // Collision radius
      playerGroup.body.setCollideWorldBounds(true);
      playerGroup.body.setBounce(0);
      playerGroup.setData('physicsBody', playerGroup.body);
      
      remotePlayersRef.current.set(socketId, playerGroup);
    };

    const removeRemoteSprite = (socketId) => {
      const sprite = remotePlayersRef.current.get(socketId);
      if (sprite) {
        const label = sprite.getData('label');
        label?.destroy();
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
      width: window.innerWidth,
      height: window.innerHeight,
      parent: 'phaser-container',
      pixelArt: true,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
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

          // Ground tiles
          const tileSize = 32;
          for (let row = 0; row < Math.ceil(H / tileSize); row++) {
            for (let col = 0; col < Math.ceil(W / tileSize); col++) {
              const color = (row + col) % 2 === 0 ? 0x2d5a1b : 0x3a7a24;
              this.add.rectangle(col * tileSize + tileSize / 2, row * tileSize + tileSize / 2, tileSize, tileSize, color);
            }
          }

          // Border wall
          const wallColor = 0x5c3d1e;
          const wallThick = 8;
          this.add.rectangle(W / 2, wallThick / 2, W, wallThick, wallColor);
          this.add.rectangle(W / 2, H - wallThick / 2, W, wallThick, wallColor);
          this.add.rectangle(wallThick / 2, H / 2, wallThick, H, wallColor);
          this.add.rectangle(W - wallThick / 2, H / 2, wallThick, H, wallColor);

          // Realm name label
          this.add.text(16, 12, `⚔ ${room ? room.name : 'Unknown'}`, {
            fontFamily: 'Courier New',
            fontSize: '14px',
            color: '#fef3c7',
            backgroundColor: '#00000088',
            padding: { x: 6, y: 3 },
          });

          // WASD hint
          this.add.text(W / 2, H - 6, 'WASD / arrows to move', {
            fontFamily: 'Courier New',
            fontSize: '10px',
            color: '#fef3c7aa',
          }).setOrigin(0.5, 1);

          // Local player spawns at canvas center
          const playerGroup = this.add.container(W / 2, H / 2);
          playerGroup.add([
            this.add.rectangle(0, -5, 6, 5, 0xfbbf24),
            this.add.rectangle(0, 2, 8, 6, 0xfde047),
            this.add.rectangle(-6, 2, 2, 3, 0xfcd34d),
            this.add.rectangle(4, 2, 2, 3, 0xfcd34d),
            this.add.rectangle(-3, 8, 2, 3, 0xfbbf24),
            this.add.rectangle(1, 8, 2, 3, 0xfbbf24),
          ]);

          // "YOU" label that follows the local player
          const youLabel = this.add.text(W / 2, H / 2 - 20, 'YOU', {
            fontFamily: 'Courier New',
            fontSize: '10px',
            color: '#fef3c7',
            backgroundColor: '#00000088',
            padding: { x: 2, y: 1 },
          }).setOrigin(0.5);
          playerGroup.setData('youLabel', youLabel);

          localPlayerRef.current = playerGroup;

          this.physics.add.existing(playerGroup);
          playerGroup.body.setCircle(8);
          playerGroup.body.setCollideWorldBounds(true);
          playerGroup.body.setBounce(0);
          playerGroup.setData('physicsBody', playerGroup.body);

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

              localPlayerPosRef.current = { x: localPlayerRef.current.x, y: localPlayerRef.current.y };
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
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#111', overflow: 'hidden' }}>

      {/* Game canvas — fills the whole screen */}
      <div id="phaser-container" style={{ position: 'absolute', inset: 0, outline: 'none' }}
        onClick={(e) => e.currentTarget.querySelector('canvas')?.focus()}
        ref={(el) => {
          if (el) {
            const canvas = el.querySelector('canvas');
            if (canvas && !canvas.getAttribute('tabindex')) {
              canvas.setAttribute('tabindex', '0');
              canvas.style.outline = 'none';
              canvas.style.width = '100%';
              canvas.style.height = '100%';
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
        style={{ position: 'absolute', top: 10, right: 10, background: '#e2b46c', border: 'none', padding: '6px 14px', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'Courier New' }}
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
