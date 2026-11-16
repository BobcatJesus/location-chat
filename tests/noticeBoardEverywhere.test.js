// noticeBoardEverywhere.test.js — boards in every location
// (`sq-notice-board-everywhere-v1`).
// Pure-logic tests: the placement helper, the hand-placed board
// zones in the named layouts, the park board from AutoLayout, and
// per-room board isolation (each room's board is a separate state).

import { describe, it, expect } from 'vitest';
import {
  NOTICE_BOARD_MARKER,
  NOTICE_BOARD_EVERYWHERE_MARKER,
  createNoticeBoardState,
  pinFlyer,
} from '../src/village/noticeBoardState.js';
import { resolveNoticeBoardSpot } from '../src/village/noticeBoardPlacement.js';
import { bar } from '../src/village/layouts/bar.js';
import { library } from '../src/village/layouts/library.js';
import { agora } from '../src/village/layouts/agora.js';
import { buildAutoLayout } from '../src/village/AutoLayout.js';

const BOUNDS_1600 = { x: 0, y: 0, w: 1600, h: 900 };
const alwaysInside = () => true;

const boardZone = (layout, floor = 0) =>
  (layout.floors[floor]?.zones || []).find((z) => z.type === 'notice_board');

describe('notice board everywhere', () => {
  it('carries the everywhere marker (v1 marker unchanged)', () => {
    expect(NOTICE_BOARD_EVERYWHERE_MARKER).toBe('sq-notice-board-everywhere-v1');
    expect(NOTICE_BOARD_MARKER).toBe('sq-notice-board-v1');
  });

  it('places the board just west of the entry', () => {
    const spot = resolveNoticeBoardSpot({
      entry: { x: 700, y: 780, w: 200, h: 40 },
      bounds: BOUNDS_1600,
      isInside: alwaysInside,
    });
    expect(spot).toEqual({ x: 480, y: 770, w: 180, h: 60, variant: 'wall' });
  });

  it('falls to the east side when the west side is outside the room', () => {
    const spot = resolveNoticeBoardSpot({
      entry: { x: 700, y: 780, w: 200, h: 40 },
      bounds: BOUNDS_1600,
      // West candidate centre (570, 800) is outside; east (1030, 800) is in.
      isInside: (x) => x >= 700,
    });
    expect(spot.x).toBe(940);
    expect(spot.y).toBe(770);
  });

  it('falls back to the spawn, then to the Agora spot', () => {
    const bySpawn = resolveNoticeBoardSpot({
      spawn: { x: 800, y: 720 },
      bounds: BOUNDS_1600,
      isInside: alwaysInside,
    });
    expect(bySpawn).toEqual({ x: 500, y: 780, w: 180, h: 60, variant: 'wall' });
    const byDefault = resolveNoticeBoardSpot({ bounds: BOUNDS_1600, isInside: alwaysInside });
    expect(byDefault).toEqual({ x: 480, y: 745, w: 180, h: 60, variant: 'wall' });
  });

  it('makes park boards corkboards on posts', () => {
    const spot = resolveNoticeBoardSpot({
      entry: { x: 1800, y: 2340, w: 280, h: 80 },
      bounds: { x: 0, y: 0, w: 3600, h: 2400 },
      isPark: true,
      isInside: alwaysInside,
    });
    expect(spot.variant).toBe('post');
    // West of the entry (y 2330) clamps to 2320 inside the 2400-high bounds.
    expect(spot).toEqual({ x: 1580, y: 2320, w: 180, h: 60, variant: 'post' });
  });

  it('clamps the spot inside the room bounds', () => {
    const spot = resolveNoticeBoardSpot({
      entry: { x: 0, y: 780, w: 200, h: 40 },
      bounds: BOUNDS_1600,
      isInside: alwaysInside,
    });
    expect(spot.x).toBeGreaterThanOrEqual(20);
    expect(spot.y + spot.h).toBeLessThanOrEqual(880);
  });

  it("Lola's board is on the south wall, west of the entrance (Agora's spot unchanged)", () => {
    const lolas = boardZone(bar);
    expect(lolas).toMatchObject({ x: 480, y: 775, w: 180, h: 60, interact: true, solid: false });
    expect(boardZone(agora)).toMatchObject({ x: 480, y: 745, w: 180, h: 60 });
  });

  it('the Library board is on the ground floor, east of the Main Entrance', () => {
    expect(boardZone(library, 0)).toMatchObject({ x: 980, y: 770, w: 180, h: 60, interact: true });
    expect(boardZone(library, 1)).toBeUndefined();
  });

  it('Shepherd Park gets a post board by the entry (and so does any park)', () => {
    const shepherd = buildAutoLayout('shepherd-park', 'Shepherd Park');
    const parkBoard = boardZone(shepherd);
    expect(parkBoard).toMatchObject({ variant: 'post', x: 1560, y: 2260, w: 180, h: 60, interact: true });
    const generic = buildAutoLayout('riverside-park', 'Riverside Park');
    expect(boardZone(generic)).toMatchObject({ variant: 'post' });
  });

  it('each room’s board is separate: pins in one room never show in another', () => {
    const agoraBoard = createNoticeBoardState();
    const parkBoard = createNoticeBoardState();
    pinFlyer(agoraBoard, { id: 'a1', title: 'Guitar lessons', text: 'First lesson free!', addedBy: 'alice@example.com' });
    expect(agoraBoard.flyers.length).toBe(1);
    expect(parkBoard.flyers.length).toBe(0);
    // The cap is per board, not global.
    for (let i = 0; i < 10; i++) {
      pinFlyer(agoraBoard, { id: `a${i + 2}`, title: `T${i}`, text: 'X', addedBy: 'alice@example.com' });
    }
    expect(agoraBoard.flyers.length).toBe(10);
    pinFlyer(parkBoard, { id: 'p1', title: 'Dog walkers', text: 'Sundays 9am', addedBy: 'bob@example.com' });
    expect(parkBoard.flyers.length).toBe(1);
    expect(parkBoard.flyers[0].id).toBe('p1');
  });
});
