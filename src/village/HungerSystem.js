// HungerSystem.js — the in-room side of the Hunger System v1
// (`sq-hunger-v1`).
//
// Owned by VillageScene, same shape as TemperatureSystem:
// constructed in create(), updated every frame, destroyed in
// shutdown(). The pure logic (8-hour fullness, 3 bites to full,
// once-per-spell toast, the 1-minute queasy gag) lives in
// hunger.js; this class owns only the Phaser bits:
//
//   - the TOAST: when a hunger spell starts, the scene's
//     onSystemNotice shows "you're hungry..." (once per spell —
//     see refreshHunger).
//   - the BUBBLE: while hungry, a small "hungry..." bubble rides
//     above the local avatar — the same words and the same white
//     pill styling as the cafe cat's hunger bubble (CafeCat).
//   - the QUEASY: after a bite of trash food, a 🤢 marker rides
//     beside the bubble for about a minute, then clears on its
//     own. Cosmetic only — no effect, no cure.
//
// The bite itself is applied here (eatBite), NOT toasted through
// onSystemNotice: the scene toast sits UNDER the open pocket
// (zIndex 1002 vs 1100), so the bite result ("Still hungry...
// eat more." / "😋 Ahhh... full for most of the day." / the
// queasy line) is returned as `notice` and the pocket panel shows
// it in its own notice line. The hunger-spell toast above DOES go
// through onSystemNotice — the pocket is normally closed when a
// spell starts.
//
// No penalty — hungry is a nudge, not a punishment. Hunger is
// per-player and client-side: this system only ever touches the
// LOCAL avatar, so other players never see your bubble.

import { DEPTH } from './depth.js';
import {
  HUNGER_MARKER_V1,
  STILL_HUNGRY_TOAST,
  FULL_TOAST,
  ALREADY_FULL_TOAST,
  QUEASY_TOAST,
  QUEASY_MS,
  HUNGER_BUBBLE_TEXT,
  isHungry,
  refreshHunger,
  takeBite,
  loadHungerState,
  saveHungerState,
} from './hunger.js';

// How often the state machine ticks (toast decisions only — the
// visuals run every frame). One second is plenty: a toast a
// second late is invisible, and the 8-hour timer does not need
// finer grain.
const HUNGER_TICK_MS = 1000;

// The bubble rides above the head (same spot as the temperature
// 🥶 / 💧 markers, gy - 72), centered on the avatar, with a
// gentle bob. The 🤢 sits to its right so both can show at once
// (a trash-food bite while still hungry shows both).
const BUBBLE_OFFSET_X = 0;
const BUBBLE_OFFSET_Y = 72;
const QUEASY_OFFSET_X = 44;
const QUEASY_OFFSET_Y = 72;

export class HungerSystem {
  constructor(scene) {
    this.scene = scene;
    // sq-hunger-v1 — marker for the v1 landing check.
    this.marker = HUNGER_MARKER_V1;
    // The fed timer + bite count survive a refresh (localStorage)
    // — the notified spell does not (see hunger.js). The queasy
    // timer is in-memory only: 1 minute, cosmetic.
    this.state = loadHungerState();
    this.queasyUntil = 0; // epoch ms until which the 🤢 shows
    this._lastCheckMs = 0;
    this._bubble = null; // Phaser text, created lazily
    this._queasy = null; // Phaser text (🤢), created lazily
  }

  get enabled() {
    return Boolean(this.scene?.player?.avatar);
  }

  /** Are you hungry right now? (The Eat path checks this BEFORE
   *  spending a charge — a refused bite costs nothing.) */
  isHungry(now = Date.now()) {
    return isHungry(this.state, { now });
  }

  /** (Re)build the visuals and run one immediate tick, so the
   *  notification shows on entering the app instead of a second
   *  later. */
  refresh() {
    this._ensureVisuals();
    this._tick(Date.now());
  }

  /** One bite of food landed (the caller already spent the
   *  charge — see ItemsSystem.eatItem). `wasTrashFood` is whether
   *  the bite came from trash food (litter / pond bits, not a
   *  bought bread). Returns { applied, full, bites, notice,
   *  reason? } — `notice` is the exact line the pocket panel
   *  shows for this bite. A bite that does not land (already
   *  full) applies nothing and sets no queasy timer. */
  eatBite(wasTrashFood) {
    const now = Date.now();
    const res = takeBite(this.state, { now });
    this.state = res.state;
    if (!res.applied) {
      return { ...res, notice: ALREADY_FULL_TOAST };
    }
    saveHungerState(this.state);
    // The queasy gag: trash food works fine as a bite, and it
    // also makes you queasy for about a minute — marker only,
    // no effect, no cure. (No _tick() here: the 1s update tick
    // owns the spell machine — a bite must not announce the
    // hunger spell it is in the middle of fixing. The next tick
    // clears notifiedSpell now that you are full, or leaves the
    // once-per-spell toast alone if you are still hungry.)
    if (wasTrashFood) this.queasyUntil = now + QUEASY_MS;
    const base = res.full ? FULL_TOAST : STILL_HUNGRY_TOAST;
    const notice = wasTrashFood ? `${base} ${QUEASY_TOAST}` : base;
    return { ...res, notice };
  }

  /** One state tick: refresh the state machine and toast when a
   *  new hunger spell starts. */
  _tick(now) {
    const res = refreshHunger(this.state, { now });
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
    if (now - (this._lastCheckMs || 0) >= HUNGER_TICK_MS) {
      this._lastCheckMs = now;
      this._tick(now);
    }
    this._applyVisuals(now);
  }

  _ensureVisuals() {
    if (this._bubble && this._queasy) return;
    try {
      if (!this._bubble) {
        // Same white-pill styling as the cafe cat's "hungry..."
        // bubble (CafeCat._showHungerBubble).
        this._bubble = this.scene.add.text(0, 0, HUNGER_BUBBLE_TEXT, {
          fontSize: '15px',
          color: '#7c2d12',
          backgroundColor: 'rgba(255,255,255,0.92)',
          padding: { x: 8, y: 4 },
        })
          .setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);
      }
      if (!this._queasy) {
        this._queasy = this.scene.add.text(0, 0, '🤢', { fontSize: '18px' })
          .setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);
      }
    } catch {
      // A failed creation leaves that marker null; the setters
      // tolerate null, so the other marker still works.
    }
  }

  /** The per-frame visuals: the "hungry..." bubble while hungry,
   *  the 🤢 while queasy (independent — a trash-food bite can
   *  leave you full AND queasy). Runs after player.sync() (the
   *  scene update calls the systems after moving the player). */
  _applyVisuals(now) {
    const player = this.scene?.player;
    const avatar = player?.avatar;
    if (!avatar) return;
    this._setBubble(isHungry(this.state, { now }), now);
    this._setQueasy(now < (this.queasyUntil || 0), now);
  }

  _setBubble(show, now) {
    if (!this._bubble) return;
    try {
      if (!show) {
        this._bubble.setAlpha(0);
        return;
      }
      const player = this.scene?.player;
      if (!player) { this._bubble.setAlpha(0); return; }
      const bob = Math.round(Math.sin(now / 300) * 2);
      this._bubble
        .setPosition(player.gx + BUBBLE_OFFSET_X, player.gy - BUBBLE_OFFSET_Y + bob)
        .setAlpha(1);
    } catch {}
  }

  _setQueasy(show, now) {
    if (!this._queasy) return;
    try {
      if (!show) {
        this._queasy.setAlpha(0);
        return;
      }
      const player = this.scene?.player;
      if (!player) { this._queasy.setAlpha(0); return; }
      const bob = Math.round(Math.sin(now / 300) * 2);
      this._queasy
        .setPosition(player.gx + QUEASY_OFFSET_X, player.gy - QUEASY_OFFSET_Y + bob)
        .setAlpha(1);
    } catch {}
  }

  destroy() {
    try { this._bubble?.destroy(); } catch {}
    try { this._queasy?.destroy(); } catch {}
    this._bubble = null;
    this._queasy = null;
    this.scene = null;
  }
}
