// CoinWallet.js - Lightweight virtual currency for place interactions.
// Stored in localStorage for now; server sync comes later.
//
// Wallets are PER PROFILE: every storage key is scoped to the current
// profile's email (guests receive a unique guest email when they enter),
// so a user, a second user, and a guest on the same browser each keep
// their own balance, daily check-in, and visited-places list.

const PROFILE_KEY = 'sidequest_profile';
const COINS_PREFIX = 'location-chat-coins';
const CHECKIN_PREFIX = 'location-chat-coins-last-checkin';
const VISITED_PREFIX = 'location-chat-visited-places';
const DAILY_BONUS = 10;
const NEW_PLACE_BONUS = 5;

// Who owns the wallet right now? Resolved fresh on every call so that
// logging in, logging out, or entering as a guest switches wallets
// immediately — no reload needed.
function currentOwner() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return 'shared';
    const p = JSON.parse(raw);
    const id = p?.email || p?.profile?.email || p?.id || p?.profile?.id || p?.userId || p?.profile?.userId;
    const clean = String(id || '').trim().toLowerCase();
    return clean || 'shared';
  } catch {
    return 'shared';
  }
}

function key(prefix) {
  return `${prefix}:${currentOwner()}`;
}

// One-time adoption: the FIRST real profile to load after per-profile
// wallets shipped inherits the old shared balance, so nobody's existing
// coins vanish in the switch. The legacy keys are removed afterwards —
// every later profile starts with its own beginning wallet.
const MIGRATED_KEY = 'location-chat-coins-migrated';
function migrateLegacy() {
  try {
    const owner = currentOwner();
    if (owner === 'shared') return;
    if (localStorage.getItem(MIGRATED_KEY) !== null) return;
    localStorage.setItem(MIGRATED_KEY, owner);
    const legacy = localStorage.getItem(COINS_PREFIX);
    if (legacy === null) return;
    localStorage.setItem(`${COINS_PREFIX}:${owner}`, legacy);
    const legacyCheckin = localStorage.getItem(CHECKIN_PREFIX);
    if (legacyCheckin !== null) localStorage.setItem(`${CHECKIN_PREFIX}:${owner}`, legacyCheckin);
    const legacyVisited = localStorage.getItem(VISITED_PREFIX);
    if (legacyVisited !== null) localStorage.setItem(`${VISITED_PREFIX}:${owner}`, legacyVisited);
    localStorage.removeItem(COINS_PREFIX);
    localStorage.removeItem(CHECKIN_PREFIX);
    localStorage.removeItem(VISITED_PREFIX);
  } catch {}
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export function getCoins() {
  try {
    migrateLegacy();
    // Daily check-in bonus (per profile)
    const lastCheckin = localStorage.getItem(key(CHECKIN_PREFIX));
    const today = todayString();
    let coins = Number(localStorage.getItem(key(COINS_PREFIX)) || 0);

    if (lastCheckin !== today) {
      coins += DAILY_BONUS;
      localStorage.setItem(key(COINS_PREFIX), String(coins));
      localStorage.setItem(key(CHECKIN_PREFIX), today);
    }
    return coins;
  } catch {
    return 0;
  }
}

export function spendCoins(amount) {
  const current = getCoins();
  if (current < amount) return false;
  try {
    localStorage.setItem(key(COINS_PREFIX), String(current - amount));
    return true;
  } catch {
    return false;
  }
}

export function earnCoins(amount, reason) {
  try {
    const current = getCoins();
    localStorage.setItem(key(COINS_PREFIX), String(current + amount));
    return current + amount;
  } catch {
    return getCoins();
  }
}

export function awardNewPlaceVisit(placeId) {
  try {
    migrateLegacy();
    const visited = JSON.parse(localStorage.getItem(key(VISITED_PREFIX)) || '[]');
    if (!visited.includes(placeId)) {
      visited.push(placeId);
      localStorage.setItem(key(VISITED_PREFIX), JSON.stringify(visited));
      return earnCoins(NEW_PLACE_BONUS, 'new-place');
    }
  } catch {}
  return getCoins();
}

// Jukebox pricing
export const JUKEBOX_YOUTUBE_REQUEST_COST = 3;

// Bar pricing
export const BAR_DRINK_COST = 2;
