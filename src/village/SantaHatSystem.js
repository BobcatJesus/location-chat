// SantaHatSystem.js — the Santa Hat (Santa Hat v1, `sq-santa-hat-v1`).
//
// Owned by VillageScene, same shape as TrimTreeQuest / DecorSystem:
// constructed in create(), ticked in update(), destroyed in
// shutdown(), refreshed on floor switches. Agora only.
//
// The loop (decided in chat 2026-11-21): ONE Santa hat hides behind
// the Christmas tree in Agora, one for the whole room. Find it by
// clicking behind the tree 3 times (hidden-search, puzzle pattern —
// scene-level pointerdown + distance checks, never per-object
// pointerdown), it goes into your pocket, and "Put on the cat" in
// the pocket puts it on the cafe cat — she wears it, everyone in
// the room sees it (the hat rides on her container, so it follows
// her while she wanders, follows you, and sleeps). After
// HAT_SLIP_MS it slips off and lands on the ground nearby, VISIBLE
// on the floor; anyone can pick it up (click it or press E near it)
// and put it back on her. Placing it pays +3 coins the FIRST time
// each player does it (localStorage guard, puzzle/tree pattern) —
// later placements are just for fun.
//
// Server state is canonical (server/socket.js `hat_find` /
// `hat_place` / `hat_pickup` / `hat_slip` / `hat_release` /
// `get_hat`, in-memory per room like the puzzle): the pocket item
// leaves only when a `hat_state` broadcast confirms the place /
// pickup, and a pending attempt times out after 5s with a retry
// notice (the decor v1.1 pattern — never wait forever). A restart
// wipes the hat back to hidden behind the tree.
//
// The hat NEVER hides again once found (until a restart): after the
// first find it circulates cat -> ground -> pocket -> cat. If the
// carrier leaves Agora with the hat in their pocket, the room simply
// has no hat until they bring it back (same rule as any pocket item
// — only puzzle pieces vanish on leave). The hat CANNOT be dropped
// as ground litter or on the home floor (refused like puzzle
// pieces): dropping it would fork its state — the server would say
// "carried" while the hat sat somewhere the room cannot see.

import { DEPTH } from './depth.js';
import {
  HAT_MARKER_V1,
  HAT_MARKER_V11,
  HAT_REWARD_COINS,
  HAT_SLIP_MS,
  HAT_SEARCH_CLICKS,
  HAT_SEARCH_RANGE,
  HAT_HIDE_SPOT,
  HAT_HIDE_RADIUS,
  HAT_GROUND_CLICK_RANGE,
  HAT_GROUND_STAND_RANGE,
  HAT_PENDING_TIMEOUT_MS,
  createHatState,
  isSlipDue,
  serializeHatState,
  parseHatState,
} from './hatState.js';
import {
  ITEM_TYPES,
  INVENTORY_FULL_MESSAGE,
  addItem,
  getItem,
  getInventoryState,
  isFull,
} from './items.js';

const AGORA_ROOM_ID = 'agora-houston';
const SLIP_CHECK_MS = 1000; // how often update() re-checks the slip time

// Per-profile paid guard (same profile scoping as QuestManager /
// PuzzleQuest / TrimTreeQuest): a player is paid +3 exactly once,
// the first time they put the hat on the cat.
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

function loadPaidHats() {
  try {
    const raw = localStorage.getItem('sidequest-hat-paid');
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export class SantaHatSystem {
  constructor(scene) {
    this.scene = scene;
    // sq-santa-hat-v1 — marker for the v1 landing check.
    this.marker = HAT_MARKER_V1;
    // sq-santa-hat-v1-1 — marker for the v1.1 landing check.
    this.markerV11 = HAT_MARKER_V11;
    this.state = createHatState();
    this._searchTaps = 0; // taps behind the tree this room visit
    this._groundContainer = null; // Phaser container for the hat on the floor
    this._pendingPlace = null; // { itemId } awaiting the hat_state that confirms it
    this._pendingPickup = null; // true while a ground pickup awaits confirm
    this._placeTimer = null;
    this._pickupTimer = null;
    this._unconfirmedPlace = null; // { itemId } from a timed-out place
    this._unconfirmedPickup = null; // true from a timed-out pickup
    this._hatNotice = '';
    this._hatNoticeSeq = 0;
    this._slipEmittedFor = 0; // slipAt value already emitted for (once per slip)
    this._pendingTimeoutMs = null; // test seam: tests use a few ms
    this._lastCheckMs = 0;
  }

  get enabled() {
    return this.scene?.roomId === AGORA_ROOM_ID;
  }

  _myUserId() {
    return this.scene?.userId || this.scene?.socket?.id || '__local__';
  }

  /** Plain-data state for the pocket panel / debugging. */
  getState() {
    return {
      ...serializeHatState(this.state),
      carrying: this.state.status === 'carried' && String(this.state.carriedBy || '') === String(this._myUserId()),
      myUserId: this._myUserId(),
      roomId: this.scene?.roomId || '',
    };
  }

  /** (Re)build the hat for this room; clear elsewhere. */
  refresh() {
    this._clearEntities();
    this._searchTaps = 0;
    if (!this.enabled) return;
    this._drawAll();
    this._requestState();
  }

  _requestState() {
    try {
      if (this.scene?.socket?.connected) {
        this.scene.socket.emit('get_hat', { roomId: this.scene.roomId });
      }
    } catch {}
  }

  _timeoutMs() {
    const override = Number(this._pendingTimeoutMs);
    return Number.isFinite(override) && override > 0 ? override : HAT_PENDING_TIMEOUT_MS;
  }

  _clearPlaceTimer() {
    if (this._placeTimer) { clearTimeout(this._placeTimer); this._placeTimer = null; }
  }

  _clearPickupTimer() {
    if (this._pickupTimer) { clearTimeout(this._pickupTimer); this._pickupTimer = null; }
  }

  /** Post hat news where the player will actually see it. The scene
   * toast (onSystemNotice) is hidden under the open pocket panel, so
   * the same text also goes to the panel's notice line via
   * getHatNotice() (polled by ItemsSystem.getState()) — the decor
   * v1.1 pattern. The seq lets the panel tell a fresh notice from
   * one it already showed. */
  _setHatNotice(text) {
    this._hatNotice = String(text || '');
    this._hatNoticeSeq += 1;
    try { this.scene?.onSystemNotice?.(this._hatNotice); } catch {}
  }

  /** { text, seq } of the latest hat news, for the pocket panel. */
  getHatNotice() {
    return { text: this._hatNotice, seq: this._hatNoticeSeq };
  }

  /** Apply the server's canonical state. Also settles the pending
   * place / pickup: a place is confirmed when the broadcast shows
   * the hat on the cat with me as the placer (the hat leaves the
   * pocket then), and a pickup is confirmed when the broadcast
   * shows it carried by me (it comes back to the pocket then).
   * Timed-out attempts are rechecked the same way (decor v1.1):
   * a place may have LANDED while only its broadcast was lost. */
  applyState(payload = {}) {
    const prev = this.state;
    const next = parseHatState(payload);
    this.state = next;
    const me = String(this._myUserId());

    // The cat wears the hat exactly while the server says so — the
    // hat rides on her container, so it follows her everywhere.
    try { this.scene?.cafeCat?.setHatWorn?.(next.status === 'onCat'); } catch {}

    let placedConfirmed = false;
    let pickedConfirmed = false;
    let foundFailedFull = false;
    let pickFailedFull = false;

    // The find is confirmed by the broadcast itself (no pending
    // flag — the find is a fire-and-forget emit): the hat is
    // carried by me now and was hidden before. Take it into the
    // pocket — or give it back to the tree if the pocket is full.
    if (next.status === 'carried' && String(next.carriedBy || '') === me
      && prev.status === 'hidden') {
      if (!this._takeHatIntoPocket()) foundFailedFull = true;
      this._searchTaps = 0;
    }

    if (this._pendingPlace) {
      if (next.status === 'onCat' && String(next.placedBy || '') === String(this._myUserId())) {
        const { itemId } = this._pendingPlace;
        this._pendingPlace = null;
        this._clearPlaceTimer();
        try { this.scene?.itemsSystem?.confirmPlacedHat?.(itemId); } catch {}
        placedConfirmed = true;
      }
    }
    if (this._unconfirmedPlace) {
      const { itemId } = this._unconfirmedPlace;
      this._unconfirmedPlace = null;
      if (next.status === 'onCat' && String(next.placedBy || '') === String(this._myUserId())) {
        // The place HAD landed — only the broadcast was lost.
        try { this.scene?.itemsSystem?.confirmPlacedHat?.(itemId); } catch {}
        placedConfirmed = true;
      }
      // If it is not on the cat, the place never landed — the
      // timeout notice already told the player to tap again.
    }
    if (this._pendingPickup) {
      if (next.status === 'carried' && String(next.carriedBy || '') === String(this._myUserId())) {
        this._pendingPickup = null;
        this._clearPickupTimer();
        pickedConfirmed = this._takeHatIntoPocket();
        pickFailedFull = !pickedConfirmed;
      }
    }
    if (this._unconfirmedPickup) {
      this._unconfirmedPickup = null;
      if (next.status === 'carried' && String(next.carriedBy || '') === String(this._myUserId())) {
        pickedConfirmed = this._takeHatIntoPocket();
        pickFailedFull = !pickedConfirmed;
      }
    }

    // A slip I already emitted for is done — reset the guard when
    // the hat is anywhere but on the cat.
    if (next.status !== 'onCat') this._slipEmittedFor = 0;

    // ---- one notice per transition (never two for the same event) ----
    if (next.status === 'onCat' && String(next.placedBy || '') === me) {
      // I put it on her — pay +3 the FIRST time ever (localStorage
      // guard, puzzle/tree pattern), plain notice after that.
      const paid = loadPaidHats();
      const owner = currentOwner();
      const paidOwners = paid[owner];
      if (!paidOwners) {
        paid[owner] = true;
        try { localStorage.setItem('sidequest-hat-paid', JSON.stringify(paid)); } catch {}
        try {
          import('./CoinWallet.js')
            .then((m) => m.earnCoins(HAT_REWARD_COINS, 'hat-place'))
            .catch(() => {});
        } catch {}
        this._setHatNotice(`🎅 The cat is wearing the Santa hat! +${HAT_REWARD_COINS} coins.`);
      } else if (prev.status !== 'onCat' || placedConfirmed) {
        this._setHatNotice('🎅 The cat is wearing the Santa hat!');
      }
    } else if (next.status === 'onCat' && prev.status !== 'onCat') {
      this._setHatNotice('🎅 The cat is wearing the Santa hat!');
    } else if (next.status === 'carried' && prev.status === 'hidden'
      && String(next.carriedBy || '') === me && !foundFailedFull) {
      this._setHatNotice('🎅 You found a Santa hat behind the Christmas tree!');
    } else if (next.status === 'carried' && prev.status === 'hidden'
      && String(next.carriedBy || '')) {
      this._setHatNotice('🎅 Someone found the Santa hat behind the Christmas tree!');
    } else if (next.status === 'ground' && prev.status === 'onCat') {
      this._setHatNotice('🎅 The Santa hat slipped off the cat!');
    } else if (next.status === 'carried' && prev.status === 'ground'
      && String(next.carriedBy || '') === me && !pickFailedFull) {
      this._setHatNotice('🎅 You picked up the Santa hat!');
    } else if (next.status === 'carried' && prev.status === 'ground'
      && String(next.carriedBy || '')) {
      this._setHatNotice('🎅 Someone picked up the Santa hat.');
    } else if (pickedConfirmed) {
      this._setHatNotice('🎅 You picked up the Santa hat!');
    }

    this._drawAll();
  }

  /** The server says I carry the hat — take it into my pocket. If
   * the pocket filled in the instant between check and confirm,
   * give the hat back to the tree instead of losing it (the server
   * `hat_release` puts it back to hidden). Already carrying one?
   * Nothing to do — a re-join must never duplicate the hat.
   * Returns true when the hat is in the pocket now. */
  _takeHatIntoPocket() {
    if (this._haveHatItem()) return true;
    let res = null;
    try { res = this.scene?.itemsSystem?.returnHatToPocket?.() || null; } catch { res = null; }
    if (!res) {
      const r = addItem({ type: ITEM_TYPES.SANTA_HAT });
      res = r && r.ok ? { ok: true } : { ok: false, reason: (r && r.reason) || 'error' };
    }
    if (res && res.ok) return true;
    try {
      if (this.scene?.socket?.connected) {
        this.scene.socket.emit('hat_release', { roomId: this.scene.roomId });
      }
    } catch {}
    this._setHatNotice(`🎒 ${INVENTORY_FULL_MESSAGE}`);
    return false;
  }

  /** Is a Santa hat already in my pocket? (Guards the re-join: the
   * server still says I carry it, and the pocket still holds it.) */
  _haveHatItem() {
    try {
      const items = this.scene?.itemsSystem?.getState?.()?.items
        || getInventoryState().items || [];
      return items.some((it) => it && it.type === ITEM_TYPES.SANTA_HAT);
    } catch {
      return false;
    }
  }

  // ---- finding (3 clicks behind the tree) ------------------------------

  /** One search tap: the player clicked at world (wx, wy). Same
   * contract as PuzzleQuest.searchTapAt: silent unless it finds
   * something (no counter, no hint about where the hat hides).
   * After HAT_SEARCH_CLICKS taps behind the tree, the find goes to
   * the server — one hat per room, so the server decides who gets
   * it. A full pocket REFUSES the find (the taps stay counted, so
   * one more click after making room tries again). Offline, the
   * find refuses — a shared hat cannot be found without the server
   * (no local fallback: an offline hat would be a phantom).
   * Returns { ok, tapped?, finding?, reason? }. */
  searchTapAt(wx, wy) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (this.state.status !== 'hidden') return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    if (Math.hypot(wx - HAT_HIDE_SPOT.x, wy - HAT_HIDE_SPOT.y) > HAT_HIDE_RADIUS) {
      return { ok: false, reason: 'no-spot' };
    }
    if (Math.hypot(player.gx - HAT_HIDE_SPOT.x, player.gy - HAT_HIDE_SPOT.y) > HAT_SEARCH_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    const taps = this._searchTaps + 1;
    if (taps < HAT_SEARCH_CLICKS) {
      this._searchTaps = taps;
      return { ok: true, tapped: true, remaining: HAT_SEARCH_CLICKS - taps };
    }
    // Enough taps: the find goes to the server — if the pocket has room.
    if (isFull()) {
      this._searchTaps = HAT_SEARCH_CLICKS;
      return { ok: false, reason: 'inventory-full' };
    }
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    if (this.scene?.isRoomJoined?.() === false) return { ok: false, reason: 'not-joined' };
    try {
      this.scene.socket.emit('hat_find', { roomId: this.scene.roomId });
    } catch {
      return { ok: false, reason: 'error' };
    }
    // Taps stay counted until the hat_state broadcast confirms the
    // find (or says someone else got it) — one more click retries.
    this._searchTaps = HAT_SEARCH_CLICKS;
    return { ok: true, finding: true };
  }

  // ---- putting it on the cat (from the pocket) -------------------------

  /** Put the hat on the cat. The hat leaves the pocket ONLY when
   * the server confirms the place (same pending pattern as placing
   * a decoration). If the place never lands (offline, rate-limited),
   * the hat simply stays in the pocket — nothing is ever lost.
   * Returns { ok, pending?, reason? }. */
  placeOnCat(itemId) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const item = getItem(itemId);
    if (!item) return { ok: false, reason: 'not-found' };
    if (item.type !== ITEM_TYPES.SANTA_HAT) return { ok: false, reason: 'not-hat' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    if (!this._nearCat(player.gx, player.gy)) return { ok: false, reason: 'not-near-cat' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    // Join gate (decor v1.1 lesson): never emit before the server
    // has confirmed this socket's room join.
    if (this.scene?.isRoomJoined?.() === false) return { ok: false, reason: 'not-joined' };
    this._clearPlaceTimer();
    this._pendingPlace = { itemId };
    this._placeTimer = setTimeout(() => this._onPlaceTimeout(), this._timeoutMs());
    try {
      this.scene.socket.emit('hat_place', { roomId: this.scene.roomId });
    } catch {
      this._clearPlaceTimer();
      this._pendingPlace = null;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true };
  }

  /** A pending place got no hat_state confirm in time. The hat
   * stays in the pocket — nothing is lost. The attempt moves to
   * _unconfirmedPlace so the next hat_state can still settle it. */
  _onPlaceTimeout() {
    this._placeTimer = null;
    const pending = this._pendingPlace;
    if (!pending) return;
    this._pendingPlace = null;
    this._unconfirmedPlace = { ...pending };
    this._requestState();
    this._setHatNotice('🎅 The room didn\'t answer — tap Put on the cat again.');
  }

  /** The cat (awake or asleep) within petting range of (x, y). */
  _nearCat(x, y) {
    try {
      if (this.scene?.cafeCat?.nearestCat?.(x, y)) return true;
      if (this.scene?.cafeCat?.nearestSleepingCat?.(x, y)) return true;
    } catch {}
    return false;
  }

  // ---- picking it up off the ground -------------------------------------

  /** The hat on the ground within pickup range of (x, y) — or null
   * (E key + prompt). Same numbers as ground litter: 90px stand. */
  nearestGroundHat(px, py) {
    if (!this.enabled || this.state.status !== 'ground') return null;
    const d = Math.hypot(px - this.state.groundX, py - this.state.groundY);
    return d <= HAT_GROUND_STAND_RANGE ? { x: this.state.groundX, y: this.state.groundY } : null;
  }

  /** One pickup tap: the player clicked at world (wx, wy). If the
   * click lands on the hat on the ground AND the player is standing
   * close enough, pick it up — into the pocket, if there is room.
   * A full pocket refuses it (the hat stays on the ground). */
  groundTapAt(wx, wy) {
    if (!this.enabled || this.state.status !== 'ground') return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    if (Math.hypot(wx - this.state.groundX, wy - this.state.groundY) > HAT_GROUND_CLICK_RANGE) {
      return { ok: false, reason: 'no-litter' };
    }
    return this.pickupNearest();
  }

  /** Pick the hat on the ground back up (E key near it, or a click
   * on it). The hat comes back to the pocket only when the server
   * confirms the pickup. Returns { ok, pending?, reason? }. */
  pickupNearest() {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const near = this.nearestGroundHat(player.gx, player.gy);
    if (!near) return { ok: false, reason: 'not-available' };
    if (isFull()) return { ok: false, reason: 'inventory-full' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    if (this.scene?.isRoomJoined?.() === false) return { ok: false, reason: 'not-joined' };
    this._clearPickupTimer();
    this._pendingPickup = true;
    this._pickupTimer = setTimeout(() => this._onPickupTimeout(), this._timeoutMs());
    try {
      this.scene.socket.emit('hat_pickup', { roomId: this.scene.roomId });
    } catch {
      this._clearPickupTimer();
      this._pendingPickup = null;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true };
  }

  /** A pending pickup got no hat_state confirm in time. The hat
   * stays on the ground — nothing is lost. The next hat_state
   * rechecks whether the pickup actually landed. */
  _onPickupTimeout() {
    this._pickupTimer = null;
    if (!this._pendingPickup) return;
    this._pendingPickup = null;
    this._unconfirmedPickup = true;
    this._requestState();
    this._setHatNotice('🎅 The room didn\'t answer — try picking it up again.');
  }

  // ---- slip-off (time-based, server timestamp) --------------------------

  update() {
    if (!this.enabled) return;
    const now = Date.now();
    if (now - (this._lastCheckMs || 0) < SLIP_CHECK_MS) return;
    this._lastCheckMs = now;
    // The hat slips off on the SERVER's clock (slipAt in the state):
    // the first client to notice tells the server, with its own
    // local cat position for where the hat lands. The server only
    // accepts the transition once, so two clients noticing at the
    // same moment cannot slip it twice. If nobody is in the room
    // the hat stays on the cat — the next player to walk in sees a
    // due slipAt and reports it right away.
    if (this.state.status === 'onCat' && isSlipDue(this.state, now)
      && this._slipEmittedFor !== this.state.slipAt) {
      this._slipEmittedFor = this.state.slipAt;
      const cat = this.scene?.cafeCat?.cat;
      const x = Number.isFinite(cat?.x) ? cat.x : HAT_HIDE_SPOT.x;
      const y = Number.isFinite(cat?.y) ? cat.y : HAT_HIDE_SPOT.y;
      try {
        if (this.scene?.socket?.connected) {
          this.scene.socket.emit('hat_slip', { roomId: this.scene.roomId, x, y });
        }
      } catch {}
    }
  }

  // ---- drawing ----------------------------------------------------------

  _drawAll() {
    this._clearEntities();
    if (!this.enabled) return;
    // The hat on the cat rides on her container (CafeCat owns it) —
    // this system only draws the hat lying on the ground.
    if (this.state.status === 'ground') {
      const scene = this.scene;
      const { groundX: x, groundY: y } = this.state;
      const g = scene.add.graphics();
      // A little red Santa hat, lying on the floor: triangle + white
      // brim + pompom, with a soft shadow underneath.
      g.fillStyle(0x000000, 0.18);
      g.fillEllipse(0, 10, 30, 10);
      g.fillStyle(0xdc2626, 1);
      g.fillTriangle(-13, 8, 13, 8, 4, -14);
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(-15, 6, 30, 6, 3);
      g.fillCircle(5, -16, 3.5);
      const container = scene.add.container(x, y, [g]);
      container.setDepth(DEPTH.ACTOR_MIN + Math.round(y));
      container.setSize(34, 30);
      this._groundContainer = container;
    }
    try { this.scene?.cafeCat?.setHatWorn?.(this.state.status === 'onCat'); } catch {}
  }

  _clearEntities() {
    try { this._groundContainer?.destroy(); } catch {}
    this._groundContainer = null;
  }

  destroy() {
    this._clearPlaceTimer();
    this._clearPickupTimer();
    this._clearEntities();
    this._searchTaps = 0;
    this._pendingPlace = null;
    this._pendingPickup = null;
    this._unconfirmedPlace = null;
    this._unconfirmedPickup = null;
    this.scene = null;
  }
}
