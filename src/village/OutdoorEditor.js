import { RoomEditor } from './RoomEditor.js';

const OUTDOOR_ZONE_TYPES = [
  { name: 'oak_tree',   css: '#14532d', label: 'Oak Tree',   w: 76, h: 132, solid: true, frameKey: 'prop_plant_potted' },
  { name: 'tree',       css: '#166534', label: 'Tree',       w: 52, h: 94, solid: true, frameKey: 'prop_plant_potted' },
  { name: 'shrub',      css: '#4ade80', label: 'Shrub',      w: 62, h: 40, solid: false, frameKey: 'prop_plant_potted' },
  { name: 'hedge',      css: '#22c55e', label: 'Hedge',      w: 112, h: 44, solid: false, frameKey: 'prop_plant_potted' },
  { name: 'bench',      css: '#92400e', label: 'Bench',      w: 88, h: 38, solid: true, frameKey: 'prop_chair_wooden' },
  { name: 'lamppost',   css: '#facc15', label: 'Lamp Post',  w: 30, h: 108, solid: true, frameKey: 'prop_lamp_floor' },
  { name: 'flowerbed',  css: '#f472b6', label: 'Flowers',    w: 78, h: 42, solid: false, frameKey: 'prop_rug_rolled' },
];

export class OutdoorEditor extends RoomEditor {
  constructor(scene) {
    super(scene);
    this.editorLabel = 'OUTDOOR EDIT MODE';
    this.placeButtonLabel = 'Place Outdoor';
    this.eraseButtonLabel = 'Erase';
    this.clearButtonLabel = '🗑 Clear Outdoor Items';
    this.placeHintText = 'Place mode: tap to add trees, benches, and lamps<br>Erase mode: tap your item<br><b style="color:#aaa">Edit button: exit</b>';
    this.eraseHintText = 'Tap: place outdoor item<br>Right-click: delete yours<br><b style="color:#aaa">Edit button or ~: exit</b>';
    this.placementSnapSize = 40;
    this.previewFillAlpha = 0.22;
    this.previewStrokeAlpha = 0.98;
    this.previewLabelAlpha = 0.98;
    this.setZoneTypes(OUTDOOR_ZONE_TYPES, 'tree');
  }

  _drawOutdoorOverlay(g, z, isHovered = false, isPreview = false) {
    // Outdoor props are rendered as sprites in VillageScene._renderSavedProps, so the editor
    // must not paint any visible fallback geometry (boxes/circles/rectangles) over them.
    void g;
    void z;
    void isHovered;
    void isPreview;
    return true;
  }

  _redraw() {
    const g = this.editGraphics;
    g.clear();
    if (!this.isActive) return;

    for (const z of this.customZones) {
      this._drawOutdoorOverlay(g, z, z === this.hoveredZone, false);
    }

    if (this.previewZone && this.activeTool === 'place') {
      this._drawOutdoorOverlay(g, this.previewZone, true, true);
    }
  }
}
