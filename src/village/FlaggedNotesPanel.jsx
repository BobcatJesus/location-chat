// FlaggedNotesPanel.jsx — the moderator-only review list for
// pick-up notes (`sq-notes-moderation-v1`).
//
// Opens from the menu's "🚩 Flagged" button (VillageCanvas,
// moderators only). It lists every note in THIS room that has
// been flagged at least once, or is hidden — most-flagged first.
// Each row shows the note text, the room, the flag count, and
// the author id. The author id is shown to moderators ONLY:
// the whole panel is moderator-only, and the list comes from the
// server's moderator-gated note_flagged_list answer — the wire
// state never carries it, and a non-moderator can never open
// this panel or fetch the list.
//
// Each row has two actions, both re-checked by the server:
//   Restore — clears every flag and unhides the note, so it is
//     back on the floor and can be flagged again from scratch.
//   Take down — the same moderator-gated note_delete as the read
//     popup; the note is gone for good.
//   Take down + strike (`sq-notes-strikes-v1`) — the same take
//     down, AND a strike against the note's author. Graduated and
//     moderator-decided, never automatic: strike 1 is a warning,
//     strike 2 mutes note-writing for 24h, strike 3+ for 7 days.
//     The button asks twice (a strike is a real consequence), and
//     each row shows the author's ACTIVE strike count so the
//     moderator can see a repeat offender before deciding.
//   Clear strikes — forgive / undo: wipes every strike for that
//     author (and lifts any mute at once).
// The list re-requests itself every few seconds while open, so a
// row disappears at once after a restore or a delete, and a note
// someone else just flagged shows up without reopening.
//
// Props:
//   getState() — () => { notes, count, roomId, roomName }
//     (NoteSystem.getFlaggedState)
//   onRefresh() — re-asks the server for the list
//     (NoteSystem.requestFlaggedList)
//   onRestore(noteId) — returns { ok, reason? }
//     (NoteSystem.restoreFlaggedNote)
//   onDelete(noteId) — returns { ok, reason? }
//     (NoteSystem.deleteNote)
//   onStrike(noteId) — returns { ok, reason? }
//     (NoteSystem.strikeNote; `sq-notes-strikes-v1`)
//   onClearStrikes(playerId) — returns { ok, reason? }
//     (NoteSystem.clearStrikes; `sq-notes-strikes-v1`)
//   roomName — the room this list is for
//   onClose()

import React, { useEffect, useState } from 'react';

export default function FlaggedNotesPanel({ getState, onRefresh, onRestore, onDelete, onStrike, onClearStrikes, roomName, onClose }) {
  const [state, setState] = useState(() => {
    try { return getState ? getState() : null; } catch { return null; }
  });
  const [notice, setNotice] = useState('');
  // sq-notes-strikes-v1: the note id whose strike button is
  // armed — a strike is a real consequence, so the button asks
  // twice (first tap arms it, second tap strikes).
  const [confirmStrikeId, setConfirmStrikeId] = useState(null);

  useEffect(() => {
    try { onRefresh?.(); } catch {}
    const poll = setInterval(() => {
      try {
        const next = getState ? getState() : null;
        if (next) setState(next);
      } catch {}
    }, 500);
    // Re-ask the server every few seconds while open, so a row
    // disappears at once after a restore or a delete, and a note
    // someone else just flagged shows up without reopening.
    const refetch = setInterval(() => {
      try { onRefresh?.(); } catch {}
    }, 3000);
    return () => { clearInterval(poll); clearInterval(refetch); };
  }, [getState, onRefresh]);

  const refresh = () => {
    try {
      const next = getState ? getState() : null;
      if (next) setState(next);
    } catch {}
  };

  const runRestore = (noteId) => {
    let res = { ok: false, reason: 'error' };
    try { res = onRestore ? onRestore(noteId) : res; } catch { res = { ok: false, reason: 'error' }; }
    if (res && res.ok) {
      setNotice('Restoring it — it will be back on the floor.');
      refresh();
      return;
    }
    setNotice(res?.reason === 'not-allowed'
      ? 'Only a moderator can restore a note.'
      : 'That note is already gone.');
    refresh();
  };

  const runDelete = (noteId) => {
    let res = { ok: false, reason: 'error' };
    try { res = onDelete ? onDelete(noteId) : res; } catch { res = { ok: false, reason: 'error' }; }
    if (res && res.ok) {
      setNotice('Taking it down…');
      refresh();
      return;
    }
    setNotice('That note is already gone.');
    refresh();
  };

  // Notes Strike System v1 (`sq-notes-strikes-v1`): take the
  // note down AND strike its author. Two taps — the first arms
  // the button ("Strike them?"), the second strikes. A strike is
  // a real consequence: strike 1 is a warning, strike 2 mutes
  // note-writing for 24h, strike 3+ for 7 days. The server
  // removes the note first, so a strike can never land on a note
  // that is already gone, and refuses striking yourself.
  const runStrike = (noteId) => {
    if (confirmStrikeId !== noteId) {
      setConfirmStrikeId(noteId);
      setNotice('Tap again to strike — this takes the note down and records a strike against its author.');
      return;
    }
    setConfirmStrikeId(null);
    let res = { ok: false, reason: 'error' };
    try { res = onStrike ? onStrike(noteId) : res; } catch { res = { ok: false, reason: 'error' }; }
    if (res && res.ok) {
      setNotice('Taking it down and recording the strike…');
      refresh();
      return;
    }
    setNotice(res?.reason === 'not-allowed'
      ? 'Only a moderator can strike a note.'
      : res?.reason === 'own-note'
        ? 'You can’t strike your own note.'
        : 'That note is already gone.');
    refresh();
  };

  // Notes Strike System v1 (`sq-notes-strikes-v1`): forgive /
  // undo — wipe every strike for this author (and lift any mute
  // at once). One tap: a clear is a clean slate, not a
  // punishment, so it does not ask twice.
  const runClearStrikes = (authorId) => {
    let res = { ok: false, reason: 'error' };
    try { res = onClearStrikes ? onClearStrikes(authorId) : res; } catch { res = { ok: false, reason: 'error' }; }
    if (res && res.ok) {
      setNotice('Clearing their strikes…');
      refresh();
      return;
    }
    setNotice(res?.reason === 'not-allowed'
      ? 'Only a moderator can clear strikes.'
      : 'The strikes couldn’t be cleared — try again.');
    refresh();
  };

  const notes = state?.notes || [];

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 1100,
        background: 'rgba(15,23,42,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 12,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff7e6', color: '#1a4971', borderRadius: 12,
          padding: 16, width: 'min(480px, calc(100vw - 24px))',
          maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 'bold', fontSize: 18 }}>
            🚩 Flagged notes
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid #1a4971', borderRadius: 6,
              color: '#1a4971', cursor: 'pointer', fontSize: 14, padding: '4px 10px',
            }}
          >
            Close ✕
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 4 }}>
          {roomName ? `Room: ${roomName}` : 'This room'} · moderators only
        </div>

        {notes.length === 0 ? (
          <div style={{ fontSize: 13, color: '#3d6a8a', marginTop: 12 }}>
            No flagged notes in this room — nothing to review.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {notes.map((note) => (
              <div
                key={note.id}
                style={{
                  padding: 12, borderRadius: 8, background: '#fffdf5',
                  border: '1px solid #e2b46c',
                }}
              >
                <div style={{
                  fontSize: 14, lineHeight: 1.5, color: '#3d2c14',
                  whiteSpace: 'pre-line',
                }}>
                  {note.text}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                  🚩 {note.flagCount} {note.flagCount === 1 ? 'flag' : 'flags'}
                  {note.hidden ? ' · hidden from the floor' : ' · still on the floor'}
                  {' · by: '}{note.authorId || '(unknown)'}
                  {/* sq-notes-strikes-v1: the author's ACTIVE
                      strike count (moderators only) — a repeat
                      offender shows up here before you decide. */}
                  {Number(note.strikeCount) > 0 && (
                    <> · ⚠️ {note.strikeCount} active {note.strikeCount === 1 ? 'strike' : 'strikes'}</>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => runRestore(note.id)} style={btnStyle}>
                    Restore
                  </button>
                  <button
                    onClick={() => runDelete(note.id)}
                    style={{ ...btnStyle, background: 'transparent', color: '#92400e', border: '1px solid #92400e' }}
                  >
                    Take down
                  </button>
                  <button
                    onClick={() => runStrike(note.id)}
                    style={{
                      ...btnStyle,
                      background: confirmStrikeId === note.id ? '#92400e' : 'transparent',
                      color: confirmStrikeId === note.id ? '#fff' : '#92400e',
                      border: '1px solid #92400e',
                    }}
                  >
                    {confirmStrikeId === note.id ? 'Strike them?' : 'Take down + strike'}
                  </button>
                  {Number(note.strikeCount) > 0 && note.authorId && (
                    <button
                      onClick={() => runClearStrikes(note.authorId)}
                      style={{ ...btnStyle, background: 'transparent', color: '#1a4971', border: '1px solid #1a4971' }}
                    >
                      Clear strikes
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {notice && (
          <div style={{ fontSize: 13, marginTop: 10, color: '#92400e' }}>{notice}</div>
        )}

        <div style={{ fontSize: 12, marginTop: 12, color: '#64748b' }}>
          Restore clears every flag and puts the note back on the
          floor — it can be flagged again from scratch. Take down
          removes it for good. Take down + strike does the same
          and records a strike against its author: strike 1 is a
          warning, strike 2 stops them leaving notes for 24
          hours, strike 3+ for 7 days. Strikes expire after 30
          days. Clear strikes forgives them all at once. Flagged
          notes still fade after 48 hours even if nobody reviews
          them.
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  background: '#1a4971', color: '#fff', border: 'none', borderRadius: 6,
  padding: '6px 12px', cursor: 'pointer', fontSize: 13,
};
