// badgesBackfill.test.js — Quest Badges v1.1 backfill
// (`sq-quest-badges-v1-1`). A quest finished BEFORE badges existed
// still earns its badge: the backfill reads the client's existing
// localStorage completions record (and, server-side, the
// quest-progress store) and turns every pre-existing completion
// into a badge — once ever, idempotent, no coins.
//
// QuestManager-only tests with a stubbed localStorage and a fake
// scene. The server half (backfilledBadgesFromQuestState) is pure
// and covered in badges.test.js; the socket.js wiring (awardBadge
// null-handling, the three call sites) is verified by node --check
// + the build, not by importing the whole server here.

import { describe, it, expect, beforeEach } from 'vitest';
import { QuestManager } from '../src/village/QuestManager.js';
import { getQuest } from '../src/village/quests.js';

// --- localStorage stub (installed before any QuestManager runs) ---
function makeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}
const storage = makeStorage();
globalThis.localStorage = storage;

const QUESTS_KEY = 'location-chat-quests:shared';

function seedSaved(saved) {
  storage.setItem(QUESTS_KEY, JSON.stringify(saved));
}

function makeFakeText() {
  const t = {
    setScrollFactor() { return t; },
    setDepth() { return t; },
    setOrigin() { return t; },
    setInteractive() { return t; },
    on() { return t; },
    destroy() {},
  };
  return t;
}

function makeFakeScene() {
  return {
    roomId: 'agora-houston',
    userId: 'test-user',
    socket: null,
    scale: { width: 1600, displaySize: { width: 1600 } },
    add: { text: () => makeFakeText() },
    time: { delayedCall: () => ({ remove() {} }) },
    tweens: { add: () => {} },
  };
}

beforeEach(() => {
  storage.clear();
});

describe('backfillBadges (client record)', () => {
  it('turns pre-kit completions into badges on first load', () => {
    // Pre-kit save: Duck Roundup + Cat Cuddles finished (no
    // completedAt — badges did not exist yet), Barfly half done.
    seedSaved({
      'duck-roundup': { count: 3, completed: true },
      'cat-cuddles': { count: 3, completed: true },
      'barfly': { count: 2, completed: false },
    });
    const qm = new QuestManager(makeFakeScene());
    const completions = qm.getCompletions();
    expect(completions.map((b) => b.questId).sort()).toEqual([
      'cat-cuddles',
      'duck-roundup',
    ]);
    // No stored finish time → "Completed", never a made-up date.
    for (const b of completions) expect(b.completedLabel).toBe('Completed');
    // backfillBadges() is the same map the sync sends.
    expect(qm.backfillBadges()).toEqual({
      'duck-roundup': null,
      'cat-cuddles': null,
    });
    expect(qm.getCompletedMap()).toEqual(qm.backfillBadges());
  });

  it('is idempotent — a second load returns the same badges, no duplicates', () => {
    seedSaved({
      'duck-roundup': { count: 3, completed: true },
      'cat-cuddles': { count: 3, completed: true },
    });
    const first = new QuestManager(makeFakeScene());
    expect(first.getCompletions()).toHaveLength(2);
    // Reload: a fresh QuestManager on the same saved record.
    const second = new QuestManager(makeFakeScene());
    const list = second.getCompletions();
    expect(list).toHaveLength(2);
    expect(list.map((b) => b.questId).sort()).toEqual([
      'cat-cuddles',
      'duck-roundup',
    ]);
    expect(second.backfillBadges()).toEqual(first.backfillBadges());
  });

  it('keeps a stored finish time when one exists', () => {
    seedSaved({
      'duck-roundup': { count: 3, completed: true, completedAt: 1700000000000 },
    });
    const qm = new QuestManager(makeFakeScene());
    const [badge] = qm.getCompletions();
    expect(badge.completedAt).toBe(1700000000000);
    expect(badge.completedLabel).not.toBe('Completed');
  });

  it('a quest completed after the kit earns exactly one badge, with a real date', () => {
    seedSaved({ 'barfly': { count: 2, completed: false } });
    const qm = new QuestManager(makeFakeScene());
    expect(qm.getCompletions()).toHaveLength(0);
    qm._increment(getQuest('barfly'));
    const list = qm.getCompletions();
    expect(list).toHaveLength(1);
    expect(list[0].questId).toBe('barfly');
    expect(list[0].completedLabel).not.toBe('Completed');
    // Reload: still exactly one, same badge.
    const reloaded = new QuestManager(makeFakeScene());
    expect(reloaded.getCompletions()).toHaveLength(1);
    expect(reloaded.getCompletions()[0].questId).toBe('barfly');
  });

  it('the sync payload carries the backfilled badges to the server', () => {
    seedSaved({
      'duck-roundup': { count: 3, completed: true },
      'cat-cuddles': { count: 3, completed: true },
    });
    const scene = makeFakeScene();
    const captured = [];
    scene.socket = {
      connected: true,
      emit: (ev, payload) => { captured.push([ev, payload]); },
    };
    const qm = new QuestManager(scene);
    expect(qm.syncBadgesToServer()).toBe(true);
    expect(captured).toHaveLength(1);
    const [event, payload] = captured[0];
    expect(event).toBe('badges_sync');
    expect(payload.badges.map((b) => b.questId).sort()).toEqual([
      'cat-cuddles',
      'duck-roundup',
    ]);
  });

  it('the Group Puzzle badge is earned once ever (local record only)', () => {
    const qm = new QuestManager(makeFakeScene());
    expect(qm.recordPuzzleCompletion()).toBe(true);
    expect(qm.recordPuzzleCompletion()).toBe(false);
    const list = qm.getCompletions();
    expect(list).toHaveLength(1);
    expect(list[0].questId).toBe('group-puzzle');
    // Reload: still one.
    expect(new QuestManager(makeFakeScene()).getCompletions()).toHaveLength(1);
  });

  it('an empty record backfills nothing', () => {
    const qm = new QuestManager(makeFakeScene());
    expect(qm.getCompletions()).toEqual([]);
    expect(qm.backfillBadges()).toEqual({});
  });
});
