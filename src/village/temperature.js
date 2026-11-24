// temperature.js — Temperature System v1 (`sq-temperature-v1`).
//
// The seasons make you cold or warm, and the bar sells the fix.
//   - Fall (Sep, Oct, Nov) + winter (Dec, Jan, Feb) = COLD season:
//     you are cold by default. A warm drink (hot cocoa, coffee)
//     warms you for 30 minutes.
//   - Spring (Mar, Apr, May) + summer (Jun, Jul, Aug) = WARM season:
//     you are warm by default. A cold drink (beer, iced coffee)
//     cools you for 30 minutes.
//   - After 30 minutes the season catches up again and the
//     notification returns.
//
// This is a SYSTEM, not a quest: no quest entry, no coins, no
// badge. The motivation is the notification plus the shivering /
// sweating stopping when you drink. No speed change, no penalty
// either way — cold and warm are a nudge, not a punishment.
//
// The module is pure (no Phaser, no socket, no React) so the
// season math and the state machine are unit-testable. The only
// impure part is the persistence: warmUntil / coolUntil live in
// localStorage so a refresh does not reset the 30 minutes, with
// the same in-memory fallback as items.js when localStorage is
// unavailable (node tests / private mode). Temperature state is
// per-player and client-side — other players never see you
// shiver or sweat, and no server change was needed.

export const TEMP_MARKER_V1 = 'sq-temperature-v1';

/** The season clock runs on Houston time, like the cat's hunger
 *  windows (catHunger.js) and the day/night phase. */
export const TEMP_TIMEZONE = 'America/Chicago';

/** How long one matching drink keeps you comfortable: 30 minutes
 *  (the user-decided duration — "maybe like 30 minutes"). */
export const TEMP_EFFECT_MS = 30 * 60 * 1000;

/** The exact notification texts (user-decided wording). */
export const COLD_TOAST = "You're cold, get a warm drink";
export const WARM_TOAST = "You're warm, get a cold drink";
// sq-temperature-v1.2: the payoff toasts — v1 only told you that
// you were cold/warm, never that the drink had fixed it, so the
// coffee felt like it did nothing. Shown when a matching drink
// takes effect (only then, never for a wrong-season drink).
export const WARMED_TOAST = "☕ Ahhh... you're warmed up for 30 minutes.";
export const COOLED_TOAST = "🧊 Ahhh... you're cooled down for 30 minutes.";

/** The two seasons. 'cold' covers fall + winter, 'warm' covers
 *  spring + summer. */
export const TEMP_SEASONS = ['cold', 'warm'];

/** The drinks the Agora bar sells for temperature (builder picks:
 *  2 coins each, same as coffee; cocoa and iced coffee are new).
 *  Beer is the other cold drink, but it is NOT sold here — it
 *  comes from the bartender's existing order flow, so it is not
 *  in this table. */
export const TEMP_DRINK_KINDS = {
  cocoa: {
    kind: 'cocoa', emoji: '🍫', label: 'Hot cocoa', price: 2, temp: 'warm',
    blurb: 'Rich, sweet, and properly hot. Warms you right through.',
  },
  'iced-coffee': {
    kind: 'iced-coffee', emoji: '🧊', label: 'Iced coffee', price: 2, temp: 'cool',
    blurb: 'Cold-brewed and ice-cold. Cools you right down.',
  },
};
export const TEMP_DRINK_KIND_IDS = ['cocoa', 'iced-coffee'];

/** The price of any temperature drink (2 coins, same as coffee). */
export const TEMP_DRINK_PRICE = 2;

/** Chicago wall-clock month (1–12) for a Date, via Intl — the
 *  same pattern as catHunger.js chicagoDateParts. Falls back to
 *  local time if Intl has no such timezone. */
export function chicagoMonth(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TEMP_TIMEZONE, month: 'numeric',
    }).formatToParts(date);
    return Number(parts.find((p) => p.type === 'month')?.value || 0);
  } catch {
    return date.getMonth() + 1;
  }
}

/** Which season a moment falls in, by Chicago month:
 *  Sep–Nov (fall) + Dec–Feb (winter) = 'cold';
 *  Mar–May (spring) + Jun–Aug (summer) = 'warm'. */
export function seasonFor(date = new Date()) {
  const m = chicagoMonth(date);
  if (m === 12 || m === 1 || m === 2 || m === 9 || m === 10 || m === 11) return 'cold';
  return 'warm';
}

/** Fresh temperature state. warmUntil / coolUntil are epoch ms
 *  until which a matching drink keeps you comfortable (0 = no
 *  drink in effect). notifiedSpell is which exposure the player
 *  has already been told about ('cold' | 'warm' | null) — it is
 *  deliberately NOT persisted: re-entering the app while exposed
 *  toasts again, which is the designed "on entering the app"
 *  notification. */
export function createTemperatureState() {
  return { warmUntil: 0, coolUntil: 0, notifiedSpell: null };
}

/** What the player is exposed to right now: 'cold' when the
 *  season is cold and no warm drink is in effect, 'warm' when
 *  the season is warm and no cold drink is in effect, null when
 *  comfortable. `season` defaults to the season for `date`. */
export function exposureFor(state, { now = Date.now(), date = new Date(now), season = seasonFor(date) } = {}) {
  if (season === 'cold') return now >= (Number(state?.warmUntil) || 0) ? 'cold' : null;
  if (season === 'warm') return now >= (Number(state?.coolUntil) || 0) ? 'warm' : null;
  return null;
}

/** The tick: given the current state and the time, work out the
 *  next state and whether to notify. Returns
 *  { state, exposure, toast } — `toast` is the exact notification
 *  text, or null.
 *
 *  The notification fires ONCE PER SPELL: the first tick of a
 *  cold/warm spell toasts; later ticks in the same spell do not
 *  (notifiedSpell remembers which one was announced). The spell
 *  ends when a matching drink is taken (applyDrink clears
 *  notifiedSpell) or the season changes, so the next exposure
 *  toasts again — on entering the app, and again when a drink's
 *  30 minutes wear off. While comfortable, notifiedSpell resets
 *  to null. */
export function refreshTemperature(state, { now = Date.now(), date = new Date(now), season = seasonFor(date) } = {}) {
  const next = { ...(state || createTemperatureState()) };
  const exposure = exposureFor(next, { now, date, season });
  let toast = null;
  if (exposure === 'cold' && next.notifiedSpell !== 'cold') {
    next.notifiedSpell = 'cold';
    toast = COLD_TOAST;
  } else if (exposure === 'warm' && next.notifiedSpell !== 'warm') {
    next.notifiedSpell = 'warm';
    toast = WARM_TOAST;
  } else if (!exposure && next.notifiedSpell) {
    next.notifiedSpell = null;
  }
  return { state: next, exposure, toast };
}

/** A drink was taken. `kind` is 'warm' (hot cocoa, coffee) or
 *  'cool' (beer, iced coffee). A drink only fixes the MATCHING
 *  state: a warm drink in the cold season warms for 30 minutes,
 *  a cool drink in the warm season cools for 30 minutes. Any
 *  other combination is just a drink — the state is unchanged
 *  and `applied` is false. A matching drink taken while already
 *  comfortable refreshes the 30 minutes from now. */
export function applyDrink(state, { kind, now = Date.now(), date = new Date(now), season = seasonFor(date) } = {}) {
  const next = { ...(state || createTemperatureState()) };
  if (kind === 'warm' && season === 'cold') {
    next.warmUntil = now + TEMP_EFFECT_MS;
    next.notifiedSpell = null;
    return { state: next, applied: true };
  }
  if (kind === 'cool' && season === 'warm') {
    next.coolUntil = now + TEMP_EFFECT_MS;
    next.notifiedSpell = null;
    return { state: next, applied: true };
  }
  return { state: next, applied: false };
}

// --- persistence (localStorage; in-memory fallback) -----------------------
// Same shape as items.js: the real localStorage when available,
// a module-level Map when it is not (node tests / private mode).
// Only warmUntil / coolUntil are stored — notifiedSpell is
// session-only by design (see createTemperatureState).

export const TEMP_STORAGE_KEY = 'sidequest:temperature-v1';

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

/** Load the persisted drink timers. Garbage or a missing record
 *  loads as no drink in effect (0s) — never a crash. An explicit
 *  `storage` object ({ getItem, setItem }) overrides the default
 *  store; tests use it so they never touch the real localStorage. */
export function loadTemperatureState(storage) {
  let raw = null;
  try {
    raw = storage ? storage.getItem(TEMP_STORAGE_KEY) : _get(TEMP_STORAGE_KEY);
  } catch {
    raw = null;
  }
  const state = createTemperatureState();
  if (!raw) return state;
  try {
    const parsed = JSON.parse(raw);
    const warm = Number(parsed?.warmUntil);
    const cool = Number(parsed?.coolUntil);
    if (Number.isFinite(warm) && warm > 0) state.warmUntil = warm;
    if (Number.isFinite(cool) && cool > 0) state.coolUntil = cool;
  } catch {}
  return state;
}

/** Persist the drink timers (warmUntil / coolUntil only). */
export function saveTemperatureState(state, storage) {
  const payload = JSON.stringify({
    warmUntil: Number(state?.warmUntil) || 0,
    coolUntil: Number(state?.coolUntil) || 0,
  });
  try {
    if (storage) storage.setItem(TEMP_STORAGE_KEY, payload);
    else _set(TEMP_STORAGE_KEY, payload);
  } catch {}
}

/** Test seam: clear the module-level in-memory fallback. */
export function _clearTemperatureMemoryForTest() {
  _memory.clear();
}
