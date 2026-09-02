// All coordinates are in a 1600×900 world per floor.
// Floor 1 = ground, floor 2 = upstairs. Escalators link them.
// "solid" zones block movement (future collision pass).

export const FLOOR_W = 1600;
export const FLOOR_H = 900;

// ── Colour palette ─────────────────────────────────────────────────────────────
export const C = {
  CARPET_F1:  0xfef3c7, // soft butter carpet, floor 1
  CARPET_F2:  0xfef3c7, // soft butter carpet, floor 2
  WALL:       0x2b2b33,
  SHELF_WOOD: 0x5c3d2e,
  SHELF_TOP:  0x7a5240,
  TABLE_WOOD: 0xa07850,
  COUNTER:    0x8b6a50,
  STARBUCKS:  0x00704a,
  ESCALATOR:  0xd4c9b0,
  ESCALATOR_STRIPE: 0xb8aa94,
  MAGAZINE:   0xe8c4a0,
  TOY_DISPLAY:0xf9c74f,
  CD_RACK:    0x4cc9f0,
  BATHROOM:   0xdde2e4,
  WINDOW:     0xa8d8ea,
  ENTRY_MAT:  0xfaf0d7,
  RAILING:    0x8b7355,
  SEATING:    0xd9a87c,
  COUCH:      0xc4956a,
};

// ── Book spine accent colours (repeating) ─────────────────────────────────────
export const SPINES = [0xe63946, 0x457b9d, 0xf4a261, 0x2a9d8f, 0xa8dadc, 0xe9c46a, 0x6d6875, 0xf72585, 0x4361ee];

// ── Floor 1 zone list ──────────────────────────────────────────────────────────

const F1_ZONES = [
  // ── Outer boundary wall ──────────────────────────────────────────────────────
  { type: 'wall', x: 0, y: 0, w: FLOOR_W, h: FLOOR_H, solid: true },

  // ── Main entrance and front desk ──────────────────────────────────────────────
  { type: 'entry', x: 280, y: 840, w: 200, h: 60, label: 'Grand Entrance', solid: false },
  { type: 'entry', x: 1540, y: 360, w: 60, h: 200, label: 'Research Wing', solid: false },

  { type: 'counter', x: 60,  y: 700, w: 180, h: 55, label: 'Circulation Desk', interact: true, solid: true },
  { type: 'counter', x: 60,  y: 620, w: 180, h: 55, label: 'Check Out', interact: true, solid: true },
  { type: 'counter', x: 60,  y: 540, w: 180, h: 55, label: 'Study Help', interact: true, solid: true },
  { type: 'employee', x: 100, y: 760, label: 'Librarian' },
  { type: 'employee', x: 100, y: 680, label: 'Reference Desk' },
  { type: 'sign',    x: 60,  y: 480, w: 180, h: 40, label: '→ Welcome' },

  // ── Reading tables and learning nooks ────────────────────────────────────────
  { type: 'book_table', x: 180, y: 450, w: 160, h: 90, label: 'Study Tables', interact: true },
  { type: 'book_table', x: 1180, y: 450, w: 180, h: 90, label: 'Group Work', interact: true },
  { type: 'book_table', x: 180, y: 300, w: 160, h: 90, label: 'Quiet Carrels', interact: true },
  { type: 'book_table', x: 1180, y: 300, w: 180, h: 90, label: 'Reference Tables', interact: true },

  // ── Stacks / shelves instead of retail aisles ────────────────────────────────
  { type: 'shelf', x: 300,  y: 70, w: 55, h: 180, label: 'Fiction',     interact: true, solid: true },
  { type: 'shelf', x: 380,  y: 70, w: 55, h: 180, label: 'Fiction',     interact: true, solid: true },
  { type: 'shelf', x: 500,  y: 70, w: 55, h: 180, label: 'History',     interact: true, solid: true },
  { type: 'shelf', x: 580,  y: 70, w: 55, h: 180, label: 'History',     interact: true, solid: true },
  { type: 'shelf', x: 700,  y: 70, w: 55, h: 180, label: 'Science',     interact: true, solid: true },
  { type: 'shelf', x: 780,  y: 70, w: 55, h: 180, label: 'Science',     interact: true, solid: true },
  { type: 'shelf', x: 900,  y: 70, w: 55, h: 180, label: 'Arts',        interact: true, solid: true },
  { type: 'shelf', x: 980,  y: 70, w: 55, h: 180, label: 'Arts',        interact: true, solid: true },
  { type: 'shelf', x: 1100, y: 70, w: 55, h: 180, label: 'Reference',   interact: true, solid: true },
  { type: 'shelf', x: 1180, y: 70, w: 55, h: 180, label: 'Reference',   interact: true, solid: true },

  { type: 'wall_shelf', x: 140, y: 40, w: 900, h: 55, label: 'Featured Catalog', interact: true, solid: true },
  { type: 'wall_shelf', x: 40, y: 160, w: 55, h: 280, label: 'Periodicals', interact: true, solid: true },

  // ── Children / youth section ──────────────────────────────────────────────────
  { type: 'shelf', x: 270,  y: 560, w: 55, h: 140, label: 'Children\'s', interact: true, solid: true },
  { type: 'shelf', x: 340,  y: 560, w: 55, h: 140, label: 'Children\'s', interact: true, solid: true },
  { type: 'shelf', x: 410,  y: 560, w: 55, h: 140, label: 'Children\'s', interact: true, solid: true },
  { type: 'book_table', x: 260, y: 790, w: 220, h: 80, label: 'Story Corner', interact: true },

  // ── Stair / mezzanine access ─────────────────────────────────────────────────
  { type: 'escalator_up',   x: 780, y: 390, w: 100, h: 200, label: '▲ Up', toFloor: 1, interact: true },
  { type: 'escalator_down', x: 890, y: 390, w: 100, h: 200, label: '▼ Down (from upstairs)', interact: false },

  { type: 'sign', x: 760, y: 370, w: 240, h: 30, label: 'Second Floor ▲' },
];

// ── Floor 2 zone list ──────────────────────────────────────────────────────────

const F2_ZONES = [
  { type: 'wall', x: 0, y: 0, w: FLOOR_W, h: FLOOR_H, solid: true },

  // Windows facing the courtyard
  { type: 'window', x: 300, y: 840, w: 800, h: 60, label: 'Courtyard Views' },

  // ── Stair access ──────────────────────────────────────────────────────────────
  { type: 'escalator_down', x: 780, y: 390, w: 100, h: 200, label: '▼ Down', toFloor: 0, interact: true },
  { type: 'escalator_up',   x: 890, y: 390, w: 100, h: 200, label: '▲ Up (top floor)', interact: false },

  // ── Archives and reference stacks ─────────────────────────────────────────────
  { type: 'sign', x: 1220, y: 340, w: 240, h: 40, label: 'Archives & Special Collections' },
  { type: 'shelf', x: 1120, y: 190, w: 55, h: 120, label: 'Local History', interact: true, solid: true },
  { type: 'shelf', x: 1200, y: 190, w: 55, h: 120, label: 'Maps', interact: true, solid: true },
  { type: 'shelf', x: 1280, y: 190, w: 55, h: 120, label: 'Rare Books', interact: true, solid: true },
  { type: 'shelf', x: 1360, y: 190, w: 55, h: 120, label: 'Manuscripts', interact: true, solid: true },
  { type: 'shelf', x: 1440, y: 190, w: 55, h: 120, label: 'Archives', interact: true, solid: true },

  // ── Reading lounge and study rooms ────────────────────────────────────────────
  { type: 'sign',    x: 300, y: 600, w: 260, h: 40, label: 'Study Lounge' },
  { type: 'book_table', x: 300, y: 640, w: 180, h: 90, label: 'Research Tables', interact: true },
  { type: 'book_table', x: 520, y: 640, w: 180, h: 90, label: 'Study Tables', interact: true },
  { type: 'book_table', x: 740, y: 640, w: 180, h: 90, label: 'Computer Lab', interact: true },

  // ── Shelves floor 2 ────────────────────────────────────────────────────────────
  { type: 'shelf', x: 80,  y: 70, w: 55, h: 220, label: 'Academic',     interact: true, solid: true },
  { type: 'shelf', x: 180, y: 70, w: 55, h: 220, label: 'History',      interact: true, solid: true },
  { type: 'shelf', x: 280, y: 70, w: 55, h: 220, label: 'Science',      interact: true, solid: true },
  { type: 'shelf', x: 380, y: 70, w: 55, h: 220, label: 'Art & Design', interact: true, solid: true },
  { type: 'shelf', x: 480, y: 70, w: 55, h: 220, label: 'Travel',       interact: true, solid: true },
  { type: 'wall_shelf', x: 80, y: 40, w: 520, h: 55, label: 'Reference', interact: true, solid: true },

  // Reading area / lounge chairs near windows
  { type: 'seating',  x: 300, y: 440, w: 400, h: 140, label: 'Reading Lounge' },
  { type: 'couch',    x: 320, y: 460, label: '' },
  { type: 'couch',    x: 500, y: 460, label: '' },

  // ── Restrooms and quiet room ─────────────────────────────────────────────────
  { type: 'sign',    x: 1300, y: 50,  w: 280, h: 40, label: '🚻 Facilities →' },
  { type: 'bathroom', x: 1300, y: 100, w: 130, h: 180, label: "Women\'s 🚺", interact: true },
  { type: 'bathroom', x: 1440, y: 100, w: 130, h: 180, label: "Men\'s 🚹",   interact: true },

  { type: 'railing', x: 680, y: 385, w: 20,  h: 210 },
  { type: 'railing', x: 995, y: 385, w: 20,  h: 210 },
  { type: 'railing', x: 680, y: 385, w: 335, h: 20  },
  { type: 'railing', x: 680, y: 575, w: 335, h: 20  },
];

// ── Exported layout ────────────────────────────────────────────────────────────
export const bookstore = {
  id: 'bookstore',
  name: 'University Library',
  spawnF1: { x: 400,  y: 800 },
  spawnF2: { x: 900,  y: 370 },
  floors: [
    { carpet: C.CARPET_F1, wallColor: C.WALL, zones: F1_ZONES },
    { carpet: C.CARPET_F2, wallColor: C.WALL, zones: F2_ZONES },
  ],
};
