/**
 * AutoLayout: generates a deterministic themed room layout from OSM tags + room ID seed.
 * No user intervention needed — any OSM venue gets a coherent interior automatically.
 */

const FLOOR_W = 1600;
const FLOOR_H = 900;

// Seeded LCG random (deterministic from room ID string)
function makeRng(seed) {
  let s = [...seed].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 1337);
  return () => {
    s = Math.imul(1664525, s) + 1013904223 | 0;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

// ----------- Theme definitions -----------

const THEMES = {
  cafe: {
    carpet: 0x4a2c0a,
    wall: 0x2c1a06,
    name: 'Café',
    zones: (rng) => {
      const zs = [];
      // Back counter
      zs.push({ type: 'counter', x: 60, y: 60, w: 500, h: 60, label: '☕ Counter' });
      // Scatter cafe tables + chairs
      const spots = [[250,300],[450,300],[650,300],[850,300],[250,500],[450,500],[650,500]];
      spots.forEach(([cx, cy]) => {
        zs.push({ type: 'cafe_table', x: cx + rng()*40-20, y: cy + rng()*40-20 });
        [[-40,30],[40,30],[0,-40]].forEach(([dx,dy]) => {
          zs.push({ type: 'couch', x: cx+dx, y: cy+dy });
        });
      });
      // A plant or two
      zs.push({ type: 'sign', x: 300, y: 50, label: 'Welcome' });
      zs.push({ type: 'entry', x: 680, y: 820, w: 120, h: 60, label: '🚪 Enter' });
      return zs;
    },
  },

  restaurant: {
    carpet: 0x3b1a0a,
    wall: 0x2b100a,
    name: 'Restaurant',
    zones: (rng) => {
      const zs = [];
      zs.push({ type: 'counter', x: 60, y: 60, w: 300, h: 60, label: '🍽 Host Stand' });
      zs.push({ type: 'entry', x: 680, y: 820, w: 120, h: 60, label: '🚪 Enter' });
      const rows = 3, cols = 4;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = 200 + c * 320 + rng()*30-15;
          const cy = 220 + r * 200 + rng()*30-15;
          zs.push({ type: 'book_table', x: cx-60, y: cy-30, w: 120, h: 60, label: '' });
        }
      }
      zs.push({ type: 'sign', x: 800, y: 50, label: '🍴 Dine In' });
      return zs;
    },
  },

  bar: {
    carpet: 0x1a0f05,
    wall: 0x110a03,
    name: 'Bar',
    zones: (rng) => {
      const zs = [];
      zs.push({ type: 'counter', x: 60, y: 60, w: 800, h: 70, label: '🍺 Bar' });
      zs.push({ type: 'entry', x: 680, y: 820, w: 120, h: 60, label: '🚪 Enter' });
      const stools = 6;
      for (let i = 0; i < stools; i++) {
        zs.push({ type: 'couch', x: 100 + i * 120, y: 160 });
      }
      [[300,400],[600,400],[900,400],[300,600],[600,600]].forEach(([cx,cy]) => {
        zs.push({ type: 'cafe_table', x: cx + rng()*20-10, y: cy + rng()*20-10 });
      });
      zs.push({ type: 'sign', x: 800, y: 50, label: '🎵 Live Music' });
      return zs;
    },
  },

  shop: {
    carpet: 0x2a3040,
    wall: 0x1a2030,
    name: 'Shop',
    zones: (rng) => {
      const zs = [];
      zs.push({ type: 'counter', x: 60, y: 60, w: 300, h: 60, label: '🛒 Register' });
      zs.push({ type: 'entry', x: 680, y: 820, w: 120, h: 60, label: '🚪 Enter' });
      // Shelf rows
      for (let row = 0; row < 4; row++) {
        const y = 180 + row * 160;
        zs.push({ type: 'shelf', x: 200, y, w: 800, h: 60, label: '' });
      }
      zs.push({ type: 'sign', x: 800, y: 50, label: '🛍 Browse' });
      return zs;
    },
  },

  gym: {
    carpet: 0x1a1a2a,
    wall: 0x111118,
    name: 'Gym',
    zones: (rng) => {
      const zs = [];
      zs.push({ type: 'counter', x: 60, y: 60, w: 240, h: 60, label: '💪 Reception' });
      zs.push({ type: 'entry', x: 680, y: 820, w: 120, h: 60, label: '🚪 Enter' });
      for (let i = 0; i < 5; i++) {
        zs.push({ type: 'book_table', x: 200 + i*240, y: 280, w: 60, h: 160, label: '' });
      }
      zs.push({ type: 'sign', x: 800, y: 50, label: '🏋 Training Area' });
      return zs;
    },
  },

  pharmacy: {
    carpet: 0xeaf4fc,
    wall: 0xb0d4e8,
    name: 'Pharmacy',
    zones: (rng) => {
      const zs = [];
      zs.push({ type: 'counter', x: 60, y: 60, w: 400, h: 60, label: '💊 Pharmacy Counter' });
      zs.push({ type: 'entry', x: 680, y: 820, w: 120, h: 60, label: '🚪 Enter' });
      for (let row = 0; row < 3; row++) {
        zs.push({ type: 'shelf', x: 200, y: 200 + row * 180, w: 900, h: 60, label: '' });
      }
      zs.push({ type: 'sign', x: 800, y: 50, label: '🏥 Health & Wellness' });
      return zs;
    },
  },

  default: {
    carpet: 0x2a3040,
    wall: 0x1a2030,
    name: 'Place',
    zones: (rng) => {
      const zs = [];
      zs.push({ type: 'entry', x: 680, y: 820, w: 120, h: 60, label: '🚪 Enter' });
      // A few ambient items scattered around
      [[300,300],[700,300],[500,500],[900,400]].forEach(([cx,cy]) => {
        const t = rng() > 0.5 ? 'couch' : 'cafe_table';
        zs.push({ type: t, x: cx + rng()*60-30, y: cy + rng()*60-30 });
      });
      return zs;
    },
  },
};

// Map OSM tags → theme key
function pickTheme(amenityTag = '', shopTag = '', name = '') {
  const a = amenityTag.toLowerCase();
  const s = shopTag.toLowerCase();
  const n = name.toLowerCase();

  if (a === 'cafe' || a === 'coffee_shop' || n.includes('coffee') || n.includes('starbucks') || n.includes('dunkin')) return 'cafe';
  if (a === 'restaurant' || a === 'fast_food' || a === 'food_court') return 'restaurant';
  if (a === 'bar' || a === 'pub' || a === 'nightclub') return 'bar';
  if (a === 'pharmacy' || s === 'pharmacy' || s === 'chemist') return 'pharmacy';
  if (a === 'fitness_centre' || a === 'gym' || n.includes('gym') || n.includes('fitness')) return 'gym';
  if (s || a === 'shop' || a === 'supermarket' || a === 'convenience') return 'shop';

  return 'default';
}

export function buildAutoLayout(roomId, roomName, amenityTag, shopTag = '') {
  const rng = makeRng(roomId || roomName || 'default');
  const themeKey = pickTheme(amenityTag, shopTag, roomName);
  const theme = THEMES[themeKey];

  const zones = [
    { type: 'wall', x: 0, y: 0, w: FLOOR_W, h: FLOOR_H },
    ...theme.zones(rng),
  ];

  return {
    id: `auto-${themeKey}`,
    name: roomName || theme.name,
    spawnF1: { x: FLOOR_W / 2, y: 750 },
    floors: [{ carpet: theme.carpet, zones }],
  };
}
