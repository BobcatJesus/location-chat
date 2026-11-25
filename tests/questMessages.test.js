// questMessages.test.js — Quest messages top-right v1
// (`sq-quest-messages-topright-v1`). The quest banner and toast
// auto-dismiss after 25 seconds (banner was 5.5s, toast was 4.5s),
// so an unread message has time to be noticed without sitting in
// the middle of the screen. Pure QuestManager flow test with a fake
// scene that records the delayedCall durations (no Phaser).
// localStorage is undefined under vitest's node env, so
// QuestManager's save/load no-ops and each manager is fresh.

import { describe, it, expect } from 'vitest';
import { QuestManager } from '../src/village/QuestManager.js';

function capturingScene() {
  const delays = [];
  return {
    scene: {
      roomId: 'agora-houston',
      socket: null,
      time: {
        delayedCall: (ms) => {
          delays.push(ms);
          return { remove() {} };
        },
      },
      cafeCat: { asleep: false },
    },
    delays,
  };
}

describe('quest message auto-dismiss (25s)', () => {
  it('banner dismisses after 25s, not 5.5s', () => {
    const { scene, delays } = capturingScene();
    const qm = new QuestManager(scene);
    qm.domHud = true;
    qm.refresh();
    expect(qm.getHudState().banner).toBeTruthy();
    expect(delays).toContain(25000);
    expect(delays).not.toContain(5500);
  });

  it('toast dismisses after 25s, not 4.5s', () => {
    const { scene, delays } = capturingScene();
    const qm = new QuestManager(scene);
    qm.domHud = true;
    qm.refresh();
    qm.recordEvent('cat-pet');
    expect(qm.getHudState().toast).toBeTruthy();
    expect(delays).toContain(25000);
    expect(delays).not.toContain(4500);
  });
});
