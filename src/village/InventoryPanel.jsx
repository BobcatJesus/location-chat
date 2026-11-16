// InventoryPanel.jsx — the pocket / bag popup (Items + Inventory v1,
// `sq-items-inventory-v1`).
//
// Opens from the 🎒 button at the BOTTOM LEFT of the screen (never the
// toolbar — the user said the toolbar already has too many things).
// Same feel as the puzzle board zoom (PuzzleBoard.jsx): a DOM overlay
// that obscures the location for a moment; closing it returns to the
// room. Polls getState() while open (same 500ms rhythm as the quest
// HUD poll), so coins / capacity / items stay live.
//
// Props:
//   getState() — () => { items, count, capacity, hasBag, coins,
//     bagPrice, flyerCost, full, roomId, canDispose, canFeedDucks,
//     canFeedCat } (ItemsSystem.getState)
//   onUse(id) / onDrop(id) / onDispose(id) — return { ok, reason? }
//   onBuyBag() — returns { ok, reason? }
//   onMakeFlyer(title, text) — returns { ok, reason? }
//   onPinFlyer(id) — pin a flyer to this room's notice board (Notice
//     Board v1); returns { ok, pending?, reason? } — the flyer
//     leaves the pocket when the server confirms the pin
//   onOpenPuzzle() — close this panel and open the puzzle board
//   getBadges() — () => [{ questId, emoji, title, description,
//     completedAt, completedLabel }] (QuestManager.getCompletions,
//     Quest Badges v1) — the Badges tab
//   onClose()

import React, { useEffect, useState } from 'react';

const REASON_TEXT = {
  'inventory-full': 'Your pocket is full — use, drop, or throw something away to make room.',
  'not-enough-coins': 'Not enough coins for that yet.',
  'already-owned': 'You already have a bag.',
  'empty-flyer': 'A flyer needs a title and some text.',
  'not-usable': 'That item has no Use action.',
  'nothing-to-feed': 'No one here to feed right now — find the ducks at a pond or the cafe cat in Agora.',
  'cat-asleep': 'The cat is asleep — she wakes up when someone new walks in.',
  'not-near-trash-can': 'Walk to the Agora trash can to throw this away.',
  'not-trash': 'Only trash can be thrown away.',
  'puzzle-piece-use-board': 'Place it on the puzzle board — that frees the slot.',
  'puzzle-piece-no-drop': 'Puzzle pieces can’t be dropped — place them on the puzzle board.',
  'not-flyer': 'Only flyers can be pinned to the notice board.',
  offline: 'You seem to be offline — try again when you’re connected.',
  'not-available': 'The notice board is only in Agora.',
  'not-found': 'That item is no longer in your pocket.',
  error: 'Something went wrong — try again.',
};

export default function InventoryPanel({
  getState, onUse, onDrop, onDispose, onBuyBag, onMakeFlyer, onPinFlyer, onOpenPuzzle, getBadges, onClose,
}) {
  const [state, setState] = useState(() => {
    try { return getState ? getState() : null; } catch { return null; }
  });
  // Quest badges v1: second tab, next to the items — your finished
  // quests, newest first. Coffee purchases are steps, not badges:
  // only a completed quest earns its badge.
  const [tab, setTab] = useState('items');
  const [badges, setBadges] = useState(() => {
    try { return getBadges ? getBadges() : []; } catch { return []; }
  });
  const [notice, setNotice] = useState('');
  const [reader, setReader] = useState(null); // item being read, or null
  const [flyerTitle, setFlyerTitle] = useState('');
  const [flyerText, setFlyerText] = useState('');
  const [showFlyerForm, setShowFlyerForm] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      try {
        const next = getState ? getState() : null;
        if (next) setState(next);
      } catch {}
      try {
        const nextBadges = getBadges ? getBadges() : null;
        if (Array.isArray(nextBadges)) setBadges(nextBadges);
      } catch {}
    }, 500);
    return () => clearInterval(t);
  }, [getState, getBadges]);

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
      return true;
    }
    setNotice(REASON_TEXT[res?.reason] || REASON_TEXT.error);
    refresh();
    return false;
  };

  if (!state) return null;
  const items = state.items || [];

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
            🎒 {state.hasBag ? 'Your Bag' : 'Your Pocket'}
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
          {state.count}/{state.capacity} items · 🪙 {state.coins} coins
          {state.full ? ' · Pocket full!' : ''}
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <button
            onClick={() => setTab('items')}
            style={{
              ...btnStyle,
              background: tab === 'items' ? '#1a4971' : 'transparent',
              color: tab === 'items' ? '#fff' : '#1a4971',
              border: tab === 'items' ? 'none' : '1px solid #1a4971',
            }}
          >
            🎒 Pocket
          </button>
          <button
            onClick={() => setTab('badges')}
            style={{
              ...btnStyle,
              background: tab === 'badges' ? '#1a4971' : 'transparent',
              color: tab === 'badges' ? '#fff' : '#1a4971',
              border: tab === 'badges' ? 'none' : '1px solid #1a4971',
            }}
          >
            🏅 Badges ({badges.length})
          </button>
        </div>

        {tab === 'badges' ? (
          <div style={{ marginTop: 12 }}>
            {badges.length === 0 ? (
              <div style={{ fontSize: 13, color: '#3d6a8a' }}>
                No badges yet. Finish a quest and its badge shows up
                here — and other players can see it when they click
                on you.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
            <div style={{ fontSize: 12, marginTop: 12, color: '#64748b' }}>
              One badge per finished quest — coffee buys and other
              quest steps don’t earn badges, only completing the
              quest does.
            </div>
          </div>
        ) : reader ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 'bold', fontSize: 15 }}>
              {reader.emoji} {reader.title || reader.label}
            </div>
            <div style={{
              marginTop: 8, padding: 12, borderRadius: 8, background: '#fffdf5',
              border: '1px solid #e2b46c', fontSize: 14, lineHeight: 1.5,
              whiteSpace: 'pre-line', color: '#3d2c14',
            }}>
              {reader.text}
            </div>
            <button
              onClick={() => setReader(null)}
              style={{
                marginTop: 10, background: '#1a4971', color: '#fff', border: 'none',
                borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13,
              }}
            >
              ← Back to your pocket
            </button>
          </div>
        ) : (
          <>
            {items.length === 0 ? (
              <div style={{ fontSize: 13, color: '#3d6a8a', marginTop: 12 }}>
                Nothing in here yet. Click on furniture a few times around
                Agora — trash cans, tables, plants — and things turn up.
                Bits of food and litter on the floor can be picked up with
                one click when you walk up to them.
              </div>
            ) : (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((item) => (
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
                      {item.readable && (
                        <button
                          onClick={() => setReader(item)}
                          style={btnStyle}
                        >
                          Read
                        </button>
                      )}
                      {item.usable && (
                        <button
                          onClick={() => run(() => onUse && onUse(item.id), 'Used!')}
                          style={btnStyle}
                        >
                          Use 🍽️
                        </button>
                      )}
                      {item.type === 'puzzle-piece' && (
                        <button
                          onClick={() => { if (onOpenPuzzle) onOpenPuzzle(); }}
                          style={btnStyle}
                        >
                          Open puzzle board 🧩
                        </button>
                      )}
                      {item.type === 'flyer' && (
                        <button
                          onClick={() => run(
                            () => onPinFlyer && onPinFlyer(item.id),
                            '📌 Pinning it to the notice board…',
                          )}
                          title="Pin this flyer to this room's notice board so everyone here can read it — it leaves your pocket once the board confirms it"
                          style={btnStyle}
                        >
                          Pin to board 📌
                        </button>
                      )}
                      {item.disposable && (
                        <button
                          onClick={() => run(() => onDispose && onDispose(item.id), '🗑️ Tossed! The cafe stays tidy.')}
                          disabled={!state.canDispose}
                          title={state.canDispose ? 'Throw this away in the Agora trash can' : 'Walk to the Agora trash can to throw this away'}
                          style={{ ...btnStyle, opacity: state.canDispose ? 1 : 0.55, cursor: state.canDispose ? 'pointer' : 'not-allowed' }}
                        >
                          Throw away 🗑️
                        </button>
                      )}
                      {item.type !== 'puzzle-piece' && (
                        <button
                          onClick={() => run(
                            () => onDrop && onDrop(item.id),
                            // Drop on the home floor v1: at home the
                            // drop lands on your floor and stays
                            // there; anywhere else it is ground
                            // litter for this session.
                            state.atHome ? 'Dropped on the floor of your home.' : 'Dropped on the ground here.',
                          )}
                          title={state.atHome ? 'Drop this on the floor of your home — it stays there until you pick it back up' : 'Drop this on the ground here'}
                          style={{ ...btnStyle, background: 'transparent' }}
                        >
                          Drop
                        </button>
                      )}
                    </div>
                    {item.type === 'puzzle-piece' && (
                      <div style={{ fontSize: 12, color: '#92400e', marginTop: 6 }}>
                        Placing it on the puzzle board frees this slot.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {notice && (
              <div style={{ fontSize: 13, marginTop: 10, color: '#92400e' }}>{notice}</div>
            )}

            {!state.hasBag && (
              <div style={{
                marginTop: 14, padding: 10, borderRadius: 8, background: '#fef3c7',
                border: '1px solid #f59e0b',
              }}>
                <div style={{ fontWeight: 'bold', fontSize: 14 }}>🎒 Upgrade to a bag</div>
                <div style={{ fontSize: 13, color: '#3d6a8a', marginTop: 2 }}>
                  A purse or backpack holds 10 items instead of 3 — and it
                  shows on your avatar for everyone to see.
                </div>
                <button
                  onClick={() => run(() => onBuyBag && onBuyBag(), '🎒 You got a bag! Now holds 10 items.')}
                  disabled={state.coins < state.bagPrice}
                  title={state.coins < state.bagPrice ? `Need ${state.bagPrice} coins` : `Buy a bag for ${state.bagPrice} coins`}
                  style={{
                    ...btnStyle, marginTop: 8,
                    opacity: state.coins < state.bagPrice ? 0.55 : 1,
                    cursor: state.coins < state.bagPrice ? 'not-allowed' : 'pointer',
                  }}
                >
                  Buy a bag · {state.bagPrice} 🪙
                </button>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              {!showFlyerForm ? (
                <button
                  onClick={() => setShowFlyerForm(true)}
                  disabled={state.full}
                  title={state.full ? 'Your pocket is full — make room first' : `Make a flyer for ${state.flyerCost} coins`}
                  style={{
                    ...btnStyle,
                    opacity: state.full ? 0.55 : 1,
                    cursor: state.full ? 'not-allowed' : 'pointer',
                  }}
                >
                  📄 Make a flyer · {state.flyerCost} 🪙
                </button>
              ) : (
                <div style={{
                  padding: 10, borderRadius: 8, background: '#fffdf5',
                  border: '1px solid #e2b46c',
                }}>
                  <div style={{ fontWeight: 'bold', fontSize: 14 }}>📄 Make a flyer</div>
                  <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
                    {state.flyerCost} coins. The flyer goes into your pocket —
                    read it, drop it here for someone to stumble on, or pin
                    it to the notice board in Agora for everyone to see.
                  </div>
                  <input
                    value={flyerTitle}
                    onChange={(e) => setFlyerTitle(e.target.value)}
                    placeholder="Flyer title (e.g. Guitar lessons!)"
                    maxLength={60}
                    style={inputStyle}
                  />
                  <textarea
                    value={flyerText}
                    onChange={(e) => setFlyerText(e.target.value)}
                    placeholder="What should the flyer say?"
                    maxLength={200}
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                      onClick={() => {
                        const ok = run(
                          () => onMakeFlyer && onMakeFlyer(flyerTitle, flyerText),
                          '📄 Flyer made — it’s in your pocket!',
                        );
                        if (ok) { setFlyerTitle(''); setFlyerText(''); setShowFlyerForm(false); }
                      }}
                      style={btnStyle}
                    >
                      Make it · {state.flyerCost} 🪙
                    </button>
                    <button
                      onClick={() => { setShowFlyerForm(false); setNotice(''); }}
                      style={{ ...btnStyle, background: 'transparent' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ fontSize: 12, marginTop: 12, color: '#64748b' }}>
              Tip: puzzle pieces live here too — each one takes a slot
              until you place it on the puzzle board.
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

const inputStyle = {
  width: '100%', boxSizing: 'border-box', marginTop: 8, padding: '7px 10px',
  border: '1px solid #94a3b8', borderRadius: 6, fontSize: 13,
  fontFamily: 'inherit', background: '#fff', color: '#1a4971',
};
