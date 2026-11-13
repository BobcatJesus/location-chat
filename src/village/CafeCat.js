// CafeCat.js — the cafe cat in Agora.
//
// Design (approved 2026-11-12): one orange tabby that wanders the room.
// Walk up and pet it and it purrs, hops happily and follows you for a bit.
// After 3 pets it curls up and falls asleep in a sunbeam, and stays asleep
// until someone new walks into the room.
//
// The sleep state is shared: the server keeps a per-room pet count
// (`pet_cat` / `cat_state`, like the pumpkin `light_pumpkin` pattern), so
// three people petting once each puts the cat to sleep, and one person
// petting three times (5s cooldown between pets) does too.
//
// Owned by VillageScene: constructed in create(), ticked in update(),
// destroyed in shutdown(), refreshed on floor switches. Agora only
// (roomId === 'agora-houston'); every other room is a no-op.

import { DEPTH } from './depth.js';

const AGORA_ROOM_ID = 'agora-houston';
const WANDER_SPEED = 26;   // px/sec
const FOLLOW_SPEED = 95;   // px/sec when following the petter
const PET_COOLDOWN_MS = 5000;
const PET_COIN_REWARD = 1;
const FOLLOW_MS = 8000;
const PETS_TO_SLEEP = 3;
const INTERACT_RANGE = 120; // px from the cat the player must be within

/** Synthesized purr via Web Audio — no asset needed. */
function playPurr() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = playPurr._ctx || (playPurr._ctx = new AC());
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    // Low rumble with a few pulses = purr-ish.
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const start = t0 + i * 0.16;
      osc.frequency.setValueAtTime(58, start);
      osc.frequency.linearRampToValueAtTime(72, start + 0.14);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.16);
    }
  } catch {}
}

// Orange tabby, faces right by default.
function makeCatBody(scene) {
  const g = scene.add.graphics();
  g.fillStyle(0xe8912d, 1);          // tail (behind body)
  g.fillEllipse(-20, -4, 18, 7);
  g.fillStyle(0xf6a93b, 1);          // body
  g.fillEllipse(0, 0, 34, 22);
  g.fillStyle(0xb96a1b, 1);          // tabby stripes
  g.fillEllipse(-8, -3, 4, 14);
  g.fillEllipse(0, -4, 4, 15);
  g.fillEllipse(8, -3, 4, 14);
  g.fillStyle(0xf6a93b, 1);          // head
  g.fillCircle(14, -13, 10);
  g.fillStyle(0xe8912d, 1);          // ears
  g.fillTriangle(8, -20, 10, -28, 14, -20);
  g.fillTriangle(16, -21, 20, -28, 22, -19);
  g.fillStyle(0xf6d56b, 1);          // muzzle
  g.fillCircle(20, -10, 4);
  g.fillStyle(0x222222, 1);          // eye
  g.fillCircle(17, -15, 2);
  g.fillStyle(0xd96a8b, 1);          // nose
  g.fillCircle(22, -12, 1.5);
  return g;
}

// Curled-up loaf, shown while asleep.
function makeCurledBody(scene) {
  const g = scene.add.graphics();
  g.fillStyle(0xf6a93b, 1);
  g.fillEllipse(0, 0, 36, 20);
  g.fillStyle(0xb96a1b, 1);
  g.fillEllipse(-8, -2, 4, 12);
  g.fillEllipse(0, -3, 4, 13);
  g.fillEllipse(8, -2, 4, 12);
  g.fillStyle(0xe8912d, 1);          // tucked tail
  g.fillEllipse(14, 4, 14, 6);
  g.fillStyle(0xf6a93b, 1);          // head tucked in
  g.fillCircle(-12, -6, 8);
  g.fillStyle(0x222222, 1);          // closed eye (a line)
  g.fillRect(-16, -8, 6, 1.5);
  return g;
}

export class CafeCat {
  constructor(scene) {
    this.scene = scene;
    this.cat = null;      // { container, body, curled, x, y, tx, ty, state, idleMs, hopMs }
    this.sunbeam = null;  // graphics ellipse on the floor
    this.sunbeamSpot = null;
    this.zzz = null;      // floating "Z z z" text
    this.pets = 0;
    this.asleep = false;
    this.petCooldown = 0;
    this.followUntil = 0;
  }

  get enabled() {
    return this.scene?.roomId === AGORA_ROOM_ID;
  }

  _wanderBounds() {
    try {
      const b = this.scene?.roomLayout?.getBoundaryBounds?.();
      if (b && Number.isFinite(b.w) && b.w > 100) return b;
    } catch {}
    return { x: 200, y: 200, w: 1200, h: 500 };
  }

  _randomWanderPoint() {
    const bounds = this._wanderBounds();
    const layout = this.scene?.roomLayout;
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

  /** (Re)spawn the cat in Agora; clear it everywhere else. */
  refresh() {
    this._clearEntities();
    if (!this.enabled) return;
    const scene = this.scene;
    const bounds = this._wanderBounds();
    const layout = scene?.roomLayout;
    // The sunbeam lives at a fixed sunny spot in the room.
    this.sunbeamSpot = layout?.clampPointToRoom
      ? layout.clampPointToRoom(bounds.x + bounds.w * 0.72, bounds.y + bounds.h * 0.68, 30)
      : { x: bounds.x + bounds.w * 0.72, y: bounds.y + bounds.h * 0.68 };
    this.sunbeam = scene.add.graphics();
    this.sunbeam.fillStyle(0xffe98a, 0.16);
    this.sunbeam.fillEllipse(this.sunbeamSpot.x, this.sunbeamSpot.y, 150, 70);
    this.sunbeam.fillStyle(0xffe98a, 0.22);
    this.sunbeam.fillEllipse(this.sunbeamSpot.x, this.sunbeamSpot.y, 90, 42);
    this.sunbeam.setDepth(DEPTH.ACTOR_MIN - 1);

    const start = this._randomWanderPoint();
    const body = makeCatBody(scene);
    const curled = makeCurledBody(scene);
    curled.setVisible(false);
    const container = scene.add.container(start.x, start.y, [body, curled]);
    container.setDepth(DEPTH.ACTOR_MIN + Math.round(start.y));
    container.setSize(52, 44);
    container.setInteractive({ useHandCursor: true });
    const target = this._randomWanderPoint();
    const catRef = {
      container, body, curled,
      x: start.x, y: start.y,
      tx: target.x, ty: target.y,
      state: 'wander',
      idleMs: 500 + Math.random() * 1000,
      hopMs: 0,
    };
    container.on('pointerdown', () => this.petCat(true));
    this.cat = catRef;
    // If we re-spawned while the server says the cat is asleep, show that.
    if (this.asleep) this._showAsleep();
  }

  /** Pet the cat: purr + hop + heart + 1 coin, then it follows you. */
  petCat(local = true) {
    if (!this.cat || !this.cat.container || !this.cat.container.active) return;
    if (this.asleep) return;
    const now = Date.now();
    if (this.petCooldown && now < this.petCooldown) return;
    this.petCooldown = now + PET_COOLDOWN_MS;
    playPurr();
    this.cat.hopMs = 320;
    // Follow the petter for a bit (local pets only — remote pets just hop).
    if (local) this.followUntil = now + FOLLOW_MS;
    // Floating heart.
    try {
      const heart = this.scene.add.text(this.cat.x, this.cat.y - 32, '❤️', { fontSize: '22px' });
      heart.setDepth(DEPTH.ACTOR_MIN + 500);
      this.scene.tweens.add({
        targets: heart, y: this.cat.y - 64, alpha: 0,
        duration: 900, ease: 'Quad.easeOut',
        onComplete: () => heart.destroy(),
      });
    } catch {}
    // 1 coin, credited locally.
    try {
      import('./CoinWallet.js').then((m) => m.earnCoins(PET_COIN_REWARD, 'cat-pet')).catch(() => {});
    } catch {}
    // Tell the server so everyone counts the pet toward the 3-pet sleep.
    if (local) {
      try { this.scene.socket?.emit('pet_cat', { roomId: this.scene.roomId }); } catch {}
    }
  }

  /** A remote player petted the cat: react locally, no re-broadcast. */
  onRemotePet() {
    if (!this.cat || this.asleep) return;
    playPurr();
    this.cat.hopMs = 320;
  }

  /** Apply the server's canonical cat state. */
  applyState({ pets, asleep } = {}) {
    if (Number.isFinite(Number(pets))) this.pets = Number(pets);
    const nextAsleep = Boolean(asleep);
    if (nextAsleep === this.asleep) return;
    this.asleep = nextAsleep;
    if (nextAsleep) this._showAsleep();
    else this._showAwake();
  }

  _showAsleep() {
    if (!this.cat) return;
    this.followUntil = 0;
    const spot = this.sunbeamSpot || { x: this.cat.x, y: this.cat.y };
    // Trot over to the sunbeam, then curl up.
    try {
      this.scene.tweens.add({
        targets: this.cat.container,
        x: spot.x, y: spot.y,
        duration: 700, ease: 'Quad.easeOut',
        onComplete: () => {
          if (!this.cat) return;
          this.cat.x = spot.x; this.cat.y = spot.y;
          this.cat.body.setVisible(false);
          this.cat.curled.setVisible(true);
          this.cat.container.setDepth(DEPTH.ACTOR_MIN + Math.round(spot.y));
          this._showZzz();
        },
      });
    } catch {
      this.cat.body.setVisible(false);
      this.cat.curled.setVisible(true);
      this._showZzz();
    }
    if (this.sunbeam) {
      try { this.sunbeam.setAlpha(1); } catch {}
    }
  }

  _showAwake() {
    if (!this.cat) return;
    this._hideZzz();
    this.cat.curled.setVisible(false);
    this.cat.body.setVisible(true);
    const target = this._randomWanderPoint();
    this.cat.tx = target.x; this.cat.ty = target.y;
    this.cat.state = 'wander';
    this.cat.idleMs = 400 + Math.random() * 800;
    if (this.sunbeam) {
      try { this.sunbeam.setAlpha(0.55); } catch {}
    }
  }

  _showZzz() {
    this._hideZzz();
    if (!this.cat) return;
    try {
      this.zzz = this.scene.add.text(this.cat.x + 18, this.cat.y - 34, '💤', { fontSize: '20px' });
      this.zzz.setDepth(DEPTH.ACTOR_MIN + 500);
    } catch {}
  }

  _hideZzz() {
    try { this.zzz?.destroy(); } catch {}
    this.zzz = null;
  }

  /** Cat within INTERACT_RANGE of (x, y), awake — or null. */
  nearestCat(x, y) {
    if (!this.cat || this.asleep) return null;
    const d = Math.hypot(this.cat.x - x, this.cat.y - y);
    return d < INTERACT_RANGE ? this.cat : null;
  }

  update(delta) {
    const cat = this.cat;
    if (!cat || !cat.container || !cat.container.active) return;
    if (this.asleep) return;
    const dt = delta / 1000;
    const player = this.scene?.player;

    // Following the petter: walk toward them, stop close by.
    if (player && Date.now() < this.followUntil) {
      const dx = player.gx - cat.x;
      const dy = player.gy - cat.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 46) {
        const step = Math.min(dist, FOLLOW_SPEED * dt);
        cat.x += (dx / dist) * step;
        cat.y += (dy / dist) * step;
        if (Math.abs(dx) > 2) cat.container.setScale(dx < 0 ? -1 : 1, 1);
        cat.container.setPosition(cat.x, cat.y);
        cat.container.setDepth(DEPTH.ACTOR_MIN + Math.round(cat.y));
        return;
      }
      // Close enough: sit with them a moment.
      return;
    }

    if (cat.idleMs > 0) {
      cat.idleMs -= delta;
      return;
    }
    const dx = cat.tx - cat.x;
    const dy = cat.ty - cat.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 8) {
      cat.idleMs = 900 + Math.random() * 3000;
      const t = this._randomWanderPoint();
      cat.tx = t.x; cat.ty = t.y;
      return;
    }
    const step = Math.min(dist, WANDER_SPEED * dt);
    cat.x += (dx / dist) * step;
    cat.y += (dy / dist) * step;
    if (Math.abs(dx) > 2) cat.container.setScale(dx < 0 ? -1 : 1, 1);
    cat.container.setPosition(cat.x, cat.y);
    if (cat.hopMs > 0) {
      cat.hopMs -= delta;
      const t = Math.max(0, cat.hopMs) / 320;
      cat.container.y -= Math.sin(t * Math.PI) * 12;
    }
    cat.container.setDepth(DEPTH.ACTOR_MIN + Math.round(cat.y));
  }

  _clearEntities() {
    try { this.cat?.container?.destroy(); } catch {}
    this.cat = null;
    try { this.sunbeam?.destroy(); } catch {}
    this.sunbeam = null;
    this._hideZzz();
    this.followUntil = 0;
  }

  destroy() {
    this._clearEntities();
    this.sunbeamSpot = null;
    this.scene = null;
  }
}
