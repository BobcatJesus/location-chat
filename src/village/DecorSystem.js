// DecorSystem.js — the in-room side of the Decoration Shop
// (`sq-dec-shop-v1`, fix `sq-dec-shop-v1-1`).
//
// Owned by VillageScene, same shape as NoticeBoardSystem /
// TrimTreeQuest: constructed in create(), refreshed on floor
// switches, destroyed in shutdown(). Two jobs:
//
//   1. THE SHOP (Agora only): buy Christmas decorations at the
//      coffee bar. The bar offers coffee (-2 coins, existing) or a
//      decoration — ornament 5, lights 10, snowman 15, tree 25,
//      Santa 20 (tree and Santa are builder picks; Krampus is NOT
//      sold — the user deferred him). Buying is local (coins +
//      pocket, see items.buyDecoration): a full pocket refuses the
//      sale BEFORE any coins are taken.
//   2. PLACED DECORATIONS (every room): a bought decoration goes
//      into the pocket; "Place" in the inventory puts it where you
//      are standing, and EVERYONE in the room sees it. State is
//      SERVER state (server/socket.js, in-memory per room like the
//      notice board): placing and taking back go through the socket
//      and every player in the room sees the same decorations. Each
//      room's decorations are separate.
//
// PLACING (from the inventory — a decoration's "Place" button): the
// decoration leaves the pocket ONLY when the server confirms the
// place (same pending pattern as pinning a flyer). If the place
// never lands (offline, rate-limited, room full), the decoration
// simply stays in the pocket — nothing is ever lost by placing.
//
// v1.1 (`sq-dec-shop-v1-1`): a pending place/pickup no longer waits
// forever. If no decor_state confirm arrives within
// DECOR_PENDING_TIMEOUT_MS (5s), the attempt times out with a
// retry notice (shown in the pocket panel's own notice line, since
// the scene toast sits UNDER the panel), state is re-requested, and
// the next decor_state rechecks whether the place actually landed.
// Placing is also gated on the room join being confirmed (first
// room_state after connecting) — the server silently drops
// decor_place before membership is registered. The scene also
// re-requests decor state on (re)connect (get_decor in the connect
// burst), which v1 forgot: a decoration stored during a disconnect
// window never came back.
//
// TAKING BACK: tap a placed decoration (or press E near it). Your
// OWN decoration comes back to your pocket if there is room —
// otherwise it stays placed and the pocket-full message shows. A
// moderator can take down ANY decoration; a moderator removal
// always discards it (same rule as the notice board). Someone
// else's decoration just says whose it is.

import { DEPTH } from './depth.js';
import {
  DEC_SHOP_MARKER_V1,
  DEC_SHOP_MARKER_V11,
  DECOR_KINDS,
  DECOR_KIND_IDS,
  DECOR_MAX_PER_ROOM,
  createDecorState,
  parseDecorState,
} from './decorState.js';
import { getCoins } from './CoinWallet.js';
import {
  INVENTORY_FULL_GENERIC,
  getItem,
  isFull,
  buyDecoration,
} from './items.js';

const AGORA_ROOM_ID = 'agora-houston';

// How close a click must land to a placed decoration to grab it,
// and how close the player must stand (same numbers as ground
// litter: 44px click, 90px stand — decorations use 42 / 110, a
// touch more forgiving because the shapes are small).
const DECOR_CLICK_RANGE = 42;
const DECOR_STAND_RANGE = 110;
// Where a placed decoration lands relative to the player: just
// below them, so it never sits exactly under the avatar.
const PLACE_OFFSET_Y = 52;

const ORNAMENT_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e', '#a855f7'];
const LIGHT_COLORS = ['#ef4444', '#fbbf24', '#22c55e', '#3b82f6', '#f59e0b'];

// Decoration Shop v1.1 (`sq-dec-shop-v1-1`): how long a pending place
// (or take-back) waits for the server's decor_state confirm before
// giving up with a retry notice instead of waiting forever. Five
// seconds is far above a healthy round trip (tens of ms on LAN /
// ~100-300ms over the internet) and far below "stuck forever".
export const DECOR_PENDING_TIMEOUT_MS = 5000;

function hashId(id) {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export class DecorSystem {
  constructor(scene) {
    this.scene = scene;
    // sq-dec-shop-v1 — marker for the v1 landing check.
    this.marker = DEC_SHOP_MARKER_V1;
    // sq-dec-shop-v1-1 — marker for the v1.1 landing check (live
    // reference so it survives minification, same pattern as v1).
    this.markerV11 = DEC_SHOP_MARKER_V11;
    this.state = createDecorState();
    this._containers = new Map(); // decor id -> Phaser container
    this._pendingPlace = null; // { id, itemId } awaiting the decor_state that confirms it
    this._pendingPickup = null; // { decorId, decor } awaiting the broadcast that confirms it
    // v1.1: a pending place/pickup no longer waits forever — each
    // arms a timeout (see _onPlaceTimeout / _onPickupTimeout). A
    // timed-out attempt moves to _unconfirmedPlace/_unconfirmedPickup
    // so the next decor_state can still settle it (the place may
    // have landed and only the broadcast was lost).
    this._placeTimer = null;
    this._pickupTimer = null;
    this._unconfirmedPlace = null; // { id, itemId } from a timed-out place
    this._unconfirmedPickup = null; // { decorId, decor } from a timed-out take-back
    // v1.1: the latest place/pickup news for the pocket panel. The
    // scene toast sits UNDER the panel (zIndex 1002 vs 1100), so the
    // panel's own notice line is the only place the player will see
    // a timeout while the pocket is open — the panel polls this via
    // ItemsSystem.getState() (see getPlaceNotice).
    this._placeNotice = '';
    this._placeNoticeSeq = 0;
    // Test seam: tests set this to a few ms so the timeout paths
    // run without waiting the real 5s. Production never sets it.
    this._pendingTimeoutMs = null;
    this._lastCheckMs = 0;
  }

  // Placing works in every room; the SHOP (buying) is Agora only.
  get enabled() {
    return Boolean(this.scene?.roomId);
  }

  get shopEnabled() {
    return this.scene?.roomId === AGORA_ROOM_ID;
  }

  _myUserId() {
    return this.scene?.userId || this.scene?.socket?.id || '__local__';
  }

  /** Plain-data state for the shop panel (polls this ~2x/sec). */
  getShopState() {
    return {
      items: DECOR_KIND_IDS.map((id) => ({ ...DECOR_KINDS[id] })),
      coins: getCoins(),
      full: isFull(),
      roomId: this.scene?.roomId || '',
    };
  }

  /** Plain-data state for anything that wants the room's decorations. */
  getState() {
    return {
      decorations: (this.state.decorations || []).map((d) => ({ ...d })),
      count: (this.state.decorations || []).length,
      max: DECOR_MAX_PER_ROOM,
      myUserId: this._myUserId(),
      roomId: this.scene?.roomId || '',
    };
  }

  /** (Re)build the decorations for this room; clear elsewhere. */
  refresh() {
    this._clearEntities();
    if (!this.enabled) return;
    this._drawAll();
    this._requestState();
  }

  _requestState() {
    try {
      if (this.scene?.socket?.connected) {
        this.scene.socket.emit('get_decor', { roomId: this.scene.roomId });
      }
    } catch {}
  }

  /** v1.1: the timeout for a pending place/pickup (tests override
   * via _pendingTimeoutMs; production always uses the 5s const). */
  _timeoutMs() {
    const override = Number(this._pendingTimeoutMs);
    return Number.isFinite(override) && override > 0 ? override : DECOR_PENDING_TIMEOUT_MS;
  }

  _clearPlaceTimer() {
    if (this._placeTimer) { clearTimeout(this._placeTimer); this._placeTimer = null; }
  }

  _clearPickupTimer() {
    if (this._pickupTimer) { clearTimeout(this._pickupTimer); this._pickupTimer = null; }
  }

  /** v1.1: post place/pickup news where the player will actually see
   * it. The scene toast (onSystemNotice) is hidden under the open
   * pocket panel, so the same text also goes to the panel's notice
   * line via getPlaceNotice() (polled by ItemsSystem.getState()).
   * The seq lets the panel tell a fresh notice from one it already
   * showed, so it never stomps a newer notice from another action. */
  _setPlaceNotice(text) {
    this._placeNotice = String(text || '');
    this._placeNoticeSeq += 1;
    try { this.scene?.onSystemNotice?.(this._placeNotice); } catch {}
  }

  /** v1.1: { text, seq } of the latest place/pickup news, for the
   * pocket panel (see ItemsSystem.getState). */
  getPlaceNotice() {
    return { text: this._placeNotice, seq: this._placeNoticeSeq };
  }

  /** Apply the server's canonical state. Also settles the pending
   * place / pickup: a place is confirmed when the broadcast shows
   * our id (the decoration leaves the pocket then), and a pickup
   * is confirmed when the decoration is gone (it comes back to the
   * pocket if there is room, otherwise it is discarded).
   *
   * v1.1: also settles timed-out attempts (_unconfirmedPlace /
   * _unconfirmedPickup). A place may have LANDED on the server while
   * only its broadcast was lost — the next decor_state after the
   * timeout is the recheck: if the id is there now, the place is
   * confirmed after the fact; if it is not, the place never landed
   * and the timeout notice already told the player to tap again.
   * Same shape for a take-back: if the decoration is gone from the
   * fresh state, the removal landed and the pocket gets it back. */
  applyState(payload = {}) {
    const next = parseDecorState(payload);
    this.state = next;
    if (this._pendingPlace) {
      const confirmed = next.decorations.some((d) => d.id === this._pendingPlace.id);
      if (confirmed) {
        const { itemId } = this._pendingPlace;
        this._pendingPlace = null;
        this._clearPlaceTimer();
        try { this.scene?.itemsSystem?.confirmPlacedDecoration?.(itemId); } catch {}
        this._setPlaceNotice('🎄 Placed! Everyone here can see it.');
      }
    }
    if (this._unconfirmedPlace) {
      const { id, itemId } = this._unconfirmedPlace;
      const landed = next.decorations.some((d) => d.id === id);
      this._unconfirmedPlace = null;
      if (landed) {
        // The place HAD landed — only the broadcast was lost. Settle
        // it now: the decoration leaves the pocket after all.
        try { this.scene?.itemsSystem?.confirmPlacedDecoration?.(itemId); } catch {}
        this._setPlaceNotice('🎄 Placed! Everyone here can see it.');
      }
      // If it never landed, the timeout notice already told the
      // player to tap Place again — nothing more to do.
    }
    if (this._pendingPickup) {
      const stillThere = next.decorations.some((d) => d.id === this._pendingPickup.decorId);
      if (!stillThere) {
        const { decor } = this._pendingPickup;
        this._pendingPickup = null;
        this._clearPickupTimer();
        try {
          const res = this.scene?.itemsSystem?.returnDecorationToPocket?.(decor);
          if (res && res.ok) {
            this._setPlaceNotice(`🎄 Picked your ${decorLabel(decor)} back up.`);
          } else {
            this._setPlaceNotice('🎄 Picked it up — but your pocket was full, so it was discarded.');
          }
        } catch {}
      }
    }
    if (this._unconfirmedPickup) {
      const { decorId, decor } = this._unconfirmedPickup;
      const stillThere = next.decorations.some((d) => d.id === decorId);
      this._unconfirmedPickup = null;
      if (!stillThere) {
        // The removal HAD landed — only the broadcast was lost.
        // The decoration comes back to the pocket after all.
        try {
          const res = this.scene?.itemsSystem?.returnDecorationToPocket?.(decor);
          if (res && res.ok) {
            this._setPlaceNotice(`🎄 Picked your ${decorLabel(decor)} back up.`);
          } else {
            this._setPlaceNotice('🎄 Picked it up — but your pocket was full, so it was discarded.');
          }
        } catch {}
      }
      // If it is still there, the removal never landed — the timeout
      // notice already told the player to try again.
    }
    this._drawAll();
  }

  // ---- the shop (Agora bar only) ----------------------------------------

  /** Buy a decoration: pay its price, it goes into your pocket.
   * The pocket-full check happens BEFORE any coins move (see
   * items.buyDecoration) — a refused sale costs nothing. */
  buyDecoration(kind) {
    if (!this.shopEnabled) return { ok: false, reason: 'not-available' };
    const res = buyDecoration(kind);
    if (res && res.ok) {
      try {
        this.scene?.onSystemNotice?.(`🎄 You bought a ${res.item.label} for ${res.price} coins — it's in your pocket. Place it from the 🎒 panel!`);
      } catch {}
    }
    return res;
  }

  // ---- placing (from the inventory) --------------------------------------

  /** Place a decoration from the pocket where you are standing.
   * The decoration stays in the pocket until the server confirms
   * the place (see applyState) — if the place never lands, nothing
   * is lost. Returns { ok, pending?, reason? }.
   *
   * v1.1: two guards against the stuck-"Placing it…" bug. (1) The
   * place is gated on the room join being confirmed — the server
   * silently drops decor_place when room membership is not
   * registered yet, so emitting before the join lands would wait
   * forever. (2) The pending place times out after
   * DECOR_PENDING_TIMEOUT_MS: the notice tells the player to tap
   * Place again, and the next decor_state rechecks whether the
   * place actually landed (see _onPlaceTimeout / applyState). */
  placeDecoration(itemId) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const item = getItem(itemId);
    if (!item) return { ok: false, reason: 'not-found' };
    if (item.type !== 'decoration') return { ok: false, reason: 'not-decoration' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    // v1.1 join gate: never emit before the server has confirmed
    // this socket's room join (first room_state after connecting).
    // A scene without isRoomJoined (old test stubs) is treated as
    // joined — only an explicit false refuses.
    if (this.scene?.isRoomJoined?.() === false) return { ok: false, reason: 'not-joined' };
    // Client-side cap check: refuse before emitting, so a refused
    // place never leaves a pending place hanging (the server
    // re-validates the cap anyway).
    if ((this.state.decorations || []).length >= DECOR_MAX_PER_ROOM) {
      return { ok: false, reason: 'room-full' };
    }
    const raw = { x: player.gx, y: player.gy + PLACE_OFFSET_Y };
    let pos = raw;
    try {
      if (this.scene?.roomLayout?.clampPointToRoom) {
        pos = this.scene.roomLayout.clampPointToRoom(raw.x, raw.y, 24) || raw;
      }
    } catch {}
    const id = `decor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    this._clearPlaceTimer();
    this._pendingPlace = { id, itemId };
    this._placeTimer = setTimeout(() => this._onPlaceTimeout(), this._timeoutMs());
    try {
      this.scene.socket.emit('decor_place', {
        roomId: this.scene.roomId, id, kind: item.decorKind, x: pos.x, y: pos.y,
      });
    } catch {
      this._clearPlaceTimer();
      this._pendingPlace = null;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true, id };
  }

  /** v1.1: a pending place got no decor_state confirm in time. The
   * item stays in the pocket — nothing is lost. The attempt moves
   * to _unconfirmedPlace so the next decor_state can still settle
   * it (the place may have landed and only the broadcast was lost),
   * and state is re-requested right away so that recheck happens
   * promptly. The player is told to tap Place again. */
  _onPlaceTimeout() {
    this._placeTimer = null;
    const pending = this._pendingPlace;
    if (!pending) return;
    this._pendingPlace = null;
    this._unconfirmedPlace = { ...pending };
    this._requestState();
    this._setPlaceNotice('🎄 The room didn\'t answer — tap Place again.');
  }

  // ---- taking back ---------------------------------------------------------

  /** Take a placed decoration down. Your own comes back to your
   * pocket (see applyState); a moderator taking down someone
   * else's discards it. The server re-validates ownership /
   * moderator status, so a bad client cannot remove what is not
   * theirs. */
  pickupDecoration(decorId) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const decor = (this.state.decorations || []).find((d) => d.id === String(decorId));
    if (!decor) return { ok: false, reason: 'not-found' };
    const myUserId = this._myUserId();
    const isMine = String(decor.addedBy) === String(myUserId);
    const isModerator = Boolean(this.scene?.isModerator);
    if (!isMine && !isModerator) return { ok: false, reason: 'not-yours', decor };
    // Taking my own back needs a free pocket slot — refuse now,
    // while it is still placed, instead of removing it from the
    // world and then having nowhere to put it.
    if (isMine && isFull()) return { ok: false, reason: 'inventory-full', decor };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    // v1.1 join gate (same as placing): decor_remove is silently
    // dropped without room membership, so never emit before the
    // join is confirmed.
    if (this.scene?.isRoomJoined?.() === false) return { ok: false, reason: 'not-joined' };
    // Only the owner's take-down returns the decoration to a pocket.
    if (isMine) {
      this._clearPickupTimer();
      this._pendingPickup = { decorId: decor.id, decor: { ...decor } };
      this._pickupTimer = setTimeout(() => this._onPickupTimeout(), this._timeoutMs());
    }
    try {
      this.scene.socket.emit('decor_remove', { roomId: this.scene.roomId, decorId: decor.id });
    } catch {
      this._clearPickupTimer();
      this._pendingPickup = null;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true };
  }

  /** v1.1: a pending take-back got no decor_state confirm in time.
   * Same shape as _onPlaceTimeout: the attempt moves to
   * _unconfirmedPickup so the next decor_state can still settle it
   * (the removal may have landed and only the broadcast was lost —
   * then the decoration comes back to the pocket after all), state
   * is re-requested right away, and the player is told to try
   * taking it down again. Nothing is lost either way. */
  _onPickupTimeout() {
    this._pickupTimer = null;
    const pending = this._pendingPickup;
    if (!pending) return;
    this._pendingPickup = null;
    this._unconfirmedPickup = { ...pending };
    this._requestState();
    this._setPlaceNotice('🎄 The room didn\'t answer — try taking it down again.');
  }

  /** One click at world (wx, wy): on a placed decoration, pick it
   * up (if standing close enough). Silent unless it acts — clicks
   * elsewhere do nothing. Returns { ok, picked?, reason? }. */
  decorTapAt(wx, wy) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const decor = this._decorAt(wx, wy);
    if (!decor) return { ok: false, reason: 'no-decor' };
    if (Math.hypot(player.gx - decor.x, player.gy - decor.y) > DECOR_STAND_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    const res = this.pickupDecoration(decor.id);
    if (res && res.reason === 'not-yours') {
      try {
        this.scene?.onSystemNotice?.(`🎄 That's ${decor.addedByName || 'someone'}'s ${decorLabel(decor)} — only they can move it.`);
      } catch {}
    }
    if (res && res.reason === 'inventory-full') {
      try { this.scene?.onSystemNotice?.(`🎒 ${INVENTORY_FULL_GENERIC}`); } catch {}
    }
    return { ...res, picked: res.ok };
  }

  /** The placed decoration within stand range of (px, py) — or null (E key). */
  nearestDecoration(px, py) {
    if (!this.enabled) return null;
    let best = null;
    let bestD = DECOR_STAND_RANGE;
    for (const decor of this.state.decorations || []) {
      const d = Math.hypot(px - decor.x, py - decor.y);
      if (d < bestD) { bestD = d; best = decor; }
    }
    if (!best) return null;
    return {
      id: best.id, kind: best.kind, label: decorLabel(best),
      mine: String(best.addedBy) === String(this._myUserId()),
      addedByName: best.addedByName || 'Someone',
      x: best.x, y: best.y,
    };
  }

  /** E key: pick up the nearest placed decoration (or say whose it is). */
  pickupNearest() {
    const near = this.nearestDecoration(this.scene?.player?.gx ?? 0, this.scene?.player?.gy ?? 0);
    if (!near) return { ok: false, reason: 'no-decor' };
    const res = this.pickupDecoration(near.id);
    if (res && res.reason === 'not-yours') {
      try {
        this.scene?.onSystemNotice?.(`🎄 That's ${near.addedByName}'s ${near.label} — only they can move it.`);
      } catch {}
    }
    if (res && res.reason === 'inventory-full') {
      try { this.scene?.onSystemNotice?.(`🎒 ${INVENTORY_FULL_GENERIC}`); } catch {}
    }
    return res;
  }

  _decorAt(wx, wy) {
    for (const decor of this.state.decorations || []) {
      if (Math.hypot(wx - decor.x, wy - decor.y) <= DECOR_CLICK_RANGE) return decor;
    }
    return null;
  }

  // ---- drawing -------------------------------------------------------------

  _drawAll() {
    this._clearEntities();
    if (!this.enabled) return;
    for (const decor of this.state.decorations || []) {
      this._drawDecoration(decor);
    }
  }

  _drawDecoration(decor) {
    const scene = this.scene;
    const g = scene.add.graphics();
    const def = DECOR_KINDS[decor.kind] || DECOR_KINDS.ornament;
    const colorIdx = hashId(decor.id) % ORNAMENT_COLORS.length;
    if (decor.kind === 'ornament') {
      // A bauble on a short string.
      const c = parseInt(ORNAMENT_COLORS[colorIdx].slice(1), 16);
      g.lineStyle(1.5, 0x8b5a2b, 1);
      g.lineBetween(0, -34, 0, -26);
      g.fillStyle(0xfbbf24, 1);
      g.fillRect(-4, -27, 8, 5);
      g.fillStyle(c, 1);
      g.fillCircle(0, -16, 10);
      g.fillStyle(0xffffff, 0.55);
      g.fillCircle(-3, -19, 3);
    } else if (decor.kind === 'lights') {
      // A sagging string with five coloured bulbs.
      const pts = [[-34, -30], [-17, -20], [0, -16], [17, -20], [34, -30]];
      g.lineStyle(1.5, 0x374151, 1);
      for (let i = 0; i < pts.length - 1; i++) {
        g.lineBetween(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      }
      for (let i = 0; i < pts.length; i++) {
        const c = parseInt(LIGHT_COLORS[(colorIdx + i) % LIGHT_COLORS.length].slice(1), 16);
        g.fillStyle(c, 0.35);
        g.fillCircle(pts[i][0], pts[i][1] + 4, 7);
        g.fillStyle(c, 1);
        g.fillCircle(pts[i][0], pts[i][1] + 4, 3.5);
      }
    } else if (decor.kind === 'snowman') {
      // Two snowballs, carrot nose, coal eyes, black hat, stick arms.
      g.fillStyle(0xffffff, 1);
      g.fillCircle(0, -12, 14);
      g.fillCircle(0, -34, 10);
      g.fillStyle(0x1f2937, 1);
      g.fillCircle(-4, -36, 1.5);
      g.fillCircle(4, -36, 1.5);
      g.fillStyle(0xea580c, 1);
      g.beginPath();
      g.moveTo(-2, -32);
      g.lineTo(10, -30);
      g.lineTo(-2, -28);
      g.closePath();
      g.fillPath();
      g.fillStyle(0x1f2937, 1);
      g.fillRect(-8, -50, 16, 10);
      g.fillRect(-11, -41, 22, 4);
      g.lineStyle(2, 0x6b4226, 1);
      g.lineBetween(-13, -18, -26, -28);
      g.lineBetween(13, -18, 26, -28);
    } else if (decor.kind === 'tree') {
      // A mini Christmas tree: trunk, two tiers, gold star.
      g.fillStyle(0x6b4226, 1);
      g.fillRect(-4, -8, 8, 10);
      g.fillStyle(0x166534, 1);
      g.beginPath();
      g.moveTo(-26, 0);
      g.lineTo(26, 0);
      g.lineTo(0, -34);
      g.closePath();
      g.fillPath();
      g.fillStyle(0x16a34a, 1);
      g.beginPath();
      g.moveTo(-18, -22);
      g.lineTo(18, -22);
      g.lineTo(0, -52);
      g.closePath();
      g.fillPath();
      this._drawStar(g, 0, -58, 6, 0xfbbf24);
      g.fillStyle(0xef4444, 1);
      g.fillCircle(-10, -14, 3);
      g.fillCircle(10, -20, 3);
      g.fillStyle(0x3b82f6, 1);
      g.fillCircle(0, -30, 3);
    } else {
      // Santa figure: red robe, white beard, face, red hat.
      g.fillStyle(0xdc2626, 1);
      g.beginPath();
      g.moveTo(-16, 2);
      g.lineTo(16, 2);
      g.lineTo(0, -38);
      g.closePath();
      g.fillPath();
      g.fillStyle(0x1f2937, 1);
      g.fillRect(-16, -12, 32, 6);
      g.fillStyle(0xfbbf24, 1);
      g.fillRect(-3, -12, 6, 6);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(0, -34, 9);
      g.fillStyle(0xfcd9b8, 1);
      g.fillCircle(0, -42, 8);
      g.fillStyle(0x1f2937, 1);
      g.fillCircle(-3, -43, 1.5);
      g.fillCircle(3, -43, 1.5);
      g.fillStyle(0xdc2626, 1);
      g.beginPath();
      g.moveTo(-8, -48);
      g.lineTo(8, -48);
      g.lineTo(0, -60);
      g.closePath();
      g.fillPath();
      g.fillStyle(0xffffff, 1);
      g.fillRect(-9, -50, 18, 4);
      g.fillCircle(0, -60, 3);
    }
    const container = scene.add.container(decor.x, decor.y, [g]);
    container.setDepth(DEPTH.ACTOR_MIN + Math.round(decor.y));
    container.setSize(80, 90);
    this._containers.set(decor.id, container);
  }

  /** A 5-point star centred at (x, y), outer radius r. */
  _drawStar(g, x, y, r, color) {
    const inner = r * 0.45;
    g.fillStyle(color, 1);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillPath();
  }

  update() {
    if (!this.enabled) return;
    const now = Date.now();
    if (now - (this._lastCheckMs || 0) < 1000) return;
    this._lastCheckMs = now;
    // The decorations re-spawn if a floor switch cleared them.
    if ((this.state.decorations || []).length > 0 && this._containers.size === 0) {
      this._drawAll();
    }
  }

  _clearEntities() {
    for (const c of this._containers.values()) {
      try { c?.destroy(); } catch {}
    }
    this._containers.clear();
  }

  destroy() {
    this._clearEntities();
    this._clearPlaceTimer();
    this._clearPickupTimer();
    this._pendingPlace = null;
    this._pendingPickup = null;
    this._unconfirmedPlace = null;
    this._unconfirmedPickup = null;
    this.scene = null;
  }
}

function decorLabel(decor) {
  const def = DECOR_KINDS[decor?.kind];
  return def ? def.label : 'Christmas decoration';
}
