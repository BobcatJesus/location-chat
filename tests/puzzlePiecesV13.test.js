// puzzlePiecesV13.test.js — Shared Puzzle Quest v1.3 (`sq-puzzle-v1-3`).
// Carried puzzle pieces disappear on leaving the venue / logging out,
// and the pocket reconciles against the server on every state update,
// so stale pieces (found before a server restart reset the round to 1)
// can never strand the board tray empty while the pocket still lists
// them. Pure-logic + PuzzleQuest.applyState tests with a mock scene
// (no Phaser); the app-level leave/logout wiring is covered by the
// headless harness's source checks.
//
// The store reads localStorage lazily, so stubs installed in
// beforeEach are enough (same pattern as tests/items.test.js).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PUZZLE_MARKER_V13,
  PUZZLE_TOTAL,
} from '../src/village/puzzleState.js';
import {
  _setInventoryForTest,
  addPuzzlePiece,
  carriedPuzzlePieces,
  clearPuzzlePieces,
  dropStalePuzzlePieces,
  clearPuzzlePiecesForNewSession,
} from '../src/village/items.js';
import { PuzzleQuest } from '../src/village/PuzzleQuest.js';

function makeStorageStub() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

function makeScene(notices) {
  return {
    roomId: 'agora-houston',
    socket: null,
    questManager: { bumpHud: () => {} },
    onSystemNotice: (msg) => { notices.push(msg); },
    cafeCat: null,
    player: null,
  };
}

function serverState(overrides = {}) {
  return {
    round: 1,
    collected: [],
    placed: {},
    contributors: [],
    completed: false,
    completedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.localStorage = makeStorageStub();
  globalThis.sessionStorage = makeStorageStub();
  _setInventoryForTest({ items: [], hasBag: true });
});

describe('v1.3 marker', () => {
  it('carries the v1.3 marker', () => {
    expect(PUZZLE_MARKER_V13).toBe('sq-puzzle-v1-3');
  });

  it('PuzzleQuest live-references the marker (survives minification)', () => {
    const quest = new PuzzleQuest(makeScene([]));
    expect(quest.markerV13).toBe('sq-puzzle-v1-3');
    expect(quest.marker).toBe('group-puzzle-v1-2-hidden-search');
  });
});

describe('dropStalePuzzlePieces', () => {
  it('drops only pieces the server does not know, keeps known ones', () => {
    addPuzzlePiece(0);
    addPuzzlePiece(1);
    addPuzzlePiece(2);
    expect(dropStalePuzzlePieces([1])).toBe(2);
    expect(carriedPuzzlePieces()).toEqual([1]);
  });

  it('is a no-op when every carried piece is known', () => {
    addPuzzlePiece(0);
    addPuzzlePiece(1);
    expect(dropStalePuzzlePieces([0, 1, 2])).toBe(0);
    expect(carriedPuzzlePieces()).toEqual([0, 1]);
  });

  it('drops everything when the server knows nothing (post-restart round 1)', () => {
    addPuzzlePiece(0);
    addPuzzlePiece(1);
    expect(dropStalePuzzlePieces([])).toBe(2);
    expect(carriedPuzzlePieces()).toEqual([]);
  });

  it('leaves non-piece items alone', () => {
    addPuzzlePiece(0);
    _setInventoryForTest({
      items: [
        { id: 't1', type: 'trash', label: 'trash', pieceId: null },
        { id: 'p0', type: 'puzzle-piece', label: null, pieceId: 0 },
      ],
      hasBag: true,
    });
    expect(dropStalePuzzlePieces([5])).toBe(1);
    expect(carriedPuzzlePieces()).toEqual([]);
  });
});

describe('clearPuzzlePiecesForNewSession (logout / tab close)', () => {
  it('first call in a fresh session drops carried pieces and sets the marker', () => {
    addPuzzlePiece(0);
    addPuzzlePiece(1);
    expect(clearPuzzlePiecesForNewSession()).toBe(2);
    expect(carriedPuzzlePieces()).toEqual([]);
    expect(globalThis.sessionStorage.getItem('sidequest-puzzle-session-v1')).toBe('1');
  });

  it('second call in the same session is a no-op — refresh keeps legit pieces', () => {
    addPuzzlePiece(0);
    expect(clearPuzzlePiecesForNewSession()).toBe(1);
    addPuzzlePiece(1);
    expect(clearPuzzlePiecesForNewSession()).toBe(0);
    expect(carriedPuzzlePieces()).toEqual([1]);
  });

  it('with the marker already set (same tab refresh), pieces survive', () => {
    globalThis.sessionStorage.setItem('sidequest-puzzle-session-v1', '1');
    addPuzzlePiece(0);
    expect(clearPuzzlePiecesForNewSession()).toBe(0);
    expect(carriedPuzzlePieces()).toEqual([0]);
  });
});

describe('PuzzleQuest.applyState reconcile (the live bug)', () => {
  it("drops the user's 4 stale pieces and toasts once when the server knows none", () => {
    const notices = [];
    const quest = new PuzzleQuest(makeScene(notices));
    addPuzzlePiece(0);
    addPuzzlePiece(1);
    addPuzzlePiece(2);
    addPuzzlePiece(3);
    expect(carriedPuzzlePieces()).toHaveLength(4);

    quest.applyState(serverState({ round: 1, collected: [] }));

    expect(carriedPuzzlePieces()).toEqual([]);
    expect(notices).toEqual(['🧩 Your old puzzle pieces from an earlier round expired.']);
  });

  it('keeps pieces the server knows and stays silent', () => {
    const notices = [];
    const quest = new PuzzleQuest(makeScene(notices));
    addPuzzlePiece(0);
    addPuzzlePiece(1);

    quest.applyState(serverState({ round: 1, collected: [0, 1] }));

    expect(carriedPuzzlePieces()).toEqual([0, 1]);
    expect(notices).toEqual([]);
  });

  it('drops only the stale ones in a mixed pocket', () => {
    const notices = [];
    const quest = new PuzzleQuest(makeScene(notices));
    addPuzzlePiece(0);
    addPuzzlePiece(1);
    addPuzzlePiece(2);

    quest.applyState(serverState({ round: 1, collected: [1] }));

    expect(carriedPuzzlePieces()).toEqual([1]);
    expect(notices).toHaveLength(1);
  });

  it('does not toast twice: a second state update finds nothing stale', () => {
    const notices = [];
    const quest = new PuzzleQuest(makeScene(notices));
    addPuzzlePiece(0);
    quest.applyState(serverState({ round: 1, collected: [] }));
    expect(notices).toHaveLength(1);
    quest.applyState(serverState({ round: 1, collected: [] }));
    expect(notices).toHaveLength(1);
  });

  it('round change still clears the pocket (existing behaviour, no toast)', () => {
    const notices = [];
    const quest = new PuzzleQuest(makeScene(notices));
    addPuzzlePiece(0);
    addPuzzlePiece(1);

    quest.applyState(serverState({ round: 2, collected: [] }));

    expect(carriedPuzzlePieces()).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('a bare payload skips the reconcile — an offline fallback never nukes pieces', () => {
    const notices = [];
    const quest = new PuzzleQuest(makeScene(notices));
    addPuzzlePiece(0);
    addPuzzlePiece(1);

    quest.applyState({});

    expect(carriedPuzzlePieces()).toEqual([0, 1]);
    expect(notices).toEqual([]);
  });

  it('prunes my own find records to what the server knows', () => {
    const notices = [];
    const quest = new PuzzleQuest(makeScene(notices));
    addPuzzlePiece(0);
    quest.myFound.add(0);
    quest.myFound.add(5);

    quest.applyState(serverState({ round: 1, collected: [0] }));

    expect([...quest.myFound]).toEqual([0]);
    expect(carriedPuzzlePieces()).toEqual([0]);
  });
});

describe('leave-venue clearing still uses the existing helper', () => {
  it('clearPuzzlePieces frees the slots', () => {
    addPuzzlePiece(0);
    addPuzzlePiece(1);
    expect(clearPuzzlePieces()).toBe(2);
    expect(carriedPuzzlePieces()).toEqual([]);
    expect(PUZZLE_TOTAL).toBe(9);
  });
});
