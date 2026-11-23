// DecorShopPanel.jsx — the Agora coffee bar shop
// (Decoration Shop v1, `sq-dec-shop-v1`).
//
// Opens from the coffee bar in Agora: walk up and press E, and the
// bar offers coffee (-2 coins, as before) or a Christmas
// decoration. Same feel as the notice board panel and the inventory
// popup (InventoryPanel.jsx): a DOM overlay that obscures the
// location for a moment; closing it returns to the room. Polls
// getState() while open (same 500ms rhythm), so coins and pocket
// room stay live.
//
// The shop is an INTERIM: where the permanent clothes / decoration
// stores will be is still undecided — for now, the bar sells them.
// Krampus is NOT sold here (the user deferred him: "we'll figure
// out krampus later"). Prices: ornament 5, lights 10, snowman 15
// (the user's), tree 25 and Santa 20 (builder picks — flagged in
// decorState.js). A bought decoration goes into the pocket; place
// it from the 🎒 panel, anywhere, for everyone in the room to see.
//
// Props:
//   getState() — () => { items: [{ kind, emoji, label, blurb,
//     price }], breads: [{ kind, emoji, label, blurb, price }],
//     coins, full, roomId } (DecorSystem.getShopState)
//   onBuyCoffee() — returns { ok, reason? } (the instant coffee
//     buy, same as pressing E at the bar used to do)
//   onBuyDecoration(kind) — returns { ok, item?, price?, reason? }
//     (DecorSystem.buyDecoration)
//   onBuyBread(kind) — returns { ok, item?, price?, reason? }
//     (Bread Shop v1, DecorSystem.buyBread — a bread is a FOOD
//     item, 3 feeds, ducks or cat)
//   onClose()

import React, { useEffect, useState } from 'react';

const REASON_TEXT = {
  'inventory-full': 'Your pocket is full — use, drop, or throw something away to make room first.',
  'not-enough-coins': 'Not enough coins for that yet.',
  cooldown: 'Just bought one — give it a moment.',
  'bad-kind': 'That is not on sale here.',
  'not-available': 'The decoration shop is only at the Agora coffee bar.',
  offline: 'You seem to be offline — try again when you’re connected.',
  error: 'Something went wrong — try again.',
};

export default function DecorShopPanel({ getState, onBuyCoffee, onBuyDecoration, onBuyBread, onClose }) {
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

  // Coffee buying is async (the wallet module loads on demand),
  // decorations are sync — await either way so the notice only
  // shows once the real result is in.
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
  const items = state.items || [];
  // Bread Shop v1 (`sq-bread-shop-v1`): the bar sells all three
  // breads in their own section, between coffee and decorations.
  const breads = state.breads || [];
  const coins = Number(state.coins) || 0;

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
          <div style={{ fontWeight: 'bold', fontSize: 18 }}>☕🎄 Agora Coffee Bar</div>
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
          A coffee, or a decoration for your place — or a park tree,
          or anywhere. Decorations go into your pocket; place them
          from the 🎒 panel and everyone here will see them.
        </div>

        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              border: '1px solid #e2b46c', borderRadius: 8, padding: '10px 12px',
              background: '#fffdf5', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', gap: 8,
            }}
          >
            <div>
              <div style={{ fontWeight: 'bold', fontSize: 14 }}>☕ Fresh coffee</div>
              <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
                Hot, strong, and the barista remembers you.
              </div>
            </div>
            <button
              onClick={() => runBuy(() => onBuyCoffee && onBuyCoffee(), '☕ Fresh coffee! -2 coins — enjoy!')}
              disabled={coins < 2}
              title={coins < 2 ? 'Need 2 coins' : 'Buy a coffee for 2 coins'}
              style={{
                ...btnStyle, flexShrink: 0,
                opacity: coins < 2 ? 0.55 : 1,
                cursor: coins < 2 ? 'not-allowed' : 'pointer',
              }}
            >
              Buy · 2 🪙
            </button>
          </div>

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

          {items.map((item) => {
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
                    () => onBuyDecoration && onBuyDecoration(item.kind),
                    `🎄 ${item.label} bought — it's in your pocket!`,
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
          Buying costs coins — decorations are a coin sink, like
          coffee. Placing one is free.
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  background: '#1a4971', color: '#fff', border: 'none', borderRadius: 6,
  padding: '6px 12px', cursor: 'pointer', fontSize: 13,
};
