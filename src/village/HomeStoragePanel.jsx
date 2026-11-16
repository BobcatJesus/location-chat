// HomeStoragePanel.jsx — the "Your Place" storage panel
// (`sq-your-place-v1`).
//
// Opens from the storage chest in your home room (walk up and press
// E, or click the chest). Same feel as the pocket popup
// (InventoryPanel.jsx): a DOM overlay that obscures the location for
// a moment; closing it returns to the room. Polls getState() while
// open (same 500ms rhythm as the inventory panel), so pocket /
// stored counts stay live.
//
// Props:
//   getState() — () => { stored, storedCount, pocketItems,
//     pocketCount, pocketCapacity, hasBag, coins, atHome, roomId }
//     (HomeStorageSystem.getState)
//   onStore(id) — pocket → home; returns { ok, reason? }
//   onTake(id) — home → pocket (only if the pocket has room);
//     returns { ok, reason? }
//   onUnloadAll() — the whole pocket/bag → home at once; returns
//     { ok, moved, left, piecesOnly?, reason? }
//   onClose()

import React, { useEffect, useState } from 'react';

const REASON_TEXT = {
  'inventory-full': 'Your pocket is full — use, drop, or place a puzzle piece on the board to make room.',
  'puzzle-piece-no-store': 'Puzzle pieces can’t be stored at home — place them on the puzzle board.',
  'already-stored': 'That item is already stored here.',
  'home-full': 'Your place is full (200 items) — take something back out first.',
  'not-available': 'Storage only works at your place.',
  'not-found': 'That item is no longer there.',
  'bad-item': 'That item can’t be stored.',
  error: 'Something went wrong — try again.',
};

export default function HomeStoragePanel({
  getState, onStore, onTake, onUnloadAll, onClose,
}) {
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

  const run = (fn, okText) => {
    let res = { ok: false, reason: 'error' };
    try { res = fn ? fn() : res; } catch { res = { ok: false, reason: 'error' }; }
    if (res && res.ok) {
      setNotice(okText || '');
      refresh();
      return res;
    }
    setNotice(REASON_TEXT[res?.reason] || REASON_TEXT.error);
    refresh();
    return res;
  };

  if (!state) return null;
  const stored = state.stored || [];
  const pocket = state.pocketItems || [];

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
            🏠 Your Place — Storage
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
          {state.storedCount} stored here · {state.pocketCount}/{state.pocketCapacity} in your {state.hasBag ? 'bag' : 'pocket'} · 🪙 {state.coins} coins
        </div>

        <button
          onClick={() => {
            const res = run(
              () => onUnloadAll && onUnloadAll(),
              '',
            );
            if (res && res.ok) {
              if (res.moved > 0) {
                setNotice(`📦 Unloaded ${res.moved} item${res.moved === 1 ? '' : 's'} at home — pockets empty for the day's quest!${res.left > 0 ? ` (${res.left} puzzle piece${res.left === 1 ? '' : 's'} stayed in your pocket.)` : ''}`);
              } else if (res.piecesOnly) {
                setNotice('Only puzzle pieces in your pocket — they stay with you, place them on the puzzle board.');
              } else {
                setNotice('Nothing in your pocket to unload.');
              }
              refresh();
            }
          }}
          disabled={state.pocketCount === 0}
          title={state.pocketCount === 0 ? 'Your pocket is already empty' : 'Move everything in your pocket/bag into storage at once'}
          style={{
            ...btnStyle, marginTop: 12, width: '100%',
            opacity: state.pocketCount === 0 ? 0.55 : 1,
            cursor: state.pocketCount === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          📦 Unload all — empty your pocket into storage
        </button>

        <div style={{ fontWeight: 'bold', fontSize: 15, marginTop: 16 }}>
          📦 Stored at home ({state.storedCount})
        </div>
        {stored.length === 0 ? (
          <div style={{ fontSize: 13, color: '#3d6a8a', marginTop: 8 }}>
            Nothing stored here yet. Store things from your pocket
            below — the mailbox key, a fishing pole, a metal detector,
            anything that doesn’t fit.
          </div>
        ) : (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stored.map((item) => (
              <div
                key={item.id}
                style={{
                  border: '1px solid #e2b46c', borderRadius: 8, padding: '10px 12px',
                  background: '#fffdf5',
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: 14 }}>
                  {item.emoji} {item.title || item.label}
                </div>
                <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
                  {item.blurb}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  <button
                    onClick={() => run(() => onTake && onTake(item.id), 'Taken back into your pocket!')}
                    style={btnStyle}
                  >
                    Take back 🎒
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontWeight: 'bold', fontSize: 15, marginTop: 16 }}>
          🎒 In your {state.hasBag ? 'bag' : 'pocket'} ({state.pocketCount}/{state.pocketCapacity})
        </div>
        {pocket.length === 0 ? (
          <div style={{ fontSize: 13, color: '#3d6a8a', marginTop: 8 }}>
            Your pocket is empty — go out and find things, then come
            home and unload them here.
          </div>
        ) : (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pocket.map((item) => (
              <div
                key={item.id}
                style={{
                  border: '1px solid #e2b46c', borderRadius: 8, padding: '10px 12px',
                  background: '#fffdf5',
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: 14 }}>
                  {item.emoji} {item.title || item.label}
                  {item.type === 'puzzle-piece' && item.pieceId != null
                    ? ` (#${item.pieceId + 1})` : ''}
                </div>
                <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
                  {item.blurb}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  <button
                    onClick={() => run(() => onStore && onStore(item.id), '📦 Stored at home!')}
                    disabled={item.type === 'puzzle-piece'}
                    title={item.type === 'puzzle-piece' ? 'Puzzle pieces can’t be stored at home — place them on the puzzle board' : 'Store this at home'}
                    style={{
                      ...btnStyle,
                      opacity: item.type === 'puzzle-piece' ? 0.55 : 1,
                      cursor: item.type === 'puzzle-piece' ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Store here 📦
                  </button>
                </div>
                {item.type === 'puzzle-piece' && (
                  <div style={{ fontSize: 12, color: '#92400e', marginTop: 6 }}>
                    Puzzle pieces stay in your pocket — place them on the puzzle board.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {notice && (
          <div style={{ fontSize: 13, marginTop: 10, color: '#92400e' }}>{notice}</div>
        )}

        <div style={{ fontSize: 12, marginTop: 12, color: '#64748b' }}>
          Only you can enter your place — and only your place stores
          things. The mailbox lives at the nearest park, not here.
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  background: '#1a4971', color: '#fff', border: 'none', borderRadius: 6,
  padding: '6px 12px', cursor: 'pointer', fontSize: 13,
};
