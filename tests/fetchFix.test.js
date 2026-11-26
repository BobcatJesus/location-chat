// fetchFix.test.js — Fetch fix v1 (`sq-fetch-fix-v1`). On
// (re)connect the client asks the server for the Christmas lights,
// tree, and snowman state, so a fresh joiner sees the saved strands
// instead of bare ones. The burst is inline in VillageScene's
// connect handler (a Phaser scene — not instantiable under vitest),
// so this test pins the burst textually: the three emits must sit
// in the connect burst, after get_puzzle and before get_board.
// A burst without them renders bare strands even when the server
// has the state saved (persistence working, fetch missing).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FETCH_FIX_MARKER = 'sq-fetch-fix-v1';
const FETCH_EVENTS = ['get_lights', 'get_tree', 'get_snowman'];

// The connect burst: from the connect handler to the get_time_phase
// emit that closes it. Scoping to this slice keeps the
// lights_completed / tree_completed handlers (which also emit
// get_lights / get_tree, only after a room finishes) out of the
// assertions.
function connectBurst() {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(
    join(here, '..', 'src', 'village', 'VillageScene.js'),
    'utf8',
  );
  const start = src.indexOf("socket.on('connect'");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("socket.emit('get_time_phase'", start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('fetch fix v1', () => {
  it('asks for lights, tree, and snowman state in the connect burst', () => {
    const burst = connectBurst();
    for (const event of FETCH_EVENTS) {
      expect(burst).toContain(`socket.emit('${event}'`);
    }
  });

  it('asks for each exactly once in the burst', () => {
    const burst = connectBurst();
    for (const event of FETCH_EVENTS) {
      const hits = burst.split(`socket.emit('${event}'`).length - 1;
      expect(hits).toBe(1);
    }
  });

  it('asks after get_puzzle and before get_board', () => {
    const burst = connectBurst();
    const puzzleAt = burst.indexOf("socket.emit('get_puzzle'");
    const boardAt = burst.indexOf("socket.emit('get_board'");
    expect(puzzleAt).toBeGreaterThan(-1);
    expect(boardAt).toBeGreaterThan(puzzleAt);
    for (const event of FETCH_EVENTS) {
      const at = burst.indexOf(`socket.emit('${event}'`);
      expect(at).toBeGreaterThan(puzzleAt);
      expect(at).toBeLessThan(boardAt);
    }
  });

  it('carries the fetch-fix marker at the change', () => {
    const burst = connectBurst();
    expect(burst).toContain(FETCH_FIX_MARKER);
  });
});
