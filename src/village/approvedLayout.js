// approvedLayout.js — fetch a room's approved user layout and convert it
// into a RoomLayout-compatible layout object ("what you draw is what gets built").
//
// Submission formats:
//   v2: { version: 2, roomShape: [{x,y}...], furniture: [{type,x,y,w,h,rotation...}] }  (normalized 0..1)
//   v1: { gridW, gridH, walls, furniture }  (legacy 20x15 grid)

import { furnitureByName, makeFurnitureZone } from './furnitureCatalog.js';

const WORLD_W = 1600;
const WORLD_H = 900;
const DEFAULT_CARPET = 0xfef3c7;

function backendUrl() {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL;
  }
  return 'https://location-chat-production.up.railway.app';
}

export async function fetchApprovedLayout(roomId) {
  if (!roomId) return null;
  try {
    const res = await fetch(
      `${backendUrl()}/api/room-layout/${encodeURIComponent(roomId)}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? data : null;
  } catch {
    return null;
  }
}

function cssToHex(css) {
  if (!css || typeof css !== 'string') return 0x9aa3b2;
  const m = css.trim().match(/^#([0-9a-fA-F]{6})$/);
  return m ? parseInt(m[1], 16) : 0x9aa3b2;
}

function convertV2(data) {
  const zones = [];

  // Room outline -> wall_polygon zone (RoomLayout._computeBoundary picks this up)
  const shape = Array.isArray(data.roomShape) ? data.roomShape : [];
  const points = shape
    .map((p) => ({ x: Number(p.x) * WORLD_W, y: Number(p.y) * WORLD_H }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length >= 3) {
    zones.push({ type: 'wall_polygon', points });
  }

  // Furniture -> zones
  for (const f of Array.isArray(data.furniture) ? data.furniture : []) {
    const catalog = furnitureByName.get(f.type);
    if (!catalog) continue;
    const x = Number(f.x) * WORLD_W;
    const y = Number(f.y) * WORLD_H;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const zone = makeFurnitureZone(catalog, x, y, { rotation: Number(f.rotation) || 0 });
    // Prefer the renderAsZone type so RoomLayout draws it natively (shelf, pond, jukebox...)
    if (zone.renderAsZone) {
      zone.type = zone.renderAsZone;
      // _draw expects x,y as top-left for native zones; makeFurnitureZone uses center
      zone.x = x - zone.w / 2;
      zone.y = y - zone.h / 2;
    } else {
      // Generic furniture: drawn by the default case in RoomLayout._draw
      zone.type = 'user_furniture';
      zone.css = catalog.css;
      zone.x = x - zone.w / 2;
      zone.y = y - zone.h / 2;
    }
    zones.push(zone);
  }
  return zones;
}

function convertV1(data) {
  const zones = [];
  const gridW = Number(data.gridW) || 20;
  const gridH = Number(data.gridH) || 15;
  const cellW = WORLD_W / gridW;
  const cellH = WORLD_H / gridH;

  // Walls: draw as thin wall segments along filled cells
  const walls = data.walls || {};
  const wallCells = [];
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (walls[`${gx},${gy}`]) wallCells.push({ gx, gy });
    }
  }
  for (const { gx, gy } of wallCells) {
    zones.push({
      type: 'user_furniture',
      css: '#3a3a3a',
      x: gx * cellW,
      y: gy * cellH,
      w: cellW,
      h: cellH,
      label: '',
    });
  }

  // Furniture (v1 stored grid coords)
  for (const f of Array.isArray(data.furniture) ? data.furniture : []) {
    const catalog = furnitureByName.get(f.type);
    const gx = Number(f.gx ?? f.x ?? 0);
    const gy = Number(f.gy ?? f.y ?? 0);
    const wCells = Number(f.w ?? 1);
    const hCells = Number(f.h ?? 1);
    const w = (catalog?.w || wCells * cellW);
    const h = (catalog?.h || hCells * cellH);
    const zone = {
      type: 'user_furniture',
      css: catalog?.css || '#9aa3b2',
      x: gx * cellW,
      y: gy * cellH,
      w, h,
      label: catalog?.label || f.type || '',
      solid: true,
    };
    if (catalog?.renderAsZone) zone.type = catalog.renderAsZone;
    zones.push(zone);
  }
  return zones;
}

/**
 * Convert an approved submission record ({ layout, ... }) into a
 * RoomLayout-compatible layout object. Returns null if unusable.
 */
export function approvedToLayout(approved, roomId, roomName) {
  const data = approved?.layout || approved;
  if (!data || typeof data !== 'object') return null;

  let zones;
  if (data.version === 2) {
    zones = convertV2(data);
  } else {
    zones = convertV1(data);
  }
  if (!zones.length) return null;

  return {
    id: `approved-${roomId}`,
    name: roomName || 'Approved Design',
    width: WORLD_W,
    height: WORLD_H,
    isApprovedDesign: true,
    floors: [{ carpet: DEFAULT_CARPET, zones }],
  };
}
