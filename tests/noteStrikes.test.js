// noteStrikes.test.js — Notes Strike System v1
// (`sq-notes-strikes-v1`).
//
// Graduated strikes, moderator-decided, NEVER automatic:
// auto-hide (3 flags) hides a note but does NOT strike its
// author. Strike 1 is a warning (no mute); strike 2 mutes
// note-writing for 24h; strike 3+ for 7 days; strikes expire
// after 30 days. The mute is note-writing ONLY.
//
// These tests cover the pure flagged-list strike count
// (src/village/noteState.js) and the client system
// (src/village/NoteSystem.js): the mute gate on drop, the muted
// refusal spending no paper, the strike / clear / status
// round-trips, and the strike notice. socket.js boots a server
// on import and cannot run in vitest; the handler wiring
// (note_strike / note_clear_strikes / get_my_note_status, the
// note_drop mute enforcement, the flagged-list strike counts)
// is verified by node --check + code read, same as the jukebox
// guard. The pure mute math is in strikeState.test.js and the
// persistence round-trip in strikePersist.test.js.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  NOTE_STRIKES_MARKER,
  createNoteState,
  dropNote,
  flagNote,
  serializeFlaggedNotes,
} from '../src/village/noteState.js';
import { NoteSystem } from '../src/village/NoteSystem.js';
import {
  NOTE_PAPER_PRICE_COINS,
  buyNotePaper,
  notePaperCount,
  _setInventoryForTest,
} from '../src/village/items.js';
import { getCoins } from '../src/village/CoinWallet.js';

const NOW = 1800000000000; // fixed "now" — in the future vs the real clock, so mutes hold
const DAY = 24 * 60 * 60 * 1000;
const WRITER = 'writer@example.com';
const TROLL = 'troll@example.com';
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

function makeNoteScene({ emits = [], notices = [], userId = ALICE } = {}) {
  return {
    roomId: 'agora-houston',
    userId,
    socket: { connected: true, emit: (...args) => emits.push(args) },
    player: { gx: 100, gy: 100 },
    onSystemNotice: (msg) => notices.push(msg),
  };
}

function stateWithFlaggedNote() {
  const state = createNoteState();
  const res = dropNote(state, {
    id: 'note-1', text: 'be mean', authorId: TROLL, x: 100, y: 100, createdAt: NOW,
  });
  expect(res.ok).toBe(true);
  return state;
}

// --- flagged list carries the author strike count ---------------------------

describe('flagged list: author strike count', () => {
  it('carries the strikes marker and defaults strikeCount to 0 without a map', () => {
    expect(NOTE_STRIKES_MARKER).toBe('sq-notes-strikes-v1');
    const state = stateWithFlaggedNote();
    flagNote(state, 'note-1', ALICE);
    const list = serializeFlaggedNotes(state, 'agora-houston');
    expect(list.notes).toHaveLength(1);
    expect(list.notes[0].strikeCount).toBe(0);
    expect(list.notes[0].authorId).toBe(TROLL);
  });

  it('fills strikeCount from the map, per author', () => {
    const state = stateWithFlaggedNote();
    dropNote(state, {
      id: 'note-2', text: 'also mean', authorId: WRITER, x: 120, y: 120, createdAt: NOW,
    });
    flagNote(state, 'note-1', ALICE);
    flagNote(state, 'note-2', BOB);
    const list = serializeFlaggedNotes(state, 'agora-houston', { [TROLL]: 2, [WRITER]: 0 });
    const byId = Object.fromEntries(list.notes.map((n) => [n.id, n]));
    expect(byId['note-1'].strikeCount).toBe(2);
    expect(byId['note-2'].strikeCount).toBe(0);
  });

  it('auto-hide does NOT create a strike — flagging alone records nothing about strikes', () => {
    // The pure flag path knows nothing about strikes: hiding a
    // note at the threshold records no strike anywhere. A strike
    // is only recorded by the moderator-only note_strike event
    // (socket.js, code-read verified) — never by note_report.
    const state = stateWithFlaggedNote();
    for (const who of [ALICE, BOB, CAROL]) {
      expect(flagNote(state, 'note-1', who).ok).toBe(true);
    }
    expect(state.notes[0].hidden).toBe(true);
    expect(state.notes[0]).not.toHaveProperty('strike');
    expect(state.notes[0]).not.toHaveProperty('strikes');
    expect(serializeFlaggedNotes(state, 'agora-houston').notes[0].strikeCount).toBe(0);
  });
});

// --- client: my mute status --------------------------------------------------

describe('NoteSystem: my note status', () => {
  it('starts null, stores the server answer, and reports the mute plainly', () => {
    const notes = new NoteSystem(makeNoteScene({}));
    expect(notes.getMyNoteStatus()).toBeNull();
    notes.onMyNoteStatusResult({ ok: true, muted: true, mutedUntil: NOW + DAY, activeCount: 2 });
    const status = notes.getMyNoteStatus();
    expect(status.muted).toBe(true);
    expect(status.mutedUntil).toBe(NOW + DAY);
    expect(status.activeCount).toBe(2);
    expect(Number(status.now)).toBeGreaterThan(0);
  });

  it('a malformed answer clears the status, so a stale mute can never linger', () => {
    const notes = new NoteSystem(makeNoteScene({}));
    notes.onMyNoteStatusResult({ ok: true, muted: true, mutedUntil: NOW + DAY, activeCount: 2 });
    expect(notes.getMyNoteStatus().muted).toBe(true);
    notes.onMyNoteStatusResult({ ok: false, reason: 'error' });
    expect(notes.getMyNoteStatus()).toBeNull();
  });

  it('a mute whose window already passed reads as not muted', () => {
    const notes = new NoteSystem(makeNoteScene({}));
    // mutedUntil in the real past: the 24h window ran out, even
    // though the strikes still count until they expire.
    notes.onMyNoteStatusResult({ ok: true, muted: true, mutedUntil: Date.now() - 1000, activeCount: 2 });
    expect(notes.getMyNoteStatus().muted).toBe(false);
  });

  it('requestMyNoteStatus emits get_my_note_status', () => {
    const emits = [];
    const notes = new NoteSystem(makeNoteScene({ emits }));
    expect(notes.requestMyNoteStatus()).toEqual({ ok: true, pending: true });
    expect(emits).toEqual([['get_my_note_status', {}]]);
  });
});

// --- client: the drop gate + muted refusal -----------------------------------

describe('NoteSystem: muted drop', () => {
  it('a muted player cannot drop — nothing is emitted, the notice names the wait', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ emits, notices }));
    // Muted until 3 days from the REAL clock (the label is judged
    // against real time, not the fixed NOW above).
    notes.onMyNoteStatusResult({ ok: true, muted: true, mutedUntil: Date.now() + 3 * DAY, activeCount: 2 });
    // Give them paper, so the refusal is the mute and not the paper gate.
    _setInventoryForTest({ items: [], hasBag: false });
    buyNotePaper();
    expect(notePaperCount()).toBe(3);
    const res = notes.dropNote('hello there');
    expect(res).toEqual({ ok: false, reason: 'muted' });
    expect(emits).toEqual([]);
    expect(notices.join(' ')).toMatch(/can't leave notes right now/);
    expect(notices.join(' ')).toMatch(/3 days/);
    expect(notePaperCount()).toBe(3);
  });

  it('a server muted refusal clears the pending drop and spends NO paper', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ emits, notices }));
    _setInventoryForTest({ items: [], hasBag: false });
    buyNotePaper();
    expect(notePaperCount()).toBe(3);
    const dropped = notes.dropNote('hello there');
    expect(dropped.ok).toBe(true);
    expect(dropped.pending).toBe(true);
    expect(emits).toHaveLength(1);
    expect(emits[0][0]).toBe('note_drop');
    const pendingId = dropped.id;
    // The server refuses as muted (the mute landed after the
    // client checked, or the client state was stale).
    notes.onDropResult({
      id: pendingId, ok: false, reason: 'muted',
      message: "📝 You can't leave notes right now — your notes were removed for breaking the rules. Try again in ~2 days.",
      mutedUntil: NOW + 2 * DAY,
    });
    expect(notices.join(' ')).toMatch(/can't leave notes right now/);
    expect(notePaperCount()).toBe(3);
    // And the pending drop is gone — a retry does not hit
    // 'already-pending'.
    const retry = notes.dropNote('second try');
    expect(retry.reason).not.toBe('already-pending');
  });

  it('an unmuted player drops normally (the gate does not block honest notes)', () => {
    const emits = [];
    const notes = new NoteSystem(makeNoteScene({ emits }));
    notes.onMyNoteStatusResult({ ok: true, muted: false, mutedUntil: 0, activeCount: 1 });
    _setInventoryForTest({ items: [], hasBag: false });
    buyNotePaper();
    const res = notes.dropNote('hello there');
    expect(res.ok).toBe(true);
    expect(emits[0][0]).toBe('note_drop');
  });
});

// --- client: strike / clear / notice round-trips ------------------------------

describe('NoteSystem: strike and clear round-trips', () => {
  it('strikeNote emits note_strike; the answer re-requests the flagged list', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ emits, notices }));
    expect(notes.strikeNote('note-1')).toEqual({ ok: true, pending: true });
    expect(emits).toEqual([['note_strike', { roomId: 'agora-houston', noteId: 'note-1' }]]);
    notes.onStrikeResult({ noteId: 'note-1', ok: true, strikeCount: 2, muted: true, mutedUntil: NOW + DAY });
    expect(notices.join(' ')).toMatch(/strike 2/);
    expect(notices.join(' ')).toMatch(/24 hours/);
    expect(emits.some((e) => e[0] === 'note_flagged_list')).toBe(true);
  });

  it('a refused strike says why (not a moderator / own note / already gone)', () => {
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ notices }));
    notes.onStrikeResult({ noteId: 'note-1', ok: false, reason: 'not-allowed' });
    expect(notices.join(' ')).toMatch(/Only a moderator can strike/);
    notes.onStrikeResult({ noteId: 'note-1', ok: false, reason: 'own-note' });
    expect(notices.join(' ')).toMatch(/can’t strike your own note/);
  });

  it('clearStrikes emits note_clear_strikes; the answer re-requests the flagged list', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ emits, notices }));
    expect(notes.clearStrikes(TROLL)).toEqual({ ok: true, pending: true });
    expect(emits).toEqual([['note_clear_strikes', { playerId: TROLL }]]);
    notes.onClearStrikesResult({ playerId: TROLL, ok: true, cleared: 2 });
    expect(notices.join(' ')).toMatch(/Strikes cleared/);
    expect(emits.some((e) => e[0] === 'note_flagged_list')).toBe(true);
  });

  it('the strike notice shows the server’s exact words and refreshes my status', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ emits, notices }));
    notes.onStrikeNotice({
      noteId: 'note-1', strikeCount: 1, muted: false, mutedUntil: 0,
      message: '⚠️ A moderator removed one of your notes for breaking the rules. That’s strike 1 — a warning.',
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/strike 1/);
    expect(emits.some((e) => e[0] === 'get_my_note_status')).toBe(true);
  });

  it('a cleared-strikes notice shows the cleared words', () => {
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ notices }));
    notes.onStrikeNotice({
      cleared: true, strikeCount: 0, muted: false, mutedUntil: 0,
      message: '✅ Your note strikes were cleared — you can leave notes again.',
    });
    expect(notices[0]).toMatch(/cleared/);
    expect(notices[0]).toMatch(/leave notes again/);
  });

  it('a strike notice with no message shows nothing (the server owns the wording)', () => {
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ notices }));
    notes.onStrikeNotice({ noteId: 'note-1', strikeCount: 1 });
    expect(notices).toEqual([]);
  });
});
