// NoteSystem.js — the in-room side of Pick-Up Notes v1
// (`sq-pickup-notes-v1`).
//
// Owned by VillageScene, same shape as NoticeBoardSystem /
// FloorLitterSystem: constructed in create(), refreshed on floor
// switches, destroyed in shutdown(). One job: notes left on the
// floor are visible to EVERYONE in the room and anyone can pick
// one up and read it, repeatedly — a note never disappears after
// one read. State is SERVER state (server/socket.js, in-memory
// per room like the notice board, persisted to Postgres): drops
// and removals go through the socket and every player in the room
// sees the same floor.
//
// WRITING (from the pocket — InventoryPanel's "Write a note"):
// the player types up to 280 characters and leaves it where they
// are standing. Pick-Up Notes v1.1 (`sq-pickup-notes-v1.1`): a
// note costs one sheet of note paper (2 coins for a pack of 3 at
// the Agora bar) — the sheet is spent only when the server
// confirms the drop landed, never on a refusal or a timeout. A
// note is a world object, not an inventory item: the paper is the
// only thing that ever leaves the pocket. The note leaves nothing
// else behind; the client generates the note id and keeps a
// pending drop, settled when the notes_state broadcast shows
// that id (or the note_drop_result answers ok). If the drop never
// lands (offline, rate-limited), nothing is lost — no sheet is
// spent and the note was never an item.
//
// READING (tap the 📝 on the floor, or E near it): anyone's note
// is readable, as many times as anyone likes. The read popup
// (NotePanel.jsx) shows only the text and how long until it fades
// — ANONYMOUS, no author is ever shown. The Delete button appears
// only when the reader wrote the note or is a moderator; the
// server re-validates either way.
//
// EXPIRY: a note fades away 48 hours after it is left, even
// across restarts (the server prunes on load and on every touch).
// The client also filters expired notes on render and on its 1s
// tick, so a note whose time is up vanishes from the floor without
// waiting for the next broadcast.
//
// ANONYMITY, HOW THE WRITER IS KNOWN: the wire state carries no
// authorId and no authorName, so the client cannot tell who wrote
// a note from the broadcast. The writer knows their own notes
// because the client remembers the ids it dropped (_myNoteIds,
// localStorage-backed per profile). A guest's client-side id is
// 'guest' (shared by every guest on this browser), so a guest may
// see a Delete button on another guest's note — but the server
// stores the author's socket id and refuses the delete, so
// nothing is ever actually removed by the wrong person.
//
// A restart wipes nothing: notes persist to Postgres (notePersist).

import { DEPTH } from './depth.js';
import {
  NOTE_MARKER,
  NOTE_TEXT_MAX,
  createNoteState,
  parseNoteState,
  noteExpiresAt,
} from './noteState.js';
import {
  LITTER_PICKUP_RANGE,
  LITTER_CLICK_RANGE,
  // Pick-Up Notes v1.1 (`sq-pickup-notes-v1.1`): leaving a note
  // costs one sheet of note paper (2 coins for 3 sheets at the
  // Agora bar). The sheet is spent only on the server's confirm
  // of the drop — never on a refusal or a timeout — the same
  // rule as wrapping paper on a mail send.
  hasNotePaper,
  spendNotePaperSheet,
} from './items.js';

// Pick-Up Notes v1 (`sq-pickup-notes-v1`): how long a pending
// drop waits for the server's answer before giving up with a
// retry notice instead of waiting forever. Same 5s as the floor
// litter pending timeout — far above a healthy round trip and far
// below "stuck forever".
export const NOTE_PENDING_TIMEOUT_MS = 5000;

// How close you must stand to read a note (E key) or tap it.
const NOTE_READ_RANGE = LITTER_PICKUP_RANGE;
const NOTE_CLICK_RANGE = LITTER_CLICK_RANGE;

// localStorage key for the ids of notes this profile wrote — the
// only way the client knows which Delete buttons are theirs (the
// wire state is anonymous). Scoped by the scene's userId, like the
// inventory's per-profile keys.
const MY_NOTE_IDS_PREFIX = 'sidequest-my-note-ids';

export class NoteSystem {
  constructor(scene) {
    this.scene = scene;
    // sq-pickup-notes-v1 — marker for the v1 landing check.
    this.marker = NOTE_MARKER;
    this.state = createNoteState();
    this._textObjs = new Map(); // note id -> Phaser text object
    // Server-time offset (ms): the notes_state broadcast carries
    // the server's `now`, so expiry is judged against server
    // time, not the client's clock alone.
    this._serverNowOffset = 0;
    this._pendingDrop = null; // { id, text } awaiting the notes_state that confirms it
    this._unconfirmedDrop = null; // { id, text } — timed out, rechecked on the next broadcast
    this._dropTimer = null;
    this._pendingRemoval = null; // { noteId } awaiting the broadcast that confirms it
    this._myNoteIds = this._loadMyNoteIds();
    this._pendingTimeoutMs = null; // test seam: tests set this to a few ms
    this._lastCheckMs = 0;
  }

  // Pick-up notes work in every room — a note is a world object,
  // and even your own home room is a room someone (you) walks in.
  get enabled() {
    return Boolean(this.scene?.roomId);
  }

  _myUserId() {
    return this.scene?.userId || this.scene?.socket?.id || '__local__';
  }

  _myNoteIdsKey() {
    return `${MY_NOTE_IDS_PREFIX}:${String(this._myUserId() || 'guest').toLowerCase()}`;
  }

  _loadMyNoteIds() {
    try {
      const raw = window?.localStorage?.getItem(this._myNoteIdsKey());
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch {
      return new Set();
    }
  }

  _saveMyNoteIds() {
    try {
      window?.localStorage?.setItem(this._myNoteIdsKey(), JSON.stringify([...this._myNoteIds]));
    } catch {}
  }

  /** Plain-data state for the read panel (polls this ~2x/sec).
   * `mine` is per-note, computed client-side from the ids this
   * profile dropped — the wire state is anonymous, so the server
   * never tells us. `now` is server-synced, for the fade countdown. */
  getState() {
    return {
      notes: (this.state.notes || []).map((n) => ({
        ...n,
        mine: this._myNoteIds.has(String(n.id)),
      })),
      count: (this.state.notes || []).length,
      myUserId: this._myUserId(),
      roomId: this.scene?.roomId || '',
      now: this._now(),
    };
  }

  /** (Re)build the notes for this room; clear elsewhere. */
  refresh() {
    this._clearEntities();
    if (!this.enabled) return;
    this._drawAll();
    this._requestState();
  }

  _requestState() {
    try {
      if (this.scene?.socket?.connected) {
        this.scene.socket.emit('get_notes', { roomId: this.scene.roomId });
      }
    } catch {}
  }

  _timeoutMs() {
    const override = Number(this._pendingTimeoutMs);
    return Number.isFinite(override) && override > 0 ? override : NOTE_PENDING_TIMEOUT_MS;
  }

  _clearDropTimer() {
    if (this._dropTimer) { clearTimeout(this._dropTimer); this._dropTimer = null; }
  }

  /** Server time (ms), via the offset the last notes_state
   * broadcast carried. Expiry is judged against this, never the
   * client's clock alone. */
  _now() {
    return Date.now() + (Number(this._serverNowOffset) || 0);
  }

  _setNoteNotice(text) {
    try { this.scene?.onSystemNotice?.(String(text || '')); } catch {}
  }

  /** Apply the server's canonical state. Also settles the pending
   * / timed-out drop: a drop is confirmed when the broadcast
   * shows our id (the note is then ours to delete). */
  applyState(payload = {}) {
    if (Number.isFinite(Number(payload.now))) {
      this._serverNowOffset = Number(payload.now) - Date.now();
    }
    const next = parseNoteState(payload, this._now());
    this.state = next;
    if (this._pendingDrop) {
      const confirmed = next.notes.some((n) => n.id === this._pendingDrop.id);
      if (confirmed) this._settleDrop(this._pendingDrop.id);
    }
    if (this._unconfirmedDrop) {
      const target = this._unconfirmedDrop;
      const landed = next.notes.some((n) => n.id === target.id);
      this._unconfirmedDrop = null;
      if (landed) this._settleDropTarget(target);
    }
    this._drawAll();
  }

  /** The drop with this id landed on the server: it is now one of
   * my notes (the Delete button is mine). Idempotent — a second
   * settle for the same id is a no-op because the pending entry
   * is already gone. */
  _settleDrop(id) {
    const target = (this._pendingDrop?.id === id ? this._pendingDrop : null)
      || (this._unconfirmedDrop?.id === id ? this._unconfirmedDrop : null);
    return this._settleDropTarget(target);
  }

  _settleDropTarget(target) {
    if (!target) return false;
    if (this._pendingDrop?.id === target.id) {
      this._pendingDrop = null;
      this._clearDropTimer();
    }
    if (this._unconfirmedDrop?.id === target.id) this._unconfirmedDrop = null;
    this._myNoteIds.add(String(target.id));
    this._saveMyNoteIds();
    // Pick-Up Notes v1.1 (`sq-pickup-notes-v1.1`): the sheet is
    // spent HERE, on the server's confirm, and only here — this
    // is the single settle point for both confirm paths (the
    // direct answer and the broadcast recheck), so a landed note
    // costs exactly one sheet, and a refused or timed-out drop
    // costs nothing. A failed spend (paper vanished in another
    // tab) never blocks the settle: the note already landed
    // server-side.
    try { spendNotePaperSheet(); } catch {}
    this._setNoteNotice('📝 Note left — anyone here can read it. It fades away in 48 hours.');
    return true;
  }

  // ---- writing -------------------------------------------------------------

  /** Leave a note on the floor where you are standing. Pick-Up
   * Notes v1.1 (`sq-pickup-notes-v1.1`): a note costs one sheet
   * of note paper — the gate is checked here, before anything is
   * emitted, and the sheet itself is spent only on the server's
   * confirm (see _settleDropTarget). A second drop while one is
   * still pending is refused, so one landed note can never cost
   * less than one sheet. Returns { ok, pending?, reason? }. */
  dropNote(text) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const clean = String(text || '').trim().slice(0, NOTE_TEXT_MAX);
    if (!clean) return { ok: false, reason: 'empty-note' };
    // sq-pickup-notes-v1.1 — the paper gate: no sheet, no note.
    if (!hasNotePaper()) return { ok: false, reason: 'no-note-paper' };
    if (this._pendingDrop) return { ok: false, reason: 'already-pending' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    if (this.scene?.isRoomJoined?.() === false) return { ok: false, reason: 'not-joined' };
    const player = this.scene?.player;
    const raw = { x: player?.gx ?? 800, y: player?.gy ?? 450 };
    let pos = raw;
    try {
      if (this.scene?.roomLayout?.clampPointToRoom) {
        pos = this.scene.roomLayout.clampPointToRoom(raw.x, raw.y, 24) || raw;
      }
    } catch {}
    const id = `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    this._clearDropTimer();
    this._pendingDrop = { id, text: clean };
    this._dropTimer = setTimeout(() => this._onDropTimeout(), this._timeoutMs());
    try {
      this.scene.socket.emit('note_drop', {
        roomId: this.scene.roomId, id, text: clean, x: pos.x, y: pos.y,
      });
    } catch {
      this._clearDropTimer();
      this._pendingDrop = null;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true, id };
  }

  /** The server answered a drop: ok → the note is mine now (or it
   * already is, via the broadcast — settling is idempotent);
   * fail → it never landed, with the reason. */
  onDropResult(payload = {}) {
    const id = String(payload.id || '');
    if (!id || !this._pendingDrop || this._pendingDrop.id !== id) return;
    this._clearDropTimer();
    if (!payload.ok) {
      this._pendingDrop = null;
      this._setNoteNotice(this._dropReasonText(payload.reason));
      return;
    }
    this._settleDrop(id);
  }

  _dropReasonText(reason) {
    switch (reason) {
      case 'empty-note': return '📝 A note needs some words first.';
      case 'duplicate': return '📝 That note already landed — try again.';
      case 'rate-limited': return '📝 You’re leaving notes too fast — try again in a bit.';
      // Pick-Up Notes v1.1 (`sq-pickup-notes-v1.1`): the paper
      // gate is client-side (dropNote), but the server could
      // answer with the same reason — same words either way.
      case 'no-note-paper': return '📝 You need note paper to leave a note — buy some at the Agora bar.';
      case 'already-pending': return '📝 That note is still being left — give it a second.';
      default: return '📝 The room didn’t take that — try again.';
    }
  }

  /** A pending drop got no answer in time. Nothing is lost — the
   * note was never an item. The attempt moves to
   * _unconfirmedDrop so the next notes_state can still settle it
   * (the drop may have landed and only its answer was lost), and
   * state is re-requested right away so that recheck happens
   * promptly. */
  _onDropTimeout() {
    this._dropTimer = null;
    const pending = this._pendingDrop;
    if (!pending) return;
    this._pendingDrop = null;
    this._unconfirmedDrop = { ...pending };
    this._requestState();
    this._setNoteNotice('📝 The room didn’t answer — check whether your note landed.');
  }

  // ---- removing ------------------------------------------------------------

  /** Take a note down — yours, or any note if you are a
   * moderator. The server re-validates ownership / moderator
   * status, so a bad client cannot remove what is not theirs. */
  deleteNote(noteId) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const note = (this.state.notes || []).find((n) => n.id === String(noteId));
    if (!note) return { ok: false, reason: 'not-found' };
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    if (this.scene?.isRoomJoined?.() === false) return { ok: false, reason: 'not-joined' };
    this._pendingRemoval = { noteId: note.id };
    try {
      this.scene.socket.emit('note_delete', { roomId: this.scene.roomId, noteId: note.id });
    } catch {
      this._pendingRemoval = null;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, pending: true };
  }

  /** The server answered a removal: ok is confirmed by the
   * broadcast (the note is gone from the floor); fail says why —
   * e.g. someone else already took it down, or you are not its
   * writer (a stale Delete button, e.g. a guest whose socket
   * changed since they wrote it). */
  onDeleteResult(payload = {}) {
    const noteId = String(payload.noteId || '');
    if (!noteId || !this._pendingRemoval || this._pendingRemoval.noteId !== noteId) return;
    this._pendingRemoval = null;
    if (payload.ok) return; // the broadcast confirms the removal
    this._setNoteNotice(payload.reason === 'not-allowed'
      ? '📝 You can only take down your own notes.'
      : '📝 That note is already gone.');
  }

  // ---- reading -------------------------------------------------------------

  /** Open the read popup for one note (DOM panel, NotePanel.jsx). */
  openNote(noteId) {
    if (!this.enabled) return;
    const note = (this.state.notes || []).find((n) => n.id === String(noteId));
    if (!note) return;
    try { this.scene?.onOpenNote?.(note.id); } catch {}
  }

  /** One click at world (wx, wy): on a note, open it (if standing
   * close enough). Silent unless it acts — clicks elsewhere do
   * nothing. Returns { ok, opened?, reason? }. */
  noteTapAt(wx, wy) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const note = (this.state.notes || []).find(
      (n) => Math.hypot(wx - n.x, wy - n.y) <= NOTE_CLICK_RANGE,
    );
    if (!note) return { ok: false, reason: 'no-note' };
    if (Math.hypot(player.gx - note.x, player.gy - note.y) > NOTE_READ_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    this.openNote(note.id);
    return { ok: true, opened: true };
  }

  /** The note within read range of (px, py) — or null (E key). */
  nearestNote(px, py) {
    if (!this.enabled) return null;
    let best = null;
    let bestD = NOTE_READ_RANGE;
    for (const note of this.state.notes || []) {
      const d = Math.hypot(px - note.x, py - note.y);
      if (d < bestD) { bestD = d; best = note; }
    }
    return best ? { ...best } : null;
  }

  /** E key / mobile button: read the nearest note. */
  readNearest() {
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const near = this.nearestNote(player.gx, player.gy);
    if (!near) return { ok: false, reason: 'no-note' };
    this.openNote(near.id);
    return { ok: true, opened: true };
  }

  // ---- drawing -------------------------------------------------------------

  _drawAll() {
    this._clearEntities();
    if (!this.enabled) return;
    for (const note of this.state.notes || []) {
      this._drawEntry(note);
    }
  }

  _drawEntry(note) {
    const scene = this.scene;
    let textObj = null;
    try {
      textObj = scene.add.text(note.x, note.y, '📝', { fontSize: '22px' });
      textObj.setOrigin(0.5, 0.5);
      textObj.setDepth(DEPTH.ACTOR_MIN + Math.round(note.y));
    } catch {}
    if (textObj) this._textObjs.set(note.id, textObj);
  }

  update() {
    if (!this.enabled) return;
    const now = Date.now();
    if (now - (this._lastCheckMs || 0) < 1000) return;
    this._lastCheckMs = now;
    // The notes re-spawn if a floor switch cleared them.
    if ((this.state.notes || []).length > 0 && this._textObjs.size === 0) {
      this._drawAll();
    }
    // Expired notes fade from the floor without waiting for the
    // next broadcast — the server prunes for real on its next
    // touch, but the client never shows a dead note.
    const before = (this.state.notes || []).length;
    const t = this._now();
    const alive = (this.state.notes || []).filter((n) => noteExpiresAt(n) > t);
    if (alive.length !== before) {
      this.state = { ...this.state, notes: alive };
      this._drawAll();
    }
  }

  _clearEntities() {
    for (const textObj of this._textObjs.values()) {
      try { textObj?.destroy(); } catch {}
    }
    this._textObjs.clear();
  }

  destroy() {
    this._clearEntities();
    this._clearDropTimer();
    this._pendingDrop = null;
    this._unconfirmedDrop = null;
    this._pendingRemoval = null;
    this.scene = null;
  }
}
