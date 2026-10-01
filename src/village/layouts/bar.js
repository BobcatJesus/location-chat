// Lola's Depot — dive bar layout for room "lolas-depot".
// Features a working jukebox (type 'jukebox', interact: true, solid: true),
// a bar counter, tables, a pool-table sign, and a bartender employee NPC.

export const FLOOR_W = 1600;
export const FLOOR_H = 900;

export const C = {
  WALL: 0x2a1a12, // dark wood
  ENTRY: 0x1e3a2f, // green entry mat
  DOOR: 0x0f2a22,
  COUNTER: 0x5a3a1e,
  COUNTER_TOP: 0x7a5230,
  TABLE: 0x4a3220,
  NEON_CYAN: 0x35e0ff,
  NEON_PINK: 0xff3da6,
  NEON_AMBER: 0xffb02e,
};

const BAR_BOUNDARY = [
  { x: 160, y: 120 }, { x: 1440, y: 120 }, { x: 1440, y: 780 },
  { x: 1280, y: 780 }, { x: 1280, y: 840 }, { x: 320, y: 840 },
  { x: 320, y: 780 }, { x: 160, y: 780 },
];

const bartenderPatrol = [
  { x: 560, y: 300 }, { x: 640, y: 300 }, { x: 720, y: 300 },
  { x: 800, y: 300 }, { x: 880, y: 300 },
];

const F1_ZONES = [
  // Dark wood room shell
  { type: 'wall', x: 0, y: 0, w: FLOOR_W, h: FLOOR_H, solid: true, color: C.WALL },
  { type: 'wall_polygon', points: BAR_BOUNDARY, solid: false },

  // Entry (bottom center)
  { type: 'entry', x: 700, y: 780, w: 200, h: 40, label: 'Entrance' },
  { type: 'sign', x: 680, y: 820, w: 240, h: 18, label: 'ENTRANCE' },

  // Bar counter along the north wall
  { type: 'counter', x: 420, y: 140, w: 760, h: 90, label: 'Bar', interact: true, solid: true },
  { type: 'sign', x: 420, y: 236, w: 760, h: 20, label: "LOLA'S DEPOT" },

  // THE JUKEBOX — northeast corner, against the wall
  { type: 'jukebox', x: 1260, y: 130, w: 100, h: 140, label: 'Jukebox', interact: true, solid: true },

  // Bar tables (reuse book_table rendering)
  { type: 'book_table', x: 300, y: 420, w: 170, h: 110, label: 'Table 1', interact: false, solid: true },
  { type: 'book_table', x: 560, y: 560, w: 170, h: 110, label: 'Table 2', interact: false, solid: true },
  { type: 'book_table', x: 900, y: 560, w: 170, h: 110, label: 'Table 3', interact: false, solid: true },
  { type: 'book_table', x: 1160, y: 420, w: 170, h: 110, label: 'Table 4', interact: false, solid: true },

  // Pool table sign in the west corner
  { type: 'sign', x: 200, y: 160, w: 170, h: 22, label: '🎱 POOL' },

  // Neon wall decor
  { type: 'sign', x: 1210, y: 320, w: 180, h: 22, label: '🍺 COLD BEER' },
  { type: 'sign', x: 200, y: 640, w: 180, h: 22, label: 'DARTS →' },

  // Bartender employee NPC, patrols behind the counter
  { type: 'employee', x: 720, y: 300, w: 40, h: 56, label: 'Bartender', patrol: bartenderPatrol },
];

export const bar = {
  id: 'lolas-depot',
  name: "Lola's Depot",
  spawnF1: { x: 800, y: 720 },
  floors: [
    {
      id: 'ground',
      name: 'Ground Floor',
      width: FLOOR_W,
      height: FLOOR_H,
      zones: F1_ZONES,
    },
  ],
};
