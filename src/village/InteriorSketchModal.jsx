import React, { useState, useRef } from 'react';

// InteriorSketchModal — top-down floor plan editor for venue interiors.
// Grid-based: draw walls, then drag-and-drop furniture. Submit for mod review.

const GRID_W = 20;
const GRID_H = 15;
const CELL = 28;

const FURNITURE = [
  { type: 'bar', label: '🍺 Bar', w: 4, h: 1, color: '#8b5a2b' },
  { type: 'table', label: '🪑 Table', w: 2, h: 2, color: '#a78bfa' },
  { type: 'stage', label: '🎤 Stage', w: 4, h: 2, color: '#ff3da6' },
  { type: 'jukebox', label: '🎵 Jukebox', w: 1, h: 1, color: '#ffb02e' },
  { type: 'entrance', label: '🚪 Entrance', w: 2, h: 1, color: '#35e0ff' },
  { type: 'npc', label: '🧍 NPC spot', w: 1, h: 1, color: '#4ade80' },
  { type: 'dancefloor', label: '💃 Dance floor', w: 3, h: 3, color: '#f472b6' },
  { type: 'counter', label: '🧾 Counter', w: 3, h: 1, color: '#94a3b8' },
];

export default function InteriorSketchModal({ roomName, onSubmit, onClose }) {
  const [tool, setTool] = useState('wall'); // wall | erase | furniture
  const [walls, setWalls] = useState(new Set());
  const [furniture, setFurniture] = useState([]);
  const [selectedFurniture, setSelectedFurniture] = useState(FURNITURE[0]);
  const [selectedPlaced, setSelectedPlaced] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [error, setError] = useState('');

  const key = (x, y) => `${x},${y}`;

  const toggleWall = (x, y) => {
    const k = key(x, y);
    setWalls((prev) => {
      const next = new Set(prev);
      if (tool === 'wall') next.add(k);
      else if (tool === 'erase') next.delete(k);
      return next;
    });
  };

  const handleCellDown = (x, y) => {
    if (tool === 'furniture') {
      placeFurniture(x, y);
    } else {
      setIsDrawing(true);
      toggleWall(x, y);
    }
  };

  const handleCellEnter = (x, y) => {
    if (isDrawing && tool !== 'furniture') toggleWall(x, y);
  };

  const placeFurniture = (x, y) => {
    const f = selectedFurniture;
    // Clamp to grid
    const px = Math.min(x, GRID_W - f.w);
    const py = Math.min(y, GRID_H - f.h);
    // Check overlap
    const overlap = furniture.some((item) => {
      return px < item.x + item.w && px + f.w > item.x &&
             py < item.y + item.h && py + f.h > item.y;
    });
    if (overlap) { setError('That spot is taken — try another.'); return; }
    setError('');
    setFurniture((prev) => [...prev, { ...f, x: px, y: py, id: Date.now() }]);
  };

  const removeFurniture = (id) => {
    setFurniture((prev) => prev.filter((f) => f.id !== id));
    setSelectedPlaced(null);
  };

  const handleSubmit = () => {
    if (walls.size === 0) { setError('Draw some walls first to outline the room.'); return; }
    onSubmit({
      gridW: GRID_W, gridH: GRID_H,
      walls: [...walls].map((k) => { const [x, y] = k.split(',').map(Number); return { x, y }; }),
      furniture: furniture.map(({ id, ...rest }) => rest),
      roomName,
    });
  };

  const renderGrid = () => {
    const cells = [];
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const isWall = walls.has(key(x, y));
        cells.push(
          <rect
            key={key(x, y)}
            x={x * CELL} y={y * CELL} width={CELL} height={CELL}
            fill={isWall ? '#2b2b33' : '#1e1830'}
            stroke="#3a3348" strokeWidth={0.5}
            style={{ cursor: tool === 'furniture' ? 'copy' : 'crosshair' }}
            onMouseDown={() => handleCellDown(x, y)}
            onMouseEnter={() => handleCellEnter(x, y)}
          />
        );
      }
    }
    return cells;
  };

  const renderFurniture = () => {
    return furniture.map((f) => (
      <g key={f.id}
        onClick={(e) => { e.stopPropagation(); setSelectedPlaced(f.id); }}
        style={{ cursor: 'pointer' }}
      >
        <rect
          x={f.x * CELL} y={f.y * CELL}
          width={f.w * CELL} height={f.h * CELL}
          fill={f.color} fillOpacity={0.7}
          stroke={selectedPlaced === f.id ? '#fff' : f.color}
          strokeWidth={selectedPlaced === f.id ? 3 : 1}
          rx={4}
        />
        <text
          x={f.x * CELL + (f.w * CELL) / 2}
          y={f.y * CELL + (f.h * CELL) / 2}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={f.w === 1 && f.h === 1 ? 16 : 12}
          pointerEvents="none"
        >
          {f.label.split(' ')[0]}
        </text>
      </g>
    ));
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.75)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 12,
    }}
    onMouseUp={() => setIsDrawing(false)}
    >
      <div style={{
        background: '#14101e', borderRadius: 14, border: '3px solid #ffb02e',
        maxWidth: 680, width: '100%', maxHeight: '94vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        color: '#f4f1e6', fontFamily: 'Courier New, monospace',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '2px solid #ffb02e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>🏠 Sketch Interior{roomName ? ` — ${roomName}` : ''}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#f4f1e6', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Toolbar */}
        <div style={{ padding: '8px 16px', display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid rgba(255,176,46,0.2)' }}>
          <button onClick={() => setTool('wall')}
            style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', background: tool === 'wall' ? '#ffb02e' : 'transparent', color: tool === 'wall' ? '#14101e' : '#f4f1e6', border: '2px solid #ffb02e', borderRadius: 8, fontWeight: 700, fontFamily: 'inherit' }}>
            🧱 Walls
          </button>
          <button onClick={() => setTool('erase')}
            style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', background: tool === 'erase' ? '#ff3da6' : 'transparent', color: tool === 'erase' ? '#fff' : '#f4f1e6', border: '2px solid #ff3da6', borderRadius: 8, fontWeight: 700, fontFamily: 'inherit' }}>
            🧽 Erase
          </button>
          <button onClick={() => setTool('furniture')}
            style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', background: tool === 'furniture' ? '#35e0ff' : 'transparent', color: tool === 'furniture' ? '#14101e' : '#f4f1e6', border: '2px solid #35e0ff', borderRadius: 8, fontWeight: 700, fontFamily: 'inherit' }}>
            🪑 Furniture
          </button>
          {selectedPlaced && (
            <button onClick={() => removeFurniture(selectedPlaced)}
              style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontFamily: 'inherit' }}>
              🗑 Remove selected
            </button>
          )}
        </div>

        {/* Furniture palette */}
        {tool === 'furniture' && (
          <div style={{ padding: '8px 16px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid rgba(255,176,46,0.2)', background: '#1a1428' }}>
            {FURNITURE.map((f) => (
              <button key={f.type} onClick={() => setSelectedFurniture(f)}
                style={{ padding: '5px 10px', fontSize: 12, cursor: 'pointer', background: selectedFurniture.type === f.type ? f.color : 'transparent', color: '#f4f1e6', border: `2px solid ${f.color}`, borderRadius: 8, fontFamily: 'inherit' }}>
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* Grid canvas */}
        <div style={{ padding: 12, overflow: 'auto', display: 'flex', justifyContent: 'center', background: '#0d0a14' }}>
          <svg width={GRID_W * CELL} height={GRID_H * CELL} style={{ border: '2px solid #3a3348', borderRadius: 4, touchAction: 'none' }}>
            {renderGrid()}
            {renderFurniture()}
          </svg>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '2px solid #ffb02e' }}>
          <div style={{ fontSize: 11, color: '#8a8296', marginBottom: 8 }}>
            {tool === 'wall' ? 'Click and drag to draw walls.' :
             tool === 'erase' ? 'Click and drag to erase walls.' :
             `Click a grid cell to place ${selectedFurniture.label}. Click placed furniture to select, then Remove.`}
          </div>
          {error && <div style={{ color: '#ff3da6', fontSize: 12, marginBottom: 8 }}>{error}</div>}
          <button onClick={handleSubmit}
            style={{ width: '100%', padding: '10px', fontSize: 14, cursor: 'pointer', background: '#35e0ff', border: 'none', color: '#14101e', borderRadius: 8, fontWeight: 700, fontFamily: 'inherit' }}>
            Submit Layout for Review
          </button>
          <div style={{ fontSize: 11, color: '#8a8296', marginTop: 8, textAlign: 'center' }}>
            A moderator will review your layout. 🪙 5 coins if approved!
          </div>
        </div>
      </div>
    </div>
  );
}
