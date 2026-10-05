// HalloweenMode.js — subtle seasonal touches: pumpkins, webs, a drifting ghost,
// and bats (outdoor locations only). Active during October.

import { DEPTH } from './depth.js';

export function isHalloweenSeason(date = new Date()) {
  if (typeof window !== 'undefined' && window.__sqHalloween === true) return true;
  if (typeof window !== 'undefined' && window.__sqHalloween === false) return false;
  return date.getMonth() === 9; // October (0-indexed)
}

export class HalloweenMode {
  constructor(scene) {
    this.scene = scene;
    this.decor = [];
    this.batTimer = 0;
    this.ghostTimer = 0;
    this.active = false;
  }

  start() {
    if (!isHalloweenSeason()) return;
    this.active = true;
    this._placePumpkins();
    this._placeWebs();
    this.batTimer = 5000 + Math.random() * 5000;
    this.ghostTimer = 20000 + Math.random() * 15000;
  }

  _roomSize() {
    const layout = this.scene.layout;
    return { W: layout?.width || 1600, H: layout?.height || 900 };
  }

  _placePumpkins() {
    try {
      const { W, H } = this._roomSize();
      const spots = [
        { x: W * 0.08, y: H * 0.85 },
        { x: W * 0.92, y: H * 0.82 },
      ];
      for (const s of spots) {
        const p = this.scene.add.text(s.x, s.y, '🎃', { fontSize: '40px' });
        p.setOrigin(0.5, 1);
        p.setDepth(DEPTH.ACTOR_MIN + Math.round(s.y));
        this.scene.tweens.add({
          targets: p, alpha: 0.7, duration: 900 + Math.random() * 600,
          yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        this.decor.push(p);
      }
    } catch {}
  }

  _placeWebs() {
    try {
      const { W, H } = this._roomSize();
      // Spider webs tucked in upper corners.
      const spots = [
        { x: W * 0.03, y: H * 0.04 },
        { x: W * 0.97, y: H * 0.06 },
      ];
      for (const s of spots) {
        const w = this.scene.add.text(s.x, s.y, '🕸️', { fontSize: '36px' });
        w.setOrigin(0.5, 0);
        w.setDepth(DEPTH.OVERHEAD);
        w.setAlpha(0.8);
        this.decor.push(w);
      }
    } catch {}
  }

  _spawnBat() {
    // Bats only outdoors (parks).
    if (!this.scene.isOutdoorLocation) return;
    try {
      const cam = this.scene.cameras.main;
      const viewW = cam.width / cam.zoom;
      const viewH = cam.height / cam.zoom;
      const cx = cam.scrollX + viewW / 2;
      const cy = cam.scrollY + viewH / 2;
      const fromLeft = Math.random() < 0.5;
      const startX = fromLeft ? cx - viewW / 2 - 60 : cx + viewW / 2 + 60;
      const endX = fromLeft ? cx + viewW / 2 + 60 : cx - viewW / 2 - 60;
      const y = cy - viewH * 0.32 + (Math.random() - 0.5) * viewH * 0.2;
      const bat = this.scene.add.text(startX, y, '🦇', { fontSize: '28px' });
      bat.setDepth(DEPTH.OVERHEAD + 50);
      bat.setAlpha(0.9);
      if (!fromLeft) bat.setFlipX(true);
      const dur = 7000 + Math.random() * 4000;
      const scene = this.scene;
      scene.tweens.add({
        targets: bat, x: endX, duration: dur, ease: 'Linear',
        onUpdate: () => { bat.y = y + Math.sin(scene.time.now / 180) * 24; },
        onComplete: () => bat.destroy(),
      });
    } catch {}
  }

  _spawnGhost() {
    try {
      const cam = this.scene.cameras.main;
      const viewW = cam.width / cam.zoom;
      const viewH = cam.height / cam.zoom;
      const cx = cam.scrollX + viewW / 2;
      const cy = cam.scrollY + viewH / 2;
      const fromLeft = Math.random() < 0.5;
      const startX = fromLeft ? cx - viewW / 2 - 80 : cx + viewW / 2 + 80;
      const endX = fromLeft ? cx + viewW / 2 + 80 : cx - viewW / 2 - 80;
      const y = cy + (Math.random() - 0.5) * viewH * 0.3;
      const ghost = this.scene.add.text(startX, y, '👻', { fontSize: '34px' });
      ghost.setDepth(DEPTH.OVERHEAD + 40);
      ghost.setAlpha(0);
      const scene = this.scene;
      scene.tweens.add({
        targets: ghost, alpha: 0.55, duration: 2500, yoyo: true, hold: 4000,
        ease: 'Sine.easeInOut',
      });
      scene.tweens.add({
        targets: ghost, x: endX, duration: 12000, ease: 'Linear',
        onUpdate: () => { ghost.y = y + Math.sin(scene.time.now / 400) * 18; },
        onComplete: () => ghost.destroy(),
      });
    } catch {}
  }

  update(delta) {
    if (!this.active) return;
    this.batTimer -= delta;
    if (this.batTimer <= 0) {
      this._spawnBat();
      this.batTimer = 12000 + Math.random() * 10000; // sparse — a few bats, not a swarm
    }
    this.ghostTimer -= delta;
    if (this.ghostTimer <= 0) {
      this._spawnGhost();
      this.ghostTimer = 45000 + Math.random() * 30000; // rare treat
    }
  }

  destroy() {
    this.active = false;
    for (const d of this.decor) { try { d.destroy(); } catch {} }
    this.decor = [];
  }
}
