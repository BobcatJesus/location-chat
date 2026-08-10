import Phaser from 'phaser';
import { latLngToWorld, tileUrl, TILE_SIZE } from './tileUtils.js';
import { getDistanceMeters } from '../geo.js';
import { createAvatarEntity, normalizeAvatarModel } from '../game/entities/avatarFactory.js';

const GRID = 5;          // 5×5 tile pool — 25 requests vs 49 for 7×7
const HALF = Math.floor(GRID / 2);
const ENTRY_RADIUS = 90; // metres — must be near this to enter a POI

// Storybook building colours (warm pastels + charcoal outline)
const C_CREAM    = 0xfef3c7;
const C_BLUSH    = 0xfce7f3;
const C_BUTTER   = 0xfef9c3;
const C_SAGE     = 0xd1fae5;
const C_LAVENDER = 0xede9fe;
const C_OUTLINE  = 0x2b2b33;
function normalizeAvatarState(source = {}) {
  return {
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
    photo: source.photo || null,
  };
}

function buildingFill(tags = {}) {
  const a = tags.amenity, s = tags.shop, l = tags.leisure;
  if (['cafe','restaurant','fast_food','bar','pub','food_court','juice_bar'].includes(a)) return C_BLUSH;
  if (s) return C_BUTTER;
  if (['park','garden','playground','nature_reserve'].includes(l)) return C_SAGE;
  if (['library','school','theatre','cinema','place_of_worship','arts_centre'].includes(a)) return C_LAVENDER;
  return C_CREAM;
}

export class WorldMapScene extends Phaser.Scene {
  constructor() { super('WorldMapScene'); }

  // Static boot data written by React before game creation to avoid timing issues
  static _boot = null;

  init(data) {
    const d = WorldMapScene._boot || data;
    WorldMapScene._boot = null;
    this.initLat     = d.lat;
    this.initLng     = d.lng;
    this.profile     = d.profile || {};
    this.avatarState = normalizeAvatarState(d.profile?.profile || {});
    this.rooms       = d.rooms || [];
    this.onEnterRoom = d.onEnterRoom || (() => {});
    this.onReady     = d.onReady || (() => {});
    // Keep refs for scene.restart in updateGPS
    this._rooms       = this.rooms;
    this._onEnterRoom = this.onEnterRoom;
    this._onReady     = this.onReady;
    this.currentLat  = d.lat;
    this.currentLng  = d.lng;
    this._readyFired = false;
  }

  preload() {
    const dirs = ['front', 'back', 'side'];
    dirs.forEach((d) => {
      [1, 2].forEach((s) => {
        this.load.image(`demon-${d}-step${s}`, `/village-sprites/characters/demon-${d}-step${s}.png`);
      });
    });
  }

  create() {
    this.originWorld = latLngToWorld(this.initLat, this.initLng);

    // Generate placeholder tile texture — __DEFAULT doesn't exist in Phaser 4
    const ph = this.make.graphics({ add: false });
    ph.fillStyle(0xfff6e4, 1);
    ph.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    ph.generateTexture('_tile_ph', TILE_SIZE, TILE_SIZE);
    ph.destroy();

    // ── Tile pool ──────────────────────────────────────────────────────────────
    this.tileMeshes  = [];
    this.tileAssigned = []; // key currently on each mesh slot
    this.texLoaded   = new Set();

    for (let i = 0; i < GRID * GRID; i++) {
      const img = this.add.image(0, 0, '_tile_ph')
        .setDisplaySize(TILE_SIZE, TILE_SIZE)
        .setDepth(-10000);
      this.tileMeshes.push(img);
      this.tileAssigned.push(null);
    }

    // ── Building graphics ──────────────────────────────────────────────────────
    this.buildingGfx = this.add.graphics().setDepth(-9000);

    // ── Player ─────────────────────────────────────────────────────────────────
    const displayName = this.profile?.profile?.characterName || this.profile?.mode || 'Traveler';
    const firstName = this.profile?.profile?.firstName || displayName.split(' ')[0] || 'You';
    this.playerAvatar = createAvatarEntity(this, 0, 0, {
      ...this.avatarState,
      name: firstName,
      isLocal: true,
    });
    if (this.avatarState.photo) this.playerAvatar.attachPhoto(this, this.avatarState.photo);
    this.playerAvatar.setDepth(1000);

    this.dir = 'front'; this.stepFrame = 0; this.stepAccum = 0;
    this.facingLeft = false;
    this.isMoving = false;

    // ── POI pins ───────────────────────────────────────────────────────────────
    this.poiList = []; // { container, circle, label, lat, lng, roomId, isOSM }

    // ── Status overlay (debug) ─────────────────────────────────────────────────
    this._statusText = this.add.text(8, this.scale.height - 8, 'Map loading…', {
      fontSize: '10px', fontFamily: 'Courier New, monospace',
      color: '#ffffff', backgroundColor: '#00000088', padding: { x: 6, y: 4 },
    }).setDepth(9999999).setScrollFactor(0).setOrigin(0, 1);

    // ── Camera ─────────────────────────────────────────────────────────────────
    this.cameras.main.startFollow(this.playerAvatar, true, 0.08, 0.08);

    this._lastCenterTX = null;
    this._lastCenterTY = null;
    this._refreshTiles(0, 0);

    // Dismiss spinner immediately — tiles and OSM data load in the background
    this.onReady();
    this._readyFired = true;

    // Manual preset rooms
    this.rooms.forEach(r => {
      if (r.lat && r.lng) this._addPin(r.lat, r.lng, r.name, r.emoji || '📍', r.color || '#a78bfa', r.id, false);
    });

    this._fetchMapData(this.initLat, this.initLng);
  }

  _setStatus(msg) {
    if (this._statusText) this._statusText.setText(msg);
    console.log('[WorldMap]', msg);
  }

  // ── Public API (called from React) ──────────────────────────────────────────

  updateGPS(lat, lng) {
    const absNew = latLngToWorld(lat, lng);
    const nx = absNew.x - this.originWorld.x;
    const ny = absNew.y - this.originWorld.y;

    // If real GPS puts us more than 1 tile away from where the map is loaded, restart
    const tileThreshold = TILE_SIZE * 2;
    if (Math.abs(nx - this.playerAvatar.x) > tileThreshold ||
      Math.abs(ny - this.playerAvatar.y) > tileThreshold) {
      console.log('[WorldMap] GPS far from loaded area — recentering map');
      this.scene.restart({ lat, lng, rooms: this._rooms, onEnterRoom: this._onEnterRoom, onReady: this._onReady });
      return;
    }

    const dx = nx - this.playerAvatar.x;
    const dy = ny - this.playerAvatar.y;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      this.isMoving = true;
      if (Math.abs(dy) >= Math.abs(dx)) {
        this.dir = dy > 0 ? 'front' : 'back';
      } else {
        this.dir = 'side';
        this.facingLeft = dx < 0;
      }
    } else {
      this.isMoving = false;
    }

    this.playerAvatar.setMovementState({
      moving: this.isMoving,
      direction: this.dir,
      facingLeft: this.facingLeft,
    });

    if (this._moveTween) this._moveTween.stop();
    this._moveTween = this.tweens.add({
      targets: [this.playerAvatar],
      x: nx, y: ny, duration: 900, ease: 'Linear',
      onUpdate: () => this.playerAvatar.syncLabel(),
      onComplete: () => {
        this.isMoving = false;
      },
    });

    this.currentLat = lat;
    this.currentLng = lng;
    this._refreshTiles(nx, ny);
    this._updatePOIStates(lat, lng);

    if (this._lastBuildFetch) {
      if (getDistanceMeters(lat, lng, this._lastBuildFetch.lat, this._lastBuildFetch.lng) > 250) {
        this._fetchMapData(lat, lng);
      }
    }
  }

  // ── Tile management ──────────────────────────────────────────────────────────

  _refreshTiles(sceneX, sceneY) {
    const absX = this.originWorld.x + sceneX;
    const absY = this.originWorld.y + sceneY;
    const ctx = Math.floor(absX / TILE_SIZE);
    const cty = Math.floor(absY / TILE_SIZE);
    if (ctx === this._lastCenterTX && cty === this._lastCenterTY) return;
    this._lastCenterTX = ctx;
    this._lastCenterTY = cty;

    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const idx = row * GRID + col;
        const tx = ctx - HALF + col;
        const ty = cty - HALF + row;
        const key = `t17_${tx}_${ty}`;
        const mesh = this.tileMeshes[idx];

        // Reposition in scene coords
        mesh.setPosition(
          tx * TILE_SIZE + TILE_SIZE / 2 - this.originWorld.x,
          ty * TILE_SIZE + TILE_SIZE / 2 - this.originWorld.y,
        );

        if (this.tileAssigned[idx] === key) continue;
        this.tileAssigned[idx] = key;

        if (this.texLoaded.has(key)) {
          mesh.setTexture(key).setAlpha(1).setTint(0xfff6e4);
        } else {
          mesh.setAlpha(0);
          this._loadTex(key, tx, ty).then(k => {
            if (!k || this.tileAssigned[idx] !== k) return;
            mesh.setTexture(k).setAlpha(1).setTint(0xfff6e4);
          });
        }
      }
    }
  }

  _loadTex(key, tx, ty) {
    return new Promise(resolve => {
      if (this.textures.exists(key)) { this.texLoaded.add(key); resolve(key); return; }
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.src = tileUrl(tx, ty);
      img.onload = () => {
        if (!this.textures.exists(key)) this.textures.addImage(key, img);
        this.texLoaded.add(key);
        resolve(key);
      };
      img.onerror = () => resolve(null);
    });
  }

  // ── Single Overpass fetch: buildings + POIs together ────────────────────────

  async _fetchMapData(lat, lng) {
    this._lastBuildFetch = { lat, lng };

    const cacheZ = 14;
    const cacheN = 1 << cacheZ;
    const cacheTX = Math.floor((lng + 180) / 360 * cacheN);
    const cacheTY = Math.floor((0.5 - Math.log((1 + Math.sin(lat * Math.PI / 180)) / (1 - Math.sin(lat * Math.PI / 180))) / (4 * Math.PI)) * cacheN);
    const cacheKey = `sidequest_mapdata_v2_${cacheTX}_${cacheTY}`;
    const TTL = 24 * 60 * 60 * 1000;

    // Serve from cache instantly when available
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { ts, elements } = JSON.parse(cached);
        if (Date.now() - ts < TTL) {
          this._setStatus('Cache hit — loading…');
          this._drawBuildings(elements.filter(el => el.type === 'way' && el.geometry));
          this._placePOINodes(elements.filter(el => el.type === 'node' || (el.type === 'way' && el.center)), lat, lng);
          this._setStatus(`Loaded ${this.poiList.length} places (cached)`);
          return;
        }
      }
    } catch { /* ignore */ }

    const ar600 = `(around:600,${lat},${lng})`;
    const ar450 = `(around:450,${lat},${lng})`;
    const endpoints = [
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass-api.de/api/interpreter',
    ];

    this._setStatus('Fetching nearby places…');
    const t0 = Date.now();

    // ── Phase 1: POI nodes + way centroids (fast, small payload) ──────────────
    const nodeQ = [
      `[out:json][timeout:8];(`,
      `node["amenity"~"cafe|restaurant|fast_food|bar|pub|library|theatre|cinema|school|gym|marketplace"]${ar600};`,
      `node["shop"~"supermarket|convenience|bakery|deli|books|music|art|clothes|wine"]${ar600};`,
      `node["leisure"~"park|garden|playground|sports_centre|marina|golf_course"]${ar600};`,
      `node["tourism"~"museum|gallery|viewpoint|artwork"]${ar600};`,
      `way["amenity"~"cafe|restaurant|fast_food|bar|pub|library|theatre|cinema|school|gym|marketplace"]${ar600};`,
      `way["shop"~"supermarket|convenience|bakery|deli|books|music|art|clothes|wine"]${ar600};`,
      `way["leisure"~"park|garden|playground|sports_centre"]${ar600};`,
      `);out center;`,
    ].join('');

    let nodeElements = [];
    for (const ep of endpoints) {
      try {
        const res = await fetch(`${ep}?data=${encodeURIComponent(nodeQ)}`);
        if (!res.ok) continue;
        nodeElements = (await res.json()).elements || [];
        break;
      } catch { continue; }
    }
    this._placePOINodes(nodeElements, lat, lng);
    this._setStatus(`${this.poiList.length} places loaded (${((Date.now()-t0)/1000).toFixed(1)}s) — loading buildings…`);

    // ── Phase 2: Building footprints, hard 8s abort ───────────────────────────
    const buildQ = `[out:json][timeout:8];way["building"]${ar450};out geom;`;
    let buildElements = [];
    for (const ep of endpoints) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(`${ep}?data=${encodeURIComponent(buildQ)}`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        buildElements = (await res.json()).elements || [];
        break;
      } catch { continue; }
    }
    this._drawBuildings(buildElements);
    this._setStatus(`✓ ${this.poiList.length} places · ${buildElements.length} buildings (${((Date.now()-t0)/1000).toFixed(1)}s)`);

    // Cache combined result for next visit
    const all = [...nodeElements, ...buildElements];
    if (all.length) {
      try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), elements: all })); } catch { /* storage full */ }
    }
  }

  _drawBuildings(elements) {
    this.buildingGfx.clear();
    elements.forEach(el => {
      const geom = el.geometry;
      if (!geom || geom.length < 3) return;
      const pts = geom.map(n => ({
        x: latLngToWorld(n.lat, n.lon).x - this.originWorld.x,
        y: latLngToWorld(n.lat, n.lon).y - this.originWorld.y,
      }));
      const fill = buildingFill(el.tags || {});
      this.buildingGfx.fillStyle(fill, 1);
      this.buildingGfx.lineStyle(1.5, C_OUTLINE, 1);
      this.buildingGfx.beginPath();
      this.buildingGfx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) this.buildingGfx.lineTo(pts[i].x, pts[i].y);
      this.buildingGfx.closePath();
      this.buildingGfx.fillPath();
      this.buildingGfx.strokePath();
    });
  }

  // ── Place POI node elements from merged fetch ────────────────────────────────

  _placePOINodes(nodes, lat, lng) {
    // Remove stale OSM pins before re-placing
    this.poiList.filter(p => p.isOSM).forEach(p => p.container.destroy());
    this.poiList = this.poiList.filter(p => !p.isOSM);
    const manualLatLngs = this.rooms.filter(r => r.lat).map(r => [r.lat, r.lng]);
    nodes.forEach(el => {
      // ways return center: { lat, lon } instead of top-level lat/lon
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (!elLat || !elLon) return;
      if (manualLatLngs.some(([rl, rn]) => getDistanceMeters(elLat, elLon, rl, rn) < 40)) return;
      const tag = el.tags?.amenity || el.tags?.shop || el.tags?.leisure || el.tags?.tourism;
      const name = el.tags?.name || tag || 'Place';
      const { emoji, color } = POI_STYLE[tag] || { emoji: '📍', color: '#94a3b8' };
      this._addPin(elLat, elLon, name, emoji, color, `osm-${el.id}`, true);
    });
    this._updatePOIStates(this.currentLat, this.currentLng);
  }

  _addPin(lat, lng, name, emoji, colorHex, roomId, isOSM) {
    const pos = this._toScene(lat, lng);
    const colNum = parseInt(colorHex.replace('#', ''), 16);

    const circle = this.add.circle(0, 0, 18, colNum, 1)
      .setStrokeStyle(2, C_OUTLINE);
    const label = this.add.text(0, 24, name, {
      fontSize: '8px', fontFamily: 'Courier New, monospace',
      color: '#2b2b33', backgroundColor: '#faf0d7',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 0);
    const emojiText = this.add.text(0, 0, emoji, { fontSize: '14px' }).setOrigin(0.5, 0.5);

    const container = this.add.container(pos.x, pos.y, [circle, label, emojiText]);
    container.setDepth(500).setSize(40, 40).setInteractive();
    container.on('pointerdown', () => {
      if (getDistanceMeters(this.currentLat, this.currentLng, lat, lng) <= ENTRY_RADIUS) {
        this.onEnterRoom(roomId, { lat, lng, name });
      }
    });

    this.poiList.push({ container, circle, label, lat, lng, roomId, isOSM, colNum });
  }

  _updatePOIStates(playerLat, playerLng) {
    this.poiList.forEach(pin => {
      const inRange = getDistanceMeters(playerLat, playerLng, pin.lat, pin.lng) <= ENTRY_RADIUS;
      pin.circle.setAlpha(inRange ? 1 : 0.45);
      pin.label.setAlpha(inRange ? 1 : 0.5);
      pin.circle.setStrokeStyle(inRange ? 3 : 1.5, inRange ? 0xfbbf24 : C_OUTLINE);
    });
  }

  _toScene(lat, lng) {
    const w = latLngToWorld(lat, lng);
    return { x: w.x - this.originWorld.x, y: w.y - this.originWorld.y };
  }

  // ── Per-frame ────────────────────────────────────────────────────────────────

  update(_, delta) {
    this.playerAvatar.setMovementState({
      moving: this.isMoving,
      direction: this.dir,
      facingLeft: this.facingLeft,
    });
    this.playerAvatar.tick(delta);
    this.playerAvatar.syncLabel();

    // Refresh tiles on camera drift
    this._refreshTiles(this.playerAvatar.x, this.playerAvatar.y);

    if (!this.isMoving) { this.stepFrame = 0; this.stepAccum = 0; return; }
    this.stepAccum += delta;
    if (this.stepAccum >= 200) { this.stepAccum -= 200; this.stepFrame = 1 - this.stepFrame; }
  }

  shutdown() {
    this.texLoaded.clear();
  }
}

// emoji + hex colour per OSM tag value
const POI_STYLE = {
  cafe:           { emoji: '☕', color: '#00704a' },
  restaurant:     { emoji: '🍽️', color: '#f59e0b' },
  fast_food:      { emoji: '🍔', color: '#f97316' },
  bar:            { emoji: '🍺', color: '#a855f7' },
  pub:            { emoji: '🍺', color: '#a855f7' },
  library:        { emoji: '📚', color: '#6366f1' },
  theatre:        { emoji: '🎭', color: '#f43f5e' },
  cinema:         { emoji: '🎬', color: '#ef4444' },
  school:         { emoji: '🏫', color: '#60a5fa' },
  gym:            { emoji: '💪', color: '#ec4899' },
  marketplace:    { emoji: '🏪', color: '#f59e0b' },
  supermarket:    { emoji: '🛒', color: '#60a5fa' },
  convenience:    { emoji: '🏪', color: '#94a3b8' },
  bakery:         { emoji: '🥐', color: '#fcd34d' },
  deli:           { emoji: '🥪', color: '#f59e0b' },
  books:          { emoji: '📚', color: '#6366f1' },
  music:          { emoji: '🎵', color: '#a855f7' },
  art:            { emoji: '🎨', color: '#818cf8' },
  clothes:        { emoji: '👕', color: '#ec4899' },
  wine:           { emoji: '🍷', color: '#9333ea' },
  park:           { emoji: '🌳', color: '#4ade80' },
  garden:         { emoji: '🌸', color: '#86efac' },
  playground:     { emoji: '🛝', color: '#fbbf24' },
  sports_centre:  { emoji: '🏟️', color: '#e11d48' },
  marina:         { emoji: '⛵', color: '#0369a1' },
  golf_course:    { emoji: '⛳', color: '#15803d' },
  museum:         { emoji: '🏛️', color: '#c084fc' },
  gallery:        { emoji: '🖼️', color: '#818cf8' },
  viewpoint:      { emoji: '🔭', color: '#f97316' },
  artwork:        { emoji: '🗿', color: '#a78bfa' },
};
