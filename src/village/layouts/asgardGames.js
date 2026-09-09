const FLOOR_W = 2200;
const FLOOR_H = 1400;

const ZONES = [
  { type: 'wall', x: 0, y: 0, w: FLOOR_W, h: FLOOR_H, solid: true },
  { type: 'window', x: 500, y: 1340, w: 1200, h: 60, label: '3302 South Shepherd Drive • Houston, TX' },
  { type: 'entry', x: 850, y: 1260, w: 500, h: 80, label: 'Asgard Games Entrance', solid: false },
  { type: 'sign', x: 620, y: 48, w: 960, h: 64, label: 'ASGARD GAMES' },
  { type: 'sign', x: 720, y: 135, w: 760, h: 36, label: 'Board Games • RPGs • Miniatures • Community Play' },

  { type: 'counter', x: 70, y: 90, w: 360, h: 70, label: 'Register & Quest Help', interact: true, solid: true },
  { type: 'counter', x: 70, y: 190, w: 360, h: 70, label: 'Event Check-In', interact: true, solid: true },
  { type: 'employee', x: 240, y: 360, label: 'Game Guide', patrol: [[240, 360], [620, 360], [620, 900], [240, 900]] },

  { type: 'wall_shelf', x: 70, y: 380, w: 360, h: 76, label: 'New Releases', interact: true, solid: true },
  { type: 'wall_shelf', x: 70, y: 490, w: 360, h: 76, label: 'Board Games', interact: true, solid: true },
  { type: 'wall_shelf', x: 70, y: 600, w: 360, h: 76, label: 'Card Games', interact: true, solid: true },
  { type: 'wall_shelf', x: 70, y: 710, w: 360, h: 76, label: 'Miniatures', interact: true, solid: true },
  { type: 'wall_shelf', x: 70, y: 820, w: 360, h: 76, label: 'Paints & Terrain', interact: true, solid: true },

  { type: 'shelf', x: 520, y: 220, w: 300, h: 64, label: 'Strategy Games', interact: true, solid: true },
  { type: 'shelf', x: 900, y: 220, w: 300, h: 64, label: 'Family Games', interact: true, solid: true },
  { type: 'shelf', x: 1280, y: 220, w: 300, h: 64, label: 'Trading Cards', interact: true, solid: true },
  { type: 'shelf', x: 1660, y: 220, w: 300, h: 64, label: 'RPG Books', interact: true, solid: true },
  { type: 'book_table', x: 520, y: 340, w: 300, h: 140, label: 'Demo Table 1', interact: true },
  { type: 'book_table', x: 900, y: 340, w: 300, h: 140, label: 'Demo Table 2', interact: true },
  { type: 'book_table', x: 1280, y: 340, w: 300, h: 140, label: 'Demo Table 3', interact: true },
  { type: 'book_table', x: 1660, y: 340, w: 300, h: 140, label: 'Demo Table 4', interact: true },

  { type: 'seating', x: 520, y: 570, w: 680, h: 190, label: 'Open Play Lounge', interact: true },
  { type: 'couch', x: 580, y: 635, label: 'Open Play' },
  { type: 'couch', x: 790, y: 635, label: '' },
  { type: 'couch', x: 1000, y: 635, label: '' },
  { type: 'employee', x: 1370, y: 650, label: 'Dungeon Master', patrol: [[1370, 650], [1850, 650], [1850, 1050], [1370, 1050]] },

  { type: 'book_table', x: 1370, y: 570, w: 500, h: 190, label: 'RPG Table', interact: true },
  { type: 'sign', x: 1430, y: 790, w: 380, h: 34, label: 'Friday Night Adventures' },
  { type: 'wall_shelf', x: 1680, y: 90, w: 400, h: 76, label: 'RPG Books', interact: true, solid: true },
  { type: 'wall_shelf', x: 1680, y: 190, w: 400, h: 76, label: 'Paints & Supplies', interact: true, solid: true },
  { type: 'sign', x: 520, y: 930, w: 1350, h: 38, label: 'Find your party • Play something new • Stay awhile' },
  { type: 'book_table', x: 520, y: 1020, w: 300, h: 140, label: 'Tournament Table 1', interact: true },
  { type: 'book_table', x: 900, y: 1020, w: 300, h: 140, label: 'Tournament Table 2', interact: true },
  { type: 'book_table', x: 1280, y: 1020, w: 300, h: 140, label: 'Tournament Table 3', interact: true },
  { type: 'book_table', x: 1660, y: 1020, w: 300, h: 140, label: 'Tournament Table 4', interact: true },
];

export const asgardGames = {
  id: 'asgard-games',
  name: 'Asgard Games',
  width: FLOOR_W,
  height: FLOOR_H,
  spawnF1: { x: 1100, y: 1190 },
  floors: [
    { carpet: 0x3b2418, wallColor: 0x17110e, zones: ZONES },
  ],
};