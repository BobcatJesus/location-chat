// portraitCamera.js — Portrait fill v1 (`sq-portrait-fill-v1`).
// Pure camera math for the VillageScene. The game canvas used to be a
// fixed 1600x900 with Phaser.Scale.FIT, so every viewport saw the same
// 842x474 world slice (at follow zoom 1.9) and a portrait phone just
// shrank that slice to a ~220px-tall strip. With Scale.RESIZE the canvas
// is the real viewport, so the zoom has to adapt: keep a minimum slice
// of the world visible, never zoom in past the mode's base zoom, and
// never show past the room bounds (that would paint the mood background
// as a band past the walls).

// Minimum world units visible, in each dimension. Desktop FIT showed
// 842x474 (follow zoom 1.9 on 1600x900); the height target keeps vertical
// visibility near-desktop, the width target is what a portrait phone can
// afford while still showing the furniture around the player.
export const MIN_VISIBLE_WORLD_W = 330;
export const MIN_VISIBLE_WORLD_H = 450;
// The old fixed game height FIT rendered at. A close mode legitimately
// shows less height than 450 on desktop (ultra-close showed 316), so
// the height floor is mode-relative: never less than FIT showed for
// that mode, up to MIN_VISIBLE_WORLD_H.
export const LEGACY_GAME_H = 900;

// Overview fits the whole room; on desktop a 1600x900 room on a
// 1600x900 viewport fits at zoom 1.2 — the reference
// resolveOverviewZoom multiplies the raw fit by.
export const OVERVIEW_REFERENCE_ZOOM = 1.2;
// Overview never zooms in past this (same ceiling as the old clamp) and
// never below what fits the room.
export const OVERVIEW_MAX_ZOOM = 2.4;
export const OVERVIEW_MIN_ZOOM = 0.95;

function finite(n, fallback) {
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Follow-mode camera for an arbitrary viewport.
 * viewportW/viewportH in CSS px, baseZoom/baseAvatarScale for the camera
 * mode, boundsW/boundsH = the camera bounds in world units.
 * Returns { zoom, avatarScale } — avatarScale is the mode's base scale.
 * Avatar shrink v1 (`sq-avatar-shrink-zoom-v1`): no zoom compensation,
 * so the avatar shrinks on screen as the zoom drops, like everything
 * else in the room.
 */
export function resolveFollowCamera({ viewportW, viewportH, baseZoom, baseAvatarScale, boundsW, boundsH }) {
  const w = Math.max(1, finite(viewportW, 1600));
  const h = Math.max(1, finite(viewportH, 900));
  const base = Math.max(0.2, finite(baseZoom, 1.9));
  const bw = Math.max(1, finite(boundsW, 1600));
  const bh = Math.max(1, finite(boundsH, 900));
  // Pull the zoom down until at least the minimum world slice is
  // visible, but never past the mode's base zoom. The height floor is
  // mode-relative (see LEGACY_GAME_H above): an absolute 450 would drag
  // desktop ultra-close (2.85) down to 2.0 and change desktop.
  const minVisibleH = Math.min(MIN_VISIBLE_WORLD_H, LEGACY_GAME_H / base);
  let zoom = Math.min(base, w / MIN_VISIBLE_WORLD_W, h / minVisibleH);
  // ...and never so far out that the viewport exceeds the room bounds
  // (that would show the mood background past the walls).
  const boundsFloor = Math.max(w / bw, h / bh);
  zoom = Math.max(zoom, boundsFloor);
  // ...and never in past the mode's base zoom. On a monitor bigger than
  // the room the room just sits centered with mood-color bands, as FIT
  // letterboxed it before.
  zoom = Math.min(zoom, base);
  zoom = Math.max(0.2, zoom);
  // sq-avatar-shrink-zoom-v1: no zoom compensation on the avatar scale —
  // the avatar shrinks on screen as the zoom drops.
  const avatarScale = Math.max(0.1, finite(baseAvatarScale, 1));
  return { zoom, avatarScale };
}

/**
 * Overview zoom: fit the whole room, generalizing the old clamp
 * (0.95..2.4) so a portrait phone can fit a wide room at all.
 * Identical to the old clamp whenever raw >= 0.95.
 */
export function resolveOverviewZoom({ viewportW, viewportH, boundsW, boundsH }) {
  const w = Math.max(1, finite(viewportW, 1600));
  const h = Math.max(1, finite(viewportH, 900));
  const bw = Math.max(1, finite(boundsW, 1600));
  const bh = Math.max(1, finite(boundsH, 900));
  const raw = Math.min(w / bw, h / bh) * OVERVIEW_REFERENCE_ZOOM;
  return Math.max(Math.min(OVERVIEW_MIN_ZOOM, raw), Math.min(OVERVIEW_MAX_ZOOM, raw));
}

/**
 * Overview avatar scale: the mode's base scale, uncompensated.
 * Avatar shrink v1 (`sq-avatar-shrink-zoom-v1`): the avatar shrinks on
 * screen with the fit zoom, like everything else — fitZoom is accepted
 * for call-site compatibility but no longer affects the scale.
 */
export function resolveOverviewAvatarScale({ fitZoom, baseAvatarScale }) {
  void fitZoom;
  return Math.max(0.1, finite(baseAvatarScale, 1));
}
