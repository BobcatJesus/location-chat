// hatPickupPrompt.test.js — Santa Hat pickup prompt (`sq-hat-reset-v1`).
// When the local player picks up the hat — found behind the tree OR
// picked up off the ground after a slip — a prompt reads exactly
// "🎅 Santa hat for cats!". Just a message: it never places the hat;
// the player still has to walk to the cat and use "Put on the cat"
// in the pocket. DOM-free: drives SantaHatSystem with a fake scene
// (trimTreeQuest pattern). No canvas, no network.

import { describe, it, expect } from 'vitest';
import { SantaHatSystem } from '../src/village/SantaHatSystem.js';
import {
  HAT_PICKUP_PROMPT,
  HAT_SLIP_MS,
  createHatState,
  findHat,
  placeHat,
  slipHat,
  pickupHat,
  serializeHatState,
} from '../src/village/hatState.js';

const PROMPT = '🎅 Santa hat for cats!';

// Chainable stand-in for a Phaser GameObject (trimTreeQuest pattern):
// every draw call used by _drawAll returns itself.
function chainable() {
  const o = {};
  for (const m of [
    'fillStyle', 'fillEllipse', 'fillTriangle', 'fillRoundedRect', 'fillCircle',
    'setDepth', 'setSize', 'setOrigin', 'setPosition', 'setAlpha', 'setVisible',
    'clear', 'add',
  ]) o[m] = () => o;
  o.destroy = () => {};
  return o;
}

function fakeScene() {
  const notices = [];
  const emitted = [];
  const scene = {
    roomId: 'agora-houston',
    userId: 'u1',
    socket: { connected: false, emit: (ev, data) => emitted.push([ev, data]) },
    player: { gx: 1400, gy: 430 },
    onSystemNotice: (m) => notices.push(m),
    add: {
      graphics: () => chainable(),
      container: () => chainable(),
      text: () => chainable(),
    },
    // Stubbed pocket: the pickup always lands, without touching the
    // real items.js store (no cross-test pollution).
    itemsSystem: {
      getState: () => ({ items: [] }),
      returnHatToPocket: () => ({ ok: true }),
    },
  };
  return { scene, notices, emitted };
}

// A hat on the ground after a slip: hidden -> found -> on the cat ->
// slipped off. All transitions return ok (the slip is due).
function groundState() {
  const s = createHatState();
  expect(findHat(s, 'u1')).toMatchObject({ ok: true });
  expect(placeHat(s, 'u1', 1000)).toMatchObject({ ok: true });
  expect(slipHat(s, 800, 400, 1000 + HAT_SLIP_MS)).toMatchObject({ ok: true });
  expect(s.status).toBe('ground');
  return s;
}

describe('pickup prompt text', () => {
  it('is exactly "🎅 Santa hat for cats!"', () => {
    expect(HAT_PICKUP_PROMPT).toBe(PROMPT);
  });
});

describe('SantaHatSystem pickup prompt', () => {
  it('shows the prompt when I find the hat behind the tree', () => {
    const { scene } = fakeScene();
    const sys = new SantaHatSystem(scene);
    const next = createHatState();
    expect(findHat(next, 'u1')).toMatchObject({ ok: true });
    sys.applyState(serializeHatState(next));
    expect(sys.getHatNotice().text).toBe(PROMPT);
  });

  it('shows the prompt when I pick it up off the ground after a slip', () => {
    const { scene } = fakeScene();
    const sys = new SantaHatSystem(scene);
    const g = groundState();
    sys.applyState(serializeHatState(g));
    expect(sys.state.status).toBe('ground');
    expect(pickupHat(g, 'u1')).toMatchObject({ ok: true });
    sys.applyState(serializeHatState(g));
    expect(sys.getHatNotice().text).toBe(PROMPT);
  });

  it('shows the prompt when a pending ground pickup is confirmed late', () => {
    const { scene } = fakeScene();
    const sys = new SantaHatSystem(scene);
    // The client already saw it carried by someone else (stale prev);
    // the pickup confirm arrives late — the pickedConfirmed fallback fires.
    const prev = createHatState();
    findHat(prev, 'u2');
    sys.applyState(serializeHatState(prev));
    sys._pendingPickup = true;
    const next = createHatState();
    findHat(next, 'u1');
    sys.applyState(serializeHatState(next));
    expect(sys.getHatNotice().text).toBe(PROMPT);
  });

  it('the prompt does not place the hat — it stays carried until the pocket action', () => {
    const { scene } = fakeScene();
    const sys = new SantaHatSystem(scene);
    const next = createHatState();
    findHat(next, 'u1');
    sys.applyState(serializeHatState(next));
    expect(sys.getHatNotice().text).toBe(PROMPT);
    expect(sys.state.status).toBe('carried');
    expect(sys.state.carriedBy).toBe('u1');
    expect(sys.getState().carrying).toBe(true);
  });

  it('no prompt for me when someone else finds it', () => {
    const { scene } = fakeScene();
    const sys = new SantaHatSystem(scene);
    const next = createHatState();
    findHat(next, 'u2');
    sys.applyState(serializeHatState(next));
    expect(sys.getHatNotice().text).toBe(
      '🎅 Someone found the Santa hat behind the Christmas tree!'
    );
  });

  it('no prompt for me when someone else picks it up off the ground', () => {
    const { scene } = fakeScene();
    const sys = new SantaHatSystem(scene);
    const g = groundState();
    sys.applyState(serializeHatState(g));
    expect(pickupHat(g, 'u2')).toMatchObject({ ok: true });
    sys.applyState(serializeHatState(g));
    expect(sys.getHatNotice().text).toBe('🎅 Someone picked up the Santa hat.');
  });
});
