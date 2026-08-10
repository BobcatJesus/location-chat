import { DEPTH } from './depth.js';

export class RoomEditor {
  constructor(scene) {
    this.scene = scene;
    this.isActive = false;
    this.selectedZoneType = 'prop_table_round';
    this.zoneTypes = [
      { name: 'prop_table_round',    css: '#8b4513', label: 'Table' },
      { name: 'prop_chair_wooden',   css: '#a0522d', label: 'Chair' },
      { name: 'prop_plant_potted',   css: '#228b22', label: 'Plant' },
      { name: 'prop_bookshelf',      css: '#6b4c2a', label: 'Bookshelf' },
      { name: 'prop_lamp_floor',     css: '#d4a017', label: 'Floor Lamp' },
      { name: 'prop_jukebox',        css: '#c0392b', label: 'Jukebox' },
      { name: 'prop_trash_can',      css: '#888888', label: 'Trash Can' },
      { name: 'prop_coffee_cup',     css: '#4a2c0a', label: 'Coffee Cup' },
      { name: 'prop_books_stack',    css: '#2e86ab', label: 'Books' },
      { name: 'prop_candle',         css: '#f5c842', label: 'Candle' },
      { name: 'prop_rug_rolled',     css: '#c8a96e', label: 'Rug' },
      { name: 'prop_portrait_framed',css: '#7d6b4a', label: 'Portrait' },
    ];
    this.editGraphics = scene.add.graphics().setDepth(DEPTH.UI - 1).setVisible(false);
    this.panel = null;
    this.hoveredZone = null;
    this.customZones = [];
    this._pointerMove = null;
    this._pointerDown = null;
  }

  setZones(zones) {
    this.customZones = Array.isArray(zones) ? zones : [];
    this.hoveredZone = null;
    this._redraw();
  }

  toggle() {
    if (this.isActive) { this._disable(); } else { this._enable(); }
  }

  _enable() {
    this.isActive = true;
    this.editGraphics.setVisible(true);
    this._buildPanel();
    this._setupPointer();
    this._redraw();
    console.log('[RoomEditor] enabled');
  }

  _disable() {
    this.isActive = false;
    this.editGraphics.setVisible(false);
    if (this.panel) { this.panel.remove(); this.panel = null; }
    this._clearPointer();
    console.log('[RoomEditor] disabled');
  }

  _buildPanel() {
    const div = document.createElement('div');
    div.style.cssText = [
      'position:fixed', 'top:12px', 'right:12px', 'z-index:9999',
      'background:rgba(13,13,13,0.92)', 'border:1px solid #555',
      'padding:10px 12px', 'font-family:Courier New,monospace',
      'font-size:11px', 'color:#fff', 'min-width:150px',
      'user-select:none', 'border-radius:4px',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = '\u270f  EDIT MODE';
    title.style.cssText = 'color:#ffff00;font-weight:bold;margin-bottom:8px;';
    div.appendChild(title);

    this.zoneTypes.forEach(zt => {
      const btn = document.createElement('button');
      btn.textContent = zt.label;
      const sel = zt.name === this.selectedZoneType;
      btn.style.cssText = [
        'display:block', 'width:100%', 'margin-bottom:4px',
        'padding:4px 8px', 'border:none', 'cursor:pointer',
        `background:${sel ? zt.css : '#2a2a2a'}`,
        `color:${sel ? '#000' : '#ddd'}`,
        'font-family:Courier New,monospace', 'font-size:10px',
        'text-align:left', 'border-radius:2px',
      ].join(';');
      btn.addEventListener('click', () => {
        this.selectedZoneType = zt.name;
        this._disable();
        this._enable();
      });
      div.appendChild(btn);
    });

    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:8px;color:#888;font-size:9px;line-height:1.6;';
    hint.innerHTML = 'Tap: place<br>Right-click: delete yours<br><b style="color:#aaa">Edit button or E: exit</b>';
    div.appendChild(hint);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '🗑 Clear My Items';
    clearBtn.style.cssText = [
      'display:block', 'width:100%', 'margin-top:8px',
      'padding:4px 8px', 'border:none', 'cursor:pointer',
      'background:#7f1d1d', 'color:#fca5a5',
      'font-family:Courier New,monospace', 'font-size:10px',
      'border-radius:2px',
    ].join(';');
    clearBtn.addEventListener('click', () => {
      if (confirm('Remove all items you placed?')) {
        this.scene.clearOwnDecorations?.();
      }
    });
    div.appendChild(clearBtn);

    document.body.appendChild(div);
    this.panel = div;
  }

  _setupPointer() {
    this._pointerMove = (ptr) => {
      this.hoveredZone = this.customZones.find(z => this._hit(ptr.worldX, ptr.worldY, z)) ?? null;
      this._redraw();
    };
    this._pointerDown = (ptr) => {
      if (ptr.button === 0) {
        const zone = {
          type: this.selectedZoneType,
          frameKey: this.selectedZoneType,
          x: ptr.worldX, y: ptr.worldY,
          w: 60, h: 60,
        };
        console.log('[RoomEditor] placing', zone.type, 'at world', Math.round(zone.x), Math.round(zone.y));
        this.scene.placeDecoration?.(zone);
      } else if (ptr.button === 2 && this.hoveredZone) {
        this.scene.removeDecoration?.(this.hoveredZone.id);
        this.hoveredZone = null;
        this._redraw();
      }
    };
    this.scene.input.on('pointermove', this._pointerMove);
    this.scene.input.on('pointerdown', this._pointerDown);
    this.scene.input.mouse?.disableContextMenu();
  }

  _clearPointer() {
    if (this._pointerMove) this.scene.input.off('pointermove', this._pointerMove);
    if (this._pointerDown) this.scene.input.off('pointerdown', this._pointerDown);
    this.scene.input.mouse?.enableContextMenu();
    this._pointerMove = null;
    this._pointerDown = null;
  }

  _redraw() {
    const g = this.editGraphics;
    g.clear();
    if (!this.isActive) return;
    for (const z of this.customZones) {
      const hov = z === this.hoveredZone;
      // Only draw a border outline so sprites show through
      g.lineStyle(hov ? 3 : 1, hov ? 0xffff00 : 0xffffff, 0.8);
      g.strokeRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
    }
  }

  _hit(px, py, z) {
    return px >= z.x - z.w / 2 && px <= z.x + z.w / 2 &&
           py >= z.y - z.h / 2 && py <= z.y + z.h / 2;
  }

  destroy() {
    if (this.isActive) this._disable();
    this.editGraphics.destroy();
  }
}
