/**
 * AutoLayout: generates a deterministic themed room layout from OSM tags + room ID seed.
 * No user intervention needed — any OSM venue gets a coherent interior automatically.
 */

import { parseIndoorLayout } from './indoorLayoutParser.js';

const FLOOR_W = 1600;
const FLOOR_H = 900;
const SOFT_BUTTER = 0xfef3c7;
const PARK_GRASS = 0x8bd77a;

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
      zs.push({ type: 'employee', x: 1040, y: 560, label: 'Cafe Regular', patrol: [[1040, 560], [1200, 520], [1080, 700]] });
      return zs;
    },
  },

  mcdonalds: {
    carpet: 0xfef3c7,
    wall: 0xd62828,
    name: "McDonald's",
    zones: (rng) => {
      return [];
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
      zs.push({ type: 'employee', x: 1320, y: 700, label: 'Dinner Guest', patrol: [[1320, 700], [1200, 620], [1080, 720]] });
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
      zs.push({ type: 'employee', x: 1120, y: 620, label: 'Music Fan', patrol: [[1120, 620], [980, 580], [1180, 420]] });
      return zs;
    },
  },

  library: {
    carpet: 0xf3eee4,
    wall: 0x202836,
    name: 'Library',
    zones: (rng) => {
      const zs = [];
      zs.push({ type: 'entry', x: 700, y: 820, w: 200, h: 60, label: 'Front Entrance' });
      zs.push({ type: 'sign', x: 500, y: 50, w: 600, h: 44, label: 'University Library' });
      zs.push({ type: 'counter', x: 70, y: 120, w: 260, h: 64, label: 'Circulation Desk' });
      zs.push({ type: 'counter', x: 70, y: 210, w: 260, h: 64, label: 'Research Help' });
      for (let i = 0; i < 6; i++) {
        const x = 140 + i * 200;
        zs.push({ type: 'shelf', x, y: 340, w: 100, h: 190, label: 'Stacks' });
      }
      for (let i = 0; i < 5; i++) {
        const x = 220 + i * 220;
        zs.push({ type: 'book_table', x, y: 620, w: 160, h: 90, label: 'Study Tables' });
      }
      zs.push({ type: 'seating', x: 1100, y: 240, w: 220, h: 150, label: 'Reading Lounge' });
      zs.push({ type: 'couch', x: 1150, y: 290 });
      zs.push({ type: 'couch', x: 1280, y: 290 });
      zs.push({ type: 'sign', x: 1100, y: 120, w: 240, h: 36, label: 'Quiet Floor' });
      zs.push({ type: 'sign', x: 520, y: 770, w: 520, h: 32, label: 'Study together • read together • learn together' });
      zs.push({ type: 'employee', x: 1060, y: 540, label: 'Library Regular', patrol: [[1060, 540], [1200, 470], [1060, 680]] });
      return zs;
    },
  },

  theater: {
    carpet: 0x121826,
    wall: 0x090d16,
    name: 'Theater',
    zones: (rng) => {
      const zs = [];
      zs.push({ type: 'entry', x: 700, y: 820, w: 180, h: 56, label: '🎟 Lobby Entrance' });

      // Main screen at the top of the room
      zs.push({ type: 'screen', x: 220, y: 58, w: 1160, h: 110, label: 'NOW SHOWING' });

      // Concessions stand with popcorn callout on the left
      zs.push({ type: 'counter', x: 70, y: 170, w: 360, h: 64, label: '🍿 Concessions' });
      zs.push({ type: 'sign', x: 250, y: 250, w: 300, h: 36, label: '🍿 Popcorn • Soda • Candy' });

      // Seating rows (staggered) facing the screen
      const rowY = [300, 380, 460, 540, 620, 700];
      rowY.forEach((y, row) => {
        const seatCount = 7;
        const startX = row % 2 === 0 ? 280 : 340;
        for (let i = 0; i < seatCount; i++) {
          const x = startX + i * 160 + (rng() * 10 - 5);
          zs.push({ type: 'seating', x: x - 48, y: y - 20, w: 96, h: 40, label: '' });
        }
      });

      // Aisle accents
      zs.push({ type: 'sign', x: 800, y: 770, w: 260, h: 32, label: '🎬 River Oaks Theater' });
      zs.push({ type: 'employee', x: 1260, y: 760, label: 'Moviegoer', patrol: [[1260, 760], [1100, 740], [1340, 680]] });
      return zs;
    },
  },

  park: {
    carpet: PARK_GRASS,
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
        [260,180],[420,230],[620,260],[820,160],[980,210],[1120,240],[1320,200],[1420,180],[1600,230],[1700,260],[1960,160],[2140,220],[2260,220],[2460,180],[2520,180],[2700,240],[2800,260],[2980,210],[3120,180],[3280,220],[3400,240],
        [200,1120],[420,1080],[620,1260],[820,1180],[920,1300],[1180,1220],[1260,1240],[1460,1180],[1580,1280],[1760,1200],[1900,1340],[2140,1260],[2240,1280],[2440,1200],[2580,1360],[2800,1240],[2920,1300],[3120,1180],[3260,1380],
        [260,1940],[420,1880],[620,1860],[780,1920],[980,1900],[1180,1860],[1360,1840],[1540,1900],[1740,1880],[1960,1940],[2120,1940],[2320,1880],[2500,1880],[2680,1940],[2880,1960],[3100,1880],[3260,1900],
      ];
      treeSpots.forEach(([x, y]) => zs.push({ type: 'tree', x: x + rng() * 28 - 14, y: y + rng() * 20 - 10, w: 54, h: 96, solid: true }));

      const shrubSpots = [
        [120,320],[220,420],[320,500],[440,440],[520,420],[660,470],[760,460],[900,420],[1020,420],[1160,500],[1280,500],[1420,440],[1540,420],[1700,460],[1800,460],[1940,420],[2060,420],[2200,500],[2320,500],[2460,430],[2580,420],[2720,470],[2840,460],[2980,430],[3100,420],[3240,500],[3360,500],
        [120,880],[220,960],[420,920],[520,920],[700,980],[820,980],[980,920],[1120,940],[1280,980],[1420,1000],[1580,920],[1720,920],[1880,980],[2020,980],[2200,940],[2320,940],[2480,1000],[2620,1000],[2780,920],[2920,920],[3080,980],[3220,980],[3360,940],
        [120,1460],[200,1500],[380,1560],[560,1560],[760,1500],[900,1500],[1080,1560],[1260,1560],[1440,1500],[1620,1500],[1800,1560],[1980,1560],[2180,1500],[2340,1500],[2520,1560],[2700,1560],[2880,1500],[3060,1500],[3240,1560],[3420,1560],
      ];
      shrubSpots.forEach(([x, y]) => zs.push({ type: 'shrub', x: x + rng() * 18 - 9, y: y + rng() * 14 - 7, w: 64, h: 42, solid: false }));

      [[420,620],[620,560],[820,620],[980,540],[1220,610],[1480,580],[1740,620],[1980,520],[2220,610],[2480,620],[2720,610],[2980,560],[3220,620],[620,1220],[980,1180],[1420,1200],[1820,1240],[2220,1180],[2420,1180],[2820,1220],[3020,1220],[980,1780],[1420,1760],[1820,1760],[2220,1780],[2720,1820],[3120,1760]].forEach(([x, y]) => {
        zs.push({ type: 'bench', x: x + rng() * 14 - 7, y: y + rng() * 10 - 5, w: 90, h: 40, solid: true });
      });

      [[260,280],[470,230],[700,220],[900,260],[1100,260],[1300,220],[1500,300],[1700,230],[1900,260],[2100,220],[2300,300],[2500,220],[2700,220],[2900,260],[3100,280],[3320,240],[360,1100],[620,1080],[840,1140],[1080,1120],[1320,1100],[1560,1140],[1800,1160],[2040,1120],[2280,1100],[2520,1140],[2760,1140],[3000,1100],[3240,1100]].forEach(([x, y]) => {
        zs.push({ type: 'lamppost', x: x + rng() * 12 - 6, y: y + rng() * 12 - 6, w: 30, h: 110, solid: true });
      });

      [[520,720],[720,720],[920,700],[1120,720],[1320,700],[1520,700],[1720,740],[1920,740],[2120,700],[2320,700],[2520,720],[2720,720],[2920,700],[3120,700],[520,1700],[720,1700],[920,1680],[1120,1700],[1320,1680],[1520,1680],[1720,1720],[1920,1720],[2120,1680],[2320,1680],[2520,1700],[2720,1700],[2920,1680],[3120,1680]].forEach(([x, y]) => {
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
      zs.push({ type: 'employee', x: 1160, y: 720, label: 'Shopper', patrol: [[1160, 720], [1240, 620], [1100, 520]] });
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
      zs.push({ type: 'employee', x: 1340, y: 620, label: 'Gym Member', patrol: [[1340, 620], [1220, 540], [1360, 420]] });
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
      zs.push({ type: 'employee', x: 1180, y: 700, label: 'Pharmacy Visitor', patrol: [[1180, 700], [1120, 620], [1240, 540]] });
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
      zs.push({ type: 'employee', x: 1100, y: 650, label: 'Neighbor', patrol: [[1100, 650], [980, 620], [1160, 500]] });
      return zs;
    },
  },
};

// Map OSM tags → theme key
function pickTheme(roomId = '', amenityTag = '', shopTag = '', name = '') {
  const a = String(amenityTag || '').toLowerCase();
  const s = String(shopTag || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  const r = String(roomId || '').toLowerCase().replace(/[_\-]+/g, ' ');
  const combined = `${a} ${s} ${n} ${r}`;
  const outdoorKeywords = [
    'park', 'garden', 'nature', 'forest', 'greenway', 'trail', 'reserve',
    'meadow', 'grove', 'arboretum', 'botanical', 'playground', 'promenade',
    'lawn', 'greenspace',
  ];

  if (combined.includes('shepherd park') || r.includes('shepherd park') || n.includes('shepherd park')) return 'park';
  if (combined.includes('green square') || combined.includes('green space') || combined.includes('lawn')) return 'park';
  if (a === 'library' || s === 'library' || n.includes('library') || r.includes('library')) return 'library';
  if (a === 'cinema' || a === 'theatre' || a === 'movie_theater' || n.includes('theater') || n.includes('theatre') || n.includes('cinema')) return 'theater';
  if (a === 'cafe' || a === 'coffee_shop' || n.includes('coffee') || n.includes('starbucks') || n.includes('dunkin')) return 'cafe';
  if (n.includes('mcdonald') || r.includes('mcdonald') || a === 'fast_food' || s === 'fast_food' || s === 'mcdonalds') return 'mcdonalds';
  if (a === 'restaurant' || a === 'fast_food' || a === 'food_court') return 'restaurant';
  if (a === 'bar' || a === 'pub' || a === 'nightclub') return 'bar';
  if (a === 'pharmacy' || s === 'pharmacy' || s === 'chemist') return 'pharmacy';
  if (a === 'fitness_centre' || a === 'gym' || n.includes('gym') || n.includes('fitness')) return 'gym';
  if (outdoorKeywords.some((keyword) => combined.includes(keyword))) return 'park';
  if (s || a === 'shop' || a === 'supermarket' || a === 'convenience') return 'shop';

  return 'default';
}

function normalizeFootprint(roomShape, targetW = FLOOR_W, targetH = FLOOR_H) {
  if (!Array.isArray(roomShape) || roomShape.length < 3) return null;
  const raw = roomShape
    .map((p) => ({ lat: Number(p?.lat), lon: Number(p?.lon ?? p?.lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (raw.length < 3) return null;

  const pts = [];
  const epsilon = 1e-9;
  raw.forEach((point) => {
    const prev = pts[pts.length - 1];
    if (!prev || Math.abs(prev.lat - point.lat) > epsilon || Math.abs(prev.lon - point.lon) > epsilon) {
      pts.push(point);
    }
  });
  if (pts.length >= 3) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.abs(first.lat - last.lat) <= epsilon && Math.abs(first.lon - last.lon) <= epsilon) {
      pts.pop();
    }
  }
  if (pts.length < 3) return null;

  // Longitude degrees represent less real-world distance as latitude increases.
  // Scale lon deltas by cos(meanLat) so projected room shapes preserve aspect.
  const meanLat = pts.reduce((sum, p) => sum + p.lat, 0) / pts.length;
  const lonScale = Math.max(0.000001, Math.cos((meanLat * Math.PI) / 180));

  const minLon = Math.min(...pts.map((p) => p.lon));
  const maxLon = Math.max(...pts.map((p) => p.lon));
  const minLat = Math.min(...pts.map((p) => p.lat));
  const maxLat = Math.max(...pts.map((p) => p.lat));
  const spanLon = (maxLon - minLon) * lonScale;
  const spanLat = maxLat - minLat;
  if (spanLon <= 0 || spanLat <= 0) return null;

  const minSide = Math.max(320, Math.min(targetW, targetH));
  const pad = Math.max(40, Math.min(180, Math.round(minSide * 0.08)));
  const drawW = Math.max(120, targetW - pad * 2);
  const drawH = Math.max(120, targetH - pad * 2);
  const scale = Math.min(drawW / spanLon, drawH / spanLat);
  const ox = (targetW - spanLon * scale) / 2;
  const oy = (targetH - spanLat * scale) / 2;

  return pts.map((p) => ({
    x: ox + ((p.lon - minLon) * lonScale) * scale,
    y: oy + (maxLat - p.lat) * scale,
  }));
}

function isPointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function resolveSpawn(theme, footprint) {
  const fallback = theme.spawn || {
    x: (theme.width || FLOOR_W) / 2,
    y: (theme.height || FLOOR_H) - 180,
  };
  if (!Array.isArray(footprint) || footprint.length < 3) return fallback;

  const xs = footprint.map((p) => p.x);
  const ys = footprint.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  const sourceW = theme.width || FLOOR_W;
  const sourceH = theme.height || FLOOR_H;
  const ratioX = Math.max(0, Math.min(1, fallback.x / sourceW));
  const ratioY = Math.max(0, Math.min(1, fallback.y / sourceH));

  const avg = footprint.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  const centroid = { x: avg.x / footprint.length, y: avg.y / footprint.length };

  const candidates = [
    { x: minX + spanX * ratioX, y: minY + spanY * ratioY },
    centroid,
    { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    { x: (minX + maxX) / 2, y: maxY - Math.min(90, spanY * 0.1) },
  ];

  const valid = candidates.find((point) => isPointInPolygon(point.x, point.y, footprint));
  return valid || centroid;
}

function buildShepherdParkTrees(footprint, spawn, rng) {
  if (!Array.isArray(footprint) || footprint.length < 3) return [];

  const xs = footprint.map((point) => point.x);
  const ys = footprint.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const trees = [];

  let attempts = 0;
  while (trees.length < 72 && attempts < 240) {
    attempts += 1;
    const x = minX + rng() * (maxX - minX);
    const y = minY + rng() * (maxY - minY);
    const isNearSpawn = Math.hypot(x - spawn.x, y - spawn.y) < 260;
    if (!isNearSpawn && isPointInPolygon(x, y, footprint)) {
      trees.push({
        type: 'tree',
        x,
        y,
        w: 54,
        h: 96,
        solid: true,
      });
    }
  }

  return trees;
}

function hasStructuredIndoorSource(roomData = null) {
  if (!roomData || typeof roomData !== 'object') return false;
  if (roomData.indoorLayout && typeof roomData.indoorLayout === 'object') return true;
  if (roomData.floorplan && typeof roomData.floorplan === 'object') return true;
  if (roomData.floorPlan && typeof roomData.floorPlan === 'object') return true;
  if (Array.isArray(roomData.indoorFloors) && roomData.indoorFloors.length) return true;
  if (Array.isArray(roomData.levels) && roomData.levels.length) return true;
  if (Array.isArray(roomData.elements) && roomData.elements.length) return true;
  if (Array.isArray(roomData.floors) && roomData.floors.length) return true;
  return false;
}

function parseBuildingLevels(roomData = null) {
  const raw = roomData?.tags?.['building:levels']
    ?? roomData?.['building:levels']
    ?? roomData?.buildingLevels
    ?? roomData?.levels
    ?? null;
  if (raw === null || raw === undefined) return 1;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function cloneZone(zone = {}) {
  return {
    ...zone,
    points: Array.isArray(zone.points)
      ? zone.points.map((point) => ({ ...point }))
      : zone.points,
  };
}

function buildBasicTwoLevelLayout({
  theme,
  themeKey,
  roomName,
  layoutWidth,
  layoutHeight,
  footprint,
  contentZones,
  spawnF1,
}) {
  const makeWallZone = () => (
    footprint
      ? { type: 'wall_polygon', points: footprint.map((point) => ({ ...point })) }
      : { type: 'wall', x: 0, y: 0, w: layoutWidth, h: layoutHeight }
  );

  const stairW = Math.max(92, Math.round(layoutWidth * 0.08));
  const stairH = Math.max(140, Math.round(layoutHeight * 0.18));
  const stairX = Math.max(20, Math.round((layoutWidth - stairW) / 2));
  const stairY = Math.max(24, Math.round(layoutHeight * 0.08));

  const stairUp = {
    type: 'stairwell',
    x: stairX,
    y: stairY,
    w: stairW,
    h: stairH,
    label: '▲ Upstairs',
    toFloor: 1,
    interact: true,
  };
  const stairDown = {
    type: 'stairwell',
    x: stairX,
    y: stairY,
    w: stairW,
    h: stairH,
    label: '▼ Downstairs',
    toFloor: 0,
    interact: true,
  };

  const floor2Usable = contentZones
    .filter((zone) => !['entry', 'counter', 'wall', 'wall_polygon'].includes(String(zone?.type || '').toLowerCase()))
    .slice(0, 8)
    .map((zone, index) => {
      const cloned = cloneZone(zone);
      const jitterX = ((index % 3) - 1) * 30;
      const jitterY = Math.floor(index / 3) * 20;
      return {
        ...cloned,
        x: Number.isFinite(cloned.x) ? Math.max(30, Math.min(layoutWidth - 30, cloned.x + jitterX)) : cloned.x,
        y: Number.isFinite(cloned.y) ? Math.max(90, Math.min(layoutHeight - 40, cloned.y + jitterY)) : cloned.y,
      };
    });

  const floor1 = {
    carpet: theme.carpet,
    zones: [
      makeWallZone(),
      ...contentZones.map((zone) => cloneZone(zone)),
      stairUp,
      { type: 'sign', x: stairX + stairW / 2, y: stairY - 28, label: '2 levels detected (OSM)' },
    ],
  };

  const floor2 = {
    carpet: theme.carpet,
    zones: [
      makeWallZone(),
      ...floor2Usable,
      stairDown,
      { type: 'sign', x: stairX + stairW / 2, y: stairY - 28, label: 'Upper floor (basic scaffold)' },
    ],
  };

  const spawnF2 = {
    x: stairX + Math.round(stairW / 2),
    y: Math.min(layoutHeight - 56, stairY + stairH + 42),
  };

  return {
    id: `auto-${themeKey}${footprint ? '-poly' : ''}-2f`,
    name: roomName || theme.name,
    width: layoutWidth,
    height: layoutHeight,
    spawnF1,
    spawnF2,
    floors: [floor1, floor2],
  };
}

export function buildAutoLayout(roomId, roomName, amenityTag, shopTag = '', roomShape = null, roomData = null) {
  if (hasStructuredIndoorSource(roomData)) {
    const indoorLayout = parseIndoorLayout(roomData || {
      id: roomId,
      name: roomName,
      amenity: amenityTag,
      shop: shopTag,
      roomShape,
    });
    if (indoorLayout) return indoorLayout;
  }

  const rng = makeRng(roomId || roomName || 'default');
  const themeKey = pickTheme(roomId, amenityTag, shopTag, roomName);
  const theme = THEMES[themeKey];
  const layoutWidth = theme.width || FLOOR_W;
  const layoutHeight = theme.height || FLOOR_H;
  const footprint = normalizeFootprint(roomShape, layoutWidth, layoutHeight);

  const wallZone = footprint
    ? { type: 'wall_polygon', points: footprint }
    : { type: 'wall', x: 0, y: 0, w: theme.width || FLOOR_W, h: theme.height || FLOOR_H };

  const baseZones = theme.zones(rng);
  const scenicOutdoorTypes = new Set(['tree', 'shrub', 'bench', 'lamppost', 'flowerbed']);
  const contentZones = (
    themeKey === 'park' && footprint
      ? baseZones.filter((z) => !scenicOutdoorTypes.has(String(z?.type || '').toLowerCase()))
      : baseZones
  );
  const isShepherdPark = `${roomId || ''} ${roomName || ''}`.toLowerCase().includes('shepherd park');
  if (isShepherdPark && footprint) {
    contentZones.push(...buildShepherdParkTrees(footprint, resolveSpawn(theme, footprint), rng));
    contentZones.push(
      { type: 'employee', x: 1040, y: 1580, label: 'Morning Jogger', patrol: [[1040, 1580], [1320, 1640], [1580, 1540], [1860, 1640], [2140, 1540]] },
      { type: 'employee', x: 2380, y: 900, label: 'Park Regular', patrol: [[2380, 900], [2620, 820], [2860, 960], [2740, 1200], [2460, 1160]] },
      { type: 'employee', x: 820, y: 1480, label: 'Pond Watcher', patrol: [[820, 1480], [620, 1360], [760, 1180], [1020, 1240], [1080, 1460]] },
    );
  }
  const zones = [wallZone, ...contentZones];
  const buildingLevels = parseBuildingLevels(roomData);
  const useTwoLevelFallback = buildingLevels >= 2 && themeKey !== 'park';

  const spawnF1 = resolveSpawn(theme, footprint);
  if (useTwoLevelFallback) {
    return buildBasicTwoLevelLayout({
      theme,
      themeKey,
      roomName,
      layoutWidth,
      layoutHeight,
      footprint,
      contentZones,
      spawnF1,
    });
  }

  return {
    id: `auto-${themeKey}${footprint ? '-poly' : ''}`,
    name: roomName || theme.name,
    width: layoutWidth,
    height: layoutHeight,
    spawnF1,
    floors: [{ carpet: theme.carpet, zones }],
  };
}
