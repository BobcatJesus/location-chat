// CafeCat.js — the cafe cat in Agora.
//
// Design (approved 2026-11-12): one white-and-orange calico that wanders
// the room. Her art is the user's exact reference sheet
// (public/assets/sprites/cat-side.png etc., cut from the 4-view image
// he sent 2026-11-12) — side view while awake, same art squashed flat
// while asleep. Vector calico in CafeCat.js is only a fallback.
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
import { HUNGRY_CAT_BUBBLE_TEXT } from './catHunger.js';

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

// The cat's art is the user's reference sheet, cut into transparent
// sprites (public/assets/sprites/cat-*.png, loaded in VillageScene).
// Awake = the side view, facing right; it flips when she walks left.
// If the textures are missing for any reason, fall back to the vector
// calico drawn below.
function makeCatBody(scene) {
  if (scene?.textures?.exists('cat-side')) {
    const img = scene.add.image(0, -2, 'cat-side');
    // Small on purpose: an avatar is ~64-76 units tall, so ~26 tall
    // puts her top well below the avatar's knees.
    img.setDisplaySize(26, 27);
    return img;
  }
  const g = scene.add.graphics();
  g.fillStyle(0xfff6ec, 1);          // fluffy tail (behind body)
  g.fillEllipse(-21, -6, 14, 12);
  g.fillCircle(-24, -10, 6);
  g.fillStyle(0xf6a93b, 1);          // orange tail tip
  g.fillCircle(-26, -12, 5);
  g.fillStyle(0xfff6ec, 1);          // body
  g.fillEllipse(0, 0, 34, 22);
  g.fillStyle(0xf6a93b, 1);          // orange patches on the back
  g.fillEllipse(-8, -5, 12, 10);
  g.fillEllipse(4, -6, 9, 8);
  g.fillStyle(0xfff6ec, 1);          // head
  g.fillCircle(14, -13, 10);
  g.fillStyle(0xf6a93b, 1);          // orange patch over one ear
  g.fillCircle(17, -19, 6);
  g.fillStyle(0xfff6ec, 1);          // ears
  g.fillTriangle(8, -20, 10, -28, 14, -20);
  g.fillTriangle(16, -21, 20, -28, 22, -19);
  g.fillStyle(0xf2a0b5, 1);          // pink inner ears
  g.fillTriangle(10, -21, 11, -25, 13, -21);
  g.fillTriangle(18, -22, 19, -25, 21, -21);
  g.fillStyle(0x0e7490, 1);          // teal collar
  g.fillRect(4, -5, 12, 4);
  g.fillStyle(0xf6c344, 1);          // gold bell
  g.fillCircle(10, 0, 2.5);
  g.fillStyle(0x222222, 1);          // big eye
  g.fillCircle(17, -15, 3);
  g.fillStyle(0xffffff, 1);          // eye shine
  g.fillCircle(18, -16, 1);
  g.fillStyle(0xf2a0b5, 1);          // pink cheek
  g.fillCircle(20, -10, 2.5);
  g.fillStyle(0xd96a8b, 1);          // nose
  g.fillCircle(23, -12, 1.5);
  return g;
}

// Santa Hat v1 (`sq-santa-hat-v1`): a little red Santa hat for the
// cat's head — triangle + white brim + pompom. Two versions, one
// per body: awake (head top-right, facing right) and asleep (head
// tucked on the left). The hat rides on the cat's container, so it
// follows her while she wanders, follows you, and sleeps — and it
// flips with her when she turns around.
function makeSantaHatAwake(scene) {
  const g = scene.add.graphics();
  // Brim across the top of the head, triangle flopping right.
  g.fillStyle(0xdc2626, 1);
  g.fillTriangle(3, -18, 17, -18, 13, -30);
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(1, -19, 18, 5, 2);
  g.fillCircle(14, -31, 2.5);
  return g;
}

function makeSantaHatAsleep(scene) {
  const g = scene.add.graphics();
  // Brim across the tucked head, triangle flopping left.
  g.fillStyle(0xdc2626, 1);
  g.fillTriangle(-20, -14, -5, -14, -9, -26);
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(-22, -15, 18, 5, 2);
  g.fillCircle(-8, -27, 2.5);
  return g;
}

// Curled up asleep — the user's exact sleeping-cat image, Z bubble
// and all. The floating 💤 stays too, so the zzzs are unmistakable.
function makeCurledBody(scene) {
  if (scene?.textures?.exists('cat-sleep')) {
    const img = scene.add.image(0, 0, 'cat-sleep');
    img.setDisplaySize(30, 30);
    return img;
  }
  if (scene?.textures?.exists('cat-side')) {
    const img = scene.add.image(0, 2, 'cat-side');
    img.setDisplaySize(26, 17);
    return img;
  }
  const g = scene.add.graphics();
  g.fillStyle(0xfff6ec, 1);
  g.fillEllipse(0, 0, 36, 20);
  g.fillStyle(0xf6a93b, 1);
  g.fillEllipse(-6, -4, 12, 10);
  g.fillEllipse(8, -5, 9, 8);
  g.fillStyle(0xfff6ec, 1);          // fluffy tail curled around
  g.fillEllipse(14, 5, 14, 8);
  g.fillStyle(0xf6a93b, 1);
  g.fillCircle(19, 4, 4);
  g.fillStyle(0xfff6ec, 1);          // head tucked in
  g.fillCircle(-12, -6, 8);
  g.fillStyle(0xf6a93b, 1);
  g.fillCircle(-13, -11, 4);
  g.fillStyle(0x0e7490, 1);          // teal collar peeking out
  g.fillRect(-8, -1, 8, 3);
  g.fillStyle(0xf6c344, 1);          // gold bell
  g.fillCircle(-4, 2, 2);
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
    // Hungry Cat v1 (`sq-hungry-cat-v1`): the server says when she
    // is hungry (twice a day, morning + evening). While hungry she
    // shows a thought bubble saying "hungry..." — hidden while she
    // is asleep (feeding a sleeping cat is refused), and it follows
    // her while she wanders.
    this.hungry = false;
    this.hungerWindowId = null;
    this.hungerBubble = null; // scene-level text, repositioned in update()
    this.hatWorn = false; // Santa Hat v1: she is wearing the hat
    this.petCooldown = 0;
    this.followUntil = 0;
    this.onCatPet = null; // quest hook (Cat Cuddles): set by VillageScene
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
    // Santa Hat v1: the hat rides on the container (after body /
    // curled, so it draws on top), one version per body. Hidden
    // until SantaHatSystem says she wears it.
    const hatAwake = makeSantaHatAwake(scene);
    const hatAsleep = makeSantaHatAsleep(scene);
    hatAwake.setVisible(false);
    hatAsleep.setVisible(false);
    const container = scene.add.container(start.x, start.y, [body, curled, hatAwake, hatAsleep]);
    container.setDepth(DEPTH.ACTOR_MIN + Math.round(start.y));
    container.setSize(36, 34);
    container.setInteractive({ useHandCursor: true });
    const target = this._randomWanderPoint();
    const catRef = {
      container, body, curled, hatAwake, hatAsleep,
      x: start.x, y: start.y,
      tx: target.x, ty: target.y,
      state: 'wander',
      idleMs: 500 + Math.random() * 1000,
      hopMs: 0,
    };
    container.on('pointerdown', () => this.petCat(true));
    this.cat = catRef;
    this._applyHatVisibility();
    // If we re-spawned while the server says the cat is asleep, show that.
    if (this.asleep) this._showAsleep();
    // Hungry Cat v1: the bubble was destroyed with the old cat
    // (_clearEntities) — if she is still hungry and awake, bring
    // it back with the respawn instead of waiting for the next
    // cat_hunger broadcast.
    else if (this.hungry) this._showHungerBubble();
  }

  /** Pet the cat: purr + hop + heart + 1 coin, then it follows you.
   *  opts.fed (Hungry Cat v1) marks a FOOD treat (only the
   *  ItemsSystem treat path sends it — a hand pet never does): the
   *  server checks whether she is hungry and, if so, completes the
   *  hungry-cat quest for the first feeder in this window.
   *  Hungry Cat v1.2 (`sq-hungry-cat-v1.2`): returns whether the pet
   *  LANDED (true) or no-op'd (false — no cat, asleep, or inside
   *  the 5s cooldown). Callers that spend something on a pet — the
   *  treat path spends a food charge — must check this first. */
  petCat(local = true, opts = {}) {
    if (!this.cat || !this.cat.container || !this.cat.container.active) return false;
    if (this.asleep) return false;
    const now = Date.now();
    if (this.petCooldown && now < this.petCooldown) return false;
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
    // Quest hook (Cat Cuddles + the Bartender's Errand): a successful
    // LOCAL pet counts. Remote pets go through onRemotePet, not here,
    // so nobody else's petting fills your quest.
    if (local) {
      try { this.onCatPet?.(); } catch {}
    }
    // Tell the server so everyone counts the pet toward the 3-pet sleep.
    // Hungry Cat v1: a treat also tells the server it was food (fed),
    // so the server can complete the hungry-cat quest for the first
    // feeder in this window. A hand pet sends fed: false.
    if (local) {
      try { this.scene.socket?.emit('pet_cat', { roomId: this.scene.roomId, fed: Boolean(opts?.fed) }); } catch {}
    }
    return true;
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

  /** Hungry Cat v1 (`sq-hungry-cat-v1`): the server's hunger state
   *  for this window. The bubble shows only while she is awake —
   *  a sleeping cat cannot be fed, so hunger waits silently until
   *  she wakes (and _showAwake re-shows it if she is still hungry).
   *  Idempotent: the same window re-sent (reconnect, wake) just
   *  re-shows the same bubble. */
  setHungry(hungry, windowId = null) {
    this.hungry = Boolean(hungry);
    this.hungerWindowId = windowId || null;
    if (this.hungry && !this.asleep) this._showHungerBubble();
    else this._hideHungerBubble();
  }

  /** One tracker line for the hungry-cat quest, while she is hungry
   *  and awake — the quest is invisible in the tracker outside a
   *  hunger window (the banner announces it when a window opens).
   *  QuestManager._trackerSections reads this, like the puzzle and
   *  the trees. */
  getTrackerLine() {
    if (!this.hungry || this.asleep || !this.cat) return null;
    return '🐱 Feed the Hungry Cat — she\'s hungry! Feed her a treat (+3 coins)';
  }

  _showHungerBubble() {
    if (!this.cat) return;
    try {
      if (!this.hungerBubble) {
        this.hungerBubble = this.scene.add.text(0, 0, HUNGRY_CAT_BUBBLE_TEXT, {
          fontSize: '15px',
          color: '#7c2d12',
          backgroundColor: 'rgba(255,255,255,0.92)',
          padding: { x: 8, y: 4 },
        });
        this.hungerBubble.setOrigin(0.5, 1);
        this.hungerBubble.setDepth(DEPTH.ACTOR_MIN + 500);
      }
      this.hungerBubble.setText(HUNGRY_CAT_BUBBLE_TEXT);
      this.hungerBubble.setPosition(this.cat.x, this.cat.y - 40).setAlpha(1);
    } catch {}
  }

  _hideHungerBubble() {
    try { this.hungerBubble?.setAlpha(0); } catch {}
  }

  /** Santa Hat v1: she is wearing the hat (or not). The hat rides
   * on her container, so it follows her while she wanders, follows
   * you, and sleeps — awake and asleep versions swap with the body. */
  setHatWorn(worn) {
    this.hatWorn = Boolean(worn);
    this._applyHatVisibility();
  }

  _applyHatVisibility() {
    if (!this.cat) return;
    try { this.cat.hatAwake?.setVisible(Boolean(this.hatWorn) && !this.asleep); } catch {}
    try { this.cat.hatAsleep?.setVisible(Boolean(this.hatWorn) && this.asleep); } catch {}
  }

  _showAsleep() {
    if (!this.cat) return;
    this.followUntil = 0;
    // Sleep right where she is — no trotting off to a sunbeam spot.
    // The sunbeam comes to her instead: redraw it underneath her.
    if (this.sunbeam) {
      try {
        this.sunbeam.clear();
        this.sunbeam.fillStyle(0xffe98a, 0.16);
        this.sunbeam.fillEllipse(this.cat.x, this.cat.y, 150, 70);
        this.sunbeam.fillStyle(0xffe98a, 0.22);
        this.sunbeam.fillEllipse(this.cat.x, this.cat.y, 90, 42);
        this.sunbeam.setAlpha(1);
      } catch {}
    }
    this.cat.body.setVisible(false);
    this.cat.curled.setVisible(true);
    this.cat.container.setDepth(DEPTH.ACTOR_MIN + Math.round(this.cat.y));
    this._applyHatVisibility();
    // Hungry Cat v1: the bubble hides while she sleeps (hunger
    // waits — it is not cleared — and _showAwake brings the bubble
    // back if she is still hungry).
    this._hideHungerBubble();
    this._showZzz();
  }

  _showAwake() {
    if (!this.cat) return;
    this._hideZzz();
    this.cat.curled.setVisible(false);
    this.cat.body.setVisible(true);
    this._applyHatVisibility();
    // Hungry Cat v1: she may have fallen asleep hungry — the bubble
    // comes back with the wake, as long as the window is still open
    // (this.hungry is still true; the server clears it at window end).
    if (this.hungry) this._showHungerBubble();
    const target = this._randomWanderPoint();
    this.cat.tx = target.x; this.cat.ty = target.y;
    this.cat.state = 'wander';
    this.cat.idleMs = 400 + Math.random() * 800;
    // Sunbeam goes back to its usual spot until she sleeps again.
    if (this.sunbeam && this.sunbeamSpot) {
      try {
        this.sunbeam.clear();
        this.sunbeam.fillStyle(0xffe98a, 0.16);
        this.sunbeam.fillEllipse(this.sunbeamSpot.x, this.sunbeamSpot.y, 150, 70);
        this.sunbeam.fillStyle(0xffe98a, 0.22);
        this.sunbeam.fillEllipse(this.sunbeamSpot.x, this.sunbeamSpot.y, 90, 42);
        this.sunbeam.setAlpha(0.55);
      } catch {}
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

  /** Sleeping cat within INTERACT_RANGE of (x, y) — or null. Used so
   * petting a sleeping cat explains itself instead of silently doing
   * nothing (she only wakes when someone new walks in). */
  nearestSleepingCat(x, y) {
    if (!this.cat || !this.asleep) return null;
    const d = Math.hypot(this.cat.x - x, this.cat.y - y);
    return d < INTERACT_RANGE ? this.cat : null;
  }

  update(delta) {
    const cat = this.cat;
    if (!cat || !cat.container || !cat.container.active) return;
    // Hungry Cat v1: the bubble rides above her while she wanders
    // (and while she follows you) — repositioned every frame, like
    // the prompts. She does not move while asleep, and the bubble
    // is hidden then anyway.
    if (this.hungerBubble && this.hungry && !this.asleep) {
      try { this.hungerBubble.setPosition(cat.x, cat.y - 40).setAlpha(1); } catch {}
    }
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
    // Hungry Cat v1: the bubble is scene-level (it follows her), so
    // it needs its own destroy — hiding alone would leak it across
    // floor switches.
    try { this.hungerBubble?.destroy(); } catch {}
    this.hungerBubble = null;
    this.followUntil = 0;
  }

  destroy() {
    this._clearEntities();
    this.sunbeamSpot = null;
    this.scene = null;
  }
}
