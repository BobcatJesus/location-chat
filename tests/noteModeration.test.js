// noteModeration.test.js — Notes Moderation v1
// (`sq-notes-moderation-v1`).
//
// Two guards for pick-up notes, which are public and anonymous:
//   (1) REPORT + AUTO-HIDE: any player can flag a note (one
//       flag per player; the author cannot flag their own). At
//       NOTE_FLAG_HIDE_THRESHOLD (3, builder default) flags from
//       different players the note hides itself — off the floor,
//       unreadable by non-moderators — until a moderator restores
//       it (flags cleared) or deletes it. The wire state never
//       carries authorId or flaggedBy; the moderator-only flagged
//       list is the one place the author id is ever sent.
//   (2) PERSPECTIVE CHECK: the server refuses hurtful text
//       before it is placed (see perspectiveCheck.test.js). A
//       content refusal is a normal drop refusal on the client:
//       the pending drop clears and NO paper sheet is spent.
//
// These tests cover the pure state (src/village/noteState.js)
// and the client system (src/village/NoteSystem.js). socket.js
// boots a server on import and cannot run in vitest; the handler
// wiring (note_report / note_flagged_list / note_restore, the
// note_drop Perspective check, the boot warning) is verified by
// node --check + code read, same as the jukebox guard.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  NOTE_MODERATION_MARKER,
  NOTE_FLAG_HIDE_THRESHOLD,
  createNoteState,
  dropNote,
  flagNote,
  restoreNote,
  noteFlagCount,
  pruneExpiredNotes,
  serializeNoteState,
  serializeNoteStateForStorage,
  serializeFlaggedNotes,
  parseNoteState,
} from '../src/village/noteState.js';
import { NoteSystem } from '../src/village/NoteSystem.js';
import {
  NOTE_PAPER_PRICE_COINS,
  buyNotePaper,
  notePaperCount,
  _setInventoryForTest,
} from '../src/village/items.js';
import { getCoins } from '../src/village/CoinWallet.js';

const NOW = Date.now();
const WRITER = 'writer@example.com';
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const CAROL = 'carol@example.com';
const MOD = 'tfkelleher3@gmail.com';

function makeLocalStorageStub() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

beforeEach(() => {
  globalThis.localStorage = makeLocalStorageStub();
  _setInventoryForTest({ items: [], hasBag: false });
});

function stateWithNote(overrides = {}) {
  const state = createNoteState();
  const res = dropNote(state, {
    id: 'note-1', text: 'hello there', authorId: WRITER, x: 100, y: 100, createdAt: NOW,
    ...overrides,
  });
  expect(res.ok).toBe(true);
  return state;
}

function makeNoteScene({ emits = [], notices = [], userId = ALICE } = {}) {
  return {
    roomId: 'agora-houston',
    userId,
    socket: { connected: true, emit: (...args) => emits.push(args) },
    player: { gx: 100, gy: 100 },
    onSystemNotice: (msg) => notices.push(msg),
  };
}

// --- flag counting + auto-hide ------------------------------------------------

describe('note moderation: flag counting and auto-hide', () => {
  it('carries the v1 marker and hides at 3 flags from 3 different players', () => {
    expect(NOTE_MODERATION_MARKER).toBe('sq-notes-moderation-v1');
    expect(NOTE_FLAG_HIDE_THRESHOLD).toBe(3);
  });

  it('counts flags and hides the note at the threshold — not before', () => {
    const state = stateWithNote();
    const first = flagNote(state, 'note-1', ALICE);
    expect(first.ok).toBe(true);
    expect(first.flagCount).toBe(1);
    expect(first.hidden).toBe(false);
    expect(state.notes[0].hidden).toBe(false);
    const second = flagNote(state, 'note-1', BOB);
    expect(second.flagCount).toBe(2);
    expect(second.hidden).toBe(false);
    const third = flagNote(state, 'note-1', CAROL);
    expect(third.flagCount).toBe(3);
    expect(third.hidden).toBe(true);
    expect(state.notes[0].hidden).toBe(true);
  });

  it('one flag per player — a second flag from the same player is a no-op', () => {
    const state = stateWithNote();
    expect(flagNote(state, 'note-1', ALICE).ok).toBe(true);
    const again = flagNote(state, 'note-1', ALICE);
    expect(again).toEqual({ ok: false, reason: 'already-flagged' });
    expect(noteFlagCount(state.notes[0])).toBe(1);
  });

  it('the author cannot flag their own note', () => {
    const state = stateWithNote();
    expect(flagNote(state, 'note-1', WRITER)).toEqual({ ok: false, reason: 'own-note' });
    expect(noteFlagCount(state.notes[0])).toBe(0);
    expect(state.notes[0].hidden).toBe(false);
  });

  it('flagging a missing note says so', () => {
    const state = stateWithNote();
    expect(flagNote(state, 'note-nope', ALICE)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('an already-hidden note can still collect flags (more evidence for the moderator)', () => {
    const state = stateWithNote();
    flagNote(state, 'note-1', ALICE);
    flagNote(state, 'note-1', BOB);
    flagNote(state, 'note-1', CAROL);
    expect(state.notes[0].hidden).toBe(true);
    const fourth = flagNote(state, 'note-1', 'dave@example.com');
    expect(fourth.ok).toBe(true);
    expect(fourth.flagCount).toBe(4);
    expect(fourth.hidden).toBe(true);
  });
});

// --- restore ------------------------------------------------------------------

describe('note moderation: restore', () => {
  it('a moderator restores a hidden note — flags cleared, back on the floor, flaggable again', () => {
    const state = stateWithNote();
    flagNote(state, 'note-1', ALICE);
    flagNote(state, 'note-1', BOB);
    flagNote(state, 'note-1', CAROL);
    expect(state.notes[0].hidden).toBe(true);
    const res = restoreNote(state, 'note-1', MOD, true);
    expect(res.ok).toBe(true);
    expect(state.notes[0].hidden).toBe(false);
    expect(noteFlagCount(state.notes[0])).toBe(0);
    // Flagging starts from scratch after a restore.
    expect(flagNote(state, 'note-1', ALICE).flagCount).toBe(1);
    expect(state.notes[0].hidden).toBe(false);
  });

  it('a non-moderator cannot restore', () => {
    const state = stateWithNote();
    flagNote(state, 'note-1', ALICE);
    expect(restoreNote(state, 'note-1', BOB, false)).toEqual({ ok: false, reason: 'not-allowed' });
    expect(noteFlagCount(state.notes[0])).toBe(1);
  });

  it('restoring a missing note says so', () => {
    const state = stateWithNote();
    expect(restoreNote(state, 'note-nope', MOD, true)).toEqual({ ok: false, reason: 'not-found' });
  });
});

// --- anonymity + persistence --------------------------------------------------

describe('note moderation: anonymity and persistence', () => {
  it('the wire state leaves a hidden note out entirely — it cannot be read by non-moderators', () => {
    const state = stateWithNote();
    dropNote(state, { id: 'note-2', text: 'fine note', authorId: WRITER, x: 200, y: 200, createdAt: NOW });
    flagNote(state, 'note-1', ALICE);
    flagNote(state, 'note-1', BOB);
    flagNote(state, 'note-1', CAROL);
    const wire = serializeNoteState(state);
    expect(wire.notes.map((n) => n.id)).toEqual(['note-2']);
    expect(wire.count).toBe(1);
    expect(JSON.stringify(wire)).not.toContain(WRITER);
    expect(JSON.stringify(wire)).not.toContain('flaggedBy');
    expect(JSON.stringify(wire)).not.toContain('hidden');
  });

  it('the wire state never carries authorId or flaggedBy, even for visible flagged notes', () => {
    const state = stateWithNote();
    flagNote(state, 'note-1', ALICE);
    const wire = serializeNoteState(state);
    expect(wire.notes).toHaveLength(1);
    expect(wire.notes[0]).not.toHaveProperty('authorId');
    expect(wire.notes[0]).not.toHaveProperty('flaggedBy');
    expect(wire.notes[0]).not.toHaveProperty('hidden');
  });

  it('storage keeps authorId, flaggedBy and hidden — a restart never un-hides a flagged note', () => {
    const state = stateWithNote();
    flagNote(state, 'note-1', ALICE);
    flagNote(state, 'note-1', BOB);
    flagNote(state, 'note-1', CAROL);
    const stored = serializeNoteStateForStorage(state);
    const reloaded = parseNoteState(stored);
    expect(reloaded.notes[0].hidden).toBe(true);
    expect(reloaded.notes[0].flaggedBy).toEqual([ALICE, BOB, CAROL]);
    expect(reloaded.notes[0].authorId).toBe(WRITER);
    // And the reloaded state still hides it from the wire.
    expect(serializeNoteState(reloaded).notes).toHaveLength(0);
  });

  it('the moderator-only flagged list shows text, flag count, hidden state and author id — and only flagged notes', () => {
    const state = stateWithNote();
    dropNote(state, { id: 'note-2', text: 'fine note', authorId: WRITER, x: 200, y: 200, createdAt: NOW });
    flagNote(state, 'note-1', ALICE);
    const list = serializeFlaggedNotes(state, 'agora-houston');
    expect(list.roomId).toBe('agora-houston');
    expect(list.count).toBe(1);
    expect(list.notes[0]).toMatchObject({
      id: 'note-1', text: 'hello there', authorId: WRITER, flagCount: 1, hidden: false,
    });
    expect(list.notes[0]).toHaveProperty('expiresAt');
  });

  it('the flagged list puts the most-flagged note first', () => {
    const state = stateWithNote();
    dropNote(state, { id: 'note-2', text: 'second', authorId: WRITER, x: 200, y: 200, createdAt: NOW });
    flagNote(state, 'note-2', ALICE);
    flagNote(state, 'note-2', BOB);
    flagNote(state, 'note-1', ALICE);
    const list = serializeFlaggedNotes(state, 'agora-houston');
    expect(list.notes.map((n) => n.id)).toEqual(['note-2', 'note-1']);
  });

  it('expiry still prunes a hidden note — a flagged note does not live forever', () => {
    const state = createNoteState();
    dropNote(state, { id: 'note-old', text: 'old', authorId: WRITER, x: 100, y: 100, createdAt: NOW - 49 * 60 * 60 * 1000 });
    flagNote(state, 'note-old', ALICE);
    flagNote(state, 'note-old', BOB);
    flagNote(state, 'note-old', CAROL);
    expect(state.notes[0].hidden).toBe(true);
    expect(pruneExpiredNotes(state, NOW)).toBe(1);
    expect(state.notes).toHaveLength(0);
  });
});

// --- client: reporting ----------------------------------------------------------

describe('note moderation: reporting through NoteSystem', () => {
  it('reportNote emits note_report and the answer marks it reported', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ emits, notices }));
    notes.applyState({
      notes: [{ id: 'note-1', text: 'hello', x: 100, y: 100, createdAt: NOW, expiresAt: NOW + 100000 }],
      now: NOW,
    });
    const res = notes.reportNote('note-1');
    expect(res).toEqual({ ok: true, pending: true });
    expect(emits).toEqual([['note_report', { roomId: 'agora-houston', noteId: 'note-1' }]]);
    notes.onReportResult({ noteId: 'note-1', ok: true, hidden: false, flagCount: 1 });
    expect(notes.getState().notes[0].reported).toBe(true);
    expect(notices).toEqual(['🚩 Reported — a moderator will take a look.']);
  });

  it('a report that auto-hides the note says so', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ emits, notices }));
    notes.applyState({
      notes: [{ id: 'note-1', text: 'hello', x: 100, y: 100, createdAt: NOW, expiresAt: NOW + 100000 }],
      now: NOW,
    });
    notes.reportNote('note-1');
    notes.onReportResult({ noteId: 'note-1', ok: true, hidden: true, flagCount: 3 });
    expect(notices).toEqual([
      '🚩 Reported — enough flags hid this note until a moderator looks at it.',
    ]);
  });

  it('a second report from the same profile is refused client-side with no second emit', () => {
    const emits = [];
    const notes = new NoteSystem(makeNoteScene({ emits }));
    notes.applyState({
      notes: [{ id: 'note-1', text: 'hello', x: 100, y: 100, createdAt: NOW, expiresAt: NOW + 100000 }],
      now: NOW,
    });
    notes.reportNote('note-1');
    notes.onReportResult({ noteId: 'note-1', ok: true, hidden: false, flagCount: 1 });
    expect(notes.reportNote('note-1')).toEqual({ ok: false, reason: 'already-flagged' });
    expect(emits).toHaveLength(1);
  });

  it('reporting your own note is refused with nothing emitted', () => {
    const emits = [];
    const notes = new NoteSystem(makeNoteScene({ emits, userId: WRITER }));
    // The writer's own note: _myNoteIds only fills on a settle, so
    // seed it the way a landed drop does.
    notes._myNoteIds.add('note-1');
    notes.applyState({
      notes: [{ id: 'note-1', text: 'hello', x: 100, y: 100, createdAt: NOW, expiresAt: NOW + 100000 }],
      now: NOW,
    });
    expect(notes.reportNote('note-1')).toEqual({ ok: false, reason: 'own-note' });
    expect(emits).toHaveLength(0);
  });

  it('a refused report explains itself', () => {
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ notices }));
    notes.onReportResult({ noteId: 'note-1', ok: false, reason: 'already-flagged' });
    expect(notices).toEqual(['🚩 You already reported this note.']);
  });
});

// --- client: flagged list + restore ----------------------------------------------

describe('note moderation: flagged list and restore through NoteSystem', () => {
  it('requestFlaggedList emits, and the answer is kept out of the floor state', () => {
    const emits = [];
    const notes = new NoteSystem(makeNoteScene({ emits }));
    const res = notes.requestFlaggedList();
    expect(res).toEqual({ ok: true, pending: true });
    expect(emits).toEqual([['note_flagged_list', { roomId: 'agora-houston' }]]);
    notes.onFlaggedListResult({
      ok: true,
      roomId: 'agora-houston',
      notes: [{ id: 'note-1', text: 'bad', authorId: WRITER, flagCount: 3, hidden: true, createdAt: NOW, expiresAt: NOW + 100000 }],
    });
    const flagged = notes.getFlaggedState();
    expect(flagged.count).toBe(1);
    expect(flagged.notes[0]).toMatchObject({ id: 'note-1', authorId: WRITER, flagCount: 3, hidden: true });
    // The floor state never sees the flagged list's author ids.
    expect(notes.getState().notes).toHaveLength(0);
  });

  it('restoreFlaggedNote emits note_restore and re-requests the list on success', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ emits, notices }));
    expect(notes.restoreFlaggedNote('note-1')).toEqual({ ok: true, pending: true });
    expect(emits).toEqual([['note_restore', { roomId: 'agora-houston', noteId: 'note-1' }]]);
    notes.onRestoreResult({ noteId: 'note-1', ok: true });
    expect(emits).toHaveLength(2);
    expect(emits[1][0]).toBe('note_flagged_list');
    expect(notices).toEqual(['🚩 Note restored — it’s back on the floor.']);
  });

  it('a refused restore explains itself', () => {
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ notices }));
    notes.onRestoreResult({ noteId: 'note-1', ok: false, reason: 'not-allowed' });
    expect(notices).toEqual(['🚩 Only a moderator can restore a note.']);
  });
});

// --- content refusal never spends paper -------------------------------------------

describe('note moderation: a content refusal does not spend a paper sheet', () => {
  it('the pending drop clears, the sheet stays, and the refusal words are shown', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ emits, notices }));
    const before = getCoins(); // fresh stub: 10
    expect(buyNotePaper().ok).toBe(true);
    expect(getCoins()).toBe(before - NOTE_PAPER_PRICE_COINS);
    expect(notePaperCount()).toBe(3);

    const drop = notes.dropNote('something hurtful');
    expect(drop.ok).toBe(true);
    expect(drop.pending).toBe(true);
    expect(emits).toHaveLength(1);
    expect(emits[0][0]).toBe('note_drop');

    // The server's Perspective refusal — same path as every other
    // drop refusal. The sheet is spent ONLY on a server confirm
    // (_settleDropTarget), which never runs here.
    notes.onDropResult({
      id: drop.id,
      ok: false,
      reason: 'content-refused',
      message: 'That note looks hurtful — try writing something kinder.',
    });
    expect(notePaperCount()).toBe(3);
    // The server's exact refusal words are shown verbatim (no
    // 📝 prefix added — the server owns the wording).
    expect(notices).toEqual(['That note looks hurtful — try writing something kinder.']);
    // And the pending drop is gone, so the next note can be left.
    expect(notes.dropNote('something kind').ok).toBe(true);
  });
});
