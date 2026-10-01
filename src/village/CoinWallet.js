// CoinWallet.js - Lightweight virtual currency for place interactions.
// Stored in localStorage for now; server sync comes later.

const STORAGE_KEY = 'location-chat-coins';
const LAST_CHECKIN_KEY = 'location-chat-coins-last-checkin';
const DAILY_BONUS = 10;
const NEW_PLACE_BONUS = 5;
const VISITED_PLACES_KEY = 'location-chat-visited-places';

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export function getCoins() {
  try {
    // Daily check-in bonus
    const lastCheckin = localStorage.getItem(LAST_CHECKIN_KEY);
    const today = todayString();
    let coins = Number(localStorage.getItem(STORAGE_KEY) || 0);

    if (lastCheckin !== today) {
      coins += DAILY_BONUS;
      localStorage.setItem(STORAGE_KEY, String(coins));
      localStorage.setItem(LAST_CHECKIN_KEY, today);
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
    localStorage.setItem(STORAGE_KEY, String(current - amount));
    return true;
  } catch {
    return false;
  }
}

export function earnCoins(amount, reason) {
  try {
    const current = getCoins();
    localStorage.setItem(STORAGE_KEY, String(current + amount));
    return current + amount;
  } catch {
    return getCoins();
  }
}

export function awardNewPlaceVisit(placeId) {
  try {
    const visited = JSON.parse(localStorage.getItem(VISITED_PLACES_KEY) || '[]');
    if (!visited.includes(placeId)) {
      visited.push(placeId);
      localStorage.setItem(VISITED_PLACES_KEY, JSON.stringify(visited));
      return earnCoins(NEW_PLACE_BONUS, 'new-place');
    }
  } catch {}
  return getCoins();
}

// Jukebox pricing
export const JUKEBOX_QUEUE_JUMP_COST = 3;
