// ChristmasLightsQuest.js — Christmas Lights (Christmas Lights v1,
// `sq-christmas-lights-v1`; v1.1 `sq-christmas-lights-v1.1` — hang range
// 170 -> 100 (lightState.js) and the hang toast now carries the lit
// count, e.g. "(1 of 25 lit)", from the state after the hang lands;
// v1.2 `sq-christmas-multi-v1.2` — every hang counts, the
// one-per-person rule is gone, and coins pay per counted hang;
// v1.3 `sq-christmas-lights-v1.3` — the hang spot is now a LIST:
// the bar wall plus a spot on the strands at each corner of the
// cafe, so hanging works from any corner, not just the bar).
// v1.4 `sq-christmas-lights-v1.4` — the bulb lights nearest to
// where the player hung it: the hang spot rides with the
// `light_hang` emit, the server lights the nearest unlit slot to
// it, and the strands draw state.lit instead of slots[0..counted).
//
// A box of FREE light strings sits in the south-east corner of
// Agora. Take one, walk to any strand — the north wall above the
// coffee bar, or any corner of the room — and hang it. 25 counted
// strings light the room; the bulbs appear along the walls as more
// along the walls as more strings go up, and when the 25th
// lands the counter-front strand switches on too. The state is
// SHARED: everyone in the room sees the same strands, the same
// count (server/socket.js `light_hang` / `get_lights`, in-memory
// per room like the group puzzle — a server restart wipes it,
// exactly like Trim the Tree before `sq-tree-persist-v1`).
//
// MULTI-HANG (v1.2, `sq-christmas-multi-v1.2` — user decision):
// every hang counts toward the 25, no per-person cap — there are
// not 25 users yet to finish a room the old way. The tracker
// shows X/25 and the hang toast states the count plainly; there
// is nothing left to hide.
//
// One round per venue: when the room is lit, the quest is done
// here (unlike the tree, there is no second round — the lights
// stay up as decor until a server restart wipes the in-memory
// state).
//
// Reward: a badge (wired into the existing badges system, one
// badge per completed quest, once ever) + 5 coins per counted
// hang, paid client-side as hangs land (see _payForCountedHangs —
// the paid count is tracked per profile in localStorage, so a
// hang pays exactly once, including across a refresh).
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

// BUILDER DECISION — box + hang spots in Agora (free spots that do
// not collide with the coffee bar (north wall), entrance (bottom
// centre), couches, tables, plants, trash can, portrait, the
// ornament box, or the trees):
//   box — south-east corner, (1430, 770): opposite the ornament
//     box (170, 760), clear of Table 3 (1260,640), the east plant
//     (1470,690), and the entrance (700-900, 780). Inside the
//     boundary (y max 820).
//   hang spots — v1.3 (`sq-christmas-lights-v1.3`): v1 had ONE spot,
//     the north wall above the coffee bar, (800, 190) — so hanging
//     "didn't work" at the corners, which is exactly where the user
//     expected it to work (the strands run along the walls). The
//     spot is now a list; the bar spot is kept FIRST (it is also
//     LIGHTS_HANG_SPOT, for callers that only know the bar), plus
//     one spot on the strands at each corner:
//       bar (800, 190) — north wall above the coffee bar; the bar
//         counter spans x 420-1180 at y 110-174, so the player
//         walks up to the bar front to hang a strand. The barista
//         patrols y 212 across the same span — she walks through
//         the hang zone, which is fine (she is an NPC, not a solid).
//       NW (220, 170) — where the north and west strands meet;
//         clear of the NW plant (130,180) and Table 1 (300,280).
//       NE (1380, 170) — where the north and east strands meet;
//         clear of the trash can (1230,120) and the NE plant
//         (1470,260).
//       SE (1420, 620) — the lower east strand (bulb (1490,613) is
//         71px away); 151px from the lights box, so outside its
//         140px take range — the E key hangs here instead of
//         offering another string. The corner itself is taken by
//         the east plant (1470,690) and the box, so this is the
//         lowest reachable point on the east strand.
//       SW (180, 600) — the lower west strand (bulb (110,555) is
//         84px away); 160px from the ornament box, so outside its
//         140px take range. The corner itself is taken by the west
//         plant (130,690) and the box, so this is the lowest
//         reachable point on the west strand.
//     The east/west strands pass within the trees' 170px hang
//     ranges (tree 1 (1400,480), tree 2 (190,470)) — the SE/SW
//     spots are inside them. That is handled in the SCENE, not
//     here: with a light string in hand, the lights hang wins the
//     E key over the tree (see VillageScene.js getInteractKind),
//     and the tree prompt stays quiet while carrying a light
//     string (see the prompt branches). Without that priority the
//     corner spots would hang ornaments instead of lights.
// The box and the strands are NOT solid (same as the puzzle table):
// players walk under the wall strands freely.
export const LIGHTS_BOX_POS = { x: 1430, y: 770 };
export const LIGHTS_HANG_SPOT = { x: 800, y: 190 };
// The hang tap zone is the bar's span on the north wall.
export const LIGHTS_HANG_TAP = { xMin: 420, xMax: 1180, yMin: 130, yMax: 240 };
// v1.3 (`sq-christmas-lights-v1.3`): every spot a string can be hung
// from — the bar wall first, then the four corners, in the order
// above. nearestHangSpot returns the NEAREST in-range spot, so the
// prompt and the E key work at any of them; hangTapAt accepts a
// click on any of them. The 100px range (lightState.js,
// LIGHTS_HANG_RANGE) is unchanged and applies per spot.
export const LIGHTS_HANG_SPOTS = [
  LIGHTS_HANG_SPOT,
  { x: 220, y: 170 }, // north-west corner
  { x: 1380, y: 170 }, // north-east corner
  { x: 1420, y: 620 }, // south-east, lower east strand
  { x: 180, y: 600 }, // south-west, lower west strand
];
// Click half-extents for a corner spot's tap zone — the same 48x40
// box the lights box itself uses (see boxTapAt), so a click on the
// strand near a corner spot counts. The bar keeps its wide rect
// (LIGHTS_HANG_TAP) instead.
const CORNER_TAP_HALF_X = 48;
const CORNER_TAP_HALF_Y = 40;

/**
 * Which hang spot did a click at world (wx, wy) land on — the bar
 * span, or a corner spot's tap box — or null. Pure, so tests can
 * call it without a scene. v1.3 (`sq-christmas-lights-v1.3`).
 */
export function spotForTap(wx, wy) {
  if (wx >= LIGHTS_HANG_TAP.xMin && wx <= LIGHTS_HANG_TAP.xMax && wy >= LIGHTS_HANG_TAP.yMin && wy <= LIGHTS_HANG_TAP.yMax) {
    return LIGHTS_HANG_SPOT;
  }
  for (const spot of LIGHTS_HANG_SPOTS) {
    if (spot === LIGHTS_HANG_SPOT) continue;
    if (Math.abs(wx - spot.x) <= CORNER_TAP_HALF_X && Math.abs(wy - spot.y) <= CORNER_TAP_HALF_Y) {
      return spot;
    }
  }
  return null;
}

// Per-profile paid-lights counts (v1.2, `sq-christmas-multi-v1.2`):
// coins pay +5 per COUNTED hang, as hangs land — not once on
// completion. The guard is a per-profile count of hangs already
// paid for, in localStorage under 'sidequest-lights-paid-counts'
// ({ owner -> number }). The guard is written BEFORE the async
// wallet call, so a double broadcast can never pay twice; a
// refresh/reconnect re-reads the state and pays only the
// difference. A server restart wipes the in-memory room state, so
// hungBy restarts at 0 — the diff helper treats a lower counted
// total than the stored paid count as a fresh epoch (see
// owedLightHangs). Same profile scoping as QuestManager /
// TrimTreeQuest. (Guests share the 'shared' owner — pre-existing,
// same as v1.)
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

function loadPaidLightCounts() {
  try {
    const raw = localStorage.getItem('sidequest-lights-paid-counts');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  // Migrate the v1 boolean guard ('sidequest-lights-paid',
  // { owner: true } — paid +5 once on completion): a v1 contributor
  // had exactly one counted hang, so true migrates to a count of 1.
  try {
    const old = JSON.parse(localStorage.getItem('sidequest-lights-paid') || '{}');
    const migrated = {};
    for (const [owner, v] of Object.entries(old || {})) {
      if (v === true) migrated[owner] = 1;
    }
    return migrated;
  } catch {
    return {};
  }
}

function savePaidLightCounts(paid) {
  try { localStorage.setItem('sidequest-lights-paid-counts', JSON.stringify(paid)); } catch {}
}

/**
 * Pure diff for the per-hang payment: how many of my counted hangs
 * are still unpaid, and what the paid count becomes. `myCounted` is
 * my total hangs in the current room state (hungBy[me]); `paidCount`
 * is how many I have already been paid for. A counted total LOWER
 * than the paid count means the room state was wiped (server
 * restart) and started over — a fresh epoch, so the paid count
 * resets to 0 and the current hangs pay in full. Returns
 * { owed, newPaid } — `owed` is the number of hangs to pay for now.
 */
export function owedLightHangs(myCounted, paidCount) {
  const counted = Math.max(0, Number(myCounted) || 0);
  const paid = Math.max(0, Number(paidCount) || 0);
  if (counted <= 0) return { owed: 0, newPaid: paid };
  if (counted < paid) return { owed: counted, newPaid: counted };
  return { owed: counted - paid, newPaid: counted };
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
    // My hang, confirmed: I am a contributor now — every hang
    // counts (v1.2), so any confirmed pending hang means I counted.
    // The pending flag clears either way.
    if (this._pendingHang) {
      if (next.contributors.includes(this._myUserId())) {
        this.iCounted = true;
      }
      this._pendingHang = false;
      // v1.1 (`sq-christmas-lights-v1.1`): the hang toast carries the
      // real lit count, from this server-confirmed state — so the
      // player can see the room filling in instead of wondering what
      // one bulb means. (When this hang finished the room, the
      // completion toast below is the feedback instead, so no count
      // toast here.)
      if (!next.completed) {
        try { this.scene?.onSystemNotice?.(`💡 You hung a string of lights! (${next.counted} of ${LIGHTS_TOTAL} lit)`); } catch {}
      }
    }
    // Per-hang payment (v1.2, `sq-christmas-multi-v1.2`): pay for
    // any of my counted hangs not yet paid for — this also heals a
    // missed broadcast after a refresh/reconnect.
    this._payForCountedHangs(next);
    // The room just lit up: badge contributors, once.
    if (next.completed && !prev.completed) {
      this._onLightsCompleted(next);
    }
    this.state = next;
    this._drawAll();
    this._bumpHud();
  }

  /**
   * Pay +5 coins per counted hang of mine not yet paid for (v1.2,
   * `sq-christmas-multi-v1.2`). Reads my total hangs from the room
   * state (hungBy[me]), diffs against the per-profile paid count
   * in localStorage, and pays only the difference — a duplicate
   * broadcast pays nothing, and a refresh/reconnect pays exactly
   * the hangs that landed while I was away. The paid count is
   * written BEFORE the async wallet call, so a crash mid-payment
   * cannot double-pay either. Silent per hang: the coins just land
   * in the wallet (the hang toast already shows the count).
   */
  _payForCountedHangs(state) {
    try {
      const counted = Number(state?.hungBy?.[this._myUserId()]) || 0;
      if (counted <= 0) return;
      const owner = currentOwner();
      const paid = loadPaidLightCounts();
      const { owed, newPaid } = owedLightHangs(counted, paid[owner]);
      if (owed <= 0) return;
      paid[owner] = newPaid;
      savePaidLightCounts(paid);
      const coins = owed * LIGHTS_REWARD_COINS;
      try {
        import('./CoinWallet.js')
          .then((m) => m.earnCoins(coins, 'christmas-lights'))
          .catch(() => {});
      } catch {}
    } catch {}
  }

  /** The room just lit up (maybe by me, maybe by the room). */
  _onLightsCompleted(state) {
    const banner = {
      id: 'christmas-lights',
      emoji: '💡',
      title: 'Agora Is Lit!',
      description: '25 strings hung — the whole room is glowing for Christmas!',
      rewardCoins: LIGHTS_REWARD_COINS,
    };
    try { this.scene?.questManager?.showQuestBannerFor?.(banner); } catch {}
    if (this.iCounted) {
      // Quest badges v1: helping light the room earns the Christmas
      // Lights badge, once ever. The server awards the same badge
      // to every contributor, so both paths converge. (Coins are
      // NOT paid here any more — v1.2 pays +5 per counted hang as
      // hangs land, in _payForCountedHangs.)
      try { this.scene?.questManager?.recordLightsCompletion?.(); } catch {}
    }
    this.scene?.questManager?.showToast?.('🎉 Agora is fully lit for Christmas!');
  }

  _bumpHud() {
    try { this.scene?.questManager?.bumpHud?.(); } catch {}
  }

  // ---- taking + hanging light strings --------------------------------

  /** Take a free light string from the box. You can only carry one
   *  at a time — and you can take another after hanging one, as
   *  many times as you like (v1.2, `sq-christmas-multi-v1.2`: every
   *  hang counts, no one-per-person limit). Refusals all SPEAK. */
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
    this.carrying = true;
    this._updateCarryIndicator();
    try { this.scene?.onSystemNotice?.('💡 You took a string of lights from the box. Hang it on the wall!'); } catch {}
    return { ok: true };
  }

  /** Hang the light string I am carrying on a strand (v1.3,
   *  `sq-christmas-lights-v1.3`: the bar wall or any corner).
   *  `spot` is the hang spot actually used — the tap path passes
   *  its spot in; the E-key path finds the nearest spot to the
   *  player (v1.4, `sq-christmas-lights-v1.4`: the spot rides with
   *  the emit, so the server lights the bulb nearest to where the
   *  player hung it instead of slot 0 on the far north wall). */
  hangLight(spot) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (!this.carrying) return { ok: false, reason: 'no-lights' };
    if (this.state.completed) return { ok: false, reason: 'all-done' };
    this._pendingHang = true;
    this.carrying = false;
    this._updateCarryIndicator();
    const useSpot = spot || this._spotForHang();
    const socket = this.scene?.socket;
    if (socket?.connected) {
      // The server validates and broadcasts the new state to the
      // room; applyState confirms it — and v1.1
      // (`sq-christmas-lights-v1.1`) toasts the lit count there,
      // from the server-confirmed state, instead of guessing here.
      // v1.4 (`sq-christmas-lights-v1.4`): the hang spot goes with
      // the emit so the bulb lands where the player stood.
      try {
        socket.emit('light_hang', {
          roomId: this.scene.roomId,
          ...(useSpot ? { x: useSpot.x, y: useSpot.y } : {}),
        });
      } catch {}
      return { ok: true, pending: true };
    }
    // Offline: apply locally so the quest still works solo.
    const res = hangLight(this.state, this._myUserId(), useSpot);
    if (!res.ok) return res;
    if (res.counted) this.iCounted = true;
    // v1.2 (`sq-christmas-multi-v1.2`): pay for this hang now, from
    // the local state the hang just updated.
    this._payForCountedHangs(this.state);
    // v1.1 (`sq-christmas-lights-v1.1`): same count toast as the
    // online path, from the local state the hang just updated.
    // (When this hang finished the room, the completion toast in
    // _onLightsCompleted below is the feedback instead.)
    this._afterLocalChange(res.finished ? null : `💡 You hung a string of lights! (${this.state.counted} of ${LIGHTS_TOTAL} lit)`);
    if (res.finished) this._onLightsCompleted(this.state);
    return { ok: true, counted: res.counted };
  }

  /** The hang spot the player is standing at (E key) — the nearest
   *  in-range spot, or null. v1.4 (`sq-christmas-lights-v1.4`). */
  _spotForHang() {
    const player = this.scene?.player;
    if (!player) return null;
    return this.nearestHangSpot(player.gx, player.gy);
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

  /** One click at world (wx, wy): on a strand — the bar span on the
   *  north wall, or a corner spot's tap zone (v1.3,
   *  `sq-christmas-lights-v1.3`: the tap zone used to be the bar
   *  span only, so clicks on the corner strands did nothing) — hang
   *  the string I am carrying (if standing close enough to THAT
   *  spot). Silent unless it hangs — clicks on a finished room,
   *  or with empty hands, do nothing. Returns { ok, hung? }. */
  hangTapAt(wx, wy) {
    if (!this.enabled || this.state.completed) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const spot = spotForTap(wx, wy);
    if (!spot) return { ok: false, reason: 'no-spot' };
    if (Math.hypot(player.gx - spot.x, player.gy - spot.y) > LIGHTS_HANG_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    // v1.4 (`sq-christmas-lights-v1.4`): the tap spot rides with
    // the hang, so the bulb lights on the strand that was clicked.
    const res = this.hangLight(spot);
    return { ...res, hung: res.ok };
  }

  /** The lights box within take range of (px, py) — or null (E key). */
  nearestBox(px, py) {
    if (!this.enabled || this.state.completed) return null;
    return Math.hypot(px - LIGHTS_BOX_POS.x, py - LIGHTS_BOX_POS.y) <= LIGHTS_BOX_TAKE_RANGE
      ? { x: LIGHTS_BOX_POS.x, y: LIGHTS_BOX_POS.y }
      : null;
  }

  /** The nearest hang spot within hang range of (px, py) — or null
   *  (E key). v1.3 (`sq-christmas-lights-v1.3`): the nearest of the
   *  whole spot list, not just the bar wall — so the prompt and the
   *  E key work at any corner. */
  nearestHangSpot(px, py) {
    if (!this.enabled || this.state.completed) return null;
    let best = null;
    let bestD = Infinity;
    for (const spot of LIGHTS_HANG_SPOTS) {
      const d = Math.hypot(px - spot.x, py - spot.y);
      if (d <= LIGHTS_HANG_RANGE && d < bestD) {
        best = spot;
        bestD = d;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
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
   *  lights), bulbs light up per counted hang. Stage 4+ switches on
   *  the counter-front strand; a finished room gets a warm glow
   *  around every bulb. */
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
    // Counted bulbs, in their slots, in hang order (v1.4,
    // `sq-christmas-lights-v1.4`): state.lit lists the lit slot
    // indices in the order they lit — the bulb appears nearest to
    // where its string was hung. NOT slots[0..counted), which lit
    // the far north wall first no matter where the player stood.
    for (const idx of (state.lit || [])) {
      const slot = LIGHTS_BULB_SLOTS[idx];
      if (slot) this._drawBulb(g, slot.x, slot.y, bulbColor(idx), state.completed);
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
