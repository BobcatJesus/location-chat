// src/pages/SocketTestPage.jsx
import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const SOCKET_SERVER_URL = 'http://localhost:4000';

export default function SocketTestPage() {
  const [isConnected, setIsConnected] = useState(false);
  const [socketId, setSocketId] = useState('');
  const [latency, setLatency] = useState(null);
  const [logs, setLogs] = useState([]);
  const socketRef = useRef(null);

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${msg}`, ...prev]);
  };

  useEffect(() => {
    addLog(`Connecting to ${SOCKET_SERVER_URL}...`);

    // Initialize Socket connection
    const socket = io(SOCKET_SERVER_URL, {
      transports: ['websocket'],
    });
    socketRef.current = socket;

    // 1. Handle Successful Connection
    socket.on('connect', () => {
      setIsConnected(true);
      setSocketId(socket.id);
      addLog(`Connected! Socket ID: ${socket.id}`);
    });

    // 2. Handle Disconnection
    socket.on('disconnect', (reason) => {
      setIsConnected(false);
      setSocketId('');
      addLog(`Disconnected: ${reason}`);
    });

    // 3. Handle Connection Error
    socket.on('connect_error', (err) => {
      addLog(`Connection Error: ${err.message}`);
    });

    // 4. Handle Custom Test Response
    socket.on('pong_test', (data) => {
      const tripTime = Date.now() - data.sentAt;
      setLatency(tripTime);
      addLog(`Received pong from server (${tripTime}ms)`);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Send a test ping event to the Node server
  const sendTestPing = () => {
    if (socketRef.current && isConnected) {
      addLog('Sending test ping to server...');
      socketRef.current.emit('ping_test', { sentAt: Date.now() });
    }
  };

  return (
    <div style={styles.container}>
      <h2>Socket.io Connection Tester</h2>

      {/* Connection Status Indicator */}
      <div style={styles.statusCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              ...styles.statusDot,
              backgroundColor: isConnected ? '#28a745' : '#dc3545',
            }}
          />
          <strong>Status:</strong> {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
        </div>

        {isConnected && (
          <div style={styles.details}>
            <p style={styles.text}>
              <strong>Socket ID:</strong> <code>{socketId}</code>
            </p>
            {latency !== null && (
              <p style={styles.text}>
                <strong>Ping / Latency:</strong> {latency}ms
              </p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ marginBottom: '20px' }}>
        <button
          style={{
            ...styles.button,
            backgroundColor: isConnected ? '#007bff' : '#555',
            cursor: isConnected ? 'pointer' : 'not-allowed',
          }}
          disabled={!isConnected}
          onClick={sendTestPing}
        >
          ⚡ Send Test Ping
        </button>
      </div>

      {/* Event Logs Console */}
      <div style={styles.consoleHeader}>
        <h4>Live Event Console</h4>
        <button style={styles.clearBtn} onClick={() => setLogs([])}>
          Clear Console
        </button>
      </div>

      <div style={styles.console}>
        {logs.length === 0 ? (
          <p style={{ color: '#666', margin: 0 }}>Waiting for events...</p>
        ) : (
          logs.map((log, index) => (
            <div key={index} style={styles.logItem}>
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Styling
const styles = {
  container: {
    padding: '24px',
    maxWidth: '600px',
    margin: '20px auto',
    backgroundColor: '#1a1a1a',
    color: '#fff',
    borderRadius: '8px',
    fontFamily: 'monospace',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  statusCard: {
    padding: '16px',
    backgroundColor: '#262626',
    borderRadius: '6px',
    marginBottom: '20px',
    border: '1px solid #333',
  },
  statusDot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  details: { marginTop: '10px', fontSize: '13px' },
  text: { margin: '4px 0', color: '#ccc' },
  button: {
    padding: '10px 18px',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  consoleHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  clearBtn: {
    background: 'none',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    fontSize: '11px',
    textDecoration: 'underline',
  },
  console: {
    backgroundColor: '#0a0a0a',
    padding: '12px',
    borderRadius: '6px',
    height: '180px',
    overflowY: 'auto',
    border: '1px solid #333',
    fontSize: '12px',
  },
  logItem: {
    padding: '2px 0',
    color: '#00ffcc',
    borderBottom: '1px solid #1a1a1a',
  },
};
