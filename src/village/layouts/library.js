export const FLOOR_W = 1600;
export const FLOOR_H = 900;

export const C = {
  CARPET_F1: 0xf2eee5,
  CARPET_F2: 0xf7f4ec,
  WALL: 0x242b36,
  UH_SCARLET: 0xc8102e,
  UH_GOLD: 0xffc72c,
  SHELF_WOOD: 0x5a4133,
  SHELF_TOP: 0x7a5845,
  TABLE_WOOD: 0x9d7a52,
  COUNTER: 0x8a6f53,
  ESCALATOR: 0xd8d0bf,
  ESCALATOR_STRIPE: 0xb8a88b,
  BATHROOM: 0xdfe6ea,
  WINDOW: 0xb6d7ea,
  ENTRY_MAT: 0xf4ecd8,
  RAILING: 0x8a7358,
  SEATING: 0xd9b28a,
  COUCH: 0xbb8a63,
};

const LIBRARY_BOUNDARY = [
  { x: 245, y: 60 },
  { x: 1395, y: 60 },
  { x: 1538, y: 180 },
  { x: 1555, y: 610 },
  { x: 1472, y: 760 },
  { x: 1280, y: 760 },
  { x: 1280, y: 840 },
  { x: 1198, y: 868 },
  { x: 980, y: 900 },
  { x: 690, y: 894 },
  { x: 450, y: 866 },
  { x: 300, y: 820 },
  { x: 300, y: 760 },
  { x: 175, y: 760 },
  { x: 55, y: 690 },
  { x: 52, y: 175 },
  { x: 170, y: 90 },
];

const F1_ZONES = [
  { type: 'wall', x: 0, y: 0, w: FLOOR_W, h: FLOOR_H, solid: true },
  { type: 'wall_polygon', points: LIBRARY_BOUNDARY, solid: false },
  { type: 'entry', x: 655, y: 830, w: 290, h: 58, label: 'Main Entrance • Welcome Lobby', solid: false },
  { type: 'entry', x: 1518, y: 290, w: 58, h: 220, label: 'North Stacks Wing', solid: false },
  { type: 'sign', x: 470, y: 118, w: 660, h: 48, label: 'MD ANDERSON LIBRARY | UNIVERSITY OF HOUSTON' },
  { type: 'sign', x: 520, y: 760, w: 560, h: 28, label: 'Study Together • Read Together • Learn Together' },

  { type: 'counter', x: 70, y: 660, w: 185, h: 56, label: 'Circulation Desk', interact: true, solid: true },
  { type: 'counter', x: 70, y: 580, w: 185, h: 56, label: 'Check Out', interact: true, solid: true },
  { type: 'counter', x: 70, y: 500, w: 185, h: 56, label: 'Research Help', interact: true, solid: true },
  { type: 'counter', x: 70, y: 420, w: 185, h: 56, label: 'Tech & Printing', interact: true, solid: true },
  { type: 'employee', x: 300, y: 725, label: 'Librarian', patrol: [[300, 725], [560, 700], [830, 700], [1080, 680], [1260, 620]] },
  { type: 'employee', x: 510, y: 725, label: 'Reference Desk', patrol: [[510, 725], [720, 690], [980, 700], [1210, 620], [1080, 350]] },
  { type: 'sign', x: 65, y: 350, w: 180, h: 38, label: '→ Welcome' },

  { type: 'book_table', x: 220, y: 245, w: 170, h: 90, label: 'Quiet Study', interact: true },
  { type: 'book_table', x: 430, y: 245, w: 180, h: 90, label: 'Library Tables', interact: true },
  { type: 'book_table', x: 1180, y: 255, w: 210, h: 90, label: 'Group Study', interact: true },
  { type: 'book_table', x: 1180, y: 440, w: 210, h: 90, label: 'Research Tables', interact: true },
  { type: 'book_table', x: 310, y: 760, w: 180, h: 80, label: 'Story Corner', interact: true },

  { type: 'shelf', x: 300, y: 70, w: 55, h: 170, label: 'Fiction', interact: true, solid: true },
  { type: 'shelf', x: 380, y: 70, w: 55, h: 170, label: 'Fiction', interact: true, solid: true },
  { type: 'shelf', x: 500, y: 70, w: 55, h: 170, label: 'History', interact: true, solid: true },
  { type: 'shelf', x: 580, y: 70, w: 55, h: 170, label: 'History', interact: true, solid: true },
  { type: 'shelf', x: 700, y: 70, w: 55, h: 170, label: 'Science', interact: true, solid: true },
  { type: 'shelf', x: 780, y: 70, w: 55, h: 170, label: 'Science', interact: true, solid: true },
  { type: 'shelf', x: 900, y: 70, w: 55, h: 170, label: 'Arts', interact: true, solid: true },
  { type: 'shelf', x: 980, y: 70, w: 55, h: 170, label: 'Arts', interact: true, solid: true },
  { type: 'shelf', x: 1100, y: 70, w: 55, h: 170, label: 'Reference', interact: true, solid: true },
  { type: 'shelf', x: 1180, y: 70, w: 55, h: 170, label: 'Reference', interact: true, solid: true },

  { type: 'shelf', x: 230, y: 565, w: 55, h: 135, label: 'Juvenile', interact: true, solid: true },
  { type: 'shelf', x: 300, y: 565, w: 55, h: 135, label: 'Juvenile', interact: true, solid: true },
  { type: 'shelf', x: 370, y: 565, w: 55, h: 135, label: 'Juvenile', interact: true, solid: true },
  { type: 'shelf', x: 440, y: 565, w: 55, h: 135, label: 'Education', interact: true, solid: true },

  { type: 'wall_shelf', x: 140, y: 40, w: 900, h: 55, label: 'Featured Catalog', interact: true, solid: true },
  { type: 'wall_shelf', x: 40, y: 170, w: 55, h: 270, label: 'Periodicals', interact: true, solid: true },
  { type: 'wall_shelf', x: 1300, y: 70, w: 200, h: 55, label: 'New Arrivals', interact: true, solid: true },

  { type: 'seating', x: 500, y: 470, w: 280, h: 130, label: 'Reading Lounge', interact: true },
  { type: 'couch', x: 535, y: 500, label: 'Study Lounge' },
  { type: 'couch', x: 650, y: 500, label: '' },
  { type: 'couch', x: 760, y: 500, label: '' },

  { type: 'escalator_up', x: 780, y: 390, w: 100, h: 200, label: '▲ Upper Level', toFloor: 1, interact: true },
  { type: 'escalator_down', x: 890, y: 390, w: 100, h: 200, label: '▼ Lower Level', interact: false },
  { type: 'sign', x: 760, y: 360, w: 240, h: 30, label: 'Study Commons ▲' },
  { type: 'sign', x: 1180, y: 630, w: 270, h: 28, label: 'Event Zone • Group Tables' },
];

const F2_ZONES = [
  { type: 'wall', x: 0, y: 0, w: FLOOR_W, h: FLOOR_H, solid: true },
  { type: 'wall_polygon', points: LIBRARY_BOUNDARY, solid: false },
  { type: 'window', x: 300, y: 840, w: 800, h: 60, label: 'Campus and Courtyard Views' },
  { type: 'sign', x: 560, y: 110, w: 480, h: 48, label: 'MD ANDERSON | RESEARCH FLOOR' },
  { type: 'sign', x: 1180, y: 720, w: 280, h: 30, label: 'Graduate Research Suites' },

  { type: 'escalator_down', x: 780, y: 390, w: 100, h: 200, label: '▼ Down to Lobby', toFloor: 0, interact: true },
  { type: 'escalator_up', x: 890, y: 390, w: 100, h: 200, label: '▲ Upper Level', interact: false },

  { type: 'sign', x: 1210, y: 330, w: 290, h: 38, label: 'Archives & Special Collections' },
  { type: 'employee', x: 1060, y: 350, label: 'Archives Guide', patrol: [[1060, 350], [920, 350], [1040, 650], [1180, 650], [1280, 560]] },
  { type: 'shelf', x: 1120, y: 190, w: 55, h: 120, label: 'Local History', interact: true, solid: true },
  { type: 'shelf', x: 1200, y: 190, w: 55, h: 120, label: 'Maps', interact: true, solid: true },
  { type: 'shelf', x: 1280, y: 190, w: 55, h: 120, label: 'Rare Books', interact: true, solid: true },
  { type: 'shelf', x: 1360, y: 190, w: 55, h: 120, label: 'Manuscripts', interact: true, solid: true },
  { type: 'shelf', x: 1440, y: 190, w: 55, h: 120, label: 'Archives', interact: true, solid: true },

  { type: 'sign', x: 300, y: 590, w: 320, h: 40, label: 'Graduate Study Lounge' },
  { type: 'book_table', x: 260, y: 640, w: 180, h: 90, label: 'Research Tables', interact: true },
  { type: 'book_table', x: 500, y: 640, w: 180, h: 90, label: 'Study Tables', interact: true },
  { type: 'book_table', x: 740, y: 640, w: 180, h: 90, label: 'Computer Lab', interact: true },
  { type: 'employee', x: 960, y: 690, label: 'Research Mentor', patrol: [[960, 690], [820, 690], [620, 700], [840, 650], [1040, 650]] },

  { type: 'shelf', x: 80, y: 70, w: 55, h: 220, label: 'Academic', interact: true, solid: true },
  { type: 'shelf', x: 180, y: 70, w: 55, h: 220, label: 'History', interact: true, solid: true },
  { type: 'shelf', x: 280, y: 70, w: 55, h: 220, label: 'Science', interact: true, solid: true },
  { type: 'shelf', x: 380, y: 70, w: 55, h: 220, label: 'Art & Design', interact: true, solid: true },
  { type: 'shelf', x: 480, y: 70, w: 55, h: 220, label: 'Travel', interact: true, solid: true },
  { type: 'wall_shelf', x: 80, y: 40, w: 520, h: 55, label: 'Reference Stacks', interact: true, solid: true },

  { type: 'seating', x: 300, y: 430, w: 400, h: 145, label: 'Reading Lounge' },
  { type: 'couch', x: 320, y: 455, label: 'Quiet Reading' },
  { type: 'couch', x: 500, y: 455, label: '' },
  { type: 'book_table', x: 620, y: 460, w: 160, h: 86, label: 'Silent Study', interact: true },

  { type: 'sign', x: 1300, y: 52, w: 280, h: 40, label: '🚻 Facilities →' },
  { type: 'bathroom', x: 1300, y: 100, w: 130, h: 180, label: "Women's 🚺", interact: true },
  { type: 'bathroom', x: 1440, y: 100, w: 130, h: 180, label: "Men's 🚹", interact: true },

  { type: 'sign', x: 740, y: 240, w: 240, h: 32, label: 'North Stair • East Stair' },
  { type: 'railing', x: 680, y: 385, w: 20, h: 210 },
  { type: 'railing', x: 995, y: 385, w: 20, h: 210 },
  { type: 'railing', x: 680, y: 385, w: 335, h: 20 },
  { type: 'railing', x: 680, y: 575, w: 335, h: 20 },

  { type: 'sign', x: 1010, y: 610, w: 260, h: 26, label: 'Event Check-In Board' },
];

export const library = {
  id: 'md-anderson-library',
  name: 'MD Anderson Library',
  spawnF1: { x: 800, y: 790 },
  spawnF2: { x: 900, y: 370 },
  floors: [
    { carpet: C.CARPET_F1, wallColor: C.WALL, zones: F1_ZONES },
    { carpet: C.CARPET_F2, wallColor: C.WALL, zones: F2_ZONES },
  ],
};
