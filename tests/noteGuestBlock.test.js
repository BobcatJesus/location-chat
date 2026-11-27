// noteGuestBlock.test.js — Notes Guest Block v1
// (`sq-notes-guest-block-v1`).
//
// Guests cannot leave notes — only signed-in players can. A guest
// is a player whose join payload has NO email (never a string
// heuristic on the userId). Guests can still READ notes; only
// writing is blocked. The exact words a guest is told are the
// user's own: "you need an account before you can post notes".
//
// These tests cover the pure guest detection (noteState.js), the
// client drop gate (NoteSystem.dropNote), the server refusal
// spending no paper (via onDropResult), and the pocket panel
// showing the guest message instead of the write form
// (InventoryPanel, rendered with react-dom/server — the same
// pattern as mailboxV11.test.js). socket.js boots a server on
// import and cannot run in vitest, so the server wiring (the
// socketIsGuest map set at join, cleared on disconnect, and the
// note_drop guest refusal first) is verified by node --check +
// code read, same as the jukebox guard and the strikes kit.

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  NOTE_GUEST_BLOCK_MARKER,
  GUEST_NOTE_MESSAGE,
  isGuestProfile,
} from '../src/village/noteState.js';
import { NoteSystem } from '../src/village/NoteSystem.js';
import {
  buyNotePaper,
  notePaperCount,
  _setInventoryForTest,
} from '../src/village/items.js';
import InventoryPanel from '../src/village/InventoryPanel.jsx';

const GUEST_WORDS = 'you need an account before you can post notes';
const ALICE = 'alice@example.com';

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

// The scene the client really has: VillageScene always carries a
// profile object (this.profile = d.profile ?? {}), so a guest is
// a profile with no email. A test stub with NO profile property
// at all fails OPEN (isGuestProfile returns false) — the server
// is the real gate.
function makeNoteScene({ emits = [], notices = [], profile } = {}) {
  const scene = {
    roomId: 'agora-houston',
    socket: { connected: true, emit: (...args) => emits.push(args) },
    player: { gx: 100, gy: 100 },
    onSystemNotice: (msg) => notices.push(msg),
  };
  if (profile !== undefined) scene.profile = profile;
  return scene;
}

describe('guest detection (noteState.js)', () => {
  it('the marker is the kit marker', () => {
    expect(NOTE_GUEST_BLOCK_MARKER).toBe('sq-notes-guest-block-v1');
  });

  it('the message is the user\u2019s exact words', () => {
    expect(GUEST_NOTE_MESSAGE).toBe(GUEST_WORDS);
  });

  it('a profile with no email is a guest', () => {
    expect(isGuestProfile({})).toBe(true);
    expect(isGuestProfile({ profile: {} })).toBe(true);
    expect(isGuestProfile({ profile: { email: '' } })).toBe(true);
    expect(isGuestProfile({ profile: { email: '   ' } })).toBe(true);
    expect(isGuestProfile({ mode: 'guest' })).toBe(true);
  });

  it('a profile with an email is not a guest', () => {
    expect(isGuestProfile({ profile: { email: ALICE } })).toBe(false);
    expect(isGuestProfile({ profile: { email: '  alice@example.com  ' } })).toBe(false);
  });

  it('a missing profile object fails open (test stubs only)', () => {
    expect(isGuestProfile(undefined)).toBe(false);
    expect(isGuestProfile(null)).toBe(false);
    expect(isGuestProfile('guest')).toBe(false);
  });
});

describe('NoteSystem: guest drop gate', () => {
  it('a guest cannot drop — nothing is emitted, the notice is the exact words', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ emits, notices, profile: {} }));
    // Give them paper, so the refusal is the guest gate and not the paper gate.
    buyNotePaper();
    expect(notePaperCount()).toBe(3);
    const res = notes.dropNote('hello there');
    expect(res).toEqual({ ok: false, reason: 'guest' });
    expect(emits).toEqual([]);
    expect(notices.join(' ')).toContain(GUEST_WORDS);
    // No sheet spent — the gate returns before the paper check.
    expect(notePaperCount()).toBe(3);
  });

  it('a guest-mode profile is a guest too', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({ emits, notices, profile: { mode: 'guest' } }));
    buyNotePaper();
    const res = notes.dropNote('hello there');
    expect(res).toEqual({ ok: false, reason: 'guest' });
    expect(emits).toEqual([]);
  });

  it('a signed-in player can still drop a note (no regression)', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({
      emits, notices, profile: { profile: { email: ALICE } },
    }));
    buyNotePaper();
    expect(notePaperCount()).toBe(3);
    const res = notes.dropNote('hello there');
    expect(res.ok).toBe(true);
    expect(res.pending).toBe(true);
    expect(emits).toHaveLength(1);
    expect(emits[0][0]).toBe('note_drop');
  });

  it('a server guest refusal clears the pending drop and spends NO paper', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({
      emits, notices, profile: { profile: { email: ALICE } },
    }));
    buyNotePaper();
    expect(notePaperCount()).toBe(3);
    const dropped = notes.dropNote('hello there');
    expect(dropped.ok).toBe(true);
    expect(dropped.pending).toBe(true);
    expect(emits).toHaveLength(1);
    const pendingId = dropped.id;
    // The server refuses as guest (the client state was stale, or
    // a bad client skipped the gate) — same refusal path as every
    // other drop refusal: the pending drop clears, no sheet spent.
    notes.onDropResult({
      id: pendingId, ok: false, reason: 'guest', message: GUEST_NOTE_MESSAGE,
    });
    expect(notices.join(' ')).toContain(GUEST_WORDS);
    expect(notePaperCount()).toBe(3);
    // And the player can try again right away — the pending drop is gone.
    const retry = notes.dropNote('second try');
    expect(retry.ok).toBe(true);
    expect(retry.pending).toBe(true);
  });

  it('a server guest refusal without a message still shows the exact words', () => {
    const emits = [];
    const notices = [];
    const notes = new NoteSystem(makeNoteScene({
      emits, notices, profile: { profile: { email: ALICE } },
    }));
    buyNotePaper();
    const dropped = notes.dropNote('hello there');
    notes.onDropResult({ id: dropped.id, ok: false, reason: 'guest' });
    expect(notices.join(' ')).toContain(GUEST_WORDS);
  });
});

describe('InventoryPanel: guest sees the message, not the form', () => {
  function panelState(overrides = {}) {
    return {
      items: [], count: 0, capacity: 3, hasBag: false, coins: 0, full: false,
      mailboxCode: 'ABCDE', mailboxRoomId: 'shepherd-park', mailboxRoomName: 'Shepherd Park',
      mailUnread: 0, isMailboxRoom: false, hasMailboxKey: true,
      decorNotice: '', decorNoticeSeq: 0, hatNotice: '', hatNoticeSeq: 0,
      mailNotice: '', mailNoticeSeq: 0,
      roomId: 'agora-houston', atHome: false, canDispose: false,
      canHatCat: false, canFeedDucks: false, canFeedCat: false,
      ...overrides,
    };
  }

  function renderPanel(state, props = {}) {
    return renderToStaticMarkup(
      React.createElement(InventoryPanel, {
        getState: () => state,
        getBadges: () => [],
        getNoteStatus: () => null,
        onRequestNoteStatus: () => ({}),
        onClose: () => {},
        ...props,
      }),
    );
  }

  it('a guest sees the exact message and no write-a-note button or form', () => {
    const html = renderPanel(panelState(), { isGuest: true });
    expect(html).toContain(GUEST_WORDS);
    expect(html).not.toContain('Write a note');
    expect(html).not.toContain('Leave a note for whoever finds it');
  });

  it('a signed-in player still sees the write-a-note button, not the guest message', () => {
    const html = renderPanel(panelState(), { isGuest: false });
    expect(html).toContain('Write a note');
    expect(html).not.toContain(GUEST_WORDS);
  });

  it('the prop defaults to signed-in when omitted', () => {
    const html = renderPanel(panelState());
    expect(html).toContain('Write a note');
    expect(html).not.toContain(GUEST_WORDS);
  });
});
