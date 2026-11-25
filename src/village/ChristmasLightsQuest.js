// ChristmasLightsQuest.js — Christmas Lights (Christmas Lights v1,
// `sq-christmas-lights-v1`).
//
// A box of FREE light strings sits in the south-east corner of
// Agora. Take one, walk to the north wall above the coffee bar,
// hang it. 25 counted strings light the room; the bulbs appear
// along the walls as more people contribute, and when the 25th
// lands the counter-front strand switches on too. The state is
// SHARED: everyone in the room sees the same strands, the same
// count (server/socket.js `light_hang` / `get_lights`, in-memory
// per room like the group puzzle — a server restart wipes it,
// exactly like Trim the Tree before `sq-tree-persist-v1`).
//
// HIDDEN RULE (never explained in the UI — no text anywhere says
// it): a player can hang as many strings as they like and the
// process always works, but only their FIRST string counts toward
// the 25. Extras still render as bulbs on the walls (the player
// sees their lights go up) — they just do not advance the X/25
// counter. The tracker only ever shows X/25, and the hang feedback
// is IDENTICAL for a counted hang and an extra one, or the rule
// would leak.
//
// One round per venue: when the room is lit, the quest is done
// here (unlike the tree, there is no second round — the lights
// stay up as decor until a server restart wipes the in-memory
// state).
//
// Reward: a badge (wired into the existing badges system, one
// badge per completed quest, once ever) + 5 coins to each counted
// contributor, same as Trim the Tree / Group Puzzle.
//
// Owned by VillageScene: constructed in create(), ticked in
// update(), destroyed in shutdown(), refreshed on floor switches.
// Agora only (roomId === 'agora-houston'); every other room is a
// no-op. Trim the Tree, the puzzle, the boards and the shop are NOT
// touched by this quest.

import { DEPTH } from './depth.js';
import {
  LIGHTS_MARKER_V1,
  LIGHTS_TOTAL,
  LIGHTS_REWARD_COINS,
  LIGHTS_BOX_TAKE_RANGE,
  LIGHTS_HANG_RANGE,
  LIGHTS_BULB_SLOTS,
  LIGHTS_EXTRA_SLOTS,
  bulbColor,
  createLightState,
  lightsProgress,
  lightsStage,
  hangLight,
  serializeLightState,
  parseLightState,
} from './lightState.js';

const AGORA_ROOM_ID = 'agora-houston';
const RESPAWN_CHECK_MS = 1000; // how often update() re-checks the strands/box

// BUILDER DECISION — box + hang spot in Agora (free spots that do
// not collide with the coffee bar (north wall), entrance (bottom
// centre), couches, tables, plants, trash can, portrait, the
// ornament box, or the trees):
//   box — south-east corner, (1430, 770): opposite the ornament
//     box (170, 760), clear of Table 3 (1260,640), the east plant
//     (1470,690), and the entrance (700-900, 780). Inside the
//     boundary (y max 820).
//   hang spot — the north wall above the coffee bar, (800, 190):
//     the bar counter spans x 420-1180 at y 110-174, so the player
//     walks up to the bar front to hang a strand. The barista
//     patrols y 212 across the same span — she walks through the
//     hang zone, which is fine (she is an NPC, not a solid).
// The box and the strands are NOT solid (same as the puzzle table):
// players walk under the wall strands freely.
export const LIGHTS_BOX_POS = { x: 1430, y: 770 };
export const LIGHTS_HANG_SPOT = { x: 800, y: 190 };
// The hang tap zone is the bar's span on the north wall.
export const LIGHTS_HANG_TAP = { xMin: 420, xMax: 1180, yMin: 130, yMax: 240 };

// Per-profile paid-lights guard (same profile scoping as
// QuestManager / TrimTreeQuest): a counted contributor is paid +5
// exactly once for lighting the room.
function currentOwner() {
  try {
    const raw = localStorage.getItem('sidequest_profile');
    if (!raw) return 'shared';
    const p = JSON.parse(raw);
    const id = p?.email || p?.profile?.email || p?.id || p?.profile?.id || p?.userId || p?.profile?.userId;
    return String(id || '').trim().toLowerCase() || 'shared';
  } catch {
    return 'shared';
  }
}

function loadPaidLights() {
  try {
    const raw = localStorage.getItem('sidequest-lights-paid');
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export class ChristmasLightsQuest {
  constructor(scene) {
    this.scene = scene;
    // sq-christmas-lights-v1 — marker for the v1 landing check.
    this.marker = LIGHTS_MARKER_V1;
    this.state = createLightState();
    this.carrying = false; // I am holding a light string from the box
    this._carryText = null; // carried-string marker above my head
    this.iCounted = false; // my first string counted toward the 25
    this._strandsContainer = null;
    this._boxContainer = null;
    this._pendingHang = false; // my hang is awaiting server confirm
    this._pendingWasContributor = false;
    this._lastCheckMs = 0;
  }

  get enabled() {
    return this.scene?.roomId === AGORA_ROOM_ID;
  }

  _myUserId() {
    return this.scene?.userId || this.scene?.socket?.id || '__local__';
  }

  /** Room progress for the tracker: { counted, total, completed }. */
  getProgress() {
    if (!this.enabled) return null;
    return lightsProgress(this.state);
  }

  /** (Re)build the strands + box in Agora; clear elsewhere. */
  refresh() {
    this._clearEntities();
    if (!this.enabled) return;
    this._drawAll();
    this._requestState();
  }

  _requestState() {
    try {
      if (this.scene?.socket?.connected) {
        this.scene.socket.emit('get_lights', { roomId: this.scene.roomId });
      }
    } catch {}
  }

  /** Apply the server's canonical state (or a local fallback). */
  applyState(payload = {}) {
    const prev = this.state;
    const next = parseLightState(payload);
    // My hang, confirmed: I am a contributor now, and I was not one
    // before — my first string counted. A hang the server counted
    // as an extra leaves this false (I was already a contributor),
    // and a rejected hang never appears here at all. The pending
    // flag clears either way.
    if (this._pendingHang) {
      if (next.contributors.includes(this._myUserId()) && !this._pendingWasContributor) {
        this.iCounted = true;
      }
      this._pendingHang = false;
      this._pendingWasContributor = false;
    }
    // The room just lit up: pay + badge contributors, once.
    if (next.completed && !prev.completed) {
      this._onLightsCompleted(next);
    }
    this.state = next;
    this._drawAll();
    this._bumpHud();
  }

  /** The room just lit up (maybe by me, maybe by the room). */
  _onLightsCompleted(state) {
    const banner = {
      id: 'christmas-lights',
      emoji: '💡',
      title: 'Agora Is Lit!',
      description: '25 people hung lights — the whole room is glowing for Christmas!',
      rewardCoins: LIGHTS_REWARD_COINS,
    };
    try { this.scene?.questManager?.showQuestBannerFor?.(banner); } catch {}
    if (this.iCounted) {
      // Quest badges v1: helping light the room earns the Christmas
      // Lights badge, once ever. The server awards the same badge
      // to every contributor, so both paths converge.
      try { this.scene?.questManager?.recordLightsCompletion?.(); } catch {}
      const paid = loadPaidLights();
      const owner = currentOwner();
      if (!paid[owner]) {
        // Pay once: record it BEFORE the async wallet call, so a
        // double broadcast can't pay twice.
        paid[owner] = true;
        try { localStorage.setItem('sidequest-lights-paid', JSON.stringify(paid)); } catch {}
        try {
          import('./CoinWallet.js')
            .then((m) => m.earnCoins(LIGHTS_REWARD_COINS, 'christmas-lights'))
            .catch(() => {});
        } catch {}
        this.scene?.questManager?.showToast?.(
          `🎉 Agora is fully lit! +${LIGHTS_REWARD_COINS} coins.`,
        );
        return;
      }
    }
    this.scene?.questManager?.showToast?.('🎉 Agora is fully lit for Christmas!');
  }

  _bumpHud() {
    try { this.scene?.questManager?.bumpHud?.(); } catch {}
  }

  // ---- taking + hanging light strings --------------------------------

  /** Take a free light string from the box. You can only carry one
   *  at a time, and only one string per person counts — the
   *  refusals all SPEAK (the tree's refusals were silent before
   *  the Carry Ornament kit; that is not repeated here). */
  takeLight() {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (this.state.completed) {
      try { this.scene?.onSystemNotice?.('💡 The room is fully lit — thank you!'); } catch {}
      return { ok: false, reason: 'all-done' };
    }
    if (this.carrying) {
      try { this.scene?.onSystemNotice?.("💡 You're already holding a string of lights — hang it on the wall first."); } catch {}
      return { ok: false, reason: 'already-carrying' };
    }
    // One per person: one counted string per room. The server
    // already counts only your first hang (contributors); the box
    // just stops handing out seconds. Contributors come from
    // server state, so the limit survives a refresh; the pending
    // check covers the ~1s before the server confirms my hang.
    const alreadyCounted = this.state.contributors?.includes(this._myUserId())
      || this._pendingHang;
    if (alreadyCounted) {
      try { this.scene?.onSystemNotice?.("💡 You've already hung your lights — one per person!"); } catch {}
      return { ok: false, reason: 'already-took' };
    }
    this.carrying = true;
    this._updateCarryIndicator();
    try { this.scene?.onSystemNotice?.('💡 You took a string of lights from the box. Hang it on the wall!'); } catch {}
    return { ok: true };
  }

  /** Hang the light string I am carrying on the north wall. The
   *  feedback is IDENTICAL whether the hang counted or was an extra
   *  (the hidden rule must not leak): the same toast either way. */
  hangLight() {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (!this.carrying) return { ok: false, reason: 'no-lights' };
    if (this.state.completed) return { ok: false, reason: 'all-done' };
    this._pendingHang = true;
    this._pendingWasContributor = (this.state.contributors || []).includes(this._myUserId());
    this.carrying = false;
    this._updateCarryIndicator();
    const socket = this.scene?.socket;
    if (socket?.connected) {
      // The server validates (first-only counting) and broadcasts
      // the new state to the room; applyState confirms it.
      try { socket.emit('light_hang', { roomId: this.scene.roomId }); } catch {}
      try { this.scene?.onSystemNotice?.('💡 You hung a string of lights!'); } catch {}
      return { ok: true, pending: true };
    }
    // Offline: apply locally so the quest still works solo.
    const res = hangLight(this.state, this._myUserId());
    if (!res.ok) return res;
    if (res.counted) this.iCounted = true;
    this._afterLocalChange('💡 You hung a string of lights!');
    if (res.finished) this._onLightsCompleted(this.state);
    return { ok: true, counted: res.counted };
  }

  _afterLocalChange(notice) {
    this._drawAll();
    this._bumpHud();
    if (notice) {
      try { this.scene?.onSystemNotice?.(notice); } catch {}
    }
  }

  /** One click at world (wx, wy): on the lights box, take a string
   *  (if standing close enough). Silent unless it takes — clicks
   *  elsewhere do nothing. Returns { ok, took? }. */
  boxTapAt(wx, wy) {
    if (!this.enabled || this.state.completed) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    if (Math.abs(wx - LIGHTS_BOX_POS.x) > 48 || Math.abs(wy - LIGHTS_BOX_POS.y) > 40) {
      return { ok: false, reason: 'no-spot' };
    }
    if (Math.hypot(player.gx - LIGHTS_BOX_POS.x, player.gy - LIGHTS_BOX_POS.y) > LIGHTS_BOX_TAKE_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    const res = this.takeLight();
    return { ...res, took: res.ok };
  }

  /** One click at world (wx, wy): on the north wall above the
   *  coffee bar, hang the string I am carrying (if standing close
   *  enough). Silent unless it hangs — clicks on a finished room,
   *  or with empty hands, do nothing. Returns { ok, hung? }. */
  hangTapAt(wx, wy) {
    if (!this.enabled || this.state.completed) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    if (wx < LIGHTS_HANG_TAP.xMin || wx > LIGHTS_HANG_TAP.xMax || wy < LIGHTS_HANG_TAP.yMin || wy > LIGHTS_HANG_TAP.yMax) {
      return { ok: false, reason: 'no-spot' };
    }
    if (Math.hypot(player.gx - LIGHTS_HANG_SPOT.x, player.gy - LIGHTS_HANG_SPOT.y) > LIGHTS_HANG_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    const res = this.hangLight();
    return { ...res, hung: res.ok };
  }

  /** The lights box within take range of (px, py) — or null (E key). */
  nearestBox(px, py) {
    if (!this.enabled || this.state.completed) return null;
    return Math.hypot(px - LIGHTS_BOX_POS.x, py - LIGHTS_BOX_POS.y) <= LIGHTS_BOX_TAKE_RANGE
      ? { x: LIGHTS_BOX_POS.x, y: LIGHTS_BOX_POS.y }
      : null;
  }

  /** The north-wall hang spot within hang range of (px, py) — or null (E key). */
  nearestHangSpot(px, py) {
    if (!this.enabled || this.state.completed) return null;
    return Math.hypot(px - LIGHTS_HANG_SPOT.x, py - LIGHTS_HANG_SPOT.y) <= LIGHTS_HANG_RANGE
      ? { x: LIGHTS_HANG_SPOT.x, y: LIGHTS_HANG_SPOT.y }
      : null;
  }

  // ---- drawing ----------------------------------------------------------

  _drawAll() {
    this._clearEntities();
    if (!this.enabled) return;
    this._drawBox();
    this._drawStrands();
  }

  _drawBox() {
    const scene = this.scene;
    const { x, y } = LIGHTS_BOX_POS;
    const g = scene.add.graphics();
    // Wooden box with a lid, a few glowing bulbs peeking out of it.
    g.fillStyle(0x8b5a2b, 1);
    g.fillRect(-32, -20, 64, 42);
    g.fillStyle(0x6b4226, 1);
    g.fillRect(-34, -26, 68, 10);
    g.fillStyle(0xa16207, 1);
    g.fillRect(-4, -26, 8, 48);
    g.lineStyle(1.5, 0x2b2b33, 1);
    g.strokeRect(-32, -20, 64, 42);
    g.fillStyle(0xfef08a, 0.35);
    g.fillCircle(-18, -28, 8);
    g.fillStyle(0xef4444, 1);
    g.fillCircle(-18, -28, 4);
    g.fillStyle(0xfef08a, 0.35);
    g.fillCircle(0, -32, 8);
    g.fillStyle(0x22c55e, 1);
    g.fillCircle(0, -32, 4);
    g.fillStyle(0xfef08a, 0.35);
    g.fillCircle(18, -28, 8);
    g.fillStyle(0x3b82f6, 1);
    g.fillCircle(18, -28, 4);
    const label = scene.add.text(
      0, -48,
      '💡 Lights Box · FREE',
      { fontSize: '12px', color: '#1a4971', backgroundColor: 'rgba(255,255,255,0.92)', padding: { x: 6, y: 3 } },
    );
    label.setOrigin(0.5, 0.5);
    const container = scene.add.container(x, y, [g, label]);
    container.setDepth(DEPTH.ACTOR_MIN + Math.round(y));
    container.setSize(80, 90);
    this._boxContainer = container;
  }

  /** The wall strands: the wire is always there (unlit string
   *  lights), bulbs light up per counted hang, extras at the extra
   *  slots. Stage 4+ switches on the counter-front strand; a
   *  finished room gets a warm glow around every bulb. */
  _drawStrands() {
    const scene = this.scene;
    const state = this.state;
    const stage = lightsStage(state.counted);
    const g = scene.add.graphics();
    // The wire: a sagging line along each wall (north, east, west).
    g.lineStyle(1.5, 0x2b2b33, 0.8);
    this._drawWire(g, LIGHTS_BULB_SLOTS.slice(0, 10));
    this._drawWire(g, LIGHTS_BULB_SLOTS.slice(10, 17));
    this._drawWire(g, LIGHTS_BULB_SLOTS.slice(17, 25));
    // Counted bulbs, in their slots, in hang order. Extras render
    // at the extra slots — same sizes, so the hidden rule stays
    // hidden: nothing on the wall tells you which bulbs counted
    // and which did not.
    for (let i = 0; i < Math.min(state.counted, LIGHTS_TOTAL); i++) {
      const slot = LIGHTS_BULB_SLOTS[i];
      if (slot) this._drawBulb(g, slot.x, slot.y, bulbColor(i), state.completed);
    }
    for (let k = 0; k < state.extras; k++) {
      const slot = LIGHTS_EXTRA_SLOTS[k % LIGHTS_EXTRA_SLOTS.length];
      this._drawBulb(g, slot.x, slot.y, bulbColor(LIGHTS_TOTAL + k), state.completed);
    }
    // Counter-front strand — stage 4+ (19+ counted): a warm line
    // of bulbs along the front of the coffee bar (y 178, x 440-1160).
    if (stage >= 4) {
      const front = [];
      for (let x = 460; x <= 1140; x += 85) front.push({ x, y: 178 });
      this._drawWire(g, front);
      front.forEach((p, i) => this._drawBulb(g, p.x, p.y, bulbColor(i), state.completed));
    }
    const label = scene.add.text(
      800, 72,
      state.completed
        ? '💡 Agora is fully lit! 🎉'
        : `💡 Christmas Lights — ${state.counted}/${LIGHTS_TOTAL}`,
      { fontSize: '12px', color: '#1a4971', backgroundColor: 'rgba(255,255,255,0.92)', padding: { x: 6, y: 3 } },
    );
    label.setOrigin(0.5, 0.5);
    // Wall strands sit ON the wall: depth ACTOR_MIN puts them above
    // the floor (RoomLayout draws at GROUND + 1) and below every
    // player (ACTOR_MIN + y), so nobody walks in front of a strand
    // and gets covered by it.
    const container = scene.add.container(0, 0, [g, label]);
    container.setDepth(DEPTH.ACTOR_MIN);
    this._strandsContainer = container;
  }

  /** A sagging wire through a list of points (zigzag, like the
   *  tree's tinsel garlands). */
  _drawWire(g, points) {
    if (!points || points.length < 2) return;
    let prev = points[0];
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      const midX = (prev.x + p.x) / 2;
      const midY = (prev.y + p.y) / 2 + 6;
      g.lineBetween(prev.x, prev.y, midX, midY);
      g.lineBetween(midX, midY, p.x, p.y);
      prev = p;
    }
  }

  /** One bulb: a warm glow halo + the coloured dot. A finished
   *  room gets the bigger halo (everything glows brighter). */
  _drawBulb(g, x, y, color, completed) {
    const halo = completed ? 9 : 6;
    g.fillStyle(0xfef08a, completed ? 0.5 : 0.35);
    g.fillCircle(x, y, halo);
    g.fillStyle(color, 1);
    g.fillCircle(x, y, 4);
    g.fillStyle(0xffffff, 0.7);
    g.fillCircle(x - 1, y - 1, 1.5);
  }

  /** Carried-string marker (`sq-christmas-lights-v1`): while I am
   *  carrying a light string, a 💡 rides above my head so the state
   *  is visible — same pattern as the tree's 🎄 marker and the
   *  cat's "hungry..." bubble: a scene-level text repositioned
   *  every frame. Offset to the side so it never covers my name. */
  _updateCarryIndicator() {
    try {
      const player = this.scene?.player;
      const show = Boolean(this.carrying && this.enabled && player);
      if (!show) {
        this._carryText?.setAlpha(0);
        return;
      }
      if (!this._carryText) {
        this._carryText = this.scene.add.text(0, 0, '💡', { fontSize: '20px' });
        this._carryText.setOrigin(0.5, 1);
        this._carryText.setDepth(DEPTH.ACTOR_MIN + 500);
      }
      this._carryText.setPosition(player.gx + 22, player.gy - 56).setAlpha(1);
    } catch {}
  }

  update() {
    // Keep the carried-string marker on my head every frame.
    this._updateCarryIndicator();
    if (!this.enabled) return;
    const now = Date.now();
    if (now - (this._lastCheckMs || 0) < RESPAWN_CHECK_MS) return;
    this._lastCheckMs = now;
    // The strands re-spawn if a floor switch cleared them.
    if (!this._boxContainer || !this._strandsContainer) this._drawAll();
  }

  _clearEntities() {
    try { this._boxContainer?.destroy(); } catch {}
    this._boxContainer = null;
    try { this._strandsContainer?.destroy(); } catch {}
    this._strandsContainer = null;
  }

  destroy() {
    this._clearEntities();
    try { this._carryText?.destroy(); } catch {}
    this._carryText = null;
    this.scene = null;
  }
}
