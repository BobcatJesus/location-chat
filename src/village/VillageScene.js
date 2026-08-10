import Phaser from 'phaser';
import { Actor } from './Actor.js';
import { DEPTH } from './depth.js';
import { io } from 'socket.io-client';
import { RoomLayout } from './RoomLayout.js';
import { pickLayout } from './layoutPicker.js';
import { RoomEditor } from './RoomEditor.js';
import { Prop, PROP_DEFS } from './Prop.js';

const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.PROD ? 'https://location-chat-production.up.railway.app' : 'http://localhost:4000');

const SPEED = 180;
const TICK_MS = 50; // position broadcast interval
const PROXIMITY_RADIUS = 150;
const SKIN_TINTS = {
  blue: 0x3b82f6,
  red: 0xe53e3e,
  green: 0x16a34a,
  purple: 0x7c3aed,
  orange: 0xea580c,
  pink: 0xec4899,
  teal: 0x0891b2,
  slate: 0x94a3b8,
};

const LEGACY_TYPE_TO_FRAME_KEY = {
  table: 'prop_table_round',
  chair: 'prop_chair_wooden',
  plant: 'prop_plant_potted',
  jukebox: 'prop_jukebox',
  rug: 'prop_rug_rolled',
  art: 'prop_portrait_framed',
};

export class VillageScene extends Phaser.Scene {
  constructor() { super({ key: 'VillageScene' }); }

  static _boot = null;

  init(data) {
    const d = VillageScene._boot || data;
    VillageScene._boot = null;
    this.roomId     = d.roomId     ?? 'default-room';
    this.roomName   = d.roomName   ?? '';
    this.amenityTag = d.amenityTag ?? '';
    this.shopTag    = d.shopTag    ?? '';
    this.profile    = d.profile    ?? {};
    this.skinId     = d.profile?.profile?.skinId ?? 'blue';
    this.onEditorChange = d.onEditorChange ?? (() => {});
    this.onNearbyChange = d.onNearbyChange ?? (() => {});
    this.onChatMessage = d.onChatMessage ?? (() => {});
  }

  preload() {
    const dirs = ['front', 'back', 'side'];
    dirs.forEach(d => {
      [1, 2].forEach(s => {
        this.load.image(`demon-${d}-step${s}`, `/village-sprites/characters/demon-${d}-step${s}.png`);
      });
    });
    this.load.atlas('props', '/assets/props/props.png', '/assets/props/props.json');
  }

  create() {
    const W = this.scale.width, H = this.scale.height;

    // Pick and draw layout
    this.layout = pickLayout(this.roomId, this.roomName, this.amenityTag, this.shopTag);
    console.log('[VillageScene] room:', this.roomId, '| name:', this.roomName, '| layout:', this.layout.id);
    this.roomLayout = new RoomLayout(this, this.layout);
    this.currentFloor = 0;
    this.roomLayout.drawFloor(0);

    // Initialize room editor (press E or use the UI toggle)
    this.roomEditor = new RoomEditor(this);
    this.customZones = [];
    this.onEditorChange(false);
    // Render any custom zones already saved
    this._propSprites = [];
    this._renderSavedProps();

    const spawn = this.layout.spawnF1 || { x: W / 2, y: H / 2 };

    // Local player
    this.player = new Actor({
      scene: this, texture: 'demon-front-step1',
      gx: spawn.x, gy: spawn.y, footprintWidth: 28, footprintHeight: 14, scale: 0.09,
    });
    this.player.sprite.setTint(SKIN_TINTS[this.skinId] || 0xffffff);

    // Coffee cup overhead (shown near café)
    this.coffeeCup = this.add.text(0, 0, '☕', { fontSize: '18px' })
      .setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Escalator debounce flag
    this._escalatorCooldown = 0;

    // Remote players map: socketId → Actor
    this.remotePlayers = new Map();
    this._nearbyCount = -1;

    // Walk animation state
    this.dir = 'front';
    this.stepFrame = 0;
    this.stepAccum = 0;
    this.STEP_MS = 200;

    // Position broadcast throttle
    this.tickAccum = 0;
    this.lastPos = { x: this.player.gx, y: this.player.gy };
    this._debug = {
      roomId: this.roomId,
      socketId: '',
      connected: false,
      roomStateCount: 0,
      remoteCount: 0,
      lastEvent: 'create',
      lastEventAt: Date.now(),
      lastDecorationEventAt: 0,
    };

    this._debugText = this.add.text(10, 10, '', {
      fontFamily: 'Courier New',
      fontSize: '12px',
      color: '#fef3c7',
      backgroundColor: '#111827cc',
      padding: { x: 6, y: 4 },
    })
      .setDepth(DEPTH.UI + 100)
      .setScrollFactor(0);
    this._refreshDebugText();

    // Camera
    this.cameras.main.startFollow(this.player.sprite, true, 0.1, 0.1);
    this.cameras.main.setZoom(1.8);
    const { FLOOR_W, FLOOR_H } = { FLOOR_W: 1600, FLOOR_H: 900 };
    this.cameras.main.setBounds(0, 0, FLOOR_W, FLOOR_H);

    // Input
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.wasd = this.input.keyboard?.addKeys('W,A,S,D');
    this._eKeyPressed = false;
    this._onKeyDown = (e) => {
      if (e.key === 'e' || e.key === 'E') {
        if (!this._eKeyPressed) {
          this._eKeyPressed = true;
          console.log('[VillageScene] E pressed — toggling editor');
          this.toggleEditor();
        }
      }
    };
    this._onKeyUp = (e) => { if (e.key === 'e' || e.key === 'E') this._eKeyPressed = false; };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    // Tap-to-move
    this.target = null;
    this.tapDot = this.add.circle(0, 0, 6, 0xffffff, 0).setDepth(DEPTH.OVERHEAD);
    this.input.on('pointerdown', (ptr) => {
      if (this.roomEditor?.isActive) return; // editor handles its own clicks
      this.target = { x: Phaser.Math.Clamp(ptr.worldX, 20, W * 4 - 20), y: Phaser.Math.Clamp(ptr.worldY, 60, H * 4 - 10) };
      this.tapDot.setPosition(ptr.worldX, ptr.worldY).setAlpha(0.7);
      this.tweens.add({ targets: this.tapDot, alpha: 0, duration: 400 });
    });

    // Connect Socket.IO
    this._connectSocket();
    this.onNearbyChange(0);
  }

  toggleEditor() {
    this.roomEditor?.toggle();
    this.onEditorChange(!!this.roomEditor?.isActive);
  }

  _connectSocket() {
    const socket = io(SOCKET_SERVER_URL, { transports: ['websocket'] });
    this.socket = socket;
    this._decorationSyncTimer = null;
    this._presenceSyncTimer = null;
    const userId = this.profile?.profile?.email || this.profile?.mode || 'guest';
    this.userId = userId;
    const userName = this.profile?.profile?.characterName || 'Traveler';
    const firstName = this.profile?.profile?.firstName || userName.split(' ')[0];

    socket.on('connect', () => {
      this._debug.socketId = socket.id || '';
      this._debug.connected = true;
      this._debug.lastEvent = 'connect';
      this._debug.lastEventAt = Date.now();
      socket.emit('join_room', {
        roomId: this.roomId,
        user: { id: userId, name: userName, firstName, skinId: this.skinId },
      });
      socket.emit('get_room_state', { roomId: this.roomId });
      socket.emit('get_room_decorations', { roomId: this.roomId });
      if (this._decorationSyncTimer) clearInterval(this._decorationSyncTimer);
      this._decorationSyncTimer = setInterval(() => {
        if (socket.connected) socket.emit('get_room_decorations', { roomId: this.roomId });
      }, 3000);
      if (this._presenceSyncTimer) clearInterval(this._presenceSyncTimer);
      this._presenceSyncTimer = setInterval(() => {
        if (socket.connected) socket.emit('get_room_state', { roomId: this.roomId });
      }, 1500);
    });

    socket.on('disconnect', () => {
      this._debug.connected = false;
      this._debug.lastEvent = 'disconnect';
      this._debug.lastEventAt = Date.now();
      if (this._decorationSyncTimer) {
        clearInterval(this._decorationSyncTimer);
        this._decorationSyncTimer = null;
      }
      if (this._presenceSyncTimer) {
        clearInterval(this._presenceSyncTimer);
        this._presenceSyncTimer = null;
      }
    });

    socket.on('room_state', (state) => {
      this._debug.roomStateCount = Object.keys(state || {}).length;
      this._debug.remoteCount = Math.max(0, this._debug.roomStateCount - 1);
      this._debug.lastEvent = 'room_state';
      this._debug.lastEventAt = Date.now();
      const nextIds = new Set(Object.keys(state || {}));
      this.remotePlayers.forEach((actor, sid) => {
        if (!nextIds.has(sid)) {
          actor.destroy();
          this.remotePlayers.delete(sid);
        }
      });
      Object.entries(state || {}).forEach(([sid, player]) => {
        if (sid === socket.id) return;
        const actor = this.remotePlayers.get(sid);
        if (actor) {
          actor.gx = player.x ?? actor.gx;
          actor.gy = player.y ?? actor.gy;
          actor.sync();
        } else {
          this._spawnRemote(sid, player);
        }
      });
    });

    socket.on('player_joined', ({ socketId, player }) => {
      this._debug.lastEvent = 'player_joined';
      this._debug.lastEventAt = Date.now();
      if (socketId !== socket.id) this._spawnRemote(socketId, player);
    });

    socket.on('player_moved', ({ socketId, x, y }) => {
      this._debug.lastEvent = 'player_moved';
      this._debug.lastEventAt = Date.now();
      const actor = this.remotePlayers.get(socketId);
      if (actor) { actor.gx = x; actor.gy = y; actor.sync(); }
    });

    socket.on('player_left', ({ socketId }) => {
      this._debug.lastEvent = 'player_left';
      this._debug.lastEventAt = Date.now();
      const actor = this.remotePlayers.get(socketId);
      if (actor) { actor.destroy(); this.remotePlayers.delete(socketId); }
    });

    socket.on('room_decorations', (items) => {
      this._debug.lastEvent = 'room_decorations';
      this._debug.lastEventAt = Date.now();
      this._debug.lastDecorationEventAt = Date.now();
      this.customZones = [];
      (items || []).forEach((item) => {
        const zone = this._normalizeDecoration(item);
        if (zone) this.customZones.push(zone);
      });
      this.roomEditor?.setZones(this.customZones);
      this._renderSavedProps();
    });

    socket.on('decoration_placed', (item) => {
      this._debug.lastEvent = 'decoration_placed';
      this._debug.lastEventAt = Date.now();
      this._debug.lastDecorationEventAt = Date.now();
      const zone = this._normalizeDecoration(item);
      if (!zone) return;
      if (this.customZones.some(z => z.id === zone.id)) return;
      this.customZones.push(zone);
      this.roomEditor?.setZones(this.customZones);
      this._renderSavedProps();
    });

    socket.on('decoration_removed', ({ id }) => {
      this._debug.lastEvent = 'decoration_removed';
      this._debug.lastEventAt = Date.now();
      this._debug.lastDecorationEventAt = Date.now();
      if (!id) return;
      this.customZones = this.customZones.filter(z => z.id !== id);
      this.roomEditor?.setZones(this.customZones);
      this._renderSavedProps();
    });

    socket.on('decoration_error', ({ message }) => {
      this._debug.lastEvent = 'decoration_error';
      this._debug.lastEventAt = Date.now();
      if (message) console.warn('[VillageScene] decoration_error:', message);
    });

    socket.on('receive_message', (payload) => {
      this._debug.lastEvent = 'receive_message';
      this._debug.lastEventAt = Date.now();
      if (!payload?.message || !payload?.position) return;
      const dx = payload.position.x - this.player.gx;
      const dy = payload.position.y - this.player.gy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= PROXIMITY_RADIUS) {
        this.onChatMessage({
          senderName: payload.senderName || 'Traveler',
          message: payload.message,
          isSelf: payload.socketId === socket.id,
          distance: Math.round(distance),
          timestamp: payload.timestamp || Date.now(),
        });
      }
    });
  }

  getDebugState() {
    return {
      roomId: this.roomId,
      socketId: this.socket?.id || this._debug?.socketId || '',
      connected: !!this.socket?.connected,
      roomStateCount: this._debug?.roomStateCount || 0,
      remoteCount: this.remotePlayers?.size || 0,
      decorationCount: this.customZones?.length || 0,
      lastEvent: this._debug?.lastEvent || '',
      lastEventAt: this._debug?.lastEventAt || 0,
      lastDecorationEventAt: this._debug?.lastDecorationEventAt || 0,
    };
  }

  _refreshDebugText() {
    if (!this._debugText) return;
    const s = this.getDebugState();
    this._debugText.setText([
      `NET ROOM: ${s.roomId || '--'}`,
      `PLAYERS: ${s.roomStateCount || 0}  REMOTE: ${s.remoteCount || 0}`,
      `SOCKET: ${s.socketId || '--'}`,
    ]);
  }

  sendChatMessage(message) {
    const text = (message || '').trim();
    if (!text || !this.socket?.connected) return;
    this.socket.emit('send_message', {
      roomId: this.roomId,
      message: text,
    });
  }

  placeDecoration(zone) {
    if (!this.socket?.connected) return;
    this.socket.emit('place_decoration', {
      roomId: this.roomId,
      item: {
        frameKey: zone.frameKey,
        type: zone.type || zone.frameKey,
        x: zone.x,
        y: zone.y,
        w: zone.w || 60,
        h: zone.h || 60,
      },
    });
  }

  removeDecoration(id) {
    if (!this.socket?.connected || !id) return;
    this.socket.emit('remove_decoration', {
      roomId: this.roomId,
      id,
    });
  }

  clearOwnDecorations() {
    this.customZones
      .filter(z => z.placedBy === this.userId)
      .forEach(z => this.removeDecoration(z.id));
  }

  _normalizeDecoration(item) {
    if (!item) return null;
    const frameKey = item.frameKey || LEGACY_TYPE_TO_FRAME_KEY[item.type] || null;
    if (!frameKey || !PROP_DEFS[frameKey]) return null;
    return {
      id: item.id,
      frameKey,
      type: item.type || frameKey,
      x: item.x,
      y: item.y,
      w: item.w || 60,
      h: item.h || 60,
      placedBy: item.placedBy,
    };
  }

  _spawnRemote(socketId, player) {
    if (this.remotePlayers.has(socketId)) return;
    const actor = new Actor({
      scene: this, texture: 'demon-front-step1',
      gx: player.x ?? 400, gy: player.y ?? 300,
      footprintWidth: 28, footprintHeight: 14, scale: 0.09,
    });
    actor.sprite.setTint(SKIN_TINTS[player?.skinId] || 0xffffff);
    this.remotePlayers.set(socketId, actor);
  }

  update(_t, delta) {

    this._refreshDebugText();

    const step = (SPEED * delta) / 1000;
    let dx = 0, dy = 0;

    const kbL = this.cursors?.left.isDown  || this.wasd?.A.isDown;
    const kbR = this.cursors?.right.isDown || this.wasd?.D.isDown;
    const kbU = this.cursors?.up.isDown    || this.wasd?.W.isDown;
    const kbD = this.cursors?.down.isDown  || this.wasd?.S.isDown;

    if (kbL || kbR || kbU || kbD) {
      this.target = null;
      if (kbL) dx -= 1; if (kbR) dx += 1;
      if (kbU) dy -= 1; if (kbD) dy += 1;
    } else if (this.target) {
      dx = this.target.x - this.player.gx;
      dy = this.target.y - this.player.gy;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) { this.target = null; } else { dx /= dist; dy /= dist; }
    }

    const W = this.scale.width, H = this.scale.height;
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      this.player.gx = Phaser.Math.Clamp(this.player.gx + (dx / len) * step, 20, W * 4 - 20);
      this.player.gy = Phaser.Math.Clamp(this.player.gy + (dy / len) * step, 60, H * 4 - 10);
      if (Math.abs(dy) >= Math.abs(dx)) { this.dir = dy > 0 ? 'front' : 'back'; } else { this.dir = 'side'; }
      this.stepAccum += delta;
      if (this.stepAccum >= this.STEP_MS) { this.stepAccum -= this.STEP_MS; this.stepFrame = 1 - this.stepFrame; }
    } else {
      this.stepFrame = 0; this.stepAccum = 0;
    }

    this.player.sprite.setTexture(`demon-${this.dir}-step${this.stepFrame + 1}`);
    this.player.sprite.setFlipX(this.dir === 'side' && dx < 0);
    this.player.sync();

    // Nearby count for chat gating UI
    let nearbyCount = 0;
    this.remotePlayers.forEach((actor) => {
      const ddx = this.player.gx - actor.gx;
      const ddy = this.player.gy - actor.gy;
      if (Math.sqrt(ddx * ddx + ddy * ddy) <= PROXIMITY_RADIUS) nearbyCount += 1;
    });
    if (nearbyCount !== this._nearbyCount) {
      this._nearbyCount = nearbyCount;
      this.onNearbyChange(nearbyCount);
    }

    // Coffee cup near café
    const nearCafe = this.roomLayout?.interactZones?.some(z =>
      z.type === 'cafe_counter' &&
      Math.abs(this.player.gx - (z.x + z.w / 2)) < 200 &&
      Math.abs(this.player.gy - (z.y + z.h / 2)) < 200
    );
    if (nearCafe) {
      this.coffeeCup.setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.coffeeCup.setAlpha(0);
    }

    // Escalator check
    this._escalatorCooldown = Math.max(0, this._escalatorCooldown - delta);
    if (this._escalatorCooldown === 0 && this.roomLayout) {
      const esc = this.roomLayout.checkEscalator(this.player.gx, this.player.gy);
      if (esc) {
        this._escalatorCooldown = 1500;
        this._switchFloor(esc.toFloor);
      }
    }

    // Broadcast position at tick rate
    this.tickAccum += delta;
    if (this.tickAccum >= TICK_MS && this.socket?.connected) {
      this.tickAccum = 0;
      const { gx, gy } = this.player;
      if (gx !== this.lastPos.x || gy !== this.lastPos.y) {
        this.socket.emit('send_move', { roomId: this.roomId, x: gx, y: gy, direction: this.dir });
        this.lastPos = { x: gx, y: gy };
      }
    }
  }

  _renderSavedProps() {
    this._propSprites.forEach(p => p.destroy());
    this._propSprites = [];
    if (!this.textures.exists('props')) return;
    (this.customZones || []).forEach(z => {
      if (z.frameKey) {
        this._propSprites.push(new Prop(this, z.x, z.y, z.frameKey));
      }
    });
  }

  shutdown() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.socket?.disconnect();
    if (this._decorationSyncTimer) {
      clearInterval(this._decorationSyncTimer);
      this._decorationSyncTimer = null;
    }
    if (this._presenceSyncTimer) {
      clearInterval(this._presenceSyncTimer);
      this._presenceSyncTimer = null;
    }
    this.remotePlayers.forEach(a => a.destroy());
    this.remotePlayers.clear();
    this.roomLayout?.destroy();
    this.roomEditor?.destroy();
    this._propSprites?.forEach(p => p.destroy());
    this.onEditorChange(false);
    this.onNearbyChange(0);
  }

  _switchFloor(floorIndex) {
    if (floorIndex === this.currentFloor) return;
    if (!this.layout.floors[floorIndex]) return;
    this.currentFloor = floorIndex;
    this.roomLayout.drawFloor(floorIndex);
    const spawn = floorIndex === 0
      ? (this.layout.spawnF1 || { x: 800, y: 750 })
      : (this.layout.spawnF2 || { x: 900, y: 370 });
    this.player.gx = spawn.x;
    this.player.gy = spawn.y;
    this.player.sync();
  }
}
