// notePersist.test.js — Pick-Up Notes persistence
// (`sq-pickup-notes-v1`).
//
// The notes are saved to Postgres on every drop and removal and
// loaded back lazily, so a server restart restores them with their
// original createdAt — and a note left Monday at noon still fades
// Wednesday at noon, restart or not.
//
// These tests cover the persistence layer
// (server/notePersist.js) against a fake in-memory pool — no real
// Postgres needed. The socket.js wiring (ensureNotesLoaded /
// persistNotes in the note handlers) is verified by node --check
// + code read: socket.js boots a server on import and cannot run
// in vitest.

import { describe, it, expect } from 'vitest';
import {
  NOTE_PERSIST_MARKER,
  NOTES_ROOM_STATE_TABLE,
  NOTES_ROOM_STATE_TABLE_SQL,
  saveNoteState,
  loadNoteState,
} from '../server/notePersist.js';
import {
  NOTE_TTL_MS,
  createNoteState,
  dropNote,
  serializeNoteStateForStorage,
} from '../src/village/noteState.js';

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
      if (/SELECT data FROM room_notes_state/i.test(sql)) {
        const data = store.get(params[0]);
        return { rows: data !== undefined ? [{ data }] : [] };
      }
      if (/INSERT INTO room_notes_state/i.test(sql)) {
        store.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

const ROOM = 'agora-houston';
const NOW = Date.now();

function note(n, by = `user-${n}`, createdAt = NOW) {
  return {
    id: `note-${n}`,
    text: `Hello from note ${n}.`,
    authorId: by,
    x: 100 + n,
    y: 200 + n,
    createdAt,
  };
}

function midNoteState() {
  const s = createNoteState();
  for (let i = 1; i <= 3; i++) {
    const res = dropNote(s, note(i));
    expect(res.ok).toBe(true);
  }
  return s;
}

describe('constants', () => {
  it('carries the v1 marker and the table name', () => {
    expect(NOTE_PERSIST_MARKER).toBe('sq-pickup-notes-v1');
    expect(NOTES_ROOM_STATE_TABLE).toBe('room_notes_state');
  });

  it('creates one row per room with the serialized state as JSONB', () => {
    expect(NOTES_ROOM_STATE_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS room_notes_state/);
    expect(NOTES_ROOM_STATE_TABLE_SQL).toMatch(/room_id TEXT PRIMARY KEY/);
    expect(NOTES_ROOM_STATE_TABLE_SQL).toMatch(/data JSONB NOT NULL/);
  });
});

describe('save/load round-trip', () => {
  it('restores an empty floor exactly', async () => {
    const pool = makeFakePool();
    const before = createNoteState();
    expect(await saveNoteState(pool, ROOM, before)).toBe(true);
    const loaded = await loadNoteState(pool, ROOM);
    expect(loaded).not.toBeNull();
    expect(serializeNoteStateForStorage(loaded)).toEqual(serializeNoteStateForStorage(before));
    expect(loaded.notes).toEqual([]);
  });

  it('restores notes in order, all fields kept — including authorId', async () => {
    const pool = makeFakePool();
    const before = midNoteState();
    await saveNoteState(pool, ROOM, before);
    const loaded = await loadNoteState(pool, ROOM);
    expect(serializeNoteStateForStorage(loaded)).toEqual(serializeNoteStateForStorage(before));
    expect(loaded.notes.map((n) => n.id)).toEqual(['note-1', 'note-2', 'note-3']);
    // The storage round-trip keeps who wrote each note, so a
    // restart does not orphan a note from its writer — the wire
    // state still never carries it (see noteState.test.js).
    expect(loaded.notes[0].authorId).toBe('user-1');
    expect(loaded.notes[2]).toEqual(note(3));
  });

  it('load drops notes whose 48 hours ran out while the server was down', async () => {
    const pool = makeFakePool();
    const before = createNoteState();
    dropNote(before, note(1, 'user-1', NOW));
    dropNote(before, note(2, 'user-2', NOW - NOTE_TTL_MS - 1000));
    await saveNoteState(pool, ROOM, before);
    const loaded = await loadNoteState(pool, ROOM);
    expect(loaded.notes.map((n) => n.id)).toEqual(['note-1']);
  });

  it('writes an upsert (INSERT ... ON CONFLICT), one row per room', async () => {
    const pool = makeFakePool();
    await saveNoteState(pool, ROOM, createNoteState());
    await saveNoteState(pool, ROOM, midNoteState());
    expect(pool.store.size).toBe(1);
    expect(pool.queries.filter((q) => /INSERT INTO room_notes_state/i.test(q.text))).toHaveLength(2);
    expect(pool.queries[0].text).toMatch(/ON CONFLICT \(room_id\)/);
    const loaded = await loadNoteState(pool, ROOM);
    expect(loaded.notes).toHaveLength(3);
  });

  it('returns null with no pool or no row, false on save with no pool', async () => {
    expect(await loadNoteState(null, ROOM)).toBeNull();
    expect(await saveNoteState(null, ROOM, createNoteState())).toBe(false);
    const pool = makeFakePool();
    expect(await loadNoteState(pool, ROOM)).toBeNull();
    expect(await loadNoteState(pool, '')).toBeNull();
    expect(await saveNoteState(pool, '', createNoteState())).toBe(false);
  });
});
