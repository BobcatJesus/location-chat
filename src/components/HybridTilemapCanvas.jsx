
// src/components/HybridTilemapCanvas.jsx
import React, { useRef, useEffect, useState } from 'react';

export default function HybridTilemapCanvas({ 
  mapData, 
  localUserPos = { x: 2, y: 2 }, 
  otherPlayers = {}, // Passed from useSpatialSocket hook
  latestSocketMessage = null // Incoming message object from socket
}) {
  const canvasRef = useRef(null);
  
  // Store active floating chat bubbles keyed by socketId/userId
  // Format: { socketId: { text: "Hello!", expiresAt: 1785800000000 } }
  const [activeBubbles, setActiveBubbles] = useState({});

  // 1. Capture incoming socket chat messages and attach expiration timer
  useEffect(() => {
    if (!latestSocketMessage) return;

    const { socketId, message } = latestSocketMessage;
    const DISPLAY_DURATION_MS = 4000; // 4 seconds

    setActiveBubbles((prev) => ({
      ...prev,
      [socketId]: {
        text: message,
        expiresAt: Date.now() + DISPLAY_DURATION_MS,
      },
    }));
  }, [latestSocketMessage]);

  // 2. Render Loop
  useEffect(() => {
    if (!mapData) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { columns, rows, tileSizePixels } = mapData.grid;

    // Scale canvas up for high DPI displays / clean pixel art rendering
    const TILE_SIZE = tileSizePixels * 2; // e.g. 16px * 2 = 32px rendering size
    canvas.width = columns * TILE_SIZE;
    canvas.height = rows * TILE_SIZE;

    // Clear frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // --- LAYER 1: Ground Tiles ---
    const groundLayer = mapData.layers.ground;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const tileType = groundLayer[r][c];
        ctx.fillStyle = tileType === 1 ? '#8B5A2B' : tileType === 4 ? '#A0522D' : '#222222';
        ctx.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.strokeRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }

    // Helper: Draw 2D Avatar Circle/Sprite
    const drawAvatar = (x, y, color, label) => {
      const centerX = x * TILE_SIZE + TILE_SIZE / 2;
      const centerY = y * TILE_SIZE + TILE_SIZE / 2;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(centerX, centerY, TILE_SIZE / 2.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Username Tag below avatar
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, centerX, centerY + TILE_SIZE / 1.5);
    };

    // --- LAYER 2: Render Remote Avatars (Other Players) ---
    Object.entries(otherPlayers).forEach(([id, player]) => {
      drawAvatar(player.x, player.y, '#3B82F6', player.username || 'Peer');
    });

    // --- LAYER 3: Render Local Avatar ---
    drawAvatar(localUserPos.x, localUserPos.y, '#EF4444', 'You');

    // --- LAYER 4: Render Floating Speech Bubbles ---
    const now = Date.now();

    // Helper function to draw a retro speech bubble at grid cell (x, y)
    const drawSpeechBubble = (x, y, text) => {
      const headX = x * TILE_SIZE + TILE_SIZE / 2;
      const headY = y * TILE_SIZE; // Head top

      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      
      const textMetrics = ctx.measureText(text);
      const padding = 8;
      const bubbleWidth = textMetrics.width + padding * 2;
      const bubbleHeight = 22;
      const offsetAboveHead = 12;

      const bubbleX = headX - bubbleWidth / 2;
      const bubbleY = headY - bubbleHeight - offsetAboveHead;

      // Draw Bubble Background Box
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;

      // Rounded rectangle
      ctx.beginPath();
      ctx.roundRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight, 6);
      ctx.fill();
      ctx.stroke();

      // Draw Bubble Pointer Tail (Triangle pointing down to head)
      ctx.beginPath();
      ctx.moveTo(headX - 5, bubbleY + bubbleHeight);
      ctx.lineTo(headX, headX - 5 > headY ? headY : bubbleY + bubbleHeight + 6);
      ctx.lineTo(headX + 5, bubbleY + bubbleHeight);
      ctx.closePath();
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.stroke();

      // Draw Message Text
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, headX, bubbleY + bubbleHeight / 2);
    };

    // Render active bubbles for remote players
    Object.entries(otherPlayers).forEach(([id, player]) => {
      const bubble = activeBubbles[id];
      if (bubble && bubble.expiresAt > now) {
        drawSpeechBubble(player.x, player.y, bubble.text);
      }
    });

    // Render active bubble for local player if self-talking
    const localBubble = activeBubbles['local_user'] || activeBubbles[latestSocketMessage?.socketId];
    if (localBubble && localBubble.expiresAt > now) {
      drawSpeechBubble(localUserPos.x, localUserPos.y, localBubble.text);
    }

  }, [mapData, localUserPos, otherPlayers, activeBubbles]);

  return (
    <div style={{ display: 'inline-block', position: 'relative' }}>
      <canvas 
        ref={canvasRef} 
        style={{ 
          border: '4px solid #333', 
          borderRadius: '6px', 
          backgroundColor: '#000',
          imageRendering: 'pixelated'
        }} 
      />
    </div>
  );
}

// src/components/HybridTilemapCanvas.jsx
import React, { useRef, useEffect, useState } from 'react';

const PROXIMITY_LIMIT_TILES = 5;

// 1. YOUR MAIN REACT COMPONENT
export default function HybridTilemapCanvas({ 
  mapData, 
  localUserPos = { x: 2, y: 2 }, 
  otherPlayers = {}, 
  latestSocketMessage = null 
}) {
  const canvasRef = useRef(null);
  const [activeBubbles, setActiveBubbles] = useState({});

  useEffect(() => {
    // Canvas rendering logic that calls getTileDistance(...)
  }, [mapData, localUserPos, otherPlayers, activeBubbles]);

  return (
    <div>
      <canvas ref={canvasRef} />
    </div>
  );
}

// ====================================================================
// 2. PASTE HELPER FUNCTIONS HERE (At the bottom, outside the component)
// ====================================================================

/**
 * Calculates Euclidean tile distance between two grid points.
 */
function getTileDistance(posA, posB) {
  if (!posA || !posB) return Infinity;
  const dx = posA.x - posB.x;
  const dy = posA.y - posB.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Checks if sender is within proximity threshold (e.g. 5 tiles).
 */
function isWithinProximity(posA, posB, maxTiles = 5) {
  return getTileDistance(posA, posB) <= maxTiles;
}
 export function isTileWalkable(targetX, targetY, mapData, otherPlayers = {}) {
  if (!mapData || !mapData.grid) return false;

  const { columns, rows } = mapData.grid;

  // 1. BOUNDARY CHECK: Prevent walking off canvas edges
  if (targetX < 0 || targetX >= columns || targetY < 0 || targetY >= rows) {
    return false;
  }

  // 2. GROUND LAYER CHECK (0 = Wall/Void)
  const groundTile = mapData.layers?.ground?.[targetY]?.[targetX];
  if (groundTile === 0 || groundTile === undefined) {
    return false;
  }

  // 3. OBJECT / FURNITURE LAYER CHECK (Non-zero = Solid Object)
  const objectTile = mapData.layers?.objects?.[targetY]?.[targetX];
  if (objectTile && objectTile !== 0) {
    return false;
  }

  // 4. PLAYER OCCUPANCY CHECK: Block if another avatar is standing there
  const isOccupiedByPlayer = Object.values(otherPlayers).some(
    (player) => player.x === targetX && player.y === targetY
  );

  if (isOccupiedByPlayer) {
    return false;
  }

  return true; // Tile is clear and walkable!
}

