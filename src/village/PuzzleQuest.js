// PuzzleQuest.js — the Agora group puzzle (Shared Puzzle Quest v1.2,
// `group-puzzle-v1-2-hidden-search`).
//
// A puzzle table stands in the middle of Agora, showing the half-finished
// picture (the calico cat, 3x3) and the room's progress. Click the table
// and a zoomed-in board opens (DOM overlay, PuzzleBoard.jsx) where you
// drag pieces around. The board is SHARED: pieces found and placed by
// anyone in the room count for everyone — the server keeps the canonical
// state (server/socket.js `puzzle_piece` / `puzzle_place` / `get_puzzle`,
// in-memory per room like the cat and the pumpkins).
//
// v1.2: the pieces are FUNCTIONALLY INVISIBLE. There are no markers,
// no glow, nothing on the floor to spot. A piece is found only by
// clicking a few times (PUZZLE_SEARCH_CLICKS = 3) on the furniture
// hiding it — a few random clicks on a table, and one might turn up.
// Clicks on furniture with no piece do nothing visible, and no hint
// says which furniture hides a piece or how many clicks are left.
// It is meant to be difficult, so one player cannot sweep all 9 and
// more than one person has to contribute. Pieces are INVENTORY ITEMS
// (Items + Inventory v1, `sq-items-inventory-v1`): a found piece
// occupies one pocket slot (3, or 10 with a bag) until it is placed
// on this board, which frees the slot. A full pocket refuses the
// pickup — "Your pocket is full — place a piece on the puzzle board
// first" — and the piece stays unfound until there is room.
// furniture spots in Agora (never the open floor):
//   0-2  under a cafe table (three of the four tables; the fourth
//        table is a decoy — clicking it finds nothing)
//   3    behind the coffee bar counter
//   4    in a couch
//   5    in the trash can (by the coffee bar — furniture pass v1)
//   6    behind a plant
//   7    under the sleeping cat — only while she naps after 3 pets
//         (links Cat Cuddles to this quest: pet her to sleep, then
//         click her a few times while she naps)
//   8    in a coffee — each coffee you buy from the barista has a
//        1-in-3 chance of containing it (the coffee still costs
//        2 coins; the piece is the reward, never coins). This
//        replaces the old v1 "ask the barista" piece.
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
  PUZZLE_MARKER_V12,
  PUZZLE_TOTAL,
  PUZZLE_REWARD_COINS,
  PUZZLE_SEARCH_CLICKS,
  createPuzzleState,
  collectPiece,
  placePiece,
  pieceHome,
  placedCount,
  rollCoffeePiece,
  serializePuzzleState,
  parsePuzzleState,
} from './puzzleState.js';
// Items + Inventory v1 (`sq-items-inventory-v1`): puzzle pieces are
// inventory items — a found piece occupies one pocket slot until it
// is placed on the board, which frees the slot again. A full pocket
// refuses the pickup (reason 'inventory-full'); the piece stays
// unfound and the search taps stay counted, so one more click after
// making room picks it up.
import {
  canAddItem,
  addPuzzlePiece,
  removePuzzlePiece,
  carriedPuzzlePieces,
  clearPuzzlePieces,
} from './items.js';

const AGORA_ROOM_ID = 'agora-houston';
const TABLE_RANGE = 130; // px from the table the player must be within (E key)
const SEARCH_RANGE = 140; // px from hiding furniture the player must be within to search it
const RESPAWN_CHECK_MS = 1000; // how often update() re-checks the table
const COFFEE_PIECE_ID = 8;
const CAT_PIECE_ID = 7;

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
    // group-puzzle-v1-2-hidden-search — marker for the v1.2 landing check.
    this.marker = PUZZLE_MARKER_V12;
    this.state = createPuzzleState();
    this.myFound = new Set(); // piece ids *I* found this round
    this.myPlaced = new Set(); // piece ids *I* placed this round
    this.table = null; // Phaser container: the puzzle table
    this._tablePos = null;
    this._spotPos = new Map(); // pieceId -> { x, y } anchor of its hiding furniture
    this._spotHit = new Map(); // pieceId -> { kind: 'circle'|'rect', ... } click shape
    this._searchTaps = new Map(); // pieceId -> how many times *I* clicked its hiding spot this round
    this._pendingFind = new Set(); // pieceIds I claimed via the server, awaiting the broadcast that confirms them
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
      // Pieces I am carrying in my pocket right now — placing one
      // frees its slot (see placePiece). The tray below is still the
      // SHARED tray: anyone in the room can place a found piece.
      carriedPieces: carriedPuzzlePieces(),
    };
  }

  /** (Re)build the table in Agora; clear elsewhere. v1.2 draws NO
   * piece markers at all — the pieces are functionally invisible. */
  refresh() {
    this._clearEntities();
    if (!this.enabled) return;
    this._tablePos = this._findTableSpot();
    this._drawTable();
    this._resolveSpotPositions();
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
    // A find I claimed via the server is confirmed when the broadcast
    // shows it collected: credit it to me (so the +5 completion pay
    // and the "you found" toast work for online finds, not just
    // offline ones) and toast it. A claim the server rejected never
    // appears here, so a stale pending id can never false-confirm
    // later in the same round — the piece is already collected.
    const newlyCollected = (next.collected || []).filter((id) => !(prev.collected || []).includes(id));
    for (const id of newlyCollected) {
      if (this._pendingFind.has(id)) {
        this._pendingFind.delete(id);
        this.myFound.add(id);
        this._searchTaps.delete(id);
        // The piece goes into my pocket (one slot) — confirmed by
        // the server, so this is the moment it is really mine. If my
        // pocket filled in the split second since I claimed it, the
        // piece stays on the shared board tray instead: placeable
        // from the board, just not carried by me.
        const pocket = addPuzzlePiece(id);
        if (!pocket.ok) {
          try {
            this.scene?.onSystemNotice?.(
              '🧩 You found a puzzle piece, but your pocket is full — it’s on the shared board tray; place it from the board.',
            );
          } catch {}
        }
        try {
          this.scene?.onSystemNotice?.(
            `🧩 You found a puzzle piece! (${next.collected.length}/${PUZZLE_TOTAL})`,
          );
        } catch {}
      }
    }
    // A claim the server rejected (someone else found it first) never
    // appears in newlyCollected — but it DOES appear in the room's
    // collected list, so drop it from pending instead of crediting it
    // (or carrying it) later.
    for (const id of [...this._pendingFind]) {
      if ((next.collected || []).includes(id)) this._pendingFind.delete(id);
    }
    if (roundChanged) {
      // New round: my finds/placements/taps from the old round don't count.
      this.myFound.clear();
      this.myPlaced.clear();
      this._searchTaps.clear();
      this._pendingFind.clear();
      // Carried pieces belong to the old round — free those slots.
      try { clearPuzzlePieces(); } catch {}
    }
    this.state = next;
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

  // ---- finding pieces (v1.2: hidden search) -------------------------

  /** Is piece `pieceId` findable right now (not yet found, round open)? */
  _pieceAvailable(pieceId) {
    if (!this.enabled || this.state.completed) return false;
    if (this.state.collected.includes(pieceId)) return false;
    if (pieceId === CAT_PIECE_ID) {
      // Under the sleeping cat: only while she naps after 3 pets.
      return Boolean(this.scene?.cafeCat?.asleep);
    }
    // The coffee piece (id 8) is available the same way — it is
    // just claimed through the coffee roll (tryCoffeePiece), not
    // through a furniture search, because it has no floor spot.
    return true;
  }

  /** Try to collect piece `pieceId`. Called only after the v1.2
   * search rules have been satisfied (enough clicks on its hiding
   * furniture, a lucky coffee, or the sleeping cat). INVENTORY GATE:
   * the piece occupies one pocket slot, so a full pocket refuses the
   * pickup BEFORE anything is claimed — the piece stays unfound and
   * the caller keeps the search taps counted, so one more click
   * after making room picks it up. */
  tryCollectPiece(pieceId) {
    const id = Number(pieceId);
    if (!Number.isInteger(id) || id < 0 || id >= PUZZLE_TOTAL) return { ok: false, reason: 'bad-piece' };
    if (!this._pieceAvailable(id)) return { ok: false, reason: 'not-available' };
    if (!canAddItem({ type: 'puzzle-piece', pieceId: id })) {
      return { ok: false, reason: 'inventory-full' };
    }
    const socket = this.scene?.socket;
    if (socket?.connected) {
      // The server validates and broadcasts the new state to the room.
      // applyState confirms it (toast + credit + pocket) when the
      // broadcast shows the piece collected.
      this._pendingFind.add(id);
      try { socket.emit('puzzle_piece', { roomId: this.scene.roomId, pieceId: id }); } catch {}
      return { ok: true, pending: true };
    }
    // Offline: apply locally so the quest still works solo.
    const res = collectPiece(this.state, id, this._myUserId());
    if (!res.ok) return res;
    this.myFound.add(id);
    addPuzzlePiece(id);
    this._afterLocalChange(`🧩 You found a puzzle piece! (${this.state.collected.length}/${PUZZLE_TOTAL})`);
    return { ok: true };
  }

  /** The coffee piece: a coffee you just bought has a 1-in-3 chance
   * of containing piece 8. The coffee itself still costs 2 coins —
   * the piece is the reward, never coins. If the piece is already
   * found this round, a coffee just has no piece. `random` is
   * injectable so the roll is testable. */
  tryCoffeePiece(random = Math.random) {
    if (!this.enabled || this.state.completed) return { ok: false, reason: 'not-available' };
    if (this.state.collected.includes(COFFEE_PIECE_ID)) return { ok: false, reason: 'already-found' };
    if (!rollCoffeePiece(random)) return { ok: false, reason: 'no-piece-in-coffee' };
    return this.tryCollectPiece(COFFEE_PIECE_ID);
  }

  /** One search tap: the player clicked at world (wx, wy). If the
   * click lands on furniture hiding an unfound piece AND the player
   * is standing close enough to search it, count the tap. After
   * PUZZLE_SEARCH_CLICKS taps on the same hiding spot, the piece
   * comes out. Anything else — wrong furniture, too far away, an
   * already-found piece — does nothing visible: no counter, no
   * shake, no hint about which furniture hides a piece. Returns
   * { ok, tapped?, found? } for the caller; the scene does not
   * need to show anything for a plain tap. */
  searchTapAt(wx, wy) {
    if (!this.enabled || this.state.completed) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const hit = this._spotHitAt(wx, wy);
    if (!hit) return { ok: false, reason: 'no-spot' };
    const id = hit.pieceId;
    if (!this._pieceAvailable(id)) return { ok: false, reason: 'not-available' };
    // You have to be standing by the furniture to search it — no
    // clicking tables from across the room. For wide furniture
    // (the bar counter) the distance is to the furniture itself,
    // not to its centre, or the far end of the bar would be
    // unreachable.
    if (this._distanceToSpot(player, id) > SEARCH_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    const taps = (this._searchTaps.get(id) || 0) + 1;
    if (taps < PUZZLE_SEARCH_CLICKS) {
      this._searchTaps.set(id, taps);
      return { ok: true, tapped: true, remaining: PUZZLE_SEARCH_CLICKS - taps };
    }
    const res = this.tryCollectPiece(id);
    if (!res.ok && res.reason === 'inventory-full') {
      // Full pocket: keep the taps counted, so one more click after
      // making room picks the piece up instead of starting over.
      this._searchTaps.set(id, PUZZLE_SEARCH_CLICKS);
      return { ...res, found: false };
    }
    this._searchTaps.delete(id);
    return { ...res, found: res.ok };
  }

  /** E-key / mobile path for the sleeping cat: one search tap under
   * her while she naps (same 3-click rule as the furniture). Returns
   * the tap result; the caller shows the "she's asleep" notice only
   * when her piece is already found. */
  searchTapCat() {
    if (!this.enabled || this.state.completed) return { ok: false, reason: 'not-available' };
    if (this.state.collected.includes(CAT_PIECE_ID)) return { ok: false, reason: 'already-found' };
    if (!this.scene?.cafeCat?.asleep) return { ok: false, reason: 'not-asleep' };
    const taps = (this._searchTaps.get(CAT_PIECE_ID) || 0) + 1;
    if (taps < PUZZLE_SEARCH_CLICKS) {
      this._searchTaps.set(CAT_PIECE_ID, taps);
      return { ok: true, tapped: true, remaining: PUZZLE_SEARCH_CLICKS - taps };
    }
    const res = this.tryCollectPiece(CAT_PIECE_ID);
    if (!res.ok && res.reason === 'inventory-full') {
      this._searchTaps.set(CAT_PIECE_ID, PUZZLE_SEARCH_CLICKS);
      return { ...res, found: false };
    }
    this._searchTaps.delete(CAT_PIECE_ID);
    return { ...res, found: res.ok };
  }

  /** Which hiding spot (if any) does world point (wx, wy) fall on?
   * The cat's spot is live — she wanders, so it is resolved from
   * her current position, not from a stored anchor. */
  _spotHitAt(wx, wy) {
    if (this.scene?.cafeCat?.asleep) {
      const cat = this.scene.cafeCat.cat;
      if (cat && Math.hypot(wx - cat.x, wy - cat.y) <= 60) {
        return { pieceId: CAT_PIECE_ID };
      }
    }
    for (const [id, hit] of this._spotHit) {
      if (id === CAT_PIECE_ID || id === COFFEE_PIECE_ID) continue;
      if (hit.kind === 'circle') {
        if (Math.hypot(wx - hit.x, wy - hit.y) <= hit.r) return { pieceId: id };
      } else if (hit.kind === 'rect') {
        if (wx >= hit.x && wx <= hit.x + hit.w && wy >= hit.y && wy <= hit.y + hit.h) {
          return { pieceId: id };
        }
      }
    }
    return null;
  }

  /** Distance from the player to a hiding spot's furniture — to the
   * nearest point of a wide rect (bar, couch), to the centre of a
   * circle spot (table, trash, plant), or to the cat herself. */
  _distanceToSpot(player, pieceId) {
    const hit = this._spotHit.get(pieceId);
    if (hit?.kind === 'rect') {
      const cx = Math.max(hit.x, Math.min(player.gx, hit.x + hit.w));
      const cy = Math.max(hit.y, Math.min(player.gy, hit.y + hit.h));
      return Math.hypot(player.gx - cx, player.gy - cy);
    }
    const anchor = this._spotAnchor(pieceId);
    if (!anchor) return Infinity;
    return Math.hypot(player.gx - anchor.x, player.gy - anchor.y);
  }

  /** Anchor point of a hiding spot (its centre), for the "standing
   * close enough to search" check. The cat's anchor is live. */
  _spotAnchor(pieceId) {
    if (pieceId === CAT_PIECE_ID) {
      const cat = this.scene?.cafeCat?.cat;
      return cat ? { x: cat.x, y: cat.y } : null;
    }
    return this._spotPos.get(pieceId) || null;
  }

  /** Try to place a found piece at (col, row) on the board. */
  placePiece(pieceId, col, row) {
    const id = Number(pieceId);
    // v1.1 FREE PLACEMENT: instant feedback, before anything goes to
    // the server — any cell accepts the piece and it stays there,
    // wrong or right, and it can be moved again later.
    const res = placePiece(this.state, id, col, row, this._myUserId());
    if (!res.ok) return res;
    this.myPlaced.add(id);
    // Placing the piece frees its pocket slot (if I was carrying it —
    // placing someone else's piece from the shared tray is a no-op
    // here, exactly as the shared board worked before).
    try { removePuzzlePiece(id); } catch {}
    const socket = this.scene?.socket;
    if (socket?.connected) {
      try { socket.emit('puzzle_place', { roomId: this.scene.roomId, pieceId: id, col, row }); } catch {}
      // Optimistic: the server re-validates and broadcasts the same
      // state back to the room; applyState reconciles it.
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

  /** The table itself (v1.1): an ordinary Agora cafe table — the
   * exact look the room's other tables use (RoomLayout 'cafe_table':
   * dark-brown circle, fill 0x4a3728, r=30, stroke 0x2b2b33), with
   * only a SMALL 3x3 puzzle thumbnail on top (9px cells, 27px
   * across — v1's table was 170x110 with a 72px puzzle). The big
   * enlarged board only appears when you click the table. Only
   * CORRECTLY placed cells fill amber on the thumbnail; a wrongly
   * placed piece stays outlined, like an empty cell, until someone
   * moves it home — the tracker counts correct cells only. */
  _drawTable() {
    this._clearTable();
    if (!this.enabled || !this._tablePos) return;
    const scene = this.scene;
    const { x, y } = this._tablePos;
    const g = scene.add.graphics();
    // Same table as every other Agora cafe table.
    g.fillStyle(0x4a3728, 1);
    g.fillCircle(0, 0, 30);
    g.lineStyle(1.5, 0x2b2b33, 1);
    g.strokeCircle(0, 0, 30);
    // Small puzzle thumbnail on the tabletop.
    const cell = 9;
    const ox = -cell * 1.5;
    const oy = -cell * 1.5;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const id = row * 3 + col;
        const cx = ox + col * cell;
        const cy = oy + row * cell;
        const pos = this.state.placed[id];
        const home = pieceHome(id);
        if (pos && pos.col === home.col && pos.row === home.row) {
          g.fillStyle(0xfbbf24, 1);
          g.fillRect(cx + 1, cy + 1, cell - 2, cell - 2);
        } else {
          g.lineStyle(1, 0xfff7e6, 0.9);
          g.strokeRect(cx + 1, cy + 1, cell - 2, cell - 2);
        }
      }
    }
    const progress = scene.add.text(
      0, -42,
      this.state.completed
        ? '🧩 Puzzle complete!'
        : `🧩 ${placedCount(this.state)}/${PUZZLE_TOTAL}`,
      { fontSize: '12px', color: '#1a4971', backgroundColor: 'rgba(255,255,255,0.92)', padding: { x: 6, y: 3 } },
    );
    progress.setOrigin(0.5, 0.5);
    const container = scene.add.container(x, y, [g, progress]);
    container.setDepth(DEPTH.ACTOR_MIN + Math.round(y));
    container.setSize(70, 84);
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

  // ---- piece hiding spots (v1.2: furniture only) ---------------------

  /** Where each piece hides, resolved from the live room layout:
   * real furniture first (zones labelled Table / Bar / Couch /
   * Trash Can / Plant), boundary fractions as fallback, so the spots
   * are SET furniture in Agora, never a random point on the open
   * floor. Each spot also gets a click shape (_spotHit) — the piece
   * is found by clicking that furniture a few times. Nothing here
   * is ever drawn: no marker, no glow, no hint. The fourth cafe
   * table, the rug, the portrait, and the other plants/couch are
   * decoys — furniture you can click that hides nothing.
   * Piece 7 (sleeping cat) is dynamic — resolved live from the
   * cat's position. Piece 8 (coffee) has no floor spot. */
  _resolveSpotPositions() {
    this._spotPos.clear();
    this._spotHit.clear();
    const layout = this.scene?.roomLayout;
    let bounds = null;
    try { bounds = layout?.getBoundaryBounds?.(); } catch {}
    if (!bounds || !Number.isFinite(bounds.w) || bounds.w <= 100) {
      bounds = { x: 200, y: 200, w: 1200, h: 500 };
    }
    const frac = (fx, fy) => ({ x: bounds.x + bounds.w * fx, y: bounds.y + bounds.h * fy });
    // All floor zones, not just interact ones: couches and plants
    // are not interact:true, but pieces hide in them too.
    const zones = Array.isArray(layout?.currentZones) && layout.currentZones.length
      ? layout.currentZones
      : (Array.isArray(layout?.interactZones) ? layout.interactZones : []);
    const zoneCenter = (z) => ({ x: z.x + (z.w || 0) / 2, y: z.y + (z.h || 0) / 2 });
    const zoneRect = (z, pad = 12) => ({
      kind: 'rect',
      x: (z.x ?? 0) - pad,
      y: (z.y ?? 0) - pad,
      w: (z.w || 0) + pad * 2,
      h: (z.h || 0) + pad * 2,
    });
    const clamp = (p) => (layout?.clampPointToRoom ? layout.clampPointToRoom(p.x, p.y, 24) : p);
    const setCircle = (id, p, r) => {
      const c = clamp(p);
      this._spotPos.set(id, c);
      this._spotHit.set(id, { kind: 'circle', x: c.x, y: c.y, r });
    };
    const setRect = (id, z, w, h) => {
      const c = z ? zoneCenter(z) : frac(0.5, 0.5);
      const cc = clamp(c);
      this._spotPos.set(id, cc);
      if (z) {
        this._spotHit.set(id, zoneRect(z));
      } else {
        this._spotHit.set(id, { kind: 'rect', x: cc.x - w / 2, y: cc.y - h / 2, w, h });
      }
    };
    // Pieces 0-2: under a cafe table (Tables 1-3; Table 4 is a decoy).
    const tables = zones.filter((z) => /table/i.test(z.label || ''));
    const tableFallbacks = [frac(0.25, 0.35), frac(0.6, 0.3), frac(0.4, 0.62)];
    for (let i = 0; i < 3; i++) {
      const z = tables[i];
      setCircle(i, z ? zoneCenter(z) : tableFallbacks[i], 60);
    }
    // Piece 3: behind the coffee bar counter.
    const bars = zones.filter((z) => z.type === 'counter' || /bar|coffee/i.test(z.label || ''));
    setRect(3, bars[0], 760, 64);
    // Piece 4: in a couch (the north one).
    const couches = zones.filter((z) => z.type === 'couch');
    setRect(4, couches[0], 200, 60);
    // Piece 5: in the trash can by the coffee bar (furniture pass v1 —
    // replaces the old bookshelf spot).
    const trash = zones.find((z) => z.type === 'trash_can' || /trash/i.test(z.label || ''));
    setCircle(5, trash ? zoneCenter(trash) : frac(0.77, 0.15), 55);
    // Piece 6: behind a plant — the south-west corner plant, so the
    // pieces spread across the whole room, not one corner.
    const plants = zones.filter((z) => z.type === 'plant');
    plants.sort((a, b) => (a.x - a.y) - (b.x - b.y));
    setCircle(6, plants[0] ? zoneCenter(plants[0]) : frac(0.1, 0.77), 55);
    // Piece 7 (sleeping cat) is dynamic — resolved live in _spotHitAt.
    // Piece 8 (coffee) has no floor spot.
  }

  update() {
    if (!this.enabled) return;
    const now = Date.now();
    if (now - (this._lastCheckMs || 0) < RESPAWN_CHECK_MS) return;
    this._lastCheckMs = now;
    // The table re-spawns if a floor switch cleared it. There are
    // no piece markers to refresh in v1.2 — the pieces are invisible.
    if (!this.table) this._drawTable();
  }

  _clearEntities() {
    this._clearTable();
  }

  destroy() {
    this._clearEntities();
    this._spotPos.clear();
    this._spotHit.clear();
    this._searchTaps.clear();
    this._pendingFind.clear();
    this.scene = null;
  }
}
