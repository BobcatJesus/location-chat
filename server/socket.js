// server/socket.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Persist decorations to file so they survive server restarts
const DATA_FILE = process.env.DATA_PATH
  ? path.join(process.env.DATA_PATH, 'decorations.json')
  : path.join(__dirname, 'decorations.json');

function loadDecorations() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return {}; }
}

function saveDecorations(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8'); } catch (e) { console.warn('Could not save decorations:', e.message); }
}

const app = express();
const server = http.createServer(app);

// 1. Initialize Socket.io with permissive CORS for development/mobile testing
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Store room state in memory: { roomName: { socketId: { id, name, x, y } } }
const rooms = {};
// Store room decorations — loaded from file on startup
const decorations = loadDecorations();
console.log(`🪑 Loaded decorations for ${Object.keys(decorations).length} room(s)`);

// 2. Real-Time Socket Event Handlers
io.on('connection', (socket) => {
  console.log(`⚡ Client connected: ${socket.id}`);

  // JOIN ROOM
  socket.on('join_room', ({ roomId, user }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {};
    }

    // Default spawn position with slight random offset to prevent stacking
    const spawnOffsetX = (Math.random() - 0.5) * 80;
    const spawnOffsetY = (Math.random() - 0.5) * 80;
    
    const playerState = {
      id: user?.id || socket.id,
      name: user?.name || `Guest_${socket.id.slice(0, 4)}`,
      photo: user?.photo || null,
      skinId: user?.skinId || 'blue',
      x: 640 + spawnOffsetX,
      y: 400 + spawnOffsetY,
    };

    rooms[roomId][socket.id] = playerState;
    console.log(`👤 ${playerState.name} joined room: ${roomId}`);

    socket.emit('room_state', rooms[roomId]);
    // Send current decorations to the joining player
    socket.emit('room_decorations', decorations[roomId] || []);
    socket.to(roomId).emit('player_joined', { socketId: socket.id, player: playerState });
  });

  // PLAYER MOVEMENT
  socket.on('send_move', ({ roomId, x, y, direction }) => {
    if (rooms[roomId] && rooms[roomId][socket.id]) {
      rooms[roomId][socket.id].x = x;
      rooms[roomId][socket.id].y = y;

      // Broadcast position update to all other room members
      socket.to(roomId).emit('player_moved', {
        socketId: socket.id,
        x,
        y,
        direction,
      });
    }
  });

  // PLACE DECORATION
  socket.on('place_decoration', ({ roomId, item }) => {
    if (!decorations[roomId]) decorations[roomId] = [];
    const decoration = { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, placedBy: socket.id };
    decorations[roomId].push(decoration);
    saveDecorations(decorations);
    io.in(roomId).emit('decoration_placed', decoration);
  });

  // REMOVE DECORATION
  socket.on('remove_decoration', ({ roomId, id }) => {
    if (decorations[roomId]) {
      decorations[roomId] = decorations[roomId].filter(d => d.id !== id);
      saveDecorations(decorations);
      io.in(roomId).emit('decoration_removed', { id });
    }
  });

  // CHAT MESSAGE (Speech Bubbles)
  socket.on('send_message', ({ roomId, message }) => {
    const player = rooms[roomId]?.[socket.id];

    if (!player) return;

    // Broadcast text + sender position for spatial distance filtering
    io.in(roomId).emit('receive_message', {
      socketId: socket.id,
      senderName: player.name,
      message,
      position: { x: player.x, y: player.y },
      timestamp: Date.now(),
    });
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    
    // Remove player from active rooms
    Object.keys(rooms).forEach((roomId) => {
      if (rooms[roomId][socket.id]) {
        delete rooms[roomId][socket.id];
        io.in(roomId).emit('player_left', { socketId: socket.id });
      }
    });
  });
});

// 3. Serve Compiled React Static Production Files
app.use(express.static(path.join(__dirname, '../dist')));

// Fallback to React index.html for Single Page App routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// 4. Start Server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`\n===========================================`);
  console.log(`🚀 2D Spatial MVP Server is Live!`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`===========================================\n`);
});
