// HalloweenMode.js — seasonal ambient effects: pumpkins, bats, spooky tint.
// Active during October (or forced via window.__sqHalloween = true).

import { DEPTH } from './depth.js';

export function isHalloweenSeason(date = new Date()) {
  if (typeof window !== 'undefined' && window.__sqHalloween === true) return true;
  if (typeof window !== 'undefined' && window.__sqHalloween === false) return false;
  return date.getMonth() === 9; // October (0-indexed)
}

export class HalloweenMode {
  constructor(scene) {
    this.scene = scene;
    this.pumpkins = [];
    this.batTimer = 0;
    this.active = false;
  }

  start() {
    if (!isHalloweenSeason()) return;
    this.active = true;
    this._addTint();
    this._placePumpkins();
    this.batTimer = 3000 + Math.random() * 4000;
  }

  _addTint() {
    try {
      const { width, height } = this.scene.cameras.main;
      // Warm orange wash, very subtle — fixed to camera so it covers the view.
      const tint = this.scene.add.rectangle(0, 0, width * 2, height * 2, 0xff6b1a, 0.07);
      tint.setScrollFactor(0);
      tint.setDepth(DEPTH.OVERHEAD + 100);
      tint.setOrigin(0.5);
      this.tint = tint;
    } catch {}
  }

  _placePumpkins() {
    try {
      const layout = this.scene.layout;
      const W = layout?.width || 1600;
      const H = layout?.height || 900;
      // Deterministic spots: corners and near the entrance-ish area.
      const spots = [
        { x: W * 0.08, y: H * 0.85 },
        { x: W * 0.92, y: H * 0.82 },
        { x: W * 0.5, y: H * 0.08 },
      ];
      for (const s of spots) {
        const p = this.scene.add.text(s.x, s.y, '🎃', { fontSize: '44px' });
        p.setOrigin(0.5, 1);
        p.setDepth(DEPTH.ACTOR_MIN + Math.round(s.y));
        // Gentle flicker glow.
        this.scene.tweens.add({
          targets: p, alpha: 0.75, duration: 900 + Math.random() * 600,
          yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        this.pumpkins.push(p);
      }
    } catch {}
  }

  _spawnBat() {
    try {
      const cam = this.scene.cameras.main;
      const viewW = cam.width / cam.zoom;
      const viewH = cam.height / cam.zoom;
      const cx = cam.scrollX + viewW / 2;
      const cy = cam.scrollY + viewH / 2;
      const fromLeft = Math.random() < 0.5;
      const startX = fromLeft ? cx - viewW / 2 - 60 : cx + viewW / 2 + 60;
      const endX = fromLeft ? cx + viewW / 2 + 60 : cx - viewW / 2 - 60;
      const y = cy - viewH * 0.3 + (Math.random() - 0.5) * viewH * 0.2;
      const bat = this.scene.add.text(startX, y, '🦇', { fontSize: '30px' });
      bat.setDepth(DEPTH.OVERHEAD + 50);
      if (!fromLeft) bat.setFlipX(true);
      const dur = 6000 + Math.random() * 4000;
      const scene = this.scene;
      scene.tweens.add({
        targets: bat, x: endX, duration: dur, ease: 'Linear',
        onUpdate: () => {
          // Sine-wave flutter.
          bat.y = y + Math.sin(scene.time.now / 180) * 24;
        },
        onComplete: () => bat.destroy(),
      });
    } catch {}
  }

  update(delta) {
    if (!this.active) return;
    this.batTimer -= delta;
    if (this.batTimer <= 0) {
      this._spawnBat();
      this.batTimer = 8000 + Math.random() * 7000;
    }
  }

  destroy() {
    this.active = false;
    for (const p of this.pumpkins) { try { p.destroy(); } catch {} }
    this.pumpkins = [];
    try { this.tint?.destroy(); } catch {}
    this.tint = null;
  }
}
