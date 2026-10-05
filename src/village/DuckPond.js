// DuckPond.js — procedural duck-feeding interaction template.
//
// Design: any pond zone (type: 'pond') automatically becomes a living duck
// pond. No per-location authoring: park + pond => ducks + feeding, everywhere.
//
//   - Ducks spawn on each pond and wander inside the water ellipse.
//   - A player near a pond can feed: a crumb pellet is tossed, nearby ducks
//     swim to it and eat it (happy hop included).
//   - Feeding is broadcast over Socket.IO (`feed_ducks` / `duck_fed`) so every
//     player in the room sees the same feeding frenzy.
//
// Owned by VillageScene: constructed in create(), ticked in update(),
// destroyed in shutdown(), refreshed on floor switches.

import { DEPTH } from './depth.js';

const DUCKS_PER_POND = 3;
const MAX_DUCKS_TOTAL = 9;
const WANDER_SPEED = 30;   // px/sec
const SEEK_SPEED = 110;    // px/sec when chasing food
const FEED_RANGE = 150;    // px from the pond's edge the player must be within
const PELLET_BITES = 3;    // bites before a crumb is gone
const PET_COOLDOWN_MS = 5000; // per-duck petting cooldown
const PET_COIN_REWARD = 1;

/** Synthesized quack via Web Audio — no asset needed. */
function playQuack() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = playQuack._ctx || (playQuack._ctx = new AC());
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    // Two descending blips = quack-ish
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      const start = t0 + i * 0.12;
      osc.frequency.setValueAtTime(420 - i * 60, start);
      osc.frequency.exponentialRampToValueAtTime(180, start + 0.1);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.13);
    }
  } catch {}
}
const EAT_PAUSE_MS = 450;
const SHORE_DUCKS_PER_POND = 2;  // standing ducks that waddle the shoreline

function pondCenter(pond) {
  return { x: pond.x + pond.w / 2, y: pond.y + pond.h / 2 };
}

function pondRadii(pond) {  // Keep ducks comfortably inside the drawn water (which is an ellipse).
  return { rx: (pond.w / 2) * 0.78, ry: (pond.h / 2) * 0.7 };
}

function randomPointInPond(pond) {
  const c = pondCenter(pond);
  const { rx, ry } = pondRadii(pond);
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()); // uniform over the disc
  return { x: c.x + Math.cos(a) * rx * r, y: c.y + Math.sin(a) * ry * r };
}

function randomShorePoint(pond) {
  const c = pondCenter(pond);
  const { rx, ry } = pondRadii(pond);
  const a = Math.random() * Math.PI * 2;
  const ring = 1.12 + Math.random() * 0.25; // just outside the water
  const x = Math.min(Math.max(c.x + Math.cos(a) * rx * ring, pond.x + 12), pond.x + pond.w - 12);
  const y = Math.min(Math.max(c.y + Math.sin(a) * ry * ring, pond.y + 12), pond.y + pond.h - 12);
  return { x, y };
}

function clampPointToPond(pond, x, y) {
  const c = pondCenter(pond);
  const { rx, ry } = pondRadii(pond);
  const dx = (x - c.x) / rx;
  const dy = (y - c.y) / ry;
  const d = Math.hypot(dx, dy);
  if (d <= 1) return { x, y };
  return { x: c.x + (dx / d) * rx, y: c.y + (dy / d) * ry };
}

// Distance from (x, y) to the pond rectangle's edge (0 when inside/overlapping).
// Measured to the edge — not the center — so standing anywhere along the
// shoreline counts as "at the pond", no matter how large the pond is.
function distToPondEdge(pond, x, y) {
  const dx = Math.max(pond.x - x, 0, x - (pond.x + pond.w));
  const dy = Math.max(pond.y - y, 0, y - (pond.y + pond.h));
  return Math.hypot(dx, dy);
}

// Duck body: custom art if loaded, otherwise vector shapes (faces right by default).
function makeDuckBody(scene) {
  if (scene?.textures?.exists('duck-art')) {
    const img = scene.add.image(0, 0, 'duck-art');
    img.setDisplaySize(44, 37);
    return img;
  }
  const g = scene.add.graphics();
  g.fillStyle(0xf6d56b, 1);          // body
  g.fillEllipse(0, 0, 30, 20);
  g.fillStyle(0xe8bd4a, 1);          // wing
  g.fillEllipse(-3, -1, 15, 9);
  g.fillStyle(0xf6d56b, 1);          // head
  g.fillCircle(11, -13, 9);
  g.fillStyle(0xe8912d, 1);          // beak
  g.fillTriangle(18, -15, 27, -12, 18, -9);
  g.fillStyle(0x222222, 1);          // eye
  g.fillCircle(13, -15, 2);
  g.fillStyle(0xe8bd4a, 1);          // tail
  g.fillTriangle(-14, -5, -23, -11, -14, -13);
  return g;
}

export class DuckPond {
  constructor(scene) {
    this.scene = scene;
    this.ducks = [];   // { container, pond, x, y, tx, ty, state, idleMs, eatMs }
    this.pellets = []; // { x, y, bites, circle }
    this.ponds = [];
  }

  /** (Re)discover pond zones from the drawn layout and (re)spawn ducks. */
  refresh() {
    this._clearEntities();
    const zones = this.scene?.roomLayout?.currentZones || [];
    this.ponds = zones.filter((z) => z && z.type === 'pond');
    let budget = MAX_DUCKS_TOTAL;
    for (const pond of this.ponds) {
      const n = Math.min(DUCKS_PER_POND, budget);
      for (let i = 0; i < n; i++) this._spawnDuck(pond);
      budget -= n;
      if (budget <= 0) break;
      for (let i = 0; i < SHORE_DUCKS_PER_POND; i++) this._spawnShoreDuck(pond);
    }
  }

  _spawnShoreDuck(pond) {
    const scene = this.scene;
    const p = randomShorePoint(pond);
    let body;
    if (scene?.textures?.exists('duck-stand-art')) {
      body = scene.add.image(0, 0, 'duck-stand-art');
      body.setDisplaySize(40, 34);
      if (Math.random() < 0.5) body.setFlipX(true); // face either way
    } else {
      body = makeDuckBody(scene);
    }
    const container = scene.add.container(p.x, p.y, [body]);
    container.setDepth(DEPTH.ACTOR_MIN + Math.round(p.y));
    container.setSize(48, 40);
    container.setInteractive({ useHandCursor: true });
    const t = randomShorePoint(pond);
    const duckRef = {
      container, pond,
      x: p.x, y: p.y,
      tx: t.x, ty: t.y,
      state: 'wander', shore: true,
      idleMs: 500 + Math.random() * 1500,
      eatMs: 0, pellet: null,
      petCooldown: 0,
    };
    container.on('pointerdown', () => this.petDuck(duckRef));
    this.ducks.push(duckRef);
  }

  _spawnDuck(pond) {
    const scene = this.scene;
    const p = randomPointInPond(pond);
    const body = makeDuckBody(scene);
    const container = scene.add.container(p.x, p.y, [body]);
    container.setDepth(DEPTH.ACTOR_MIN + Math.round(p.y));
    container.setSize(48, 40);
    container.setInteractive({ useHandCursor: true });
    const duckRef = {
      container, pond,
      x: p.x, y: p.y,
      tx: 0, ty: 0,
      state: 'wander',
      idleMs: 0,
      eatMs: 0,
      pellet: null,
      petCooldown: 0,
    };
    const target = randomPointInPond(pond);
    duckRef.tx = target.x; duckRef.ty = target.y;
    container.on('pointerdown', () => this.petDuck(duckRef));
    this.ducks.push(duckRef);
  }

  /** Pet a duck: happy hop + quack + heart + 1 coin (per-duck cooldown). */
  petDuck(duck) {
    if (!duck || !duck.container || !duck.container.active) return;
    const now = Date.now();
    if (duck.petCooldown && now < duck.petCooldown) return;
    duck.petCooldown = now + PET_COOLDOWN_MS;
    playQuack();
    // Happy hop: timer-driven so the wander loop doesn't override it.
    duck.hopMs = 320;
    // Floating heart.
    try {
      const heart = this.scene.add.text(duck.x, duck.y - 30, '\u2764\uFE0F', { fontSize: '22px' });
      heart.setDepth(DEPTH.ACTOR_MIN + 500);
      this.scene.tweens.add({
        targets: heart, y: duck.y - 62, alpha: 0,
        duration: 900, ease: 'Quad.easeOut',
        onComplete: () => heart.destroy(),
      });
    } catch {}
    // 1 coin, credited locally.
    try {
      import('./CoinWallet.js').then((m) => m.earnCoins(PET_COIN_REWARD, 'duck-pet')).catch(() => {});
    } catch {}
  }

  /** Pond zone whose edge is within FEED_RANGE of (x, y), or null. */
  nearestFeedablePond(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const pond of this.ponds) {
      const d = distToPondEdge(pond, x, y);
      if (d < FEED_RANGE && d < bestD) {
        best = pond;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * Toss a crumb at (x, y). Returns true if a pellet was created.
   * `remote` marks feeds that arrived over the socket (no re-broadcast).
   */
  feed(x, y, remote = false) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    // Snap the crumb into the nearest pond; ignore feeds far from any pond.
    let pond = this.nearestFeedablePond(x, y);
    if (!pond && this.ponds.length) {
      let bestD = Infinity;
      for (const p of this.ponds) {
        const d = distToPondEdge(p, x, y);
        if (d < bestD) { bestD = d; pond = p; }
      }
      if (bestD > FEED_RANGE * 1.5) return false;
    }
    if (!pond) return false;
    const pos = clampPointToPond(pond, x, y);
    const circle = this.scene.add.circle(pos.x, pos.y, 6, 0x8a5a2b, 1);
    circle.setDepth(DEPTH.ACTOR_MIN + Math.round(pos.y) + 1);
    circle.setStrokeStyle(1.5, 0x5d3a17, 1);
    this.pellets.push({ x: pos.x, y: pos.y, bites: PELLET_BITES, circle, pond });
    // Swimming ducks on this pond notice the splash (shore ducks stay put).
    for (const duck of this.ducks) {
      if (duck.pond === pond && duck.state === 'wander' && !duck.shore) {
        duck.state = 'seek';
        duck.pellet = this.pellets[this.pellets.length - 1];
      }
    }
    return true;
  }

  update(delta) {
    const dt = delta / 1000;
    // --- ducks ---
    for (const duck of this.ducks) {
      if (duck.state === 'eat') {
        duck.eatMs -= delta;
        if (duck.eatMs <= 0) {
          const pellet = duck.pellet;
          if (pellet && pellet.bites > 0) {
            pellet.bites -= 1;
            const s = Math.max(0.25, pellet.bites / PELLET_BITES);
            pellet.circle.setScale(s);
            // Happy hop.
            this.scene.tweens.add({
              targets: duck.container,
              y: duck.y - 10,
              duration: 130,
              yoyo: true,
              ease: 'Quad.easeOut',
            });
          }
          if (!pellet || pellet.bites <= 0) {
            duck.state = 'wander';
            duck.pellet = null;
            duck.idleMs = 400 + Math.random() * 1200;
          } else {
            duck.eatMs = EAT_PAUSE_MS;
          }
        }
        continue;
      }

      let speed = duck.shore ? WANDER_SPEED * 0.45 : WANDER_SPEED;
      if (duck.shore) {
        // Shore ducks amble along the waterline; they don't chase crumbs.
        if (duck.state === 'seek') { duck.state = 'wander'; duck.pellet = null; }
      } else if (duck.state === 'seek' && duck.pellet && duck.pellet.bites > 0) {
        duck.tx = duck.pellet.x;
        duck.ty = duck.pellet.y;
        speed = SEEK_SPEED;
      } else if (duck.state === 'seek') {
        duck.state = 'wander';
        duck.pellet = null;
      }

      if (duck.state === 'wander' && duck.idleMs > 0) {
        duck.idleMs -= delta;
        continue;
      }

      const dx = duck.tx - duck.x;
      const dy = duck.ty - duck.y;
      const dist = Math.hypot(dx, dy);

      if (duck.state === 'seek' && dist < 16) {
        duck.state = 'eat';
        duck.eatMs = EAT_PAUSE_MS;
        duck.pellet = duck.pellet && duck.pellet.bites > 0 ? duck.pellet : null;
        if (!duck.pellet) duck.state = 'wander';
        continue;
      }

      if (dist < 8) {
        if (duck.state === 'wander') {
          duck.idleMs = 800 + Math.random() * 2600;
          const t = duck.shore ? randomShorePoint(duck.pond) : randomPointInPond(duck.pond);
          duck.tx = t.x;
          duck.ty = t.y;
        }
        continue;
      }

      const step = Math.min(dist, speed * dt);
      duck.x += (dx / dist) * step;
      duck.y += (dy / dist) * step;
      // Face travel direction (duck art faces right).
      if (Math.abs(dx) > 2) duck.container.setScale(dx < 0 ? -1 : 1, 1);
      duck.container.setPosition(duck.x, duck.y);
      if (duck.hopMs > 0) {
        duck.hopMs -= delta;
        const t = Math.max(0, duck.hopMs) / 320; // 1 -> 0
        duck.container.y -= Math.sin(t * Math.PI) * 16;
      }
      duck.container.setDepth(DEPTH.ACTOR_MIN + Math.round(duck.y));
    }

    // --- pellets: remove fully-eaten ones ---
    for (let i = this.pellets.length - 1; i >= 0; i--) {
      const pellet = this.pellets[i];
      if (pellet.bites <= 0) {
        pellet.circle.destroy();
        this.pellets.splice(i, 1);
      }
    }
  }

  _clearEntities() {
    for (const duck of this.ducks) duck.container.destroy();
    for (const pellet of this.pellets) pellet.circle.destroy();
    this.ducks = [];
    this.pellets = [];
  }

  destroy() {
    this._clearEntities();
    this.ponds = [];
    this.scene = null;
  }
}
