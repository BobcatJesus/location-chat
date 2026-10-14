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
    this.ghostTimer = 10000 + Math.random() * 8000;
    // Walking into an outdoor place (Shepherd Park and friends) kicks up
    // the colony: a swarm crosses the sky shortly after you arrive.
    if (this.scene.isOutdoorLocation) {
      this.scene.time.delayedCall(700, () => {
        if (this.active) this._spawnMistSwarm();
      });
    }
  }

  _roomSize() {
    const layout = this.scene.layout;
    return { W: layout?.width || 1600, H: layout?.height || 900 };
  }

  _placePumpkins() {
    try {
      const { W, H } = this._roomSize();
      // Twice as many pumpkins as the original two.
      const spots = [
        { x: W * 0.08, y: H * 0.85 },
        { x: W * 0.92, y: H * 0.82 },
        { x: W * 0.30, y: H * 0.90 },
        { x: W * 0.66, y: H * 0.88 },
      ];
      // His jack-o'-lantern art, noticeably bigger than the old 40px emoji
      // (the visible pumpkin grows by about half) while staying well under
      // avatar height (64-76 world units). Emoji stays as a fallback.
      const PUMPKIN_SIZE = 48;
      const useArt = this.scene.textures?.exists('sq-jackolantern');
      for (const s of spots) {
        const p = useArt
          ? this.scene.add.image(s.x, s.y, 'sq-jackolantern')
          : this.scene.add.text(s.x, s.y, '🎃', { fontSize: '40px' });
        if (useArt) p.setDisplaySize(PUMPKIN_SIZE, PUMPKIN_SIZE);
        p.setOrigin(0.5, 1);
        p.setDepth(DEPTH.ACTOR_MIN + Math.round(s.y));
        this.scene.tweens.add({
          targets: p, alpha: 0.8, duration: 900 + Math.random() * 600,
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

  _spawnMistSwarm() {
    // His mist artwork IS the swarm: a bank of bat-filled fog that crosses
    // the sky when you arrive somewhere outdoors. Same crossing movement
    // the old emoji swarm had — his art instead of emoji.
    if (!this.scene.isOutdoorLocation) return;
    if (!this.scene.textures?.exists('sq-batmist')) return;
    try {
      const cam = this.scene.cameras.main;
      const viewW = cam.width / cam.zoom;
      const viewH = cam.height / cam.zoom;
      const cx = cam.scrollX + viewW / 2;
      const cy = cam.scrollY + viewH / 2;
      const fromLeft = Math.random() < 0.5;
      const dispW = viewW * 1.25;
      const dispH = dispW * (683 / 1024);
      const startX = fromLeft ? cx - viewW / 2 - dispW / 2 : cx + viewW / 2 + dispW / 2;
      const endX = fromLeft ? cx + viewW / 2 + dispW / 2 : cx - viewW / 2 - dispW / 2;
      const baseY = cy - viewH * 0.08;
      const mist = this.scene.add.image(startX, baseY, 'sq-batmist');
      mist.setDisplaySize(dispW, dispH);
      mist.setDepth(DEPTH.OVERHEAD + 50);
      if (!fromLeft) mist.setFlipX(true);
      mist.setAlpha(0);
      const scene = this.scene;
      scene.tweens.add({
        targets: mist, alpha: 0.9, duration: 2200, yoyo: true, hold: 6400,
        ease: 'Sine.easeInOut',
      });
      scene.tweens.add({
        targets: mist, x: endX, duration: 11000, ease: 'Linear',
        onUpdate: () => { mist.y = baseY + Math.sin(scene.time.now / 600) * 10; },
        onComplete: () => mist.destroy(),
      });
    } catch {}
  }

  _spawnBat(opts = {}) {
    // Bats only outdoors (parks).
    if (!this.scene.isOutdoorLocation) return;
    try {
      const cam = this.scene.cameras.main;
      const viewW = cam.width / cam.zoom;
      const viewH = cam.height / cam.zoom;
      const cx = cam.scrollX + viewW / 2;
      const cy = cam.scrollY + viewH / 2;
      const fromLeft = opts.fromLeft ?? Math.random() < 0.5;
      const startX = fromLeft ? cx - viewW / 2 - 60 : cx + viewW / 2 + 60;
      const endX = fromLeft ? cx + viewW / 2 + 60 : cx - viewW / 2 - 60;
      const yBand = opts.yBand ?? 0.32;
      const y = cy - viewH * yBand + (Math.random() - 0.5) * viewH * 0.2;
      const bat = this.scene.add.text(startX, y, '🦇', { fontSize: `${Math.round(opts.fontSize ?? 28)}px` });
      bat.setDepth(DEPTH.OVERHEAD + 50);
      bat.setAlpha(0.9);
      if (!fromLeft) bat.setFlipX(true);
      const dur = opts.duration ?? 7000 + Math.random() * 4000;
      const wobble = opts.wobble ?? 24;
      const scene = this.scene;
      scene.tweens.add({
        targets: bat, x: endX, duration: dur, ease: 'Linear',
        onUpdate: () => { bat.y = y + Math.sin(scene.time.now / 180) * wobble; },
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
      // His ghost art when it's loaded; the emoji is the fallback.
      const useArt = this.scene.textures?.exists('sq-ghost');
      const ghost = useArt
        ? this.scene.add.image(startX, y, 'sq-ghost')
        : this.scene.add.text(startX, y, '👻', { fontSize: '34px' });
      if (useArt) ghost.setDisplaySize(56, 56);
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
      this.ghostTimer = 22000 + Math.random() * 15000; // about twice as often as the original rare treat
    }
  }

  destroy() {
    this.active = false;
    for (const d of this.decor) { try { d.destroy(); } catch {} }
    this.decor = [];
  }
}
