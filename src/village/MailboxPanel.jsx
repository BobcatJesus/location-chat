// MailboxPanel.jsx — the mailbox overlay (Mailbox v1,
// `sq-mailbox-v1`).
//
// Opens from the mailbox in your mailbox room (your nearest park,
// or the nearest public place when no park is close): walk up and
// press E, or click the mailbox itself — with the mailbox key in
// your pocket. Lists your packages (who sent them, and what), each
// with a Take button, plus Take All. Take asks the server first
// and only then puts the item in your pocket: a full pocket
// refuses with the standard message and the package STAYS in the
// mailbox, so nothing is ever lost by collecting. The panel polls
// getState() while open (same 500ms rhythm as the pocket panel),
// so packages arriving while you stand here appear on their own.
//
// Props:
//   getState() — () => { mailPackages, mailUnread, mailboxRoomName,
//     hasMailboxKey, mailNotice, mailNoticeSeq } (ItemsSystem.getState)
//   onCollect(packageId) — returns { ok, pending?, reason? }
//   onCollectAll() — returns { ok, started?, reason? }
//   onClose()
//
// The panel's own notice line shows collect news (a full pocket,
// or a package that was already collected) the same way the pocket
// panel shows send news — the scene toast sits UNDER this panel
// (zIndex 1002 vs 1100), so without this the player would never
// see it while the mailbox is open.

import React, { useEffect, useRef, useState } from 'react';

const REASON_TEXT = {
  'inventory-full': 'Your pocket is full — use, drop, or throw something away to make room.',
  'not-found': 'That package is already gone.',
  offline: 'You seem to be offline — try again when you’re connected.',
  error: 'Something went wrong — try again.',
};

export default function MailboxPanel({ getState, onCollect, onCollectAll, onClose }) {
  const [state, setState] = useState(() => {
    try { return getState ? getState() : null; } catch { return null; }
  });
  const [notice, setNotice] = useState('');
  const lastMailNoticeSeqRef = useRef(0);

  useEffect(() => {
    const t = setInterval(() => {
      try {
        const next = getState ? getState() : null;
        if (next) {
          setState(next);
          if (typeof next.mailNoticeSeq === 'number'
            && next.mailNoticeSeq !== lastMailNoticeSeqRef.current) {
            lastMailNoticeSeqRef.current = next.mailNoticeSeq;
            if (next.mailNotice) setNotice(next.mailNotice);
          }
        }
      } catch {}
    }, 500);
    return () => clearInterval(t);
  }, [getState]);

  const run = (fn, okText) => {
    let res = { ok: false, reason: 'error' };
    try { res = fn ? fn() : res; } catch { res = { ok: false, reason: 'error' }; }
    if (res && res.ok) {
      setNotice(okText || '');
      return true;
    }
    setNotice(REASON_TEXT[res?.reason] || REASON_TEXT.error);
    return false;
  };

  if (!state) return null;
  const packages = state.mailPackages || [];

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
            📬 Your Mailbox
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
          {state.mailboxRoomName
            ? `Your mailbox lives at ${state.mailboxRoomName}.`
            : 'Your mailbox.'}
          {' '}Mail waits here until you collect it.
        </div>

        {packages.length === 0 ? (
          <div style={{ fontSize: 13, color: '#3d6a8a', marginTop: 12 }}>
            Nothing in here yet. Share your mailbox code with a
            friend (it’s in your pocket — the 🎒 button) and they
            can send you something.
          </div>
        ) : (
          <>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {packages.map((pkg) => (
                <div
                  key={pkg.id}
                  style={{
                    border: '1px solid #e2b46c', borderRadius: 8, padding: '10px 12px',
                    background: '#fffdf5',
                  }}
                >
                  <div style={{ fontWeight: 'bold', fontSize: 14 }}>
                    {/* Gift Wrapping Paper v1 (`sq-gift-wrap-v1`):
                        a wrapped package shows as a wrapped gift
                        (🎁 + label) — the item inside is unchanged. */}
                    {pkg.wrapped
                      ? `🎁 ${pkg.item?.title || pkg.item?.label || 'A gift'}`
                      : `${pkg.item?.emoji || '📦'} ${pkg.item?.title || pkg.item?.label || 'A gift'}`}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 2 }}>
                    From {pkg.fromName || 'Someone'}
                    {pkg.item?.blurb ? ` — ${pkg.item.blurb}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                      onClick={() => run(
                        () => onCollect && onCollect(pkg.id),
                        '📬 Collecting it…',
                      )}
                      style={{
                        background: '#1a4971', color: '#fff', border: 'none',
                        borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      Take
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {packages.length > 1 && (
              <button
                onClick={() => run(
                  () => onCollectAll && onCollectAll(),
                  '📬 Collecting what fits…',
                )}
                style={{
                  background: '#1a4971', color: '#fff', border: 'none',
                  borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
                  fontSize: 13, marginTop: 10,
                }}
              >
                Take All
              </button>
            )}
          </>
        )}

        {notice && (
          <div style={{ fontSize: 13, marginTop: 10, color: '#92400e' }}>{notice}</div>
        )}

        <div style={{ fontSize: 12, marginTop: 12, color: '#64748b' }}>
          Tip: a full pocket refuses a Take — the package stays in
          your mailbox until you make room.
        </div>
      </div>
    </div>
  );
}
