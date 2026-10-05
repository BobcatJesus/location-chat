import React, { useState, useEffect } from 'react';
import { earnCoins } from './CoinWallet.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://location-chat-production.up.railway.app';

// ModQueuePanel — review pending interior layout submissions.
// Shows each submission as a floor plan preview. Approve applies it,
// reject removes it. Approvals award 5 coins to the submitter.

const CELL = 18;
const APPROVAL_BONUS = 5;

function LayoutPreview({ layout }) {
  // v2: freehand polygon + normalized furniture
  if (layout.version === 2) {
    const shape = layout.roomShape || [];
    const items = layout.furniture || [];
    const d = shape.length >= 3
      ? 'M ' + shape.map((p) => `${p.x * 1000} ${p.y * 700}`).join(' L ') + ' Z'
      : '';
    return (
      <svg viewBox="0 0 1000 700" width={360}
        style={{ border: '2px solid #3a3348', borderRadius: 4, background: '#0d0a14' }}>
        {d && <path d={d} fill="rgba(255,176,46,0.10)" stroke="#ffb02e" strokeWidth={6} />}
        {items.map((f, i) => {
          const x = f.x * 1000, y = f.y * 700, w = f.w * 1000, h = f.h * 700;
          return (
            <g key={i} transform={`rotate(${f.rotation || 0} ${x + w / 2} ${y + h / 2})`}>
              <rect x={x} y={y} width={w} height={h} rx={10}
                fill="#8b5a2b" fillOpacity={0.55} stroke="#fff" strokeWidth={2} />
              <text x={x + w / 2} y={y + h / 2} textAnchor="middle"
                dominantBaseline="middle" fontSize={28}>
                {f.label ? f.label.split(' ')[0] : '🪑'}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  // v1: grid format (legacy)
  const { gridW, gridH, walls, furniture } = layout;
  const wallSet = new Set((walls || []).map((w) => `${w.x},${w.y}`));

  const cells = [];
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      cells.push(
        <rect key={`${x},${y}`}
          x={x * CELL} y={y * CELL} width={CELL} height={CELL}
          fill={wallSet.has(`${x},${y}`) ? '#2b2b33' : '#1e1830'}
          stroke="#3a3348" strokeWidth={0.5}
        />
      );
    }
  }

  const items = (furniture || []).map((f, i) => (
    <g key={i}>
      <rect x={f.x * CELL} y={f.y * CELL}
        width={f.w * CELL} height={f.h * CELL}
        fill={f.color} fillOpacity={0.7} rx={3} />
      <text x={f.x * CELL + (f.w * CELL) / 2} y={f.y * CELL + (f.h * CELL) / 2}
        textAnchor="middle" dominantBaseline="middle" fontSize={10}>
        {f.label.split(' ')[0]}
      </text>
    </g>
  ));

  return (
    <svg width={gridW * CELL} height={gridH * CELL}
      style={{ border: '2px solid #3a3348', borderRadius: 4, background: '#0d0a14' }}>
      {cells}{items}
    </svg>
  );
}

export default function ModQueuePanel({ onClose, actorId }) {
  const [pending, setPending] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch(`${BACKEND_URL}/api/layout-submissions?actorId=${encodeURIComponent(actorId || '')}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        // Flatten: server nests the layout under `layout`, panel reads top-level fields.
        const items = (data.items || []).map((row) => ({
          ...(row.layout || {}),
          _id: row.id,
          roomId: row.roomId,
          roomName: row.roomName,
          submitterName: row.submitterName,
          submittedAt: row.submittedAt,
        }));
        setPending(items);
      })
      .catch(() => setPending([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const review = (index, approveIt) => {
    const item = pending[index];
    if (!item?._id) return;
    fetch(`${BACKEND_URL}/api/layout-submissions/${encodeURIComponent(item._id)}/${approveIt ? 'approve' : 'reject'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorId }),
    })
      .then((r) => {
        if (!r.ok) throw new Error('review failed');
        return r.json();
      })
      .then(() => {
        if (approveIt) {
          // Award coins to the reviewer for moderating
          earnCoins(APPROVAL_BONUS, 'layout-approved');
          setMessage(`✅ Approved "${item.roomName || item.roomId}" — +${APPROVAL_BONUS} coins for reviewing.`);
        } else {
          setMessage('❌ Submission rejected and removed.');
        }
        setPending(pending.filter((_, i) => i !== index));
        setTimeout(() => setMessage(''), 4000);
      })
      .catch(() => {
        setMessage('⚠️ Review failed — are you still logged in as a moderator?');
        setTimeout(() => setMessage(''), 4000);
      });
  };

  const approve = (index) => review(index, true);
  const reject = (index) => review(index, false);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.75)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 12,
    }}>
      <div style={{
        background: '#14101e', borderRadius: 14, border: '3px solid #ffb02e',
        maxWidth: 700, width: '100%', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        color: '#f4f1e6', fontFamily: 'Courier New, monospace',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '2px solid #ffb02e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>📋 Layout Review Queue ({pending.length})</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#f4f1e6', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {message && (
            <div style={{ padding: '10px 14px', marginBottom: 12, background: '#1e1830', border: '2px solid #4ade80', borderRadius: 8, fontSize: 13 }}>
              {message}
            </div>
          )}
          {loading && (
            <div style={{ textAlign: 'center', color: '#8a8296', padding: '40px 20px', fontSize: 14 }}>
              Loading submissions…
            </div>
          )}
          {!loading && pending.length === 0 && (
            <div style={{ textAlign: 'center', color: '#8a8296', padding: '40px 20px', fontSize: 14 }}>
              No pending submissions. 🎉<br />
              <span style={{ fontSize: 12 }}>Submitted layouts will appear here for review.</span>
            </div>
          )}
          {pending.map((item, i) => (
            <div key={i} style={{
              border: '2px solid #3a3348', borderRadius: 10, padding: 14, marginBottom: 14,
              background: '#1a1428',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{item.roomName || item.roomId}</div>
                  <div style={{ fontSize: 11, color: '#8a8296' }}>
                    {item.roomId} · {item.version === 2 ? 'freehand' : `${item.walls?.length || 0} walls`} · {item.furniture?.length || 0} items<br />
                    by {item.submitterName || 'someone'} ·{' '}
                    {item.submittedAt ? new Date(item.submittedAt).toLocaleString() : 'unknown time'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, overflowX: 'auto' }}>
                <LayoutPreview layout={item} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => approve(i)}
                  style={{ flex: 1, padding: '10px', fontSize: 14, cursor: 'pointer', background: '#4ade80', border: 'none', color: '#14101e', borderRadius: 8, fontWeight: 700, fontFamily: 'inherit' }}>
                  ✅ Approve
                </button>
                <button onClick={() => reject(i)}
                  style={{ flex: 1, padding: '10px', fontSize: 14, cursor: 'pointer', background: 'transparent', border: '2px solid #ef4444', color: '#ef4444', borderRadius: 8, fontWeight: 700, fontFamily: 'inherit' }}>
                  ❌ Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
