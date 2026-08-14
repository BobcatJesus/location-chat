/**
 * AutoLayout: generates a deterministic themed room layout from OSM tags + room ID seed.
 * No user intervention needed — any OSM venue gets a coherent interior automatically.
 */

const FLOOR_W = 1600;
const FLOOR_H = 900;
const SOFT_BUTTER = 0xfef3c7;

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
    carpet: SOFT_BUTTER,
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
    carpet: SOFT_BUTTER,
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
    carpet: SOFT_BUTTER,
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

  park: {
    carpet: 0x9ed9a4,
    wall: 0x0f4d24,
    width: 3600,
    height: 2400,
    spawn: { x: 1800, y: 2180 },
    name: 'Park',
    zones: (rng) => {
      const zs = [];
      zs.push({ type: 'entry', x: 1800, y: 2340, w: 280, h: 80, label: '🌳 Park Entry', solid: false });
      zs.push({ type: 'sign', x: 1800, y: 100, w: 340, h: 42, label: '🌿 Green Space' });

      const treeSpots = [
        [260,180],[520,260],[820,160],[1120,240],[1420,180],[1700,260],[1960,160],[2260,220],[2520,180],[2800,260],[3120,180],[3400,240],
        [300,1320],[620,1260],[920,1300],[1260,1240],[1580,1280],[1900,1340],[2240,1280],[2580,1360],[2920,1300],[3260,1380],
        [260,1940],[620,1860],[980,1900],[1360,1840],[1740,1880],[2120,1940],[2500,1880],[2880,1960],[3260,1900],
      ];
      treeSpots.forEach(([x, y]) => zs.push({ type: 'tree', x: x + rng() * 24 - 12, y: y + rng() * 18 - 9, w: 54, h: 96, solid: true }));

      const shrubSpots = [
        [180,420],[320,500],[520,420],[760,460],[1020,420],[1280,500],[1540,420],[1800,460],[2060,420],[2320,500],[2580,420],[2840,460],[3100,420],[3360,500],
        [220,960],[520,920],[820,980],[1120,940],[1420,1000],[1720,920],[2020,980],[2320,940],[2620,1000],[2920,920],[3220,980],
        [200,1500],[560,1560],[900,1500],[1260,1560],[1620,1500],[1980,1560],[2340,1500],[2700,1560],[3060,1500],[3420,1560],
      ];
      shrubSpots.forEach(([x, y]) => zs.push({ type: 'shrub', x: x + rng() * 18 - 9, y: y + rng() * 14 - 7, w: 64, h: 42, solid: false }));

      [[520,620],[980,540],[1480,580],[1980,520],[2480,620],[2980,560],[620,1220],[1220,1180],[1820,1240],[2420,1180],[3020,1220],[980,1780],[1820,1760],[2720,1820]].forEach(([x, y]) => {
        zs.push({ type: 'bench', x: x + rng() * 14 - 7, y: y + rng() * 10 - 5, w: 90, h: 40, solid: true });
      });

      [[300,280],[700,220],[1100,260],[1500,300],[1900,260],[2300,300],[2700,220],[3100,280],[360,1100],[840,1140],[1320,1100],[1800,1160],[2280,1100],[2760,1140],[3240,1100]].forEach(([x, y]) => {
        zs.push({ type: 'lamppost', x: x + rng() * 12 - 6, y: y + rng() * 12 - 6, w: 30, h: 110, solid: true });
      });

      [[720,720],[1120,720],[1520,700],[1920,740],[2320,700],[2720,720],[3120,700],[720,1700],[1120,1700],[1520,1680],[1920,1720],[2320,1680],[2720,1700],[3120,1680]].forEach(([x, y]) => {
        zs.push({ type: 'flowerbed', x: x + rng() * 20 - 10, y: y + rng() * 12 - 6, w: 88, h: 44, solid: false });
      });

      return zs;
    },
  },

  shop: {
    carpet: SOFT_BUTTER,
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
    carpet: SOFT_BUTTER,
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
    carpet: SOFT_BUTTER,
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
    carpet: SOFT_BUTTER,
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
  if (a === 'park' || a === 'garden' || a === 'nature_reserve' || n.includes('park') || n.includes('garden') || n.includes('nature reserve') || n.includes('greenway') || n.includes('trail')) return 'park';
  if (s || a === 'shop' || a === 'supermarket' || a === 'convenience') return 'shop';

  return 'default';
}

function normalizeFootprint(roomShape) {
  if (!Array.isArray(roomShape) || roomShape.length < 3) return null;
  const pts = roomShape
    .map((p) => ({ lat: Number(p?.lat), lon: Number(p?.lon ?? p?.lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length < 3) return null;

  const minLon = Math.min(...pts.map((p) => p.lon));
  const maxLon = Math.max(...pts.map((p) => p.lon));
  const minLat = Math.min(...pts.map((p) => p.lat));
  const maxLat = Math.max(...pts.map((p) => p.lat));
  const spanLon = maxLon - minLon;
  const spanLat = maxLat - minLat;
  if (spanLon <= 0 || spanLat <= 0) return null;

  const pad = 70;
  const drawW = FLOOR_W - pad * 2;
  const drawH = FLOOR_H - pad * 2;
  const scale = Math.min(drawW / spanLon, drawH / spanLat);
  const ox = (FLOOR_W - spanLon * scale) / 2;
  const oy = (FLOOR_H - spanLat * scale) / 2;

  return pts.map((p) => ({
    x: ox + (p.lon - minLon) * scale,
    y: oy + (maxLat - p.lat) * scale,
  }));
}

export function buildAutoLayout(roomId, roomName, amenityTag, shopTag = '', roomShape = null) {
  const rng = makeRng(roomId || roomName || 'default');
  const themeKey = pickTheme(amenityTag, shopTag, roomName);
  const theme = THEMES[themeKey];
  const footprint = normalizeFootprint(roomShape);

  const wallZone = footprint
    ? { type: 'wall_polygon', points: footprint }
    : { type: 'wall', x: 0, y: 0, w: theme.width || FLOOR_W, h: theme.height || FLOOR_H };

  const zones = [wallZone, ...theme.zones(rng)];

  return {
    id: `auto-${themeKey}${footprint ? '-poly' : ''}`,
    name: roomName || theme.name,
    spawnF1: theme.spawn || { x: (theme.width || FLOOR_W) / 2, y: (theme.height || FLOOR_H) - 180 },
    floors: [{ carpet: theme.carpet, zones }],
  };
}
