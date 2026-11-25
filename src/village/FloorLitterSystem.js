// FloorLitterSystem.js — the in-room side of Shared Floor Litter
// v1 (`sq-shared-litter-v1`).
//
// Owned by VillageScene, same shape as DecorSystem /
// NoticeBoardSystem: constructed in create(), refreshed on floor
// switches, destroyed in shutdown(). One job: dropped pocket items
// are visible to EVERYONE in the room (not just the dropper) and
// anyone can pick them up. State is SERVER state
// (server/socket.js, in-memory per room like the notice board):
// drops and pickups go through the socket and every player in the
// room sees the same floor. Home rooms never use this — their
// drops go through the per-player home floor store, and this
// system no-ops there.
//
// DROPPING (from the inventory — an item's "Drop" button):
// ItemsSystem.dropItem delegates here in non-home rooms. The item
// leaves the pocket ONLY when the server confirms the drop (same
// pending pattern as pinning a flyer / placing a decoration): the
// floor_litter broadcast showing our id settles it, or the
// drop_item_result answer does. If the drop never lands (offline,
// rate-limited, room full), the item simply stays in the pocket —
// nothing is ever lost by dropping.
//
// PICKUP (tap the litter, or E near it): anyone's litter is
// pickable, first-come-wins. The pocket-full check happens BEFORE
// emitting (the mail-collect two-step) — a full pocket never even
// asks. The server claims the entry for the picker and answers
// with the item; only when the item lands in the pocket does the
// client confirm (pickup_floor_item_confirm), which is when the
// claim settles. A picker whose pocket filled in the meantime
// cancels instead (pickup_floor_item_cancel) and the entry goes
// back on the floor. A pickup with no answer in 5s times out
// with a retry notice, like a decor place.
//
// A restart wipes floor litter (in-memory only, by design — it is
// litter). The client re-requests state on (re)connect, like decor.

import { DEPTH } from './depth.js';
import {
  FLOOR_LITTER_MARKER_V1,
  FLOOR_LITTER_MAX_PER_ROOM,
  createFloorLitterState,
  parseFloorLitterState,
  isNeverDropType,
  litterPocketItem,
} from './floorLitterState.js';
import {
  LITTERBUG_MARKER_V1,
  LITTERBUG_NPC_ROOM_ID,
  LITTERBUG_NPC_ROLL_MIN_MS,
  LITTERBUG_NPC_ROLL_MAX_MS,
  isFreshLitter,
} from './litterbugState.js';
import {
  INVENTORY_FULL_MESSAGE,
  ITEM_TYPES,
  LITTER_PICKUP_RANGE,
  LITTER_CLICK_RANGE,
  getItem,
  addItem,
  canAddItem,
} from './items.js';
import { isHomeRoom } from './homeStorage.js';

// Shared Floor Litter v1 (`sq-shared-litter-v1`): how long a
// pending drop (or pickup) waits for the server's answer before
// giving up with a retry notice instead of waiting forever. Five
// seconds is far above a healthy round trip (tens of ms on LAN /
// ~100-300ms over the internet) and far below "stuck forever".
export const FLOOR_LITTER_PENDING_TIMEOUT_MS = 5000;

export class FloorLitterSystem {
  constructor(scene) {
    this.scene = scene;
    // sq-shared-litter-v1 — marker for the v1 landing check.
    this.marker = FLOOR_LITTER_MARKER_V1;
    // Catch a Litterbug v1 (`sq-litterbug-quest-v1`): fresh litter
    // carries a "!" and tapping it catches the litterer; the scene
    // wires onCatchConfirmed to QuestManager.recordEvent.
    this.litterbugMarker = LITTERBUG_MARKER_V1;
    this.onCatchConfirmed = null;
    this.state = createFloorLitterState();
    this._textObjs = new Map(); // litter id -> Phaser text object
    this._freshObjs = new Map(); // litter id -> "!" text above fresh litter
    // Server-time offset (ms): the floor_litter broadcast carries
    // the server's `now`, so freshness is judged against server
    // time, not the client's clock alone.
    this._serverNowOffset = 0;
    this._pendingCatch = null; // { litterId } awaiting litterbug_catch_result
    this._catchTimer = null;
    this._npcRollAt = 0; // next NPC-litter roll (Shepherd Park only)
    this._pendingDrop = null; // { id, itemId, label } awaiting the floor_litter that confirms it
    this._pendingPickup = null; // { litterId, item } awaiting the pickup_floor_item_result
    this._dropTimer = null;
    this._pickupTimer = null;
    // A pending drop that got no answer in time — the next
    // floor_litter rechecks whether the drop actually landed
    // (same shape as DecorSystem's _unconfirmedPlace).
    this._unconfirmedDrop = null; // { id, itemId, label }
    // The latest drop/pickup news for the pocket panel. The scene
    // toast sits UNDER the panel (zIndex 1002 vs 1100), so the
    // panel's own notice line is the only place the player will
    // see a timeout while the pocket is open — the panel polls
    // this via ItemsSystem.getState() (see getLitterNotice).
    this._litterNotice = '';
    this._litterNoticeSeq = 0;
    // Test seam: tests set this to a few ms so the timeout paths
    // run without waiting the real 5s. Production never sets it.
    this._pendingTimeoutMs = null;
    this._lastCheckMs = 0;
  }

  // Shared litter works in every room except home rooms — their
  // drops go through the per-player home floor store.
  get enabled() {
    return Boolean(this.scene?.roomId) && !isHomeRoom(this.scene.roomId);
  }

  _myUserId() {
    return this.scene?.userId || this.scene?.socket?.id || '__local__';
  }

  /** Plain-data state for anything that wants the room's litter. */
  getState() {
    return {
      items: (this.state.items || []).map((e) => ({ ...e })),
      count: (this.state.items || []).length,
      max: FLOOR_LITTER_MAX_PER_ROOM,
      myUserId: this._myUserId(),
      roomId: this.scene?.roomId || '',
    };
  }

  /** (Re)build the litter for this room; clear elsewhere. */
  refresh() {
    this._clearEntities();
    if (!this.enabled) return;
    this._drawAll();
    this._requestState();
  }

  _requestState() {
    try {
      if (this.scene?.socket?.connected) {
        this.scene.socket.emit('get_floor_litter', { roomId: this.scene.roomId });
      }
    } catch {}
  }

  /** The timeout for a pending drop/pickup (tests override via
   * _pendingTimeoutMs; production always uses the 5s const). */
  _timeoutMs() {
    const override = Number(this._pendingTimeoutMs);
    return Number.isFinite(override) && override > 0 ? override : FLOOR_LITTER_PENDING_TIMEOUT_MS;
  }

  _clearDropTimer() {
    if (this._dropTimer) { clearTimeout(this._dropTimer); this._dropTimer = null; }
  }

  _clearPickupTimer() {
    if (this._pickupTimer) { clearTimeout(this._pickupTimer); this._pickupTimer = null; }
  }

  /** Post drop/pickup news where the player will actually see it:
   * the scene toast AND the pocket panel's notice line (polled by
   * ItemsSystem.getState). The seq lets the panel tell a fresh
   * notice from one it already showed. */
  _setLitterNotice(text) {
    this._litterNotice = String(text || '');
    this._litterNoticeSeq += 1;
    try { this.scene?.onSystemNotice?.(this._litterNotice); } catch {}
  }

  /** { text, seq } of the latest drop/pickup news, for the pocket
   * panel (see ItemsSystem.getState). */
  getLitterNotice() {
    return { text: this._litterNotice, seq: this._litterNoticeSeq };
  }

  /** Server time (ms), via the offset the last floor_litter
   * broadcast carried. Freshness is judged against this, never
   * the client's clock alone. */
  _now() {
    return Date.now() + (Number(this._serverNowOffset) || 0);
  }

  /** Is this litter entry still inside the catch window? */
  _isFresh(entry) {
    return isFreshLitter(entry, this._now());
  }

  /** Apply the server's canonical state. Also settles the pending
   * drop / timed-out drop: a drop is confirmed when the broadcast
   * shows our id (the item leaves the pocket then). A timed-out
   * drop is rechecked the same way — if the id is there now, the
   * drop HAD landed and only its answer was lost. */
  applyState(payload = {}) {
    // Catch a Litterbug v1 (`sq-litterbug-quest-v1`): the broadcast
    // carries the server's clock — keep the offset fresh so the
    // "!" markers and the catch pre-check use server time.
    if (Number.isFinite(Number(payload.now))) {
      this._serverNowOffset = Number(payload.now) - Date.now();
    }
    const next = parseFloorLitterState(payload);
    this.state = next;
    if (this._pendingDrop) {
      const confirmed = next.items.some((e) => e.id === this._pendingDrop.id);
      if (confirmed) this._settleDrop(this._pendingDrop.id);
    }
    if (this._unconfirmedDrop) {
      const target = this._unconfirmedDrop;
      const landed = next.items.some((e) => e.id === target.id);
      this._unconfirmedDrop = null;
      if (landed) this._settleDropTarget(target);
      // If it never landed, the timeout notice already told the
      // player to tap Drop again — nothing more to do.
    }
    this._drawAll();
  }

  /** The drop with this id landed on the server: the item leaves
   * the pocket (the slot frees up). Idempotent — a second settle
   * for the same id (result + broadcast, either order) is a no-op
   * because the pending entry is already gone. */
  _settleDrop(id) {
    const target = (this._pendingDrop?.id === id ? this._pendingDrop : null)
      || (this._unconfirmedDrop?.id === id ? this._unconfirmedDrop : null);
    return this._settleDropTarget(target);
  }

  /** Settle a drop from its pending record (already captured, so
   * the caller may have cleared the slot first). */
  _settleDropTarget(target) {
    if (!target) return false;
    if (this._pendingDrop?.id === target.id) {
      this._pendingDrop = null;
      this._clearDropTimer();
    }
    if (this._unconfirmedDrop?.id === target.id) this._unconfirmedDrop = null;
    try { this.scene?.itemsSystem?.confirmDroppedItem?.(target.itemId); } catch {}
    this._setLitterNotice(`🗑️ Dropped ${target.label || 'something'} — anyone here can pick it up.`);
    return true;
  }

  // ---- dropping (from the inventory) --------------------------------------

  /** Drop a pocket item on the floor where you are standing. The
   * item stays in the pocket until the server confirms the drop
   * (see applyState / onDropResult) — if the drop never lands,
   * nothing is lost. Returns { ok, pending?, reason?, message? }. */
  dropItem(itemId) {
    if (!this.enabled) return { ok: false, reason: 'at-home' };
    const item = getItem(itemId);
    if (!item) return { ok: false, reason: 'not-found' };
    if (item.type === ITEM_TYPES.MAILBOX_KEY) {
      return { ok: false, reason: 'mailbox-key-no-drop', message: 'You can’t drop your mailbox key — you’d lock yourself out of your own mail.' };
    }
    if (item.type === ITEM_TYPES.PUZZLE_PIECE) {
      return { ok: false, reason: 'puzzle-piece-no-drop' };
    }
    if (item.type === ITEM_TYPES.SANTA_HAT) {
      return { ok: false, reason: 'santa-hat-no-drop' };
    }
    if (isNeverDropType(item.type)) return { ok: false, reason: 'not-droppable' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    // Join gate (same as placing a decoration): the server
    // silently drops drop_item when room membership is not
    // registered yet, so emitting before the join lands would
    // wait forever.
    if (this.scene?.isRoomJoined?.() === false) return { ok: false, reason: 'not-joined' };
    // Client-side cap check: refuse before emitting, so a refused
    // drop never leaves a pending drop hanging (the server
    // re-validates the cap anyway).
    if ((this.state.items || []).length >= FLOOR_LITTER_MAX_PER_ROOM) {
      return { ok: false, reason: 'room-full' };
    }
    const player = this.scene?.player;
    const raw = { x: player?.gx ?? 800, y: player?.gy ?? 450 };
    let pos = raw;
    try {
      if (this.scene?.roomLayout?.clampPointToRoom) {
        pos = this.scene.roomLayout.clampPointToRoom(raw.x, raw.y, 24) || raw;
      }
    } catch {}
    const id = `litter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    // The snapshot is what dropItem already carried: the item as
    // it was, so picking it back up gives the same thing — a
    // bought croissant keeps its breadKind, a part-used bits of
    // food keeps its remaining feeds, a decoration keeps its kind.
    const snapshot = {
      type: item.type,
      title: item.title ?? null,
      text: item.text ?? null,
      label: item.label ?? null,
      blurb: item.blurb ?? null,
      decorKind: item.decorKind ?? null,
      breadKind: item.breadKind ?? null,
      trashFood: item.trashFood ?? null,
      usesLeft: item.usesLeft ?? null,
    };
    this._clearDropTimer();
    this._pendingDrop = { id, itemId: item.id, label: item.label || 'something' };
    this._dropTimer = setTimeout(() => this._onDropTimeout(), this._timeoutMs());
    try {
      this.scene.socket.emit('drop_item', {
        roomId: this.scene.roomId, id, item: snapshot, x: pos.x, y: pos.y,
      });
    } catch {
      this._clearDropTimer();
      this._pendingDrop = null;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true, id };
  }

  /** The server answered a drop: ok → the item leaves the pocket
   * (or it already did, via the broadcast — settling is
   * idempotent); fail → it stays, with the reason. */
  onDropResult(payload = {}) {
    const id = String(payload.id || '');
    if (!id || !this._pendingDrop || this._pendingDrop.id !== id) return;
    this._clearDropTimer();
    if (!payload.ok) {
      this._pendingDrop = null;
      this._setLitterNotice(this._dropReasonText(payload.reason));
      return;
    }
    this._settleDrop(id);
  }

  _dropReasonText(reason) {
    switch (reason) {
      case 'room-full': return '🗑️ This room’s floor is full — pick something up first.';
      case 'not-droppable': return '🗑️ That can’t be dropped here.';
      case 'not-home': return '🗑️ Drops here go on your home floor instead.';
      case 'rate-limited': return '🗑️ You’re dropping too fast — try again in a bit.';
      default: return '🗑️ The room didn’t take that — try again.';
    }
  }

  /** A pending drop got no answer in time. The item stays in the
   * pocket — nothing is lost. The attempt moves to
   * _unconfirmedDrop so the next floor_litter can still settle it
   * (the drop may have landed and only its answer was lost), and
   * state is re-requested right away so that recheck happens
   * promptly. The player is told to tap Drop again. */
  _onDropTimeout() {
    this._dropTimer = null;
    const pending = this._pendingDrop;
    if (!pending) return;
    this._pendingDrop = null;
    this._unconfirmedDrop = { ...pending };
    this._requestState();
    this._setLitterNotice('🗑️ The room didn’t answer — tap Drop again.');
  }

  // ---- picking up ----------------------------------------------------------

  /** The litter entry within stand range of (px, py) — or null
   * (E key / mobile button). */
  nearestLitter(px, py) {
    if (!this.enabled) return null;
    let best = null;
    let bestD = LITTER_PICKUP_RANGE;
    for (const entry of this.state.items || []) {
      const d = Math.hypot(px - entry.x, py - entry.y);
      if (d < bestD) { bestD = d; best = entry; }
    }
    return best ? { ...best } : null;
  }

  /** Pick up one litter entry. Anyone's litter is pickable,
   * first-come-wins. The pocket-full check happens BEFORE
   * emitting (the mail-collect two-step) — a full pocket never
   * even asks, so nothing is ever stranded. Returns
   * { ok, pending?, reason? }. */
  pickupLitter(litterId) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const entry = (this.state.items || []).find((e) => e.id === String(litterId));
    if (!entry) return { ok: false, reason: 'not-found' };
    const item = litterPocketItem(entry);
    if (!item) return { ok: false, reason: 'not-found' };
    if (!canAddItem(item)) return { ok: false, reason: 'inventory-full' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    if (this.scene?.isRoomJoined?.() === false) return { ok: false, reason: 'not-joined' };
    this._clearPickupTimer();
    this._pendingPickup = { litterId: entry.id, item };
    this._pickupTimer = setTimeout(() => this._onPickupTimeout(), this._timeoutMs());
    try {
      this.scene.socket.emit('pickup_floor_item', { roomId: this.scene.roomId, litterId: entry.id });
    } catch {
      this._clearPickupTimer();
      this._pendingPickup = null;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true };
  }

  /** The server answered a pickup: ok → the item lands in the
   * pocket (if there is still room), and only then the client
   * confirms and the claim settles. A late duplicate result
   * (same litter twice) never adds twice — the pending entry is
   * already gone. Fail → it stays on the floor, with the reason. */
  onPickupResult(payload = {}) {
    const litterId = String(payload.litterId || '');
    if (!litterId || !this._pendingPickup || this._pendingPickup.litterId !== litterId) return;
    const pending = this._pendingPickup;
    this._pendingPickup = null;
    this._clearPickupTimer();
    if (!payload.ok || !payload.item) {
      this._setLitterNotice(payload.reason === 'not-found'
        ? '🗑️ Someone else picked it up first.'
        : payload.reason === 'rate-limited'
          ? '🗑️ You’re picking up too fast — try again in a bit.'
          : '🗑️ Something went wrong — try again.');
      return;
    }
    const res = addItem(litterPocketItem({ ...pending.item, ...payload.item }));
    if (!res.ok) {
      // The pocket filled between the check and the add — the
      // entry goes back on the floor (cancel the claim), so
      // nothing is lost; the player just needs room first.
      try {
        this.scene?.socket?.emit('pickup_floor_item_cancel', { roomId: this.scene.roomId, litterId });
      } catch {}
      this._setLitterNotice(`🎒 ${INVENTORY_FULL_MESSAGE}`);
      return;
    }
    try {
      this.scene?.socket?.emit('pickup_floor_item_confirm', { roomId: this.scene.roomId, litterId });
    } catch {}
    this._setLitterNotice(`🎒 Picked up ${res.item.label || 'something'}!`);
  }

  /** A pending pickup got no answer in time. The entry stays on
   * the floor (the claim expires server-side and it comes back) —
   * the player just tries again. State is re-requested right away
   * so the floor is fresh. */
  _onPickupTimeout() {
    this._pickupTimer = null;
    const pending = this._pendingPickup;
    if (!pending) return;
    this._pendingPickup = null;
    this._requestState();
    this._setLitterNotice('🗑️ The room didn’t answer — try picking it up again.');
  }

  /** One click at world (wx, wy): on shared litter, act on it
   * (if standing close enough). Fresh litter is a CATCH, stale
   * litter is a pickup — see _actOnLitter. Silent unless it acts
   * — clicks elsewhere do nothing. Returns
   * { ok, picked?, caught?, reason? }. */
  litterTapAt(wx, wy) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const entry = (this.state.items || []).find(
      (e) => Math.hypot(wx - e.x, wy - e.y) <= LITTER_CLICK_RANGE,
    );
    if (!entry) return { ok: false, reason: 'no-litter' };
    if (Math.hypot(player.gx - entry.x, player.gy - entry.y) > LITTER_PICKUP_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    return this._actOnLitter(entry);
  }

  /** E key / mobile button: act on the nearest shared litter —
   * a catch while it is fresh, a pickup once it is stale. */
  pickupNearest() {
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const near = this.nearestLitter(player.gx, player.gy);
    if (!near) return { ok: false, reason: 'no-litter' };
    return this._actOnLitter(near);
  }

  // ---- catching a litterbug (Catch a Litterbug v1,
  // `sq-litterbug-quest-v1`) -----------------------------------------

  /** Fresh litter is a catch, stale litter is a pickup. The
   * "!" above fresh litter is the affordance — the player taps
   * it while it is still there. */
  _actOnLitter(entry) {
    if (this._isFresh(entry)) {
      const res = this._tryCatch(entry);
      return { ...res, caught: res.ok && res.pending, picked: false };
    }
    const res = this.pickupLitter(entry.id);
    return { ...res, picked: res.ok, caught: false };
  }

  /** Try to catch whoever dropped this litter. Your own litter
   * is refused on the spot ("nice try") — the server re-checks
   * anyway. Otherwise the catch goes to the server, and quest
   * progress happens ONLY on its ok (see onCatchResult) — never
   * on a local guess. Returns { ok, pending?, reason? }. */
  _tryCatch(entry) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (!entry) return { ok: false, reason: 'not-found' };
    if (String(entry.droppedBy || '') === String(this._myUserId() || '')) {
      this._setLitterNotice('🚨 That’s your own litter — nice try.');
      return { ok: false, reason: 'own-litter' };
    }
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    if (this.scene?.isRoomJoined?.() === false) return { ok: false, reason: 'not-joined' };
    this._clearCatchTimer();
    this._pendingCatch = { litterId: entry.id };
    this._catchTimer = setTimeout(() => this._onCatchTimeout(), this._timeoutMs());
    try {
      this.scene.socket.emit('litterbug_catch', { roomId: this.scene.roomId, litterId: entry.id });
    } catch {
      this._clearCatchTimer();
      this._pendingCatch = null;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true };
  }

  /** The server answered a catch: ok → the litterer is caught
   * (the room hears it too, via litterbug_caught) and quest
   * progress is recorded — ONLY here, on the confirm. Fail → the
   * reason, and no progress. */
  onCatchResult(payload = {}) {
    const litterId = String(payload.litterId || '');
    if (!litterId || !this._pendingCatch || this._pendingCatch.litterId !== litterId) return;
    this._pendingCatch = null;
    this._clearCatchTimer();
    if (!payload.ok) {
      this._setLitterNotice(this._catchReasonText(payload.reason));
      return;
    }
    this._setLitterNotice('🚨 Caught red-handed! The litterbug has been named.');
    try { this.onCatchConfirmed?.(); } catch {}
  }

  _catchReasonText(reason) {
    switch (reason) {
      case 'gone': return '🗑️ That litter is gone now.';
      case 'stale': return '🗑️ Too slow — that litter is no longer fresh.';
      case 'own-litter': return '🚨 That’s your own litter — nice try.';
      case 'rate-limited': return '🚨 You’re catching too fast — try again in a bit.';
      default: return '🚨 The room didn’t take that — try again.';
    }
  }

  /** A pending catch got no answer in time. Nothing is lost —
   * the litter is still on the floor — the player just tries
   * again. */
  _onCatchTimeout() {
    this._catchTimer = null;
    const pending = this._pendingCatch;
    if (!pending) return;
    this._pendingCatch = null;
    this._setLitterNotice('🚨 The room didn’t answer — try catching again.');
  }

  _clearCatchTimer() {
    if (this._catchTimer) { clearTimeout(this._catchTimer); this._catchTimer = null; }
  }

  // ---- drawing -------------------------------------------------------------

  _drawAll() {
    this._clearEntities();
    if (!this.enabled) return;
    for (const entry of this.state.items || []) {
      this._drawEntry(entry);
    }
  }

  _drawEntry(entry) {
    const scene = this.scene;
    let textObj = null;
    try {
      textObj = scene.add.text(entry.x, entry.y, entry.emoji || '📦', { fontSize: '22px' });
      textObj.setOrigin(0.5, 0.5);
      textObj.setDepth(DEPTH.ACTOR_MIN + Math.round(entry.y));
    } catch {}
    if (textObj) this._textObjs.set(entry.id, textObj);
    // Catch a Litterbug v1 (`sq-litterbug-quest-v1`): fresh litter
    // carries a "!" above it — the catch affordance. It expires
    // with the window (see update()).
    if (this._isFresh(entry)) {
      let freshObj = null;
      try {
        freshObj = scene.add.text(entry.x, entry.y - 26, '❗', { fontSize: '16px' });
        freshObj.setOrigin(0.5, 0.5);
        freshObj.setDepth(DEPTH.ACTOR_MIN + Math.round(entry.y) + 1);
      } catch {}
      if (freshObj) this._freshObjs.set(entry.id, freshObj);
    }
  }

  update() {
    if (!this.enabled) return;
    const now = Date.now();
    if (now - (this._lastCheckMs || 0) < 1000) return;
    this._lastCheckMs = now;
    // The litter re-spawns if a floor switch cleared it.
    if ((this.state.items || []).length > 0 && this._textObjs.size === 0) {
      this._drawAll();
    }
    // Catch a Litterbug v1 (`sq-litterbug-quest-v1`): "!" markers
    // expire with the catch window — drop the ones whose litter
    // went stale (or vanished) since the last draw.
    if (this._freshObjs.size > 0) {
      const fresh = new Map();
      for (const entry of this.state.items || []) fresh.set(entry.id, entry);
      for (const [id, textObj] of [...this._freshObjs.entries()]) {
        const entry = fresh.get(id);
        if (!entry || !this._isFresh(entry)) {
          try { textObj?.destroy(); } catch {}
          this._freshObjs.delete(id);
        }
      }
    }
    this._maybeRollNpcLitter(now);
  }

  // ---- NPC littering (Catch a Litterbug v1,
  // `sq-litterbug-quest-v1`) ------------------------------------------
  //
  // Shepherd Park only: every 2–5 minutes this client rolls for
  // a random patrolling NPC to drop a cup at its CURRENT position.
  // The drop goes through the same shared-litter path as a player
  // drop, so everyone in the room sees it. The server gates it
  // (shepherd-park, known label, 2-minute per-NPC cooldown), so
  // many clients rolling at once can never flood the room — a
  // refused report just never appears. Fire-and-forget: no
  // pending record, no result handled.
  _maybeRollNpcLitter(now) {
    if (this.scene?.roomId !== LITTERBUG_NPC_ROOM_ID) {
      this._npcRollAt = 0;
      return;
    }
    if (!this.scene?.socket?.connected) return;
    if (this.scene?.isRoomJoined?.() === false) return;
    if (!this._npcRollAt) {
      this._npcRollAt = now + this._npcRollDelayMs();
      return;
    }
    if (now < this._npcRollAt) return;
    this._npcRollAt = now + this._npcRollDelayMs();
    const npcs = (this.scene?.staticNpcs || []).filter(
      (npc) => npc && Array.isArray(npc.patrol) && npc.patrol.length > 0 && npc.name,
    );
    if (npcs.length === 0) return;
    const npc = npcs[Math.floor(Math.random() * npcs.length)];
    const x = Math.round(Number(npc.gx) || 0);
    const y = Math.round(Number(npc.gy) || 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const id = `litter-npc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      this.scene.socket.emit('npc_litter_drop', {
        roomId: this.scene.roomId, id, npcLabel: npc.name, x, y,
      });
    } catch {}
  }

  _npcRollDelayMs() {
    const span = LITTERBUG_NPC_ROLL_MAX_MS - LITTERBUG_NPC_ROLL_MIN_MS;
    return LITTERBUG_NPC_ROLL_MIN_MS + Math.floor(Math.random() * (span + 1));
  }

  _clearEntities() {
    for (const textObj of this._textObjs.values()) {
      try { textObj?.destroy(); } catch {}
    }
    this._textObjs.clear();
    for (const textObj of this._freshObjs.values()) {
      try { textObj?.destroy(); } catch {}
    }
    this._freshObjs.clear();
  }

  destroy() {
    this._clearEntities();
    this._clearDropTimer();
    this._clearPickupTimer();
    this._clearCatchTimer();
    this._pendingDrop = null;
    this._pendingPickup = null;
    this._pendingCatch = null;
    this._unconfirmedDrop = null;
    this._npcRollAt = 0;
    this.onCatchConfirmed = null;
    this.scene = null;
  }
}
