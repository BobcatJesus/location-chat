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
const OUTSIDE_ROOM_ALPHA = 0.86;
const ROOM_EDGE_CORE = 0xf8f1dc;
const ROOM_EDGE_TRIM = 0xc9a66b;
const ROOM_EDGE_SHADOW = 0x000000;
const ROOM_INNER_SHADOW = 0x1f2937;

function getBoundaryVisualTuning(scene) {
  const viewportW = Number(scene?.scale?.width || 0);
  const compact = viewportW > 0 && viewportW <= 820;
  if (!compact) {
    return {
      outsideAlpha: OUTSIDE_ROOM_ALPHA,
      trimLine: 5,
      trimAlpha: 0.9,
      coreLine: 2,
      coreAlpha: 0.95,
      polygonShadowLine: 24,
      polygonShadowAlpha: 0.16,
      polygonTrimLine: 14,
      polygonTrimAlpha: 0.24,
      polygonInnerLine: 9,
      polygonInnerAlpha: 0.14,
      polygonCoreLine: 3,
      polygonCoreAlpha: 0.98,
    };
  }
  return {
    outsideAlpha: 0.92,
    trimLine: 7,
    trimAlpha: 0.98,
    coreLine: 3,
    coreAlpha: 1,
    polygonShadowLine: 28,
    polygonShadowAlpha: 0.2,
    polygonTrimLine: 17,
    polygonTrimAlpha: 0.32,
    polygonInnerLine: 12,
    polygonInnerAlpha: 0.2,
    polygonCoreLine: 4,
    polygonCoreAlpha: 1,
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
    this.debugGfx = scene.add.graphics().setDepth(DEPTH.UI - 2).setVisible(true);
  }

  drawFloor(floorIndex) {
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
    const W = wall?.w || 1600, H = wall?.h || 900;

    // Carpet fill
    this.gfx.fillStyle(floor.carpet, 1);
    this.gfx.fillRect(0, 0, W, H);
    this._drawOutsideRoomMask(W, H, floor.carpet);

    // Draw all zones
    floor.zones.forEach(z => {
      this._draw(z);
      this.currentZones.push(z);
      if (this._isZoneSolid(z)) this._registerStaticSolid(z);
    });

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

  _drawRectBoundaryDressings(x, y, w, h, carpetColor) {
    const g = this.gfx;
    const shadowDepth = 34;
    const trimDepth = 18;

    g.fillStyle(ROOM_EDGE_SHADOW, 0.18);
    g.fillRect(x, y, w, shadowDepth);
    g.fillRect(x, y + h - shadowDepth, w, shadowDepth);
    g.fillRect(x, y, shadowDepth, h);
    g.fillRect(x + w - shadowDepth, y, shadowDepth, h);

    g.fillStyle(ROOM_EDGE_TRIM, 0.22);
    g.fillRect(x + 6, y + 6, w - 12, trimDepth);
    g.fillRect(x + 6, y + h - trimDepth - 6, w - 12, trimDepth);
    g.fillRect(x + 6, y + 6, trimDepth, h - 12);
    g.fillRect(x + w - trimDepth - 6, y + 6, trimDepth, h - 12);

    g.fillStyle(ROOM_INNER_SHADOW, 0.12);
    g.fillRect(x + trimDepth + 6, y + trimDepth + 6, Math.max(0, w - ((trimDepth + 6) * 2)), 18);
    g.fillRect(x + trimDepth + 6, y + h - trimDepth - 24, Math.max(0, w - ((trimDepth + 6) * 2)), 18);
    g.fillRect(x + trimDepth + 6, y + trimDepth + 6, 18, Math.max(0, h - ((trimDepth + 6) * 2)));
    g.fillRect(x + w - trimDepth - 24, y + trimDepth + 6, 18, Math.max(0, h - ((trimDepth + 6) * 2)));

    g.fillStyle(carpetColor, 0.06);
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
    const w = wall?.w || 1600;
    const h = wall?.h || 900;

    // If the room has no explicit footprint/polygon, create a practical inset
    // beveled polygon so users still get a visible, intentional realm edge.
    const hasExplicitRoomShape = Boolean(this.scene?.roomShape);
    const compactViewport = Number(this.scene?.scale?.width || 0) <= 820;
    const looksLikeFullCanvasDefault = Number.isFinite(w) && Number.isFinite(h) && w >= 1400 && h >= 800;
    if (!hasExplicitRoomShape && looksLikeFullCanvasDefault) {
      const insetX = Math.max(72, Math.min(compactViewport ? 180 : 130, Math.floor(w * 0.24)));
      const insetY = Math.max(54, Math.min(compactViewport ? 140 : 100, Math.floor(h * 0.24)));
      const innerW = Math.max(320, w - insetX * 2);
      const innerH = Math.max(220, h - insetY * 2);
      const chamfer = Math.max(52, Math.min(compactViewport ? 148 : 108, Math.floor(Math.min(innerW, innerH) * 0.22)));
      const shoulder = Math.max(32, Math.min(compactViewport ? 92 : 72, Math.floor(Math.min(innerW, innerH) * 0.12)));
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
      return;
    }

    this.roomBoundary = { type: 'rect', x: 0, y: 0, w, h };
    this._boundaryCentroid = { x: w / 2, y: h / 2 };
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

    const cx = this._boundaryCentroid.x - best.x;
    const cy = this._boundaryCentroid.y - best.y;
    const clen = Math.hypot(cx, cy) || 1;
    const nudged = {
      x: best.x + (cx / clen) * (margin + 1),
      y: best.y + (cy / clen) * (margin + 1),
    };

    if (this.isPointInsideRoom(nudged.x, nudged.y, margin)) return nudged;
    if (this.isPointInsideRoom(best.x, best.y, 0)) return best;
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
    this.debugGfx.setVisible(true);
    this._redrawDebugOverlay();
  }

  _redrawDebugOverlay() {
    if (!this.debugGfx) return;
    this.debugGfx.clear();

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
    }

    if (!this.showCollisionDebug) return;

    const drawRects = (rects, fill, stroke) => {
      rects.forEach((r) => {
        g.fillStyle(fill, 0.22);
        g.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
        g.lineStyle(1, stroke, 0.95);
        g.strokeRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
      });
    };

    drawRects(this.staticSolidZones, 0xef4444, 0xfca5a5);
    drawRects(this.dynamicSolidZones, 0xf59e0b, 0xfde68a);
  }

  // ── Per-zone renderer ──────────────────────────────────────────────────────────

  _draw(z) {
    const g = this.gfx;
    const s = this.scene;
    const { x, y, w = 0, h = 0 } = z;

    switch (z.type) {

      case 'wall':
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
        g.fillStyle(C.ENTRY_MAT, 1);
        g.fillRect(x, y, w, h);
        g.lineStyle(2, C.WALL, 1);
        g.strokeRect(x, y, w, h);
        this._lbl(x + w / 2, y + h / 2, z.label, LABEL_STYLE, 0.5, 0.5);
        break;

      case 'shelf':
      case 'wall_shelf':
        this._drawShelf(x, y, w, h, z.label);
        if (z.interact) this.interactZones.push(z);
        break;

      case 'counter':
        g.fillStyle(C.COUNTER, 1);
        g.fillRect(x, y, w, h);
        g.lineStyle(2, C.WALL, 1);
        g.strokeRect(x, y, w, h);
        this._lbl(x + w / 2, y + h / 2, z.label, LABEL_STYLE, 0.5, 0.5);
        if (z.interact) this.interactZones.push(z);
        break;

      case 'book_table':
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

      case 'seating':
        g.fillStyle(C.SEATING, 0.35);
        g.fillRect(x, y, w, h);
        g.lineStyle(1, C.WALL, 0.4);
        g.strokeRect(x, y, w, h);
        this._lbl(x + w / 2, y + 8, z.label, LABEL_STYLE, 0.5, 0);
        break;

      case 'couch': {
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
        this._lbl(x + (w || 0) / 2, y + (h || 0) / 2, z.label, SIGN_STYLE, 0.5, 0.5);
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
    if (!text) return;
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

    g.fillStyle(colors.fill, 0.85);
    g.fillRect(x - w / 2, y - h / 2, w, h);
    g.lineStyle(1.5, colors.stroke, 1);
    g.strokeRect(x - w / 2, y - h / 2, w, h);

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
    this.debugGfx.destroy();
    this.gfx.destroy();
    this.labels.forEach(l => l.destroy());
  }
}
