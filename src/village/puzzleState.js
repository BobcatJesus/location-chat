// puzzleState.js — shared puzzle rules for the Agora group puzzle
// (Shared Puzzle Quest v1, `group-puzzle-v1`).
//
// Pure logic, no Phaser and no Node APIs, so BOTH sides import it:
//   - server/socket.js (canonical room state, validates every move)
//   - src/village/PuzzleQuest.js (local fallback + instant feedback
//     when the socket is down)
//
// The picture is the calico cat (Agora's mascot, cat-threequarter.png),
// cut 3x3. Piece N belongs at cell (col = N % 3, row = floor(N / 3)).
//
// The 9 pieces and where they are found (all SET spots in Agora, never
// random anywhere — that was the Golden Key's problem):
//   0-2  under a table (three different tables)
//   3-4  on top of the bar / behind the bar counter
//   5    on a bookshelf
//   6    in the sunny spot by the window
//   7    under the sleeping cat — only while she naps after 3 pets
//   8    from the barista — ask the NPC about the puzzle / a missing
//        piece ("puzzle", "jigsaw", "missing piece", "lost piece")

export const PUZZLE_ID = 'group-puzzle';
export const PUZZLE_MARKER = 'group-puzzle-v1';
// v1.1 (`group-puzzle-v1-1-free-place`): free placement — any piece
// may sit in any cell, wrong spots stay until someone moves them.
export const PUZZLE_MARKER_V11 = 'group-puzzle-v1-1-free-place';
export const PUZZLE_SIZE = 3; // 3x3 grid
export const PUZZLE_TOTAL = 9;
export const PUZZLE_REWARD_COINS = 5;
export const PUZZLE_IMAGE_URL = '/assets/sprites/cat-threequarter.png';
// After a group finishes, the board stays up to admire for this long,
// then a fresh puzzle (same picture, new round) starts automatically.
export const PUZZLE_RESET_MS = 60000;

export const PUZZLE_SPOTS = [
  { id: 0, kind: 'table', label: 'under a table' },
  { id: 1, kind: 'table', label: 'under a table' },
  { id: 2, kind: 'table', label: 'under a table' },
  { id: 3, kind: 'bar', label: 'on top of the bar' },
  { id: 4, kind: 'bar', label: 'behind the bar' },
  { id: 5, kind: 'shelf', label: 'on a bookshelf' },
  { id: 6, kind: 'sunbeam', label: 'in the sunny spot' },
  { id: 7, kind: 'cat', label: 'under the sleeping cat' },
  { id: 8, kind: 'npc', label: 'from the barista' },
];

/** The cell a piece belongs in. */
export function pieceHome(pieceId) {
  return { col: pieceId % PUZZLE_SIZE, row: Math.floor(pieceId / PUZZLE_SIZE) };
}

export function createPuzzleState() {
  return {
    round: 1,
    collected: [], // piece ids found by the room, in find order
    // pieceId -> { col, row }. v1.1 FREE PLACEMENT: a piece may sit in
    // ANY cell, right or wrong — wrong spots stay put until someone
    // moves the piece. Only the count of CORRECT cells is progress.
    placed: {},
    contributors: [], // user ids who found at least one piece this round
    completed: false,
    completedAt: 0, // Date.now() when the last piece was placed, 0 if open
  };
}

/** Is piece `pieceId` in its home cell right now? */
export function isPieceCorrect(state, pieceId) {
  const pos = state?.placed?.[pieceId];
  if (!pos) return false;
  const home = pieceHome(Number(pieceId));
  return pos.col === home.col && pos.row === home.row;
}

/** How many pieces are in their CORRECT cell (0..9). This is the
 * tracker's number — a wrongly placed piece does not inflate it. */
export function placedCount(state) {
  const placed = state?.placed || {};
  return Object.keys(placed).filter((id) => isPieceCorrect(state, id)).length;
}

/** How many pieces are on the board at all, right or wrong. */
export function placedAnyCount(state) {
  return Object.keys(state?.placed || {}).length;
}

export function isComplete(state) {
  return placedCount(state) >= PUZZLE_TOTAL;
}

/** Plain JSON copy safe to send over the socket. */
export function serializePuzzleState(state) {
  const s = state || createPuzzleState();
  return {
    round: s.round,
    collected: [...(s.collected || [])],
    placed: { ...(s.placed || {}) },
    contributors: [...(s.contributors || [])],
    completed: Boolean(s.completed),
    completedAt: Number(s.completedAt) || 0,
    placedCount: placedCount(s),
    total: PUZZLE_TOTAL,
  };
}

/** Validate an incoming state object (never trust the wire). */
export function parsePuzzleState(raw) {
  const s = createPuzzleState();
  if (!raw || typeof raw !== 'object') return s;
  if (Number.isInteger(raw.round) && raw.round >= 1) s.round = raw.round;
  if (Array.isArray(raw.collected)) {
    s.collected = raw.collected
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < PUZZLE_TOTAL);
    s.collected = [...new Set(s.collected)];
  }
  if (raw.placed && typeof raw.placed === 'object') {
    for (const [k, v] of Object.entries(raw.placed)) {
      const id = Number(k);
      if (!Number.isInteger(id) || id < 0 || id >= PUZZLE_TOTAL) continue;
      if (!v || !Number.isInteger(v.col) || !Number.isInteger(v.row)) continue;
      if (v.col < 0 || v.col >= PUZZLE_SIZE || v.row < 0 || v.row >= PUZZLE_SIZE) continue;
      // v1.1: a placed piece may be in ANY in-bounds cell, right or
      // wrong — wrong spots are real board state, not a bad payload.
      s.placed[id] = { col: v.col, row: v.row };
    }
  }
  if (Array.isArray(raw.contributors)) {
    s.contributors = [...new Set(raw.contributors.map((u) => String(u)).filter(Boolean))].slice(0, 50);
  }
  s.completed = Boolean(raw.completed) || isComplete(s);
  if (Number.isFinite(Number(raw.completedAt))) s.completedAt = Number(raw.completedAt);
  return s;
}

/**
 * One player found piece `pieceId`. Returns { ok, reason? }.
 * Fails if the puzzle is already complete, the id is bad, or the
 * piece was already found by the room (pieces are shared — the
 * first finder claims it for the whole room).
 */
export function collectPiece(state, pieceId, userId) {
  const id = Number(pieceId);
  if (!Number.isInteger(id) || id < 0 || id >= PUZZLE_TOTAL) return { ok: false, reason: 'bad-piece' };
  if (state.completed) return { ok: false, reason: 'already-complete' };
  if (state.collected.includes(id)) return { ok: false, reason: 'already-found' };
  state.collected.push(id);
  if (userId && !state.contributors.includes(String(userId))) {
    state.contributors.push(String(userId));
  }
  return { ok: true };
}

/**
 * Try to place a found piece at (col, row). Returns { ok, reason? }.
 * v1.1 FREE PLACEMENT: any in-bounds cell accepts the piece and it
 * STAYS there — wrong spots are allowed, that's the group figuring
 * it out. A placed piece can always be moved again. If the target
 * cell is occupied, the two pieces swap (or the occupant goes back
 * to the tray when the moved piece came from the tray), so no piece
 * is ever lost and one cell never holds two pieces. Completion only
 * counts when all 9 are in their home cells at the same time.
 */
export function placePiece(state, pieceId, col, row, userId) {
  const id = Number(pieceId);
  if (!Number.isInteger(id) || id < 0 || id >= PUZZLE_TOTAL) return { ok: false, reason: 'bad-piece' };
  if (state.completed) return { ok: false, reason: 'already-complete' };
  if (!state.collected.includes(id)) return { ok: false, reason: 'not-found' };
  if (!Number.isInteger(col) || !Number.isInteger(row)
    || col < 0 || col >= PUZZLE_SIZE || row < 0 || row >= PUZZLE_SIZE) {
    return { ok: false, reason: 'bad-cell' };
  }
  // Who is sitting in the target cell (if anyone but this piece)?
  let occupant = null;
  for (const [k, v] of Object.entries(state.placed)) {
    if (Number(k) !== id && v.col === col && v.row === row) { occupant = Number(k); break; }
  }
  const wasPlaced = state.placed[id] ? { ...state.placed[id] } : null;
  if (occupant != null) {
    if (wasPlaced) {
      // Swap: the occupant takes the moved piece's old cell.
      state.placed[occupant] = { col: wasPlaced.col, row: wasPlaced.row };
    } else {
      // Moved piece came from the tray: occupant goes back to the tray.
      delete state.placed[occupant];
    }
  }
  state.placed[id] = { col, row };
  if (userId && !state.contributors.includes(String(userId))) {
    state.contributors.push(String(userId));
  }
  if (isComplete(state)) {
    state.completed = true;
    state.completedAt = Date.now();
  }
  return { ok: true, completed: state.completed, swapped: occupant };
}

/** Fresh round, same picture: round number goes up, everything else clears. */
export function resetPuzzleState(state) {
  const next = createPuzzleState();
  next.round = (Number(state?.round) || 1) + 1;
  return next;
}
