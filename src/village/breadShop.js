// breadShop.js — Bread Shop v1 (`sq-bread-shop-v1`).
//
// Bread you can BUY: the Agora coffee bar sells all three, and
// every food-shop room sells its own stock at the Register counter
// (walk up, press E). Each bread is a FOOD item (see items.js), so
// it feeds the ducks and the cafe cat exactly like the bits of food
// you pick up off the ground — 3 feeds per item (Feed the Ducks v2),
// and the gate is by food type, not item id.
//
// This module is PURE (no imports from items.js / CoinWallet, so
// mailState.js and homeStorage.js stay server-importable): the
// bread catalogue, the price, and the ONE stock table — a single
// function keyed by shop type. Adding a bread or a shop type later
// is one edit here.
//
// Stock (user-decided):
//   Agora bar + bakery:  all three (roll, croissant, baguette)
//   supermarket, convenience: roll only
//   deli: roll + baguette
//   cafe, coffee_shop, coffee (and coffee in the room name —
//   starbucks / dunkin / coffee, same match as pickTheme): croissant
//   any other shop type (books, clothes, ...): NO bread at all.
// Buying itself is LOCAL (coins + pocket, items.buyBread) — the
// server only owns mail / home-storage cleaning, which preserves
// breadKind so a bought loaf keeps its identity through the mail
// and the chest. No server handler: a bread goes straight into
// your pocket, invisible to the other players.

export const BREAD_SHOP_MARKER_V1 = 'sq-bread-shop-v1';

// Every bread costs the same: 3 coins (user-decided).
export const BREAD_PRICE_COINS = 3;

export const BREAD_KINDS = {
  roll: {
    kind: 'roll', emoji: '🍞', label: 'Bread roll',
    blurb: 'A soft white roll, still warm from the oven. The ducks will fight over it.',
    price: BREAD_PRICE_COINS,
  },
  croissant: {
    kind: 'croissant', emoji: '🥐', label: 'Croissant',
    blurb: 'Buttery, flaky, and far too good for the ducks. They will love it anyway.',
    price: BREAD_PRICE_COINS,
  },
  baguette: {
    kind: 'baguette', emoji: '🥖', label: 'Baguette',
    blurb: 'A proper French baguette. Crusty outside, soft inside — three good feeds in every loaf.',
    price: BREAD_PRICE_COINS,
  },
};

export const BREAD_KIND_IDS = Object.keys(BREAD_KINDS);

const AGORA_ROOM_ID = 'agora-houston';

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

/** The bread kinds this room sells, by shop type — [] means no
 *  bread here at all (non-food shops). Priority is most specific
 *  shop type first: a bakery named "Coffee & Croissants" sells all
 *  three (bakery wins over the coffee-name match), a supermarket
 *  with coffee in its name sells only the roll.
 *  @param {{roomId?: string, roomName?: string, amenityTag?: string, shopTag?: string}} room */
export function breadStockFor(room = {}) {
  const roomId = norm(room.roomId);
  const name = norm(room.roomName);
  const amenity = norm(room.amenityTag);
  const shop = norm(room.shopTag);
  if (roomId === AGORA_ROOM_ID) return [...BREAD_KIND_IDS];
  if (shop === 'bakery') return [...BREAD_KIND_IDS];
  if (shop === 'supermarket' || shop === 'convenience') return ['roll'];
  if (shop === 'deli') return ['roll', 'baguette'];
  if (
    shop === 'cafe' || shop === 'coffee' || shop === 'coffee_shop'
    || amenity === 'cafe' || amenity === 'coffee_shop'
    || name.includes('coffee') || name.includes('starbucks') || name.includes('dunkin')
  ) {
    return ['croissant'];
  }
  return [];
}
