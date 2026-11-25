// tableBlocking.test.js — Table Blocking v1 (`sq-table-blocking-v1`).
//
// Cafe tables used to block with their full 60px drawn circle (a 60x60
// solid box), so a radius-16 player saw a 92x92 no-go zone around every
// table and snagged on the edges. Only the 24x24 pedestal at the centre
// blocks now; the drawn table is unchanged. The generic 'table' zone
// (Collab Commons) was never solid and still isn't; the puzzle table
// never had a solid box either.

import { describe, it, expect } from 'vitest';
import { RoomLayout } from '../src/village/RoomLayout.js';
import { agora } from '../src/village/layouts/agora.js';

// The radius VillageScene passes to resolveAgainstSolids for the player.
const PLAYER_RADIUS = 16;
const PLAYER_DIAMETER = PLAYER_RADIUS * 2;

// Minimal Phaser scene stub: every graphics/text call is a chainable no-op.
function makeChainable() {
  const target = {};
  const proxy = new Proxy(target, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      return (..._args) => proxy;
    },
  });
  return proxy;
}

function makeSceneStub() {
  const chainable = makeChainable();
  return {
    sys: {},
    add: {
      graphics: () => chainable,
      text: () => chainable,
    },
  };
}

function layoutWithZones(zones) {
  return {
    id: 'test-room',
    floors: [{
      id: 'ground',
      zones: [
        { type: 'wall', x: 0, y: 0, w: 1600, h: 900, solid: true },
        ...zones,
      ],
    }],
  };
}

function drawLayout(layout) {
  const rl = new RoomLayout(makeSceneStub(), layout);
  rl.drawFloor(0);
  return rl;
}

describe('cafe table blocking', () => {
  it('shrinks every Agora cafe table solid box to a 24x24 pedestal', () => {
    const rl = drawLayout(agora);
    const tables = agora.floors[0].zones.filter((z) => z.type === 'cafe_table');
    expect(tables).toHaveLength(4);
    for (const t of tables) {
      const box = rl.staticSolidZones.find((b) => b.left === t.x - 12 && b.top === t.y - 12);
      expect(box).toBeDefined();
      expect(box.right - box.left).toBe(24);
      expect(box.bottom - box.top).toBe(24);
      expect(box.right).toBe(t.x + 12);
      expect(box.bottom).toBe(t.y + 12);
    }
    // The old 60x60 box is gone: no static box is the old box centred on a table.
    for (const t of tables) {
      expect(rl.staticSolidZones.some((b) => b.left === t.x - 30
        && b.top === t.y - 30 && b.right === t.x + 30 && b.bottom === t.y + 30)).toBe(false);
    }
  });

  it('leaves every other Agora solid exactly as it was', () => {
    const rl = drawLayout(agora);
    const has = (l, t, r, b) => rl.staticSolidZones.some(
      (z) => z.left === l && z.top === t && z.right === r && z.bottom === b,
    );
    expect(has(420, 110, 1180, 174)).toBe(true); // coffee bar counter, full 760x64
    expect(has(130, 180, 178, 228)).toBe(true); // NW plant, full 48x48
    expect(has(130, 690, 178, 738)).toBe(true); // SW plant, full 48x48
    expect(has(540, 360, 740, 420)).toBe(true); // north couch, full 200x60
    expect(has(540, 600, 740, 660)).toBe(true); // south couch, full 200x60
    expect(has(1230, 120, 1266, 156)).toBe(true); // trash can, full 36x36
  });

  it('registers no solid box for a generic table zone (Collab Commons)', () => {
    const rl = drawLayout(layoutWithZones([
      { type: 'table', x: 700, y: 700, w: 200, h: 100, label: 'Collab Commons' },
    ]));
    expect(rl.staticSolidZones).toHaveLength(0);
  });

  it('opens a gap between two close tables that the old 60px boxes closed', () => {
    // Two cafe tables 70px apart, centre to centre. With the old 60x60
    // boxes only 10px stood between them — less than the 32px a radius-16
    // player needs, so the gap was sealed. With 24x24 pedestals the gap
    // is 46px, and the player walks straight through it.
    const rl = drawLayout(layoutWithZones([
      { type: 'cafe_table', x: 500, y: 450, label: 'Table A', interact: true },
      { type: 'cafe_table', x: 570, y: 450, label: 'Table B', interact: true },
    ]));
    expect(rl.staticSolidZones).toHaveLength(2);
    const [a, b] = [...rl.staticSolidZones].sort((p, q) => p.left - q.left);
    expect(b.left - a.right).toBe(46); // 70 - 24
    expect(46).toBeGreaterThanOrEqual(PLAYER_DIAMETER);
    expect(70 - 60).toBeLessThan(PLAYER_DIAMETER); // old geometry sealed it
    // The midpoint between the tables is free, and the player crosses
    // the gap vertically through it.
    expect(rl.collidesWithSolid(535, 450, PLAYER_RADIUS)).toBe(false);
    const crossed = rl.resolveAgainstSolids(535, 400, 535, 500, PLAYER_RADIUS);
    expect(crossed.x).toBe(535);
    expect(crossed.y).toBeGreaterThanOrEqual(490);
  });

  it('opens the west-side corridor between real Agora Tables 1 and 4', () => {
    // Table 1 (300,280) and Table 4 (300,640): the corridor straight
    // down x=300 between them. With the old 60px boxes the player
    // snagged 5px from each table — (300,315) sat 5px below Table 1's
    // box and (300,605) 5px above Table 4's, both inside the radius-16
    // circle. The 24px pedestals leave 23px clear at both points.
    const rl = drawLayout(agora);
    expect(rl.collidesWithSolid(300, 315, PLAYER_RADIUS)).toBe(false);
    expect(rl.collidesWithSolid(300, 605, PLAYER_RADIUS)).toBe(false);
    // And the whole corridor walks through without snagging.
    const walked = rl.resolveAgainstSolids(300, 320, 300, 600, PLAYER_RADIUS);
    expect(walked.x).toBe(300);
    expect(walked.y).toBeGreaterThanOrEqual(590);
  });
});
