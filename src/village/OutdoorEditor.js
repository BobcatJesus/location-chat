import { RoomEditor } from './RoomEditor.js';

const OUTDOOR_ZONE_TYPES = [
  { name: 'tree',       css: '#166534', label: 'Tree',       w: 52, h: 94, solid: true, frameKey: null },
  { name: 'shrub',      css: '#4ade80', label: 'Shrub',      w: 62, h: 40, solid: false, frameKey: null },
  { name: 'bench',      css: '#92400e', label: 'Bench',      w: 88, h: 38, solid: true, frameKey: null },
  { name: 'lamppost',   css: '#facc15', label: 'Lamp Post',  w: 30, h: 108, solid: true, frameKey: null },
  { name: 'flowerbed',  css: '#f472b6', label: 'Flowers',    w: 78, h: 42, solid: false, frameKey: null },
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
    this.setZoneTypes(OUTDOOR_ZONE_TYPES, 'tree');
  }
}
