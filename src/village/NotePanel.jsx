// NotePanel.jsx — the pick-up note read popup (Pick-Up Notes v1,
// `sq-pickup-notes-v1`).
//
// Opens from a note on the floor: walk up and press E, or click
// the 📝 itself (NoteSystem). Same feel as the notice board popup
// (NoticeBoardPanel.jsx): a DOM overlay that obscures the location
// for a moment; closing it returns to the room. Polls getState()
// while open (same 500ms rhythm as the notice board), so a note
// someone else takes down — or one whose 48 hours run out —
// shows as gone live.
//
// ANONYMOUS: the popup shows only the text and how long until it
// fades. No author is ever shown — the wire state carries no
// authorId and no authorName, so there is nothing to show. The
// Delete button appears only when this reader wrote the note
// (state.notes[].mine, from the ids this profile dropped) or is a
// moderator. The server re-validates either way.
//
// Props:
//   getState() — () => { notes, count, myUserId, roomId, now }
//     (NoteSystem.getState)
//   onDelete(noteId) — returns { ok, reason? }
//     (NoteSystem.deleteNote)
//   isModerator — whether this player is a moderator (VillageCanvas
//     prop); moderators can take down any note, everyone else only
//     their own. The server re-validates either way.
//   noteId — the note being read
//   onClose()

import React, { useEffect, useState } from 'react';

const REASON_TEXT = {
  'not-found': 'That note is already gone.',
  'not-allowed': 'You can only take down your own notes.',
  offline: 'You seem to be offline — try again when you’re connected.',
  'not-available': 'There are no notes in this room.',
  error: 'Something went wrong — try again.',
};

function fadeLabel(expiresAt, now) {
  const ms = (Number(expiresAt) || 0) - (Number(now) || Date.now());
  if (ms <= 0) return 'fading away now';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'fading away in less than a minute';
  if (mins < 60) return `fades away in ~${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `fades away in ~${hours}h`;
  return 'fades away in ~48h';
}

export default function NotePanel({ getState, onDelete, isModerator, noteId, onClose }) {
  const [state, setState] = useState(() => {
    try { return getState ? getState() : null; } catch { return null; }
  });
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const t = setInterval(() => {
      try {
        const next = getState ? getState() : null;
        if (next) setState(next);
      } catch {}
    }, 500);
    return () => clearInterval(t);
  }, [getState]);

  const refresh = () => {
    try {
      const next = getState ? getState() : null;
      if (next) setState(next);
    } catch {}
  };

  if (!state) return null;
  const note = (state.notes || []).find((n) => String(n.id) === String(noteId)) || null;
  const now = Number(state.now) || Date.now();

  const runDelete = () => {
    if (!note) return;
    let res = { ok: false, reason: 'error' };
    try { res = onDelete ? onDelete(note.id) : res; } catch { res = { ok: false, reason: 'error' }; }
    if (res && res.ok) {
      setNotice('Taking it down…');
      refresh();
      return;
    }
    setNotice(REASON_TEXT[res?.reason] || REASON_TEXT.error);
    refresh();
  };

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
          padding: 16, width: 'min(420px, calc(100vw - 24px))',
          maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 'bold', fontSize: 18 }}>
            📝 A note someone left
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

        {!note ? (
          <div style={{ fontSize: 13, color: '#3d6a8a', marginTop: 12 }}>
            That note is gone — someone took it down, or its 48 hours ran out.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 4 }}>
              {fadeLabel(note.expiresAt, now)} · anyone here can read it
            </div>
            <div style={{
              marginTop: 8, padding: 12, borderRadius: 8, background: '#fffdf5',
              border: '1px solid #e2b46c', fontSize: 14, lineHeight: 1.5,
              whiteSpace: 'pre-line', color: '#3d2c14',
            }}>
              {note.text}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button
                onClick={onClose}
                style={btnStyle}
              >
                Leave it here
              </button>
              {(note.mine || isModerator) && (
                <button
                  onClick={runDelete}
                  style={{ ...btnStyle, background: 'transparent', color: '#92400e', border: '1px solid #92400e' }}
                >
                  Take down
                </button>
              )}
            </div>
          </>
        )}

        {notice && (
          <div style={{ fontSize: 13, marginTop: 10, color: '#92400e' }}>{notice}</div>
        )}

        <div style={{ fontSize: 12, marginTop: 12, color: '#64748b' }}>
          Tip: notes are anonymous — no name is ever shown. Yours fade
          away after 48 hours, and a moderator can take any note down.
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  background: '#1a4971', color: '#fff', border: 'none', borderRadius: 6,
  padding: '6px 12px', cursor: 'pointer', fontSize: 13,
};
