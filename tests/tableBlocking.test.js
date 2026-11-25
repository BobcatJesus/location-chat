// tableBlocking.test.js — Table Blocking v1.1 (`sq-table-blocking-v1.1`).
//
// v1 shrank the cafe tables' solid box 60x60 -> 24x24 and the user still
// snagged on them, so v1.1 makes cafe tables WALK-THROUGH: no solid box
// at all. The drawn table is unchanged (same 60px circle) and the tables
// stay in interactZones (still clickable) — only the solidity is gone.
// The generic 'table' zone (Collab Commons) was never solid and still
// isn't; the puzzle table never had a solid box either.

import { describe, it, expect } from 'vitest';
import { RoomLayout } from '../src/village/RoomLayout.js';
import { agora } from '../src/village/layouts/agora.js';

// The radius VillageScene passes to resolveAgainstSolids for the player.
const PLAYER_RADIUS = 16;

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
  it('registers NO solid box for any Agora cafe table, and the tables stay clickable', () => {
    const rl = drawLayout(agora);
    const tables = agora.floors[0].zones.filter((z) => z.type === 'cafe_table');
    expect(tables).toHaveLength(4);
    for (const t of tables) {
      // No static box covers the table centre at all — not the old 60x60,
      // not the v1 24x24 pedestal, not anything.
      expect(rl.staticSolidZones.some((b) => b.left <= t.x && t.x <= b.right
        && b.top <= t.y && t.y <= b.bottom)).toBe(false);
      expect(rl.collidesWithSolid(t.x, t.y, PLAYER_RADIUS)).toBe(false);
    }
    // The tables are still in interactZones, so clicking them and the
    // prompts that resolve to them (puzzle pieces under Tables 1-3,
    // the present under Table 4) still work.
    const interactTables = rl.interactZones.filter((z) => z.type === 'cafe_table');
    expect(interactTables).toHaveLength(4);
    for (const t of tables) {
      expect(interactTables.some((z) => z.label === t.label)).toBe(true);
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

  it('walks straight through a table centre', () => {
    // Two cafe tables 70px apart, centre to centre. With any box at all
    // the player would snag; with no box the player walks right across
    // a table centre.
    const rl = drawLayout(layoutWithZones([
      { type: 'cafe_table', x: 500, y: 450, label: 'Table A', interact: true },
      { type: 'cafe_table', x: 570, y: 450, label: 'Table B', interact: true },
    ]));
    expect(rl.staticSolidZones).toHaveLength(0);
    expect(rl.collidesWithSolid(500, 450, PLAYER_RADIUS)).toBe(false);
    expect(rl.collidesWithSolid(570, 450, PLAYER_RADIUS)).toBe(false);
    const through = rl.resolveAgainstSolids(500, 400, 500, 500, PLAYER_RADIUS);
    expect(through.x).toBe(500);
    expect(through.y).toBe(500);
  });

  it('opens the west-side corridor between real Agora Tables 1 and 4', () => {
    // Table 1 (300,280) and Table 4 (300,640): the corridor straight
    // down x=300 between them, and straight through Table 1's centre.
    const rl = drawLayout(agora);
    expect(rl.collidesWithSolid(300, 315, PLAYER_RADIUS)).toBe(false);
    expect(rl.collidesWithSolid(300, 605, PLAYER_RADIUS)).toBe(false);
    expect(rl.collidesWithSolid(300, 280, PLAYER_RADIUS)).toBe(false);
    // The whole corridor walks through without snagging.
    const walked = rl.resolveAgainstSolids(300, 320, 300, 600, PLAYER_RADIUS);
    expect(walked.x).toBe(300);
    expect(walked.y).toBeGreaterThanOrEqual(590);
    // And straight through Table 1's centre.
    const through = rl.resolveAgainstSolids(300, 240, 300, 320, PLAYER_RADIUS);
    expect(through.x).toBe(300);
    expect(through.y).toBe(320);
  });
});
