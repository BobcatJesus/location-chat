// onboarding.test.js — Onboarding v1 (`sq-onboarding-v1`).
// Pure-module tests (welcome flag + copy) and a QuestManager flow
// test with a fake scene (no Phaser): First Steps activates first
// in Agora, one pet completes it AND advances Cat Cuddles 1/3,
// no extra coins are paid, the badge is earned, and the step prompt
// shows until done, then vanishes. The sleeping-cat prompt is
// covered too. localStorage is undefined under vitest's node env,
// so QuestManager's save/load no-ops and each manager is fresh.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ONBOARDING_MARKER_V1,
  hasSeenWelcome,
  markWelcomeSeen,
  clearWelcomeSeen,
  WELCOME_TITLE,
  WELCOME_BODY,
  WELCOME_FIRST_STEP,
  WELCOME_GO_LABEL,
  WELCOME_DISMISS_LABEL,
  FIRST_STEPS_STEP_PROMPT,
  FIRST_STEPS_ASLEEP_PROMPT,
} from '../src/village/onboarding.js';
import { QUESTS, getQuest, FIRST_STEPS_QUEST_ID } from '../src/village/quests.js';
import { QuestManager } from '../src/village/QuestManager.js';
import { getCoins } from '../src/village/CoinWallet.js';

function fakeScene({ asleep = false } = {}) {
  return {
    roomId: 'agora-houston',
    socket: null,
    time: { delayedCall: () => ({ remove() {} }) },
    cafeCat: { asleep },
  };
}

describe('onboarding welcome flag', () => {
  beforeEach(() => clearWelcomeSeen());

  it('exposes the v1 marker', () => {
    expect(ONBOARDING_MARKER_V1).toBe('sq-onboarding-v1');
  });

  it('is unseen at first, seen after marking, clearable again', () => {
    expect(hasSeenWelcome()).toBe(false);
    markWelcomeSeen();
    expect(hasSeenWelcome()).toBe(true);
    markWelcomeSeen(); // idempotent
    expect(hasSeenWelcome()).toBe(true);
    clearWelcomeSeen();
    expect(hasSeenWelcome()).toBe(false);
  });

  it('has non-empty copy for every card line', () => {
    for (const line of [WELCOME_TITLE, WELCOME_BODY, WELCOME_FIRST_STEP, WELCOME_GO_LABEL, WELCOME_DISMISS_LABEL]) {
      expect(typeof line).toBe('string');
      expect(line.trim().length).toBeGreaterThan(0);
    }
    expect(WELCOME_FIRST_STEP).toContain('Agora');
    expect(WELCOME_FIRST_STEP).toContain('cat');
  });
});

describe('First Steps quest def', () => {
  it('is the first Agora quest, one pet, zero extra coins', () => {
    expect(FIRST_STEPS_QUEST_ID).toBe('first-steps');
    const def = getQuest('first-steps');
    expect(def).toBeTruthy();
    expect(def.roomId).toBe('agora-houston');
    expect(def.event).toBe('cat-pet');
    expect(def.target).toBe(1);
    expect(def.rewardCoins).toBe(0);
    const agora = QUESTS.filter((q) => q.roomId === 'agora-houston');
    expect(agora[0].id).toBe('first-steps');
    expect(agora.map((q) => q.id)).toContain('cat-cuddles');
  });
});

describe('First Steps quest flow', () => {
  it('activates first in Agora with a step prompt', () => {
    const qm = new QuestManager(fakeScene());
    qm.domHud = true;
    qm.refresh();
    expect(qm.activeQuest?.id).toBe('first-steps');
    expect(qm.getStepPrompt()).toBe(FIRST_STEPS_STEP_PROMPT);
    expect(qm.getStepPrompt()).toContain('press E');
    expect(qm.getHudState().stepPrompt).toBe(FIRST_STEPS_STEP_PROMPT);
    expect(qm.getHudState().trackerSections.room[0]).toBe('👋 First Steps  0/1');
    // A 0-coin reward shows no reward line on the banner.
    expect(qm.getHudState().banner?.rewardCoins).toBe(0);
  });

  it('one pet completes it, advances Cat Cuddles 1/3, pays no extra coins', () => {
    const qm = new QuestManager(fakeScene());
    qm.domHud = true;
    qm.refresh();
    const coinsBefore = getCoins();
    qm.recordEvent('cat-pet');
    expect(qm.saved['first-steps']?.completed).toBe(true);
    expect(qm.saved['cat-cuddles']?.count).toBe(1);
    expect(qm.activeQuest?.id).toBe('cat-cuddles');
    // Prompt gone the moment the quest completes.
    expect(qm.getStepPrompt()).toBeNull();
    expect(qm.getHudState().stepPrompt).toBeNull();
    expect(qm.getHudState().trackerSections.room[0]).toBe('🐱 Cat Cuddles  1/3');
    // Toast never mentions coins for a 0-coin quest.
    expect(qm.getHudState().toast).toBe('🎉 Quest complete! 👋 First Steps');
    expect(qm.getHudState().toast).not.toContain('coins');
    // No extra coins beyond the pet coin (0 in node; the point is
    // the completion itself adds nothing).
    expect(getCoins()).toBe(coinsBefore);
    // Badge earned, once ever.
    expect(qm.getCompletions().some((b) => b.questId === 'first-steps')).toBe(true);
  });

  it('a second pet does not re-complete or double-count First Steps', () => {
    const qm = new QuestManager(fakeScene());
    qm.domHud = true;
    qm.refresh();
    qm.recordEvent('cat-pet');
    qm.recordEvent('cat-pet');
    expect(qm.saved['first-steps']?.count).toBe(1);
    expect(qm.saved['cat-cuddles']?.count).toBe(2);
  });

  it('shows the napping line while the cat is asleep', () => {
    const qm = new QuestManager(fakeScene({ asleep: true }));
    qm.domHud = true;
    qm.refresh();
    expect(qm.activeQuest?.id).toBe('first-steps');
    expect(qm.getStepPrompt()).toBe(FIRST_STEPS_ASLEEP_PROMPT);
    expect(qm.getHudState().stepPrompt).toBe(FIRST_STEPS_ASLEEP_PROMPT);
  });

  it('shows no prompt outside Agora', () => {
    const scene = fakeScene();
    scene.roomId = 'shepherd-park';
    const qm = new QuestManager(scene);
    qm.domHud = true;
    qm.refresh();
    expect(qm.activeQuest?.id).toBe('duck-roundup');
    expect(qm.getStepPrompt()).toBeNull();
  });
});
