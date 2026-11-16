// Home — your place, the personal home room for one player
// (roomId `home-<ownerId>`, Your Place v1, `sq-your-place-v1`).
//
// Base: the very large empty-space template (layouts/default.js) — a
// full 1600x900 room, spawn just inside the entrance — furnished
// simply, because this room is for storage, not for quests:
//   - a storage chest against the north wall (type 'storage_chest'):
//     walk up and press E, or click it, to open the storage panel —
//     Store (pocket → home), Take (home → pocket), Unload All (the
//     whole pocket/bag into storage at once). Only the owner can
//     enter this room at all (the server refuses anyone else), so
//     the chest is only ever yours.
//   - a clear entrance at the bottom centre, spawn just inside it
//   - a rug with two couches facing each other, a couple of plants,
//     a framed portrait, and one small table — enough to feel like
//     a place, not a warehouse.
//   - NO MAILBOX here: the mailbox lives at the nearest park, not
//     outside your place (decided 2026-11-16 — separate build).
//
// Wiring: VillageCanvas.jsx forces this layout for `home-*` room ids
// (forceHomeLayout, same pattern as forceAgoraLayout). An approved
// user layout from the server still wins over this file
// (explicitLayout), as with every other room.

export const FLOOR_W = 1600;
export const FLOOR_H = 900;

// sq-your-place-v1 — marker for the v1 landing check (same marker
// string as homeStorage.js, so one proof covers both files).
export const HOME_LAYOUT_MARKER = 'sq-your-place-v1';

const HOME_BOUNDARY = [
  { x: 80, y: 80 }, { x: 1520, y: 80 }, { x: 1520, y: 820 }, { x: 80, y: 820 },
];

const F1_ZONES = [
  // Big empty room shell (the default template's footprint).
  { type: 'wall', x: 0, y: 0, w: FLOOR_W, h: FLOOR_H, solid: true, color: 0x2b2b33 },
  { type: 'wall_polygon', points: HOME_BOUNDARY, solid: false },

  // Entrance (bottom centre) — spawn is just inside it.
  { type: 'entry', x: 700, y: 780, w: 200, h: 40, label: 'Entrance' },

  // Your Place sign on the north wall, above the chest.
  { type: 'sign', x: 560, y: 100, w: 480, h: 20, label: '🏠 YOUR PLACE' },

  // The storage chest (Your Place v1, `sq-your-place-v1`): the only
  // interactable that matters in this room. Solid, so you walk up
  // to it and press E (or click it) to open the storage panel.
  { type: 'storage_chest', x: 740, y: 150, w: 120, h: 80, label: 'Storage Chest', interact: true, solid: true },

  // Framed portrait on the north wall, east end.
  { type: 'portrait', x: 1300, y: 92, w: 110, h: 64, label: 'Portrait', solid: false },

  // Plants in the corners — small solid footprints, never in a walkway.
  { type: 'plant', x: 130, y: 180, w: 48, h: 48, label: 'Plant', solid: true },
  { type: 'plant', x: 1470, y: 690, w: 48, h: 48, label: 'Plant', solid: true },

  // Central seating: rug with two couches facing each other across it.
  { type: 'rug', x: 480, y: 430, w: 320, h: 160, label: 'Rug', solid: false },
  { type: 'couch', x: 540, y: 360, w: 200, h: 60, label: 'Couch', solid: true },
  { type: 'couch', x: 540, y: 600, w: 200, h: 60, label: 'Couch', solid: true },

  // One small table, west side — a place to put things down.
  { type: 'cafe_table', x: 300, y: 280, label: 'Table', interact: true },
];

export const home = {
  id: 'home',
  name: 'Your Place',
  // Marker string for the landing check — kept on the live object (not
  // just in a comment) so it survives minification into the built bundle.
  marker: HOME_LAYOUT_MARKER,
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
