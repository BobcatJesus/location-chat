import Phaser from 'phaser';
import { DEPTH } from './depth.js';
import { io } from 'socket.io-client';
import { RoomLayout } from './RoomLayout.js';
import { pickLayout } from './layoutPicker.js';
import { RoomEditor } from './RoomEditor.js';
import { Prop, PROP_DEFS } from './Prop.js';
import { createAvatarEntity, normalizeAvatarModel, preloadAvatarTextures } from '../game/entities/avatarFactory';

const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.PROD ? 'https://location-chat-production.up.railway.app' : 'http://localhost:4000');

const SPEED = 180;
const TICK_MS = 50; // position broadcast interval
const PROXIMITY_RADIUS = 150;
const DECOR_SYNC_MS = 8000;
const PRESENCE_SYNC_MS = 4000;
const DECOR_SYNC_HEALTHY_MS = 30000;
const PRESENCE_SYNC_HEALTHY_MS = 20000;
function normalizeAvatarState(source = {}) {
  return {
    photo: source.photo || null,
    avatarModel: normalizeAvatarModel(source.avatarModel),
    skinId: source.skinId || 'slate',
    hairStyle: source.hairStyle || 'combed',
    bodyType: source.bodyType || 'standard',
    skinTone: source.skinTone ?? source.pigment ?? 45,
    hairHue: source.hairHue ?? source.eyeHue ?? 26,
    outfitHue: source.outfitHue ?? source.scarfHue ?? 220,
    topStyle: source.topStyle || 'hoodie',
    bottomStyle: source.bottomStyle || 'pants',
    footwear: source.footwear || 'sneakers',
    glasses: Boolean(source.glasses),
    hasScythe: Boolean(source.hasScythe),
  };
}

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
    this.avatarState = normalizeAvatarState(d.profile?.profile || {});
    this.onEditorChange = d.onEditorChange ?? (() => {});
    this.onNearbyChange = d.onNearbyChange ?? (() => {});
    this.onChatMessage = d.onChatMessage ?? (() => {});
  }

  preload() {
    preloadAvatarTextures(this);
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
    const displayName = this.profile?.profile?.characterName || this.profile?.mode || 'Traveler';
    const firstName = this.profile?.profile?.firstName || displayName.split(' ')[0] || 'You';
    const localAvatar = createAvatarEntity(this, spawn.x, spawn.y, {
      ...this.avatarState,
      name: firstName,
      isLocal: true,
    });
    if (this.avatarState.photo) localAvatar.attachPhoto(this, this.avatarState.photo);
    this.player = {
      gx: spawn.x,
      gy: spawn.y,
      avatar: localAvatar,
      facingLeft: false,
      sync: () => {
        localAvatar.setPosition(this.player.gx, this.player.gy);
        localAvatar.setDepth(DEPTH.ACTOR_MIN + Math.round(this.player.gy));
        localAvatar.syncLabel();
      },
      destroy: () => {
        localAvatar.destroy();
      },
    };
    this.player.sync();

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

    // Position broadcast throttle
    this.tickAccum = 0;
    this.lastPos = { x: this.player.gx, y: this.player.gy };

    // Camera
    this.cameras.main.startFollow(this.player.avatar, true, 0.1, 0.1);
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
    this._fallbackSyncTimer = null;
    this._lastDecorSyncAt = 0;
    this._lastPresenceSyncAt = 0;
    const userId = this.profile?.profile?.email || this.profile?.mode || 'guest';
    this.userId = userId;
    const userName = this.profile?.profile?.characterName || 'Traveler';
    const firstName = this.profile?.profile?.firstName || userName.split(' ')[0];

    socket.on('connect', () => {
      socket.emit('join_room', {
        roomId: this.roomId,
        user: {
          id: userId,
          name: userName,
          firstName,
          ...this.avatarState,
        },
      });
      socket.emit('get_room_state', { roomId: this.roomId });
      socket.emit('get_room_decorations', { roomId: this.roomId });
      const now = Date.now();
      this._lastPresenceSyncAt = now;
      this._lastDecorSyncAt = now;
      if (this._fallbackSyncTimer) clearInterval(this._fallbackSyncTimer);
      this._fallbackSyncTimer = setInterval(() => this._runFallbackSync(), 1000);
    });

    socket.on('disconnect', () => {
      if (this._fallbackSyncTimer) {
        clearInterval(this._fallbackSyncTimer);
        this._fallbackSyncTimer = null;
      }
    });

    socket.on('room_state', (state) => {
      const nextIds = new Set(Object.keys(state || {}));
      this.remotePlayers.forEach((remotePlayer, sid) => {
        if (!nextIds.has(sid)) {
          remotePlayer.destroy();
          this.remotePlayers.delete(sid);
        }
      });
      Object.entries(state || {}).forEach(([sid, player]) => {
        if (sid === socket.id) return;
        const remotePlayer = this.remotePlayers.get(sid);
        if (remotePlayer) {
          const prevX = remotePlayer.gx;
          const prevY = remotePlayer.gy;
          remotePlayer.gx = player.x ?? remotePlayer.gx;
          remotePlayer.gy = player.y ?? remotePlayer.gy;
          const ddx = remotePlayer.gx - prevX;
          const ddy = remotePlayer.gy - prevY;
          if (Math.abs(ddx) > 0.5 || Math.abs(ddy) > 0.5) {
            remotePlayer.movingUntil = this.time.now + 220;
            if (Math.abs(ddy) >= Math.abs(ddx)) {
              remotePlayer.dir = ddy > 0 ? 'front' : 'back';
            } else {
              remotePlayer.dir = 'side';
              remotePlayer.facingLeft = ddx < 0;
            }
          }
          remotePlayer.sync();
        } else {
          this._spawnRemote(sid, player);
        }
      });
    });

    socket.on('player_joined', ({ socketId, player }) => {
      if (socketId !== socket.id) this._spawnRemote(socketId, player);
    });

    socket.on('player_moved', ({ socketId, x, y }) => {
      const remotePlayer = this.remotePlayers.get(socketId);
      if (remotePlayer) {
        const ddx = x - remotePlayer.gx;
        const ddy = y - remotePlayer.gy;
        if (Math.abs(ddy) >= Math.abs(ddx)) {
          remotePlayer.dir = ddy > 0 ? 'front' : 'back';
        } else {
          remotePlayer.dir = 'side';
          remotePlayer.facingLeft = ddx < 0;
        }
        remotePlayer.movingUntil = this.time.now + 220;
        remotePlayer.gx = x;
        remotePlayer.gy = y;
        remotePlayer.sync();
      }
    });

    socket.on('player_left', ({ socketId }) => {
      const remotePlayer = this.remotePlayers.get(socketId);
      if (remotePlayer) { remotePlayer.destroy(); this.remotePlayers.delete(socketId); }
    });

    socket.on('room_decorations', (items) => {
      this.customZones = [];
      (items || []).forEach((item) => {
        const zone = this._normalizeDecoration(item);
        if (zone) this.customZones.push(zone);
      });
      this.roomEditor?.setZones(this.customZones);
      this._renderSavedProps();
    });

    socket.on('decoration_placed', (item) => {
      const zone = this._normalizeDecoration(item);
      if (!zone) return;
      if (this.customZones.some(z => z.id === zone.id)) return;
      this.customZones.push(zone);
      this.roomEditor?.setZones(this.customZones);
      this._renderSavedProps();
    });

    socket.on('decoration_removed', ({ id }) => {
      if (!id) return;
      this.customZones = this.customZones.filter(z => z.id !== id);
      this.roomEditor?.setZones(this.customZones);
      this._renderSavedProps();
    });

    socket.on('decoration_error', ({ message }) => {
      if (message) console.warn('[VillageScene] decoration_error:', message);
    });

    socket.on('receive_message', (payload) => {
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
    const avatarState = normalizeAvatarState(player);
    const avatar = createAvatarEntity(this, player.x ?? 400, player.y ?? 300, {
      ...avatarState,
      name: player?.firstName || player?.name || 'Traveler',
      isLocal: false,
    });
    if (avatarState.photo) avatar.attachPhoto(this, avatarState.photo);
    const remotePlayer = {
      gx: player.x ?? 400,
      gy: player.y ?? 300,
      avatar,
      dir: 'front',
      facingLeft: false,
      movingUntil: 0,
      sync: () => {
        avatar.setPosition(remotePlayer.gx, remotePlayer.gy);
        avatar.setDepth(DEPTH.ACTOR_MIN + Math.round(remotePlayer.gy));
        avatar.syncLabel();
      },
      destroy: () => {
        avatar.destroy();
      },
    };
    remotePlayer.sync();
    this.remotePlayers.set(socketId, remotePlayer);
  }

  _runFallbackSync() {
    const socket = this.socket;
    if (!socket?.connected) return;
    const now = Date.now();
    const hasRemotePlayers = this.remotePlayers.size > 0;

    const presenceEveryMs = hasRemotePlayers ? PRESENCE_SYNC_HEALTHY_MS : PRESENCE_SYNC_MS;
    const decorEveryMs = hasRemotePlayers ? DECOR_SYNC_HEALTHY_MS : DECOR_SYNC_MS;

    if (now - this._lastPresenceSyncAt >= presenceEveryMs) {
      socket.emit('get_room_state', { roomId: this.roomId });
      this._lastPresenceSyncAt = now;
    }
    if (now - this._lastDecorSyncAt >= decorEveryMs) {
      socket.emit('get_room_decorations', { roomId: this.roomId });
      this._lastDecorSyncAt = now;
    }
  }

  update(_t, delta) {

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
      if (Math.abs(dy) >= Math.abs(dx)) {
        this.dir = dy > 0 ? 'front' : 'back';
      } else {
        this.dir = 'side';
        this.player.facingLeft = dx < 0;
      }
    } else {
      // no-op
    }

    this.player.avatar.setMovementState({
      moving: Boolean(dx || dy),
      direction: this.dir,
      facingLeft: this.player.facingLeft,
    });
    this.player.avatar.tick(delta);
    this.player.sync();

    this.remotePlayers.forEach((remotePlayer) => {
      remotePlayer.avatar.setMovementState({
        moving: this.time.now < (remotePlayer.movingUntil || 0),
        direction: remotePlayer.dir || 'front',
        facingLeft: Boolean(remotePlayer.facingLeft),
      });
      remotePlayer.avatar.tick(delta);
    });

    // Nearby count for chat gating UI
    let nearbyCount = 0;
    this.remotePlayers.forEach((remotePlayer) => {
      const ddx = this.player.gx - remotePlayer.gx;
      const ddy = this.player.gy - remotePlayer.gy;
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
    if (this._fallbackSyncTimer) {
      clearInterval(this._fallbackSyncTimer);
      this._fallbackSyncTimer = null;
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
