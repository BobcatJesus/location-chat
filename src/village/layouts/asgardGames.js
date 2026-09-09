const FLOOR_W = 1600;
const FLOOR_H = 900;

const ZONES = [
  { type: 'wall', x: 0, y: 0, w: FLOOR_W, h: FLOOR_H, solid: true },
  { type: 'window', x: 330, y: 840, w: 940, h: 60, label: '3302 South Shepherd Drive • Houston, TX' },
  { type: 'entry', x: 650, y: 820, w: 300, h: 60, label: 'Asgard Games Entrance', solid: false },
  { type: 'sign', x: 420, y: 48, w: 760, h: 58, label: 'ASGARD GAMES' },
  { type: 'sign', x: 505, y: 125, w: 590, h: 32, label: 'Board Games • RPGs • Miniatures • Community Play' },

  { type: 'counter', x: 70, y: 90, w: 310, h: 64, label: 'Register & Quest Help', interact: true, solid: true },
  { type: 'counter', x: 70, y: 180, w: 310, h: 64, label: 'Event Check-In', interact: true, solid: true },
  { type: 'employee', x: 220, y: 300, label: 'Game Guide', patrol: [[220, 300], [450, 300], [450, 600], [220, 600]] },

  { type: 'wall_shelf', x: 70, y: 350, w: 260, h: 70, label: 'New Releases', interact: true, solid: true },
  { type: 'wall_shelf', x: 70, y: 450, w: 260, h: 70, label: 'Board Games', interact: true, solid: true },
  { type: 'wall_shelf', x: 70, y: 550, w: 260, h: 70, label: 'Card Games', interact: true, solid: true },
  { type: 'wall_shelf', x: 70, y: 650, w: 260, h: 70, label: 'Miniatures', interact: true, solid: true },

  { type: 'shelf', x: 420, y: 220, w: 230, h: 58, label: 'Strategy Games', interact: true, solid: true },
  { type: 'shelf', x: 720, y: 220, w: 230, h: 58, label: 'Family Games', interact: true, solid: true },
  { type: 'shelf', x: 1020, y: 220, w: 230, h: 58, label: 'Trading Cards', interact: true, solid: true },
  { type: 'book_table', x: 420, y: 320, w: 250, h: 120, label: 'Demo Table 1', interact: true },
  { type: 'book_table', x: 760, y: 320, w: 250, h: 120, label: 'Demo Table 2', interact: true },
  { type: 'book_table', x: 1100, y: 320, w: 250, h: 120, label: 'Demo Table 3', interact: true },

  { type: 'seating', x: 430, y: 500, w: 510, h: 150, label: 'Open Play Lounge', interact: true },
  { type: 'couch', x: 470, y: 545, label: 'Open Play' },
  { type: 'couch', x: 650, y: 545, label: '' },
  { type: 'couch', x: 830, y: 545, label: '' },
  { type: 'employee', x: 1040, y: 560, label: 'Dungeon Master', patrol: [[1040, 560], [1280, 560], [1280, 720], [1040, 720]] },

  { type: 'book_table', x: 1030, y: 500, w: 390, h: 150, label: 'RPG Table', interact: true },
  { type: 'sign', x: 1040, y: 690, w: 360, h: 34, label: 'Friday Night Adventures' },
  { type: 'wall_shelf', x: 1210, y: 90, w: 300, h: 70, label: 'RPG Books', interact: true, solid: true },
  { type: 'wall_shelf', x: 1210, y: 180, w: 300, h: 70, label: 'Paints & Supplies', interact: true, solid: true },
  { type: 'sign', x: 430, y: 760, w: 900, h: 32, label: 'Find your party • Play something new • Stay awhile' },
];

export const asgardGames = {
  id: 'asgard-games',
  name: 'Asgard Games',
  spawnF1: { x: 800, y: 780 },
  floors: [
    { carpet: 0x3b2418, wallColor: 0x17110e, zones: ZONES },
  ],
};