// items.js — the Side Quest item + inventory model (Items + Inventory v1,
// `sq-items-inventory-v1`).
//
// PURE LOGIC + localStorage store: no Phaser, no React, no Node APIs, so
// it is unit-testable (tests/items.test.js) and importable from both the
// scene systems and the DOM panel.
//
// THE USER'S RULES (decided in chat 2026-11-16 — do not invent others):
//   - Start with a POCKET that holds 3 items. Upgrade to a BAG (purse or
//     backpack) that holds 10 — and the bag appears on the avatar.
//   - Inventory UI is a button at the BOTTOM LEFT (NOT the toolbar).
//     Tapping it opens the pocket/bag as a list that pops up and
//     obscures the location for a moment; closing it returns to the
//     room (same feel as the puzzle board zoom).
//   - v1 items — ONLY the user's own list:
//       trash, flyers, notes, diary, bits of food, half-empty cigarette box.
//   - Decoration Shop v1 (`sq-dec-shop-v1`) adds ONE more item type:
//     Christmas decorations, bought at the Agora bar (ornament 5,
//     lights 10, snowman 15, tree 25, santa 20 — tree and Santa are
//     builder picks, the rest are the user's prices). A decoration
//     is a pocket item until placed; placing puts it in the room
//     for everyone to see (server-synced, like the notice board).
//   - Finding reuses the puzzle v1.2 pattern: scene-level pointerdown +
//     distance checks, 3 clicks on hiding furniture for hidden things,
//     1 click on visible ground litter.
//   - PUZZLE PIECES ARE INVENTORY ITEMS TOO (decided 2026-11-16): a
//     found piece goes into the pocket and occupies one slot until it
//     is placed on the puzzle board, which frees the slot again. A full
//     pocket means the piece CANNOT be picked up — "Your pocket is
//     full — place a piece on the puzzle board first."
//
// NUMBERS THE USER DID NOT DECIDE (picked here, documented):
//   - BAG_PRICE_COINS = 20 coins, bought from a button inside the
//     inventory popup.
//   - FLYER_CREATE_COST = 5 coins: write a title + text, pay, and the
//     flyer goes into your pocket (readable, droppable as ground
//     litter in the room for this session). Posting a flyer so OTHER
//     players can find it needs server sync — v2, not v1.
//   - Capacity-full behaviour: the pickup is REFUSED (nothing is
//     dropped automatically). The player makes room by using, dropping,
//     throwing away, or placing a puzzle piece on the board.
//   - Trash-can searches are repeatable (it is a trash can); the seeded
//     note / diary / flyer / cigarette box are one-time finds per
//     profile; ground litter respawns each time you enter the room.
//
// Storage is PER PROFILE (same scoping as CoinWallet) and client-side
// only (localStorage). No server change in v1.

import { getCoins, spendCoins, earnCoins } from './CoinWallet.js';
import { DECOR_KINDS } from './decorState.js';

export const ITEMS_MARKER_V1 = 'sq-items-inventory-v1';

// --- capacities & prices (user-decided numbers are 3 and 10) ------------
export const POCKET_CAPACITY = 3;
export const BAG_CAPACITY = 10;
export const BAG_PRICE_COINS = 20;
export const FLYER_CREATE_COST = 5;
// Hidden things take the same 3 clicks as puzzle v1.2 pieces.
export const ITEM_SEARCH_CLICKS = 3;
export const ITEM_SEARCH_RANGE = 140; // px from hiding furniture
export const LITTER_PICKUP_RANGE = 90; // px from ground litter (player)
export const LITTER_CLICK_RANGE = 44; // px from litter (the click itself)

export const INVENTORY_FULL_MESSAGE =
  'Your pocket is full — place a piece on the puzzle board first.';
export const INVENTORY_FULL_GENERIC =
  'Your pocket is full — use, drop, or throw something away to make room.';

// --- item types -----------------------------------------------------------
export const ITEM_TYPES = {
  TRASH: 'trash',
  FLYER: 'flyer',
  NOTE: 'note',
  DIARY: 'diary',
  FOOD: 'food',
  CIGARETTES: 'cigarettes',
  PUZZLE_PIECE: 'puzzle-piece',
  DECORATION: 'decoration',
  // Santa Hat v1 (`sq-santa-hat-v1`): one hat, hidden behind the
  // Christmas tree in Agora. Found -> pocket -> put on the cafe cat.
  SANTA_HAT: 'santa-hat',
  // Mailbox v1 (`sq-mailbox-v1`): the key to your mailbox at the
  // park. Auto-granted (see ensureMailboxKey) — one per player.
  // It takes a pocket slot, cannot be dropped or sent (dropping or
  // sending it would lock you out of your own mail), and can be
  // left at home (home storage) until you need it.
  MAILBOX_KEY: 'mailbox-key',
};

// label / emoji / one-line blurb per type. `readable` items open a
// reader when tapped; `usable` items have a Use action (food).
export const ITEM_DEFS = {
  [ITEM_TYPES.TRASH]: {
    emoji: '🗑️', label: 'Piece of trash',
    blurb: 'Crumpled, a bit sticky. It belongs in the trash can.',
    readable: false, usable: false, disposable: true,
  },
  [ITEM_TYPES.FLYER]: {
    emoji: '📄', label: 'Flyer',
    blurb: 'An advertisement someone made — or one you made yourself.',
    readable: true, usable: false, disposable: false,
  },
  [ITEM_TYPES.NOTE]: {
    emoji: '📝', label: 'A note someone left behind',
    blurb: 'Folded twice, left for someone to find.',
    readable: true, usable: false, disposable: false,
  },
  [ITEM_TYPES.DIARY]: {
    emoji: '📖', label: "Someone's diary",
    blurb: 'Full of interesting insights. Probably not yours to read… but here we are.',
    readable: true, usable: false, disposable: false,
  },
  [ITEM_TYPES.FOOD]: {
    emoji: '🥐', label: 'Bits of food',
    blurb: 'Crumbs and a squashed bread roll. The ducks will love it. The cat might too.',
    readable: false, usable: true, disposable: false,
  },
  [ITEM_TYPES.CIGARETTES]: {
    emoji: '🚬', label: 'Half-empty cigarette box',
    blurb: 'A half-empty box of cigarettes. Someone’s bad habit, abandoned mid-pack.',
    readable: false, usable: false, disposable: false,
  },
  [ITEM_TYPES.PUZZLE_PIECE]: {
    emoji: '🧩', label: 'Puzzle piece',
    blurb: 'A piece of the cat puzzle. Place it on the puzzle board to free this slot.',
    readable: false, usable: false, disposable: false,
  },
  // Decoration Shop v1 (`sq-dec-shop-v1`): bought at the Agora bar,
  // placed anywhere from the pocket. The per-kind label / emoji /
  // blurb come from DECOR_KINDS (see describeItem) — this is only
  // the fallback when a stored item has no kind.
  [ITEM_TYPES.DECORATION]: {
    emoji: '🎄', label: 'Christmas decoration',
    blurb: 'Bought at the Agora bar. Place it anywhere — everyone in the room will see it.',
    readable: false, usable: false, disposable: false,
  },
  // Santa Hat v1 (`sq-santa-hat-v1`): found behind the Christmas
  // tree, put on the cafe cat. It slips off after a while and lands
  // on the ground — pick it up and put it back on her. Cannot be
  // dropped (the hat is a shared room item with server state;
  // dropping it as session litter would strand it).
  [ITEM_TYPES.SANTA_HAT]: {
    emoji: '🎅', label: 'Santa hat',
    blurb: 'A Santa hat, found behind the Christmas tree. It belongs on the cat — until it slips off again.',
    readable: false, usable: false, disposable: false,
  },
  // Mailbox v1 (`sq-mailbox-v1`): the key to your mailbox at the
  // park. It opens your mailbox — keep it in your pocket when you
  // go to collect mail, or leave it at home until you need it.
  [ITEM_TYPES.MAILBOX_KEY]: {
    emoji: '🔑', label: 'Mailbox key',
    blurb: 'The key to your mailbox at the park. Keep it in your pocket to open your mail — or leave it at home until you need it.',
    readable: false, usable: false, disposable: false,
  },
};

// --- readable content (in-world flavor, written for the game — nothing
// here claims to be a real person's writing) -------------------------------
export const DIARY_ENTRIES = [
  {
    title: 'Day 12 at the cafe',
    text: 'The barista finally remembered my order. Small thing. Felt enormous. I think I’ll keep coming back to the same table, same hour, until the light at 4pm feels like mine.',
  },
  {
    title: 'The ducks know something',
    text: 'Spent an hour at the park pond today. The ducks don’t hurry. They don’t perform. They just paddle, and wait, and somehow that’s the whole afternoon sorted. I want to be more like the ducks.',
  },
  {
    title: 'Note to self',
    text: 'If a place makes you want to stay a little longer than you planned, that’s not wasted time. That’s the point of the place. Write that down somewhere you’ll actually read it.',
  },
];

// Seeded findable flyers / notes (one each in v1 — more can be added
// to these pools later without changing any code that reads them).
export const SEEDED_FLYERS = [
  {
    title: '🎸 Guitar lessons — first lesson free!',
    text: 'Patient teacher, all levels. Bring your own guitar or borrow mine for the first month. Ask at the coffee bar and mention the flyer. — Jules',
  },
];

export const SEEDED_NOTES = [
  {
    title: 'A note under the table',
    text: 'Meet me at the puzzle table at sunset. Bring the good coffee, not the burnt stuff. — R',
  },
];

// --- storage (per profile, localStorage; in-memory fallback when
// localStorage is unavailable, e.g. node tests / private mode) ------------
const PROFILE_KEY = 'sidequest_profile';
const INVENTORY_PREFIX = 'sidequest-inventory';
const FOUND_PREFIX = 'sidequest-items-found';

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

function currentOwner() {
  try {
    const raw = _get(PROFILE_KEY);
    if (!raw) return 'shared';
    const p = JSON.parse(raw);
    const id = p?.email || p?.profile?.email || p?.id || p?.profile?.id || p?.userId || p?.profile?.userId;
    return String(id || '').trim().toLowerCase() || 'shared';
  } catch {
    return 'shared';
  }
}

function inventoryKey() {
  return `${INVENTORY_PREFIX}:${currentOwner()}`;
}

function foundKey() {
  return `${FOUND_PREFIX}:${currentOwner()}`;
}

function emptyInventory() {
  return { items: [], hasBag: false };
}

export function getInventory() {
  try {
    const raw = _get(inventoryKey());
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || !Array.isArray(parsed.items)) return emptyInventory();
    return { items: parsed.items, hasBag: Boolean(parsed.hasBag) };
  } catch {
    return emptyInventory();
  }
}

function saveInventory(inv) {
  try {
    _set(inventoryKey(), JSON.stringify({
      items: Array.isArray(inv?.items) ? inv.items : [],
      hasBag: Boolean(inv?.hasBag),
    }));
  } catch {}
}

/** Test/support hook: replace the whole inventory (used by tests). */
export function _setInventoryForTest(inv) {
  saveInventory(inv);
}

export function capacity(inv = getInventory()) {
  return inv.hasBag ? BAG_CAPACITY : POCKET_CAPACITY;
}

export function hasBag(inv = getInventory()) {
  return Boolean(inv?.hasBag);
}

export function isFull(inv = getInventory()) {
  return inv.items.length >= capacity(inv);
}

export function itemCount(inv = getInventory()) {
  return inv.items.length;
}

export function makeItemId(type) {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function describeItem(item) {
  const def = ITEM_DEFS[item?.type] || {};
  // Decoration Shop v1: a decoration's label / emoji / blurb come
  // from its kind (ornament, lights, snowman, tree, santa) — the
  // generic def above is only the fallback for a kindless item.
  const kindDef = item?.type === ITEM_TYPES.DECORATION
    ? (DECOR_KINDS[item?.decorKind] || null)
    : null;
  return {
    id: item.id,
    type: item.type,
    pieceId: typeof item.pieceId === 'number' ? item.pieceId : null,
    decorKind: item?.type === ITEM_TYPES.DECORATION ? (item.decorKind || null) : null,
    decorPrice: kindDef ? kindDef.price : null,
    emoji: kindDef?.emoji || def.emoji || '📦',
    label: item.label || kindDef?.label || def.label || 'Item',
    blurb: item.blurb || kindDef?.blurb || def.blurb || '',
    text: item.text || null,
    title: item.title || null,
    readable: Boolean(def.readable),
    usable: Boolean(def.usable),
    disposable: Boolean(def.disposable),
  };
}

/** The inventory as the panel / scene reads it (plain data, no methods). */
export function getInventoryState() {
  const inv = getInventory();
  return {
    items: inv.items.map(describeItem),
    count: inv.items.length,
    capacity: capacity(inv),
    hasBag: inv.hasBag,
    coins: getCoins(),
    bagPrice: BAG_PRICE_COINS,
    flyerCost: FLYER_CREATE_COST,
    full: isFull(inv),
  };
}

/** Can this item be added right now? (Capacity is the only gate.) */
export function canAddItem(item, inv = getInventory()) {
  if (!item || typeof item.type !== 'string') return false;
  return inv.items.length < capacity(inv);
}

/**
 * Add an item to the pocket/bag. Refused when full — nothing is
 * dropped automatically; the caller shows INVENTORY_FULL_MESSAGE (for
 * puzzle pieces) or INVENTORY_FULL_GENERIC (for everything else).
 * Returns { ok, item? , reason? } — reason is 'inventory-full'.
 */
export function addItem(item, inv = getInventory()) {
  if (!item || typeof item.type !== 'string') return { ok: false, reason: 'bad-item' };
  if (inv.items.length >= capacity(inv)) return { ok: false, reason: 'inventory-full' };
  const stored = {
    id: item.id || makeItemId(item.type),
    type: item.type,
    label: item.label || null,
    blurb: item.blurb || null,
    text: item.text || null,
    title: item.title || null,
    pieceId: typeof item.pieceId === 'number' ? item.pieceId : null,
    // Decoration Shop v1: which decoration this pocket item is
    // (ornament / lights / snowman / tree / santa).
    decorKind: typeof item.decorKind === 'string' ? item.decorKind : null,
    createdAt: Date.now(),
  };
  inv.items = [...inv.items, stored];
  saveInventory(inv);
  return { ok: true, item: describeItem(stored) };
}

/** Remove one item by id. Returns the removed item (described) or null. */
export function removeItem(id, inv = getInventory()) {
  const idx = inv.items.findIndex((it) => it.id === id);
  if (idx < 0) return null;
  const [removed] = inv.items.splice(idx, 1);
  saveInventory(inv);
  return describeItem(removed);
}

export function getItem(id, inv = getInventory()) {
  const found = inv.items.find((it) => it.id === id);
  return found ? describeItem(found) : null;
}

// --- puzzle pieces in the pocket ------------------------------------------
export function addPuzzlePiece(pieceId, inv = getInventory()) {
  return addItem({ type: ITEM_TYPES.PUZZLE_PIECE, pieceId: Number(pieceId) }, inv);
}

export function removePuzzlePiece(pieceId, inv = getInventory()) {
  const idx = inv.items.findIndex(
    (it) => it.type === ITEM_TYPES.PUZZLE_PIECE && Number(it.pieceId) === Number(pieceId),
  );
  if (idx < 0) return null;
  const [removed] = inv.items.splice(idx, 1);
  saveInventory(inv);
  return describeItem(removed);
}

export function carriedPuzzlePieces(inv = getInventory()) {
  return inv.items
    .filter((it) => it.type === ITEM_TYPES.PUZZLE_PIECE)
    .map((it) => Number(it.pieceId));
}

/** A new puzzle round starts: carried pieces belong to the old round. */
export function clearPuzzlePieces(inv = getInventory()) {
  const kept = inv.items.filter((it) => it.type !== ITEM_TYPES.PUZZLE_PIECE);
  if (kept.length === inv.items.length) return 0;
  const dropped = inv.items.length - kept.length;
  inv.items = kept;
  saveInventory(inv);
  return dropped;
}

// --- puzzle v1.3 (`sq-puzzle-v1-3`) ------------------------------------------
// The server's puzzle is in-memory and resets to round 1 on every
// restart, so a carried piece can go stale: the server no longer
// knows it, the board tray (server-driven) shows nothing, and the
// piece can never be placed. These helpers keep the pocket honest.

/** Drop carried pieces the server does NOT know for the current
 * round. Returns how many were dropped. Never drops pieces the
 * server DOES know. Used by the applyState reconcile backstop
 * (PuzzleQuest.js) — the server is canonical, so a piece missing
 * from its `collected` list is stale. */
export function dropStalePuzzlePieces(knownCollectedIds, inv = getInventory()) {
  const known = new Set((knownCollectedIds || []).map((n) => Number(n)));
  const before = inv.items.length;
  inv.items = inv.items.filter(
    (it) => !(it.type === ITEM_TYPES.PUZZLE_PIECE && !known.has(Number(it.pieceId))),
  );
  const dropped = before - inv.items.length;
  if (dropped > 0) saveInventory(inv);
  return dropped;
}

// Puzzle pieces belong to one browser session. A fresh tab has no
// sessionStorage marker, so this is a new session (tab closed =
// logged out, or a second tab) — drop pieces carried over from the
// previous session. A refresh in the SAME tab keeps the marker, so
// legitimately-found pieces survive a reload and only the applyState
// reconcile drops stale ones. Returns how many were dropped
// (0 when the marker was already set). Idempotent: safe to call on
// every app boot, including dev double-mounts.
const PUZZLE_SESSION_KEY = 'sidequest-puzzle-session-v1';
export function clearPuzzlePiecesForNewSession() {
  try {
    if (typeof sessionStorage === 'undefined') return 0;
    if (sessionStorage.getItem(PUZZLE_SESSION_KEY)) return 0;
    sessionStorage.setItem(PUZZLE_SESSION_KEY, '1');
    return clearPuzzlePieces();
  } catch {
    return 0;
  }
}

// --- bag upgrade ------------------------------------------------------------
/**
 * Buy the bag (20 coins, button inside the inventory popup). The bag
 * holds 10 instead of 3 and appears on the avatar — the scene applies
 * it to the avatar right after this returns ok (see ItemsSystem).
 */
export function buyBag(inv = getInventory()) {
  if (inv.hasBag) return { ok: false, reason: 'already-owned' };
  if (getCoins() < BAG_PRICE_COINS) return { ok: false, reason: 'not-enough-coins' };
  if (!spendCoins(BAG_PRICE_COINS)) return { ok: false, reason: 'not-enough-coins' };
  inv.hasBag = true;
  saveInventory(inv);
  return { ok: true, capacity: BAG_CAPACITY };
}

// --- flyers -----------------------------------------------------------------
/**
 * Make a flyer: write a title + text, pay 5 coins, and the flyer goes
 * into your pocket (readable; droppable as ground litter in the room
 * for this session). Posting it so OTHER players can find it needs
 * server sync — v2, not v1.
 */
export function createFlyer(title, text, inv = getInventory()) {
  const cleanTitle = String(title || '').trim().slice(0, 60);
  const cleanText = String(text || '').trim().slice(0, 200);
  if (!cleanTitle || !cleanText) return { ok: false, reason: 'empty-flyer' };
  if (inv.items.length >= capacity(inv)) return { ok: false, reason: 'inventory-full' };
  if (getCoins() < FLYER_CREATE_COST) return { ok: false, reason: 'not-enough-coins' };
  if (!spendCoins(FLYER_CREATE_COST)) return { ok: false, reason: 'not-enough-coins' };
  return addItem({ type: ITEM_TYPES.FLYER, title: cleanTitle, text: cleanText }, getInventory());
}

// --- decorations (Decoration Shop v1, `sq-dec-shop-v1`) -------------------
/**
 * Buy a decoration at the Agora bar: pay its price, and it goes
 * into your pocket (one slot, same as any item). The pocket-full
 * check comes FIRST, so a full pocket never takes your coins.
 * If the add somehow fails after paying (it cannot — capacity was
 * just checked), the coins are refunded. Returns { ok, item?,
 * reason? } — 'bad-kind', 'inventory-full', 'not-enough-coins'.
 */
export function buyDecoration(kind, inv = getInventory()) {
  const def = DECOR_KINDS[String(kind || '').trim()];
  if (!def) return { ok: false, reason: 'bad-kind' };
  if (inv.items.length >= capacity(inv)) return { ok: false, reason: 'inventory-full' };
  if (getCoins() < def.price) return { ok: false, reason: 'not-enough-coins' };
  if (!spendCoins(def.price)) return { ok: false, reason: 'not-enough-coins' };
  const res = addItem({ type: ITEM_TYPES.DECORATION, decorKind: def.kind }, getInventory());
  if (!res.ok) {
    try { earnCoins(def.price, `decor-refund-${def.kind}`); } catch {}
    return { ok: false, reason: res.reason || 'error' };
  }
  return { ok: true, item: res.item, price: def.price };
}

// --- mailbox key (Mailbox v1, `sq-mailbox-v1`) ---------------------------
// The key is auto-granted: every player gets exactly one. The id is
// FIXED ('mailbox-key') so the grant is idempotent even across tabs
// — a second grant sees the same id already in the pocket or at
// home and does nothing, so the key can never duplicate.
//   - In the pocket already → nothing to do.
//   - Stored at home → nothing to do (go get it when you need it).
//   - Pocket full → the grant fails ('inventory-full'); the next
//     refresh retries once there is room — the key is never lost,
//     it just waits.
// Returns { ok, reason? } — reason is 'already-in-pocket',
// 'stored-at-home', 'granted', or 'inventory-full'.
export const MAILBOX_KEY_ITEM_ID = 'mailbox-key';

export function hasMailboxKey(inv = getInventory()) {
  return (inv.items || []).some((it) => it.type === ITEM_TYPES.MAILBOX_KEY);
}

export function ensureMailboxKey(homeItems = []) {
  const inv = getInventory();
  if (hasMailboxKey(inv)) return { ok: true, reason: 'already-in-pocket' };
  if (Array.isArray(homeItems) && homeItems.some((it) => it.type === ITEM_TYPES.MAILBOX_KEY)) {
    return { ok: true, reason: 'stored-at-home' };
  }
  const res = addItem({ id: MAILBOX_KEY_ITEM_ID, type: ITEM_TYPES.MAILBOX_KEY }, inv);
  if (!res.ok) return { ok: false, reason: res.reason || 'error' };
  return { ok: true, reason: 'granted' };
}

// --- one-time seeded finds --------------------------------------------------
export function loadFoundSpots() {
  try {
    const raw = _get(foundKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function markSpotFound(spotId) {
  const found = loadFoundSpots();
  found.add(spotId);
  try { _set(foundKey(), JSON.stringify([...found])); } catch {}
}

export function isSpotFound(spotId) {
  return loadFoundSpots().has(spotId);
}
