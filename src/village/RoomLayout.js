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

    const wall = floor.zones.find(z => z.type === 'wall');
    const W = wall?.w || 1600, H = wall?.h || 900;

    // Carpet fill
    this.gfx.fillStyle(floor.carpet, 1);
    this.gfx.fillRect(0, 0, W, H);

    // Draw all zones
    floor.zones.forEach(z => {
      this._draw(z);
      this.currentZones.push(z);
    });

    // Draw custom zones from editor (if any)
    const customZones = this.scene.roomEditor?.customZones || [];
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
    this.gfx.destroy();
    this.labels.forEach(l => l.destroy());
  }
}
