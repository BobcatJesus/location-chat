import { DEPTH } from './depth.js';
import { C, SPINES } from './layouts/bookstore.js';

const LABEL_STYLE = {
  fontSize: '8px', fontFamily: 'Courier New, monospace',
  color: '#2b2b33', backgroundColor: '#faf0d7',
  padding: { x: 3, y: 2 },
};
const SIGN_STYLE = {
  fontSize: '9px', fontFamily: 'Courier New, monospace',
  color: '#faf0d7', backgroundColor: '#2b2b33',
  padding: { x: 4, y: 3 },
};
const OUTSIDE_ROOM_COLOR = 0x0f172a;
const OUTSIDE_ROOM_ALPHA = 0.62;
const ROOM_INTERIOR_BUTTER = 0xfef3c7;
const ROOM_INTERIOR_BUTTER_ALPHA = 1;
const PARK_INTERIOR_GRASS = 0x8bd77a;
const PARK_INTERIOR_GRASS_ALPHA = 1;
const ROOM_EDGE_CORE = 0xf8f1dc;
const ROOM_EDGE_TRIM = 0x6a8f5d;
const ROOM_EDGE_SHADOW = 0x000000;
const ROOM_INNER_SHADOW = 0x1f2937;

function isParkLayout(layout = {}) {
  const id = String(layout.id || '').toLowerCase();
  const name = String(layout.name || '').toLowerCase();
  const carpet = Number(layout?.floors?.[0]?.carpet ?? layout?.carpet ?? 0);
  const isParkPalette = [PARK_INTERIOR_GRASS, 0x8bd77a, 0x9ed9a4, 0xa9d98b].includes(carpet);
  const parkKeywords = ['park', 'garden', 'forest', 'nature', 'green', 'meadow', 'lawn', 'grove', 'trail', 'reserve', 'arboretum', 'promenade', 'playground'];

  return id.includes('auto-park')
    || id.includes('park')
    || name.includes('park')
    || parkKeywords.some((keyword) => name.includes(keyword) || id.includes(keyword))
    || isParkPalette;
}

function getInteriorWash(layout = {}) {
  if (isParkLayout(layout)) {
    return { fill: PARK_INTERIOR_GRASS, alpha: PARK_INTERIOR_GRASS_ALPHA };
  }
  return { fill: ROOM_INTERIOR_BUTTER, alpha: ROOM_INTERIOR_BUTTER_ALPHA };
}

function isMcDonaldsLayout(layout = {}) {
  const id = String(layout.id || '').toLowerCase();
  const name = String(layout.name || '').toLowerCase();
  return id.includes('mcdonald') || name.includes('mcdonald');
}

function isFinitePoint(point) {
  return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
}

function getParkBoundaryTone(layout = {}) {
  if (!isParkLayout(layout)) return null;
  return {
    outsideAlpha: 0.55,
    trimLine: 5,
    trimAlpha: 0.85,
    coreLine: 2,
    coreAlpha: 0.95,
    polygonShadowLine: 24,
    polygonShadowAlpha: 0.06,
    polygonTrimLine: 14,
    polygonTrimAlpha: 0.18,
    polygonInnerLine: 9,
    polygonInnerAlpha: 0.08,
    polygonCoreLine: 3,
    polygonCoreAlpha: 0.98,
  };
}

function getBoundaryVisualTuning(scene) {
  const parkTone = getParkBoundaryTone(scene?.layout);
  return parkTone || {
    outsideAlpha: OUTSIDE_ROOM_ALPHA,
    trimLine: 5,
    trimAlpha: 0.78,
    coreLine: 2,
    coreAlpha: 0.9,
    polygonShadowLine: 24,
    polygonShadowAlpha: 0.08,
    polygonTrimLine: 14,
    polygonTrimAlpha: 0.14,
    polygonInnerLine: 9,
    polygonInnerAlpha: 0.06,
    polygonCoreLine: 3,
    polygonCoreAlpha: 0.92,
  };
}

const SOLID_ZONE_TYPES = new Set([
  'shelf',
  'wall_shelf',
  'counter',
  'magazine_rack',
  'book_table',
  'cafe_counter',
  'toy_display',
  'cd_rack',
  'bathroom',
]);

export class RoomLayout {
  constructor(scene, layout) {
    this.scene = scene;
    this.layout = layout;
    this.currentFloor = 0;
    this.gfx = scene.add.graphics().setDepth(DEPTH.GROUND + 1);
    this.labels = [];
    this.escalatorZones = []; // { x, y, w, h, toFloor, type }
    this.interactZones  = []; // { x, y, w, h, label, type }
    this.currentZones   = []; // All zones drawn on current floor (for editor)
    this.roomBoundary = { type: 'rect', x: 0, y: 0, w: 1600, h: 900 };
    this._boundaryCentroid = { x: 800, y: 450 };
    this.staticSolidZones = []; // fixed furniture/fixtures from floor layout
    this.dynamicSolidZones = []; // player-placed props
    this.showCollisionDebug = false;
    this.showFootprintDebug = false;
    this.debugGfx = scene.add.graphics().setDepth(DEPTH.UI - 2).setVisible(false);
    this.debugLabels = [];
    this.destroyed = false;
  }

  _canDraw() {
    // During scene boot, sys.isActive() may still be false while create() runs.
    // Requiring isActive here can skip the initial floor draw and leave a blank canvas.
    return !this.destroyed && Boolean(this.scene?.add && this.scene?.sys);
  }

  drawFloor(floorIndex) {
    if (!this._canDraw()) {
      if (typeof window !== 'undefined') {
        window.__sqRoomLayoutProbe = {
          stage: 'blocked-can-draw',
          at: Date.now(),
          floorIndex,
          hasScene: Boolean(this.scene),
          hasAdd: Boolean(this.scene?.add),
          hasSys: Boolean(this.scene?.sys),
        };
      }
      return;
    }
    this.currentFloor = floorIndex;
    const floor = this.layout.floors[floorIndex];
    if (!floor) return;

    this.gfx.clear();
    this.labels.forEach(l => l.destroy());
    this.labels = [];
    this.escalatorZones = [];
    this.interactZones  = [];
    this.currentZones   = [];
    this.staticSolidZones = [];
    this.dynamicSolidZones = [];

    this._computeBoundary(floor);

    const wall = floor.zones.find(z => z.type === 'wall');
    const boundaryBounds = this.roomBoundary.type === 'polygon' ? this.getBoundaryBounds() : null;
    // Always render against the full layout/world dimensions when available.
    // Using polygon bounds here clips the draw area into a visible rectangle.
    const W = this.layout?.width
      || wall?.w
      || (boundaryBounds ? Math.ceil(boundaryBounds.x + boundaryBounds.w) : 1600);
    const H = this.layout?.height
      || wall?.h
      || (boundaryBounds ? Math.ceil(boundaryBounds.y + boundaryBounds.h) : 900);

    // Single source of truth for the floor color: keep the room carpet consistent and do not repaint it again.
    const carpetColor = Number.isFinite(floor.carpet) ? floor.carpet : getInteriorWash(this.layout).fill;
    if (typeof window !== 'undefined') {
      window.__sqRoomLayoutProbe = {
        stage: 'drawing',
        at: Date.now(),
        floorIndex,
        layoutId: this.layout?.id || null,
        carpetColor,
        roomBoundaryType: this.roomBoundary?.type || null,
      };
    }
    this.gfx.fillStyle(carpetColor, 1);
    this.gfx.fillRect(0, 0, W, H);
    if (isMcDonaldsLayout(this.layout)) {
      this._drawMcDonaldsAmbient(W, H);
    }
    this._drawOutsideRoomMask(W, H, carpetColor);

    // Draw all zones
    floor.zones.forEach(z => {
      this._draw(z);
      this.currentZones.push(z);
      if (this._isZoneSolid(z)) this._registerStaticSolid(z);
    });

    if (isMcDonaldsLayout(this.layout)) {
      this._drawMcDonaldsBranding(W, H);
    }

    // Draw custom zones from editor (if any)
    const customZones = this.scene.roomEditor?.customZones || [];
    this.setDynamicSolids(customZones);
    customZones.forEach(z => {
      this._drawCustomZone(z);
      this.currentZones.push(z);
      if (z.interact) this.interactZones.push(z);
    });

    // Floor indicator badge
    if (this.layout.floors.length > 1) {
      const badge = this.scene.add.text(16, 16,
        `Floor ${floorIndex + 1} of ${this.layout.floors.length}`,
        { ...SIGN_STYLE, fontSize: '10px' }
      ).setDepth(DEPTH.UI).setScrollFactor(0);
      this.labels.push(badge);
    }

    this._redrawDebugOverlay();
  }

  _drawOutsideRoomMask(worldW, worldH, carpetColor) {
    const g = this.gfx;
    const boundary = this.roomBoundary;
    const tuning = getBoundaryVisualTuning(this.scene);

    if (boundary.type === 'rect') {
      const x = boundary.x;
      const y = boundary.y;
      const w = boundary.w;
      const h = boundary.h;

      g.fillStyle(OUTSIDE_ROOM_COLOR, tuning.outsideAlpha);
      if (y > 0) g.fillRect(0, 0, worldW, y);
      if (x > 0) g.fillRect(0, y, x, h);
      if (x + w < worldW) g.fillRect(x + w, y, worldW - (x + w), h);
      if (y + h < worldH) g.fillRect(0, y + h, worldW, worldH - (y + h));

      this._drawRectBoundaryDressings(x, y, w, h, carpetColor);

      g.lineStyle(tuning.trimLine, ROOM_EDGE_TRIM, tuning.trimAlpha);
      g.strokeRect(x + 2, y + 2, w - 4, h - 4);
      g.lineStyle(tuning.coreLine, ROOM_EDGE_CORE, tuning.coreAlpha);
      g.strokeRect(x + 5, y + 5, w - 10, h - 10);
      return;
    }

    const points = boundary.points || [];
    if (points.length < 3) return;

    // Dim whole canvas first, then repaint room interior polygon with the carpet color.
    g.fillStyle(OUTSIDE_ROOM_COLOR, tuning.outsideAlpha);
    g.fillRect(0, 0, worldW, worldH);
    g.fillStyle(carpetColor, 1);
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
    g.closePath();
    g.fillPath();

    this._drawPolygonBoundaryDressings(points);

    g.lineStyle(tuning.trimLine, ROOM_EDGE_TRIM, tuning.trimAlpha);
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
    g.closePath();
    g.strokePath();

    g.lineStyle(tuning.coreLine, ROOM_EDGE_CORE, tuning.coreAlpha);
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
    g.closePath();
    g.strokePath();
  }

  _applyInteriorWarmth() {
    const g = this.gfx;
    const boundary = this.roomBoundary;
    const floor = this.layout?.floors?.[this.currentFloor] || this.layout;
    const baseColor = Number.isFinite(floor?.carpet) ? floor.carpet : getInteriorWash(this.layout).fill;

    // Keep the room color consistent from a single source of truth:
    // the floor carpet color already sets the base room tone.
    g.fillStyle(baseColor, 1);
    if (boundary.type === 'rect') {
      g.fillRect(boundary.x, boundary.y, boundary.w, boundary.h);
      return;
    }

    const points = boundary.points || [];
    if (points.length < 3) return;

    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
    g.closePath();
    g.fillPath();
  }

  _drawRectBoundaryDressings(x, y, w, h, carpetColor) {
    const g = this.gfx;
    const shadowDepth = 34;
    const trimDepth = 18;

    g.fillStyle(ROOM_EDGE_SHADOW, 0.08);
    g.fillRect(x, y, w, shadowDepth);
    g.fillRect(x, y + h - shadowDepth, w, shadowDepth);
    g.fillRect(x, y, shadowDepth, h);
    g.fillRect(x + w - shadowDepth, y, shadowDepth, h);

    g.fillStyle(ROOM_EDGE_TRIM, 0.12);
    g.fillRect(x + 6, y + 6, w - 12, trimDepth);
    g.fillRect(x + 6, y + h - trimDepth - 6, w - 12, trimDepth);
    g.fillRect(x + 6, y + 6, trimDepth, h - 12);
    g.fillRect(x + w - trimDepth - 6, y + 6, trimDepth, h - 12);

    g.fillStyle(ROOM_INNER_SHADOW, 0.05);
    g.fillRect(x + trimDepth + 6, y + trimDepth + 6, Math.max(0, w - ((trimDepth + 6) * 2)), 18);
    g.fillRect(x + trimDepth + 6, y + h - trimDepth - 24, Math.max(0, w - ((trimDepth + 6) * 2)), 18);
    g.fillRect(x + trimDepth + 6, y + trimDepth + 6, 18, Math.max(0, h - ((trimDepth + 6) * 2)));
    g.fillRect(x + w - trimDepth - 24, y + trimDepth + 6, 18, Math.max(0, h - ((trimDepth + 6) * 2)));

    g.fillStyle(carpetColor, 0.12);
    g.fillRect(x + trimDepth + 12, y + trimDepth + 12, Math.max(0, w - ((trimDepth + 12) * 2)), Math.max(0, h - ((trimDepth + 12) * 2)));
  }

  _drawPolygonBoundaryDressings(points = []) {
    const g = this.gfx;
    if (points.length < 3) return;
    const tuning = getBoundaryVisualTuning(this.scene);
    g.lineStyle(tuning.polygonShadowLine, ROOM_EDGE_SHADOW, tuning.polygonShadowAlpha);
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
    g.closePath();
    g.strokePath();

    g.lineStyle(tuning.polygonTrimLine, ROOM_EDGE_TRIM, tuning.polygonTrimAlpha);
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
    g.closePath();
    g.strokePath();

    g.lineStyle(tuning.polygonInnerLine, ROOM_INNER_SHADOW, tuning.polygonInnerAlpha);
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
    g.closePath();
    g.strokePath();

    g.lineStyle(tuning.polygonCoreLine, ROOM_EDGE_CORE, tuning.polygonCoreAlpha);
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
    g.closePath();
    g.strokePath();
  }

  _drawMcDonaldsBranding(worldW, worldH) {
    const g = this.scene.add.graphics().setDepth(DEPTH.UI);
    const centerX = worldW - 180;
    const archBaseY = 120;
    const archRadius = 52;

    // Golden arches mark rendered as strokes so it reads as branding without heavy blocks.
    g.lineStyle(12, 0xffbc0d, 0.95);
    g.beginPath();
    g.arc(centerX - 34, archBaseY, archRadius, Math.PI, Math.PI * 2, false);
    g.strokePath();
    g.beginPath();
    g.arc(centerX + 34, archBaseY, archRadius, Math.PI, Math.PI * 2, false);
    g.strokePath();
    g.lineStyle(8, 0xd62828, 0.95);
    g.lineBetween(centerX - 78, archBaseY + 2, centerX + 78, archBaseY + 2);

    const titleY = Math.max(120, Math.min(worldH - 80, Math.round(worldH * 0.2) + 54));
    const banner = this.scene.add.text(centerX, titleY, "McDonald's", {
      fontSize: '16px',
      fontFamily: 'Courier New, monospace',
      fontStyle: 'bold',
      color: '#ffbc0d',
      stroke: '#7f1d1d',
      strokeThickness: 5,
      shadow: { offsetX: 1, offsetY: 1, color: '#3f0d0d', blur: 0, stroke: false, fill: true },
    }).setOrigin(0.5).setDepth(DEPTH.UI + 1);
    const subtitle = this.scene.add.text(centerX, titleY + 22, 'Golden Arches', {
      fontSize: '10px',
      fontFamily: 'Courier New, monospace',
      color: '#7f1d1d',
      stroke: '#ffefbf',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(DEPTH.UI + 1);

    this.labels.push(g, banner, subtitle);
  }

  _drawMcDonaldsAmbient(worldW, worldH) {
    const g = this.gfx;

    // Front wall band and lower trim in brand red.
    g.fillStyle(0xd62828, 0.95);
    g.fillRect(0, 0, worldW, 116);
    g.fillStyle(0x7f1d1d, 0.8);
    g.fillRect(0, 112, worldW, 8);

    // Subtle aisle strip to separate booth banks.
    g.fillStyle(0xf6e7ba, 0.95);
    g.fillRect(Math.round(worldW * 0.5) - 36, 170, 72, worldH - 230);

    // Light checker texture so the floor does not feel flat.
    for (let y = 140; y < worldH; y += 48) {
      for (let x = 0; x < worldW; x += 48) {
        if (((x / 48) + (y / 48)) % 2 === 0) {
          g.fillStyle(0xfff4d6, 0.16);
          g.fillRect(x, y, 48, 48);
        }
      }
    }
  }


  _isZoneSolid(z) {
    if (!z || z.type === 'wall' || z.type === 'wall_polygon') return false;
    if (z.solid === false) return false;
    return Boolean(z.solid) || SOLID_ZONE_TYPES.has(z.type);
  }

  _computeBoundary(floor) {
    const polygonWall = floor?.zones?.find((z) => z.type === 'wall_polygon' && Array.isArray(z.points) && z.points.length >= 3);
    if (polygonWall) {
      const points = polygonWall.points.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (points.length >= 3) {
        this.roomBoundary = { type: 'polygon', points };
        const centroid = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        this._boundaryCentroid = { x: centroid.x / points.length, y: centroid.y / points.length };
        return;
      }
    }

    const wall = floor?.zones?.find((z) => z.type === 'wall');
    const w = wall?.w || this.layout?.width || 1600;
    const h = wall?.h || this.layout?.height || 900;

    const projectedShape = this._projectSceneRoomShape(this.scene?.roomShape, w, h);
    if (Array.isArray(projectedShape) && projectedShape.length >= 3 && projectedShape.every(isFinitePoint)) {
      this.roomBoundary = { type: 'polygon', points: projectedShape };
      const centroid = projectedShape.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
      this._boundaryCentroid = {
        x: centroid.x / projectedShape.length,
        y: centroid.y / projectedShape.length,
      };
      return;
    }

    // If the room has no explicit footprint/polygon, create a practical inset
    // beveled polygon so users still get a visible, intentional realm edge.
    const insetX = Math.max(72, Math.min(130, Math.floor(w * 0.24)));
    const insetY = Math.max(54, Math.min(100, Math.floor(h * 0.24)));
    const innerW = Math.max(320, w - insetX * 2);
    const innerH = Math.max(220, h - insetY * 2);
    const chamfer = Math.max(52, Math.min(108, Math.floor(Math.min(innerW, innerH) * 0.22)));
    const shoulder = Math.max(32, Math.min(72, Math.floor(Math.min(innerW, innerH) * 0.12)));
    const x = insetX;
    const y = insetY;
    const right = insetX + innerW;
    const bottom = insetY + innerH;
    const points = [
      { x: x + chamfer, y },
      { x: x + chamfer + shoulder, y: y + Math.floor(shoulder * 0.18) },
      { x: right - chamfer - shoulder, y: y + Math.floor(shoulder * 0.18) },
      { x: right - chamfer, y },
      { x: right - Math.floor(shoulder * 0.18), y: y + chamfer + shoulder },
      { x: right - Math.floor(shoulder * 0.18), y: bottom - chamfer - shoulder },
      { x: right - chamfer, y: bottom },
      { x: right - chamfer - shoulder, y: bottom - Math.floor(shoulder * 0.18) },
      { x: x + chamfer + shoulder, y: bottom - Math.floor(shoulder * 0.18) },
      { x: x + chamfer, y: bottom },
      { x: x + Math.floor(shoulder * 0.18), y: bottom - chamfer - shoulder },
      { x: x + Math.floor(shoulder * 0.18), y: y + chamfer + shoulder },
    ];
    this.roomBoundary = { type: 'polygon', points };
    this._boundaryCentroid = { x: x + innerW / 2, y: y + innerH / 2 };
  }

  _projectSceneRoomShape(roomShape, targetW, targetH) {
    if (!Array.isArray(roomShape) || roomShape.length < 3) return null;

    const pts = roomShape
      .map((p) => ({
        lat: Number(p?.lat ?? p?.y),
        lon: Number(p?.lon ?? p?.lng ?? p?.x),
      }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (pts.length < 3) return null;

    const deduped = [];
    const epsilon = 1e-9;
    pts.forEach((point) => {
      const prev = deduped[deduped.length - 1];
      if (!prev || Math.abs(prev.lat - point.lat) > epsilon || Math.abs(prev.lon - point.lon) > epsilon) {
        deduped.push(point);
      }
    });
    if (deduped.length < 3) return null;

    const first = deduped[0];
    const last = deduped[deduped.length - 1];
    if (Math.abs(first.lat - last.lat) <= epsilon && Math.abs(first.lon - last.lon) <= epsilon) {
      deduped.pop();
    }
    if (deduped.length < 3) return null;

    const meanLat = deduped.reduce((sum, p) => sum + p.lat, 0) / deduped.length;
    const lonScale = Math.max(0.000001, Math.cos((meanLat * Math.PI) / 180));

    const minLon = Math.min(...deduped.map((p) => p.lon));
    const maxLon = Math.max(...deduped.map((p) => p.lon));
    const minLat = Math.min(...deduped.map((p) => p.lat));
    const maxLat = Math.max(...deduped.map((p) => p.lat));

    const spanLon = (maxLon - minLon) * lonScale;
    const spanLat = maxLat - minLat;
    if (spanLon <= 0 || spanLat <= 0) return null;

    const minSide = Math.max(320, Math.min(targetW, targetH));
    const pad = Math.max(40, Math.min(180, Math.round(minSide * 0.08)));
    const drawW = Math.max(120, targetW - pad * 2);
    const drawH = Math.max(120, targetH - pad * 2);
    const scale = Math.min(drawW / spanLon, drawH / spanLat);
    const ox = (targetW - spanLon * scale) / 2;
    const oy = (targetH - spanLat * scale) / 2;

    return deduped.map((p) => ({
      x: ox + ((p.lon - minLon) * lonScale) * scale,
      y: oy + (maxLat - p.lat) * scale,
    }));
  }

  _distancePointToSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const abLenSq = abx * abx + aby * aby;
    if (abLenSq === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    return Math.hypot(px - cx, py - cy);
  }

  _isPointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x;
      const yi = points[i].y;
      const xj = points[j].x;
      const yj = points[j].y;

      const intersects = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  isPointInsideRoom(x, y, margin = 0) {
    const boundary = this.roomBoundary;
    if (boundary.type === 'rect') {
      return x >= boundary.x + margin &&
        x <= boundary.x + boundary.w - margin &&
        y >= boundary.y + margin &&
        y <= boundary.y + boundary.h - margin;
    }

    const points = boundary.points;
    if (!this._isPointInPolygon(x, y, points)) return false;
    if (margin <= 0) return true;

    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      minDist = Math.min(minDist, this._distancePointToSegment(x, y, a.x, a.y, b.x, b.y));
    }
    return minDist >= margin;
  }

  clampPointToRoom(x, y, margin = 0) {
    if (this.isPointInsideRoom(x, y, margin)) return { x, y };

    const boundary = this.roomBoundary;
    if (boundary.type === 'rect') {
      return {
        x: Math.max(boundary.x + margin, Math.min(boundary.x + boundary.w - margin, x)),
        y: Math.max(boundary.y + margin, Math.min(boundary.y + boundary.h - margin, y)),
      };
    }

    const points = boundary.points;
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const abLenSq = abx * abx + aby * aby;
      if (abLenSq === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / abLenSq));
      const px = a.x + abx * t;
      const py = a.y + aby * t;
      const d = Math.hypot(x - px, y - py);
      if (d < bestDist) {
        bestDist = d;
        best = { x: px, y: py };
      }
    }

    if (!best) return { ...this._boundaryCentroid };

    const tryNudgedCandidate = (dx, dy) => {
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return null;
      const nx = dx / len;
      const ny = dy / len;
      const start = Math.max(2, margin + 2);
      for (let step = start; step >= 1; step -= 1) {
        const candidate = {
          x: best.x + nx * step,
          y: best.y + ny * step,
        };
        if (this.isPointInsideRoom(candidate.x, candidate.y, margin)) return candidate;
      }
      return null;
    };

    // If source point is outside, pushing beyond the nearest edge toward the
    // source->edge direction usually lands inside concave polygons reliably.
    const fromSource = tryNudgedCandidate(best.x - x, best.y - y);
    if (fromSource) return fromSource;

    const cx = this._boundaryCentroid.x - best.x;
    const cy = this._boundaryCentroid.y - best.y;
    const fromCentroid = tryNudgedCandidate(cx, cy);
    if (fromCentroid) return fromCentroid;

    if (this.isPointInsideRoom(best.x, best.y, 0)) return best;
    return { ...this._boundaryCentroid };
  }

  resolveSafeSpawnPoint(candidates = [], radius = 20) {
    const list = Array.isArray(candidates) ? candidates : [];
    const margins = [Math.max(10, radius + 4), Math.max(6, Math.floor(radius * 0.75)), 4, 0];

    for (const base of list) {
      if (!base || !Number.isFinite(base.x) || !Number.isFinite(base.y)) continue;
      for (const margin of margins) {
        const candidate = this.clampPointToRoom(base.x, base.y, margin);
        if (!candidate) continue;
        if (!this.isPointInsideRoom(candidate.x, candidate.y, 0)) continue;
        if (this.collidesWithSolid(candidate.x, candidate.y, radius)) continue;
        return candidate;
      }
    }

    const fallback = this.clampPointToRoom(this._boundaryCentroid.x, this._boundaryCentroid.y, 0);
    if (fallback && this.isPointInsideRoom(fallback.x, fallback.y, 0)) return fallback;
    return { ...this._boundaryCentroid };
  }

  getBoundaryBounds() {
    const boundary = this.roomBoundary;
    if (boundary.type === 'rect') {
      return { x: boundary.x, y: boundary.y, w: boundary.w, h: boundary.h };
    }
    const xs = boundary.points.map((p) => p.x);
    const ys = boundary.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  isRectFullyInsideRoom(cx, cy, w, h, margin = 0) {
    const hw = (w || 0) / 2;
    const hh = (h || 0) / 2;
    return this.isPointInsideRoom(cx - hw, cy - hh, margin) &&
      this.isPointInsideRoom(cx + hw, cy - hh, margin) &&
      this.isPointInsideRoom(cx - hw, cy + hh, margin) &&
      this.isPointInsideRoom(cx + hw, cy + hh, margin);
  }

  _registerStaticSolid(z) {
    // Room boundary walls are enforced by boundary geometry checks, not obstacle collisions.
    if (z?.type === 'wall' || z?.type === 'wall_polygon') return;
    const w = Number(z?.w);
    const h = Number(z?.h);
    const x = Number(z?.x);
    const y = Number(z?.y);
    if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (w <= 0 || h <= 0) return;
    this.staticSolidZones.push({
      left: x,
      top: y,
      right: x + w,
      bottom: y + h,
    });
  }

  setDynamicSolids(customZones = []) {
    this.dynamicSolidZones = (customZones || [])
      .map((z) => {
        const w = Number(z?.w || 0);
        const h = Number(z?.h || 0);
        const x = Number(z?.x);
        const y = Number(z?.y);
        if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (w <= 0 || h <= 0) return null;
        return {
          left: x - w / 2,
          top: y - h / 2,
          right: x + w / 2,
          bottom: y + h / 2,
        };
      })
      .filter(Boolean);
    this._redrawDebugOverlay();
  }

  _allSolidZones() {
    return [...this.staticSolidZones, ...this.dynamicSolidZones];
  }

  _circleIntersectsRect(cx, cy, radius, rect) {
    const nearestX = Math.max(rect.left, Math.min(cx, rect.right));
    const nearestY = Math.max(rect.top, Math.min(cy, rect.bottom));
    const dx = cx - nearestX;
    const dy = cy - nearestY;
    return (dx * dx + dy * dy) < radius * radius;
  }

  collidesWithSolid(x, y, radius = 16) {
    return this._allSolidZones().some((rect) => this._circleIntersectsRect(x, y, radius, rect));
  }

  canPlaceRect(cx, cy, w, h, padding = 4) {
    const left = cx - w / 2 - padding;
    const right = cx + w / 2 + padding;
    const top = cy - h / 2 - padding;
    const bottom = cy + h / 2 + padding;
    return !this._allSolidZones().some((rect) =>
      left < rect.right && right > rect.left && top < rect.bottom && bottom > rect.top
    );
  }

  resolveAgainstSolids(prevX, prevY, nextX, nextY, radius = 16) {
    let x = nextX;
    let y = nextY;

    if (this.collidesWithSolid(x, y, radius)) {
      const dx = nextX - prevX;
      const dy = nextY - prevY;
      const steps = 5;
      let best = { x: prevX, y: prevY };
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const tx = prevX + dx * t;
        const ty = prevY + dy * t;
        if (!this.collidesWithSolid(tx, ty, radius)) {
          best = { x: tx, y: ty };
        } else {
          break;
        }
      }

      if (!this.collidesWithSolid(x, prevY, radius)) {
        y = prevY;
      } else if (!this.collidesWithSolid(prevX, y, radius)) {
        x = prevX;
      } else {
        x = best.x;
        y = best.y;
      }
    }

    return { x, y };
  }

  setCollisionDebug(enabled) {
    this.showCollisionDebug = Boolean(enabled);
    this.debugGfx.setVisible(this.showCollisionDebug || this.showFootprintDebug);
    this._redrawDebugOverlay();
  }

  setFootprintDebug(enabled) {
    this.showFootprintDebug = Boolean(enabled);
    this.debugGfx.setVisible(this.showCollisionDebug || this.showFootprintDebug);
    this._redrawDebugOverlay();
  }

  _redrawDebugOverlay() {
    if (!this.debugGfx) return;
    this.debugGfx.clear();
    this.debugLabels.forEach((label) => label?.destroy?.());
    this.debugLabels = [];

    if (!this.showCollisionDebug && !this.showFootprintDebug) return;

    const g = this.debugGfx;
    const b = this.roomBoundary;
    g.lineStyle(2, 0x22d3ee, 0.95);
    if (b.type === 'rect') {
      g.strokeRect(b.x, b.y, b.w, b.h);
    } else if (Array.isArray(b.points) && b.points.length >= 3) {
      g.beginPath();
      g.moveTo(b.points[0].x, b.points[0].y);
      for (let i = 1; i < b.points.length; i++) g.lineTo(b.points[i].x, b.points[i].y);
      g.closePath();
      g.strokePath();

      if (this.showFootprintDebug) {
        b.points.forEach((point, index) => {
          g.fillStyle(0xf59e0b, 0.95);
          g.fillCircle(point.x, point.y, 5);
          g.lineStyle(1, 0x111827, 0.9);
          g.strokeCircle(point.x, point.y, 5);
          const tag = this.scene.add.text(point.x + 8, point.y - 8, String(index + 1), {
            fontSize: '11px',
            fontFamily: 'Courier New, monospace',
            color: '#fbbf24',
            backgroundColor: '#0f172a',
            padding: { x: 2, y: 1 },
          }).setDepth(DEPTH.UI - 1);
          this.debugLabels.push(tag);
        });
      }
    }

    const drawRects = (rects, fill, stroke) => {
      rects.forEach((r) => {
        g.fillStyle(fill, 0.22);
        g.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
        g.lineStyle(1, stroke, 0.95);
        g.strokeRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
      });
    };

    if (this.showCollisionDebug) {
      drawRects(this.staticSolidZones, 0xef4444, 0xfca5a5);
      drawRects(this.dynamicSolidZones, 0xf59e0b, 0xfde68a);
    }
  }

  // ── Per-zone renderer ──────────────────────────────────────────────────────────

  _draw(z) {
    const g = this.gfx;
    const s = this.scene;
    const { x, y, w = 0, h = 0 } = z;

    switch (z.type) {

      case 'wall':
        // When a polygon boundary is active, the boundary mask already draws
        // the correct perimeter. Skip the default rectangular wall stroke to
        // avoid making irregular outdoor rooms appear rectangular.
        if (this.roomBoundary?.type === 'polygon') break;
        g.lineStyle(5, C.WALL, 1);
        g.strokeRect(0, 0, w, h);
        break;

      case 'wall_polygon': {
        const points = Array.isArray(z.points) ? z.points : [];
        if (points.length < 3) break;
        g.lineStyle(5, C.WALL, 1);
        g.beginPath();
        g.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
        g.closePath();
        g.strokePath();
        // Corner markers make irregular footprints easier to read in-game.
        g.fillStyle(C.WALL, 1);
        points.forEach((p) => g.fillCircle(p.x, p.y, 3));
        break;
      }

      case 'entry':
        // In polygon outdoor rooms, avoid rectangular entry mats that read as
        // box overlays against irregular footprint borders.
        if (!(this.roomBoundary?.type === 'polygon' && isParkLayout(this.layout))) {
          g.fillStyle(C.ENTRY_MAT, 1);
          g.fillRect(x, y, w, h);
          g.lineStyle(2, C.WALL, 1);
          g.strokeRect(x, y, w, h);
        }
        this._lbl(x + w / 2, y + h / 2, z.label, LABEL_STYLE, 0.5, 0.5);
        break;

      case 'shelf':
      case 'wall_shelf':
        this._drawShelf(x, y, w, h, z.label);
        if (z.interact) this.interactZones.push(z);
        break;

      case 'counter':
        if (isMcDonaldsLayout(this.layout)) {
          g.fillStyle(0xd62828, 1);
          g.fillRect(x, y, w, h);
          g.fillStyle(0xffbc0d, 0.96);
          g.fillRect(x + 8, y + 8, Math.max(0, w - 16), Math.max(0, h - 16));
          g.lineStyle(2, 0x7f1d1d, 1);
          g.strokeRect(x, y, w, h);
          this._lbl(x + w / 2, y + h / 2, z.label, { ...LABEL_STYLE, color: '#7f1d1d', backgroundColor: undefined }, 0.5, 0.5);
          if (z.interact) this.interactZones.push(z);
          break;
        }
        g.fillStyle(C.COUNTER, 1);
        g.fillRect(x, y, w, h);
        g.lineStyle(2, C.WALL, 1);
        g.strokeRect(x, y, w, h);
        this._lbl(x + w / 2, y + h / 2, z.label, LABEL_STYLE, 0.5, 0.5);
        if (z.interact) this.interactZones.push(z);
        break;

      case 'book_table':
        if (isMcDonaldsLayout(this.layout)) {
          g.fillStyle(0xd62828, 1);
          g.fillRect(x, y, w, h);
          g.fillStyle(0xffbc0d, 0.95);
          g.fillRect(x + 7, y + 7, Math.max(0, w - 14), Math.max(0, h - 14));
          g.lineStyle(2, 0x7f1d1d, 1);
          g.strokeRect(x, y, w, h);
          for (let stripe = x + 12; stripe < x + w - 8; stripe += 18) {
            g.fillStyle(0xd62828, 0.45);
            g.fillRect(stripe, y + 10, 8, Math.max(0, h - 20));
          }
          if (z.interact) this.interactZones.push(z);
          break;
        }
        g.fillStyle(C.TABLE_WOOD, 1);
        g.fillRect(x, y, w, h);
        g.lineStyle(2, C.WALL, 1);
        g.strokeRect(x, y, w, h);
        // Show coloured book rects on table surface
        SPINES.slice(0, Math.min(5, Math.floor(w / 36))).forEach((col, i) => {
          g.fillStyle(col, 0.85);
          g.fillRect(x + 8 + i * Math.floor((w - 16) / 5), y + 8, Math.floor((w - 16) / 5) - 4, h - 16);
        });
        this._lbl(x + w / 2, y - 12, z.label, LABEL_STYLE, 0.5, 1);
        if (z.interact) this.interactZones.push(z);
        break;

      case 'magazine_rack':
        g.fillStyle(C.MAGAZINE, 1);
        g.fillRect(x, y, w, h);
        g.lineStyle(2, C.WALL, 1);
        g.strokeRect(x, y, w, h);
        // Horizontal magazine rows
        for (let my = y + 10; my < y + h - 20; my += 22) {
          g.fillStyle(SPINES[(Math.floor((my - y) / 22)) % SPINES.length], 0.8);
          g.fillRect(x + 4, my, w - 8, 16);
        }
        this._lbl(x + w / 2, y - 12, z.label, LABEL_STYLE, 0.5, 1);
        if (z.interact) this.interactZones.push(z);
        break;

      case 'cafe_zone':
        g.fillStyle(C.STARBUCKS, 0.12);
        g.fillRect(x, y, w, h);
        g.lineStyle(2, C.STARBUCKS, 0.9);
        g.strokeRect(x, y, w, h);
        this._lbl(x + w / 2, y + 8, '☕ ' + z.label, { ...SIGN_STYLE, backgroundColor: undefined, color: C.STARBUCKS.toString() }, 0.5, 0);
        break;

      case 'cafe_counter':
        g.fillStyle(C.STARBUCKS, 1);
        g.fillRect(x, y, w, h);
        g.lineStyle(2, C.WALL, 1);
        g.strokeRect(x, y, w, h);
        this._lbl(x + w / 2, y + h / 2, z.label, { ...LABEL_STYLE, color: '#faf0d7', backgroundColor: undefined }, 0.5, 0.5);
        if (z.interact) this.interactZones.push(z);
        break;

      case 'cafe_table': {
        const r = 22;
        g.fillStyle(0x4a3728, 1);
        g.fillCircle(x, y, r);
        g.lineStyle(1.5, C.WALL, 1);
        g.strokeCircle(x, y, r);
        break;
      }

      case 'toy_display':
        g.fillStyle(C.TOY_DISPLAY, 1);
        g.fillRect(x, y, w, h);
        g.lineStyle(2, C.WALL, 1);
        g.strokeRect(x, y, w, h);
        // Bright star deco
        g.fillStyle(0xffffff, 0.5);
        g.fillCircle(x + w / 2, y + h / 2, Math.min(w, h) * 0.2);
        this._lbl(x + w / 2, y - 12, z.label, LABEL_STYLE, 0.5, 1);
        if (z.interact) this.interactZones.push(z);
        break;

      case 'cd_rack':
        g.fillStyle(C.CD_RACK, 1);
        g.fillRect(x, y, w, h);
        g.lineStyle(2, C.WALL, 1);
        g.strokeRect(x, y, w, h);
        // CD slot lines
        for (let cy = y + 14; cy < y + h - 14; cy += 18) {
          g.lineStyle(1, 0xffffff, 0.4);
          g.lineBetween(x + 4, cy, x + w - 4, cy);
        }
        this._lbl(x + w / 2, y - 12, z.label, LABEL_STYLE, 0.5, 1);
        if (z.interact) this.interactZones.push(z);
        break;

      case 'bathroom':
        g.fillStyle(C.BATHROOM, 1);
        g.fillRect(x, y, w, h);
        g.lineStyle(2, C.WALL, 1);
        g.strokeRect(x, y, w, h);
        // Stall dividers
        g.lineStyle(1.5, 0xb0c4ce, 0.8);
        g.lineBetween(x + w / 2, y, x + w / 2, y + h);
        this._lbl(x + w / 2, y + h / 2, z.label, LABEL_STYLE, 0.5, 0.5);
        if (z.interact) this.interactZones.push(z);
        break;

      case 'planter_border':
        g.fillStyle(0x14532d, 1);
        g.fillRoundedRect(x, y, w, h, Math.min(14, Math.floor(Math.min(w, h) / 2)));
        g.lineStyle(2, 0x052e16, 1);
        g.strokeRoundedRect(x, y, w, h, Math.min(14, Math.floor(Math.min(w, h) / 2)));
        for (let px = x + 18; px < x + w - 8; px += 28) {
          g.fillStyle(0x22c55e, 0.95);
          g.fillCircle(px, y + h / 2, Math.max(7, Math.min(15, h * 0.28)));
        }
        if (z.label) this._lbl(x + w / 2, y - 10, z.label, LABEL_STYLE, 0.5, 1);
        break;

      case 'seating':
        g.fillStyle(C.SEATING, 0.35);
        g.fillRect(x, y, w, h);
        g.lineStyle(1, C.WALL, 0.4);
        g.strokeRect(x, y, w, h);
        this._lbl(x + w / 2, y + 8, z.label, LABEL_STYLE, 0.5, 0);
        break;

      case 'table':
        g.fillStyle(C.TABLE_WOOD, 1);
        g.fillRect(x, y, w, h);
        g.lineStyle(1.5, C.WALL, 1);
        g.strokeRect(x, y, w, h);
        this._lbl(x + w / 2, y - 10, z.label || 'Table', LABEL_STYLE, 0.5, 1);
        if (z.interact) this.interactZones.push(z);
        break;

      case 'chair':
        g.fillStyle(C.SEATING, 1);
        g.fillRect(x, y, w, h);
        g.lineStyle(1, C.WALL, 1);
        g.strokeRect(x, y, w, h);
        g.fillStyle(C.WALL, 0.45);
        g.fillRect(x + Math.floor(w * 0.2), y + Math.floor(h * 0.15), Math.floor(w * 0.6), Math.floor(h * 0.22));
        break;

      case 'stairwell':
      case 'stairs':
        g.fillStyle(C.ESCALATOR, 1);
        g.fillRect(x, y, w, h);
        g.lineStyle(1.5, C.ESCALATOR_STRIPE, 1);
        for (let step = 0; step <= 7; step++) {
          const sy = y + (h / 7) * step;
          g.lineBetween(x, sy, x + w, sy);
        }
        g.lineStyle(2, C.WALL, 1);
        g.strokeRect(x, y, w, h);
        this._lbl(x + w / 2, y + h / 2, z.label || 'Stairs', { ...SIGN_STYLE, backgroundColor: undefined, color: '#2b2b33' }, 0.5, 0.5);
        if (z.toFloor !== undefined) this.escalatorZones.push({ x, y, w, h, toFloor: z.toFloor, type: z.type });
        break;

      case 'atrium':
      case 'void':
        g.fillStyle(OUTSIDE_ROOM_COLOR, 0.12);
        g.fillRect(x, y, w, h);
        g.lineStyle(1, ROOM_EDGE_TRIM, 0.35);
        g.strokeRect(x, y, w, h);
        if (z.label) this._lbl(x + w / 2, y + h / 2, z.label, LABEL_STYLE, 0.5, 0.5);
        break;

      case 'couch': {
        if (isMcDonaldsLayout(this.layout)) {
          const cw = 140, ch = 50;
          g.fillStyle(0xd62828, 1);
          g.fillRect(x, y, cw, ch);
          g.fillStyle(0xffbc0d, 0.2);
          g.fillRect(x + 8, y + 8, cw - 16, ch - 16);
          g.lineStyle(1.5, 0x7f1d1d, 1);
          g.strokeRect(x, y, cw, ch);
          g.lineStyle(1, 0x7f1d1d, 0.6);
          g.lineBetween(x + cw / 2, y, x + cw / 2, y + ch);
          break;
        }
        const cw = 140, ch = 50;
        g.fillStyle(C.COUCH, 1);
        g.fillRect(x, y, cw, ch);
        g.lineStyle(1.5, C.WALL, 1);
        g.strokeRect(x, y, cw, ch);
        // Cushion division
        g.lineStyle(1, C.WALL, 0.5);
        g.lineBetween(x + cw / 2, y, x + cw / 2, y + ch);
        break;
      }

      case 'window':
        g.fillStyle(C.WINDOW, 0.6);
        g.fillRect(x, y, w, h);
        g.lineStyle(2, 0x5ba4cf, 1);
        g.strokeRect(x, y, w, h);
        // Window pane lines
        g.lineStyle(1, 0x5ba4cf, 0.5);
        for (let wx = x + 80; wx < x + w - 40; wx += 80) {
          g.lineBetween(wx, y, wx, y + h);
        }
        this._lbl(x + w / 2, y + h / 2, z.label, LABEL_STYLE, 0.5, 0.5);
        break;

      case 'screen':
        // Theater projection screen with subtle bezel and glow.
        g.fillStyle(0x05070d, 1);
        g.fillRect(x, y, w, h);
        g.lineStyle(3, 0xcbd5e1, 0.95);
        g.strokeRect(x, y, w, h);
        g.fillStyle(0x93c5fd, 0.14);
        g.fillRect(x + 8, y + 8, Math.max(0, w - 16), Math.max(0, h - 16));
        if (z.label) this._lbl(x + w / 2, y + h / 2, z.label, { ...SIGN_STYLE, backgroundColor: undefined, color: '#e2e8f0' }, 0.5, 0.5);
        break;

      case 'railing':
        g.fillStyle(C.RAILING, 1);
        g.fillRect(x, y, w, h);
        // Baluster marks
        g.lineStyle(1, C.WALL, 0.4);
        if (w > h) {
          for (let rx = x; rx < x + w; rx += 24) g.lineBetween(rx, y, rx, y + h);
        } else {
          for (let ry = y; ry < y + h; ry += 24) g.lineBetween(x, ry, x + w, ry);
        }
        break;

      case 'sign':
        if (isMcDonaldsLayout(this.layout)) {
          this._lbl(x + (w || 0) / 2, y + (h || 0) / 2, z.label, {
            ...SIGN_STYLE,
            color: '#ffbc0d',
            backgroundColor: '#d62828',
          }, 0.5, 0.5);
          break;
        }
        this._lbl(x + (w || 0) / 2, y + (h || 0) / 2, z.label, SIGN_STYLE, 0.5, 0.5);
        break;

      case 'tree':
      case 'shrub':
      case 'bench':
      case 'lamppost':
      case 'flowerbed':
        this._drawCustomZone(z);
        break;

      case 'escalator_up':
      case 'escalator_down': {
        const isUp = z.type === 'escalator_up';
        g.fillStyle(C.ESCALATOR, 1);
        g.fillRect(x, y, w, h);
        // Diagonal stripe steps
        g.lineStyle(1.5, C.ESCALATOR_STRIPE, 1);
        const stepCount = 8;
        for (let i = 0; i <= stepCount; i++) {
          const ty = y + (h / stepCount) * i;
          g.lineBetween(x, ty, x + w, ty);
        }
        g.lineStyle(2, C.WALL, 1);
        g.strokeRect(x, y, w, h);
        // Arrow
        this._lbl(x + w / 2, y + h / 2, z.label, { ...SIGN_STYLE, backgroundColor: undefined, color: '#2b2b33' }, 0.5, 0.5);
        if (z.toFloor !== undefined) {
          this.escalatorZones.push({ x, y, w, h, toFloor: z.toFloor, type: z.type });
        }
        break;
      }

      case 'employee':
        // Rendered by VillageScene as an NPC sprite placeholder
        break;
    }
  }

  _drawShelf(x, y, w, h, label) {
    const g = this.gfx;
    // Wood body
    g.fillStyle(C.SHELF_WOOD, 1);
    g.fillRect(x, y, w, h);
    // Top cap lighter
    g.fillStyle(C.SHELF_TOP, 1);
    g.fillRect(x, y, w, 8);
    g.lineStyle(1.5, C.WALL, 1);
    g.strokeRect(x, y, w, h);
    // Book spines — packed in rows
    const spineW = Math.max(6, Math.floor(w * 0.7));
    const spineH = 16;
    const leftPad = Math.floor((w - spineW) / 2);
    let si = 0;
    for (let sy = y + 14; sy + spineH < y + h - 4; sy += spineH + 2) {
      const col = SPINES[si % SPINES.length];
      g.fillStyle(col, 0.9);
      g.fillRect(x + leftPad, sy, spineW, spineH);
      si++;
    }
    if (label) this._lbl(x + w / 2, y - 10, label, LABEL_STYLE, 0.5, 1);
  }

  _lbl(x, y, text, style, ox = 0.5, oy = 0) {
    if (!text || !this._canDraw()) return;
    const t = this.scene.add.text(x, y, text, style)
      .setOrigin(ox, oy)
      .setDepth(DEPTH.OVERHEAD);
    this.labels.push(t);
  }

  // Returns the escalator zone the player is standing on, or null
  checkEscalator(px, py) {
    return this.escalatorZones.find(z =>
      px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h
    ) || null;
  }

  /**
   * Draw custom zone from RoomEditor
   * Supports: table, plant, chair, couch, plant_large, decoration
   */
  _drawCustomZone(z) {
    const g = this.gfx;
    const { type, x, y, w = 60, h = 40 } = z;

    const renderType = z.renderAsZone || null;
    if (renderType) {
      const zone = {
        ...z,
        type: renderType,
        x: x - w / 2,
        y: y - h / 2,
        label: z.label || '',
      };
      this._draw(zone);
      return;
    }

    // Color map for custom zone types
    const colorMap = {
      table: { fill: 0x8b4513, stroke: 0x654321 },
      chair: { fill: 0xa0522d, stroke: 0x654321 },
      plant: { fill: 0x228b22, stroke: 0x006400 },
      plant_large: { fill: 0x006400, stroke: 0x003300 },
      couch: { fill: 0x4169e1, stroke: 0x00008b },
      decoration: { fill: 0xffd700, stroke: 0xdaa520 },
    };

    const colors = colorMap[type] || { fill: 0x888888, stroke: 0x555555 };

    if (['tree', 'shrub', 'bench', 'lamppost', 'flowerbed'].includes(type)) return;

    // Ignore the generic rectangle fallback for custom props so outdoor editor items don't render as placeholder boxes.
    return;

    // Icon/label for the zone type
    const labels = {
      table: '🪑',
      chair: '🪑',
      plant: '🌿',
      plant_large: '🌳',
      couch: '🛋️',
      decoration: '✨',
    };
    this._lbl(x, y, labels[type] || type[0].toUpperCase(), { fontSize: '14px' }, 0.5, 0.5);
  }

  destroy() {
    this.destroyed = true;
    this.debugLabels.forEach((label) => label?.destroy?.());
    this.debugLabels = [];
    this.debugGfx?.destroy();
    this.gfx?.destroy();
    this.labels.forEach(l => l.destroy());
    this.labels = [];
  }
}
