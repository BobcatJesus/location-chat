// NoticeBoardPanel.jsx — the Agora notice board popup
// (Notice Board v1, `sq-notice-board-v1`).
//
// Opens from the board itself: walk up and press E, or click the
// board (NoticeBoardSystem). Same feel as the puzzle board zoom
// (PuzzleBoard.jsx) and the inventory popup (InventoryPanel.jsx): a
// DOM overlay that obscures the location for a moment; closing it
// returns to the room. Polls getState() while open (same 500ms
// rhythm as the inventory panel), so pins from other players show
// up live.
//
// Props:
//   getState() — () => { flyers, count, max, myUserId, roomId }
//     (NoticeBoardSystem.getState)
//   onRemove(flyerId) — returns { ok, reason? }
//     (NoticeBoardSystem.removeFlyer)
//   isModerator — whether this player is a moderator (VillageCanvas
//     prop); moderators can take down any flyer, everyone else only
//     their own. The server re-validates either way.
//   onClose()

import React, { useEffect, useState } from 'react';

const REASON_TEXT = {
  'not-found': 'That flyer is no longer on the board.',
  'not-allowed': 'You can only take down your own flyers.',
  offline: 'You seem to be offline — try again when you’re connected.',
  'not-available': 'The notice board is only in Agora.',
  error: 'Something went wrong — try again.',
};

export default function NoticeBoardPanel({ getState, onRemove, isModerator, onClose }) {
  const [state, setState] = useState(() => {
    try { return getState ? getState() : null; } catch { return null; }
  });
  const [notice, setNotice] = useState('');
  const [reader, setReader] = useState(null); // flyer being read, or null

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
  // Newest first — the freshest flyer is the one you notice.
  const flyers = [...(state.flyers || [])].sort(
    (a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0),
  );

  const runRemove = (flyer) => {
    let res = { ok: false, reason: 'error' };
    try { res = onRemove ? onRemove(flyer.id) : res; } catch { res = { ok: false, reason: 'error' }; }
    if (res && res.ok) {
      setNotice('Taking it down…');
      setReader(null);
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
            📌 Notice Board
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
        <div style={{ fontSize: 13, marginTop: 4, color: '#3d6a8a' }}>
          {state.count}/{state.max} flyers pinned · everyone in Agora can read these
        </div>

        {reader ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 'bold', fontSize: 15 }}>
              📄 {reader.title}
            </div>
            <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
              Pinned by {reader.addedByName || 'Someone'}
            </div>
            <div style={{
              marginTop: 8, padding: 12, borderRadius: 8, background: '#fffdf5',
              border: '1px solid #e2b46c', fontSize: 14, lineHeight: 1.5,
              whiteSpace: 'pre-line', color: '#3d2c14',
            }}>
              {reader.text}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button
                onClick={() => setReader(null)}
                style={btnStyle}
              >
                ← Back to the board
              </button>
              {(String(reader.addedBy) === String(state.myUserId) || isModerator) && (
                <button
                  onClick={() => runRemove(reader)}
                  style={{ ...btnStyle, background: 'transparent', color: '#92400e', border: '1px solid #92400e' }}
                >
                  Take down
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {flyers.length === 0 ? (
              <div style={{ fontSize: 13, color: '#3d6a8a', marginTop: 12 }}>
                Nothing pinned yet. Make a flyer from your pocket (5 coins)
                and pin it here — everyone who walks into Agora will see it.
              </div>
            ) : (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {flyers.map((flyer) => {
                  const isMine = String(flyer.addedBy) === String(state.myUserId);
                  return (
                    <div
                      key={flyer.id}
                      style={{
                        border: '1px solid #e2b46c', borderRadius: 8, padding: '10px 12px',
                        background: '#fffdf5',
                      }}
                    >
                      <div style={{ fontWeight: 'bold', fontSize: 14 }}>
                        📄 {flyer.title}
                      </div>
                      <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
                        Pinned by {flyer.addedByName || 'Someone'}
                        {isMine ? ' · yours' : ''}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        <button
                          onClick={() => setReader(flyer)}
                          style={btnStyle}
                        >
                          Read
                        </button>
                        {(isMine || isModerator) && (
                          <button
                            onClick={() => runRemove(flyer)}
                            style={{ ...btnStyle, background: 'transparent', color: '#92400e', border: '1px solid #92400e' }}
                          >
                            Take down
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {notice && (
              <div style={{ fontSize: 13, marginTop: 10, color: '#92400e' }}>{notice}</div>
            )}

            <div style={{ fontSize: 12, marginTop: 12, color: '#64748b' }}>
              Tip: flyers live in your pocket first — make one there, then
              pin it to the board from the flyer itself. Taking down your
              own flyer puts it back in your pocket if there’s room.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const btnStyle = {
  background: '#1a4971', color: '#fff', border: 'none', borderRadius: 6,
  padding: '6px 12px', cursor: 'pointer', fontSize: 13,
};
