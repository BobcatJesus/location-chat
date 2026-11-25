// tableBlocking.test.js — Table Blocking v1.1 (`sq-table-blocking-v1.1`)
// and Prop Table Blocking v1 (`sq-prop-table-blocking-v1`).
//
// v1 shrank the cafe tables' solid box 60x60 -> 24x24 and the user still
// snagged on them, so v1.1 makes cafe tables WALK-THROUGH: no solid box
// at all. The drawn table is unchanged (same 60px circle) and the tables
// stay in interactZones (still clickable) — only the solidity is gone.
// The generic 'table' zone (Collab Commons) was never solid and still
// isn't; the puzzle table never had a solid box either.
//
// v1 turned out to fix the WRONG tables: the user meant the brown cartoony
// pedestal tables, which are PLACED FURNITURE (prop_table_round custom
// zones, 72x72 box from setDynamicSolids), not the flat cafe-table circles.
// This file's prop-table block pins that fix: prop tables register no
// dynamic box, everything else keeps its full box, and the cafe-table
// walk-through still holds.

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

// sq-prop-table-blocking-v1: placed brown tables (prop_table_round custom
// zones) are WALK-THROUGH — no dynamic solid box. setDynamicSolids is
// called after drawFloor (drawFloor itself calls it with []), so the tests
// set the zones explicitly.
describe('prop table blocking', () => {
  it('registers NO dynamic box for a placed prop_table_round zone, and the player walks straight through its centre', () => {
    const rl = drawLayout(layoutWithZones([]));
    const table = {
      type: 'prop_table_round', frameKey: 'prop_table_round',
      x: 500, y: 450, w: 72, h: 72, solid: true, label: 'Table',
    };
    rl.setDynamicSolids([table]);
    expect(rl.dynamicSolidZones).toHaveLength(0);
    // No box at all — not the 72x72 catalog box, nothing.
    expect(rl.collidesWithSolid(500, 450, PLAYER_RADIUS)).toBe(false);
    expect(rl.collidesWithSolid(500, 450 + 36, PLAYER_RADIUS)).toBe(false);
    const through = rl.resolveAgainstSolids(500, 400, 500, 500, PLAYER_RADIUS);
    expect(through.x).toBe(500);
    expect(through.y).toBe(500);
  });

  it('registers NO dynamic box for a legacy table zone (type table, frameKey prop_table_round)', () => {
    const rl = drawLayout(layoutWithZones([]));
    rl.setDynamicSolids([{
      type: 'table', frameKey: 'prop_table_round',
      x: 500, y: 450, w: 72, h: 72, solid: true, label: 'Table',
    }]);
    expect(rl.dynamicSolidZones).toHaveLength(0);
    expect(rl.collidesWithSolid(500, 450, PLAYER_RADIUS)).toBe(false);
  });

  it('keeps the full dynamic box for a non-table custom zone of similar size', () => {
    const rl = drawLayout(layoutWithZones([]));
    rl.setDynamicSolids([{
      type: 'prop_bookshelf', frameKey: 'prop_bookshelf',
      x: 500, y: 450, w: 120, h: 50, solid: true, label: 'Bookshelf',
    }]);
    expect(rl.dynamicSolidZones).toHaveLength(1);
    expect(rl.dynamicSolidZones[0]).toEqual({ left: 440, top: 425, right: 560, bottom: 475 });
    expect(rl.collidesWithSolid(500, 450, PLAYER_RADIUS)).toBe(true);
  });

  it('keeps the full dynamic box for a counter that shares the table frameKey (service_counter_h)', () => {
    // service_counter_h and coffee_bar_h share frameKey 'prop_table_round'
    // but render as zones (renderAsZone), not as table sprites — they
    // must stay solid. This pins the match-on-type (not frameKey) rule.
    const rl = drawLayout(layoutWithZones([]));
    rl.setDynamicSolids([{
      type: 'service_counter_h', frameKey: 'prop_table_round', renderAsZone: 'counter',
      x: 500, y: 450, w: 240, h: 42, solid: true, label: 'Counter',
    }]);
    expect(rl.dynamicSolidZones).toHaveLength(1);
    expect(rl.dynamicSolidZones[0]).toEqual({ left: 380, top: 429, right: 620, bottom: 471 });
    expect(rl.collidesWithSolid(500, 450, PLAYER_RADIUS)).toBe(true);
  });

  it('keeps the cafe-table walk-through when prop tables are present', () => {
    const rl = drawLayout(agora);
    rl.setDynamicSolids([{
      type: 'prop_table_round', frameKey: 'prop_table_round',
      x: 800, y: 450, w: 72, h: 72, solid: true, label: 'Table',
    }]);
    // No dynamic box for the prop table…
    expect(rl.dynamicSolidZones).toHaveLength(0);
    expect(rl.collidesWithSolid(800, 450, PLAYER_RADIUS)).toBe(false);
    // …and the cafe tables still have no static box either.
    const tables = agora.floors[0].zones.filter((z) => z.type === 'cafe_table');
    expect(tables).toHaveLength(4);
    for (const t of tables) {
      expect(rl.collidesWithSolid(t.x, t.y, PLAYER_RADIUS)).toBe(false);
    }
  });
});
