// hunger.js — Hunger System v1 (`sq-hunger-v1`).
//
// You are hungry by default. Eating any food (bread roll, croissant,
// baguette, bits of food) takes one bite per charge; one bite leaves
// you still hungry ("Still hungry... eat more."), three bites fill
// you for 8 hours ("😋 Ahhh... full for most of the day."). Bites
// accumulate across different foods while hungry, and reset when
// hunger returns after the 8 hours expire.
//
// This is a SYSTEM, not a quest: no quest entry, no coins, no
// badge, and NO penalty for being hungry — the same shape as the
// Temperature System (temperature.js): the motivation is the
// notification plus the full feeling, not a punishment.
//
// The queasy gag: food picked up off the ground (trash food — a
// dropped croissant by the bar, bits by the pond) still counts as
// a bite and works fine, but it also makes you feel queasy for
// about a minute (a 🤢 marker above the head, cosmetic only — no
// mechanical effect, no cure). Bought breads (which carry a
// breadKind) never make you queasy. Which food is trash food is
// decided by the item itself (see items.js `trashFood`); this
// module only owns the queasy duration.
//
// The module is pure (no Phaser, no socket, no React) so the
// bite math and the state machine are unit-testable. The only
// impure part is the persistence: fedUntil / bites live in
// localStorage so a refresh does not reset the 8 hours, with the
// same in-memory fallback as items.js / temperature.js when
// localStorage is unavailable (node tests / private mode).
// Hunger state is per-player and client-side — other players
// never see your "hungry..." bubble, and no server change was
// needed. The queasy timer itself is NOT persisted: it lives in
// the HungerSystem instance (1 minute, cosmetic).

export const HUNGER_MARKER_V1 = 'sq-hunger-v1';

/** How long three bites keep you full: 8 hours (the user-decided
 *  duration — "8 hours is fine", "most of the day"). */
export const HUNGER_FED_MS = 8 * 60 * 60 * 1000;

/** Bites to full: 3 — one food item's charges (FOOD_FEEDS_PER_ITEM
 *  in items.js), so one croissant fills you. */
export const HUNGER_BITES_TO_FULL = 3;

/** How long trash food makes you queasy: about 1 minute, then it
 *  clears on its own. Cosmetic only. */
export const QUEASY_MS = 60 * 1000;

/** The exact notification texts (user-decided wording). */
export const HUNGER_TOAST = "you're hungry...";
export const STILL_HUNGRY_TOAST = 'Still hungry... eat more.';
export const FULL_TOAST = '😋 Ahhh... full for most of the day.';
export const ALREADY_FULL_TOAST = "You're already full.";
export const QUEASY_TOAST = '🤢 You feel a tiny bit queasy.';

/** The bubble above the player's head while hungry — the same
 *  words as the cafe cat's "hungry..." bubble (catHunger.js). */
export const HUNGER_BUBBLE_TEXT = 'hungry...';

/** Fresh hunger state. fedUntil is the epoch ms until which you
 *  are full (0 = hungry). bites is how many bites you have eaten
 *  in the current hunger spell (0–2 — the third bite fills you
 *  and resets it). notifiedSpell is which hunger spell the player
 *  has already been told about ('hungry' | null) — it is
 *  deliberately NOT persisted: re-entering the app while hungry
 *  toasts again, which is the designed "on entering the app"
 *  notification. */
export function createHungerState() {
  return { fedUntil: 0, bites: 0, notifiedSpell: null };
}

/** Are you hungry right now? Hungry by default (fedUntil 0), full
 *  until fedUntil, hungry again the moment it expires. */
export function isHungry(state, { now = Date.now() } = {}) {
  return now >= (Number(state?.fedUntil) || 0);
}

/** The tick: given the current state and the time, work out the
 *  next state and whether to notify. Returns
 *  { state, hungry, toast } — `toast` is the exact notification
 *  text, or null.
 *
 *  The notification fires ONCE PER SPELL: the first tick of a
 *  hunger spell toasts "you're hungry..."; later ticks in the same
 *  spell do not (notifiedSpell remembers it was announced). The
 *  spell ends when three bites fill you (takeBite clears
 *  notifiedSpell), so the next hunger toasts again — on entering
 *  the app, and again when the 8 fed hours wear off. While full,
 *  notifiedSpell resets to null. */
export function refreshHunger(state, { now = Date.now() } = {}) {
  const next = { ...(state || createHungerState()) };
  const hungry = isHungry(next, { now });
  let toast = null;
  if (hungry && next.notifiedSpell !== 'hungry') {
    next.notifiedSpell = 'hungry';
    toast = HUNGER_TOAST;
  } else if (!hungry && next.notifiedSpell) {
    next.notifiedSpell = null;
  }
  return { state: next, hungry, toast };
}

/** One bite of food. Returns { state, applied, full, bites,
 *  reason? }.
 *
 *  - Already full: the bite does NOT land (`applied: false`,
 *    reason 'already-full') — the caller must not spend a charge
 *    for it. (The cat-cooldown edge: never spend a charge for a
 *    bite that did not happen.)
 *  - Otherwise the bite lands: bites + 1. At 3 bites you are full
 *    for 8 hours (fedUntil = now + HUNGER_FED_MS, bites reset to 0
 *    for the next spell, notifiedSpell cleared so the next hunger
 *    toasts again). Below 3 you are still hungry — eat more. */
export function takeBite(state, { now = Date.now() } = {}) {
  const next = { ...(state || createHungerState()) };
  if (!isHungry(next, { now })) {
    return { state: next, applied: false, full: false, bites: Number(next.bites) || 0, reason: 'already-full' };
  }
  const bites = (Number(next.bites) || 0) + 1;
  if (bites >= HUNGER_BITES_TO_FULL) {
    next.bites = 0;
    next.fedUntil = now + HUNGER_FED_MS;
    next.notifiedSpell = null;
    return { state: next, applied: true, full: true, bites: 0 };
  }
  next.bites = bites;
  return { state: next, applied: true, full: false, bites };
}

// --- persistence (localStorage; in-memory fallback) -----------------------
// Same shape as temperature.js: the real localStorage when
// available, a module-level Map when it is not (node tests /
// private mode). Only fedUntil / bites are stored — notifiedSpell
// is session-only by design (see createHungerState).

export const HUNGER_STORAGE_KEY = 'sidequest:hunger-v1';

const _memory = new Map();

function _store() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {}
  return null;
}

function _get(key) {
  const s = _store();
  try {
    if (s) return s.getItem(key);
  } catch {}
  return _memory.has(key) ? _memory.get(key) : null;
}

function _set(key, value) {
  const s = _store();
  try {
    if (s) { s.setItem(key, value); return; }
  } catch {}
  _memory.set(key, value);
}

/** Load the persisted hunger state. Garbage or a missing record
 *  loads as hungry (fedUntil 0, bites 0) — never a crash. An
 *  explicit `storage` object ({ getItem, setItem }) overrides the
 *  default store; tests use it so they never touch the real
 *  localStorage. */
export function loadHungerState(storage) {
  let raw = null;
  try {
    raw = storage ? storage.getItem(HUNGER_STORAGE_KEY) : _get(HUNGER_STORAGE_KEY);
  } catch {
    raw = null;
  }
  const state = createHungerState();
  if (!raw) return state;
  try {
    const parsed = JSON.parse(raw);
    const fed = Number(parsed?.fedUntil);
    const bites = Number(parsed?.bites);
    if (Number.isFinite(fed) && fed > 0) state.fedUntil = fed;
    if (Number.isFinite(bites) && bites >= 0 && bites < HUNGER_BITES_TO_FULL) state.bites = Math.floor(bites);
  } catch {}
  return state;
}

/** Persist the hunger state (fedUntil / bites only). */
export function saveHungerState(state, storage) {
  const payload = JSON.stringify({
    fedUntil: Number(state?.fedUntil) || 0,
    bites: Number(state?.bites) || 0,
  });
  try {
    if (storage) storage.setItem(HUNGER_STORAGE_KEY, payload);
    else _set(HUNGER_STORAGE_KEY, payload);
  } catch {}
}

/** Test seam: clear the module-level in-memory fallback. */
export function _clearHungerMemoryForTest() {
  _memory.clear();
}
