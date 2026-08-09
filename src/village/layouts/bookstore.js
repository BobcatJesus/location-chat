// All coordinates are in a 1600×900 world per floor.
// Floor 1 = ground, floor 2 = upstairs. Escalators link them.
// "solid" zones block movement (future collision pass).

export const FLOOR_W = 1600;
export const FLOOR_H = 900;

// ── Colour palette ─────────────────────────────────────────────────────────────
export const C = {
  CARPET_F1:  0xc4a882, // warm beige carpet, floor 1
  CARPET_F2:  0xb89060, // slightly darker carpet, floor 2
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

  // ── Two entrances ────────────────────────────────────────────────────────────
  { type: 'entry', x: 280, y: 840, w: 200, h: 60,  label: 'West Gray Entrance', solid: false },
  { type: 'entry', x: 1540, y: 360, w: 60, h: 200, label: 'Parking Garage Entrance', solid: false },

  // ── Checkout (left of West Gray entrance) ────────────────────────────────────
  { type: 'counter', x: 60,  y: 700, w: 180, h: 55, label: 'Register 1', interact: true, solid: true },
  { type: 'counter', x: 60,  y: 620, w: 180, h: 55, label: 'Register 2', interact: true, solid: true },
  { type: 'counter', x: 60,  y: 540, w: 180, h: 55, label: 'Register 3', interact: true, solid: true },
  { type: 'employee', x: 100, y: 760, label: 'Cashier' },
  { type: 'employee', x: 100, y: 680, label: 'Cashier' },
  { type: 'sign',    x: 60,  y: 480, w: 180, h: 40, label: '→ Checkout' },

  // ── Magazines (right of West Gray entrance) ───────────────────────────────────
  { type: 'magazine_rack', x: 550, y: 720, w: 80,  h: 160, label: 'Magazines', interact: true, solid: true },
  { type: 'magazine_rack', x: 640, y: 720, w: 80,  h: 160, label: 'Comics',    interact: true, solid: true },
  { type: 'magazine_rack', x: 730, y: 720, w: 80,  h: 160, label: 'Newspapers',interact: true, solid: true },

  // ── Starbucks Café (far right) ────────────────────────────────────────────────
  { type: 'cafe_zone', x: 1060, y: 560, w: 480, h: 320, label: 'Starbucks' },
  { type: 'cafe_counter', x: 1060, y: 560, w: 480, h: 60, label: 'Order Here', interact: true, solid: true },
  { type: 'cafe_table',  x: 1090, y: 650, label: '' },
  { type: 'cafe_table',  x: 1210, y: 650, label: '' },
  { type: 'cafe_table',  x: 1330, y: 650, label: '' },
  { type: 'cafe_table',  x: 1450, y: 650, label: '' },
  { type: 'cafe_table',  x: 1090, y: 770, label: '' },
  { type: 'cafe_table',  x: 1210, y: 770, label: '' },
  { type: 'cafe_table',  x: 1330, y: 770, label: '' },
  { type: 'cafe_table',  x: 1450, y: 770, label: '' },
  { type: 'employee', x: 1160, y: 580, label: 'Barista' },

  // ── Featured / New Arrivals tables (scattered) ───────────────────────────────
  { type: 'book_table', x: 280, y: 440, w: 200, h: 100, label: 'Staff Picks',    interact: true },
  { type: 'book_table', x: 520, y: 440, w: 200, h: 100, label: 'New Releases',   interact: true },
  { type: 'book_table', x: 280, y: 300, w: 200, h: 100, label: "Kids' Tables",   interact: true },
  { type: 'book_table', x: 520, y: 300, w: 200, h: 100, label: 'Bestsellers',    interact: true },

  // ── Book shelf rows (running top-to-bottom, portrait orientation) ────────────
  { type: 'shelf', x: 280,  y: 60,  w: 55, h: 220, label: 'Fiction',     interact: true, solid: true },
  { type: 'shelf', x: 345,  y: 60,  w: 55, h: 220, label: 'Fiction',     interact: true, solid: true },
  { type: 'shelf', x: 280,  y: 160, w: 55, h: 110, label: 'Fiction',     interact: true, solid: true },

  { type: 'shelf', x: 430,  y: 60,  w: 55, h: 220, label: 'Mystery',     interact: true, solid: true },
  { type: 'shelf', x: 495,  y: 60,  w: 55, h: 220, label: 'Mystery',     interact: true, solid: true },

  { type: 'shelf', x: 580,  y: 60,  w: 55, h: 200, label: 'Sci-Fi',      interact: true, solid: true },
  { type: 'shelf', x: 645,  y: 60,  w: 55, h: 200, label: 'Sci-Fi',      interact: true, solid: true },

  { type: 'shelf', x: 730,  y: 60,  w: 55, h: 200, label: 'Romance',     interact: true, solid: true },
  { type: 'shelf', x: 795,  y: 60,  w: 55, h: 200, label: 'Romance',     interact: true, solid: true },

  { type: 'shelf', x: 880,  y: 60,  w: 55, h: 220, label: 'Non-Fiction', interact: true, solid: true },
  { type: 'shelf', x: 945,  y: 60,  w: 55, h: 220, label: 'Non-Fiction', interact: true, solid: true },

  { type: 'shelf', x: 1030, y: 60,  w: 55, h: 220, label: 'Biography',   interact: true, solid: true },
  { type: 'shelf', x: 1095, y: 60,  w: 55, h: 220, label: 'Biography',   interact: true, solid: true },

  // Wall shelves along the back wall
  { type: 'wall_shelf', x: 60,  y: 40, w: 1000, h: 55, label: 'Wall Shelves', interact: true, solid: true },

  // Left wall shelves (vertical along west wall)
  { type: 'wall_shelf', x: 40, y: 60, w: 55, h: 440, label: 'Self-Help',  interact: true, solid: true },

  // ── Children's section (back-left area) ──────────────────────────────────────
  { type: 'shelf', x: 60,   y: 560, w: 55, h: 160, label: "Children's",  interact: true, solid: true },
  { type: 'shelf', x: 130,  y: 560, w: 55, h: 160, label: "Children's",  interact: true, solid: true },
  { type: 'shelf', x: 200,  y: 560, w: 55, h: 160, label: "Children's",  interact: true, solid: true },
  { type: 'book_table', x: 60, y: 740, w: 180, h: 80, label: 'Picture Books', interact: true },

  // ── Escalators (centre of store) ──────────────────────────────────────────────
  { type: 'escalator_up',   x: 780, y: 390, w: 100, h: 200, label: '▲ Up', toFloor: 1, interact: true },
  { type: 'escalator_down', x: 890, y: 390, w: 100, h: 200, label: '▼ Down (from upstairs)', interact: false },

  // Decorative sign above escalators
  { type: 'sign', x: 760, y: 370, w: 240, h: 30, label: 'Second Floor ▲' },
];

// ── Floor 2 zone list ──────────────────────────────────────────────────────────

const F2_ZONES = [
  { type: 'wall', x: 0, y: 0, w: FLOOR_W, h: FLOOR_H, solid: true },

  // Windows facing West Gray (bottom wall)
  { type: 'window', x: 300, y: 840, w: 800, h: 60, label: 'West Gray ↓' },

  // ── Escalators (same x/y as floor 1) ──────────────────────────────────────────
  { type: 'escalator_down', x: 780, y: 390, w: 100, h: 200, label: '▼ Down', toFloor: 0, interact: true },
  { type: 'escalator_up',   x: 890, y: 390, w: 100, h: 200, label: '▲ Up (top floor)', interact: false },

  // ── Toys section (right off the escalator) ───────────────────────────────────
  { type: 'sign',        x: 1000, y: 360, w: 200, h: 40, label: '🧸 Toys & Games' },
  { type: 'toy_display', x: 1000, y: 200, w: 120, h: 120, label: 'Plush Toys',   interact: true },
  { type: 'toy_display', x: 1140, y: 200, w: 120, h: 120, label: 'Action Figures', interact: true },
  { type: 'toy_display', x: 1280, y: 200, w: 120, h: 120, label: 'Board Games',  interact: true },
  { type: 'toy_display', x: 1420, y: 200, w: 120, h: 120, label: 'Puzzles',      interact: true },
  { type: 'toy_display', x: 1000, y: 340, w: 120, h: 120, label: 'LEGO',         interact: true },
  { type: 'toy_display', x: 1140, y: 340, w: 120, h: 120, label: 'Card Games',   interact: true },
  { type: 'toy_display', x: 1280, y: 340, w: 120, h: 120, label: 'Arts & Crafts',interact: true },
  { type: 'toy_display', x: 1420, y: 340, w: 120, h: 120, label: 'Collectibles', interact: true },
  { type: 'toy_display', x: 1000, y: 480, w: 540, h: 80,  label: 'Sale Bin',     interact: true },

  // ── Music CDs & Movies (middle, near West Gray windows) ──────────────────────
  { type: 'sign',    x: 300, y: 600, w: 260, h: 40, label: '🎵 Music & 🎬 Movies' },
  { type: 'cd_rack', x: 300, y: 640, w: 60, h: 180, label: 'Pop / Rock',  interact: true, solid: true },
  { type: 'cd_rack', x: 370, y: 640, w: 60, h: 180, label: 'Hip-Hop',     interact: true, solid: true },
  { type: 'cd_rack', x: 440, y: 640, w: 60, h: 180, label: 'Classical',   interact: true, solid: true },
  { type: 'cd_rack', x: 510, y: 640, w: 60, h: 180, label: 'Country',     interact: true, solid: true },
  { type: 'cd_rack', x: 600, y: 640, w: 60, h: 180, label: 'New Releases',interact: true, solid: true },
  { type: 'cd_rack', x: 670, y: 640, w: 60, h: 180, label: 'Vinyl',       interact: true, solid: true },
  { type: 'cd_rack', x: 760, y: 640, w: 60, h: 180, label: 'DVD / Blu-ray',interact: true, solid: true },
  { type: 'cd_rack', x: 830, y: 640, w: 60, h: 180, label: 'TV Series',   interact: true, solid: true },

  // ── Book shelves floor 2 ──────────────────────────────────────────────────────
  { type: 'shelf', x: 60,  y: 60,  w: 55, h: 260, label: 'Academic',    interact: true, solid: true },
  { type: 'shelf', x: 130, y: 60,  w: 55, h: 260, label: 'History',     interact: true, solid: true },
  { type: 'shelf', x: 200, y: 60,  w: 55, h: 260, label: 'Science',     interact: true, solid: true },
  { type: 'shelf', x: 270, y: 60,  w: 55, h: 260, label: 'Art & Design',interact: true, solid: true },
  { type: 'shelf', x: 340, y: 60,  w: 55, h: 260, label: 'Philosophy',  interact: true, solid: true },
  { type: 'shelf', x: 410, y: 60,  w: 55, h: 260, label: 'True Crime',  interact: true, solid: true },
  { type: 'shelf', x: 480, y: 60,  w: 55, h: 260, label: 'Travel',      interact: true, solid: true },
  { type: 'shelf', x: 550, y: 60,  w: 55, h: 260, label: 'Cooking',     interact: true, solid: true },

  // Back wall shelves floor 2
  { type: 'wall_shelf', x: 60, y: 40, w: 680, h: 55, label: 'Reference', interact: true, solid: true },

  // Reading area / lounge chairs near windows
  { type: 'seating',  x: 300, y: 440, w: 400, h: 140, label: 'Reading Lounge' },
  { type: 'couch',    x: 320, y: 460, label: '' },
  { type: 'couch',    x: 500, y: 460, label: '' },

  // ── Bathrooms (back right) ────────────────────────────────────────────────────
  { type: 'sign',    x: 1300, y: 50,  w: 280, h: 40, label: '🚻 Restrooms →' },
  { type: 'bathroom', x: 1300, y: 100, w: 130, h: 180, label: "Women's 🚺", interact: true },
  { type: 'bathroom', x: 1440, y: 100, w: 130, h: 180, label: "Men's 🚹",   interact: true },

  // Railing along the escalator opening / floor edge
  { type: 'railing', x: 680, y: 385, w: 20,  h: 210 },
  { type: 'railing', x: 995, y: 385, w: 20,  h: 210 },
  { type: 'railing', x: 680, y: 385, w: 335, h: 20  },
  { type: 'railing', x: 680, y: 575, w: 335, h: 20  },
];

// ── Exported layout ────────────────────────────────────────────────────────────
export const bookstore = {
  id: 'bookstore',
  name: 'Barnes & Noble',
  spawnF1: { x: 400,  y: 800 }, // near West Gray entrance
  spawnF2: { x: 900,  y: 370 }, // off escalator on floor 2
  floors: [
    { carpet: C.CARPET_F1, wallColor: C.WALL, zones: F1_ZONES },
    { carpet: C.CARPET_F2, wallColor: C.WALL, zones: F2_ZONES },
  ],
};
