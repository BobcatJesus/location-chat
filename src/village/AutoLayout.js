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
    carpet: 0xb7e4c7,
    wall: 0x14532d,
    width: 2400,
    height: 1600,
    spawn: { x: 1200, y: 1420 },
    name: 'Park',
    zones: (rng) => {
      const zs = [];
      zs.push({ type: 'entry', x: 1200, y: 1540, w: 240, h: 70, label: '🌳 Park Entry', solid: false });
      zs.push({ type: 'sign', x: 1200, y: 90, w: 300, h: 42, label: '🌿 Green Space' });

      const treeSpots = [
        [220,180],[390,250],[600,160],[820,240],[1080,180],[1280,260],[1450,160],[1700,220],[1940,180],[2180,260],
        [300,1120],[560,1060],[820,1100],[1140,1040],[1380,1080],[1680,1140],[1960,1080],[2200,1160],
      ];
      treeSpots.forEach(([x, y]) => zs.push({ type: 'tree', x: x + rng() * 24 - 12, y: y + rng() * 18 - 9, w: 54, h: 96, solid: true }));

      const shrubSpots = [
        [150,350],[260,430],[430,360],[690,360],[940,360],[1160,380],[1440,340],[1680,360],[1920,420],[2140,350],
        [180,760],[470,760],[740,720],[1020,760],[1320,720],[1680,800],[1960,760],[2180,820],
      ];
      shrubSpots.forEach(([x, y]) => zs.push({ type: 'shrub', x: x + rng() * 18 - 9, y: y + rng() * 14 - 7, w: 64, h: 42, solid: false }));

      [[420,520],[760,470],[1120,500],[1450,460],[1780,520],[2060,480],[520,940],[920,920],[1380,960],[1820,940]].forEach(([x, y]) => {
        zs.push({ type: 'bench', x: x + rng() * 14 - 7, y: y + rng() * 10 - 5, w: 90, h: 40, solid: true });
      });

      [[260,300],[520,220],[980,260],[1340,300],[1720,260],[2080,300],[340,980],[820,1040],[1260,980],[1700,1060],[2100,1020]].forEach(([x, y]) => {
        zs.push({ type: 'lamppost', x: x + rng() * 12 - 6, y: y + rng() * 12 - 6, w: 30, h: 110, solid: true });
      });

      [[620,620],[940,620],[1540,620],[1940,640],[620,1240],[1040,1260],[1520,1240],[1960,1280]].forEach(([x, y]) => {
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
