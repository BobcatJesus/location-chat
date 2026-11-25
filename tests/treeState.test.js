// treeState.test.js — Trim the Tree v1 (`sq-trim-tree-v1`),
// v1.2 (`sq-christmas-multi-v1.2` — every hang counts).
// Pure logic only: multi-hang counting, 25 to finish,
// second tree in the same venue, max 2 trees, fill stages,
// ornament slots, serialize / parse.

import { describe, it, expect } from 'vitest';
import {
  TREE_MARKER_V1,
  TREE_TOTAL,
  TREE_MAX,
  TREE_ORNAMENT_SLOTS,
  ornamentStyle,
  createTreeState,
  treesDone,
  isTreeComplete,
  activeTreeProgress,
  treeStage,
  hangOrnament,
  serializeTreeState,
  parseTreeState,
} from '../src/village/treeState.js';

function hangMany(state, users) {
  const results = [];
  for (const u of users) results.push(hangOrnament(state, u));
  return results;
}

describe('tree constants', () => {
  it('carries the v1 marker', () => {
    expect(TREE_MARKER_V1).toBe('sq-trim-tree-v1');
  });

  it('needs 25 counted ornaments per tree, max 2 trees', () => {
    expect(TREE_TOTAL).toBe(25);
    expect(TREE_MAX).toBe(2);
  });

  it('has 25 ornament slots, all inside the tree triangle', () => {
    expect(TREE_ORNAMENT_SLOTS).toHaveLength(25);
    for (const s of TREE_ORNAMENT_SLOTS) {
      // Inside the triangle: |dx| shrinks toward the top (dy -275).
      const h = -s.dy;
      const halfWidth = 108 * (1 - h / 285);
      expect(Math.abs(s.dx)).toBeLessThanOrEqual(Math.ceil(halfWidth));
      expect(s.dy).toBeLessThanOrEqual(-5);
      expect(s.dy).toBeGreaterThanOrEqual(-245);
    }
  });

  it('cycles ornament shapes so the tree shows different shapes', () => {
    const shapes = new Set(Array.from({ length: 25 }, (_, i) => ornamentStyle(i).shape));
    expect(shapes.size).toBeGreaterThanOrEqual(4);
    expect(ornamentStyle(0).shape).toBe(ornamentStyle(4).shape);
  });
});

describe('fill stages', () => {
  it('stays bare (stage 0) after the first ornament alone', () => {
    expect(treeStage(0)).toBe(0);
    expect(treeStage(1)).toBe(0);
  });

  it('advances at 2 / 7 / 13 / 19 / 25 counted', () => {
    expect(treeStage(2)).toBe(1);
    expect(treeStage(6)).toBe(1);
    expect(treeStage(7)).toBe(2);
    expect(treeStage(12)).toBe(2);
    expect(treeStage(13)).toBe(3);
    expect(treeStage(18)).toBe(3);
    expect(treeStage(19)).toBe(4);
    expect(treeStage(24)).toBe(4);
    expect(treeStage(25)).toBe(5);
  });
});

describe('hangOrnament — every hang counts (v1.2)', () => {
  it('counts every hang, including repeats by the same player', () => {
    const s = createTreeState();
    const first = hangOrnament(s, 'alice');
    expect(first).toMatchObject({ ok: true, counted: true, treeFinished: false, tree: 1 });
    expect(s.trees[0].counted).toBe(1);
    const second = hangOrnament(s, 'alice');
    expect(second).toMatchObject({ ok: true, counted: true });
    expect(s.trees[0].counted).toBe(2);
    expect(s.trees[0]).not.toHaveProperty('extras');
    const third = hangOrnament(s, 'alice');
    expect(third.counted).toBe(true);
    expect(s.trees[0].counted).toBe(3);
    expect(s.trees[0].hungBy.alice).toBe(3);
  });

  it('counts a second player’s first hang', () => {
    const s = createTreeState();
    hangOrnament(s, 'alice');
    const res = hangOrnament(s, 'bob');
    expect(res.counted).toBe(true);
    expect(s.trees[0].counted).toBe(2);
    expect(s.trees[0].contributors).toEqual(['alice', 'bob']);
  });

  it('rejects a hang with no user', () => {
    const s = createTreeState();
    expect(hangOrnament(s, '')).toMatchObject({ ok: false });
    expect(s.trees[0].counted).toBe(0);
  });
});

describe('two trees per venue', () => {
  it('finishes tree 1 at 25 hangs and activates tree 2', () => {
    const s = createTreeState();
    const users = Array.from({ length: 25 }, (_, i) => `user-${i}`);
    const results = hangMany(s, users);
    expect(results[23].treeFinished).toBe(false);
    expect(results[24]).toMatchObject({ ok: true, counted: true, treeFinished: true, tree: 1 });
    expect(results[24].contributors).toHaveLength(25);
    expect(s.trees[0].completed).toBe(true);
    expect(s.active).toBe(1);
    expect(treesDone(s)).toBe(1);
    expect(isTreeComplete(s)).toBe(false);
    expect(activeTreeProgress(s)).toMatchObject({ tree: 2, counted: 0, total: 25 });
  });

  it('tree 2 is a fresh round — the same players count again, repeatedly', () => {
    const s = createTreeState();
    hangMany(s, Array.from({ length: 25 }, (_, i) => `user-${i}`));
    // A tree-1 contributor's hangs on tree 2 count — every one.
    const res = hangOrnament(s, 'user-0');
    expect(res).toMatchObject({ ok: true, counted: true, tree: 2 });
    expect(s.trees[1].counted).toBe(1);
    expect(hangOrnament(s, 'user-0').counted).toBe(true);
    expect(s.trees[1].counted).toBe(2);
    expect(s.trees[1]).not.toHaveProperty('extras');
  });

  it('finishes tree 2 and then refuses further hangs (max 2)', () => {
    const s = createTreeState();
    hangMany(s, Array.from({ length: 25 }, (_, i) => `user-${i}`));
    const results = hangMany(s, Array.from({ length: 25 }, (_, i) => `user-${i}`));
    expect(results[24]).toMatchObject({ treeFinished: true, tree: 2 });
    expect(s.active).toBe(-1);
    expect(treesDone(s)).toBe(2);
    expect(isTreeComplete(s)).toBe(true);
    expect(activeTreeProgress(s)).toMatchObject({ tree: 0, allDone: true });
    expect(hangOrnament(s, 'someone-new')).toMatchObject({ ok: false, reason: 'all-done' });
  });

  it('one player alone CAN finish a tree now (v1.2)', () => {
    const s = createTreeState();
    let finish;
    for (let i = 0; i < 25; i++) finish = hangOrnament(s, 'solo');
    expect(finish).toMatchObject({ ok: true, counted: true, treeFinished: true, tree: 1 });
    expect(s.trees[0].counted).toBe(25);
    expect(s.trees[0].completed).toBe(true);
    expect(s.active).toBe(1); // tree 2 appears
    expect(s.trees[0]).not.toHaveProperty('extras');
    // ...and the same player keeps counting on tree 2.
    expect(hangOrnament(s, 'solo').counted).toBe(true);
    expect(s.trees[1].counted).toBe(1);
  });
});

describe('serialize / parse', () => {
  it('round-trips through serialize + parse', () => {
    const s = createTreeState();
    hangOrnament(s, 'alice');
    hangOrnament(s, 'alice');
    hangOrnament(s, 'bob');
    const parsed = parseTreeState(serializeTreeState(s));
    expect(parsed.trees[0].counted).toBe(3);
    expect(parsed.trees[0]).not.toHaveProperty('extras');
    expect(parsed.trees[0].contributors).toEqual(['alice', 'bob']);
    expect(parsed.trees[0].hungBy).toEqual({ alice: 2, bob: 1 });
    expect(parsed.active).toBe(0);
  });

  it('repairs a bad payload instead of trusting it', () => {
    const parsed = parseTreeState({
      active: 99,
      trees: [
        { counted: 999, extras: -5, contributors: 'not-an-array', hungBy: { alice: 'lots' }, completed: 'yes' },
        { counted: 25, completed: true },
      ],
    });
    expect(parsed.active).toBe(-1); // both trees complete -> -1
    expect(parsed.trees[0].counted).toBe(25); // completed repairs counted to 25
    expect(parsed.trees[0]).not.toHaveProperty('extras');
    expect(parsed.trees[0].contributors).toEqual([]);
    expect(parsed.trees[1].counted).toBe(25);
    expect(parsed.trees[1].completed).toBe(true);
  });

  it('returns a fresh state for a missing or garbage payload', () => {
    expect(parseTreeState(null).active).toBe(0);
    expect(parseTreeState('nope').trees).toHaveLength(2);
    expect(parseTreeState({}).active).toBe(0);
  });
});
