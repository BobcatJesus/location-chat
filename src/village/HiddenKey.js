// HiddenKey.js — the Golden Key (quest hidden object, Agora only).
//
// A small glowing key appears at a random walkable spot in Agora while
// the Golden Key quest is the active quest. Walk up and press E to pick
// it up. Code-drawn (emoji + glow circle + pulse), no new art assets.
// A new spot is picked every time you enter the room, so it stays
// hidden — and it only spawns once the quest is active, so collecting
// it early (while Cat Cuddles is still the Agora quest) can't eat it.
//
// Owned by VillageScene: constructed in create(), refreshed on floor
// switches, ticked in update() (it re-spawns itself when the quest
// becomes active mid-visit, e.g. right after Cat Cuddles completes),
// destroyed in shutdown(). Agora only (roomId === 'agora-houston').

import { DEPTH } from './depth.js';

const AGORA_ROOM_ID = 'agora-houston';
const QUEST_ID = 'golden-key';
const COLLECT_RANGE = 80; // px from the key the player must be within
const RESPAWN_CHECK_MS = 1000; // how often update() looks for the quest

export class HiddenKey {
  constructor(scene) {
    this.scene = scene;
    this.key = null; // Phaser text (the 🗝️)
    this.glow = null; // Phaser circle behind it
    this.tween = null;
    this.x = 0;
    this.y = 0;
    this._lastCheckMs = 0;
  }

  get enabled() {
    return this.scene?.roomId === AGORA_ROOM_ID;
  }

  /** True only while the Golden Key quest is the one being tracked. */
  get questActive() {
    return this.scene?.questManager?.activeQuest?.id === QUEST_ID;
  }

  /** Spawn the key (if the quest is active and no key is out). */
  refresh() {
    this._clear();
    if (!this.enabled || !this.questActive) return;
    const p = this._randomPoint();
    this.x = p.x;
    this.y = p.y;
    try {
      const scene = this.scene;
      this.glow = scene.add.circle(p.x, p.y, 26, 0xfbbf24, 0.25);
      this.glow.setDepth(DEPTH.ACTOR_MIN + Math.round(p.y));
      this.key = scene.add.text(p.x, p.y, '🗝️', { fontSize: '30px' });
      this.key.setOrigin(0.5, 0.5);
      this.key.setDepth(DEPTH.ACTOR_MIN + Math.round(p.y) + 1);
      // Gentle pulse so a sharp-eyed player can spot the glint.
      this.tween = scene.tweens.add({
        targets: [this.key, this.glow],
        scale: 1.18,
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } catch {
      this._clear();
    }
  }

  /** The quest can become active mid-visit (Cat Cuddles just finished)
   *  — update() notices within a second and spawns the key. */
  update() {
    const now = Date.now();
    if (now - (this._lastCheckMs || 0) < RESPAWN_CHECK_MS) return;
    this._lastCheckMs = now;
    if (!this.key && this.enabled && this.questActive) this.refresh();
  }

  /** Is the player close enough to grab it? (VillageScene E-key.) */
  nearestKey(px, py) {
    if (!this.key || !this.key.active) return null;
    return Math.hypot(px - this.x, py - this.y) <= COLLECT_RANGE
      ? { x: this.x, y: this.y }
      : null;
  }

  /** Pick it up: sparkle, then gone. Never respawns once collected —
   *  the quest completes on this same press. */
  collect() {
    if (!this.key) return false;
    try {
      const sparkle = this.scene.add.text(this.x, this.y - 20, '✨', { fontSize: '26px' });
      sparkle.setOrigin(0.5, 0.5);
      sparkle.setDepth(DEPTH.ACTOR_MIN + 500);
      this.scene.tweens.add({
        targets: sparkle, y: this.y - 56, alpha: 0, duration: 800,
        ease: 'Quad.easeOut',
        onComplete: () => { try { sparkle.destroy(); } catch {} },
      });
    } catch {}
    this._clear();
    return true;
  }

  /** Random walkable point, same pattern as the cat's wander points. */
  _randomPoint() {
    const layout = this.scene?.roomLayout;
    let bounds = null;
    try {
      bounds = layout?.getBoundaryBounds?.();
    } catch {}
    if (!bounds || !Number.isFinite(bounds.w) || bounds.w <= 100) {
      bounds = { x: 200, y: 200, w: 1200, h: 500 };
    }
    for (let i = 0; i < 8; i++) {
      const x = bounds.x + 40 + Math.random() * Math.max(40, bounds.w - 80);
      const y = bounds.y + 40 + Math.random() * Math.max(40, bounds.h - 80);
      const p = layout?.clampPointToRoom ? layout.clampPointToRoom(x, y, 30) : { x, y };
      if (layout?.collidesWithSolid && layout.collidesWithSolid(p.x, p.y, 18)) continue;
      return p;
    }
    return layout?.clampPointToRoom
      ? layout.clampPointToRoom(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, 30)
      : { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  }

  _clear() {
    try { this.tween?.stop(); } catch {}
    this.tween = null;
    try { this.key?.destroy(); } catch {}
    this.key = null;
    try { this.glow?.destroy(); } catch {}
    this.glow = null;
  }

  destroy() {
    this._clear();
    this.scene = null;
  }
}
