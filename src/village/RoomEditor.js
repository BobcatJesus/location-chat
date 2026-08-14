import { DEPTH } from './depth.js';

export class RoomEditor {
  constructor(scene) {
    this.scene = scene;
    this.isActive = false;
    this.selectedZoneType = 'prop_table_round';
    this.activeTool = 'place';
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
      { name: 'tree',                css: '#166534', label: 'Tree',       w: 52, h: 94, solid: true, frameKey: null },
      { name: 'shrub',               css: '#4ade80', label: 'Shrub',      w: 62, h: 40, solid: false, frameKey: null },
      { name: 'bench',               css: '#92400e', label: 'Bench',      w: 88, h: 38, solid: true, frameKey: null },
      { name: 'lamppost',            css: '#facc15', label: 'Lamp Post',  w: 30, h: 108, solid: true, frameKey: null },
      { name: 'flowerbed',           css: '#f472b6', label: 'Flowers',    w: 78, h: 42, solid: false, frameKey: null },
    ];
    this._zoneTypeConfig = new Map(this.zoneTypes.map((zoneType) => [zoneType.name, zoneType]));
    this.editGraphics = scene.add.graphics().setDepth(DEPTH.UI - 1).setVisible(false);
    this.panel = null;
    this.hoveredZone = null;
    this.customZones = [];
    this._zoneTypeButtons = new Map();
    this._pointerMove = null;
    this._pointerDown = null;
    this._onContextMenu = null;
  }

  _isMobileLayout() {
    return typeof window !== 'undefined' && window.innerWidth <= 768;
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
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
    this._zoneTypeButtons.clear();
    const isMobile = this._isMobileLayout();
    const div = document.createElement('div');
    div.style.cssText = [
      'position:fixed',
      isMobile ? 'left:8px' : 'top:12px',
      isMobile ? 'right:8px' : 'right:12px',
      isMobile ? 'bottom:calc(8px + env(safe-area-inset-bottom, 0px))' : '',
      !isMobile ? 'top:12px' : '',
      'z-index:9999',
      'background:rgba(13,13,13,0.92)', 'border:1px solid #555',
      'padding:10px 12px', 'font-family:Courier New,monospace',
      'font-size:11px', 'color:#fff', isMobile ? '' : 'min-width:150px',
      isMobile ? 'max-height:38vh' : '',
      isMobile ? 'overflow-y:auto' : '',
      'user-select:none', 'border-radius:4px',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = isMobile ? '\u270f EDIT (Tap to Place)' : '\u270f  EDIT MODE';
    title.style.cssText = 'color:#ffff00;font-weight:bold;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;';

    const toolWrap = document.createElement('div');
    toolWrap.style.cssText = 'display:flex;gap:4px;';

    const placeBtn = document.createElement('button');
    placeBtn.textContent = 'Place';
    placeBtn.style.cssText = [
      'border:none', 'cursor:pointer', 'border-radius:3px',
      'padding:4px 8px', 'font-family:Courier New,monospace',
      'font-size:10px', this.activeTool === 'place' ? 'background:#22c55e;color:#052e16' : 'background:#1f2937;color:#cbd5e1',
    ].join(';');
    placeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.activeTool = 'place';
      this._buildPanel();
    });

    const eraseBtn = document.createElement('button');
    eraseBtn.textContent = 'Erase';
    eraseBtn.style.cssText = [
      'border:none', 'cursor:pointer', 'border-radius:3px',
      'padding:4px 8px', 'font-family:Courier New,monospace',
      'font-size:10px', this.activeTool === 'erase' ? 'background:#ef4444;color:#fee2e2' : 'background:#1f2937;color:#cbd5e1',
    ].join(';');
    eraseBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.activeTool = 'erase';
      this._buildPanel();
    });

    toolWrap.appendChild(placeBtn);
    toolWrap.appendChild(eraseBtn);
    title.appendChild(toolWrap);
    div.appendChild(title);

    const palette = document.createElement('div');
    palette.style.cssText = isMobile
      ? 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;'
      : 'display:block;';

    this.zoneTypes.forEach(zt => {
      const btn = document.createElement('button');
      btn.textContent = zt.label;
      btn.style.cssText = this._zoneButtonStyle(zt, zt.name === this.selectedZoneType, isMobile);
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.selectedZoneType = zt.name;
        this._refreshZoneTypeButtons();
      });
      this._zoneTypeButtons.set(zt.name, { btn, zt });
      palette.appendChild(btn);
    });
    div.appendChild(palette);

    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:8px;color:#888;font-size:9px;line-height:1.6;';
    hint.innerHTML = isMobile
      ? 'Place mode: tap to add<br>Erase mode: tap your item<br><b style="color:#aaa">Edit button: exit</b>'
      : 'Tap: place<br>Right-click: delete yours<br><b style="color:#aaa">Edit button or ~: exit</b>';
    div.appendChild(hint);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '🗑 Clear My Items';
    clearBtn.style.cssText = [
      'display:block', 'width:100%', 'margin-top:8px',
      isMobile ? 'padding:8px 10px' : 'padding:4px 8px', 'border:none', 'cursor:pointer',
      'background:#7f1d1d', 'color:#fca5a5',
      'font-family:Courier New,monospace', isMobile ? 'font-size:11px' : 'font-size:10px',
      'border-radius:2px',
    ].join(';');
    clearBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (confirm('Remove all items you placed?')) {
        this.scene.clearOwnDecorations?.();
      }
    });
    div.appendChild(clearBtn);

    document.body.appendChild(div);
    this.panel = div;
  }

  _zoneButtonStyle(zoneType, isSelected, isMobile = false) {
    return [
      'display:block', 'width:100%', isMobile ? '' : 'margin-bottom:4px',
      isMobile ? 'padding:8px 6px' : 'padding:4px 8px', 'border:none', 'cursor:pointer',
      `background:${isSelected ? zoneType.css : '#2a2a2a'}`,
      `color:${isSelected ? '#000' : '#ddd'}`,
      'font-family:Courier New,monospace', isMobile ? 'font-size:11px' : 'font-size:10px',
      isMobile ? 'text-align:center' : 'text-align:left', 'border-radius:2px',
      isMobile ? 'min-height:36px' : '',
    ].join(';');
  }

  _getZoneTypeConfig(zoneTypeName) {
    return this._zoneTypeConfig.get(zoneTypeName) || this._zoneTypeConfig.get(this.selectedZoneType) || this.zoneTypes[0];
  }

  _refreshZoneTypeButtons() {
    const isMobile = this._isMobileLayout();
    this._zoneTypeButtons.forEach(({ btn, zt }, name) => {
      btn.style.cssText = this._zoneButtonStyle(zt, name === this.selectedZoneType, isMobile);
    });
  }

  _setupPointer() {
    const canvas = this.scene.game?.canvas;
    this._pointerMove = (ptr) => {
      this.hoveredZone = this.customZones.find(z => this._hit(ptr.worldX, ptr.worldY, z)) ?? null;
      this._redraw();
    };
    this._pointerDown = (ptr) => {
      if (!this.isActive) return;
      const hitZone = this.customZones.find(z => this._hit(ptr.worldX, ptr.worldY, z)) ?? null;
      this.hoveredZone = hitZone;

      const isPrimary = ptr.button === 0;
      const usingEraseTool = this.activeTool === 'erase';

      if (isPrimary && usingEraseTool) {
        if (hitZone?.id) {
          const canRemove = !hitZone.placedBy || hitZone.placedBy === this.scene.userId;
          if (!canRemove) {
            this.scene.onSystemNotice?.('You can only erase items you placed.');
            return;
          }
          this.scene.removeDecoration?.(hitZone.id);
          this.hoveredZone = null;
          this._redraw();
        }
        return;
      }

      if (isPrimary) {
        const zoneTypeConfig = this._getZoneTypeConfig(this.selectedZoneType);
        const zone = {
          type: this.selectedZoneType,
          frameKey: zoneTypeConfig.frameKey === undefined ? this.selectedZoneType : zoneTypeConfig.frameKey,
          x: ptr.worldX, y: ptr.worldY,
          w: zoneTypeConfig.w || 60,
          h: zoneTypeConfig.h || 60,
          solid: zoneTypeConfig.solid !== false,
        };
        console.log('[RoomEditor] placing', zone.type, 'at world', Math.round(zone.x), Math.round(zone.y));
        const placed = this.scene.placeDecoration?.(zone);
        if (placed === false) {
          this.scene.onSystemNotice?.('Try placing inside the room walls.');
        }
      } else if (ptr.button === 2 && hitZone) {
        this.scene.removeDecoration?.(hitZone.id);
        this.hoveredZone = null;
        this._redraw();
      }
    };
    this._onContextMenu = (event) => {
      event.preventDefault();
    };
    this.scene.input.on('pointermove', this._pointerMove);
    this.scene.input.on('pointerdown', this._pointerDown);
    canvas?.addEventListener('contextmenu', this._onContextMenu);
    this.scene.input.mouse?.disableContextMenu();
  }

  _clearPointer() {
    const canvas = this.scene.game?.canvas;
    if (this._pointerMove) this.scene.input.off('pointermove', this._pointerMove);
    if (this._pointerDown) this.scene.input.off('pointerdown', this._pointerDown);
    if (this._onContextMenu) canvas?.removeEventListener('contextmenu', this._onContextMenu);
    if (typeof this.scene.input.mouse?.enableContextMenu === 'function') {
      this.scene.input.mouse.enableContextMenu();
    }
    this._pointerMove = null;
    this._pointerDown = null;
    this._onContextMenu = null;
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
