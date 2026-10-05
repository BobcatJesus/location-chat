import React, { useState, useRef, useCallback } from 'react';
import { FURNITURE_CATALOG, makeFurnitureZone } from './furnitureCatalog.js';

// InteriorSketchModal — freehand room designer ("app inside the app").
// Draw the room's outline freehand; it becomes the space. Furnish from the
// shared catalog (same library as the in-game RoomEditor). Submit for review.
//
// Output format v2:
// {
//   version: 2,
//   roomShape: [{x, y}]           // normalized 0..1, closed polygon
//   furniture: [{type, x, y, w, h, rotation, renderAsZone, label}],  // normalized
//   roomName,
// }

const VB_W = 1000;
const VB_H = 700;
const CLOSE_SNAP = 50;   // px: end near start => auto-close
const POINT_MIN_DIST = 5;

const THEME = {
  bg: '#14101e',
  panel: '#1d1626',
  canvasBg: '#0e0b16',
  gold: '#ffb02e',
  cyan: '#35e0ff',
  pink: '#ff3da6',
  text: '#f4f1e6',
  muted: '#8a8296',
  roomFill: 'rgba(255,176,46,0.10)',
  roomStroke: '#ffb02e',
  liveStroke: '#35e0ff',
};

// --- geometry helpers -------------------------------------------------------

function smoothPath(points, close = false) {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }
  const pts = close ? [...points, points[0], points[1]] : [points[0], ...points];
  let d = `M ${pts[0].x} ${pts[0].y}`;
  const n = close ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i === 0 ? (close ? pts.length - 2 : 0) : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  if (close) d += ' Z';
  return d;
}

function polygonPath(points) {
  if (!points || points.length < 3) return '';
  return 'M ' + points.map((p) => `${p.x} ${p.y}`).join(' L ') + ' Z';
}

function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// --- component ---------------------------------------------------------------

export default function InteriorSketchModal({ roomName, onSubmit, onClose }) {
  const [tool, setTool] = useState('draw'); // draw | furniture | select
  const [roomShape, setRoomShape] = useState(null);
  const [stroke, setStroke] = useState(null);
  const [furniture, setFurniture] = useState([]);
  const [catalogType, setCatalogType] = useState(FURNITURE_CATALOG[0].name);
  const [selectedId, setSelectedId] = useState(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [error, setError] = useState('');

  const svgRef = useRef(null);
  const drawingRef = useRef(false);
  const strokeRef = useRef(null);
  const dragIdRef = useRef(null);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const idRef = useRef(1);
  // History lives in a ref to avoid stale-closure bugs; canUndo/canRedo mirror for UI.
  const histRef = useRef({ stack: [], index: -1 });

  const syncHistButtons = useCallback(() => {
    const { stack, index } = histRef.current;
    setCanUndo(index > 0);
    setCanRedo(index < stack.length - 1);
  }, []);

  const commit = useCallback((shape, furn) => {
    const { stack, index } = histRef.current;
    const next = stack.slice(0, index + 1);
    next.push({
      shape: shape ? shape.map((p) => ({ ...p })) : null,
      furniture: furn.map((f) => ({ ...f })),
    });
    const trimmed = next.slice(-60);
    histRef.current = { stack: trimmed, index: trimmed.length - 1 };
    setRoomShape(shape ? shape.map((p) => ({ ...p })) : null);
    setFurniture(furn.map((f) => ({ ...f })));
    syncHistButtons();
  }, [syncHistButtons]);

  const undo = useCallback(() => {
    const { stack, index } = histRef.current;
    if (index <= 0) return;
    const snap = stack[index - 1];
    histRef.current.index = index - 1;
    setRoomShape(snap.shape ? snap.shape.map((p) => ({ ...p })) : null);
    setFurniture(snap.furniture.map((f) => ({ ...f })));
    setSelectedId(null);
    syncHistButtons();
  }, [syncHistButtons]);

  const redo = useCallback(() => {
    const { stack, index } = histRef.current;
    if (index >= stack.length - 1) return;
    const snap = stack[index + 1];
    histRef.current.index = index + 1;
    setRoomShape(snap.shape ? snap.shape.map((p) => ({ ...p })) : null);
    setFurniture(snap.furniture.map((f) => ({ ...f })));
    setSelectedId(null);
    syncHistButtons();
  }, [syncHistButtons]);

  // --- svg coordinates ---------------------------------------------------------
  const toSvg = useCallback((e) => {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * VB_W,
      y: ((e.clientY - rect.top) / rect.height) * VB_H,
    };
  }, []);

  // --- freehand drawing ---------------------------------------------------------
  const finishStroke = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const pts = strokeRef.current;
    strokeRef.current = null;
    setStroke(null);
    if (!pts || pts.length < 8) return;
    let shape = pts;
    const first = shape[0];
    const last = shape[shape.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < CLOSE_SNAP) {
      shape = shape.slice(0, -1);
    }
    const thinned = shape.filter((_, i) => i % 3 === 0);
    if (thinned.length < 3) return;
    // commit() reads current furniture from a ref mirror
    commit(thinned, furnRef.current);
    setError('');
  }, [commit]);

  // Mirror furniture in a ref so finishStroke (no re-render dep) sees it fresh.
  const furnRef = useRef([]);
  furnRef.current = furniture;

  // --- canvas pointer ------------------------------------------------------------
  const onCanvasDown = useCallback((e) => {
    if (e.target !== svgRef.current && !e.target.dataset.canvas) return;
    const pt = toSvg(e);
    if (tool === 'draw') {
      drawingRef.current = true;
      strokeRef.current = [pt];
      setStroke([pt]);
    } else if (tool === 'furniture') {
      const entry = FURNITURE_CATALOG.find((f) => f.name === catalogType);
      const zone = makeFurnitureZone(entry, 0, 0);
      const item = {
        ...zone,
        id: idRef.current++,
        x: Math.max(0, Math.min(VB_W - zone.w, pt.x - zone.w / 2)),
        y: Math.max(0, Math.min(VB_H - zone.h, pt.y - zone.h / 2)),
        rotation: 0,
        icon: entry.icon,
        css: entry.css,
      };
      commit(roomShape, [...furnRef.current, item]);
      setSelectedId(item.id);
      setError('');
    } else {
      setSelectedId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, catalogType, roomShape, toSvg, commit]);

  const onCanvasMove = useCallback((e) => {
    if (!drawingRef.current) return;
    const pt = toSvg(e);
    const prev = strokeRef.current || [];
    const last = prev[prev.length - 1];
    if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < POINT_MIN_DIST) return;
    const next = [...prev, pt];
    strokeRef.current = next;
    setStroke(next);
  }, [toSvg]);

  // --- furniture drag --------------------------------------------------------------
  const onItemDown = useCallback((e, item) => {
    e.stopPropagation();
    setSelectedId(item.id);
    if (tool !== 'select') return;
    dragIdRef.current = item.id;
    const pt = toSvg(e);
    dragOffsetRef.current = { dx: pt.x - item.x, dy: pt.y - item.y };
    try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
  }, [tool, toSvg]);

  const onItemMove = useCallback((e) => {
    const id = dragIdRef.current;
    if (!id) return;
    const pt = toSvg(e);
    const cur = furnRef.current.find((f) => f.id === id);
    if (!cur) return;
    const nx = Math.max(0, Math.min(VB_W - cur.w, pt.x - dragOffsetRef.current.dx));
    const ny = Math.max(0, Math.min(VB_H - cur.h, pt.y - dragOffsetRef.current.dy));
    const next = furnRef.current.map((f) => (f.id === id ? { ...f, x: nx, y: ny } : f));
    furnRef.current = next;
    setFurniture(next);
  }, [toSvg]);

  const onItemUp = useCallback(() => {
    if (dragIdRef.current) {
      dragIdRef.current = null;
      commit(roomShape, furnRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomShape, commit]);

  // --- item ops -----------------------------------------------------------------------
  const rotateSelected = useCallback(() => {
    if (!selectedId) return;
    const next = furnRef.current.map((f) =>
      f.id === selectedId ? { ...f, rotation: ((f.rotation || 0) + 45) % 360 } : f
    );
    commit(roomShape, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, roomShape, commit]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    commit(roomShape, furnRef.current.filter((f) => f.id !== selectedId));
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, roomShape, commit]);

  const clearShape = useCallback(() => {
    commit(null, furnRef.current);
  }, [commit]);

  const clearAll = useCallback(() => {
    commit(null, []);
    setSelectedId(null);
  }, [commit]);

  // --- submit ----------------------------------------------------------------------------
  const handleSubmit = useCallback(() => {
    if (!roomShape || roomShape.length < 3) {
      setError('Draw the room outline first — one closed shape.');
      return;
    }
    const norm = (p) => ({ x: +(p.x / VB_W).toFixed(4), y: +(p.y / VB_H).toFixed(4) });
    const outside = furnRef.current.filter(
      (f) => !pointInPolygon({ x: f.x + f.w / 2, y: f.y + f.h / 2 }, roomShape)
    );
    onSubmit({
      version: 2,
      roomShape: roomShape.map(norm),
      furniture: furnRef.current.map((f) => ({
        type: f.type,
        frameKey: f.frameKey,
        x: +(f.x / VB_W).toFixed(4),
        y: +(f.y / VB_H).toFixed(4),
        w: +(f.w / VB_W).toFixed(4),
        h: +(f.h / VB_H).toFixed(4),
        rotation: f.rotation || 0,
        renderAsZone: f.renderAsZone || null,
        label: f.label,
        solid: f.solid !== false,
      })),
      roomName,
      _warnings: outside.length ? [`${outside.length} item(s) sit outside the room outline.`] : [],
    });
  }, [roomShape, roomName, onSubmit]);

  // --- render ----------------------------------------------------------------------------------
  const selected = furniture.find((f) => f.id === selectedId);

  const btn = (active, activeBg, border, label, onClick, disabled = false) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 14px', fontSize: 13, cursor: disabled ? 'default' : 'pointer',
        borderRadius: 10, fontWeight: 700, fontFamily: 'inherit',
        border: `2px solid ${border}`,
        background: active ? activeBg : 'transparent',
        color: active ? '#14101e' : THEME.text,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.82)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 10,
      }}
      onPointerUp={() => { finishStroke(); onItemUp(); }}
    >
      <div style={{
        background: THEME.bg, borderRadius: 18, border: `3px solid ${THEME.gold}`,
        width: 'min(1060px, 97vw)', height: 'min(860px, 96vh)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        color: THEME.text, fontFamily: 'Courier New, monospace',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 20px', borderBottom: `2px solid ${THEME.gold}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'linear-gradient(180deg, rgba(255,176,46,0.08), transparent)',
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: 0.5 }}>
              ✏️ Room Designer{roomName ? ` — ${roomName}` : ''}
            </div>
            <div style={{ fontSize: 11, color: THEME.muted, marginTop: 2 }}>
              Draw the space freehand, then furnish it. What you draw is what gets built.
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: THEME.text, fontSize: 22, cursor: 'pointer', padding: 6 }}>
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div style={{
          padding: '10px 20px', display: 'flex', gap: 8, flexWrap: 'wrap',
          alignItems: 'center', borderBottom: '1px solid rgba(255,176,46,0.18)',
          background: THEME.panel,
        }}>
          {btn(tool === 'draw', THEME.gold, THEME.gold, '✏️ Draw room', () => setTool('draw'))}
          {btn(tool === 'furniture', THEME.cyan, THEME.cyan, '🪑 Furniture', () => setTool('furniture'))}
          {btn(tool === 'select', THEME.pink, THEME.pink, '👆 Select / move', () => setTool('select'))}
          <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.12)', margin: '2px 4px' }} />
          {btn(false, null, THEME.muted, '↩ Undo', undo, !canUndo)}
          {btn(false, null, THEME.muted, '↪ Redo', redo, !canRedo)}
          <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.12)', margin: '2px 4px' }} />
          {selected && btn(false, null, THEME.pink, '🔄 Rotate', rotateSelected)}
          {selected && btn(false, null, '#ef4444', '🗑 Delete', deleteSelected)}
          {roomShape && btn(false, null, THEME.muted, '🧽 Clear room', clearShape)}
          {(roomShape || furniture.length > 0) &&
            btn(false, null, '#ef4444', '💥 Clear all', clearAll)}
        </div>

        {/* Furniture palette */}
        {tool === 'furniture' && (
          <div style={{
            padding: '10px 20px', display: 'flex', gap: 8,
            overflowX: 'auto', borderBottom: '1px solid rgba(255,176,46,0.18)',
            background: '#151020',
          }}>
            {FURNITURE_CATALOG.map((f) => (
              <button
                key={f.name}
                onClick={() => setCatalogType(f.name)}
                title={f.label}
                style={{
                  flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 2, padding: '8px 10px', minWidth: 72, cursor: 'pointer',
                  background: catalogType === f.name ? 'rgba(53,224,255,0.15)' : 'transparent',
                  border: `2px solid ${catalogType === f.name ? THEME.cyan : 'rgba(255,255,255,0.14)'}`,
                  borderRadius: 10, color: THEME.text, fontFamily: 'inherit',
                }}
              >
                <span style={{ fontSize: 22 }}>{f.icon}</span>
                <span style={{ fontSize: 10, color: THEME.muted, whiteSpace: 'nowrap' }}>{f.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Canvas */}
        <div style={{
          flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', alignItems: 'center',
          background: `radial-gradient(ellipse at center, #171225 0%, ${THEME.canvasBg} 75%)`,
          padding: 14, overflow: 'hidden',
        }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            data-canvas="true"
            onPointerDown={onCanvasDown}
            onPointerMove={onCanvasMove}
            style={{
              width: '100%', height: '100%',
              border: '2px solid rgba(255,176,46,0.25)', borderRadius: 12,
              touchAction: 'none', cursor: tool === 'draw' ? 'crosshair' : tool === 'furniture' ? 'copy' : 'default',
              background: 'rgba(255,255,255,0.015)',
            }}
          >
            {Array.from({ length: 21 }, (_, i) => (
              <line key={`v${i}`} x1={(i * VB_W) / 20} y1={0} x2={(i * VB_W) / 20} y2={VB_H}
                stroke="rgba(255,255,255,0.045)" strokeWidth={1} />
            ))}
            {Array.from({ length: 15 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={(i * VB_H) / 14} x2={VB_W} y2={(i * VB_H) / 14}
                stroke="rgba(255,255,255,0.045)" strokeWidth={1} />
            ))}

            {roomShape && roomShape.length >= 3 && (
              <g>
                <path d={polygonPath(roomShape)} fill={THEME.roomFill}
                  stroke={THEME.roomStroke} strokeWidth={4} strokeLinejoin="round" />
                {roomShape.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={5} fill={THEME.roomStroke} opacity={0.85} />
                ))}
              </g>
            )}

            {stroke && stroke.length > 1 && (
              <path d={smoothPath(stroke)} fill="none"
                stroke={THEME.liveStroke} strokeWidth={4} strokeLinecap="round" opacity={0.9} />
            )}

            {furniture.map((f) => {
              const cx = f.x + f.w / 2;
              const cy = f.y + f.h / 2;
              const isSel = f.id === selectedId;
              const outside = roomShape && !pointInPolygon({ x: cx, y: cy }, roomShape);
              return (
                <g key={f.id}
                  transform={`rotate(${f.rotation || 0} ${cx} ${cy})`}
                  onPointerDown={(e) => onItemDown(e, f)}
                  onPointerMove={onItemMove}
                  style={{ cursor: tool === 'select' ? 'move' : 'pointer' }}
                >
                  <rect
                    x={f.x} y={f.y} width={f.w} height={f.h} rx={8}
                    fill={f.css} fillOpacity={0.55}
                    stroke={isSel ? '#fff' : outside ? '#ef4444' : f.css}
                    strokeWidth={isSel ? 3 : outside ? 2 : 1.5}
                    strokeDasharray={outside ? '6 4' : undefined}
                    style={{ filter: isSel ? 'drop-shadow(0 0 8px rgba(255,255,255,0.5))' : undefined }}
                  />
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                    fontSize={Math.min(26, Math.max(14, f.w / 3))} pointerEvents="none">
                    {f.icon}
                  </text>
                </g>
              );
            })}

            {!roomShape && !stroke && (
              <text x={VB_W / 2} y={VB_H / 2 - 10} textAnchor="middle"
                fill={THEME.muted} fontSize={20} opacity={0.8} pointerEvents="none">
                ✏️ Draw the room's outline with your finger or mouse
              </text>
            )}
            {!roomShape && !stroke && (
              <text x={VB_W / 2} y={VB_H / 2 + 22} textAnchor="middle"
                fill={THEME.muted} fontSize={13} opacity={0.6} pointerEvents="none">
                End near where you started and it snaps closed
              </text>
            )}
          </svg>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: `2px solid ${THEME.gold}`, background: THEME.panel }}>
          <div style={{ fontSize: 12, color: THEME.muted, marginBottom: 8, minHeight: 16 }}>
            {tool === 'draw' && (roomShape
              ? 'Room drawn. Draw again to replace it, or switch to Furniture.'
              : 'Draw one closed outline — that becomes the room.')}
            {tool === 'furniture' && (() => {
              const e = FURNITURE_CATALOG.find((f) => f.name === catalogType);
              return `Tap the canvas to place ${e.icon} ${e.label}.`;
            })()}
            {tool === 'select' && 'Drag furniture to move it. Select an item, then Rotate or Delete.'}
          </div>
          {error && <div style={{ color: THEME.pink, fontSize: 12, marginBottom: 8 }}>{error}</div>}
          <button onClick={handleSubmit}
            style={{
              width: '100%', padding: '12px', fontSize: 15, cursor: 'pointer',
              background: `linear-gradient(180deg, ${THEME.gold}, #e09a1f)`,
              border: 'none', color: '#14101e', borderRadius: 10,
              fontWeight: 800, fontFamily: 'inherit', letterSpacing: 0.5,
            }}>
            Submit Layout for Review
          </button>
          <div style={{ fontSize: 11, color: THEME.muted, marginTop: 8, textAlign: 'center' }}>
            A moderator will review your layout. 🪙 5 coins if approved!
          </div>
        </div>
      </div>
    </div>
  );
}
