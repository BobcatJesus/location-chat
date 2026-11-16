// DuckPond.js — procedural duck-feeding interaction template.
//
// Design: any pond zone (type: 'pond') automatically becomes a living duck
// pond. No per-location authoring: park + pond => ducks + feeding, everywhere.
//
//   - A few ducks stay on each pond and wander inside the water ellipse.
//   - The rest are ROAMING ducks: they spawn at random spots all over the
//     park and keep meandering park-wide, so the player has to hunt them
//     down. Only roaming ducks count toward the Duck Roundup quest — pond
//     ducks neither add to nor subtract from it.
//   - Petting a duck (click, or E when right next to one) needs the
//     player to be right up next to it (PET_RANGE). Clicking from across
//     the park does nothing.
//   - A player near a pond can feed: a crumb pellet is tossed, nearby
//     pond ducks swim to it and eat it (happy hop included). Feeding is
//     a pond-duck thing, so it does NOT count toward the quest.
//   - Feeding is broadcast over Socket.IO (`feed_ducks` / `duck_fed`) so every
//     player in the room sees the same feeding frenzy.
//
// Owned by VillageScene: constructed in create(), ticked in update(),
// destroyed in shutdown(), refreshed on floor switches.

import { DEPTH } from './depth.js';

const DUCKS_PER_POND = 3;      // pond ducks: stay in the water, don't count for the quest
const ROAMING_DUCKS_PER_POND = 4; // roaming ducks: spawn anywhere in the park, count for the quest
const MAX_DUCKS_TOTAL = 9;
const WANDER_SPEED = 30;   // px/sec
const SEEK_SPEED = 110;    // px/sec when chasing food
const FEED_RANGE = 150;    // px from the pond's edge the player must be within
const PET_RANGE = 70;      // px from a duck the player must be within to pet it — right up next to it
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

/** True when (x, y) is inside (or within `margin` of) any known pond. */
function insideAnyPond(ponds, x, y, margin = 0) {
  for (const pond of ponds || []) {
    if (x >= pond.x - margin && x <= pond.x + pond.w + margin &&
        y >= pond.y - margin && y <= pond.y + pond.h + margin) return true;
  }
  return false;
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
    // Called with the petted duck whenever a duck is petted past its
    // cooldown — VillageScene wires this to the quest loop, but only
    // roaming ducks count toward the duck quest (pond ducks don't).
    this.onDuckPet = null;
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
      // Roaming ducks: spawn anywhere in the park (not budgeted like
      // pond ducks — same as the old shoreline ducks were).
      for (let i = 0; i < ROAMING_DUCKS_PER_POND; i++) this._spawnRoamingDuck(pond);
    }
  }

  /**
   * A random point anywhere in the park: inside the room boundary,
   * on dry land (not in a pond), not inside a solid. Retries a few
   * times, then falls back to the middle of the park.
   */
  randomParkPoint() {
    const layout = this.scene?.roomLayout;
    const bounds = layout?.getBoundaryBounds?.() || { x: 0, y: 0, w: 1600, h: 900 };
    for (let i = 0; i < 12; i++) {
      const x = bounds.x + 40 + Math.random() * Math.max(1, bounds.w - 80);
      const y = bounds.y + 40 + Math.random() * Math.max(1, bounds.h - 80);
      const p = layout?.clampPointToRoom ? layout.clampPointToRoom(x, y, 30) : { x, y };
      if (insideAnyPond(this.ponds, p.x, p.y, 24)) continue;
      if (layout?.collidesWithSolid && layout.collidesWithSolid(p.x, p.y, 20)) continue;
      return p;
    }
    const fallback = layout?.clampPointToRoom
      ? layout.clampPointToRoom(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, 30)
      : { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    return fallback;
  }

  /** Nearest duck the player can actually pet (within PET_RANGE, off cooldown), or null. */
  nearestPettableDuck(x, y) {
    const now = Date.now();
    let best = null;
    let bestD = PET_RANGE;
    for (const duck of this.ducks) {
      if (!duck.container || !duck.container.active) continue;
      if (duck.petCooldown && now < duck.petCooldown) continue;
      const d = Math.hypot(duck.x - x, duck.y - y);
      if (d <= bestD) { bestD = d; best = duck; }
    }
    return best;
  }

  /**
   * Pick a roaming target whose straight-line walk from (fromX, fromY)
   * doesn't cross a pond — roaming ducks walk on land, not across the
   * water. Retries a few times, then takes whatever it got.
   */
  _pickRoamingTarget(fromX, fromY) {
    for (let i = 0; i < 6; i++) {
      const t = this.randomParkPoint();
      let crosses = false;
      for (let s = 1; s <= 8; s++) {
        const x = fromX + (t.x - fromX) * (s / 8);
        const y = fromY + (t.y - fromY) * (s / 8);
        if (insideAnyPond(this.ponds, x, y, 12)) { crosses = true; break; }
      }
      if (!crosses) return t;
    }
    return this.randomParkPoint();
  }

  _spawnRoamingDuck(pond) {
    const scene = this.scene;
    const p = this.randomParkPoint();
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
    const t = this._pickRoamingTarget(p.x, p.y);
    const duckRef = {
      container, pond,
      x: p.x, y: p.y,
      tx: t.x, ty: t.y,
      state: 'wander', roaming: true,
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
      state: 'wander', roaming: false,
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

  /**
   * Pet a duck: happy hop + quack + heart + 1 coin (per-duck cooldown).
   * Only works when the player is right up next to the duck (PET_RANGE)
   * — clicking one from across the park does nothing. Pond ducks still
   * give the +1 coin, but only roaming ducks fire the quest hook.
   */
  petDuck(duck) {
    if (!duck || !duck.container || !duck.container.active) return;
    const player = this.scene?.player;
    if (player && Number.isFinite(player.gx) && Number.isFinite(player.gy)) {
      const d = Math.hypot(player.gx - duck.x, player.gy - duck.y);
      if (d > PET_RANGE) return; // too far away — walk right up to it
    }
    const now = Date.now();
    if (duck.petCooldown && now < duck.petCooldown) return;
    duck.petCooldown = now + PET_COOLDOWN_MS;
    playQuack();
    // Quest hook: a pet counts as a duck interaction — but only for
    // roaming ducks. Pond ducks neither add to nor subtract from it.
    // The duck itself is passed so VillageScene can tell them apart.
    try { this.onDuckPet?.(duck); } catch {}
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
    // Swimming ducks on this pond notice the splash (roaming ducks keep wandering the park).
    for (const duck of this.ducks) {
      if (duck.pond === pond && duck.state === 'wander' && !duck.roaming) {
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

      let speed = duck.roaming ? WANDER_SPEED * 0.45 : WANDER_SPEED;
      if (duck.roaming) {
        // Roaming ducks amble all over the park; they don't chase crumbs.
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
          // Roaming ducks pick their next stop anywhere in the park
          // (walking around the pond, never across it); pond ducks
          // pick a new spot in the water.
          const t = duck.roaming ? this._pickRoamingTarget(duck.x, duck.y) : randomPointInPond(duck.pond);
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
