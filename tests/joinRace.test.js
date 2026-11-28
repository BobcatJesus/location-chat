// Join Race Fix v1 (`sq-join-race-fix-v1`): the join-burst race.
// Regression test for the Nov 27 report: a non-moderator joining
// the Agora saw no notes, no hat, no lights, no puzzle, while the
// moderator (same room, same time) saw them all. The state was in
// the database — the joiner just never received it.
//
// Root cause: join_room awaited the cat load and the hunger
// refresh BEFORE setting rooms[roomId][socket.id]. While it
// yielded, the client's join-burst get_* calls (get_lights,
// get_tree, get_notes, get_hat, get_puzzle) were processed, and
// their handlers require rooms[roomId][socket.id] to exist — so
// they returned early and the state was never sent. The client
// never re-asks. The moderator saw it because his awaits resolved
// fast (the cat was already cached), so his membership was set
// before his burst arrived.
//
// The fix is an ordering invariant: the room membership must be
// set synchronously in join_room, before the first await. This
// test pins that order in the source, because server/socket.js
// boots a server on import and cannot run in vitest (same
// limitation as the moderation / strikes / jukebox kits — their
// server wiring is verified by node --check + code read).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const socketSrc = readFileSync(join(here, '..', 'server', 'socket.js'), 'utf8');

function joinRoomBody() {
  const start = socketSrc.indexOf("socket.on('join_room'");
  expect(start).toBeGreaterThan(-1);
  // The join_room handler runs to the next top-level socket.on at
  // the same indent. Take a generous slice; the order assertions
  // below only look at the first occurrences inside it.
  return socketSrc.slice(start, start + 20000);
}

describe('join_room registers the socket before its first await', () => {
  it('rooms[roomId][socket.id] is set before the cat load await', () => {
    const body = joinRoomBody();
    const assign = body.indexOf('rooms[roomId][socket.id] = playerState;');
    const catAwait = body.indexOf('await ensureCatLoaded(roomId);');
    expect(assign).toBeGreaterThan(-1);
    expect(catAwait).toBeGreaterThan(-1);
    expect(assign).toBeLessThan(catAwait);
  });

  it('rooms[roomId][socket.id] is set before the hunger refresh await', () => {
    const body = joinRoomBody();
    const assign = body.indexOf('rooms[roomId][socket.id] = playerState;');
    const hungerAwait = body.indexOf('await refreshRoomHunger(roomId);');
    expect(assign).toBeGreaterThan(-1);
    expect(hungerAwait).toBeGreaterThan(-1);
    expect(assign).toBeLessThan(hungerAwait);
  });

  it('the membership block sits right after socket.join, before the cat comment', () => {
    const body = joinRoomBody();
    const join = body.indexOf('socket.join(roomId);');
    const assign = body.indexOf('rooms[roomId][socket.id] = playerState;');
    const catComment = body.indexOf('A new player walking in wakes a sleeping cafe cat');
    expect(join).toBeGreaterThan(-1);
    expect(assign).toBeGreaterThan(join);
    expect(catComment).toBeGreaterThan(-1);
    expect(assign).toBeLessThan(catComment);
  });
});
