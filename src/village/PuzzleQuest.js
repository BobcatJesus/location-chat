// PuzzleQuest.js — the Agora group puzzle (Shared Puzzle Quest v1,
// `group-puzzle-v1`).
//
// A puzzle table stands in the middle of Agora, showing the half-finished
// picture (the calico cat, 3x3) and the room's progress. Click the table
// and a zoomed-in board opens (DOM overlay, PuzzleBoard.jsx) where you
// drag pieces around. The board is SHARED: pieces found and placed by
// anyone in the room count for everyone — the server keeps the canonical
// state (server/socket.js `puzzle_piece` / `puzzle_place` / `get_puzzle`,
// in-memory per room like the cat and the pumpkins).
//
// The 9 pieces hide at SET spots in Agora (never random anywhere):
//   0-2  under a table (three different tables)
//   3-4  on top of the bar / behind the bar counter
//   5    on a bookshelf
//   6    in the sunny spot by the window
//   7    under the sleeping cat — only while she naps after 3 pets
//         (links Cat Cuddles to this quest: pet her to sleep, then
//         look underneath her)
//   8    from the barista — ask the NPC about the puzzle / a missing
//        piece ("puzzle", "jigsaw", "missing piece", "lost piece")
//
// Completion: all 9 pieces placed in their home cells. Everyone who
// found at least one piece this round gets +5 coins, once per round
// (local CoinWallet, same as other quests). The finished board stays
// up for a minute, then a fresh puzzle (same picture, new round)
// starts automatically — the server resets it.
//
// Owned by VillageScene: constructed in create(), ticked in update(),
// destroyed in shutdown(), refreshed on floor switches. Agora only
// (roomId === 'agora-houston'); every other room is a no-op. The
// Golden Key (HiddenKey.js) is NOT touched by this quest.

import { DEPTH } from './depth.js';
import {
  PUZZLE_MARKER,
  PUZZLE_TOTAL,
  PUZZLE_REWARD_COINS,
  PUZZLE_SPOTS,
  createPuzzleState,
  collectPiece,
  placePiece,
  placedCount,
  serializePuzzleState,
  parsePuzzleState,
} from './puzzleState.js';

const AGORA_ROOM_ID = 'agora-houston';
const COLLECT_RANGE = 90; // px from a piece the player must be within (E key)
const TABLE_RANGE = 130; // px from the table the player must be within (E key)
const RESPAWN_CHECK_MS = 1000; // how often update() re-checks markers
const NPC_PIECE_ID = 8;
const CAT_PIECE_ID = 7;
// The "right thing" to ask the barista: any of these in your message.
const NPC_PIECE_RE = /puzzle|jigsaw|missing piece|lost piece/i;

// Per-profile paid-round guard (same profile scoping as QuestManager):
// a contributor is paid +5 exactly once per round.
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

function loadPaidRounds() {
  try {
    const raw = localStorage.getItem('sidequest-puzzle-paid');
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export class PuzzleQuest {
  constructor(scene) {
    this.scene = scene;
    // group-puzzle-v1 — marker for the landing check (Select-String).
    this.marker = PUZZLE_MARKER;
    this.state = createPuzzleState();
    this.myFound = new Set(); // piece ids *I* found this round
    this.myPlaced = new Set(); // piece ids *I* placed this round
    this.table = null; // Phaser container: the puzzle table
    this._markers = new Map(); // pieceId -> { container, tween }
    this._tablePos = null;
    this._spotPos = new Map(); // pieceId -> { x, y } (floor spots only)
    this._lastCheckMs = 0;
  }

  get enabled() {
    return this.scene?.roomId === AGORA_ROOM_ID;
  }

  _myUserId() {
    return this.scene?.userId || this.scene?.socket?.id || '__local__';
  }

  /** Room progress for the tracker: { placed, total, completed, round }. */
  getProgress() {
    if (!this.enabled) return null;
    return {
      placed: placedCount(this.state),
      total: PUZZLE_TOTAL,
      completed: Boolean(this.state.completed),
      round: this.state.round,
    };
  }

  /** Full board state for the DOM overlay (PuzzleBoard.jsx). */
  getBoardState() {
    const s = serializePuzzleState(this.state);
    return {
      ...s,
      myFound: [...this.myFound],
      myPlaced: [...this.myPlaced],
    };
  }

  /** (Re)build the table + piece markers in Agora; clear elsewhere. */
  refresh() {
    this._clearEntities();
    if (!this.enabled) return;
    this._tablePos = this._findTableSpot();
    this._drawTable();
    this._resolveSpotPositions();
    this._refreshMarkers();
    this._requestState();
  }

  _requestState() {
    try {
      if (this.scene?.socket?.connected) {
        this.scene.socket.emit('get_puzzle', { roomId: this.scene.roomId });
      }
    } catch {}
  }

  /** Apply the server's canonical state (or a local fallback). */
  applyState(payload = {}) {
    const prev = this.state;
    const next = parsePuzzleState(payload);
    const roundChanged = next.round !== prev.round;
    const justCompleted = next.completed && !prev.completed;
    if (roundChanged) {
      // New round: my finds/placements from the old round don't count.
      this.myFound.clear();
      this.myPlaced.clear();
    }
    this.state = next;
    this._refreshMarkers();
    this._drawTable();
    this._bumpHud();
    if (justCompleted) this._onPuzzleCompleted(next);
  }

  /** A player in the room (maybe me) placed the last piece. */
  _onPuzzleCompleted(state) {
    const iContributed = this.myFound.size > 0 || this.myPlaced.size > 0;
    const paid = loadPaidRounds();
    const owner = currentOwner();
    const paidRounds = Array.isArray(paid[owner]) ? paid[owner] : [];
    const toast = '🎉 The cat puzzle is complete! A new puzzle starts in a minute.';
    if (iContributed && !paidRounds.includes(state.round)) {
      // Pay once per round: record it BEFORE the async wallet call,
      // so a double broadcast can't pay twice.
      paid[owner] = [...paidRounds, state.round].slice(-10);
      try { localStorage.setItem('sidequest-puzzle-paid', JSON.stringify(paid)); } catch {}
      try {
        import('./CoinWallet.js')
          .then((m) => m.earnCoins(PUZZLE_REWARD_COINS, `puzzle-${state.round}`))
          .catch(() => {});
      } catch {}
      this.scene?.questManager?.showToast?.(
        `🎉 The cat puzzle is complete! +${PUZZLE_REWARD_COINS} coins — a new puzzle starts in a minute.`,
      );
    } else {
      this.scene?.questManager?.showToast?.(toast);
    }
  }

  _bumpHud() {
    try { this.scene?.questManager?.bumpHud?.(); } catch {}
  }

  // ---- finding pieces -------------------------------------------------

  /** Is piece `pieceId` out on the floor right now (findable)? */
  _pieceAvailable(pieceId) {
    if (!this.enabled || this.state.completed) return false;
    if (this.state.collected.includes(pieceId)) return false;
    if (pieceId === CAT_PIECE_ID) {
      // Under the sleeping cat: only while she naps after 3 pets.
      return Boolean(this.scene?.cafeCat?.asleep);
    }
    if (pieceId === NPC_PIECE_ID) return false; // earned by chatting, not on the floor
    return true;
  }

  /** Try to collect piece `pieceId` (click on its marker, or E key). */
  tryCollectPiece(pieceId) {
    const id = Number(pieceId);
    if (!Number.isInteger(id) || id < 0 || id >= PUZZLE_TOTAL) return { ok: false, reason: 'bad-piece' };
    if (!this._pieceAvailable(id)) return { ok: false, reason: 'not-available' };
    const socket = this.scene?.socket;
    if (socket?.connected) {
      // The server validates and broadcasts the new state to the room.
      try { socket.emit('puzzle_piece', { roomId: this.scene.roomId, pieceId: id }); } catch {}
      return { ok: true, pending: true };
    }
    // Offline: apply locally so the quest still works solo.
    const res = collectPiece(this.state, id, this._myUserId());
    if (!res.ok) return res;
    this.myFound.add(id);
    this._afterLocalChange(`🧩 You found a puzzle piece! (${this.state.collected.length}/${PUZZLE_TOTAL})`);
    return { ok: true };
  }

  /** The barista piece: ask the NPC about the puzzle / a missing piece. */
  tryNpcPiece(message) {
    if (!this.enabled || this.state.completed) return { ok: false, reason: 'not-available' };
    if (this.state.collected.includes(NPC_PIECE_ID)) return { ok: false, reason: 'already-found' };
    if (!NPC_PIECE_RE.test(String(message || ''))) return { ok: false, reason: 'wrong-question' };
    const socket = this.scene?.socket;
    if (socket?.connected) {
      try { socket.emit('puzzle_piece', { roomId: this.scene.roomId, pieceId: NPC_PIECE_ID }); } catch {}
      try { this.scene?.onSystemNotice?.('🧩 The barista slips you a puzzle piece…'); } catch {}
      return { ok: true, pending: true };
    }
    const res = collectPiece(this.state, NPC_PIECE_ID, this._myUserId());
    if (!res.ok) return res;
    this.myFound.add(NPC_PIECE_ID);
    this._afterLocalChange('🧩 The barista slips you a puzzle piece!');
    return { ok: true };
  }

  /** Try to place a found piece at (col, row) on the board. */
  placePiece(pieceId, col, row) {
    const id = Number(pieceId);
    // Instant feedback, before anything goes to the server: a wrong
    // cell bounces back to the tray, it is never placed wrong.
    const res = placePiece(this.state, id, col, row, this._myUserId());
    if (!res.ok) return res;
    this.myPlaced.add(id);
    const socket = this.scene?.socket;
    if (socket?.connected) {
      try { socket.emit('puzzle_place', { roomId: this.scene.roomId, pieceId: id, col, row }); } catch {}
      // Optimistic: the server re-validates and broadcasts the same
      // state back to the room; applyState reconciles it.
      this._refreshMarkers();
      this._drawTable();
      this._bumpHud();
      if (res.completed) this._onPuzzleCompleted(this.state);
    } else {
      this._afterLocalChange();
      if (res.completed) this._onPuzzleCompleted(this.state);
    }
    return { ok: true, completed: Boolean(res.completed) };
  }

  _afterLocalChange(notice) {
    this._refreshMarkers();
    this._drawTable();
    this._bumpHud();
    if (notice) {
      try { this.scene?.onSystemNotice?.(notice); } catch {}
    }
  }

  // ---- the puzzle table ------------------------------------------------

  /** Central spot for the table: room centre, nudged off any solid. */
  _findTableSpot() {
    const layout = this.scene?.roomLayout;
    let bounds = null;
    try { bounds = layout?.getBoundaryBounds?.(); } catch {}
    if (!bounds || !Number.isFinite(bounds.w) || bounds.w <= 100) {
      bounds = { x: 200, y: 200, w: 1200, h: 500 };
    }
    const candidates = [
      { x: bounds.x + bounds.w * 0.5, y: bounds.y + bounds.h * 0.42 },
      { x: bounds.x + bounds.w * 0.5 + 140, y: bounds.y + bounds.h * 0.42 },
      { x: bounds.x + bounds.w * 0.5 - 140, y: bounds.y + bounds.h * 0.42 },
      { x: bounds.x + bounds.w * 0.5, y: bounds.y + bounds.h * 0.42 + 110 },
      { x: bounds.x + bounds.w * 0.5, y: bounds.y + bounds.h * 0.42 - 110 },
    ];
    for (const c of candidates) {
      const p = layout?.clampPointToRoom ? layout.clampPointToRoom(c.x, c.y, 60) : c;
      if (layout?.collidesWithSolid && layout.collidesWithSolid(p.x, p.y, 40)) continue;
      return p;
    }
    return candidates[0];
  }

  /** The table itself: a wooden top with the mini 3x3 puzzle on it. */
  _drawTable() {
    this._clearTable();
    if (!this.enabled || !this._tablePos) return;
    const scene = this.scene;
    const { x, y } = this._tablePos;
    const g = scene.add.graphics();
    // Table top.
    g.fillStyle(0xa06a35, 1);
    g.fillRoundedRect(-85, -55, 170, 110, 12);
    g.lineStyle(2, 0x5d3a17, 1);
    g.strokeRoundedRect(-85, -55, 170, 110, 12);
    // Mini puzzle: 3x3 cells on the tabletop. Placed cells are filled
    // amber (the picture coming together); empty cells are outlined.
    const cell = 24;
    const ox = -cell * 1.5;
    const oy = -cell * 1.5;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const id = row * 3 + col;
        const cx = ox + col * cell;
        const cy = oy + row * cell;
        if (this.state.placed[id]) {
          g.fillStyle(0xfbbf24, 1);
          g.fillRect(cx + 1, cy + 1, cell - 2, cell - 2);
          g.fillStyle(0x92400e, 1);
          g.fillCircle(cx + cell / 2, cy + cell / 2, 3);
        } else {
          g.lineStyle(1.5, 0xfff7e6, 0.9);
          g.strokeRect(cx + 1, cy + 1, cell - 2, cell - 2);
        }
      }
    }
    const progress = scene.add.text(
      0, -72,
      this.state.completed
        ? '🧩 Puzzle complete!'
        : `🧩 Group Puzzle  ${placedCount(this.state)}/${PUZZLE_TOTAL}`,
      { fontSize: '17px', color: '#1a4971', backgroundColor: 'rgba(255,255,255,0.92)', padding: { x: 8, y: 4 } },
    );
    progress.setOrigin(0.5, 0.5);
    const container = scene.add.container(x, y, [g, progress]);
    container.setDepth(DEPTH.ACTOR_MIN + Math.round(y));
    container.setSize(180, 150);
    container.setInteractive({ useHandCursor: true });
    container.on('pointerdown', () => this.openBoard());
    this.table = container;
  }

  _clearTable() {
    try { this.table?.destroy(); } catch {}
    this.table = null;
  }

  /** Open the zoomed-in board (DOM overlay, PuzzleBoard.jsx). */
  openBoard() {
    if (!this.enabled) return;
    try { this.scene?.onOpenPuzzle?.(); } catch {}
  }

  /** Puzzle table within TABLE_RANGE of (x, y) — or null (E key). */
  nearestTable(px, py) {
    if (!this.table || !this._tablePos) return null;
    return Math.hypot(px - this._tablePos.x, py - this._tablePos.y) <= TABLE_RANGE
      ? { x: this._tablePos.x, y: this._tablePos.y }
      : null;
  }

  /** A findable piece marker within COLLECT_RANGE of (x, y) — or null. */
  nearestPiece(px, py) {
    if (!this.enabled || this.state.completed) return null;
    for (const [id, marker] of this._markers) {
      if (!marker?.container?.active) continue;
      const pos = this._spotPos.get(id);
      if (!pos) continue;
      if (Math.hypot(px - pos.x, py - pos.y) <= COLLECT_RANGE) return { pieceId: id, x: pos.x, y: pos.y };
    }
    return null;
  }

  // ---- piece hiding spots ----------------------------------------------

  /** Where each floor piece hides, resolved from the live room layout:
   * real furniture first (zones labelled Table / Bar / Bookshelf),
   * boundary fractions as fallback, so the spots are SET places in
   * Agora, never a random point on the open floor. */
  _resolveSpotPositions() {
    this._spotPos.clear();
    const layout = this.scene?.roomLayout;
    let bounds = null;
    try { bounds = layout?.getBoundaryBounds?.(); } catch {}
    if (!bounds || !Number.isFinite(bounds.w) || bounds.w <= 100) {
      bounds = { x: 200, y: 200, w: 1200, h: 500 };
    }
    const frac = (fx, fy) => ({ x: bounds.x + bounds.w * fx, y: bounds.y + bounds.h * fy });
    const zones = Array.isArray(layout?.interactZones) ? layout.interactZones : [];
    const zoneCenter = (z) => ({ x: z.x + (z.w || 0) / 2, y: z.y + (z.h || 0) / 2 });
    const tables = zones.filter((z) => /table/i.test(z.label || ''));
    const bars = zones.filter((z) => z.type === 'counter' || /bar|coffee/i.test(z.label || ''));
    const shelves = zones.filter((z) => z.type === 'shelf' || /shelf|book/i.test(z.label || ''));
    // Pieces 0-2: under a table (south side of the tabletop).
    const tableFallbacks = [frac(0.25, 0.35), frac(0.6, 0.3), frac(0.4, 0.62)];
    for (let i = 0; i < 3; i++) {
      const z = tables[i];
      const p = z ? zoneCenter(z) : tableFallbacks[i];
      this._spotPos.set(i, { x: p.x, y: p.y + (z ? 34 : 0) });
    }
    // Pieces 3-4: on top of the bar, and behind the bar counter.
    const barFallbacks = [frac(0.82, 0.25), frac(0.85, 0.45)];
    for (let i = 0; i < 2; i++) {
      const z = bars[i] || bars[0];
      const p = z ? zoneCenter(z) : barFallbacks[i];
      this._spotPos.set(3 + i, i === 0 ? p : { x: p.x, y: p.y + 34 });
    }
    // Piece 5: on a bookshelf.
    const shelf = shelves[0];
    this._spotPos.set(5, shelf ? zoneCenter(shelf) : frac(0.15, 0.2));
    // Piece 6: in the sunny spot (the cat's sunbeam spot, or a window corner).
    const sunbeam = this.scene?.cafeCat?.sunbeamSpot;
    this._spotPos.set(6, sunbeam ? { x: sunbeam.x, y: sunbeam.y } : frac(0.72, 0.68));
    // Piece 7 (sleeping cat) is dynamic — resolved live in _refreshMarkers.
    // Piece 8 (NPC) has no floor spot.
    for (const [id, p] of [...this._spotPos]) {
      const clamped = layout?.clampPointToRoom ? layout.clampPointToRoom(p.x, p.y, 24) : p;
      this._spotPos.set(id, clamped);
    }
  }

  /** (Re)draw the floor markers for every findable piece. */
  _refreshMarkers() {
    for (const [id, marker] of [...this._markers]) {
      try { marker.tween?.stop(); } catch {}
      try { marker.container?.destroy(); } catch {}
      this._markers.delete(id);
    }
    if (!this.enabled || this.state.completed) return;
    const scene = this.scene;
    for (let id = 0; id < PUZZLE_TOTAL; id++) {
      if (id === NPC_PIECE_ID) continue; // earned by chatting
      if (!this._pieceAvailable(id)) continue;
      let pos = this._spotPos.get(id);
      if (id === CAT_PIECE_ID) {
        // Under the sleeping cat — right where she naps.
        const cat = scene?.cafeCat?.cat;
        if (!cat) continue;
        pos = { x: cat.x, y: cat.y + 16 };
      }
      if (!pos) continue;
      const glow = scene.add.circle(pos.x, pos.y, 20, 0xfbbf24, 0.3);
      glow.setDepth(DEPTH.ACTOR_MIN + Math.round(pos.y));
      const piece = scene.add.text(pos.x, pos.y, '🧩', { fontSize: '24px' });
      piece.setOrigin(0.5, 0.5);
      piece.setDepth(DEPTH.ACTOR_MIN + Math.round(pos.y) + 1);
      const container = scene.add.container(pos.x, pos.y, [glow, piece]);
      // Children are positioned relative to the container; re-center them.
      glow.setPosition(0, 0);
      piece.setPosition(0, 0);
      container.setDepth(DEPTH.ACTOR_MIN + Math.round(pos.y));
      container.setSize(44, 44);
      container.setInteractive({ useHandCursor: true });
      const tween = scene.tweens.add({
        targets: [glow, piece], scale: 1.15, duration: 650,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      container.on('pointerdown', () => this.tryCollectPiece(id));
      this._markers.set(id, { container, tween });
    }
  }

  update() {
    if (!this.enabled) return;
    const now = Date.now();
    if (now - (this._lastCheckMs || 0) < RESPAWN_CHECK_MS) return;
    this._lastCheckMs = now;
    // The sleeping-cat piece appears/disappears with her nap; the
    // table re-spawns if a floor switch cleared it.
    if (!this.table) this._drawTable();
    this._refreshMarkers();
  }

  _clearEntities() {
    this._clearTable();
    for (const [, marker] of [...this._markers]) {
      try { marker.tween?.stop(); } catch {}
      try { marker.container?.destroy(); } catch {}
    }
    this._markers.clear();
  }

  destroy() {
    this._clearEntities();
    this._spotPos.clear();
    this.scene = null;
  }
}
