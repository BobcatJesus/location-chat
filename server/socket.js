// server/socket.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import pg from 'pg';

const { Pool } = pg;

// Postgres for persistent decorations; falls back to in-memory if no DATABASE_URL
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS decorations (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      placed_by TEXT NOT NULL,
      data JSONB NOT NULL
    )
  `);
  console.log('✅ Postgres decorations table ready');
}

async function loadDecorations() {
  if (!pool) return {};
  const { rows } = await pool.query('SELECT room_id, data FROM decorations');
  return rows.reduce((acc, row) => {
    if (!acc[row.room_id]) acc[row.room_id] = [];
    acc[row.room_id].push(row.data);
    return acc;
  }, {});
}

async function saveDecoration(roomId, decoration) {
  if (!pool) return;
  await pool.query(
    'INSERT INTO decorations (id, room_id, placed_by, data) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET data = $4',
    [decoration.id, roomId, decoration.placedBy, decoration]
  );
}

async function deleteDecoration(id) {
  if (!pool) return;
  await pool.query('DELETE FROM decorations WHERE id = $1', [id]);
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
const decorations = {}; // populated on startup from Postgres

// Rate limit: { userId: { count: N, windowStart: timestamp } }
const CHANGE_LIMIT = 10;
const WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const changeRates = {};
// Map socketId → userId for decoration ownership
const socketUserMap = {};

function checkRateLimit(userId) {
  const now = Date.now();
  const r = changeRates[userId];
  if (!r || now - r.windowStart > WINDOW_MS) {
    changeRates[userId] = { count: 1, windowStart: now };
    return { allowed: true, remaining: CHANGE_LIMIT - 1 };
  }
  if (r.count >= CHANGE_LIMIT) {
    const resetIn = Math.ceil((r.windowStart + WINDOW_MS - now) / 3600000);
    return { allowed: false, remaining: 0, resetIn };
  }
  r.count += 1;
  return { allowed: true, remaining: CHANGE_LIMIT - r.count };
}

function broadcastRoomCounts() {
  const counts = {};
  Object.entries(rooms).forEach(([roomId, players]) => {
    counts[roomId] = Object.keys(players).length;
  });
  io.emit('room_counts', counts);
}

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
    socketUserMap[socket.id] = user?.id || socket.id;
    console.log(`👤 ${playerState.name} joined room: ${roomId}`);

    socket.emit('room_state', rooms[roomId]);
    socket.emit('room_decorations', decorations[roomId] || []);
    socket.to(roomId).emit('player_joined', { socketId: socket.id, player: playerState });
    broadcastRoomCounts();
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
  socket.on('place_decoration', async ({ roomId, item }) => {
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('decoration_error', { message: `Limit reached. Resets in ~${rate.resetIn}h.` });
      return;
    }
    if (!decorations[roomId]) decorations[roomId] = [];
    const decoration = { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, placedBy: userId };
    decorations[roomId].push(decoration);
    await saveDecoration(roomId, decoration);
    io.in(roomId).emit('decoration_placed', decoration);
    socket.emit('decoration_quota', { remaining: rate.remaining });
  });

  // REMOVE DECORATION
  socket.on('remove_decoration', async ({ roomId, id }) => {
    const userId = socketUserMap[socket.id] || socket.id;
    const decoration = decorations[roomId]?.find(d => d.id === id);
    if (!decoration) return;
    if (decoration.placedBy !== userId) {
      socket.emit('decoration_error', { message: 'You can only remove items you placed.' });
      return;
    }
    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('decoration_error', { message: `Limit reached. Resets in ~${rate.resetIn}h.` });
      return;
    }
    decorations[roomId] = decorations[roomId].filter(d => d.id !== id);
    await deleteDecoration(id);
    io.in(roomId).emit('decoration_removed', { id });
    socket.emit('decoration_quota', { remaining: rate.remaining });
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
    delete socketUserMap[socket.id];
    Object.keys(rooms).forEach((roomId) => {
      if (rooms[roomId][socket.id]) {
        delete rooms[roomId][socket.id];
        io.in(roomId).emit('player_left', { socketId: socket.id });
      }
    });
    broadcastRoomCounts();
  });
});

// 3. Serve Compiled React Static Production Files
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, '../dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// 4. Start Server
const PORT = process.env.PORT || 4000;
async function start() {
  await initDb();
  const loaded = await loadDecorations();
  Object.assign(decorations, loaded);
  console.log(`ᾩ1 Loaded decorations for ${Object.keys(decorations).length} room(s)`);
  server.listen(PORT, () => {
    console.log(`\n===========================================`);
    console.log(`🚀 2D Spatial MVP Server is Live!`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`===========================================\n`);
  });
}
start();
