// MailSystem.js — the in-room side of the Mailbox (Mailbox v1,
// `sq-mailbox-v1`).
//
// Owned by VillageScene, same shape as NoticeBoardSystem /
// SantaHatSystem: constructed in create(), refreshed on floor
// switches, destroyed in shutdown(). The mailbox itself only
// renders in one of the player's mailbox rooms — Mailbox v1.2
// (`sq-mailbox-v1.2`): one mailbox per place (nearest park to that
// place, or AT the place when no park is close — the Galveston
// case), or the v1 single room (nearest park / open-access
// fallback) for players with no places. Every other room has no
// mailbox object at all. One shared inbox, one key, flag on every
// mailbox.
//
// THE MAILBOX: a post box by the room's entrance (east of the
// entry — the notice board takes the west side in parks). Walk up
// and press E, or click the mailbox itself, to open it
// (MailboxPanel.jsx): a list of your packages, newest last; Take
// one, or Take All. The inbox is SERVER state (server/socket.js,
// in-memory per player like badges): sending and collecting go
// through the socket, and the mail waits there until you collect
// it — the sender never needs to know where your mailbox is.
//
// SENDING (from the inventory — an item's "Send ✉️" button): you
// type the recipient's mailbox code (5 letters). The item leaves
// the pocket ONLY when the server confirms the send (see
// onSendResult) — an unknown code, or a send that never lands
// (offline, rate-limited), leaves the item in your pocket.
// Nothing is ever lost by sending.
//
// Gift Wrapping Paper v1 (`sq-gift-wrap-v1`): sending costs ONE
// SHEET of gift wrapping paper (2 coins a sheet at the Agora
// bar). The sheet is checked before the send is even attempted
// ('no-paper' refusal, item stays) and spent only when the
// server confirms the send — same pending pattern as the item
// itself. The send carries `wrapped: true` and the server refuses
// any send without it ('not-wrapped'), so a gift never travels
// unwrapped. The recipient sees the package as wrapped (🎁).
//
// COLLECTING: Take asks the server for the package FIRST
// (mail_collect_result); only when the result arrives AND the
// pocket has room does the item land in the pocket — and only
// then does the client confirm (mail_collect_confirm), which is
// when the server removes the package from the inbox. A full
// pocket can never eat a gift: the package simply stays in the
// mailbox. Take All collects oldest-first, as many as fit.
//
// THE KEY: opening the mailbox needs the mailbox key in your
// pocket. The key is auto-granted on first load (see
// ensureMailboxKey in items.js) and can be left at home. Without
// it, the prompt says so — "Your key is at home" when it is
// stored there, plain "You need your mailbox key" otherwise.
//
// NOTIFICATIONS (all three, user-decided):
//   1. a "📬 You've got mail!" toast — on login when the first
//      mail_state shows unread mail, and the moment mail arrives
//      while you're online (mail_arrived). Mailbox v1.1
//      (`sq-mailbox-v1.1`): the toast names the mailbox room when
//      it is known — "📬 You’ve got mail at Shepherd Park!" — and
//      falls back to the plain text when it is not. Mailbox v1.2
//      (`sq-mailbox-v1.2`, decision 1): with two mailboxes it names
//      the NEAREST one to the player at toast time.
//   2. an envelope dot on the 🎒 pocket button until the mail is
//      collected (VillageCanvas polls getState());
//   3. a red flag up on the mailbox itself while you have mail
//      (redrawn on every applyState).

import { DEPTH } from './depth.js';
import {
  MAILBOX_MARKER_V1,
  MAILBOX_MARKER_V1_1,
  MAILBOX_MARKER_V1_2,
  GIFT_WRAP_MARKER_V1,
  MAILBOX_W,
  MAILBOX_H,
  MAILBOX_OPEN_RANGE,
  createMailState,
  parseMailState,
  mailboxCodeFor,
  normalizeMailboxCode,
  isValidMailboxCode,
  cleanMailItem,
  resolveMailboxRooms,
  nearestMailboxRoom,
  resolveMailboxSpot,
  mailToastText,
} from './mailState.js';
import {
  ITEM_TYPES,
  INVENTORY_FULL_MESSAGE,
  getItem,
  removeItem,
  addItem,
  canAddItem,
  getInventoryState,
  ensureMailboxKey,
  hasMailboxKey,
  // Gift Wrapping Paper v1 (`sq-gift-wrap-v1`): sending costs one
  // sheet; the sheet leaves only on the server's confirm.
  hasWrappingPaper,
  spendWrappingSheet,
} from './items.js';
import { getHomeItems, findHomeRooms } from './homeStorage.js';

// How long a send / collect waits for the server before giving up
// (same 5s as the decoration shop's pending timeout).
const MAIL_PENDING_TIMEOUT_MS = 5000;

export class MailSystem {
  constructor(scene) {
    this.scene = scene;
    // sq-mailbox-v1 — marker for the v1 landing check.
    this.marker = MAILBOX_MARKER_V1;
    // sq-mailbox-v1.1 — marker for the v1.1 landing check (live
    // reference, so the string survives minification into the
    // built bundle).
    this.markerV11 = MAILBOX_MARKER_V1_1;
    // sq-mailbox-v1.2 — marker for the v1.2 landing check (live
    // reference, same reason).
    this.markerV12 = MAILBOX_MARKER_V1_2;
    // sq-gift-wrap-v1 — marker for the gift-wrap landing check
    // (live reference, same reason).
    this.markerGiftWrap = GIFT_WRAP_MARKER_V1;
    this.state = createMailState();
    this._mailbox = null; // { x, y, w, h, roomId, roomName, isPark } — null when this room is not my mailbox room
    this._gfx = null; // Phaser graphics for the post box
    this._label = null; // Phaser text label above the box
    this._flagGfx = null; // red flag, drawn only while I have mail
    this._lastUnread = -1;
    this._pendingSends = new Map(); // packageId -> { itemId, timer }
    this._pendingCollects = new Map(); // packageId -> { item, timer }
    this._collectedIds = new Set(); // packageIds already added to the pocket (a late duplicate result must not add twice)
    this._mailNotice = { text: '', seq: 0 };
    this._sawFirstState = false;
  }

  // The mailbox lives in ONE room per player (their nearest park,
  // or the fallback) — but the system exists everywhere, because
  // sending happens from the pocket in any room.
  get enabled() {
    return Boolean(this.scene?.roomId);
  }

  /** Is this room the player's mailbox room? */
  get isMailboxRoom() {
    return Boolean(this._mailbox);
  }

  /** Plain-data state for the mailbox panel + the pocket button dot
   *  (both poll this ~1-2x/sec). */
  getState() {
    const packages = (this.state.packages || []).map((p) => ({ ...p, item: { ...p.item } }));
    // Mailbox v1.1 (`sq-mailbox-v1.1`): the room the mailbox lives
    // in, resolved from ANY room (see _mailboxRoom) — v1 only named
    // it while you were already standing in it (mailboxRoomId /
    // mailboxRoomName came from `this._mailbox`, which is only set
    // when this room IS the mailbox room), so the pocket line
    // "Your mailbox is at …" was blank everywhere else — and a
    // "Go to my mailbox" button wired to that state would have been
    // hidden everywhere except the mailbox room itself.
    // Mailbox v1.2 (`sq-mailbox-v1.2`): there can be TWO mailbox
    // rooms now (one per place), so getState also returns the full
    // list — `mailboxRooms` — and mailboxRoomId / mailboxRoomName
    // stay as the NEAREST one (the toast, the pocket line and the
    // Go button all lead with it).
    const mailboxRooms = this._mailboxRooms();
    const mailboxRoom = this._nearestFrom(mailboxRooms);
    return {
      packages,
      unread: packages.length,
      mailboxCode: mailboxCodeFor(this.scene?.userId || ''),
      mailboxRooms,
      mailboxRoomId: mailboxRoom?.roomId || '',
      mailboxRoomName: mailboxRoom?.roomName || '',
      isMailboxRoom: this.isMailboxRoom,
      hasKey: hasMailboxKey(),
      mailNotice: this._mailNotice.text || '',
      mailNoticeSeq: this._mailNotice.seq || 0,
    };
  }

  /** My mailbox rooms from ANY room (Mailbox v1.2,
   *  `sq-mailbox-v1.2`): one per place — nearest park to that
   *  place, or AT the place when no park is close — or the v1
   *  single room (nearest park / open-access fallback) for
   *  players with no places. `findHomeRooms` reads the player's
   *  places (deterministic ids `home-<owner>` / `home-<owner>_2`)
   *  out of allRooms; the places carry their own lat/lng (created
   *  at the player's real location), so the park lookup measures
   *  from the place, not from where the player happens to be
   *  standing. A second place created later gains its mailbox on
   *  the next scene (re)build — place creation happens on the map,
   *  so entering any room afterwards rebuilds the scene with the
   *  new place in allRooms. Places cannot be deleted, so no
   *  deletion handling is needed. Returns [] when nothing
   *  resolves. */
  _mailboxRooms() {
    try {
      const places = findHomeRooms(this.scene?.allRooms || [], this.scene?.profile);
      return resolveMailboxRooms(
        this.scene?.allRooms || [],
        this.scene?.userLocation || null,
        places,
      );
    } catch { return []; }
  }

  /** The nearest of my mailbox rooms to my current location —
   *  the one the toast names, the pocket line leads with, and the
   *  Go button takes me to (Mailbox v1.2 decision 1 + 3). */
  _nearestFrom(mailboxRooms) {
    try {
      return nearestMailboxRoom(
        mailboxRooms,
        this.scene?.allRooms || [],
        this.scene?.userLocation || null,
      );
    } catch { return null; }
  }

  /** My mailbox room from ANY room (Mailbox v1.1,
   *  `sq-mailbox-v1.1`): the nearest park / fallback, resolved from
   *  allRooms + userLocation (both are set at scene boot, before any
   *  socket state can arrive). Unlike `this._mailbox` (the drawn
   *  object, only set when this room IS a mailbox room), this
   *  answers "where is my mailbox?" everywhere. Mailbox v1.2: the
   *  nearest of the per-place rooms. Null when no room resolves
   *  (empty room list) — callers fall back to the plain toast /
   *  hide the button. */
  _mailboxRoom() {
    try {
      return this._nearestFrom(this._mailboxRooms());
    } catch { return null; }
  }

  /** The mailbox room's name, or '' when it is not resolved yet —
   *  the toast sites use this and fall back to the plain text. */
  _mailboxRoomName() {
    try { return this._mailboxRoom()?.roomName || ''; } catch { return ''; }
  }

  /** (Re)build the mailbox position + drawing, grant the key, and
   *  ask the server for the inbox. */
  refresh() {
    // The key is auto-granted on first load (see items.js): one
    // per player, never duplicated, retried when the pocket has room.
    try { ensureMailboxKey(getHomeItems()); } catch {}
    this._resolveMailbox();
    this._renderMailbox();
    this._requestState();
  }

  _requestState() {
    try {
      if (this.scene?.socket?.connected) {
        this.scene.socket.emit('get_mail', { roomId: this.scene.roomId });
      }
    } catch {}
  }

  /** Apply the server's canonical inbox. Also drives the three
   *  notifications: the login toast (first state with unread mail),
   *  and the flag redraw (the dot comes from getState polling). */
  applyState(payload = {}) {
    const next = parseMailState(payload);
    const hadUnread = (this.state.packages || []).length;
    this.state = next;
    const unread = next.packages.length;
    if (!this._sawFirstState) {
      this._sawFirstState = true;
      if (unread > 0) {
        // Mailbox v1.1 (`sq-mailbox-v1.1`): the login toast names
        // the mailbox room when it is resolved — "📬 You’ve got
        // mail at Shepherd Park!" — and falls back to the plain
        // text when it is not (never a blank).
        try { this.scene?.onSystemNotice?.(mailToastText({ roomName: this._mailboxRoomName() })); } catch {}
      }
    }
    if (unread !== hadUnread) this._renderFlag();
  }

  /** Mail just arrived while I'm online: toast now (the server
   *  also sends the fresh mail_state right after, so the dot and
   *  flag update on their own). Mailbox v1.1 (`sq-mailbox-v1.1`):
   *  the toast names the mailbox room too — "📬 You’ve got mail
   *  from Alice at Shepherd Park!" — falling back to the plain
   *  "from Alice" text when the room is unresolved. */
  onMailArrived(payload = {}) {
    const from = typeof payload.fromName === 'string' && payload.fromName.trim()
      ? payload.fromName.trim()
      : 'Someone';
    try { this.scene?.onSystemNotice?.(mailToastText({ roomName: this._mailboxRoomName(), fromName: from })); } catch {}
  }

  // ---- the mailbox object in the room ------------------------------------

  /** Resolve this room's mailbox: only when this room IS one of
   *  the player's mailbox rooms (Mailbox v1.2,
   *  `sq-mailbox-v1.2` — one per place, or the v1 single room for
   *  players with no places). Otherwise _mailbox stays null and
   *  nothing is drawn here. */
  _resolveMailbox() {
    this._mailbox = null;
    if (!this.enabled) return;
    let rooms = [];
    try { rooms = this._mailboxRooms(); } catch { rooms = []; }
    const mine = rooms.find((r) => r && r.roomId === this.scene.roomId);
    if (!mine) return;
    const spot = this._resolveMailboxSpot();
    this._mailbox = {
      ...spot,
      roomId: mine.roomId,
      roomName: mine.roomName,
      isPark: mine.isPark,
      isHome: mine.isHome || false,
    };
  }

  /** Where the box goes: east of the entry (the notice board takes
   *  the west side in parks), else west, else near the spawn.
   *  Mirrors RoomLayout.getNoticeBoardFallback's entry/spawn
   *  discovery. Mailbox v1.2 (`sq-mailbox-v1.2`, decision 4): the
   *  SAME spot logic in a home room — the home entry is bottom
   *  centre, so east of it is clear of the storage chest (north
   *  wall), the couches and the portrait. No home-specific spot. */
  _resolveMailboxSpot() {
    const layout = this.scene?.roomLayout;
    let entry = null;
    let spawn = null;
    try {
      const floor = layout?.layout?.floors?.[layout?.currentFloor || 0];
      entry = (floor?.zones || []).find((z) => z.type === 'entry') || null;
      spawn = layout?.layout?.spawnF1 || null;
    } catch {}
    let bounds = null;
    try { bounds = layout?.getBoundaryBounds?.(); } catch {}
    return resolveMailboxSpot({
      entry,
      spawn,
      bounds,
      isInside: (x, y) => {
        try { return layout?.isPointInsideRoom?.(x, y, 0) ?? true; } catch { return true; }
      },
    });
  }

  /** Draw the post box (+ label). The flag is drawn separately so
   *  it can flip without redrawing the box. */
  _renderMailbox() {
    this._destroyDrawing();
    if (!this._mailbox) return;
    const b = this._mailbox;
    const cx = b.x + b.w / 2;
    const groundY = b.y + b.h;
    try {
      const g = this.scene.add.graphics();
      // Post.
      g.fillStyle(0x6b4a2f, 1);
      g.fillRect(cx - 5, b.y + 34, 10, b.h - 34);
      // Box body.
      g.fillStyle(0x1a4971, 1);
      g.fillRect(b.x + 6, b.y + 6, b.w - 12, 30);
      // Box lid (rounded look via a lighter strip).
      g.fillStyle(0x2b6a9e, 1);
      g.fillRect(b.x + 6, b.y + 6, b.w - 12, 8);
      // Slot.
      g.fillStyle(0x0f172a, 1);
      g.fillRect(b.x + 16, b.y + 18, b.w - 32, 4);
      g.setDepth(DEPTH.ACTOR_MIN + Math.round(groundY));
      this._gfx = g;
      const label = this.scene.add.text(cx, b.y - 6, '📬 Mailbox', {
        fontSize: '13px', color: '#1a4971',
        backgroundColor: 'rgba(255,255,255,0.85)', padding: { x: 6, y: 3 },
      });
      label.setOrigin(0.5, 1);
      label.setDepth(DEPTH.UI);
      this._label = label;
    } catch {}
    this._lastUnread = -1;
    this._renderFlag();
  }

  /** Draw (or hide) the red flag: up while I have unread mail. */
  _renderFlag() {
    const unread = (this.state.packages || []).length;
    if (unread === this._lastUnread) return;
    this._lastUnread = unread;
    try { this._flagGfx?.destroy(); } catch {}
    this._flagGfx = null;
    if (!this._mailbox || unread <= 0) return;
    const b = this._mailbox;
    try {
      const g = this.scene.add.graphics();
      // Flag pole + red flag on the box's right side, raised.
      g.fillStyle(0x8a8f98, 1);
      g.fillRect(b.x + b.w - 8, b.y - 14, 3, 22);
      g.fillStyle(0xdc2626, 1);
      g.fillTriangle(
        b.x + b.w - 5, b.y - 14,
        b.x + b.w + 16, b.y - 8,
        b.x + b.w - 5, b.y - 2,
      );
      g.setDepth(DEPTH.ACTOR_MIN + Math.round(b.y + b.h));
      this._flagGfx = g;
    } catch {}
  }

  _destroyDrawing() {
    try { this._gfx?.destroy(); } catch {}
    try { this._label?.destroy(); } catch {}
    try { this._flagGfx?.destroy(); } catch {}
    this._gfx = null;
    this._label = null;
    this._flagGfx = null;
  }

  /** One click on the mailbox itself: open it if the click lands
   *  on the box and the player is standing close enough. Same
   *  scene-level pointerdown pattern as the notice board. Returns
   *  { ok, opened?, reason? }. */
  mailboxTapAt(wx, wy) {
    if (!this.enabled || !this._mailbox) return { ok: false, reason: 'not-available' };
    const b = this._mailbox;
    if (wx < b.x || wx > b.x + b.w || wy < b.y || wy > b.y + b.h) {
      return { ok: false, reason: 'no-mailbox' };
    }
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const cx = Math.max(b.x, Math.min(player.gx, b.x + b.w));
    const cy = Math.max(b.y, Math.min(player.gy, b.y + b.h));
    if (Math.hypot(player.gx - cx, player.gy - cy) > MAILBOX_OPEN_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    this.openMailbox();
    return { ok: true, opened: true };
  }

  /** The mailbox within MAILBOX_OPEN_RANGE of (x, y) — or null (E key). */
  nearestMailbox(px, py) {
    if (!this.enabled || !this._mailbox) return null;
    const b = this._mailbox;
    const cx = Math.max(b.x, Math.min(px, b.x + b.w));
    const cy = Math.max(b.y, Math.min(py, b.y + b.h));
    return Math.hypot(px - cx, py - cy) <= MAILBOX_OPEN_RANGE ? { ...b } : null;
  }

  /** Open the mailbox overlay (DOM panel, MailboxPanel.jsx). The
   *  key must be in your pocket — without it the prompt says so
   *  (and names home when the key is stored there). */
  openMailbox() {
    if (!this.enabled) return;
    if (!hasMailboxKey()) {
      let atHome = false;
      try {
        atHome = getHomeItems().some((it) => it.type === ITEM_TYPES.MAILBOX_KEY);
      } catch {}
      try {
        this.scene?.onSystemNotice?.(atHome
          ? '🔑 Your mailbox key is at home — go get it first.'
          : '🔑 You need your mailbox key to open your mailbox.');
      } catch {}
      return;
    }
    try { this.scene?.onOpenMailbox?.(); } catch {}
  }

  // ---- sending -------------------------------------------------------------

  /** Send a pocket item to the player with this mailbox code. The
   *  item leaves the pocket ONLY when the server confirms the send
   *  (see onSendResult) — an unknown code, or a send that never
   *  lands, leaves the item in your pocket. Returns
   *  { ok, pending?, reason? }.
   *
   *  Gift Wrapping Paper v1 (`sq-gift-wrap-v1`): the send is
   *  refused up front ('no-paper') when the pocket holds no
   *  wrapping paper — no emit, nothing spent. The sheet itself is
   *  spent in onSendResult, only on the server's ok. */
  sendMail(itemId, code) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    const cleanCode = normalizeMailboxCode(code);
    if (!isValidMailboxCode(cleanCode)) return { ok: false, reason: 'bad-code' };
    const item = getItem(itemId);
    if (!item) return { ok: false, reason: 'not-found' };
    const cleaned = cleanMailItem(item);
    if (!cleaned) return { ok: false, reason: 'not-sendable' };
    // sq-gift-wrap-v1 — no paper, no send: refuse before any emit,
    // so a refused send costs nothing (no sheet, no item).
    if (!hasWrappingPaper()) return { ok: false, reason: 'no-paper' };
    const packageId = `mail-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const fromName = this._displayName();
    this._pendingSends.set(packageId, {
      itemId: item.id,
      timer: setTimeout(() => {
        if (!this._pendingSends.has(packageId)) return;
        this._pendingSends.delete(packageId);
        this._postMailNotice('📬 The room didn’t answer — tap Send again.');
      }, MAIL_PENDING_TIMEOUT_MS),
    });
    try {
      this.scene.socket.emit('mail_send', {
        roomId: this.scene.roomId,
        packageId,
        code: cleanCode,
        item: cleaned,
        fromName,
        // sq-gift-wrap-v1 — the server refuses any send without
        // this flag ('not-wrapped'); the package is stored wrapped.
        wrapped: true,
      });
    } catch {
      const pending = this._pendingSends.get(packageId);
      if (pending) clearTimeout(pending.timer);
      this._pendingSends.delete(packageId);
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true, packageId };
  }

  /** The server answered a send: ok → the item leaves the pocket
   *  (the slot frees up); fail → it stays, with the reason.
   *
   *  Gift Wrapping Paper v1 (`sq-gift-wrap-v1`): on ok, one sheet
   *  of wrapping paper leaves with the gift — spent here, only on
   *  the server's confirm, never on a refusal or a timeout. A
   *  failed spend (paper vanished in another tab) never blocks
   *  the item leaving: the send already happened server-side. */
  onSendResult(payload = {}) {
    const packageId = String(payload.packageId || '');
    const pending = this._pendingSends.get(packageId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this._pendingSends.delete(packageId);
    if (!payload.ok) {
      this._postMailNotice(this._sendReasonText(payload.reason));
      return;
    }
    try {
      // sq-gift-wrap-v1 — spend the sheet first: the gift is
      // wrapped, the paper is used up.
      try { spendWrappingSheet(); } catch {}
      const removed = removeItem(pending.itemId);
      if (removed) {
        // Gift Giver v1 (`sq-gift-giver-v1`): a mailed gift counts
        // on the send confirm — the gift is in their inbox now.
        // Direct gifts count in GiftSystem, on the recipient's
        // confirm. Either way, one gift.
        try { this.scene?.questManager?.recordGlobalEvent('gift-given'); } catch {}
        const name = typeof payload.recipientName === 'string' && payload.recipientName.trim()
          ? payload.recipientName.trim()
          : 'them';
        // The success goes through BOTH channels: the scene toast
        // (seen when the pocket is closed) and the mail notice
        // (seen in the pocket panel, which sits ABOVE the toast).
        try { this.scene?.onSystemNotice?.(`📬 Sent to ${name}!`); } catch {}
        this._postMailNotice(`📬 Sent to ${name}!`);
      }
    } catch {}
  }

  _sendReasonText(reason) {
    switch (reason) {
      case 'unknown-code': return 'No mailbox with that code — check it and try again.';
      case 'self-send': return 'That’s your own code — send it to a friend instead.';
      case 'not-sendable': return 'That can’t be sent by mail.';
      // Gift Wrapping Paper v1 (`sq-gift-wrap-v1`): the two new
      // refusals. 'no-paper' is the client-side check (pocket
      // empty); 'not-wrapped' is the server's flag check — it
      // should never surface from a normal client, which always
      // sends the flag, but the words are the same either way.
      case 'no-paper': return 'You need gift wrapping paper to send a gift — buy some at the Agora bar.';
      case 'not-wrapped': return 'That gift needs wrapping paper — buy some at the Agora bar.';
      case 'inbox-full': return 'Their mailbox is full — try again later.';
      case 'rate-limited': return 'You’re sending too fast — try again in a bit.';
      default: return 'Something went wrong — try again.';
    }
  }

  // ---- collecting ----------------------------------------------------------

  /** Take one package out of the mailbox, into the pocket. The
   *  server only removes it from the inbox when the client
   *  confirms the item landed (mail_collect_confirm) — a full
   *  pocket can never eat a gift. Returns { ok, pending?, reason? }. */
  collectPackage(packageId) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    const pkg = (this.state.packages || []).find((p) => p.id === String(packageId));
    if (!pkg) return { ok: false, reason: 'not-found' };
    if (!canAddItem(pkg.item)) {
      return { ok: false, reason: 'inventory-full' };
    }
    this._pendingCollects.set(pkg.id, {
      item: { ...pkg.item },
      // Gift Wrapping Paper v1 (`sq-gift-wrap-v1`): the wrapped
      // flag, so the collect toast can say it was a wrapped gift.
      wrapped: pkg.wrapped === true,
      timer: setTimeout(() => {
        if (!this._pendingCollects.has(pkg.id)) return;
        this._pendingCollects.delete(pkg.id);
        this._postMailNotice('📬 The room didn’t answer — tap Take again.');
      }, MAIL_PENDING_TIMEOUT_MS),
    });
    try {
      this.scene.socket.emit('mail_collect', { roomId: this.scene.roomId, packageId: pkg.id });
    } catch {
      const pending = this._pendingCollects.get(pkg.id);
      if (pending) clearTimeout(pending.timer);
      this._pendingCollects.delete(pkg.id);
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true };
  }

  /** The server answered a collect: ok → the item lands in the
   *  pocket (if there is still room — the panel is modal, so the
   *  pocket cannot fill under it, but a second tab could), and only
   *  then the client confirms and the server removes the package.
   *  A late duplicate result (same package twice) never adds twice. */
  onCollectResult(payload = {}) {
    const packageId = String(payload.packageId || '');
    const pending = this._pendingCollects.get(packageId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this._pendingCollects.delete(packageId);
    if (!payload.ok || !payload.item) {
      this._postMailNotice(payload.reason === 'not-found'
        ? 'That package is already gone.'
        : 'Something went wrong — try again.');
      return;
    }
    if (this._collectedIds.has(packageId)) {
      // Already added (a duplicate result) — still confirm, so the
      // server removes the package instead of leaving it behind.
      try {
        this.scene?.socket?.emit('mail_collect_confirm', { roomId: this.scene.roomId, packageId });
      } catch {}
      return;
    }
    const res = addItem(payload.item);
    if (!res.ok) {
      // The pocket filled between the check and the add — the
      // package stays in the inbox (no confirm is sent), so nothing
      // is lost; the player just needs room first.
      this._postMailNotice(`🎒 ${INVENTORY_FULL_MESSAGE}`);
      return;
    }
    this._collectedIds.add(packageId);
    try {
      this.scene?.socket?.emit('mail_collect_confirm', { roomId: this.scene.roomId, packageId });
    } catch {}
    // Both channels again: the scene toast (mailbox closed) and
    // the mail notice (the mailbox panel sits above the toast).
    // Gift Wrapping Paper v1 (`sq-gift-wrap-v1`): a wrapped
    // package says so — the gift inside is the plain item, the
    // wrap was the packaging.
    const gotText = pending.wrapped
      ? `📬 You got a wrapped gift: ${res.item.label || 'a gift'}!`
      : `📬 You got ${res.item.label || 'a gift'}!`;
    try {
      this.scene?.onSystemNotice?.(gotText);
    } catch {}
    this._postMailNotice(gotText);
  }

  /** Take All: collect oldest-first, as many as fit right now.
   *  The rest stay in the mailbox. */
  collectAll() {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    const inv = getInventoryState();
    let room = Math.max(0, inv.capacity - inv.count);
    let started = 0;
    for (const pkg of this.state.packages || []) {
      if (room <= 0) break;
      const res = this.collectPackage(pkg.id);
      if (res.ok) { started += 1; room -= 1; }
    }
    if (started === 0) return { ok: false, reason: 'inventory-full' };
    return { ok: true, started };
  }

  // ---- helpers ---------------------------------------------------------------

  _displayName() {
    try {
      const p = this.scene?.profile?.profile || {};
      return p.characterName || p.firstName || this.scene?.userId || 'Someone';
    } catch {
      return 'Someone';
    }
  }

  _postMailNotice(text) {
    this._mailNotice = { text: String(text || ''), seq: (this._mailNotice.seq || 0) + 1 };
  }

  update() {
    // Nothing per-frame: sends / collects arrive over the socket,
    // opens arrive via pointerdown / E, and the panel polls getState().
  }

  destroy() {
    for (const pending of this._pendingSends.values()) {
      try { clearTimeout(pending.timer); } catch {}
    }
    for (const pending of this._pendingCollects.values()) {
      try { clearTimeout(pending.timer); } catch {}
    }
    this._pendingSends.clear();
    this._pendingCollects.clear();
    this._collectedIds.clear();
    this._destroyDrawing();
    this.scene = null;
  }
}
