// noteState.test.js — Pick-Up Notes v1 (`sq-pickup-notes-v1`).
//
// Shared notes: anyone can read a note, repeatedly; the writer or
// a moderator can take it down; a note fades away after 48 hours.
// Anonymous: the wire state carries no authorId and no authorName.
// No per-room cap (user decision, Nov 26, 2026) — a room holds as
// many notes as people leave.

import { describe, it, expect } from 'vitest';
import {
  NOTE_MARKER,
  NOTE_TEXT_MAX,
  NOTE_TTL_MS,
  createNoteState,
  noteExpiresAt,
  isNoteExpired,
  cleanNote,
  dropNote,
  canRemoveNote,
  removeNote,
  pruneExpiredNotes,
  serializeNoteState,
  serializeNoteStateForStorage,
  parseNoteState,
} from '../src/village/noteState.js';

const NOW = Date.now();
const WRITER = 'writer@example.com';
const OTHER = 'other@example.com';

function note(n, by = WRITER, createdAt = NOW) {
  return {
    id: `note-${n}`,
    text: `Hello from note ${n}.`,
    authorId: by,
    x: 100 + n,
    y: 200 + n,
    createdAt,
  };
}

function midState() {
  const s = createNoteState();
  for (let i = 1; i <= 3; i++) {
    const res = dropNote(s, note(i));
    expect(res.ok).toBe(true);
  }
  return s;
}

describe('constants', () => {
  it('carries the v1 marker, the 280-char limit and the 48h expiry', () => {
    expect(NOTE_MARKER).toBe('sq-pickup-notes-v1');
    expect(NOTE_TEXT_MAX).toBe(280);
    expect(NOTE_TTL_MS).toBe(48 * 60 * 60 * 1000);
  });
});

describe('cleanNote', () => {
  it('trims the text and keeps every field', () => {
    const n = cleanNote(note(1));
    expect(n.text).toBe('Hello from note 1.');
    expect(n.authorId).toBe(WRITER);
    expect(n.x).toBe(101);
    expect(n.y).toBe(201);
    expect(n.createdAt).toBe(NOW);
  });

  it('trims overlong text to 280 instead of refusing it', () => {
    const n = cleanNote({ ...note(1), text: 'x'.repeat(500) });
    expect(n).not.toBeNull();
    expect(n.text).toHaveLength(280);
  });

  it('refuses empty or whitespace-only text', () => {
    expect(cleanNote({ ...note(1), text: '' })).toBeNull();
    expect(cleanNote({ ...note(1), text: '   \n  ' })).toBeNull();
    expect(cleanNote({})).toBeNull();
  });

  it('generates an id when none is given and repairs a bad position', () => {
    const n = cleanNote({ text: 'hi', authorId: WRITER, x: 'nope', y: null });
    expect(n.id).toMatch(/^note-/);
    expect(n.x).toBe(800);
    expect(n.y).toBe(450);
  });
});

describe('dropNote', () => {
  it('adds a valid note and returns it', () => {
    const s = createNoteState();
    const res = dropNote(s, note(1));
    expect(res.ok).toBe(true);
    expect(res.note.id).toBe('note-1');
    expect(s.notes).toHaveLength(1);
  });

  it('refuses empty text', () => {
    const s = createNoteState();
    expect(dropNote(s, { ...note(1), text: '  ' })).toEqual({ ok: false, reason: 'empty-note' });
    expect(s.notes).toHaveLength(0);
  });

  it('refuses a duplicate id', () => {
    const s = midState();
    expect(dropNote(s, note(1))).toEqual({ ok: false, reason: 'duplicate' });
    expect(s.notes).toHaveLength(3);
  });

  it('has NO per-room cap: 15 notes all land (user decision)', () => {
    const s = createNoteState();
    for (let i = 1; i <= 15; i++) {
      const res = dropNote(s, note(i));
      expect(res.ok).toBe(true);
    }
    expect(s.notes).toHaveLength(15);
  });
});

describe('expiry', () => {
  it('expiresAt is createdAt plus 48h', () => {
    expect(noteExpiresAt(note(1, WRITER, 1000))).toBe(1000 + NOTE_TTL_MS);
    expect(isNoteExpired(note(1, WRITER, 1000), 1000 + NOTE_TTL_MS - 1)).toBe(false);
    expect(isNoteExpired(note(1, WRITER, 1000), 1000 + NOTE_TTL_MS)).toBe(true);
  });

  it('pruneExpiredNotes drops only the notes whose 48 hours are up', () => {
    const s = createNoteState();
    dropNote(s, note(1, WRITER, NOW));
    dropNote(s, note(2, WRITER, NOW - NOTE_TTL_MS - 1000));
    dropNote(s, note(3, WRITER, NOW - NOTE_TTL_MS + 60000));
    expect(pruneExpiredNotes(s, NOW)).toBe(1);
    expect(s.notes.map((n) => n.id)).toEqual(['note-1', 'note-3']);
  });
});

describe('removal', () => {
  it('the writer can take down their own note', () => {
    const s = midState();
    expect(canRemoveNote(s.notes[0], WRITER, false)).toBe(true);
    expect(removeNote(s, 'note-1', WRITER, false).ok).toBe(true);
    expect(s.notes).toHaveLength(2);
  });

  it('a moderator can take down any note', () => {
    const s = midState();
    expect(canRemoveNote(s.notes[0], OTHER, true)).toBe(true);
    expect(removeNote(s, 'note-1', OTHER, true).ok).toBe(true);
    expect(s.notes).toHaveLength(2);
  });

  it('a stranger who is not a moderator cannot', () => {
    const s = midState();
    expect(canRemoveNote(s.notes[0], OTHER, false)).toBe(false);
    expect(removeNote(s, 'note-1', OTHER, false)).toEqual({ ok: false, reason: 'not-allowed' });
    expect(s.notes).toHaveLength(3);
  });

  it('a blank userId can never be the writer', () => {
    const s = midState();
    expect(canRemoveNote(s.notes[0], '', false)).toBe(false);
    expect(canRemoveNote(s.notes[0], null, false)).toBe(false);
  });

  it('removing a missing note says not-found', () => {
    const s = midState();
    expect(removeNote(s, 'note-nope', WRITER, true)).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('serializeNoteState (wire — anonymous)', () => {
  it('carries no authorId, no authorName, nothing that says who wrote it', () => {
    const s = midState();
    const wire = serializeNoteState(s);
    expect(wire.count).toBe(3);
    expect(JSON.stringify(wire)).not.toContain('authorId');
    expect(JSON.stringify(wire)).not.toContain('authorName');
    expect(JSON.stringify(wire)).not.toContain('addedBy');
    expect(JSON.stringify(wire)).not.toContain(WRITER);
    expect(Object.keys(wire.notes[0]).sort()).toEqual(
      ['createdAt', 'expiresAt', 'id', 'text', 'x', 'y'],
    );
  });

  it('includes expiresAt as createdAt plus 48h', () => {
    const s = midState();
    const wire = serializeNoteState(s);
    expect(wire.notes[0].expiresAt).toBe(NOW + NOTE_TTL_MS);
  });
});

describe('storage serialization + parseNoteState', () => {
  it('the storage shape keeps authorId, and parse restores it', () => {
    const s = midState();
    const stored = serializeNoteStateForStorage(s);
    expect(stored.notes[0].authorId).toBe(WRITER);
    const back = parseNoteState(stored, NOW);
    expect(back.notes.map((n) => n.id)).toEqual(['note-1', 'note-2', 'note-3']);
    expect(back.notes[0].authorId).toBe(WRITER);
  });

  it('parse drops expired notes, malformed entries, and duplicates', () => {
    const raw = {
      notes: [
        note(1, WRITER, NOW),
        note(2, WRITER, NOW - NOTE_TTL_MS - 1000), // expired
        { ...note(3), text: '   ' }, // no usable text
        note(1, WRITER, NOW), // duplicate
        { id: 'note-4', text: 'No author on the wire is fine', x: 1, y: 2, createdAt: NOW },
      ],
    };
    const parsed = parseNoteState(raw, NOW);
    expect(parsed.notes.map((n) => n.id)).toEqual(['note-1', 'note-4']);
    expect(parsed.notes[1].authorId).toBe('');
  });

  it('parse of a bad shape returns an empty state, never throws', () => {
    expect(parseNoteState(null, NOW)).toEqual(createNoteState());
    expect(parseNoteState({}, NOW)).toEqual(createNoteState());
    expect(parseNoteState({ notes: 'nope' }, NOW)).toEqual(createNoteState());
  });
});
