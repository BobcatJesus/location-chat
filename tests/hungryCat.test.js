// hungryCat.test.js — Hungry Cat v1 (`sq-hungry-cat-v1`).
//
// Hungry Cat v1.3 (`sq-hungry-cat-v1.3`): hunger does NOT end when
// the window does — if nobody feeds her, she stays hungry until
// fed, and that feed pays the +3 whenever it lands. A feed while
// she is not hungry never pays the quest.
//
// The cafe cat gets hungry twice a day (morning + evening, Chicago
// time) on a server timer. While hungry she shows a "hungry..."
// bubble; feeding her a treat completes the new "Feed the Hungry
// Cat" quest (+3 coins on top of the usual +1 pet coin) for the
// FIRST feeder in the window, and the quest repeats at the next
// window. These tests cover the pure parts: the window math, the
// hunger state machine, the badge, the QuestManager once-ever
// badge record, and the CafeCat tracker line. The live server loop
// (tick → broadcast → pet_cat fed → completion → second feeder
// refused → restart) runs in the /tmp protocol harness.

import { describe, expect, it } from 'vitest';
import {
  HUNGRY_CAT_MARKER_V1,
  HUNGRY_CAT_QUEST_ID,
  HUNGRY_CAT_REWARD_COINS,
  HUNGRY_CAT_BUBBLE_TEXT,
  HUNGRY_CAT_WINDOWS,
  parseHungerWindows,
  chicagoDateParts,
  hungerWindowFor,
  createCatHungerState,
  serializeCatHunger,
  refreshCatHunger,
  feedCatHunger,
} from '../src/village/catHunger.js';
import {
  HUNGRY_CAT_BADGE,
  isBadgeQuestId,
  getBadgeDef,
  badgeListFrom,
} from '../src/village/badges.js';
import { QuestManager } from '../src/village/QuestManager.js';
// sq-hungry-cat-v1.1: windows widened to 7–10am + 5–8pm Chicago.
import { CafeCat } from '../src/village/CafeCat.js';

// 2026-11-23 is CST (UTC-6): 07:00 Chicago = 13:00 UTC,
// 18:30 Chicago = 00:30 UTC the next day. July is CDT (UTC-5).
const utc = (y, mo, d, h, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi));
const NOV_23_0659 = utc(2026, 11, 23, 12, 59); // 06:59 Chicago
const NOV_23_0700 = utc(2026, 11, 23, 13, 0);  // 07:00 Chicago
const NOV_23_0800 = utc(2026, 11, 23, 14, 0);  // 08:00 Chicago
const NOV_23_0930 = utc(2026, 11, 23, 15, 30); // 09:30 Chicago
const NOV_23_1000 = utc(2026, 11, 23, 16, 0);  // 10:00 Chicago
const NOV_23_1200 = utc(2026, 11, 23, 18, 0);  // 12:00 Chicago
const NOV_23_1659 = utc(2026, 11, 23, 22, 59); // 16:59 Chicago
const NOV_23_1700 = utc(2026, 11, 23, 23, 0);  // 17:00 Chicago
const NOV_23_1830 = utc(2026, 11, 24, 0, 30);  // 18:30 Chicago
const NOV_23_2000 = utc(2026, 11, 24, 2, 0);   // 20:00 Chicago
const JUL_01_0800 = utc(2026, 7, 1, 13, 0);    // 08:00 Chicago, CDT

describe('constants', () => {
  it('has the kit marker and the decided values', () => {
    expect(HUNGRY_CAT_MARKER_V1).toBe('sq-hungry-cat-v1');
    expect(HUNGRY_CAT_QUEST_ID).toBe('hungry-cat');
    expect(HUNGRY_CAT_REWARD_COINS).toBe(3);
    expect(HUNGRY_CAT_BUBBLE_TEXT).toBe('hungry...');
    expect(HUNGRY_CAT_WINDOWS).toEqual([
      { label: 'morning', startMin: 420, endMin: 600 },
      { label: 'evening', startMin: 1020, endMin: 1200 },
    ]);
  });
});

describe('chicagoDateParts / hungerWindowFor', () => {
  it('reads Chicago wall time (CST in November, CDT in July)', () => {
    expect(chicagoDateParts(NOV_23_0800)).toMatchObject({ year: 2026, month: 11, day: 23, hour: 8, minute: 0 });
    expect(chicagoDateParts(JUL_01_0800)).toMatchObject({ year: 2026, month: 7, day: 1, hour: 8, minute: 0 });
  });
  it('morning window: 07:00 in, 06:59 and 10:00 out, end exclusive', () => {
    expect(hungerWindowFor(NOV_23_0700)).toEqual({ windowId: '2026-11-23-morning', period: 'morning', active: true });
    expect(hungerWindowFor(NOV_23_0800).active).toBe(true);
    expect(hungerWindowFor(NOV_23_0930).active).toBe(true);
    expect(hungerWindowFor(NOV_23_0659).active).toBe(false);
    expect(hungerWindowFor(NOV_23_1000).active).toBe(false);
    expect(hungerWindowFor(NOV_23_1000).windowId).toBeNull();
  });
  it('evening window: 17:00 in, 16:59 and 20:00 out', () => {
    expect(hungerWindowFor(NOV_23_1700)).toEqual({ windowId: '2026-11-23-evening', period: 'evening', active: true });
    expect(hungerWindowFor(NOV_23_1830).active).toBe(true);
    expect(hungerWindowFor(NOV_23_1659).active).toBe(false);
    expect(hungerWindowFor(NOV_23_2000).active).toBe(false);
  });
  it('midday is no window', () => {
    expect(hungerWindowFor(NOV_23_1200)).toEqual({ windowId: null, period: null, active: false });
  });
  it('DST: a July morning is still a morning window', () => {
    expect(hungerWindowFor(JUL_01_0800)).toEqual({ windowId: '2026-07-01-morning', period: 'morning', active: true });
  });
});

describe('parseHungerWindows', () => {
  it('parses the default shape', () => {
    expect(parseHungerWindows('7-10,17-20')).toEqual([
      { label: 'morning', startMin: 420, endMin: 600 },
      { label: 'evening', startMin: 1020, endMin: 1200 },
    ]);
  });
  it('rejects garbage (caller falls back to the default)', () => {
    expect(parseHungerWindows('')).toBeNull();
    expect(parseHungerWindows(null)).toBeNull();
    expect(parseHungerWindows('8-8')).toBeNull();
    expect(parseHungerWindows('25-26')).toBeNull();
    expect(parseHungerWindows('morning')).toBeNull();
  });
});

describe('refreshCatHunger', () => {
  it('activates at window start when she is awake', () => {
    const { state, changed } = refreshCatHunger(createCatHungerState(), { now: NOV_23_0800, asleep: false });
    expect(state).toEqual({ windowId: '2026-11-23-morning', hungry: true, fedBy: null });
    expect(changed).toBe(true);
  });
  it('does not activate outside a window', () => {
    const { state, changed } = refreshCatHunger(createCatHungerState(), { now: NOV_23_1200, asleep: false });
    expect(state.hungry).toBe(false);
    expect(changed).toBe(false);
  });
  it('does not activate while she is asleep — hunger waits', () => {
    const { state, changed } = refreshCatHunger(createCatHungerState(), { now: NOV_23_0800, asleep: true });
    expect(state.hungry).toBe(false);
    expect(changed).toBe(false);
    expect(state.windowId).toBe('2026-11-23-morning');
  });
  it('activates on wake inside the same window', () => {
    const asleep = refreshCatHunger(createCatHungerState(), { now: NOV_23_0800, asleep: true }).state;
    const { state, changed } = refreshCatHunger(asleep, { now: NOV_23_0930, asleep: false });
    expect(state.hungry).toBe(true);
    expect(changed).toBe(true);
  });
  it('hunger stays true if she falls asleep hungry (it waits, it does not clear)', () => {
    const hungry = refreshCatHunger(createCatHungerState(), { now: NOV_23_0800, asleep: false }).state;
    const { state, changed } = refreshCatHunger(hungry, { now: NOV_23_0930, asleep: true });
    expect(state.hungry).toBe(true);
    expect(changed).toBe(false);
  });
  it('stays hungry past the window end when nobody fed her (v1.3)', () => {
    const hungry = refreshCatHunger(createCatHungerState(), { now: NOV_23_0800, asleep: false }).state;
    const { state, changed } = refreshCatHunger(hungry, { now: NOV_23_1000, asleep: false });
    expect(state.hungry).toBe(true);
    expect(state.windowId).toBe('2026-11-23-morning');
    expect(changed).toBe(false);
  });
  it('hunger carries into the next window with a fresh feeder (v1.3)', () => {
    const hungry = refreshCatHunger(createCatHungerState(), { now: NOV_23_0800, asleep: false }).state;
    const { state, changed } = refreshCatHunger(hungry, { now: NOV_23_1830, asleep: false });
    expect(state).toEqual({ windowId: '2026-11-23-evening', hungry: true, fedBy: null });
    expect(changed).toBe(false);
    const fed = feedCatHunger(state, { now: NOV_23_1830, userId: 'bob@test' });
    expect(fed.ok).toBe(true);
    expect(fed.state).toEqual({ windowId: '2026-11-23-evening', hungry: false, fedBy: 'bob@test' });
  });
  it('a fed cat stays fed between windows (v1.3)', () => {
    let s = refreshCatHunger(createCatHungerState(), { now: NOV_23_0800, asleep: false }).state;
    s = feedCatHunger(s, { now: NOV_23_0930, userId: 'alice@test' }).state;
    const { state, changed } = refreshCatHunger(s, { now: NOV_23_1200, asleep: false });
    expect(state.hungry).toBe(false);
    expect(changed).toBe(false);
  });
  it('a new window resets the feeder and hungers again', () => {
    let s = refreshCatHunger(createCatHungerState(), { now: NOV_23_0800, asleep: false }).state;
    s = feedCatHunger(s, { now: NOV_23_0930, userId: 'alice@test' }).state;
    expect(s.hungry).toBe(false);
    const { state, changed } = refreshCatHunger(s, { now: NOV_23_1830, asleep: false });
    expect(state).toEqual({ windowId: '2026-11-23-evening', hungry: true, fedBy: null });
    expect(changed).toBe(true);
  });
  it('no change, no broadcast: an already-hungry refresh is quiet', () => {
    const hungry = refreshCatHunger(createCatHungerState(), { now: NOV_23_0800, asleep: false }).state;
    const { changed } = refreshCatHunger(hungry, { now: NOV_23_0930, asleep: false });
    expect(changed).toBe(false);
  });
});

describe('feedCatHunger', () => {
  it('first feeder ends the hunger and is recorded', () => {
    const hungry = refreshCatHunger(createCatHungerState(), { now: NOV_23_0800, asleep: false }).state;
    const { state, ok } = feedCatHunger(hungry, { now: NOV_23_0930, userId: 'alice@test' });
    expect(ok).toBe(true);
    expect(state).toEqual({ windowId: '2026-11-23-morning', hungry: false, fedBy: 'alice@test' });
  });
  it('second feeder in the same window is refused (not-hungry)', () => {
    let s = refreshCatHunger(createCatHungerState(), { now: NOV_23_0800, asleep: false }).state;
    s = feedCatHunger(s, { now: NOV_23_0930, userId: 'alice@test' }).state;
    const res = feedCatHunger(s, { now: NOV_23_0930, userId: 'bob@test' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-hungry');
    expect(res.state.fedBy).toBe('alice@test');
  });
  it('feeding when she is not hungry is refused', () => {
    const res = feedCatHunger(createCatHungerState(), { now: NOV_23_1200, userId: 'alice@test' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-hungry');
  });
  it('feeding after the window ended still pays while she is hungry (v1.3)', () => {
    // Stale hungry state (e.g. the tick had not run yet): hunger no
    // longer ends at the window's close, so a late feed completes
    // the window's quest — the feed pays whenever she is hungry.
    const stale = { windowId: '2026-11-23-morning', hungry: true, fedBy: null };
    const res = feedCatHunger(stale, { now: NOV_23_1200, userId: 'alice@test' });
    expect(res.ok).toBe(true);
    expect(res.state).toEqual({ windowId: '2026-11-23-morning', hungry: false, fedBy: 'alice@test' });
  });
});

describe('serializeCatHunger', () => {
  it('is the wire shape: hungry + windowId only', () => {
    expect(serializeCatHunger({ windowId: '2026-11-23-morning', hungry: true, fedBy: 'alice@test' }))
      .toEqual({ hungry: true, windowId: '2026-11-23-morning' });
    expect(serializeCatHunger(createCatHungerState())).toEqual({ hungry: false, windowId: null });
  });
});

describe('badge', () => {
  it('is a known badge id with its def', () => {
    expect(HUNGRY_CAT_BADGE).toMatchObject({ id: 'hungry-cat', title: 'Feed the Hungry Cat', emoji: '🐱' });
    expect(isBadgeQuestId('hungry-cat')).toBe(true);
    expect(getBadgeDef('hungry-cat')).toMatchObject({ id: 'hungry-cat', title: 'Feed the Hungry Cat' });
    const list = badgeListFrom({ 'hungry-cat': 1234567890000 });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ questId: 'hungry-cat', completedAt: 1234567890000 });
  });
});

describe('QuestManager.recordHungryCatCompletion', () => {
  it('records the badge once ever, and the quest is repeatable (coins are not recorded here)', () => {
    const qm = new QuestManager({ roomId: 'agora-houston' });
    expect(qm.recordHungryCatCompletion()).toBe(true);
    expect(qm.recordHungryCatCompletion()).toBe(false);
    const mine = qm.getCompletions().filter((c) => c.questId === 'hungry-cat');
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('Feed the Hungry Cat');
    // The one-time quest flow never sees it: it is not in QUESTS,
    // so refresh()/anywhereQuests() are untouched by the record.
    expect(qm.saved['hungry-cat']?.completed).toBe(true);
  });
});

describe('CafeCat.getTrackerLine', () => {
  function catWith({ hungry, asleep }) {
    const c = Object.create(CafeCat.prototype);
    c.hungry = hungry;
    c.asleep = asleep;
    c.cat = { x: 100, y: 100 };
    return c;
  }
  it('shows the line only while hungry and awake', () => {
    expect(catWith({ hungry: true, asleep: false }).getTrackerLine())
      .toBe("🐱 Feed the Hungry Cat — she's hungry! Feed her a treat (+3 coins)");
    expect(catWith({ hungry: true, asleep: true }).getTrackerLine()).toBeNull();
    expect(catWith({ hungry: false, asleep: false }).getTrackerLine()).toBeNull();
  });
  it('needs a cat entity at all', () => {
    const c = Object.create(CafeCat.prototype);
    c.hungry = true; c.asleep = false; c.cat = null;
    expect(c.getTrackerLine()).toBeNull();
  });
});
