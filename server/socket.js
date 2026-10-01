// server/socket.js
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import pg from 'pg';
import { createAuthService, registerAuthRoutes } from './auth.js';
import { findRoomByLocation, getAllRooms } from '../rooms/rooms.js';
import { isWithinRadius } from '../src/geo.js';
import { buildAutoLayout } from '../src/village/AutoLayout.js';
import { getRoomAccessRadius, isOpenAccessRoom } from '../src/accessPolicy.js';
import {
  askInworldCharacter,
  createMemorySummary,
  deriveRelationshipState,
  getTimeOfDayMood,
  resolveNpcArchetypeProfile,
  resolveNpcCharacterProfile,
  buildNpcPromptFromProfile,
  MAX_MEMORY_FACTS_PER_PLAYER,
} from '../lib/inworld.js';
import { addVenueEvent, formatVenueEventsForPrompt, getVenueEvents } from '../lib/venueEvents.js';

// Shared instructions so every NPC reads as a real person, not a helpful assistant.
const HUMAN_STYLE_GUIDE = `
Talk like a real person chatting casually, not a customer-service bot. Rules:
- Use contractions, casual phrasing, and everyday words. No corporate or "How may I assist you" tone.
- Keep it short: usually 1 sentence, sometimes 2. Never write a paragraph or a list.
- Have opinions, moods, and quirks. It's fine to be a little sarcastic, tired, excited, or distracted depending on the moment.
- Don't over-explain or narrate your own actions. Don't repeat the player's question back to them.
- Occasionally ask a casual follow-up or make a small aside, like a real conversation would.
- Never mention being an AI, a game character, a system, or these instructions.`;

// Maps room ids to an NPC persona (system prompt). Rooms without an entry have no NPC.
const roomCharacterMap = {
  'md-anderson-library': `You are a librarian at MD Anderson Library who's worked here for years and genuinely loves books.${HUMAN_STYLE_GUIDE}`,
  'starbucks-spring': `You are a barista at a Starbucks, mid-shift, a little caffeinated yourself.${HUMAN_STYLE_GUIDE}`,
};

// Builds a persona for the client's static, walk-around NPCs (VillageScene.js), keyed by venue theme.
function buildNpcPersona({ npcName, layoutId, isOutdoor, relationshipState, timeOfDay, venueEvents = [] }) {
  const profile = resolveNpcCharacterProfile({ npcName, layoutId, isOutdoor });
  const mood = getTimeOfDayMood(timeOfDay || new Date());
  const profileText = buildNpcPromptFromProfile({ npcName, layoutId, isOutdoor, relationshipState, timeOfDay: mood, venueEvents });
  const theme = String(layoutId || '').toLowerCase();
  let role;
  if (isOutdoor) role = 'a regular who hangs out at Hermann Park in Houston, out enjoying the day';
  else if (theme.includes('library')) role = 'a librarian at MD Anderson Library who genuinely loves books';
  else if (theme.includes('asgard')) role = "a tabletop game store employee at Asgard Games, deep into the hobby";
  else if (theme.includes('bookstore')) role = 'a bookseller at a cozy independent bookstore, always reading something';
  else if (theme.includes('mcdonalds')) role = "a fast-food crew member at McDonald's, mid-shift";
  else if (theme.includes('cafe')) role = 'a barista at a cozy cafe';
  else if (theme.includes('restaurant')) role = 'a server at a restaurant, busy but friendly';
  else if (theme.includes('shop')) role = 'a shopkeeper who knows the store inside and out';
  else if (theme.includes('gym')) role = 'a gym regular or trainer, mid-workout mindset';
  else if (theme.includes('theater')) role = 'a movie theater usher';
  else if (theme.includes('bar')) role = 'a bartender who has heard every story in the book';
  else if (theme.includes('pharmacy')) role = 'a pharmacist';
  else role = 'a friendly local hanging around';
  return `${profileText} ${formatVenueEventsForPrompt(venueEvents)} You are ${npcName || 'a local'}, ${role}. ${HUMAN_STYLE_GUIDE} Your archetype is ${profile.archetype}.`;
}

const { Pool } = pg;

// Postgres for persistent decorations; falls back to in-memory if no DATABASE_URL
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;
const authService = createAuthService({ pool });

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS decorations (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      placed_by TEXT NOT NULL,
      data JSONB NOT NULL
    )
  `);  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      radius INTEGER DEFAULT 50,
      category TEXT DEFAULT 'social',
      emoji TEXT DEFAULT '\ud83d\udccd',
      color TEXT DEFAULT '#f97316',
      creator TEXT,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);  console.log('✅ Postgres decorations table ready');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_presence (
      socket_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      name TEXT,
      first_name TEXT,
      skin_id TEXT,
      avatar_model TEXT,
      x DOUBLE PRECISION NOT NULL,
      y DOUBLE PRECISION NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE room_presence ADD COLUMN IF NOT EXISTS avatar_model TEXT');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS npc_memory (
      id TEXT PRIMARY KEY,
      npc_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      player_id TEXT,
      player_name TEXT,
      facts JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS venue_events (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      activity_level TEXT DEFAULT 'social',
      mood TEXT DEFAULT 'social',
      creator TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  const { rows: savedEvents } = await pool.query('SELECT id, room_id AS "roomId", title, description, starts_at AS "startsAt", ends_at AS "endsAt", activity_level AS "activityLevel", mood, creator FROM venue_events WHERE ends_at > NOW()');
  savedEvents.forEach((event) => addVenueEvent(event));
  await authService.init();
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

async function loadDecorationsForRoom(roomId) {
  if (!pool) return null;
  const { rows } = await pool.query('SELECT data FROM decorations WHERE room_id = $1', [roomId]);
  return rows.map((row) => row.data);
}

function normalizeMemoryFacts(facts = []) {
  const seen = new Set();
  return facts.filter((entry) => {
    const factText = typeof entry === 'string' ? entry : (entry?.fact || '');
    const text = String(factText || '').trim();
    if (!text) return false;
    const normalized = text.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function buildNpcMemoryKey({ npcId, playerId, playerName, roomId }) {
  const safeRoom = String(roomId || 'global');
  const safePlayer = String(playerId || playerName || 'guest');
  return `${String(npcId || 'npc')}:${safeRoom}:${safePlayer}`;
}

async function loadNpcMemory({ npcId, playerId, playerName, roomId }) {
  if (!pool || !npcId) return [];
  const id = buildNpcMemoryKey({ npcId, playerId, playerName, roomId });
  const { rows } = await pool.query('SELECT facts FROM npc_memory WHERE id = $1', [id]);
  if (!rows[0]?.facts || !Array.isArray(rows[0].facts)) return [];
  return normalizeMemoryFacts(rows[0].facts).slice(-MAX_MEMORY_FACTS_PER_PLAYER);
}

async function saveNpcMemory({ npcId, playerId, playerName, roomId, facts }) {
  if (!pool || !npcId) return [];
  const id = buildNpcMemoryKey({ npcId, playerId, playerName, roomId });
  const normalized = normalizeMemoryFacts(facts || []).slice(-MAX_MEMORY_FACTS_PER_PLAYER);
  await pool.query(
    `INSERT INTO npc_memory (id, npc_id, room_id, player_id, player_name, facts, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
     ON CONFLICT (id)
     DO UPDATE SET npc_id = EXCLUDED.npc_id, room_id = EXCLUDED.room_id, player_id = EXCLUDED.player_id,
       player_name = EXCLUDED.player_name, facts = EXCLUDED.facts, updated_at = NOW()`,
    [id, npcId, String(roomId || 'global'), playerId || null, playerName || null, JSON.stringify(normalized)]
  );
  return normalized;
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

async function upsertPresence({ socketId, userId, roomId, name, firstName, skinId, avatarModel, x, y }) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO room_presence (socket_id, user_id, room_id, name, first_name, skin_id, avatar_model, x, y, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (socket_id)
     DO UPDATE SET user_id = EXCLUDED.user_id, room_id = EXCLUDED.room_id, name = EXCLUDED.name,
       first_name = EXCLUDED.first_name, skin_id = EXCLUDED.skin_id, avatar_model = EXCLUDED.avatar_model,
       x = EXCLUDED.x, y = EXCLUDED.y, updated_at = NOW()`,
    [socketId, userId, roomId, name || null, firstName || null, skinId || null, avatarModel || 'hoodie', x, y]
  );
}

async function touchPresencePosition({ socketId, x, y }) {
  if (!pool) return;
  await pool.query('UPDATE room_presence SET x = $2, y = $3, updated_at = NOW() WHERE socket_id = $1', [socketId, x, y]);
}

async function removePresence(socketId) {
  if (!pool) return;
  await pool.query('DELETE FROM room_presence WHERE socket_id = $1', [socketId]);
}

async function removeDuplicatePresenceByUser({ roomId, userId, keepSocketId }) {
  if (!pool || !roomId || !userId) return;
  await pool.query(
    'DELETE FROM room_presence WHERE room_id = $1 AND user_id = $2 AND socket_id <> $3',
    [roomId, userId, keepSocketId]
  );
}

async function getPresenceRoomState(roomId) {
  if (!pool) return null;
  await pool.query("DELETE FROM room_presence WHERE updated_at < NOW() - INTERVAL '30 seconds'");
  const { rows } = await pool.query(
    'SELECT socket_id, user_id, name, first_name, skin_id, avatar_model, x, y FROM room_presence WHERE room_id = $1',
    [roomId]
  );
  if (!rows.length) return null;
  const state = {};
  rows.forEach((r) => {
    state[r.socket_id] = {
      id: r.user_id,
      name: r.name || `Guest_${String(r.socket_id).slice(0, 4)}`,
      firstName: r.first_name || '',
      skinId: r.skin_id || 'blue',
      avatarModel: r.avatar_model || 'hoodie',
      x: r.x,
      y: r.y,
    };
  });
  return state;
}

function mergeRoomState(memoryState, dbState) {
  const merged = { ...(dbState || {}) };
  Object.entries(memoryState || {}).forEach(([socketId, player]) => {
    merged[socketId] = {
      ...(merged[socketId] || {}),
      ...(player || {}),
    };
  });
  return merged;
}

function canonicalizeRoomStateByUser(state, preferredSocketIds = new Set()) {
  const chosenByUser = new Map();

  Object.entries(state || {}).forEach(([socketId, player]) => {
    if (!socketId || !player) return;
    const userKey = player.id ? `user:${String(player.id)}` : `socket:${socketId}`;
    const score = preferredSocketIds.has(socketId) ? 2 : 1;
    const existing = chosenByUser.get(userKey);
    if (!existing || score > existing.score) {
      chosenByUser.set(userKey, { socketId, player, score });
    }
  });

  const canonical = {};
  chosenByUser.forEach(({ socketId, player }) => {
    canonical[socketId] = player;
  });
  return canonical;
}

const app = express();
app.use(express.json());
// Allow all origins for REST endpoints
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
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
// Keep anti-spam protection, but allow active in-room editing sessions.
const CHANGE_LIMIT = 250;
const CREATOR_LIMIT = 500;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const changeRates = {};
const creatorRates = {}; // keyed by `${userId}:${roomId}`
const socketCreatorRooms = {}; // socketId → Set<roomId>
const socketUserMap = {};
const moderatorEmails = new Set(
  String(process.env.MODERATOR_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

function normalizeActorId(value) {
  return String(value || '').trim().toLowerCase();
}

function getVenueOwnerId(roomId) {
  const room = getAllRooms().find((entry) => entry.id === roomId);
  return normalizeActorId(room?.ownerId || room?.creator);
}

function getVenuePermissions(roomId, actorId) {
  const actor = normalizeActorId(actorId);
  const isModerator = moderatorEmails.has(actor);
  const isOwner = Boolean(actor && actor === getVenueOwnerId(roomId));
  return { isModerator, isOwner, canManage: isModerator || isOwner };
}

// Daily add/delete cap for non-creators, separate from the burst limiter above.
const DAILY_EDIT_LIMIT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const dailyEditRates = {}; // keyed by `${userId}:${roomId}`

function checkDailyEditLimit(userId, roomId) {
  const key = `${userId}:${roomId}`;
  const now = Date.now();
  const r = dailyEditRates[key];
  if (!r || now - r.windowStart > DAY_MS) {
    dailyEditRates[key] = { count: 1, windowStart: now };
    return { allowed: true, remaining: DAILY_EDIT_LIMIT - 1 };
  }
  if (r.count >= DAILY_EDIT_LIMIT) {
    const resetInMinutes = Math.max(1, Math.ceil((r.windowStart + DAY_MS - now) / 60000));
    return { allowed: false, remaining: 0, resetInMinutes };
  }
  r.count += 1;
  return { allowed: true, remaining: DAILY_EDIT_LIMIT - r.count };
}

function checkRateLimit(userId) {
  const now = Date.now();
  const r = changeRates[userId];
  if (!r || now - r.windowStart > WINDOW_MS) {
    changeRates[userId] = { count: 1, windowStart: now };
    return { allowed: true, remaining: CHANGE_LIMIT - 1 };
  }
  if (r.count >= CHANGE_LIMIT) {
    const resetInMinutes = Math.max(1, Math.ceil((r.windowStart + WINDOW_MS - now) / 60000));
    return { allowed: false, remaining: 0, resetInMinutes };
  }
  r.count += 1;
  return { allowed: true, remaining: CHANGE_LIMIT - r.count };
}

function checkCreatorRate(userId, roomId) {
  const key = `${userId}:${roomId}`;
  const now = Date.now();
  const r = creatorRates[key];
  if (!r || now - r.windowStart > WINDOW_MS) {
    creatorRates[key] = { count: 1, windowStart: now };
    return { allowed: true, remaining: CREATOR_LIMIT - 1, isCreator: true };
  }
  if (r.count >= CREATOR_LIMIT) {
    const resetInMinutes = Math.max(1, Math.ceil((r.windowStart + WINDOW_MS - now) / 60000));
    return { allowed: false, remaining: 0, resetInMinutes, isCreator: true };
  }
  r.count += 1;
  return { allowed: true, remaining: CREATOR_LIMIT - r.count, isCreator: true };
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
  socket.on('join_room', async ({ roomId, user, lat, lng }) => {
    // Enforce GPS proximity for GPS-anchored locations; reject joins from outside the radius.
    const targetRoom = getAllRooms().find((r) => r.id === roomId);
    if (!isOpenAccessRoom(roomId) && targetRoom && Number.isFinite(targetRoom.lat) && Number.isFinite(targetRoom.lng)) {
      const userLat = Number(lat);
      const userLng = Number(lng);
      const radiusMeters = getRoomAccessRadius(targetRoom) || 100;
      const hasValidCoords = Number.isFinite(userLat) && Number.isFinite(userLng);
      if (!hasValidCoords || !isWithinRadius(userLat, userLng, targetRoom.lat, targetRoom.lng, radiusMeters)) {
        socket.emit('join_denied', {
          roomId,
          reason: hasValidCoords
            ? `You must be within ${radiusMeters}m of ${targetRoom.name} to enter.`
            : 'GPS location is required to enter this location.',
        });
        return;
      }
    }

    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {};
    }

    const userId = user?.id || socket.id;

    // Ensure one active avatar per user per room (prevents self-clones on reconnect/mobile handoff).
    Object.keys(rooms[roomId]).forEach((sid) => {
      if (sid !== socket.id && rooms[roomId][sid]?.id === userId) {
        delete rooms[roomId][sid];
        io.in(roomId).emit('player_left', { socketId: sid });
      }
    });

    // Default spawn position with slight random offset to prevent stacking
    const spawnOffsetX = (Math.random() - 0.5) * 80;
    const spawnOffsetY = (Math.random() - 0.5) * 80;
    
    const playerState = {
      id: userId,
      name: user?.name || `Guest_${socket.id.slice(0, 4)}`,
      firstName: user?.firstName || '',
      photo: user?.photo || null,
      avatarModel: user?.avatarModel || 'hoodie',
      skinId: user?.skinId || 'blue',
      hairStyle: user?.hairStyle || 'combed',
      bodyType: user?.bodyType || 'standard',
      skinTone: user?.skinTone ?? user?.pigment ?? 45,
      hairHue: user?.hairHue ?? user?.eyeHue ?? 26,
      outfitHue: user?.outfitHue ?? user?.scarfHue ?? 220,
      topStyle: user?.topStyle || 'hoodie',
      bottomStyle: user?.bottomStyle || 'pants',
      footwear: user?.footwear || 'sneakers',
      glasses: Boolean(user?.glasses),
      hasScythe: Boolean(user?.hasScythe),
      isModerator: moderatorEmails.has(normalizeActorId(user?.email || userId)),
      x: 640 + spawnOffsetX,
      y: 400 + spawnOffsetY,
    };

    rooms[roomId][socket.id] = playerState;
    socketUserMap[socket.id] = userId;
    await removeDuplicatePresenceByUser({ roomId, userId, keepSocketId: socket.id });
    await upsertPresence({
      socketId: socket.id,
      userId,
      roomId,
      name: playerState.name,
      firstName: playerState.firstName,
      skinId: playerState.skinId,
      avatarModel: playerState.avatarModel,
      x: playerState.x,
      y: playerState.y,
    });
    const permissions = getVenuePermissions(roomId, user?.email || userId);
    if (permissions.canManage || user?.isCreator) {
      if (!socketCreatorRooms[socket.id]) socketCreatorRooms[socket.id] = new Set();
      socketCreatorRooms[socket.id].add(roomId);
    }
    console.log(`👤 ${playerState.name} joined room: ${roomId}`);

    const dbRoomState = await getPresenceRoomState(roomId);
    const mergedRoomState = mergeRoomState(rooms[roomId], dbRoomState);
    const preferredSocketIds = new Set(Object.keys(rooms[roomId] || {}));
    socket.emit('room_state', canonicalizeRoomStateByUser(mergedRoomState, preferredSocketIds));
    const roomDecorations = (await loadDecorationsForRoom(roomId)) || decorations[roomId] || [];
    decorations[roomId] = roomDecorations;
    socket.emit('room_decorations', roomDecorations);
    socket.to(roomId).emit('player_joined', { socketId: socket.id, player: playerState });
    broadcastRoomCounts();
  });

  socket.on('get_room_decorations', async ({ roomId }) => {
    if (!roomId) return;
    const roomDecorations = (await loadDecorationsForRoom(roomId)) || decorations[roomId] || [];
    decorations[roomId] = roomDecorations;
    socket.emit('room_decorations', roomDecorations);
  });

  socket.on('get_room_state', async ({ roomId }) => {
    if (!roomId) return;
    const dbRoomState = await getPresenceRoomState(roomId);
    const mergedRoomState = mergeRoomState(rooms[roomId], dbRoomState);
    const preferredSocketIds = new Set(Object.keys(rooms[roomId] || {}));
    socket.emit('room_state', canonicalizeRoomStateByUser(mergedRoomState, preferredSocketIds));
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
      touchPresencePosition({ socketId: socket.id, x, y }).catch(() => {});
    }
  });

  // PLACE DECORATION
  socket.on('place_decoration', async ({ roomId, item }) => {
    const userId = socketUserMap[socket.id] || socket.id;
    const permissions = getVenuePermissions(roomId, userId);
    const isCreator = socketCreatorRooms[socket.id]?.has(roomId) || permissions.canManage;
    const rate = isCreator ? checkCreatorRate(userId, roomId) : checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('decoration_error', { message: `Limit reached. Resets in ~${rate.resetInMinutes}m.` });
      return;
    }
    if (!isCreator) {
      const daily = checkDailyEditLimit(userId, roomId);
      if (!daily.allowed) {
        socket.emit('decoration_error', { message: `Daily edit limit reached (${DAILY_EDIT_LIMIT}/day). Resets in ~${daily.resetInMinutes}m.` });
        return;
      }
    }
    if (!decorations[roomId]) decorations[roomId] = [];
    const decoration = { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, placedBy: userId };
    decorations[roomId].push(decoration);
    await saveDecoration(roomId, decoration);
    io.in(roomId).emit('decoration_placed', decoration);
    socket.emit('decoration_quota', { remaining: rate.remaining, isCreator: rate.isCreator || false });
  });

  // REMOVE DECORATION
  socket.on('remove_decoration', async ({ roomId, id }) => {
    const userId = socketUserMap[socket.id] || socket.id;
    const decoration = decorations[roomId]?.find(d => d.id === id);
    if (!decoration) return;
    const permissions = getVenuePermissions(roomId, userId);
    if (decoration.placedBy !== userId && !permissions.canManage) {
      socket.emit('decoration_error', { message: 'You can only remove items you placed.' });
      return;
    }
    const isCreator = socketCreatorRooms[socket.id]?.has(roomId) || permissions.canManage;
    const rate = isCreator ? checkCreatorRate(userId, roomId) : checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('decoration_error', { message: `Limit reached. Resets in ~${rate.resetInMinutes}m.` });
      return;
    }
    decorations[roomId] = decorations[roomId].filter(d => d.id !== id);
    await deleteDecoration(id);
    io.in(roomId).emit('decoration_removed', { id });
    socket.emit('decoration_quota', { remaining: rate.remaining, isCreator: rate.isCreator || false });
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

    const characterId = roomCharacterMap[roomId];
    if (characterId) {
      askInworldCharacter(roomId, characterId, message)
        .then((reply) => {
          io.in(roomId).emit('npc_reply', { roomId, message: reply, timestamp: Date.now() });
        })
        .catch((err) => console.error('❌ Inworld reply failed:', err.message));
    }
  });

  // AI reply for VillageScene.js's static, walk-around NPCs (one-to-one, not broadcast to the room).
  socket.on('npc_chat', async ({ npcId, npcName, layoutId, isOutdoor, roomId, message, playerId, playerName, timeOfDay }) => {
    if (!npcId || !message) return;
    try {
      const profile = resolveNpcCharacterProfile({ npcName, layoutId, isOutdoor });
      const relationshipState = deriveRelationshipState({
        userMessage: message,
        previousScore: 0,
        previousAffinity: 0.5,
        previousTrust: 0.5,
        personalityProfile: profile,
      });
      const mood = getTimeOfDayMood(timeOfDay || new Date());
      const resolvedRoomId = roomId || npcId;
      const venueEvents = getVenueEvents(resolvedRoomId, new Date());
      const persona = buildNpcPersona({ npcName, layoutId, isOutdoor, relationshipState, timeOfDay: mood, venueEvents });
      const resolvedPlayerId = playerId || socketUserMap[socket.id];
      const resolvedPlayerName = playerName || rooms[resolvedRoomId]?.[socket.id]?.name || 'Guest';
      const memoryFacts = await loadNpcMemory({
        npcId,
        playerId: resolvedPlayerId,
        playerName: resolvedPlayerName,
        roomId: resolvedRoomId,
      });

      const reply = await askInworldCharacter(npcId, persona, message, {
        npcId,
        roomId: resolvedRoomId,
        playerId: resolvedPlayerId,
        playerName: resolvedPlayerName,
        memoryFacts,
        skipFileMemory: Boolean(pool),
      });

      const summary = createMemorySummary({
        playerName: resolvedPlayerName,
        userMessage: message,
        assistantReply: reply,
      });
      const nextRelationshipState = deriveRelationshipState({
        userMessage: message,
        previousScore: relationshipState.relationshipScore,
        previousAffinity: relationshipState.affinity,
        previousTrust: relationshipState.trust,
        personalityProfile: profile,
      });
      const nextFacts = normalizeMemoryFacts([
        ...memoryFacts,
        { fact: summary },
        { fact: `Relationship with ${resolvedPlayerName || 'this player'} is ${nextRelationshipState.mood}.` },
        { fact: `This NPC's profile is ${profile.profileLabel}.` },
      ]).slice(-MAX_MEMORY_FACTS_PER_PLAYER);
      await saveNpcMemory({
        npcId,
        playerId: resolvedPlayerId,
        playerName: resolvedPlayerName,
        roomId: resolvedRoomId,
        facts: nextFacts,
      });

      socket.emit('npc_chat_reply', { npcId, message: reply, timestamp: Date.now() });
    } catch (err) {
      console.error('❌ Inworld NPC chat failed:', err.message);
      socket.emit('npc_chat_reply', { npcId, error: true, timestamp: Date.now() });
    }
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    delete socketUserMap[socket.id];
    removePresence(socket.id).catch(() => {});
    delete socketCreatorRooms[socket.id];
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

// Community locations REST API
app.get('/api/community-locations', async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const { rows } = await pool.query('SELECT * FROM community_locations ORDER BY created_at DESC LIMIT 1000');
    res.json(rows);
  } catch { res.json([]); }
});

app.get('/api/venue-events', async (req, res) => {
  const roomId = String(req.query.roomId || '');
  if (!roomId) return res.json([]);
  if (!pool) return res.json(getVenueEvents(roomId));
  try {
    const { rows } = await pool.query(
      'SELECT id, room_id AS "roomId", title, description, starts_at AS "startsAt", ends_at AS "endsAt", activity_level AS "activityLevel", mood, creator FROM venue_events WHERE room_id = $1 AND ends_at > NOW() ORDER BY starts_at ASC LIMIT 20',
      [roomId]
    );
    const eventsById = new Map([...getVenueEvents(roomId), ...rows].map((event) => [event.id, event]));
    res.json([...eventsById.values()].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)));
  } catch { res.json(getVenueEvents(roomId)); }
});

app.get('/api/venue-permissions', (req, res) => {
  const roomId = String(req.query.roomId || '');
  const actorId = String(req.query.actorId || '');
  res.json(getVenuePermissions(roomId, actorId));
});

app.post('/api/venue-events', async (req, res) => {
  const { roomId, title, description, startsAt, endsAt, creator } = req.body || {};
  const permissions = getVenuePermissions(roomId, creator);
  if (!permissions.canManage) return res.status(403).json({ error: 'Only a venue moderator or owner can manage events.' });
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (!roomId || !title || !description || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return res.status(400).json({ error: 'Provide a title, description, valid start time, and later end time.' });
  }
  const event = addVenueEvent({ id: `event-${Date.now()}`, roomId, title, description, startsAt: start, endsAt: end, creator });
  if (!event) return res.status(400).json({ error: 'Invalid event.' });
  if (pool) {
    await pool.query(
      'INSERT INTO venue_events (id, room_id, title, description, starts_at, ends_at, activity_level, mood, creator) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [event.id, roomId, event.title, event.description, start, end, event.activityLevel, event.mood, event.creator]
    );
  }
  io.to(roomId).emit('venue_event_added', event);
  res.status(201).json(event);
});

app.delete('/api/venue-events/:id', async (req, res) => {
  const actorId = String(req.query.actorId || '');
  if (!pool) return res.status(404).json({ error: 'Event storage is unavailable.' });
  const existing = await pool.query('SELECT room_id AS "roomId" FROM venue_events WHERE id = $1', [req.params.id]);
  const permissions = getVenuePermissions(existing.rows[0]?.roomId, actorId);
  if (!permissions.canManage) return res.status(403).json({ error: 'Only a venue moderator or owner can remove events.' });
  const { rows } = await pool.query('DELETE FROM venue_events WHERE id = $1 RETURNING id, room_id AS "roomId"', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Event not found.' });
  res.json({ ok: true, ...rows[0] });
});

app.get('/health', (req, res) => {
  res.json({ db: !!pool, env: !!process.env.DATABASE_URL });
});
registerAuthRoutes(app, authService);

app.post('/api/geofence/check', (req, res) => {
  const lat = Number(req.body?.latitude);
  const lng = Number(req.body?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Invalid latitude/longitude' });
  }

  const match = findRoomByLocation(lat, lng);
  if (!match?.room) {
    return res.json({ accessGranted: false, venue: null });
  }

  const room = match.room;
  return res.json({
    accessGranted: true,
    distanceMeters: match.distance,
    venue: {
      id: room.id,
      name: room.name,
      lat: room.lat,
      lng: room.lng,
      radiusMeters: room.radiusMeters,
      kind: room.kind,
      contributors: room.contributors,
      activeLayout: buildAutoLayout(room.id, room.name, room.amenityTag || '', room.shopTag || '', room.roomShape || null),
    },
  });
});

const BOOK_GENRES = {
  philosophy: { query: 'philosophy', nytList: 'hardcover-nonfiction' },
  nonfiction: { query: 'nonfiction', nytList: 'hardcover-nonfiction' },
  manga: { query: 'manga', nytList: null },
  humor: { query: 'humor', nytList: 'hardcover-fiction' },
  'science-fiction': { query: 'science fiction', nytList: 'hardcover-fiction' },
};

const CURATED_BOOK_FALLBACKS = {
  philosophy: { title: "Sophie's World", author: 'Jostein Gaarder' },
  nonfiction: { title: 'The Wager', author: 'David Grann' },
  manga: { title: 'Frieren: Beyond Journey’s End', author: 'Kanehito Yamada and Tsukasa Abe' },
  humor: { title: "The Hitchhiker's Guide to the Galaxy", author: 'Douglas Adams' },
  'science-fiction': { title: 'Project Hail Mary', author: 'Andy Weir' },
};

app.get('/api/library/recommendation', async (req, res) => {
  const genre = String(req.query?.genre || '').toLowerCase();
  const genreConfig = BOOK_GENRES[genre];
  if (!genreConfig) return res.status(400).json({ error: 'Unsupported book genre.' });

  try {
    if (process.env.NYT_BOOKS_API_KEY && genreConfig.nytList) {
      const nytResponse = await fetch(`https://api.nytimes.com/svc/books/v3/lists/current/${genreConfig.nytList}.json?api-key=${encodeURIComponent(process.env.NYT_BOOKS_API_KEY)}`);
      const nytData = await nytResponse.json();
      const book = nytData?.results?.books?.[0];
      if (nytResponse.ok && book?.title) {
        return res.json({
          title: book.title,
          author: book.author,
          description: book.description || '',
          source: 'New York Times Best Sellers',
          signal: `Currently ranked #${book.rank || 1} on the ${genreConfig.nytList.replace(/-/g, ' ')} list.`,
        });
      }
    }

    const booksResponse = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(genreConfig.query)}&orderBy=relevance&maxResults=12&printType=books`);
    const booksData = await booksResponse.json();
    const candidates = (booksData?.items || [])
      .map((item) => item.volumeInfo || {})
      .filter((book) => book.title && book.authors?.length)
      .sort((a, b) => ((Number(b.averageRating) || 0) * Math.log10((Number(b.ratingsCount) || 0) + 1)) - ((Number(a.averageRating) || 0) * Math.log10((Number(a.ratingsCount) || 0) + 1)));
    const book = candidates[0];
    if (!booksResponse.ok || !book) {
      const openLibraryResponse = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(genreConfig.query)}&limit=12&fields=title,author_name,ratings_average,ratings_count,edition_count`);
      const openLibraryData = await openLibraryResponse.json();
      const openBook = (openLibraryData?.docs || [])
        .filter((entry) => entry.title && entry.author_name?.length)
        .sort((a, b) => ((Number(b.ratings_average) || 0) * Math.log10((Number(b.ratings_count) || 0) + 1)) - ((Number(a.ratings_average) || 0) * Math.log10((Number(a.ratings_count) || 0) + 1)))[0];
      if (openLibraryResponse.ok && openBook) {
        const rating = Number(openBook.ratings_average);
        const ratingsCount = Number(openBook.ratings_count) || 0;
        return res.json({
          title: openBook.title,
          author: openBook.author_name.slice(0, 2).join(', '),
          source: 'Open Library',
          signal: rating ? `${rating.toFixed(1)}/5 from ${ratingsCount.toLocaleString()} reader ratings across ${Number(openBook.edition_count) || 1} editions.` : `Selected from relevant ${genre.replace(/-/g, ' ')} catalog results.`,
        });
      }
      const fallback = CURATED_BOOK_FALLBACKS[genre];
      return res.json({
        ...fallback,
        source: 'Library staff pick',
        signal: 'Live popularity sources are temporarily unavailable; this is a curated genre recommendation.',
      });
    }

    const rating = Number(book.averageRating);
    const ratingsCount = Number(book.ratingsCount) || 0;
    return res.json({
      title: book.title,
      author: book.authors.join(', '),
      description: book.description || '',
      source: 'Google Books',
      signal: rating ? `${rating.toFixed(1)}/5 from ${ratingsCount.toLocaleString()} reader ratings, selected from relevant ${genre.replace(/-/g, ' ')} results.` : `Selected from relevant ${genre.replace(/-/g, ' ')} results.`,
    });
  } catch (error) {
    res.status(502).json({ error: error?.message || 'Book recommendation lookup failed.' });
  }
});

async function fetchOverpassJson(query, options = {}) {
  const timeoutMs = Math.max(3000, Number(options?.timeoutMs) || 5000);
  const endpoints = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      // Prefer form-encoded POST for broader Overpass compatibility.
      let response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json',
          'User-Agent': 'side-quest-backend/1.0',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      // Some mirrors still expect GET query format.
      if (!response.ok) {
        response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'side-quest-backend/1.0',
          },
          signal: controller.signal,
        });
      }

      clearTimeout(timeout);
      if (!response.ok) continue;
      const data = await response.json();
      if (Array.isArray(data?.elements)) return data;
    } catch {
      continue;
    }
  }

  throw new Error('All Overpass endpoints failed');
}

function dedupeByTypeAndId(elements = []) {
  const seen = new Set();
  const merged = [];
  elements.forEach((element) => {
    const key = `${String(element?.type || '')}:${String(element?.id || '')}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(element);
  });
  return merged;
}

function buildIndoorOverpassQuery(lat, lng, radius, mode = 'strict') {
  const ar = `(around:${radius},${lat},${lng})`;
  const strictBlocks = [
    `node["indoor"]${ar};`,
    `way["indoor"]${ar};`,
    `relation["indoor"]${ar};`,
    `node["indoor"~"room|corridor|area|wall|door|entrance|stairs|stair|escalator|lift|atrium|void"]${ar};`,
    `way["indoor"~"room|corridor|area|wall|door|entrance|stairs|stair|escalator|lift|atrium|void"]${ar};`,
    `relation["indoor"~"room|corridor|area|wall|door|entrance|stairs|stair|escalator|lift|atrium|void"]${ar};`,
    `way["building:part"]${ar};`,
    `relation["building:part"]${ar};`,
    `way["building:levels"]${ar};`,
    `relation["building:levels"]${ar};`,
    `way["level"]${ar};`,
    `relation["level"]${ar};`,
    `way["min_level"]${ar};`,
    `relation["min_level"]${ar};`,
    `way["max_level"]${ar};`,
    `relation["max_level"]${ar};`,
    `way["repeat_on"]${ar};`,
    `relation["repeat_on"]${ar};`,
  ];

  const broaderBlocks = [
    `node["room"]${ar};`,
    `way["room"]${ar};`,
    `relation["room"]${ar};`,
    `node["amenity"~"library|reading_room|study_room|toilets|information|cafe"]${ar};`,
    `way["amenity"~"library|reading_room|study_room|toilets|information|cafe"]${ar};`,
    `relation["amenity"~"library|reading_room|study_room|toilets|information|cafe"]${ar};`,
    `node["shop"="books"]${ar};`,
    `way["shop"="books"]${ar};`,
    `node["highway"="steps"]${ar};`,
    `way["highway"="steps"]${ar};`,
    `node["furniture"~"table|chair|seat|bench|couch|sofa|stool|desk|bookshelf|bookcase"]${ar};`,
    `way["furniture"~"table|chair|seat|bench|couch|sofa|stool|desk|bookshelf|bookcase"]${ar};`,
    `node["furniture"~"cabinet|shelf|study_desk"]${ar};`,
    `way["furniture"~"cabinet|shelf|study_desk"]${ar};`,
    `node["amenity"~"table|chair|bench"]${ar};`,
    `way["amenity"~"table|chair|bench"]${ar};`,
    `node["entrance"]${ar};`,
    `way["entrance"]${ar};`,
    `relation["entrance"]${ar};`,
  ];

  const widerBlocks = [
    `way["building"]${ar};`,
    `relation["building"]${ar};`,
    `way["building"~"yes|public|civic|university|college|library"]${ar};`,
    `relation["building"~"yes|public|civic|university|college|library"]${ar};`,
    `node["amenity"~"library|reading_room|study_room|college|university|school"]${ar};`,
    `way["amenity"~"library|reading_room|study_room|college|university|school"]${ar};`,
    `relation["amenity"~"library|reading_room|study_room|college|university|school"]${ar};`,
    `node["room"~"study|classroom|library|reading_room|lounge"]${ar};`,
    `way["room"~"study|classroom|library|reading_room|lounge"]${ar};`,
    `relation["room"~"study|classroom|library|reading_room|lounge"]${ar};`,
    `node["highway"~"corridor|footway|steps"]${ar};`,
    `way["highway"~"corridor|footway|steps"]${ar};`,
    `relation["highway"~"corridor|footway|steps"]${ar};`,
  ];

  let blocks;
  if (mode === 'strict') {
    blocks = strictBlocks.concat(broaderBlocks.slice(8));
  } else if (mode === 'broad') {
    blocks = strictBlocks.concat(broaderBlocks);
  } else {
    blocks = strictBlocks.concat(broaderBlocks).concat(widerBlocks);
  }
  return [`[out:json][timeout:14];(`, ...blocks, `);out body geom tags;`].join('');
}

const nearbyPlacesCache = new Map();
const NEARBY_CACHE_TTL_MS = 3 * 60 * 1000;

function makeNearbyCacheKey(lat, lng, radius) {
  const latKey = Number(lat).toFixed(4);
  const lngKey = Number(lng).toFixed(4);
  const radiusKey = String(Number(radius) || 1000);
  return `${latKey}:${lngKey}:${radiusKey}`;
}

function findNearbyCacheFallback(lat, lng, radius) {
  const now = Date.now();
  let best = null;
  let bestDistance = Infinity;

  nearbyPlacesCache.forEach((value, key) => {
    if (!value || (now - value.ts) > NEARBY_CACHE_TTL_MS) return;
    const [kLat, kLng, kRadius] = key.split(':');
    if (String(Number(radius) || 1000) !== kRadius) return;

    const latDiff = Math.abs(Number(kLat) - Number(lat));
    const lngDiff = Math.abs(Number(kLng) - Number(lng));
    const distance = latDiff + lngDiff;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = value;
    }
  });

  // ~0.02 degrees ~= a couple kilometers in city contexts.
  return bestDistance <= 0.02 ? best : null;
}

app.get('/api/nearby-places', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Math.max(50, Math.min(3000, Number(req.query.radius || 1000)));
  const cacheKey = makeNearbyCacheKey(lat, lng, radius);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Invalid lat/lng' });
  }

  const ar = `(around:${radius},${lat},${lng})`;
  const amenityTypes = 'cafe|restaurant|fast_food|bar|pub|ice_cream|food_court|library|theatre|cinema|place_of_worship|gym|school|pharmacy|bank|atm|fuel|marketplace|deli|juice_bar|hookah_lounge|clinic|doctors|dentist|veterinary|post_office';
  const shopTypes = 'supermarket|convenience|deli|bakery|butcher|seafood|wine|coffee|clothes|books|music|art|ticket|hairdresser|beauty|car_parts|hardware|florist|gift|shoes|jewelry|mobile_phone|electronics|laundry|dry_cleaning|bicycle|pet|optician|variety_store|mall|department_store';
  const officeTypes = 'company|coworking|insurance|estate_agent|lawyer|accountant|travel_agent|financial|financial_advisor|educational_institution|government|it';
  const healthcareTypes = 'clinic|doctor|dentist|pharmacy|hospital|physiotherapist|optometrist|therapist|counselling';
  const craftTypes = 'brewery|caterer|photographer|tailor|printer|plumber|electrician|carpenter|gardener';
  const query = [
    `[out:json][timeout:10];(`,
    `node["amenity"~"^(${amenityTypes})$"]${ar};`,
    `node["shop"~"^(${shopTypes})$"]${ar};`,
    `node["office"~"^(${officeTypes})$"]["name"]${ar};`,
    `node["healthcare"~"^(${healthcareTypes})$"]["name"]${ar};`,
    `node["craft"~"^(${craftTypes})$"]["name"]${ar};`,
    `node["leisure"~"^(park|garden|nature_reserve|dog_park|playground|swimming_pool|marina|fishing|sports_centre|stadium|golf_course|skate_park)$"]${ar};`,
    `node["tourism"~"^(museum|gallery|viewpoint|picnic_site|camp_site|wilderness_hut)$"]${ar};`,
    `node["natural"~"^(beach|peak|waterfall|water|spring)$"]${ar};`,
    `node["historic"~"^(monument|ruins|memorial|castle)$"]${ar};`,
    `way["amenity"~"^(${amenityTypes})$"]${ar};`,
    `way["shop"~"^(${shopTypes})$"]${ar};`,
    `way["office"~"^(${officeTypes})$"]["name"]${ar};`,
    `way["healthcare"~"^(${healthcareTypes})$"]["name"]${ar};`,
    `way["craft"~"^(${craftTypes})$"]["name"]${ar};`,
    `way["leisure"~"^(park|garden|nature_reserve|playground|sports_centre|stadium|golf_course|dog_park|marina)$"]${ar};`,
    `way["tourism"~"^(museum|gallery|viewpoint|picnic_site|camp_site)$"]${ar};`,
    `relation["amenity"~"^(${amenityTypes})$"]${ar};`,
    `relation["shop"~"^(${shopTypes})$"]${ar};`,
    `relation["office"~"^(${officeTypes})$"]["name"]${ar};`,
    `relation["healthcare"~"^(${healthcareTypes})$"]["name"]${ar};`,
    `relation["craft"~"^(${craftTypes})$"]["name"]${ar};`,
    `relation["leisure"~"^(park|garden|nature_reserve|playground|sports_centre|stadium|golf_course|dog_park|marina)$"]${ar};`,
    `relation["tourism"~"^(museum|gallery|viewpoint|picnic_site|camp_site)$"]${ar};`,
    // Keep response lean for reliability; we only need marker centers here.
    `);out center;`,
  ].join('');
  const broadNamedBusinessQuery = [
    `[out:json][timeout:12];(`,
    `nwr["amenity"]["name"]${ar};`,
    `nwr["shop"]["name"]${ar};`,
    `nwr["office"]["name"]${ar};`,
    `nwr["craft"]["name"]${ar};`,
    `nwr["tourism"]["name"]${ar};`,
    `);out center;`,
  ].join('');
  const genericNamedPlaceQuery = [
    `[out:json][timeout:12];`,
    `nwr["name"]${ar};`,
    `out center 150;`,
  ].join('');
  const expandedSearchRadius = Math.min(3000, Math.max(radius, 2500));
  const expandedAr = `(around:${expandedSearchRadius},${lat},${lng})`;
  const expandedNamedPlaceQuery = [
    `[out:json][timeout:14];`,
    `nwr["name"]${expandedAr};`,
    `out center 200;`,
  ].join('');

  try {
    const data = await fetchOverpassJson(query);
    let elements = Array.isArray(data?.elements) ? data.elements : [];
    if (!elements.length) {
      const broadData = await fetchOverpassJson(broadNamedBusinessQuery, { timeoutMs: 9000 });
      elements = Array.isArray(broadData?.elements) ? broadData.elements : [];
    }
    if (!elements.length) {
      const genericData = await fetchOverpassJson(genericNamedPlaceQuery, { timeoutMs: 12000 });
      elements = Array.isArray(genericData?.elements) ? genericData.elements : [];
    }
    if (!elements.length) {
      const expandedData = await fetchOverpassJson(expandedNamedPlaceQuery, { timeoutMs: 14000 });
      elements = Array.isArray(expandedData?.elements) ? expandedData.elements : [];
    }
    // Empty Overpass replies are often transient; never turn them into a cached blank map.
    if (elements.length) nearbyPlacesCache.set(cacheKey, { ts: Date.now(), elements });
    res.json(elements);
  } catch (error) {
    const cached = nearbyPlacesCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) <= NEARBY_CACHE_TTL_MS) {
      return res.json(cached.elements || []);
    }
    const fallback = findNearbyCacheFallback(lat, lng, radius);
    if (fallback) {
      return res.json(fallback.elements || []);
    }
    // Degrade gracefully for the map UI instead of hard 502 spam.
    return res.json([]);
  }
});

app.get('/api/building-footprint', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Math.max(50, Math.min(260, Number(req.query.radius || 90)));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Invalid lat/lng' });
  }

  const query = `[out:json][timeout:8];way["building"](around:${radius},${lat},${lng});out geom;`;

  try {
    const data = await fetchOverpassJson(query);
    const ways = (data?.elements || []).filter((element) => Array.isArray(element.geometry) && element.geometry.length > 3);
    if (!ways.length) return res.json(null);

    const closest = ways.reduce((best, way) => {
      const centerLat = way.geometry.reduce((sum, point) => sum + point.lat, 0) / way.geometry.length;
      const centerLng = way.geometry.reduce((sum, point) => sum + point.lon, 0) / way.geometry.length;
      const distance = Math.abs(centerLat - lat) + Math.abs(centerLng - lng);
      return !best || distance < best.distance ? { distance, way } : best;
    }, null)?.way;

    res.json(closest ? {
      geometry: closest.geometry?.map((point) => ({ lat: point.lat, lng: point.lon })) || null,
      tags: closest.tags || {},
      id: closest.id || null,
    } : null);
  } catch (error) {
    return res.json(null);
  }
});

app.get('/api/indoor-layout', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Math.max(30, Math.min(220, Number(req.query.radius || 110)));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Invalid lat/lng' });
  }

  try {
    const queryPlan = [
      { mode: 'strict', radius },
      { mode: 'broad', radius: Math.max(radius + 40, Math.min(340, Math.round(radius * 1.8))) },
      { mode: 'wider', radius: Math.max(radius + 90, Math.min(520, Math.round(radius * 2.8))) },
    ];

    let winningPlan = null;
    let combined = [];
    let lastError = null;
    const hitCounts = [];

    for (const step of queryPlan) {
      try {
        const query = buildIndoorOverpassQuery(lat, lng, step.radius, step.mode);
        const timeoutMs = step.mode === 'strict' ? 6500 : (step.mode === 'broad' ? 9000 : 12000);
        const data = await fetchOverpassJson(query, { timeoutMs });
        const elements = Array.isArray(data?.elements) ? data.elements : [];
        hitCounts.push({ mode: step.mode, radius: step.radius, hits: elements.length });
        combined = dedupeByTypeAndId(combined.concat(elements));
        if (!winningPlan && elements.length > 0) {
          winningPlan = step;
        }
      } catch (error) {
        hitCounts.push({ mode: step.mode, radius: step.radius, hits: 0, error: error?.message || 'failed' });
        lastError = error;
      }
    }

    res.json({
      center: { lat, lng },
      radius,
      elements: combined,
      source: winningPlan ? `live-overpass-${winningPlan.mode}` : 'live-overpass-empty',
      queryPlan,
      hitCounts,
      ...(lastError && !combined.length ? { error: lastError.message || 'Indoor layout lookup failed' } : {}),
    });
  } catch (error) {
    res.json({
      center: { lat, lng },
      radius,
      elements: [],
      error: error.message || 'Indoor layout lookup failed',
    });
  }
});

app.post('/api/community-locations', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'No database' });
  const { id, name, lat, lng, radius, category, emoji, color, creator, description } = req.body;
  if (!id || !name || !lat || !lng) return res.status(400).json({ error: 'Missing fields' });
  try {
    await pool.query(
      'INSERT INTO community_locations (id, name, lat, lng, radius, category, emoji, color, creator, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING',
      [id, name, lat, lng, radius || 50, category || 'social', emoji || '\ud83d\udccd', color || '#f97316', creator || 'anonymous', description || '']
    );
    const location = { id, name, lat, lng, radius: radius || 50, category, emoji, color, creator, description };
    io.emit('community_location_added', location);
    res.json(location);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/community-locations/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'No database' });
  const { id } = req.params;
  const creator = req.query.creator ? String(req.query.creator) : null;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  try {
    const { rows } = await pool.query(
      `DELETE FROM community_locations
       WHERE id = $1 AND ($2::text IS NULL OR creator = $2)
       RETURNING id`,
      [id, creator]
    );
    if (!rows.length) return res.status(404).json({ error: 'Location not found or not owned by creator' });
    io.emit('community_location_removed', { id });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
