// BreadShopPanel.jsx — the Register-counter bread shop
// (Bread Shop v1, `sq-bread-shop-v1`).
//
// Opens from the 🛒 Register counter in a food-shop room: walk up
// and press E. The stock depends on the shop type (see
// breadStockFor in breadShop.js): a bakery sells all three breads,
// a supermarket only the roll, a deli roll + baguette, a cafe only
// the croissant — and a non-food shop has no bread at all, so this
// panel never opens there. Same feel as the Agora bar panel
// (DecorShopPanel.jsx): a DOM overlay, polls getState() while open
// (same 500ms rhythm), so coins and pocket room stay live.
//
// A bread is a FOOD item: 3 coins, 3 feeds (ducks or cat), same as
// the bits of food from the ground. Buying is local (coins +
// pocket, items.buyBread) — a full pocket refuses the sale BEFORE
// any coins are taken.
//
// Props:
//   getState() — () => { breads: [{ kind, emoji, label, blurb,
//     price }], coins, full, roomId, roomName }
//     (DecorSystem.getBreadShopState)
//   onBuyBread(kind) — returns { ok, item?, price?, reason? }
//     (DecorSystem.buyBread)
//   onClose()

import React, { useEffect, useState } from 'react';

const REASON_TEXT = {
  'inventory-full': 'Your pocket is full — use, drop, or throw something away to make room first.',
  'not-enough-coins': 'Not enough coins for that yet.',
  'bad-kind': 'That bread is not on sale here.',
  'not-available': 'This shop does not sell bread.',
  offline: 'You seem to be offline — try again when you’re connected.',
  error: 'Something went wrong — try again.',
};

export default function BreadShopPanel({ getState, onBuyBread, onClose }) {
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

  const runBuy = async (fn, okText) => {
    let res = { ok: false, reason: 'error' };
    try { res = (await (fn ? fn() : res)) || { ok: false, reason: 'error' }; } catch { res = { ok: false, reason: 'error' }; }
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
  const breads = state.breads || [];
  const coins = Number(state.coins) || 0;
  const title = state.roomName ? `🛒 ${state.roomName}` : '🛒 Shop';

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
          <div style={{ fontWeight: 'bold', fontSize: 18 }}>{title}</div>
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
          🪙 {coins} coins{state.full ? ' · Pocket full!' : ''}
        </div>
        <div style={{ fontSize: 13, marginTop: 6, color: '#3d6a8a' }}>
          Fresh bread, 3 coins each. A loaf feeds the ducks or the
          cat — 3 feeds per loaf, same as the bits of food you find
          lying around.
        </div>

        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {breads.map((item) => {
            const afford = coins >= item.price;
            const blocked = state.full || !afford;
            return (
              <div
                key={item.kind}
                style={{
                  border: '1px solid #e2b46c', borderRadius: 8, padding: '10px 12px',
                  background: '#fffdf5', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', gap: 8,
                }}
              >
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: 14 }}>
                    {item.emoji} {item.label}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
                    {item.blurb}
                  </div>
                </div>
                <button
                  onClick={() => runBuy(
                    () => onBuyBread && onBuyBread(item.kind),
                    `🍞 ${item.label} bought — feed the ducks or the cat, 3 feeds!`,
                  )}
                  disabled={blocked}
                  title={state.full
                    ? 'Your pocket is full — make room first'
                    : !afford ? `Need ${item.price} coins` : `Buy a ${item.label} for ${item.price} coins`}
                  style={{
                    ...btnStyle, flexShrink: 0,
                    opacity: blocked ? 0.55 : 1,
                    cursor: blocked ? 'not-allowed' : 'pointer',
                  }}
                >
                  Buy · {item.price} 🪙
                </button>
              </div>
            );
          })}
        </div>

        {notice && (
          <div style={{ fontSize: 13, marginTop: 10, color: '#92400e' }}>{notice}</div>
        )}

        <div style={{ fontSize: 12, marginTop: 12, color: '#64748b' }}>
          Buying costs coins — bread is a coin sink, like coffee.
          Each loaf is good for 3 feeds.
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  background: '#1a4971', color: '#fff', border: 'none', borderRadius: 6,
  padding: '6px 12px', cursor: 'pointer', fontSize: 13,
};
