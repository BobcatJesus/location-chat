// TemperatureSystem.js — the in-room side of the Temperature
// System v1 (`sq-temperature-v1`).
//
// Owned by VillageScene, same shape as DecorSystem /
// SantaHatSystem: constructed in create(), updated every frame,
// destroyed in shutdown(). The pure logic (seasons, 30-minute
// drinks, once-per-spell toast) lives in temperature.js; this
// class owns only the Phaser bits:
//
//   - the TOAST: when a cold/warm spell starts, the scene's
//     onSystemNotice shows "You're cold, get a warm drink" /
//     "You're warm, get a cold drink" (once per spell — see
//     refreshTemperature).
//   - the SHIVER: while cold, the local avatar shakes a few
//     pixels side to side, and a 🥶 marker rides above the head
//     (v1.1: the v1 shake was ±3px and invisible — the camera
//     follows the avatar, so it cancelled most of it out. The
//     marker is the part you can actually see.) Applied AFTER
//     player.sync() (the scene re-positions the avatar every
//     frame), so the offset survives one frame at a time and
//     self-corrects the moment the player warms up.
//   - the SWEAT: while warm, a 💧 drop rides above the local
//     avatar (same scene-level-text pattern as the cafe cup /
//     the cat's hungry bubble).
//
// No speed change, no penalty — cold and warm are a nudge, not
// a punishment. Temperature is per-player and client-side:
// this system only ever touches the LOCAL avatar, so other
// players never see you shiver or sweat.

import { DEPTH } from './depth.js';
import {
  TEMP_MARKER_V1,
  exposureFor,
  refreshTemperature,
  applyDrink,
  loadTemperatureState,
  saveTemperatureState,
} from './temperature.js';

// How often the state machine ticks (toast decisions only — the
// visuals run every frame). One second is plenty: a toast a
// second late is invisible, and the 30-minute timers do not
// need finer grain.
const TEMP_TICK_MS = 1000;

// The shiver: ±6px at ~9Hz — a visible tremble, not an
// earthquake. (v1 was ±3px and invisible on the live site: the
// camera follows the avatar, so it cancelled most of the wobble
// out. v1.1 doubles it and adds the 🥶 marker above the head.)
// The sweat drop bobs gently above the head.
const SHIVER_AMPLITUDE_PX = 6;
const SHIVER_PERIOD_MS = 110;
const SWEAT_OFFSET_X = 14;
const SWEAT_OFFSET_Y = 72;
// sq-temperature-v1.1 — the cold marker rides in the same spot
// as the sweat drop (they never show at the same time: cold and
// warm are exclusive), so it reuses the same offsets.
const COLD_OFFSET_X = 14;
const COLD_OFFSET_Y = 72;

export class TemperatureSystem {
  constructor(scene) {
    this.scene = scene;
    // sq-temperature-v1 — marker for the v1 landing check.
    this.marker = TEMP_MARKER_V1;
    // The drink timers survive a refresh (localStorage) — the
    // notified spell does not (see temperature.js).
    this.state = loadTemperatureState();
    this._lastCheckMs = 0;
    this._sweat = null; // Phaser text, created lazily
    this._cold = null; // Phaser text (🥶), created lazily — v1.1
  }

  get enabled() {
    return Boolean(this.scene?.player?.avatar);
  }

  /** (Re)build the visuals and run one immediate tick, so the
   *  notification shows on entering the app instead of a second
   *  later. */
  refresh() {
    this._ensureVisuals();
    this._tick(Date.now());
  }

  /** A warm drink was taken (hot cocoa, coffee). Only warms in
   *  the cold season — the pure module decides; a wrong-season
   *  drink is just a drink. Returns whether it applied. */
  drinkWarm() {
    const res = applyDrink(this.state, { kind: 'warm', now: Date.now() });
    this.state = res.state;
    if (res.applied) {
      saveTemperatureState(this.state);
      this._tick(Date.now());
    }
    return res.applied;
  }

  /** A cold drink was taken (beer, iced coffee). Only cools in
   *  the warm season. Returns whether it applied. */
  drinkCool() {
    const res = applyDrink(this.state, { kind: 'cool', now: Date.now() });
    this.state = res.state;
    if (res.applied) {
      saveTemperatureState(this.state);
      this._tick(Date.now());
    }
    return res.applied;
  }

  /** One state tick: refresh the state machine and toast when a
   *  new spell starts. */
  _tick(now) {
    const res = refreshTemperature(this.state, { now });
    this.state = res.state;
    if (res.toast) {
      try { this.scene?.onSystemNotice?.(res.toast); } catch {}
    }
  }

  update() {
    if (!this.enabled) return;
    // Belt and braces: refresh() normally builds the markers in
    // create(), but update() must not silently do nothing if it
    // runs first — the markers are created lazily and cheaply
    // guarded once they exist.
    this._ensureVisuals();
    const now = Date.now();
    if (now - (this._lastCheckMs || 0) >= TEMP_TICK_MS) {
      this._lastCheckMs = now;
      this._tick(now);
    }
    this._applyVisuals(now);
  }

  _ensureVisuals() {
    if (this._sweat && this._cold) return;
    try {
      if (!this._sweat) {
        this._sweat = this.scene.add.text(0, 0, '💧', { fontSize: '18px' })
          .setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);
      }
      if (!this._cold) {
        this._cold = this.scene.add.text(0, 0, '🥶', { fontSize: '18px' })
          .setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);
      }
    } catch {
      // A failed creation leaves that marker null; the setters
      // tolerate null, so the other marker still works.
    }
  }

  /** The per-frame visuals: shiver the avatar while cold, ride
   *  the sweat drop while warm, hide everything when
   *  comfortable. Runs after player.sync() (the scene update
   *  calls the systems after moving the player), so the shiver
   *  offset is applied on top of the synced position. */
  _applyVisuals(now) {
    const player = this.scene?.player;
    const avatar = player?.avatar;
    if (!avatar) return;
    const exposure = exposureFor(this.state, { now });
    if (exposure === 'cold') {
      // Small fast shake around the synced position, plus the 🥶
      // marker above the head (v1.1 — the shake alone was
      // invisible live).
      try {
        avatar.x = player.gx + Math.round(Math.sin(now / SHIVER_PERIOD_MS) * SHIVER_AMPLITUDE_PX);
      } catch {}
      this._setCold(true, now);
      this._setSweat(false, now);
    } else if (exposure === 'warm') {
      this._setCold(false, now);
      this._setSweat(true, now);
    } else {
      this._setCold(false, now);
      this._setSweat(false, now);
    }
  }

  /** The 🥶 marker above the head while cold (v1.1). Same shape
   *  as _setSweat: rides above the avatar with a gentle bob, and
   *  hides the moment a warm drink takes effect. */
  _setCold(show, now) {
    if (!this._cold) return;
    try {
      if (!show) {
        this._cold.setAlpha(0);
        return;
      }
      const player = this.scene?.player;
      if (!player) { this._cold.setAlpha(0); return; }
      const bob = Math.round(Math.sin(now / 300) * 2);
      this._cold
        .setPosition(player.gx + COLD_OFFSET_X, player.gy - COLD_OFFSET_Y + bob)
        .setAlpha(1);
    } catch {}
  }

  _setSweat(show, now) {
    if (!this._sweat) return;
    try {
      if (!show) {
        this._sweat.setAlpha(0);
        return;
      }
      const player = this.scene?.player;
      if (!player) { this._sweat.setAlpha(0); return; }
      const bob = Math.round(Math.sin(now / 300) * 2);
      this._sweat
        .setPosition(player.gx + SWEAT_OFFSET_X, player.gy - SWEAT_OFFSET_Y + bob)
        .setAlpha(1);
    } catch {}
  }

  destroy() {
    try { this._sweat?.destroy(); } catch {}
    try { this._cold?.destroy(); } catch {}
    this._sweat = null;
    this._cold = null;
    this.scene = null;
  }
}
