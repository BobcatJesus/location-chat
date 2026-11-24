// movement.js — tap-to-move stuck detection (Mobile movement v1,
// `sq-mobile-move-v1`).
//
// Tap-to-move walks a straight line at the tap point. When furniture
// blocks that line, the slide logic pushes the player along the wall,
// but the target stays set — the player keeps pushing against the
// furniture forever. On desktop you grab WASD and steer around; on a
// phone there is no keyboard, so tap-to-move is the only steering and
// getting stuck is far easier.
//
// This tracks progress toward the target and says when to give up: if
// the player hasn't gotten meaningfully closer for STUCK_DROP_MS, the
// target is dropped — they stop, and tap a clear spot to walk around.
// A slow slide along a wall still counts as progress (the timer resets
// whenever the distance shrinks), so only a true standstill drops.
//
// Pure (no Phaser): the scene owns the state, this only decides.

export const STUCK_DROP_MS = 1500;
export const STUCK_PROGRESS_PX = 4;

// state: { bestDist, since } | null. Returns { drop, state }.
export function stuckDropCheck(state, dist, now) {
  if (!state) return { drop: false, state: { bestDist: dist, since: now } };
  if (dist < state.bestDist - STUCK_PROGRESS_PX) {
    return { drop: false, state: { bestDist: dist, since: now } };
  }
  if (now - state.since >= STUCK_DROP_MS) return { drop: true, state: null };
  return { drop: false, state };
}
