// PlayerBadgesPanel.jsx — another player's badges (Quest Completions
// / Badges v1, `sq-quest-badges-v1`).
//
// Opens when you click another player (VillageScene's scene-level
// pointerdown, same pattern as the bartender click). Same feel as
// the puzzle board / inventory popup: a DOM overlay that obscures
// the location for a moment; closing it returns to the room. Polls
// getState() while open (same 500ms rhythm as the inventory panel),
// so a badge earned while you're looking updates live.
//
// Props:
//   getState() — () => { name, badges: [{ questId, emoji, title,
//     description, completedAt }] } | null (the player walked away)
//   onClose()

import React, { useEffect, useState } from 'react';

export default function PlayerBadgesPanel({ getState, onClose }) {
  const [state, setState] = useState(() => {
    try { return getState ? getState() : null; } catch { return null; }
  });

  useEffect(() => {
    const t = setInterval(() => {
      try {
        const next = getState ? getState() : null;
        if (next) setState(next);
      } catch {}
    }, 500);
    return () => clearInterval(t);
  }, [getState]);

  if (!state) return null;
  const badges = Array.isArray(state.badges) ? state.badges : [];
  const name = state.name || 'Traveler';

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
            🏅 {name}’s badges
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
          {badges.length === 0
            ? 'No badges yet.'
            : `${badges.length} ${badges.length === 1 ? 'quest' : 'quests'} finished`}
        </div>

        {badges.length === 0 ? (
          <div style={{ fontSize: 13, color: '#3d6a8a', marginTop: 12 }}>
            {name} hasn’t finished a quest yet. Quests live in the
            tracker at the top of the screen — finish one and its
            badge shows up here.
          </div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {badges.map((badge) => (
              <div
                key={badge.questId}
                style={{
                  border: '1px solid #e2b46c', borderRadius: 8, padding: '10px 12px',
                  background: '#fffdf5',
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: 14 }}>
                  {badge.emoji} {badge.title}
                </div>
                <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
                  {badge.description}
                </div>
                <div style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>
                  Finished {badge.completedLabel || '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
