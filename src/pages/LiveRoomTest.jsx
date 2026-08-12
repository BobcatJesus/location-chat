// src/pages/LiveRoomTest.jsx
import React, { useState, useEffect } from 'react';
import { useSpatialSocket } from '../hooks/useSpatialSocket';
import HybridTilemapCanvas from '../components/HybridTilemapCanvas';
import VirtualDPad from '../components/VirtualDPad'; // <--- IMPORT THIS
import { MOCK_BAR_MAP } from '../mockMap';

export default function LiveRoomTest() {
  const [localPos, setLocalPos] = useState({ x: 3, y: 3 });
  const [chatInput, setChatInput] = useState('');
  
  const [username] = useState(() => `Guest_${Math.floor(Math.random() * 899 + 100)}`);

  const { otherPlayers, messages, isConnected, sendMove, sendMessage } = useSpatialSocket(
    'venue_neils_bahr',
    { id: username, name: username }
  );

  // Helper function to process movement direction
  const handleMoveDirection = (dir) => {
    let { x, y } = localPos;

    if (dir === 'UP') y = Math.max(0, y - 1);
    if (dir === 'DOWN') y = Math.min(11, y + 1);
    if (dir === 'LEFT') x = Math.max(0, x - 1);
    if (dir === 'RIGHT') x = Math.min(15, x + 1);

    if (x !== localPos.x || y !== localPos.y) {
      setLocalPos({ x, y });
      sendMove(x, y, dir); // Broadcast to Node socket server
    }
  };

  // Keyboard controls listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w') handleMoveDirection('UP');
      if (e.key === 'ArrowDown' || e.key === 's') handleMoveDirection('DOWN');
      if (e.key === 'ArrowLeft' || e.key === 'a') handleMoveDirection('LEFT');
      if (e.key === 'ArrowRight' || e.key === 'd') handleMoveDirection('RIGHT');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [localPos, sendMove]);

  const handleSendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendMessage(chatInput);
    setChatInput('');
  };

  const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h2>🕹️ 2D Spatial Room</h2>
        <div>
          <span>Status: </span>
          <strong style={{ color: isConnected ? '#28a745' : '#dc3545' }}>
            {isConnected ? 'ONLINE' : 'OFFLINE'}
          </strong>
        </div>
      </header>

      {/* 2D Canvas */}
      <HybridTilemapCanvas
        mapData={MOCK_BAR_MAP}
        localUserPos={localPos}
        otherPlayers={otherPlayers}
        latestSocketMessage={latestMessage}
      />

      {/* Touch Controls Area */}
      <div style={styles.controlsArea}>
        <VirtualDPad onMove={handleMoveDirection} />

        <form onSubmit={handleSendChat} style={styles.chatForm}>
          <input
            type="text"
            placeholder="Type a speech bubble..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            style={styles.input}
          />
          <button type="submit" style={styles.sendBtn}>Chat 💬</button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  container: { padding: '20px', fontFamily: 'monospace', color: '#fff', backgroundColor: '#121212', minHeight: '100vh' },
  header: { marginBottom: '16px' },
  controlsArea: { marginTop: '20px', display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' },
  chatForm: { display: 'flex', gap: '8px', flex: 1, minWidth: '260px' },
  input: { flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#222', color: '#fff', fontFamily: 'monospace' },
  sendBtn: { padding: '10px 16px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 'bold' }
};
// ...existing code...
useEffect(() => {
  const handleKeyDown = (e) => {
    const tag = e.target?.tagName;

    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) {
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'w') handleMoveDirection('UP');
    if (e.key === 'ArrowDown' || e.key === 's') handleMoveDirection('DOWN');
    if (e.key === 'ArrowLeft' || e.key === 'a') handleMoveDirection('LEFT');
    if (e.key === 'ArrowRight' || e.key === 'd') handleMoveDirection('RIGHT');
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [localPos, sendMove]);
// ...existing code...
<form onSubmit={handleSendChat} style={styles.chatForm}>
  <input
    type="text"
    placeholder="Type a speech bubble..."
    value={chatInput}
    onChange={(e) => setChatInput(e.target.value)}
    onKeyDown={(e) => e.stopPropagation()}
    onKeyUp={(e) => e.stopPropagation()}
    style={styles.input}
  />
  <button type="submit" style={styles.sendBtn}>Chat 💬</button>
</form>
// ...existing code...