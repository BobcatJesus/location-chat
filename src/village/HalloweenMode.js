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
    // Pumpkin clicks are ALSO caught at scene level (distance check on
    // world coords — the same pattern the bartender's click-to-talk
    // uses). Per-object pointerdown proved unreliable indoors, where
    // pumpkins sat unresponsive while outdoor ones worked; the scene
    // handler receives every click the tap-to-move system sees.
    this._scenePointerDown = (pointer) => {
      if (!this.active) return;
      const wx = pointer?.worldX, wy = pointer?.worldY;
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
      // Phaser-native hit test first: immune to any coordinate math.
      try {
        const hits = this.scene.input.hitTestPointer(pointer) || [];
        const hitEntry = (this.pumpkins || []).find((e) => !e.lit && hits.includes(e.img));
        if (hitEntry) { this._onPumpkinClicked(hitEntry); return; }
      } catch {}
      for (const entry of this.pumpkins || []) {
        if (entry.lit) continue;
        // Pumpkin origin is bottom-center; aim at its body center.
        const cx = entry.img.x, cy = entry.img.y - 22;
        if (Math.hypot(wx - cx, wy - cy) <= 44) {
          this._onPumpkinClicked(entry);
          return;
        }
      }
    };
    try { this.scene.input.on('pointerdown', this._scenePointerDown); } catch {}
    // PRIMARY interaction — the game's house pattern (ducks, shelves,
    // jukebox): walk close and a prompt offers [E]. Clicks above stay
    // as a bonus, but proximity + E rides the most-tested loop in the
    // game and does not depend on canvas click routing at all.
    try {
      this.pumpkinPrompt = this.scene.add.text(0, 0, '🎃 Light the jack-o\'-lantern [E]', {
        fontSize: '15px',
        color: '#451a03',
        backgroundColor: 'rgba(255,237,213,0.92)',
        padding: { x: 8, y: 4 },
      }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);
      this.decor.push(this.pumpkinPrompt);
    } catch {}
    this._onPumpkinKey = (ev) => {
      if (!this.active) return;
      if ((ev.key || '').toLowerCase() !== 'e') return;
      const t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (this._nearPumpkin) this._onPumpkinClicked(this._nearPumpkin);
    };
    try { window.addEventListener('keydown', this._onPumpkinKey); } catch {}
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

  _roomBounds() {
    // The venue's actual built area (walls/floor), which can be much
    // smaller than the whole layout rectangle — decor belongs inside it.
    try {
      const b = this.scene.roomLayout?.getBoundaryBounds?.();
      if (b && b.w > 80 && b.h > 80) return b;
    } catch {}
    const { W, H } = this._roomSize();
    return { x: 0, y: 0, w: W, h: H };
  }

  _ensureGlowTexture() {
    // Soft radial halo drawn once on a canvas texture — the candlelight
    // pool that appears behind a pumpkin when somebody lights it.
    try {
      if (this.scene.textures?.exists('sq-pumpkin-glow')) return true;
      const size = 128;
      const canvas = this.scene.textures.createCanvas('sq-pumpkin-glow', size, size);
      if (!canvas) return false;
      const ctx = canvas.getContext();
      const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(255,170,60,0.85)');
      g.addColorStop(0.4, 'rgba(255,120,30,0.38)');
      g.addColorStop(1, 'rgba(255,100,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      canvas.refresh();
      return true;
    } catch { return false; }
  }

  _ensureDarkTexture() {
    // A pixel-darkened copy of the jack-o'-lantern art for the unlit
    // state. Drawn once on a canvas texture: the art with a deep
    // blue-grey wash laid only over its opaque pixels (source-atop),
    // twice for strength. Returns true when the texture is ready.
    try {
      if (this.scene.textures?.exists('sq-jackolantern-dark')) return true;
      if (!this.scene.textures?.exists('sq-jackolantern')) return false;
      const src = this.scene.textures.get('sq-jackolantern').getSourceImage();
      const w = src?.naturalWidth || src?.width || 96;
      const h = src?.naturalHeight || src?.height || 96;
      const canvas = this.scene.textures.createCanvas('sq-jackolantern-dark', w, h);
      if (!canvas) return false;
      const ctx = canvas.getContext();
      ctx.drawImage(src, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(28,32,48,0.85)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillRect(0, 0, w, h);
      canvas.refresh();
      return true;
    } catch { return false; }
  }

  _polyPoints() {
    // The room's boundary geometry, parsed TOLERANTLY: point lists
    // have lived under several keys ({points, vertices, path}) and in
    // several shapes ({x,y} objects or [x,y] arrays) across builds,
    // and a strict parser silently returning null is exactly how
    // earlier placement fixes failed on the user's clone. Returns
    // polygon points (rects become 4 corners), or null.
    try {
      const b = this.scene.roomLayout?.roomBoundary;
      if (!b) return null;
      const rawList = [b.points, b.vertices, b.path, b.polygon, b].find((v) => Array.isArray(v) && v.length >= 3);
      if (rawList) {
        const pts = rawList.map((p) => Array.isArray(p)
          ? { x: Number(p[0]), y: Number(p[1]) }
          : { x: Number(p?.x ?? p?.px), y: Number(p?.y ?? p?.py) });
        if (pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return pts;
      }
      if (Number.isFinite(b.x) && Number.isFinite(b.w) && Number.isFinite(b.h)) {
        return [
          { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
          { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
        ];
      }
    } catch {}
    return null;
  }

  _inPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  _edgeDist(x, y, pts) {
    let min = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const ax = pts[j].x, ay = pts[j].y, bx = pts[i].x, by = pts[i].y;
      const abx = bx - ax, aby = by - ay;
      const lenSq = abx * abx + aby * aby || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / lenSq));
      min = Math.min(min, Math.hypot(x - (ax + abx * t), y - (ay + aby * t)));
    }
    return min;
  }

  _snapIntoRoom(pt, placed) {
    // Venue boundaries are POLYGONS and the bounds rect is only their
    // bounding box — box fractions land outside the real floor on
    // angled rooms (Asgard: every pumpkin below the slanted front
    // edge). The inside test is an ORACLE LADDER, most-trusted first:
    //   1. the room layout's OWN isPointInsideRoom — whatever data
    //      format the running build uses, its own test agrees with
    //      its own rendering by construction;
    //   2. my own point-in-polygon on tolerantly parsed points;
    //   3. no oracle — accept the spot (older builds).
    // A spot that fails walks toward the room center until the
    // oracle accepts it; failing that, a spread of fallback spots
    // across the room's lower half is tried in order. Pumpkins keep
    // ~80px separation where the room allows it.
    const layout = this.scene.roomLayout;
    const pts = this._polyPoints();
    const inside = (x, y) => {
      try {
        if (typeof layout?.isPointInsideRoom === 'function') {
          return !!layout.isPointInsideRoom(x, y, 14);
        }
      } catch {}
      if (pts) return this._inPoly(x, y, pts) && this._edgeDist(x, y, pts) >= 14;
      return true;
    };
    const separated = (x, y, min) => !(placed || []).some((q) => Math.hypot(q.x - x, q.y - y) < min);
    if (inside(pt.x, pt.y) && separated(pt.x, pt.y, 80)) return pt;

    const b = this._roomBounds();
    const cx = pts ? pts.reduce((a, p) => a + p.x, 0) / pts.length : b.x + b.w / 2;
    const cy = pts ? pts.reduce((a, p) => a + p.y, 0) / pts.length : b.y + b.h / 2;

    // Walk the original spot toward the center until accepted.
    const distC = Math.hypot(cx - pt.x, cy - pt.y) || 1;
    for (let step = 8; step <= distC; step += 8) {
      const x = pt.x + ((cx - pt.x) * step) / distC;
      const y = pt.y + ((cy - pt.y) * step) / distC;
      if (inside(x, y) && separated(x, y, 80)) return { x, y };
    }
    // Fallback spread across the room's lower-middle area.
    const fractions = [
      [0.5, 0.82], [0.3, 0.78], [0.7, 0.78], [0.5, 0.66],
      [0.22, 0.68], [0.78, 0.68], [0.38, 0.58], [0.62, 0.58], [0.5, 0.5],
    ];
    for (const minSep of [80, 40, 0]) {
      for (const [fx, fy] of fractions) {
        const x = b.x + b.w * fx, y = b.y + b.h * fy;
        if (inside(x, y) && separated(x, y, minSep)) return { x, y };
      }
    }
    if (inside(cx, cy)) return { x: cx, y: cy };
    return pt;
  }

  _placePumpkins() {
    try {
      const b = this._roomBounds();
      // Twice as many pumpkins as the original two — spread across the
      // floor near the venue's bottom edge, then snapped INSIDE the
      // room's actual boundary polygon (see _snapIntoRoom).
      const rawSpots = [
        { x: b.x + b.w * 0.10, y: b.y + b.h * 0.88 },
        { x: b.x + b.w * 0.90, y: b.y + b.h * 0.85 },
        { x: b.x + b.w * 0.32, y: b.y + b.h * 0.93 },
        { x: b.x + b.w * 0.68, y: b.y + b.h * 0.91 },
      ];
      const placedPts = [];
      const spots = rawSpots.map((pt) => {
        const snapped = this._snapIntoRoom(pt, placedPts);
        placedPts.push(snapped);
        return snapped;
      });
      // Placement report as an in-game toast (DOM — always visible):
      // how the running build's own inside test judges each spot.
      try {
        const layout = this.scene.roomLayout;
        const flags = spots.map((s) => {
          try {
            if (typeof layout?.isPointInsideRoom === 'function') {
              return layout.isPointInsideRoom(s.x, s.y, 0) ? '✓' : '✗';
            }
          } catch {}
          return '?';
        });
        this.scene.onSystemNotice?.(`🎃 ${spots.length} pumpkins placed · inside check: ${flags.join(' ')}`);
      } catch {}

      // His jack-o'-lantern art, noticeably bigger than the old 40px emoji
      // (the visible pumpkin grows by about half) while staying well under
      // avatar height (64-76 world units). Emoji stays as a fallback.
      const PUMPKIN_SIZE = 48;
      const useArt = this.scene.textures?.exists('sq-jackolantern');
      const hasGlow = this._ensureGlowTexture();
      const hasDark = useArt && this._ensureDarkTexture();
      this.pumpkins = [];
      spots.forEach((s, index) => {
        const depth = DEPTH.ACTOR_MIN + Math.round(s.y);
        let glow = null;
        if (hasGlow) {
          glow = this.scene.add.image(s.x, s.y - PUMPKIN_SIZE * 0.45, 'sq-pumpkin-glow');
          glow.setDisplaySize(120, 120);
          glow.setDepth(depth - 1);
          glow.setAlpha(0);
          glow.setBlendMode('ADD');
          this.decor.push(glow);
        }
        const p = useArt
          ? this.scene.add.image(s.x, s.y, hasDark ? 'sq-jackolantern-dark' : 'sq-jackolantern')
          : this.scene.add.text(s.x, s.y, '🎃', { fontSize: '40px' });
        if (useArt) p.setDisplaySize(PUMPKIN_SIZE, PUMPKIN_SIZE);
        p.setOrigin(0.5, 1);
        p.setDepth(depth);
        // Unlit = the darkened-texture copy of the art (candle not lit
        // yet); sprite tint did not visibly render on these images in
        // this Phaser build, so the dark state is baked into pixels.
        // Lighting swaps back to the bright art and fades the halo in.
        // Clicking a pumpkin lights it, for everyone in the room
        // (server keeps the lit set).
        const entry = { index, img: p, glow, lit: false };
        p.setInteractive({ useHandCursor: true });
        p.on('pointerdown', () => this._onPumpkinClicked(entry));
        this.decor.push(p);
        this.pumpkins.push(entry);
      });
    } catch {}
  }

  _onPumpkinClicked(entry) {
    if (!entry || entry.lit) return;
    // Light it locally right away (snappy even on a slow connection);
    // the server broadcast re-applies it, which is a no-op by then.
    this.setPumpkinLit(entry.index);
    try {
      this.scene.socket?.emit('light_pumpkin', { roomId: this.scene.roomId, index: entry.index });
    } catch {}
  }

  setPumpkinLit(index) {
    const entry = (this.pumpkins || []).find((e) => e.index === index);
    if (!entry || entry.lit) return;
    entry.lit = true;
    const { img, glow } = entry;
    try {
      // Swap the darkened art for the original bright art.
      if (img.type === 'Image') img.setTexture('sq-jackolantern');
      // A little pop as the candle catches.
      const sx = img.scaleX, sy = img.scaleY;
      this.scene.tweens.add({
        targets: img, scaleX: sx * 1.15, scaleY: sy * 1.15,
        duration: 130, yoyo: true, ease: 'Sine.easeOut',
      });
      if (glow) {
        this.scene.tweens.add({ targets: glow, alpha: 0.85, duration: 350, ease: 'Sine.easeOut' });
        // Candle flicker: a fast shimmer over a slow breathing swell.
        this.scene.tweens.add({
          targets: glow, alpha: 0.62, duration: 110, delay: 380,
          yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        const gs = glow.scaleX;
        this.scene.tweens.add({
          targets: glow, scaleX: gs * 1.07, scaleY: gs * 1.07,
          duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      }
    } catch {}
  }

  applyPumpkinState(lit) {
    if (!Array.isArray(lit)) return;
    for (const idx of lit) this.setPumpkinLit(idx);
  }

  _placeWebs() {
    try {
      const b = this._roomBounds();
      // Spider webs tucked in the upper corners of the built area.
      const spots = [
        { x: b.x + b.w * 0.04, y: b.y + b.h * 0.03 },
        { x: b.x + b.w * 0.96, y: b.y + b.h * 0.05 },
      ];
      for (const raw of spots) {
        // Same polygon caveat as the pumpkins: clamp into the room.
        let s = raw;
        try { s = this.scene.roomLayout?.clampPointToRoom(raw.x, raw.y, 8) || raw; } catch {}
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
      // The colony rides with the bank: dark silhouettes in the same style
      // as his mist art, two wing poses swapping fast so they flap. This is
      // what makes the passing shade read as a bat swarm, not weather.
      const hasBats = this.scene.textures?.exists('sq-bat-up') && this.scene.textures?.exists('sq-bat-flat');
      if (hasBats) {
        const count = 14 + Math.floor(Math.random() * 5);
        for (let i = 0; i < count; i++) {
          this.scene.time.delayedCall(Math.random() * 2200, () => {
            if (this.active) this._spawnMistBat({ fromLeft, viewW, viewH, cx, cy });
          });
        }
      }
    } catch {}
  }

  _spawnMistBat({ fromLeft, viewW, viewH, cx, cy }) {
    try {
      const scene = this.scene;
      const w = 24 + Math.random() * 16;
      const startX = fromLeft ? cx - viewW / 2 - 50 : cx + viewW / 2 + 50;
      const endX = fromLeft ? cx + viewW / 2 + 50 : cx - viewW / 2 - 50;
      const y = cy - viewH * (0.05 + Math.random() * 0.33);
      const phase = Math.random() * Math.PI * 2;
      const wobble = 10 + Math.random() * 12;
      const bat = scene.add.image(startX, y, Math.random() < 0.5 ? 'sq-bat-up' : 'sq-bat-flat');
      bat.setDisplaySize(w, w * (260 / 480));
      bat.setDepth(DEPTH.OVERHEAD + 60);
      bat.setAlpha(0.92);
      if (!fromLeft) bat.setFlipX(true);
      let up = bat.texture.key === 'sq-bat-up';
      const flap = scene.time.addEvent({
        delay: 100 + Math.random() * 45,
        loop: true,
        callback: () => {
          up = !up;
          bat.setTexture(up ? 'sq-bat-up' : 'sq-bat-flat');
        },
      });
      scene.tweens.add({
        targets: bat, x: endX, duration: 10200 + Math.random() * 1800, ease: 'Linear',
        onUpdate: () => { bat.y = y + Math.sin(scene.time.now / 170 + phase) * wobble; },
        onComplete: () => { flap.remove(false); bat.destroy(); },
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
    // Pumpkin proximity prompt ([E] interaction): nearest unlit
    // pumpkin within reach of the player shows the prompt, same as
    // the duck/shelf/jukebox prompts elsewhere in the scene.
    try {
      const player = this.scene.player;
      this._nearPumpkin = null;
      if (player && this.pumpkinPrompt) {
        let bestD = 80;
        for (const e of this.pumpkins || []) {
          if (e.lit) continue;
          const d = Math.hypot(player.gx - e.img.x, player.gy - (e.img.y - 20));
          if (d < bestD) { bestD = d; this._nearPumpkin = e; }
        }
        if (this._nearPumpkin) {
          this.pumpkinPrompt.setPosition(player.gx, player.gy - 60).setAlpha(1);
        } else {
          this.pumpkinPrompt.setAlpha(0);
        }
      }
    } catch {}
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
    if (this._scenePointerDown) {
      try { this.scene.input.off('pointerdown', this._scenePointerDown); } catch {}
      this._scenePointerDown = null;
    }
    if (this._onPumpkinKey) {
      try { window.removeEventListener('keydown', this._onPumpkinKey); } catch {}
      this._onPumpkinKey = null;
    }
    for (const d of this.decor) { try { d.destroy(); } catch {} }
    this.decor = [];
    this.pumpkins = [];
    this._nearPumpkin = null;
  }
}
