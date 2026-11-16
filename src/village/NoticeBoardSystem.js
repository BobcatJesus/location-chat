// NoticeBoardSystem.js — the in-room side of the Notice Board
// (`sq-notice-board-v1`, boards in every location,
// `sq-notice-board-everywhere-v1`).
//
// Owned by VillageScene, same shape as PuzzleQuest / ItemsSystem:
// constructed in create(), refreshed on floor switches, destroyed in
// shutdown(). Every room has a board — not just Agora.
//
// THE BOARD: hangs by the room's entrance (Agora's south wall just
// west of the door, Lola's south wall, the Library ground floor, a
// corkboard on a post by the park entry, or a synthetic spot near
// the entrance in any other room — see noticeBoardPlacement.js and
// RoomLayout's fallback). Everyone walks past it coming in. Walk up
// and press E, or click the board itself, to open it
// (NoticeBoardPanel.jsx): a list of the flyers pinned here, newest
// first; click one to read it. The board is SERVER state
// (server/socket.js, in-memory per room like the puzzle): pinning,
// reading and removing go through the socket, and every player in
// the room sees the same board. Each room's board is separate —
// flyers pinned in Agora show only in Agora.
//
// PINNING (from the inventory — a flyer's "Pin to notice board"
// button): the flyer leaves the pocket ONLY when the server
// confirms the pin. The client generates the flyer id, emits
// `board_pin`, and keeps a pending pin; when the `board_state`
// broadcast shows that id, ItemsSystem drops the flyer from the
// pocket (the slot frees up) and toasts. If the pin never lands
// (offline, rate-limited), the flyer simply stays in the pocket —
// nothing is ever lost by pinning.
//
// REMOVING: your own flyer, or any flyer if you are a moderator
// (the panel shows the button; the server re-validates). When the
// broadcast confirms YOUR take-down, the flyer comes back to your
// pocket if there is room — otherwise it is discarded and the panel
// says so. A moderator taking down someone else's flyer discards
// it; it never goes back to its owner.

import {
  NOTICE_BOARD_MARKER,
  NOTICE_BOARD_EVERYWHERE_MARKER,
  NOTICE_BOARD_MAX_FLYERS,
  createNoticeBoardState,
  parseNoticeBoardState,
} from './noticeBoardState.js';

// How close you must stand to read the board (E key) or click it.
const BOARD_OPEN_RANGE = 170; // px, same as the bartender's talk range

export class NoticeBoardSystem {
  constructor(scene) {
    this.scene = scene;
    // sq-notice-board-everywhere-v1 — marker for the everywhere landing check.
    this.marker = NOTICE_BOARD_EVERYWHERE_MARKER;
    this.v1Marker = NOTICE_BOARD_MARKER;
    this.state = createNoticeBoardState();
    this._board = null; // { x, y, w, h } of the board, from the layout
    this._pendingPin = null; // { id, itemId } awaiting the board_state that confirms it
    this._pendingRemoval = null; // { flyerId, flyer } awaiting the broadcast that confirms it
  }

  // Every room has a board (boards in every location) — the only
  // requirement is being in a room at all.
  get enabled() {
    return Boolean(this.scene?.roomId);
  }

  /** Plain-data state for the board panel (polls this ~2x/sec). */
  getState() {
    return {
      flyers: (this.state.flyers || []).map((f) => ({ ...f })),
      count: (this.state.flyers || []).length,
      max: NOTICE_BOARD_MAX_FLYERS,
      myUserId: this.scene?.userId || this.scene?.socket?.id || '__local__',
      roomId: this.scene?.roomId || '',
    };
  }

  /** (Re)build the board position and ask the server for its state. */
  refresh() {
    this._resolveBoard();
    this._requestState();
  }

  _requestState() {
    try {
      if (this.scene?.socket?.connected) {
        this.scene.socket.emit('get_board', { roomId: this.scene.roomId });
      }
    } catch {}
  }

  /** Apply the server's canonical board state. Also settles the
   * pending pin / removal: a pin is confirmed when the broadcast
   * shows our id (the flyer leaves the pocket then), and a
   * take-down is confirmed when the flyer is gone (it comes back
   * to the pocket if there is room, otherwise it is discarded). */
  applyState(payload = {}) {
    const next = parseNoticeBoardState(payload);
    this.state = next;
    if (this._pendingPin) {
      const confirmed = next.flyers.some((f) => f.id === this._pendingPin.id);
      if (confirmed) {
        const { itemId } = this._pendingPin;
        this._pendingPin = null;
        try { this.scene?.itemsSystem?.confirmPinnedFlyer?.(itemId); } catch {}
        try { this.scene?.onSystemNotice?.('📌 Pinned to the notice board!'); } catch {}
      }
    }
    if (this._pendingRemoval) {
      const stillThere = next.flyers.some((f) => f.id === this._pendingRemoval.flyerId);
      if (!stillThere) {
        const { flyer } = this._pendingRemoval;
        this._pendingRemoval = null;
        try {
          const res = this.scene?.itemsSystem?.returnFlyerToPocket?.(flyer);
          if (res && res.ok) {
            this.scene?.onSystemNotice?.('📄 Flyer taken down — back in your pocket.');
          } else {
            this.scene?.onSystemNotice?.('📄 Flyer taken down — but your pocket was full, so it was discarded.');
          }
        } catch {}
      }
    }
  }

  // ---- pinning (from the inventory) --------------------------------------

  /** Pin a flyer from the pocket to the board. The flyer stays in
   * the pocket until the server confirms (see applyState) — if the
   * pin never lands, nothing is lost. Returns { ok, pending?, reason? }. */
  pinFlyer(title, text, itemId) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    const cleanTitle = String(title || '').trim().slice(0, 60);
    const cleanText = String(text || '').trim().slice(0, 200);
    if (!cleanTitle || !cleanText) return { ok: false, reason: 'empty-flyer' };
    const id = `board-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    this._pendingPin = { id, itemId };
    try {
      this.scene.socket.emit('board_pin', {
        roomId: this.scene.roomId, id, title: cleanTitle, text: cleanText,
      });
    } catch {
      this._pendingPin = null;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true, id };
  }

  // ---- removing ------------------------------------------------------------

  /** Take a flyer down. Own flyers come back to the pocket (see
   * applyState); a moderator taking down someone else's flyer
   * discards it. The server re-validates ownership / moderator
   * status, so a bad client cannot remove what is not theirs. */
  removeFlyer(flyerId) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    const flyer = (this.state.flyers || []).find((f) => f.id === String(flyerId));
    if (!flyer) return { ok: false, reason: 'not-found' };
    const myUserId = this.scene?.userId || this.scene?.socket?.id || '__local__';
    const isMine = String(flyer.addedBy) === String(myUserId);
    // Only the owner's take-down returns the flyer to a pocket.
    if (isMine) this._pendingRemoval = { flyerId: flyer.id, flyer: { ...flyer } };
    try {
      this.scene.socket.emit('board_remove', { roomId: this.scene.roomId, flyerId: flyer.id });
    } catch {
      this._pendingRemoval = null;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true };
  }

  // ---- opening the board ---------------------------------------------------

  /** Open the board overlay (DOM panel, NoticeBoardPanel.jsx). */
  openBoard() {
    if (!this.enabled) return;
    try { this.scene?.onOpenNoticeBoard?.(); } catch {}
  }

  /** One click on the board itself: open it if the click lands on
   * the board and the player is standing close enough. Same
   * scene-level pointerdown pattern as the puzzle / items search —
   * the board is furniture, and per-object pointerdown proved
   * unreliable on decor. Returns { ok, opened?, reason? }. */
  boardTapAt(wx, wy) {
    if (!this.enabled || !this._board) return { ok: false, reason: 'not-available' };
    const b = this._board;
    if (wx < b.x || wx > b.x + b.w || wy < b.y || wy > b.y + b.h) {
      return { ok: false, reason: 'no-board' };
    }
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const cx = Math.max(b.x, Math.min(player.gx, b.x + b.w));
    const cy = Math.max(b.y, Math.min(player.gy, b.y + b.h));
    if (Math.hypot(player.gx - cx, player.gy - cy) > BOARD_OPEN_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    this.openBoard();
    return { ok: true, opened: true };
  }

  /** The board within BOARD_OPEN_RANGE of (x, y) — or null (E key). */
  nearestBoard(px, py) {
    if (!this.enabled || !this._board) return null;
    const b = this._board;
    const cx = Math.max(b.x, Math.min(px, b.x + b.w));
    const cy = Math.max(b.y, Math.min(py, b.y + b.h));
    return Math.hypot(px - cx, py - cy) <= BOARD_OPEN_RANGE ? { ...b } : null;
  }

  /** Resolve the board to the live room layout: the real
   * `notice_board` zone first (hand-placed in the named layouts,
   * or RoomLayout's synthetic one near the entrance), RoomLayout's
   * fallback spot second. On a floor with no board at all (e.g. an
   * upper floor), there is simply no board here — _board stays null
   * instead of pointing at another room's spot. */
  _resolveBoard() {
    this._board = null;
    if (!this.enabled) return;
    const layout = this.scene?.roomLayout;
    const zones = Array.isArray(layout?.currentZones) && layout.currentZones.length
      ? layout.currentZones
      : (Array.isArray(layout?.interactZones) ? layout.interactZones : []);
    const zone = zones.find((z) => z.type === 'notice_board' || /notice board/i.test(z.label || ''));
    if (zone) {
      this._board = {
        x: zone.x ?? 480, y: zone.y ?? 745,
        w: zone.w ?? 180, h: zone.h ?? 60,
      };
      return;
    }
    // No board zone on this floor: ask RoomLayout for its synthetic
    // spot (near the entrance / spawn, ground floor only). When it
    // says null, this floor has no board.
    const fb = this.scene?.roomLayout?.getNoticeBoardFallback?.();
    if (fb) {
      this._board = { x: fb.x, y: fb.y, w: fb.w, h: fb.h };
    }
  }

  update() {
    // Nothing per-frame: pins arrive over the socket, opens arrive
    // via pointerdown / E, and the panel polls getState().
  }

  destroy() {
    this._pendingPin = null;
    this._pendingRemoval = null;
    this._board = null;
    this.scene = null;
  }
}
