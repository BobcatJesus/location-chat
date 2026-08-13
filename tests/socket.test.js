import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';

// Inline the server logic so tests don't depend on the running server process
function createTestServer() {
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const rooms = {};

  const canonicalizeRoomStateByUser = (state = {}) => {
    const byUser = new Map();
    Object.entries(state).forEach(([socketId, player]) => {
      if (!player) return;
      const key = player.id ? `user:${String(player.id)}` : `socket:${socketId}`;
      if (!byUser.has(key)) byUser.set(key, { socketId, player });
    });
    const canonical = {};
    byUser.forEach(({ socketId, player }) => {
      canonical[socketId] = player;
    });
    return canonical;
  };

  io.on('connection', (socket) => {
    socket.on('join_room', ({ roomId, user }) => {
      socket.join(roomId);
      if (!rooms[roomId]) rooms[roomId] = {};
      const userId = user?.id || socket.id;

      // Keep one active socket entry per logical user in a room.
      Object.keys(rooms[roomId]).forEach((sid) => {
        if (sid !== socket.id && rooms[roomId][sid]?.id === userId) {
          delete rooms[roomId][sid];
          io.in(roomId).emit('player_left', { socketId: sid });
        }
      });

      const player = {
        id: userId,
        name: user?.name || 'Guest',
        x: 320 + (Math.random() - 0.5) * 60,
        y: 240 + (Math.random() - 0.5) * 60,
      };
      rooms[roomId][socket.id] = player;
      socket.emit('room_state', canonicalizeRoomStateByUser(rooms[roomId]));
      socket.to(roomId).emit('player_joined', { socketId: socket.id, player });
    });

    socket.on('get_room_state', ({ roomId }) => {
      socket.emit('room_state', canonicalizeRoomStateByUser(rooms[roomId] || {}));
    });

    socket.on('send_move', ({ roomId, x, y }) => {
      if (rooms[roomId]?.[socket.id]) {
        rooms[roomId][socket.id].x = x;
        rooms[roomId][socket.id].y = y;
        socket.to(roomId).emit('player_moved', { socketId: socket.id, x, y });
      }
    });

    socket.on('send_message', ({ roomId, message }) => {
      const player = rooms[roomId]?.[socket.id];
      if (!player) return;
      io.in(roomId).emit('receive_message', {
        socketId: socket.id,
        senderName: player.name,
        message,
        position: { x: player.x, y: player.y },
        timestamp: Date.now(),
      });
    });

    socket.on('disconnect', () => {
      Object.keys(rooms).forEach((roomId) => {
        if (rooms[roomId]?.[socket.id]) {
          delete rooms[roomId][socket.id];
          io.in(roomId).emit('player_left', { socketId: socket.id });
        }
      });
    });
  });

  return { httpServer, io };
}

describe('Socket server', () => {
  let httpServer, io, port;
  let client1, client2, client3;

  beforeAll(async () => {
    ({ httpServer, io } = createTestServer());
    await new Promise(resolve => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  afterAll(() => {
    io.close();
    httpServer.close();
  });

  afterEach(() => {
    client1?.disconnect();
    client2?.disconnect();
    client3?.disconnect();
  });

  const connect = () =>
    new Promise(resolve => {
      const c = Client(`http://localhost:${port}`, { transports: ['websocket'] });
      c.on('connect', () => resolve(c));
    });

  it('sends room_state on join_room', async () => {
    client1 = await connect();
    const state = await new Promise(resolve => {
      client1.on('room_state', resolve);
      client1.emit('join_room', { roomId: 'test', user: { id: 'u1', name: 'Alice' } });
    });
    expect(state).toHaveProperty('u1' in state ? 'u1' : client1.id);
  });

  it('broadcasts player_joined to existing players', async () => {
    client1 = await connect();
    await new Promise(resolve => {
      client1.on('room_state', resolve);
      client1.emit('join_room', { roomId: 'join-test', user: { name: 'Alice' } });
    });

    const joined = await new Promise(async resolve => {
      client1.on('player_joined', resolve);
      client2 = await connect();
      client2.emit('join_room', { roomId: 'join-test', user: { name: 'Bob' } });
    });

    expect(joined.player.name).toBe('Bob');
  });

  it('broadcasts player_moved to other players', async () => {
    client1 = await connect();
    client2 = await connect();

    await new Promise(r => { client1.on('room_state', r); client1.emit('join_room', { roomId: 'move-test', user: { name: 'A' } }); });
    await new Promise(r => { client2.on('room_state', r); client2.emit('join_room', { roomId: 'move-test', user: { name: 'B' } }); });

    const moved = await new Promise(resolve => {
      client1.on('player_moved', resolve);
      client2.emit('send_move', { roomId: 'move-test', x: 100, y: 200 });
    });

    expect(moved.x).toBe(100);
    expect(moved.y).toBe(200);
  });

  it('broadcasts receive_message with position', async () => {
    client1 = await connect();
    client2 = await connect();

    await new Promise(r => { client1.on('room_state', r); client1.emit('join_room', { roomId: 'chat-test', user: { name: 'A' } }); });
    await new Promise(r => { client2.on('room_state', r); client2.emit('join_room', { roomId: 'chat-test', user: { name: 'B' } }); });

    const msg = await new Promise(resolve => {
      client1.on('receive_message', resolve);
      client2.emit('send_message', { roomId: 'chat-test', message: 'hello' });
    });

    expect(msg.message).toBe('hello');
    expect(msg.senderName).toBe('B');
    expect(msg.position).toHaveProperty('x');
    expect(msg.position).toHaveProperty('y');
  });

  it('broadcasts player_left on disconnect', async () => {
    client1 = await connect();
    client2 = await connect();

    await new Promise(r => { client1.on('room_state', r); client1.emit('join_room', { roomId: 'dc-test', user: { name: 'A' } }); });
    await new Promise(r => { client2.on('room_state', r); client2.emit('join_room', { roomId: 'dc-test', user: { name: 'B' } }); });

    const left = await new Promise(resolve => {
      client1.on('player_left', resolve);
      client2.disconnect();
    });

    expect(left).toHaveProperty('socketId');
  });

  it('deduplicates same user joining from multiple sockets in room_state', async () => {
    client1 = await connect();
    client2 = await connect();

    await new Promise((r) => {
      client1.on('room_state', r);
      client1.emit('join_room', { roomId: 'dupe-test', user: { id: 'dup-user', name: 'CloneUser' } });
    });

    await new Promise((r) => {
      client2.on('room_state', r);
      client2.emit('join_room', { roomId: 'dupe-test', user: { id: 'dup-user', name: 'CloneUser' } });
    });

    client3 = await connect();
    const state = await new Promise((r) => {
      client3.on('room_state', r);
      client3.emit('join_room', { roomId: 'dupe-test', user: { id: 'observer', name: 'Observer' } });
    });

    const duplicateEntries = Object.values(state || {}).filter((p) => p?.id === 'dup-user');
    expect(duplicateEntries.length).toBe(1);
  });
});
