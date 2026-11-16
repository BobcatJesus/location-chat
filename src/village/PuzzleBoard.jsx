// PuzzleBoard.jsx — the zoomed-in group puzzle board (Shared Puzzle
// Quest v1.2, `group-puzzle-v1-2-hidden-search`).
//
// Opens when you click the puzzle table in Agora. DOM overlay (not
// Phaser): a 3x3 grid of the cat picture (cat-threequarter.png, sliced
// with background-position) plus a tray of the pieces the room has
// found but not placed yet. Drag a piece onto ANY cell, or click a
// piece then click a cell. v1.1 FREE PLACEMENT: a wrong cell does NOT
// shake or bounce back — the piece stays there until someone moves
// it, and a placed piece can be picked up again (click it, or drag
// it) and moved anywhere else. Completion only counts when all 9 are
// in their home cells at the same time, so the header counts pieces
// in the RIGHT place, not pieces on the board. v1.2: the pieces are
// hidden — no markers on the floor. They turn up by clicking on the
// furniture a few times, or sometimes in a coffee. This board never
// lists where they hide. The board is shared: placements by anyone
// in the room show up for everyone (the parent polls getBoardState
// while the board is open).
//
// Props:
//   getBoardState() — () => { round, collected, placed, placedCount,
//     total, completed, completedAt, contributors, myFound, myPlaced }
//   onPlace(pieceId, col, row) — returns { ok, reason? } (PuzzleQuest
//     pre-validates, so a wrong cell is instant feedback)
//   onClose()

import React, { useEffect, useState } from 'react';
import { PUZZLE_IMAGE_URL, PUZZLE_SIZE, pieceHome } from './puzzleState.js';

const TILE_PX = 96;

function tileStyle(pieceId) {
  const home = pieceHome(pieceId);
  return {
    backgroundImage: `url(${PUZZLE_IMAGE_URL})`,
    backgroundSize: '300% 300%',
    backgroundPosition: `${home.col * 50}% ${home.row * 50}%`,
  };
}

export default function PuzzleBoard({ getBoardState, onPlace, onClose }) {
  const [board, setBoard] = useState(() => {
    try { return getBoardState ? getBoardState() : null; } catch { return null; }
  });
  const [selected, setSelected] = useState(null); // pieceId, click-to-place (tray OR board)
  const [notice, setNotice] = useState('');

  // The board is shared: poll for other players' finds/placements
  // while it is open (same 500ms rhythm as the quest HUD poll).
  useEffect(() => {
    const t = setInterval(() => {
      try {
        const next = getBoardState ? getBoardState() : null;
        if (next) setBoard(next);
      } catch {}
    }, 500);
    return () => clearInterval(t);
  }, [getBoardState]);

  if (!board) return null;
  const placed = board.placed || {};
  const collected = board.collected || [];
  const tray = collected.filter((id) => !placed[id]);
  const placedCount = board.placedCount || 0;
  const total = board.total || 9;
  const secondsLeft = board.completed && board.completedAt
    ? Math.max(0, Math.ceil((board.completedAt + 60000 - Date.now()) / 1000))
    : 0;

  const attemptPlace = (pieceId, col, row) => {
    if (pieceId == null) return;
    let res = { ok: false, reason: 'unknown' };
    try { res = onPlace ? onPlace(pieceId, col, row) : res; } catch { res = { ok: false, reason: 'error' }; }
    if (res && res.ok) {
      setSelected(null);
      setNotice('');
      try {
        const next = getBoardState ? getBoardState() : null;
        if (next) setBoard(next);
      } catch {}
      return;
    }
    // v1.1: there is no 'wrong-cell' anymore — any cell takes the
    // piece. A failure here is a real error, not a wrong guess.
    if (res && res.reason === 'not-found') {
      setNotice("That piece hasn't been found yet.");
    } else {
      setNotice('Could not place that piece.');
    }
  };

  const cellFor = (col, row) => {
    for (const [id, pos] of Object.entries(placed)) {
      if (pos.col === col && pos.row === row) return Number(id);
    }
    return null;
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
          <div style={{ fontWeight: 'bold', fontSize: 18 }}>🧩 The Cat Puzzle</div>
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
          Group puzzle · Agora · {placedCount}/{total} in the right place
          {board.contributors ? ` · ${board.contributors.length} ${board.contributors.length === 1 ? 'person' : 'people'} helped` : ''}
        </div>

        {board.completed ? (
          <div style={{
            marginTop: 12, padding: 12, borderRadius: 8, textAlign: 'center',
            background: '#dcfce7', color: '#14532d', fontWeight: 'bold',
          }}>
            🎉 Puzzle complete! The cat is whole again.
            {secondsLeft > 0 && <div style={{ fontWeight: 'normal', fontSize: 13 }}>A new puzzle starts in about {secondsLeft}s.</div>}
          </div>
        ) : (
          <div style={{ fontSize: 13, marginTop: 6, color: '#3d6a8a' }}>
            Pieces are hidden around Agora — click on the furniture a few
            times and one might turn up. One might even turn up in a coffee.
            Then drag found pieces onto the board.
            Pieces can go anywhere: a wrong spot stays put until someone moves it.
          </div>
        )}

        {/* The grid: placed pieces show their slice of the cat picture. */}
        <div
          style={{
            display: 'grid', gridTemplateColumns: `repeat(${PUZZLE_SIZE}, ${TILE_PX}px)`,
            gap: 4, marginTop: 12, justifyContent: 'center',
          }}
        >
          {Array.from({ length: PUZZLE_SIZE }, (_, row) => (
            Array.from({ length: PUZZLE_SIZE }, (_, col) => {
              const pieceId = cellFor(col, row);
              const isSelected = selected != null && selected === pieceId;
              return (
                <div
                  key={`${col}-${row}`}
                  draggable={pieceId != null}
                  onDragStart={(e) => {
                    if (pieceId != null) e.dataTransfer.setData('text/puzzle-piece', String(pieceId));
                  }}
                  onClick={() => {
                    if (selected != null) {
                      // A piece is picked up (from tray or board): drop it here, right or wrong.
                      attemptPlace(selected, col, row);
                    } else if (pieceId != null) {
                      // Pick up a placed piece to move it again.
                      setSelected(pieceId);
                      setNotice('');
                    }
                  }}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const raw = e.dataTransfer.getData('text/puzzle-piece');
                    if (raw !== '') attemptPlace(Number(raw), col, row);
                  }}
                  style={{
                    width: TILE_PX, height: TILE_PX, borderRadius: 6,
                    border: isSelected
                      ? '3px solid #1a4971'
                      : pieceId != null ? '2px solid #f59e0b' : '2px dashed #b45309',
                    background: pieceId != null ? '#fef3c7' : 'rgba(180,83,9,0.08)',
                    cursor: pieceId != null || selected != null ? 'pointer' : 'default',
                    boxShadow: isSelected ? '0 0 0 2px #93c5fd' : undefined,
                    ...(pieceId != null ? tileStyle(pieceId) : {}),
                  }}
                  title={pieceId != null ? 'Placed — click to pick it up and move it' : 'Empty — drag a piece here'}
                />
              );
            })
          ))}
        </div>

        {/* The tray: found but not yet placed. Click to select, or drag. */}
        <div style={{ marginTop: 14, fontWeight: 'bold', fontSize: 14 }}>
          Your tray — found, not placed yet ({tray.length})
        </div>
        {tray.length === 0 ? (
          <div style={{ fontSize: 13, color: '#3d6a8a', marginTop: 4 }}>
            {placedCount >= total
              ? 'Every piece is in the picture.'
              : 'No loose pieces yet — go hunting around Agora.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {tray.map((id) => (
              <div
                key={id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/puzzle-piece', String(id)); }}
                onClick={() => setSelected(selected === id ? null : id)}
                title="Click to select, then click a grid cell — or drag it"
                style={{
                  width: 64, height: 64, borderRadius: 6, cursor: 'grab',
                  border: selected === id ? '3px solid #1a4971' : '2px solid #f59e0b',
                  boxShadow: selected === id ? '0 0 0 2px #93c5fd' : undefined,
                  ...tileStyle(id),
                }}
              />
            ))}
          </div>
        )}
        {selected != null && (
          <div style={{ fontSize: 13, marginTop: 8, color: '#1a4971' }}>
            Piece selected — now click any grid cell. Wrong spots are allowed, they just stay until someone moves them.
          </div>
        )}
        {notice && (
          <div style={{ fontSize: 13, marginTop: 8, color: '#92400e' }}>{notice}</div>
        )}
        <div style={{ fontSize: 12, marginTop: 10, color: '#64748b' }}>
          You found {Array.isArray(board.myFound) ? board.myFound.length : 0} piece{Array.isArray(board.myFound) && board.myFound.length === 1 ? '' : 's'} this round.
          {board.completed ? '' : ' Pieces are shared — anyone in Agora can place a piece you found.'}
        </div>
      </div>
    </div>
  );
}
