// noticeBoardPlacement.js — where a room's notice board goes
// (Notice Board everywhere v1, `sq-notice-board-everywhere-v1`).
//
// Pure logic, no Phaser and no Node APIs, so it is unit-testable and
// shared by RoomLayout (which draws the board) and NoticeBoardSystem
// (which opens it when no zone exists). Every room gets a board:
//   - rooms with a hand-placed `notice_board` zone keep it (Agora's
//     south wall, Lola's south wall, the Library ground floor, the
//     park's corkboard on a post by the entry — see the layout files)
//   - every other ground floor gets a synthetic one from this helper,
//     near the entrance, so user-created rooms and approved layouts
//     get a board automatically. The synthetic zone is drawn and
//     opened like any other, but never written back into the file
//     layout — the author's layout stays exactly as they left it.
//
// A park board is a corkboard on two wooden posts (`variant:
// 'post'`), not a wall board; everywhere else it hangs on the wall
// (`variant: 'wall'`).

export const NOTICE_BOARD_W = 180;
export const NOTICE_BOARD_H = 60;

/**
 * Pick a spot for a room's notice board.
 * `entry` is the room's entry zone { x, y, w, h } (or null).
 * `spawn` is the room's spawn point { x, y } (or null).
 * `bounds` is the room's boundary rect { x, y, w, h } (or null).
 * `isPark` makes it a corkboard on a post instead of a wall board.
 * `isInside(x, y)` is an optional point-in-room check; when given,
 * a candidate only counts if its centre is inside the room.
 * Returns { x, y, w, h, variant } — always a spot, never null.
 *
 * Candidates, in order: just west of the entry, just east of the
 * entry, just south-west of the spawn, then the Agora spot (480,745)
 * as a last resort.
 */
export function resolveNoticeBoardSpot({ entry, spawn, bounds, isPark, isInside } = {}) {
  const variant = isPark ? 'post' : 'wall';
  const b = bounds || { x: 0, y: 0, w: 1600, h: 900 };
  const clamp = (x, y) => ({
    x: Math.max(b.x + 20, Math.min(b.x + b.w - NOTICE_BOARD_W - 20, x)),
    y: Math.max(b.y + 20, Math.min(b.y + b.h - NOTICE_BOARD_H - 20, y)),
  });
  const candidates = [];
  if (entry) {
    candidates.push({ x: entry.x - NOTICE_BOARD_W - 40, y: entry.y - 10 });
    candidates.push({ x: entry.x + (entry.w || 200) + 40, y: entry.y - 10 });
  }
  if (spawn) {
    candidates.push({ x: spawn.x - NOTICE_BOARD_W - 120, y: spawn.y + 60 });
  }
  candidates.push({ x: 480, y: 745 });
  for (const c of candidates) {
    const p = clamp(c.x, c.y);
    if (!isInside || isInside(p.x + NOTICE_BOARD_W / 2, p.y + NOTICE_BOARD_H / 2)) {
      return { ...p, w: NOTICE_BOARD_W, h: NOTICE_BOARD_H, variant };
    }
  }
  // Nothing was inside the room (odd boundary): return the clamped
  // default anyway — the board still opens, it just may sit on a wall.
  const p = clamp(480, 745);
  return { ...p, w: NOTICE_BOARD_W, h: NOTICE_BOARD_H, variant };
}
