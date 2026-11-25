// trimTreeQuest.test.js — Trim the Tree quest client
// (`sq-trim-tree-v1`, v1.2 `sq-christmas-multi-v1.2` — every hang
// counts, coins pay per counted hang, badge once per person).
// DOM-free: drives the quest class with a fake scene and checks
// repeat takes, the counted progress, the paid-count guard, the
// tree-2 re-arm, and the badge call. No canvas, no network.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TrimTreeQuest } from '../src/village/TrimTreeQuest.js';
import {
  createTreeState,
  hangOrnament,
  serializeTreeState,
  owedTreeHangs,
  loadPaidTreeCounts,
} from '../src/village/treeState.js';

// Chainable stand-in for a Phaser GameObject: every draw call used
// by _drawBox / _drawTree / _updateCarryIndicator returns itself.
function chainable() {
  const o = {};
  for (const m of [
    'fillStyle', 'fillRect', 'fillRoundedRect', 'lineStyle', 'strokeRect', 'fillCircle',
    'lineBetween', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fillPath',
    'strokePath', 'setOrigin', 'setPosition', 'setAlpha', 'setDepth', 'setSize',
    'setText', 'setVisible', 'clear', 'add', 'slice',
  ]) o[m] = () => o;
  o.destroy = () => {};
  return o;
}

function fakeScene(overrides = {}) {
  const notices = [];
  const questToasts = [];
  const emitted = [];
  const scene = {
    roomId: 'agora-houston',
    userId: 'u1',
    socket: { connected: false, emit: (ev, data) => emitted.push([ev, data]) },
    player: { gx: 800, gy: 250 },
    onSystemNotice: (m) => notices.push(m),
    questManager: {
      bumpHud() {},
      showToast: (m) => questToasts.push(m),
      showQuestBannerFor() {},
      recordTreeCompletion() {},
    },
    add: {
      graphics: () => chainable(),
      text: () => chainable(),
      container: () => chainable(),
    },
    ...overrides,
  };
  return { scene, notices, questToasts, emitted };
}

describe('v1.2 multi-hang — repeat takes and counted progress', () => {
  it('the same player can take a second ornament after hanging one', () => {
    const { scene } = fakeScene();
    const q = new TrimTreeQuest(scene);
    expect(q.takeOrnament()).toMatchObject({ ok: true });
    expect(q.hangOrnament()).toMatchObject({ ok: true });
    // No "already hung" refusal any more — the box hands out seconds.
    expect(q.takeOrnament()).toMatchObject({ ok: true });
    expect(q.carrying).toBe(true);
  });

  it('every hang counts — two hangs by one player make the tree 2/25', () => {
    const { scene } = fakeScene();
    const q = new TrimTreeQuest(scene);
    q.takeOrnament();
    q.hangOrnament();
    q.takeOrnament();
    q.hangOrnament();
    expect(q.getProgress()).toMatchObject({ tree: 1, counted: 2, total: 25 });
  });

  it('one player alone can finish tree 1 and keep counting on tree 2', () => {
    const { scene } = fakeScene();
    const q = new TrimTreeQuest(scene);
    for (let i = 0; i < 25; i++) {
      q.takeOrnament();
      q.hangOrnament();
    }
    expect(q.getProgress()).toMatchObject({ tree: 2, counted: 0, total: 25 });
    q.takeOrnament();
    q.hangOrnament();
    expect(q.getProgress()).toMatchObject({ tree: 2, counted: 1, total: 25 });
  });
});

describe('v1.2 multi-hang — per-hang payment and the badge', () => {
  // localStorage does not exist in the node test env; install a
  // tiny stub so the paid-count guard can be observed, and remove
  // it afterwards so no other suite sees it.
  let storage;
  let prevLocalStorage;
  beforeEach(() => {
    const store = {};
    storage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
    prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = storage;
  });
  afterEach(() => {
    if (prevLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLocalStorage;
  });

  function paidCounts() {
    return loadPaidTreeCounts().shared || {};
  }

  it('pays for each counted hang exactly once — a duplicate broadcast pays nothing', () => {
    const { scene } = fakeScene();
    const q = new TrimTreeQuest(scene);
    q.takeOrnament();
    q.hangOrnament();
    expect(paidCounts()).toEqual({ 1: 1 });
    q.takeOrnament();
    q.hangOrnament();
    expect(paidCounts()).toEqual({ 1: 2 });
    // Same state again (a duplicate broadcast): no second payment.
    q.applyState(serializeTreeState(q.state));
    expect(paidCounts()).toEqual({ 1: 2 });
  });

  it('a refresh pays only the hangs that landed while away', () => {
    const { scene } = fakeScene();
    const q1 = new TrimTreeQuest(scene);
    q1.takeOrnament();
    q1.hangOrnament();
    expect(paidCounts()).toEqual({ 1: 1 });
    // Fresh quest instance, same browser (same stubbed storage):
    // re-applying the same state pays nothing more.
    const state = serializeTreeState(q1.state);
    const q2 = new TrimTreeQuest(scene);
    q2.applyState(state);
    expect(paidCounts()).toEqual({ 1: 1 });
    // A second hang landed while I was away: pays for exactly that one.
    const s = createTreeState();
    hangOrnament(s, 'u1');
    hangOrnament(s, 'u1');
    q2.applyState(serializeTreeState(s));
    expect(paidCounts()).toEqual({ 1: 2 });
  });

  it('a room reset (server restart) re-arms payment from zero', () => {
    const { scene } = fakeScene();
    const q = new TrimTreeQuest(scene);
    // I was paid for 3 hangs on tree 1 in the old room epoch.
    storage.setItem('sidequest-tree-paid-counts', JSON.stringify({ shared: { 1: 3 } }));
    // The room restarted: I have 1 counted hang in the fresh room.
    const s = createTreeState();
    hangOrnament(s, 'u1');
    q.applyState(serializeTreeState(s));
    // Paid count resets to 1 — the fresh hang pays, the old 3 do not carry over.
    expect(paidCounts()).toEqual({ 1: 1 });
  });

  it('tree 2 re-arms payment per tree', () => {
    const { scene } = fakeScene();
    const q = new TrimTreeQuest(scene);
    for (let i = 0; i < 25; i++) {
      q.takeOrnament();
      q.hangOrnament();
    }
    expect(paidCounts()).toEqual({ 1: 25 });
    q.takeOrnament();
    q.hangOrnament();
    expect(paidCounts()).toEqual({ 1: 25, 2: 1 });
  });

  it('the badge is recorded once per person on completion', () => {
    let calls = 0;
    const questToasts = [];
    const { scene } = fakeScene({
      questManager: {
        bumpHud() {},
        showToast: (m) => questToasts.push(m),
        showQuestBannerFor() {},
        recordTreeCompletion: () => { calls += 1; },
      },
    });
    const q = new TrimTreeQuest(scene);
    for (let i = 0; i < 25; i++) {
      q.takeOrnament();
      q.hangOrnament();
    }
    expect(calls).toBe(1);
    // Re-applying the completed state does not re-record it.
    q.applyState(serializeTreeState(q.state));
    expect(calls).toBe(1);
  });
});

describe('owedTreeHangs — the paid-count diff', () => {
  it('pays the difference per tree, and resets when the room epoch restarted', () => {
    expect(owedTreeHangs(0, 0)).toEqual({ owed: 0, newPaid: 0 });
    expect(owedTreeHangs(1, 0)).toEqual({ owed: 1, newPaid: 1 });
    expect(owedTreeHangs(2, 1)).toEqual({ owed: 1, newPaid: 2 });
    expect(owedTreeHangs(5, 5)).toEqual({ owed: 0, newPaid: 5 });
    expect(owedTreeHangs(3, undefined)).toEqual({ owed: 3, newPaid: 3 });
    // Counted LOWER than paid means the room state was wiped and
    // started over: the fresh hangs pay in full.
    expect(owedTreeHangs(1, 3)).toEqual({ owed: 1, newPaid: 1 });
  });
});
