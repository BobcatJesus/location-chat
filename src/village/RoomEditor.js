import { DEPTH } from './depth.js';

export class RoomEditor {
  constructor(scene) {
    this.scene = scene;
    this.isActive = false;
    this.selectedZoneType = 'prop_table_round';
    this.activeTool = 'place';
    this.editorLabel = 'ROOM EDIT MODE';
    this.placeButtonLabel = 'Place';
    this.eraseButtonLabel = 'Erase';
    this.clearButtonLabel = '🗑 Clear My Items';
    this.placeHintText = 'Place mode: tap to add furniture or borders<br>Erase mode: tap your item<br><b style="color:#aaa">Edit button: exit</b>';
    this.eraseHintText = 'Tap: place furniture or borders<br>Right-click: delete yours<br><b style="color:#aaa">Edit button or ~: exit</b>';
    this.placementSnapSize = 20;
    this.previewFillAlpha = 0.18;
    this.previewStrokeAlpha = 0.95;
    this.previewLabelAlpha = 0.95;
    this.previewOutlineDash = null;
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
      { name: 'bookshelf_border_h',  css: '#7c4a1d', label: 'Bookshelf Wall', w: 220, h: 34, frameKey: 'prop_bookshelf', renderAsZone: 'shelf' },
      { name: 'bookshelf_border_v',  css: '#7c4a1d', label: 'Tall Shelf Wall', w: 34, h: 220, frameKey: 'prop_bookshelf', renderAsZone: 'shelf' },
      { name: 'restroom_block',      css: '#64748b', label: 'Restroom', w: 150, h: 120, frameKey: 'prop_portrait_framed', renderAsZone: 'bathroom' },
      { name: 'service_counter_h',   css: '#8b6a50', label: 'Counter', w: 240, h: 42, frameKey: 'prop_table_round', renderAsZone: 'counter' },
      { name: 'coffee_bar_h',        css: '#0f6b4f', label: 'Coffee Bar', w: 260, h: 54, frameKey: 'prop_table_round', renderAsZone: 'cafe_counter' },
      { name: 'plant_border_h',      css: '#166534', label: 'Plant Border', w: 200, h: 44, frameKey: 'prop_plant_potted', renderAsZone: 'planter_border' },
      { name: 'plant_border_v',      css: '#166534', label: 'Tall Plant Border', w: 44, h: 200, frameKey: 'prop_plant_potted', renderAsZone: 'planter_border' },
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
    this.previewZone = null;
  }

  setZoneTypes(zoneTypes, selectedZoneType = null) {
    this.zoneTypes = Array.isArray(zoneTypes) ? zoneTypes : [];
    this._zoneTypeConfig = new Map(this.zoneTypes.map((zoneType) => [zoneType.name, zoneType]));
    if (selectedZoneType && this._zoneTypeConfig.has(selectedZoneType)) {
      this.selectedZoneType = selectedZoneType;
    } else if (!this._zoneTypeConfig.has(this.selectedZoneType) && this.zoneTypes[0]) {
      this.selectedZoneType = this.zoneTypes[0].name;
    }
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
    this.previewZone = null;
    console.log('[RoomEditor] disabled');
  }

  _buildPanel() {
    // Remove any stale editor panels left from previous scene instances.
    document.querySelectorAll('[data-sidequest-editor-panel="true"]').forEach((panel) => panel.remove());

    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
    this._zoneTypeButtons.clear();
    const isMobile = this._isMobileLayout();
    const div = document.createElement('div');
    div.setAttribute('data-sidequest-editor-panel', 'true');
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
    title.textContent = isMobile ? `\u270f ${this.editorLabel} (Tap to Place)` : `\u270f  ${this.editorLabel}`;
    title.style.cssText = 'color:#ffff00;font-weight:bold;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;';

    const toolWrap = document.createElement('div');
    toolWrap.style.cssText = 'display:flex;gap:4px;';

    const placeBtn = document.createElement('button');
    placeBtn.textContent = this.placeButtonLabel;
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
    eraseBtn.textContent = this.eraseButtonLabel;
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
      ? this.placeHintText
      : this.eraseHintText;
    div.appendChild(hint);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = this.clearButtonLabel;
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

  _snapValue(value) {
    if (!this.placementSnapSize) return value;
    return Math.round(value / this.placementSnapSize) * this.placementSnapSize;
  }

  _buildPlacementZone(ptr) {
    const zoneTypeConfig = this._getZoneTypeConfig(this.selectedZoneType);
    const x = this._snapValue(ptr.worldX);
    const y = this._snapValue(ptr.worldY);
    return {
      type: this.selectedZoneType,
      frameKey: zoneTypeConfig.frameKey === undefined ? this.selectedZoneType : zoneTypeConfig.frameKey,
      x,
      y,
      w: zoneTypeConfig.w || 60,
      h: zoneTypeConfig.h || 60,
      label: zoneTypeConfig.label,
      renderAsZone: zoneTypeConfig.renderAsZone || null,
      solid: zoneTypeConfig.solid !== false,
    };
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
      this.previewZone = this.activeTool === 'place' ? this._buildPlacementZone(ptr) : null;
      this._redraw();
    };
    this._pointerDown = (ptr) => {
      if (!this.isActive) return;
      this.scene.target = null;
      this.scene.player?.avatar?.setMovementState?.({
        moving: false,
        direction: this.scene.dir || 'front',
        facingLeft: Boolean(this.scene.player?.facingLeft),
      });
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
        const zone = this._buildPlacementZone(ptr);
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

    const drawOutdoorOverlay = (z, isHovered = false, isPreview = false) => {
      const x = Number(z?.x || 0);
      const y = Number(z?.y || 0);
      const w = Math.max(10, Number(z?.w || 60));
      const h = Math.max(10, Number(z?.h || 60));
      const type = String(z?.type || '');
      const strokeColor = isHovered ? 0xfacc15 : 0xe2e8f0;
      const strokeAlpha = isPreview ? this.previewStrokeAlpha : (isHovered ? 0.95 : 0.65);
      const fillAlpha = isPreview ? this.previewFillAlpha : (isHovered ? 0.2 : 0.12);

      if (type === 'tree') {
        const canopyR = Math.max(12, w * 0.34);
        g.fillStyle(0x166534, fillAlpha + 0.06);
        g.fillCircle(x, y - h * 0.56, canopyR);
        g.fillStyle(0x8b5a2b, fillAlpha + 0.08);
        g.fillRect(x - 4, y - h * 0.3, 8, h * 0.26);
        g.lineStyle(2, strokeColor, strokeAlpha);
        g.strokeCircle(x, y - h * 0.56, canopyR);
        return true;
      }

      if (type === 'shrub') {
        g.fillStyle(0x4ade80, fillAlpha + 0.06);
        g.fillEllipse(x, y - h * 0.12, w * 0.92, h * 0.7);
        g.lineStyle(2, strokeColor, strokeAlpha);
        g.strokeEllipse(x, y - h * 0.12, w * 0.92, h * 0.7);
        return true;
      }

      if (type === 'bench') {
        g.fillStyle(0x92400e, fillAlpha + 0.08);
        g.fillRoundedRect(x - w * 0.4, y - h * 0.32, w * 0.8, h * 0.18, 4);
        g.fillRoundedRect(x - w * 0.34, y - h * 0.52, w * 0.68, h * 0.14, 4);
        g.lineStyle(2, strokeColor, strokeAlpha);
        g.strokeRoundedRect(x - w * 0.4, y - h * 0.32, w * 0.8, h * 0.18, 4);
        return true;
      }

      if (type === 'lamppost') {
        g.lineStyle(3, 0x475569, Math.max(0.65, strokeAlpha));
        g.beginPath();
        g.moveTo(x, y - h * 0.5);
        g.lineTo(x, y + h * 0.08);
        g.strokePath();
        g.fillStyle(0xfacc15, fillAlpha + 0.1);
        g.fillCircle(x, y - h * 0.56, Math.max(6, w * 0.26));
        g.lineStyle(2, strokeColor, strokeAlpha);
        g.strokeCircle(x, y - h * 0.56, Math.max(6, w * 0.26));
        return true;
      }

      if (type === 'flowerbed') {
        g.fillStyle(0xf472b6, fillAlpha + 0.06);
        g.fillRoundedRect(x - w / 2, y - h / 2, w, h * 0.75, 8);
        g.lineStyle(2, strokeColor, strokeAlpha);
        g.strokeRoundedRect(x - w / 2, y - h / 2, w, h * 0.75, 8);
        return true;
      }

      return false;
    };

    for (const z of this.customZones) {
      const hov = z === this.hoveredZone;
      const isOutdoorProp = this._isOutdoorPropType(z?.type);
      if (drawOutdoorOverlay(z, hov, false)) continue;
      if (isOutdoorProp) continue;
      // Only draw a border outline so sprites show through for non-outdoor props.
      g.lineStyle(hov ? 3 : 1, hov ? 0xffff00 : 0xffffff, 0.8);
      g.strokeRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
    }

    if (this.previewZone && this.activeTool === 'place') {
      const z = this.previewZone;
      const isOutdoorProp = this._isOutdoorPropType(z?.type);
      if (drawOutdoorOverlay(z, true, true)) return;
      if (isOutdoorProp) return;
      const okFill = z.solid ? 0x22c55e : 0x60a5fa;
      const okStroke = z.solid ? 0x16a34a : 0x2563eb;
      g.fillStyle(okFill, this.previewFillAlpha);
      g.fillRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
      g.lineStyle(2, okStroke, this.previewStrokeAlpha);
      g.strokeRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
    }
  }

  _isOutdoorPropType(type) {
    return ['tree', 'shrub', 'bench', 'lamppost', 'flowerbed'].includes(String(type || ''));
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
