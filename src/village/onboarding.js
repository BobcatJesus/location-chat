// onboarding.js — Onboarding v1 (`sq-onboarding-v1`).
//
// Two parts, both for first-time players (Dec 19 showcase: most
// guests will be first-timers):
//   1. A welcome card on the map/landing page, shown ONCE ever.
//      It says what Side Quest is in one line, points at one first
//      thing (pet the cafe cat in Agora), and offers a button that
//      takes the player straight there. Dismissing it (either button)
//      sets the flag, so it never shows again on that browser.
//   2. The guided first quest, "First Steps" (defined in quests.js):
//      walk up to the cafe cat in Agora and pet her once. The step
//      prompt strings live here too, so all onboarding copy is in
//      one place.
//
// PURE LOGIC + localStorage flag: no Phaser, no React, no Node APIs,
// so it is unit-testable (tests/onboarding.test.js). The flag is
// PER BROWSER, not per profile — guests get the card too, and a
// second profile on the same browser does not see it again (they
// are not a first-time player of this browser). In node / private
// mode the flag falls back to an in-memory Map (same pattern as
// homeStorage.js), so tests never touch real storage.

import { FIRST_STEPS_QUEST_ID } from './quests.js';

export { FIRST_STEPS_QUEST_ID };

// Landing marker for the v1 kit check.
export const ONBOARDING_MARKER_V1 = 'sq-onboarding-v1';

// --- welcome card flag (per browser) --------------------------------

const WELCOME_SEEN_KEY = 'sidequest-onboarding-seen';

const _memory = new Map();

function _store() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {}
  return null;
}

function _get(key) {
  const store = _store();
  if (store) {
    try { return store.getItem(key); } catch { return null; }
  }
  return _memory.has(key) ? _memory.get(key) : null;
}

function _set(key, value) {
  const store = _store();
  if (store) {
    try { store.setItem(key, value); return; } catch {}
  }
  _memory.set(key, value);
}

function _remove(key) {
  const store = _store();
  if (store) {
    try { store.removeItem(key); return; } catch {}
  }
  _memory.delete(key);
}

/** Has this browser already seen (or dismissed) the welcome card? */
export function hasSeenWelcome() {
  try {
    return _get(WELCOME_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Mark the welcome card seen — it never shows again on this browser.
 *  Called on EITHER button (dismiss or "Take me to Agora"), so the
 *  card is one-time even for players who go straight into Agora. */
export function markWelcomeSeen() {
  try { _set(WELCOME_SEEN_KEY, '1'); } catch {}
}

/** Clear the flag (tests, and a manual "show the welcome again"). */
export function clearWelcomeSeen() {
  try { _remove(WELCOME_SEEN_KEY); } catch {}
}

// --- welcome card copy (exact wording — edit here, not in app.jsx) ---

export const WELCOME_TITLE = '👋 Welcome to Side Quest!';

export const WELCOME_BODY =
  'Side Quest turns real places into a game. Walk around, say hi to people, do quests, and earn coins.';

export const WELCOME_FIRST_STEP =
  'First up: head to the Agora café and pet the cat. 🐱';

export const WELCOME_GO_LABEL = '☕ Take me to Agora';

export const WELCOME_DISMISS_LABEL = 'Explore the map';

// --- First Steps step prompt -----------------------------------------
//
// Shown in the room (under the quest tracker) only while First Steps
// is the active quest and unfinished. The cat naps after 3 pets and
// only wakes when someone new walks in, so a player who arrives
// while she is asleep gets the napping line instead of being sent
// to a cat that can't be petted.

export const FIRST_STEPS_STEP_PROMPT =
  '👋 Walk up to the cat and press E to pet her';

export const FIRST_STEPS_ASLEEP_PROMPT =
  '💤 The cat is napping — she wakes up when someone new walks in.';
