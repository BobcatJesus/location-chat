// puzzlePersist.test.js — Shared Puzzle persistence
// (`sq-puzzle-persist-v1`).
//
// Piece 3 of the room-state persistence fix: the shared puzzle
// board is saved to Postgres on every mutation and loaded back
// lazily, so a server restart restores the board instead of
// starting a fresh puzzle.
//
// These tests cover the persistence layer
// (server/puzzlePersist.js) against a fake in-memory pool — no
// real Postgres needed. The socket.js wiring (ensurePuzzleLoaded /
// persistPuzzle / armPuzzleResetTimer in the puzzle handlers) is
// verified by node --check + code read: socket.js boots a server
// on import and cannot run in vitest.

import { describe, it, expect } from 'vitest';
import {
  PUZZLE_PERSIST_MARKER,
  PUZZLE_ROOM_STATE_TABLE,
  PUZZLE_ROOM_STATE_TABLE_SQL,
  savePuzzleState,
  loadPuzzleState,
  repairLoadedPuzzleState,
} from '../server/puzzlePersist.js';
import {
  PUZZLE_RESET_MS,
  PUZZLE_TOTAL,
  createPuzzleState,
  collectPiece,
  placePiece,
  pieceHome,
  placedCount,
  placedAnyCount,
  serializePuzzleState,
} from '../src/village/puzzleState.js';

// Tiny in-memory stand-in for a pg Pool: one Map keyed by room_id,
// answering only the two queries the persistence layer issues.
function makeFakePool(initial = {}) {
  const store = new Map(Object.entries(initial));
  const queries = [];
  return {
    store,
    queries,
    async query(text, params = []) {
      queries.push({ text, params });
      const sql = String(text);
      if (/SELECT data FROM puzzle_room_state/i.test(sql)) {
        const data = store.get(params[0]);
        return { rows: data !== undefined ? [{ data }] : [] };
      }
      if (/INSERT INTO puzzle_room_state/i.test(sql)) {
        store.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

const ROOM = 'agora-houston';
const NOW = Date.now();

function midRoundBoard() {
  const s = createPuzzleState();
  collectPiece(s, 0, 'user-1');
  collectPiece(s, 1, 'user-2');
  collectPiece(s, 2, 'user-1');
  placePiece(s, 0, 0, 0, 'user-1'); // home cell
  placePiece(s, 1, 2, 2, 'user-2'); // WRONG cell — stays, does not count
  placePiece(s, 2, 2, 0, 'user-1'); // home cell
  return s;
}

function completedBoard(round = 1, completedAt = NOW) {
  const s = createPuzzleState();
  s.round = round;
  for (let id = 0; id < PUZZLE_TOTAL; id++) {
    collectPiece(s, id, 'user-1');
    const home = pieceHome(id);
    placePiece(s, id, home.col, home.row, 'user-1');
  }
  // placePiece stamps Date.now(); pin the completion time so the
  // 60s-window math is exact.
  s.completedAt = completedAt;
  return s;
}

describe('constants', () => {
  it('carries the v1 marker and the table name', () => {
    expect(PUZZLE_PERSIST_MARKER).toBe('sq-puzzle-persist-v1');
    expect(PUZZLE_ROOM_STATE_TABLE).toBe('puzzle_room_state');
  });

  it('creates one row per room with the serialized state as JSONB', () => {
    expect(PUZZLE_ROOM_STATE_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS puzzle_room_state/);
    expect(PUZZLE_ROOM_STATE_TABLE_SQL).toMatch(/room_id TEXT PRIMARY KEY/);
    expect(PUZZLE_ROOM_STATE_TABLE_SQL).toMatch(/data JSONB NOT NULL/);
  });
});

describe('save/load round-trip', () => {
  it('restores an empty round exactly', async () => {
    const pool = makeFakePool();
    const before = createPuzzleState();
    expect(await savePuzzleState(pool, ROOM, before)).toBe(true);
    const loaded = await loadPuzzleState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializePuzzleState(loaded)).toEqual(serializePuzzleState(before));
  });

  it('restores a mid-round board, wrong-cell placement included', async () => {
    const pool = makeFakePool();
    const before = midRoundBoard();
    expect(placedCount(before)).toBe(2); // pieces 0 and 2 correct
    expect(placedAnyCount(before)).toBe(3); // piece 1 sits wrong
    await savePuzzleState(pool, ROOM, before);
    const loaded = await loadPuzzleState(pool, ROOM);
    expect(serializePuzzleState(loaded)).toEqual(serializePuzzleState(before));
    expect(loaded.collected).toEqual([0, 1, 2]);
    expect(loaded.placed[1]).toEqual({ col: 2, row: 2 });
    expect(loaded.contributors).toEqual(['user-1', 'user-2']);
    expect(loaded.completed).toBe(false);
  });

  it('restores a completed board exactly', async () => {
    const pool = makeFakePool();
    const before = completedBoard(2, NOW - 10000);
    expect(before.completed).toBe(true);
    await savePuzzleState(pool, ROOM, before);
    const loaded = await loadPuzzleState(pool, ROOM);
    expect(serializePuzzleState(loaded)).toEqual(serializePuzzleState(before));
    expect(loaded.completed).toBe(true);
    expect(loaded.completedAt).toBe(NOW - 10000);
    expect(loaded.round).toBe(2);
  });

  it('writes an upsert (INSERT ... ON CONFLICT), one row per room', async () => {
    const pool = makeFakePool();
    await savePuzzleState(pool, ROOM, createPuzzleState());
    await savePuzzleState(pool, ROOM, midRoundBoard());
    expect(pool.store.size).toBe(1);
    expect(pool.queries.filter((q) => /INSERT INTO puzzle_room_state/i.test(q.text))).toHaveLength(2);
    expect(pool.queries[0].text).toMatch(/ON CONFLICT \(room_id\)/);
    const loaded = await loadPuzzleState(pool, ROOM);
    expect(loaded.collected).toEqual([0, 1, 2]);
  });
});

describe('load of a missing row', () => {
  it('returns null — the caller starts a fresh round, as today', async () => {
    const pool = makeFakePool();
    expect(await loadPuzzleState(pool, ROOM)).toBeNull();
    expect(await loadPuzzleState(pool, 'somewhere-else')).toBeNull();
  });
});

describe('no pool (local dev without Postgres)', () => {
  it('save is a no-op that never throws; load returns null', async () => {
    await expect(savePuzzleState(null, ROOM, createPuzzleState())).resolves.toBe(false);
    await expect(loadPuzzleState(null, ROOM)).resolves.toBeNull();
    await expect(savePuzzleState(undefined, ROOM, createPuzzleState())).resolves.toBe(false);
  });
});

describe('bad-row repair (never trust the row blindly)', () => {
  it('repairs a junk row to a fresh round', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        round: 0,
        collected: 'nope',
        placed: null,
        contributors: 'nope',
        completed: false,
        completedAt: null,
      },
    });
    const loaded = await loadPuzzleState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializePuzzleState(loaded)).toEqual(serializePuzzleState(createPuzzleState()));
  });

  it('filters out-of-range pieces and out-of-bounds cells', async () => {
    const pool = makeFakePool({
      [ROOM]: {
        round: 1,
        collected: [0, 99, -1, 3],
        placed: {
          0: { col: 0, row: 0 },
          1: { col: 5, row: 5 },
          3: { col: 1, row: 1 },
        },
        contributors: ['user-1', '', 42],
        completed: false,
        completedAt: 0,
      },
    });
    const loaded = await loadPuzzleState(pool, ROOM);
    expect(loaded.collected).toEqual([0, 3]);
    expect(loaded.placed).toEqual({ 0: { col: 0, row: 0 }, 3: { col: 1, row: 1 } });
    expect(loaded.contributors).toEqual(['user-1', '42']);
  });

  it('returns null for a row with no usable data', async () => {
    const pool = makeFakePool({ [ROOM]: 'not an object' });
    expect(await loadPuzzleState(pool, ROOM)).toBeNull();
    const pool2 = makeFakePool({ [ROOM]: null });
    expect(await loadPuzzleState(pool2, ROOM)).toBeNull();
  });

  it('returns null instead of throwing when the query fails', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(loadPuzzleState(pool, ROOM)).resolves.toBeNull();
  });
});

describe('60s admire window — repairLoadedPuzzleState', () => {
  it('repairs a board completed more than 60s ago to a fresh round', () => {
    const s = completedBoard(3, NOW - PUZZLE_RESET_MS - 5000);
    const { state, repaired } = repairLoadedPuzzleState(s, NOW);
    expect(repaired).toBe(true);
    expect(state.round).toBe(4);
    expect(state.completed).toBe(false);
    expect(state.completedAt).toBe(0);
    expect(state.collected).toEqual([]);
    expect(state.placed).toEqual({});
    expect(state.contributors).toEqual([]);
  });

  it('repairs a board completed exactly at the 60s boundary', () => {
    const s = completedBoard(1, NOW - PUZZLE_RESET_MS);
    const { repaired } = repairLoadedPuzzleState(s, NOW);
    expect(repaired).toBe(true);
  });

  it('keeps a board completed inside the window, with time left', () => {
    const s = completedBoard(2, NOW - 30000);
    const { state, repaired } = repairLoadedPuzzleState(s, NOW);
    expect(repaired).toBe(false);
    expect(state).toBe(s);
    expect(state.completed).toBe(true);
    expect(state.round).toBe(2);
    // The remaining time the socket.js caller re-arms the reset
    // timer for: 60s minus the 30s already admired.
    expect(PUZZLE_RESET_MS - (NOW - s.completedAt)).toBe(30000);
  });

  it('leaves an open board alone', () => {
    const s = midRoundBoard();
    const { state, repaired } = repairLoadedPuzzleState(s, NOW);
    expect(repaired).toBe(false);
    expect(state).toBe(s);
  });

  it('never mutates its input', () => {
    const s = completedBoard(3, NOW - PUZZLE_RESET_MS - 5000);
    const before = serializePuzzleState(s);
    repairLoadedPuzzleState(s, NOW);
    expect(serializePuzzleState(s)).toEqual(before);
    expect(s.completed).toBe(true);
    expect(s.round).toBe(3);
  });

  it('repairs on load, not just in the pure helper — via the round trip', async () => {
    const pool = makeFakePool();
    await savePuzzleState(pool, ROOM, completedBoard(2, NOW - PUZZLE_RESET_MS - 1000));
    const loaded = await loadPuzzleState(pool, ROOM);
    // loadPuzzleState itself does NOT apply the 60s repair — it
    // returns the completed board as stored; the socket.js caller
    // runs repairLoadedPuzzleState and re-arms or writes back.
    expect(loaded.completed).toBe(true);
    const { state, repaired } = repairLoadedPuzzleState(loaded, NOW);
    expect(repaired).toBe(true);
    expect(state.round).toBe(3);
    expect(state.completed).toBe(false);
  });
});

describe('restart-restore flow', () => {
  it('save, drop the in-memory entry, load again: same board', async () => {
    const pool = makeFakePool();
    const before = midRoundBoard();
    await savePuzzleState(pool, ROOM, before);
    // The restart drops the in-memory entry entirely; the load
    // rebuilds it from the row alone.
    const after = await loadPuzzleState(pool, ROOM);
    expect(serializePuzzleState(after)).toEqual(serializePuzzleState(before));
  });

  it('a completed board survives a restart inside its window', async () => {
    const pool = makeFakePool();
    const before = completedBoard(2, NOW - 10000);
    await savePuzzleState(pool, ROOM, before);
    const after = await loadPuzzleState(pool, ROOM);
    expect(after.completed).toBe(true);
    expect(after.round).toBe(2);
  });
});

describe('load-before-mutate simulation', () => {
  it('persisted mid-round state + fresh cache -> load -> collect -> save -> reload shows all pieces', async () => {
    const pool = makeFakePool();
    // Before the "restart": two pieces found, saved.
    const before = createPuzzleState();
    collectPiece(before, 0, 'user-1');
    collectPiece(before, 1, 'user-2');
    await savePuzzleState(pool, ROOM, before);
    // The restart drops the in-memory cache; the first touch after
    // it loads the row (ensurePuzzleLoaded) BEFORE mutating.
    const cache = await loadPuzzleState(pool, ROOM);
    expect(cache.collected).toEqual([0, 1]);
    const res = collectPiece(cache, 2, 'user-1');
    expect(res.ok).toBe(true);
    await savePuzzleState(pool, ROOM, cache);
    // A second restart (or another device) sees all three pieces —
    // the pre-restart progress was not overwritten by the fresh board.
    const after = await loadPuzzleState(pool, ROOM);
    expect(after.collected).toEqual([0, 1, 2]);
    expect(after.contributors).toEqual(['user-1', 'user-2']);
  });

  it('a collect after a restart does not resurrect a completed board', async () => {
    const pool = makeFakePool();
    await savePuzzleState(pool, ROOM, completedBoard(2, NOW - PUZZLE_RESET_MS - 1000));
    const cache = await loadPuzzleState(pool, ROOM);
    const { state } = repairLoadedPuzzleState(cache, NOW);
    await savePuzzleState(pool, ROOM, state);
    const after = await loadPuzzleState(pool, ROOM);
    expect(after.round).toBe(3);
    expect(after.completed).toBe(false);
    expect(after.collected).toEqual([]);
  });
});

describe('save errors', () => {
  it('savePuzzleState propagates a DB error (the socket.js caller catches it)', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(savePuzzleState(pool, ROOM, createPuzzleState())).rejects.toThrow('db down');
  });
});
