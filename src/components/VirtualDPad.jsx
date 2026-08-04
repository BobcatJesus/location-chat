// src/components/VirtualDPad.jsx
import React from 'react';

export default function VirtualDPad({ onMove }) {
  // Triggers movement step in the given direction
  const handleDirectionClick = (direction) => {
    if (onMove) {
      onMove(direction);
    }
  };

  return (
    <div style={styles.dpadContainer}>
      {/* UP BUTTON */}
      <button
        style={{ ...styles.button, gridArea: 'up' }}
        onClick={() => handleDirectionClick('UP')}
        aria-label="Move Up"
      >
        ▲
      </button>

      {/* LEFT BUTTON */}
      <button
        style={{ ...styles.button, gridArea: 'left' }}
        onClick={() => handleDirectionClick('LEFT')}
        aria-label="Move Left"
      >
        ◄
      </button>

      {/* CENTER / STOP CAP */}
      <div style={styles.centerCap}>
        <div style={styles.centerDot} />
      </div>

      {/* RIGHT BUTTON */}
      <button
        style={{ ...styles.button, gridArea: 'right' }}
        onClick={() => handleDirectionClick('RIGHT')}
        aria-label="Move Right"
      >
        ►
      </button>

      {/* DOWN BUTTON */}
      <button
        style={{ ...styles.button, gridArea: 'down' }}
        onClick={() => handleDirectionClick('DOWN')}
        aria-label="Move Down"
      >
        ▼
      </button>
    </div>
  );
}

// Retro Arcade D-Pad Styling
const styles = {
  dpadContainer: {
    display: 'grid',
    gridTemplateAreas: `
      ". up ."
      "left center right"
      ". down ."
    `,
    gridTemplateColumns: '48px 48px 48px',
    gridTemplateRows: '48px 48px 48px',
    gap: '4px',
    backgroundColor: '#222',
    padding: '8px',
    borderRadius: '50%',
    border: '3px solid #444',
    boxShadow: '0 6px 12px rgba(0,0,0,0.6)',
    userSelect: 'none',
    touchAction: 'manipulation',
    width: 'fit-content',
  },
  button: {
    backgroundColor: '#333',
    color: '#FFD700',
    border: '2px solid #555',
    borderRadius: '6px',
    fontSize: '18px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    outline: 'none',
    WebkitTapHighlightColor: 'transparent',
  },
  centerCap: {
    gridArea: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#444',
  },
};
