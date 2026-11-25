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
//   getSendableItems() — Gift Giver v1 (`sq-gift-giver-v1`):
//     () => [{ id, emoji, label }] — pocket items this player can
//     be given (same rules as mail: no puzzle pieces, Santa hat,
//     mailbox key or wrapping paper).
//   onOfferGift(itemId) — () => { ok, reason? } — offer one of
//     those items to this player.
//   isOfferPending() — () => boolean — an offer to this player is
//     out and unanswered.
//   hasWrappingPaper() — () => boolean — the giver holds a sheet.

import React, { useEffect, useRef, useState } from 'react';

// Gift Giver v1 (`sq-gift-giver-v1`): the offer refusal words —
// the same as the mail ones (InventoryPanel REASON_TEXT), so both
// give paths speak with one voice.
const GIFT_REASON_TEXT = {
  'no-paper': 'You need gift wrapping paper to send a gift — buy some at the Agora bar.',
  'not-sendable': 'That can’t be given away — puzzle pieces, the Santa hat, your mailbox key and gift wrapping paper stay with you.',
  'already-pending': 'An offer is already out — wait for an answer first.',
  'self-give': 'That’s yourself — give it to a friend instead.',
  'not-in-room': 'They left the room — try again when you’re together.',
  offline: 'You seem to be offline — try again when you’re connected.',
  'not-found': 'That item is no longer in your pocket.',
  error: 'Something went wrong — try again.',
};

export default function PlayerBadgesPanel({ getState, onClose, getSendableItems, onOfferGift, isOfferPending, hasWrappingPaper }) {
  const [state, setState] = useState(() => {
    try { return getState ? getState() : null; } catch { return null; }
  });
  // Gift Giver v1 (`sq-gift-giver-v1`): the give picker + offer
  // state, refreshed on the same 500ms poll as the badges.
  const [sendableItems, setSendableItems] = useState([]);
  const [offerPending, setOfferPending] = useState(false);
  const [hasPaper, setHasPaper] = useState(true);
  const [offerNotice, setOfferNotice] = useState('');
  const wasPendingRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      try {
        const next = getState ? getState() : null;
        if (next) setState(next);
      } catch {}
      try {
        if (getSendableItems) setSendableItems(getSendableItems() || []);
      } catch {}
      try {
        const pending = isOfferPending ? Boolean(isOfferPending()) : false;
        // The offer resolved (accepted / declined / expired): the
        // scene toast carries the outcome, so clear the stale
        // "waiting" notice instead of leaving it up.
        if (wasPendingRef.current && !pending) setOfferNotice('');
        wasPendingRef.current = pending;
        setOfferPending(pending);
      } catch {}
      try {
        if (hasWrappingPaper) setHasPaper(Boolean(hasWrappingPaper()));
      } catch {}
    }, 500);
    return () => clearInterval(t);
  }, [getState, getSendableItems, isOfferPending, hasWrappingPaper]);

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

        {/* Gift Giver v1 (`sq-gift-giver-v1`): hand them a gift in
            person — pick a sendable pocket item, they accept or
            decline. The gift leaves your pocket (and one sheet of
            wrapping paper goes with it) only when they accept.
            Hidden entirely when the panel has no give wiring (older
            callers), so the badges panel never breaks. */}
        {onOfferGift && getSendableItems && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #e2b46c' }}>
            <div style={{ fontWeight: 'bold', fontSize: 15 }}>🎁 Give a gift</div>
            <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
              Hand them something from your pocket — they accept or
              decline. A gift uses one sheet of gift wrapping paper.
            </div>
            {!hasPaper && (
              <div style={{ fontSize: 12.5, color: '#92400e', marginTop: 6 }}>
                You need gift wrapping paper to send a gift — buy some at the Agora bar.
              </div>
            )}
            {offerPending ? (
              <div style={{ fontSize: 13, fontWeight: 'bold', marginTop: 8 }}>
                Offer sent — waiting for them…
              </div>
            ) : sendableItems.length === 0 ? (
              <div style={{ fontSize: 13, color: '#3d6a8a', marginTop: 8 }}>
                Nothing in your pocket to give.
              </div>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sendableItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      const res = onOfferGift(item.id) || {};
                      if (res.ok) {
                        setOfferNotice('Offer sent — waiting for them…');
                      } else {
                        setOfferNotice(GIFT_REASON_TEXT[res.reason] || GIFT_REASON_TEXT.error);
                      }
                    }}
                    disabled={!hasPaper}
                    title={hasPaper ? `Offer this to ${name}` : 'You need gift wrapping paper first — buy some at the Agora bar'}
                    style={{
                      textAlign: 'left', background: '#fffdf5', border: '1px solid #e2b46c',
                      borderRadius: 8, padding: '8px 10px', cursor: hasPaper ? 'pointer' : 'not-allowed',
                      color: '#1a4971', fontSize: 13, opacity: hasPaper ? 1 : 0.55,
                    }}
                  >
                    {item.emoji || '📦'} {item.label || 'Item'}
                  </button>
                ))}
              </div>
            )}
            {offerNotice && (
              <div style={{ fontSize: 12.5, color: '#92400e', marginTop: 8 }}>
                {offerNotice}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
