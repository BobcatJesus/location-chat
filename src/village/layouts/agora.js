// Agora — the cafe room for room "agora-houston".
//
// Base: the very large empty-space template (layouts/default.js) — a
// full 1600x900 room, spawn by the entrance — furnished for the first
// time in the Agora furniture pass (`agora-furniture-v1`):
//   - a coffee bar along the north wall, with the Barista NPC behind it
//     (buy a coffee there: -2 coins, reusing the existing drink system)
//   - a clear entrance at the bottom centre, spawn just inside it
//   - plants in the corners, a trash can by the bar (it hides puzzle
//     piece 5 — see PuzzleQuest.js), a rug with two couches facing each
//     other, a framed portrait on the north wall, and four cafe tables
//     (the puzzle pieces hide under three of them)
//
// Walkways are kept clear: the centre aisle from the entrance to the
// puzzle table is open, and nothing solid blocks the bar, the table,
// the couches, or the cat's sunbeam (south-east, ~1117,583).
//
// Wiring: layoutPicker.js returns this layout for agora-houston, and
// VillageCanvas.jsx forces it (forceAgoraLayout) so the auto-generated
// two-level scaffold for Agora's building:levels=2 never replaces it.
// An approved user layout from the server still wins over this file
// (explicitLayout), as with every other room.

export const FLOOR_W = 1600;
export const FLOOR_H = 900;

// agora-furniture-v1 — marker for the furniture-pass landing check.
export const AGORA_FURNITURE_MARKER = 'agora-furniture-v1';

const AGORA_BOUNDARY = [
  { x: 80, y: 80 }, { x: 1520, y: 80 }, { x: 1520, y: 820 }, { x: 80, y: 820 },
];

const F1_ZONES = [
  // Big empty room shell (the default template's footprint).
  { type: 'wall', x: 0, y: 0, w: FLOOR_W, h: FLOOR_H, solid: true, color: 0x2b2b33 },
  { type: 'wall_polygon', points: AGORA_BOUNDARY, solid: false },

  // Entrance (bottom centre) — spawn is just inside it.
  { type: 'entry', x: 700, y: 780, w: 200, h: 40, label: 'Entrance' },

  // Coffee bar along the north wall. Type 'counter' + a label with
  // "Bar" in it is what the existing drink system looks for
  // (VillageScene._nearestBar / _tryBuyDrink): walk up, press E,
  // -2 coins, instant buy — there is no "Bartender" NPC here, the
  // Barista serves coffee, so no beer drink card ever appears.
  { type: 'counter', x: 420, y: 110, w: 760, h: 64, label: '☕ Coffee Bar', interact: true, solid: true },
  { type: 'sign', x: 560, y: 186, w: 480, h: 20, label: '☕ AGORA COFFEE BAR' },
  { type: 'sign', x: 180, y: 110, w: 220, h: 24, label: '☕ AGORA' },

  // The Barista, patrolling in front of the counter. She is the NPC
  // the puzzle's "ask the barista" piece comes from (any nearby NPC
  // works for that — see VillageScene sendChatMessage).
  { type: 'employee', x: 800, y: 212, w: 40, h: 56, label: 'Barista', patrol: [[560, 212], [800, 212], [1040, 212]] },

  // Framed portrait on the north wall, east end.
  { type: 'portrait', x: 1300, y: 92, w: 110, h: 64, label: 'Portrait', solid: false },

  // Trash can by the bar — puzzle piece 5 hides in it (PuzzleQuest.js
  // resolves it from this zone; it replaces the old bookshelf spot).
  { type: 'trash_can', x: 1230, y: 120, w: 36, h: 36, label: 'Trash Can', interact: true, solid: true },

  // Plants in the corners / along the edges — small solid footprints,
  // never in a walkway.
  { type: 'plant', x: 130, y: 180, w: 48, h: 48, label: 'Plant', solid: true },
  { type: 'plant', x: 130, y: 690, w: 48, h: 48, label: 'Plant', solid: true },
  { type: 'plant', x: 1470, y: 260, w: 48, h: 48, label: 'Plant', solid: true },
  { type: 'plant', x: 1470, y: 690, w: 48, h: 48, label: 'Plant', solid: true },

  // Central seating: rug with two couches facing each other across it
  // (west of the centre aisle, so the puzzle table keeps room centre).
  { type: 'rug', x: 480, y: 430, w: 320, h: 160, label: 'Rug', solid: false },
  { type: 'couch', x: 540, y: 360, w: 200, h: 60, label: 'Couch', solid: true },
  { type: 'couch', x: 540, y: 600, w: 200, h: 60, label: 'Couch', solid: true },

  // Cafe tables — the same 60px circles every other Agora table uses.
  // Pieces 0-2 of the group puzzle hide under Tables 1-3.
  { type: 'cafe_table', x: 300, y: 280, label: 'Table 1', interact: true },
  { type: 'cafe_table', x: 1180, y: 300, label: 'Table 2', interact: true },
  { type: 'cafe_table', x: 1260, y: 640, label: 'Table 3', interact: true },
  { type: 'cafe_table', x: 300, y: 640, label: 'Table 4', interact: true },
];

export const agora = {
  id: 'agora-houston',
  name: 'Agora',
  // Marker string for the landing check — kept on the live object (not
  // just in a comment) so it survives minification into the built bundle.
  marker: AGORA_FURNITURE_MARKER,
  spawnF1: { x: 800, y: 720 },
  floors: [
    {
      id: 'ground',
      name: 'Ground Floor',
      width: FLOOR_W,
      height: FLOOR_H,
      carpet: 0xfef3c7,
      wallColor: 0x2b2b33,
      zones: F1_ZONES,
    },
  ],
};
