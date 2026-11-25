// snowfall.js — Snowfall v1 (`sq-snowfall-v1`), v1.1 (`sq-snowfall-v1.1`).
//
// Gentle snowflakes falling in OUTDOOR rooms through November
// and December.
// This is AMBIENCE, not a quest: no coins, no badge, no server
// change, no persistence, no gameplay. It exists to make the
// Christmas season feel like Christmas while you walk around.
//
// Scope (user-decided): outdoor rooms only, November + December.
// v1 was December-only; v1.1 widened it — the user said there
// is no reason not to have snow in November too.
// The Agora (indoor cafe) never snows; Shepherd Park, Hermann
// Park, Forest Gate, and Downtown Plaza do.
//
// Cost: ~40 tiny images, one shared canvas texture, fall + a
// slow sideways sway per flake, no per-flake physics. The
// flakes live in the camera's current view and recycle at the
// top when they fall out of it, so the density stays constant
// as you walk and the count never grows. Phaser stops calling
// update() while the tab is hidden, so nothing piles up — and
// the frame delta is clamped on resume, so a tab-switch does
// not teleport the flakes.
//
// Lifecycle mirrors DayNightMode (the closest existing ambient
// effect): the scene constructs it in create(), calls update()
// every frame, and destroys it in shutdown() — so a scene
// restart (e.g. flipping the comic-style toggle) can never
// leave flakes behind or stack a second emitter.
//
// Test override (a test hook, not a setting — it is not saved
// anywhere, and it is not shown in any UI):
//   ?snow=1  forces the snow on (in an outdoor room, any month)
//   ?snow=0  forces the snow off (even in November/December)
//   no param: November + December, as designed.

import { DEPTH } from './depth.js';
import { isOutdoorLocation } from './outdoorRoomDetection.js';

export const SNOWFALL_MARKER_V1 = 'sq-snowfall-v1';

/** The snow clock runs on Chicago time, like the temperature
 *  seasons (temperature.js) and the cat's hunger windows. */
export const SNOW_TIMEZONE = 'America/Chicago';

/** The snow months, by Chicago month number: November + December.
 *  v1.1 (`sq-snowfall-v1.1`) widened this from December-only —
 *  the user said there is no reason not to have snow in
 *  November too. Changeable. */
export const SNOW_MONTHS = [11, 12];

/** Flake budget (builder picks — gentle and cheap on mobile):
 *  40 flakes, small and mostly translucent, falling slowly
 *  with a lazy sideways sway. */
export const SNOWFLAKE_COUNT = 40;
export const SNOW_FALL_SPEED_MIN = 24; // px per second
export const SNOW_FALL_SPEED_MAX = 60; // px per second
export const SNOW_SWAY_PX = 10; // sideways sway amplitude
export const SNOW_SWAY_SPEED_MIN = 0.4; // sway cycles per second
export const SNOW_SWAY_SPEED_MAX = 0.9;
export const SNOWFLAKE_SIZE_MIN = 3; // px on screen
export const SNOWFLAKE_SIZE_MAX = 7;
export const SNOW_ALPHA_MIN = 0.5;
export const SNOW_ALPHA_MAX = 0.9;

/** Snow renders above the world (and above the night grade, so
 *  flakes stay visible after dark) and below the DOM-level UI. */
export const SNOW_DEPTH_OFFSET = 500;

/** Chicago wall-clock month (1–12) for a Date, via Intl — the
 *  same pattern as temperature.js chicagoMonth. Falls back to
 *  local time if Intl has no such timezone. */
export function chicagoMonth(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: SNOW_TIMEZONE, month: 'numeric',
    }).formatToParts(date);
    return Number(parts.find((p) => p.type === 'month')?.value || 0);
  } catch {
    return date.getMonth() + 1;
  }
}

/** November or December is a snow month. */
export function isSnowMonth(date = new Date()) {
  return SNOW_MONTHS.includes(chicagoMonth(date));
}

/** Parse the `?snow=` test override from a query string:
 *  '1' → true (force on), '0' → false (force off), anything
 *  else (including absent) → undefined (no override). Pure, so
 *  tests can call it without a browser. */
export function snowOverride(search = '') {
  try {
    const params = new URLSearchParams(String(search || ''));
    const v = params.get('snow');
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return undefined;
}

/** The override as read from the live page URL (undefined when
 *  there is no browser, e.g. node tests). */
export function snowOverrideFromWindow() {
  try {
    if (typeof window === 'undefined' || !window?.location) return undefined;
    return snowOverride(window.location.search || '');
  } catch {
    return undefined;
  }
}

/** Whether a room is outdoors for snow. This is the scene's
 *  shared outdoor detection (outdoorRoomDetection.js — the same
 *  keyword approach AutoLayout's pickTheme uses, so a new park
 *  is covered automatically), PLUS 'plaza': Downtown Plaza is
 *  genuinely outdoors, but 'plaza' is not in the shared keyword
 *  list, and widening that list would also change the day/night
 *  grade and the Halloween outdoor treatment. Snowfall carries
 *  its own one-word addition instead of touching those. */
export function isSnowOutdoor(roomId = '', roomName = '', amenityTag = '', shopTag = '') {
  if (isOutdoorLocation(roomId, roomName, amenityTag, shopTag)) return true;
  const text = [roomId, roomName, amenityTag, shopTag]
    .map((v) => String(v || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim())
    .join(' ');
  return ` ${text} `.includes(' plaza ');
}

/** The full gate: the `?snow=` override wins when present;
 *  otherwise snow needs an outdoor room in November or December. */
export function shouldSnow({ outdoor = false, date = new Date(), override } = {}) {
  if (override === true) return true;
  if (override === false) return false;
  return Boolean(outdoor) && isSnowMonth(date);
}

export class SnowfallMode {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.flakes = [];
    this.elapsed = 0;
  }

  start() {
    const outdoor = isSnowOutdoor(
      this.scene.roomId, this.scene.roomName, this.scene.amenityTag, this.scene.shopTag,
    );
    if (!shouldSnow({ outdoor, override: snowOverrideFromWindow() })) return;
    this.active = true;
    this.elapsed = 0;
    if (!this._ensureTexture()) { this.active = false; return; }
    const view = this._view();
    for (let i = 0; i < SNOWFLAKE_COUNT; i++) {
      this.flakes.push(this._spawnFlake(view, false));
    }
  }

  _view() {
    try {
      const v = this.scene.cameras?.main?.worldView;
      if (v && Number.isFinite(v.width) && v.width > 80 && Number.isFinite(v.height) && v.height > 80) {
        return { x: v.x, y: v.y, w: v.width, h: v.height };
      }
    } catch {}
    try {
      const b = this.scene.roomLayout?.getBoundaryBounds?.();
      if (b && b.w > 80 && b.h > 80) return b;
    } catch {}
    const layout = this.scene.layout;
    return { x: 0, y: 0, w: layout?.width || 1600, h: layout?.height || 900 };
  }

  _ensureTexture() {
    // One soft white dot, drawn once and shared by all flakes —
    // the same canvas-texture trick DayNightMode uses for lamp
    // glows. No new image file.
    try {
      if (this.scene.textures?.exists('sq-snowflake')) return true;
      const size = 32;
      const canvas = this.scene.textures.createCanvas('sq-snowflake', size, size);
      if (!canvas) return false;
      const ctx = canvas.getContext();
      const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      canvas.refresh();
      return true;
    } catch { return false; }
  }

  _rand(min, max) {
    return min + Math.random() * (max - min);
  }

  // A flake: a soft dot with its own fall speed, sway, size and
  // alpha, and a base x it sways around. `atTop` respawns it
  // just above the view (used when one falls out); otherwise it
  // starts scattered through the view so the first frame already
  // has snow in it.
  _spawnFlake(view, atTop) {
    const size = this._rand(SNOWFLAKE_SIZE_MIN, SNOWFLAKE_SIZE_MAX);
    const flake = {
      baseX: view.x + Math.random() * view.w,
      speed: this._rand(SNOW_FALL_SPEED_MIN, SNOW_FALL_SPEED_MAX),
      swaySpeed: this._rand(SNOW_SWAY_SPEED_MIN, SNOW_SWAY_SPEED_MAX),
      phase: Math.random() * Math.PI * 2,
      size,
      img: null,
    };
    try {
      const img = this.scene.add.image(flake.baseX, atTop ? view.y - 10 : view.y + Math.random() * view.h, 'sq-snowflake');
      img.setDisplaySize(size, size);
      img.setAlpha(this._rand(SNOW_ALPHA_MIN, SNOW_ALPHA_MAX));
      img.setDepth(DEPTH.OVERHEAD + SNOW_DEPTH_OFFSET);
      flake.img = img;
    } catch {}
    return flake;
  }

  update(delta) {
    if (!this.active) return;
    // Clamp the frame step: after a hidden tab resumes, one huge
    // delta must not teleport the flakes.
    const dt = Math.min(Math.max(Number(delta) || 16, 0), 100) / 1000;
    this.elapsed += dt;
    const view = this._view();
    for (const flake of this.flakes) {
      if (!flake.img) continue;
      const y = flake.img.y + flake.speed * dt;
      const x = flake.baseX + Math.sin(this.elapsed * Math.PI * 2 * flake.swaySpeed + flake.phase) * SNOW_SWAY_PX;
      flake.img.setPosition(x, y);
      // Out of the view (fell below it, or the camera walked
      // away from it) → back to the top, inside the view.
      if (y > view.y + view.h + 12 || x < view.x - 24 || x > view.x + view.w + 24) {
        this._respawnFlake(flake, view);
      }
    }
  }

  _respawnFlake(flake, view) {
    try { flake.img?.destroy(); } catch {}
    const next = this._spawnFlake(view, true);
    flake.baseX = next.baseX;
    flake.speed = next.speed;
    flake.swaySpeed = next.swaySpeed;
    flake.phase = next.phase;
    flake.size = next.size;
    flake.img = next.img;
  }

  destroy() {
    this.active = false;
    for (const flake of this.flakes) {
      try { flake.img?.destroy(); } catch {}
    }
    this.flakes = [];
  }
}
