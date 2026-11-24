// ItemsSystem.js — the in-room side of Items + Inventory v1
// (`sq-items-inventory-v1`).
//
// Owned by VillageScene, same shape as PuzzleQuest / CafeCat:
// constructed in create(), refreshed on floor switches, destroyed in
// shutdown(). Agora only for the hidden furniture search; ground
// litter also spawns in any room with a pond (bits of food by the
// water) so food is findable where the ducks are.
//
// Finding reuses the puzzle v1.2 pattern — scene-level
// input.on('pointerdown') + distance checks in VillageScene (the
// per-object pointerdown pattern proved unreliable on decor in this
// codebase). VillageScene calls searchTapAt() / pickupTapAt() from
// its pointerdown handler, AFTER the puzzle search tap, so one click
// on the trash can can count toward both a hidden item and a puzzle
// piece. Hidden items take ITEM_SEARCH_CLICKS (3) clicks on their
// furniture, within ITEM_SEARCH_RANGE (140px), exactly like puzzle
// pieces. Ground litter is VISIBLE (a small emoji on the floor) and
// takes 1 click, but you still have to walk up to it
// (LITTER_PICKUP_RANGE, 90px).
//
// WHERE EACH ITEM IS FOUND (v1):
//   trash       — 3-click search on the Agora trash can (repeatable:
//                 it is a trash can), or 1-click ground litter by the
//                 entrance / rug. Throw it away at the trash can
//                 (inventory "Throw away", only when standing by it).
//                 Hunger v1.1 (`sq-hunger-v1.1`): 1-in-3 the can yields
//                 bits of food instead of trash — trash food, so eating
//                 it makes you queasy (Hunger v1).
//   note        — 3-click search under Table 4 (the puzzle's decoy
//                 table) — one-time per profile. Readable.
//   diary       — 3-click search behind the north-east plant
//                 (1470,260) — one-time per profile. Readable.
//   flyer       — 3-click search on the south couch (the puzzle's
//                 decoy couch) — one-time seeded flyer per profile;
//                 or MAKE one in the inventory (5 coins, title+text).
//   food        — 1-click ground litter: a croissant by the Agora
//                 coffee bar, and bits of food by any pond — or 1-in-3
//                 from the trash can (Hunger v1.1). Use it
//                 near ducks (feeds them) or near the cafe cat.
//   cigarettes  — 3-click search behind the portrait on the north
//                 wall — one-time per profile.
//   puzzle piece— NOT found here: PuzzleQuest owns piece finding, but
//                 pieces live in this inventory (see items.js).
//
// Everything here is client-side (localStorage). No server change:
// dropped items are ground litter for THIS session on THIS client
// only, and a flyer you make lives in your pocket — posting one so
// other players can find it needs server sync (v1 defers that).

import { DEPTH } from './depth.js';
import {
  ITEMS_MARKER_V1,
  ITEM_TYPES,
  ITEM_SEARCH_CLICKS,
  ITEM_SEARCH_RANGE,
  LITTER_PICKUP_RANGE,
  LITTER_CLICK_RANGE,
  INVENTORY_FULL_MESSAGE,
  SEEDED_FLYERS,
  SEEDED_NOTES,
  DIARY_ENTRIES,
  addItem,
  removeItem,
  getItem,
  spendFoodCharge,
  getInventoryState,
  buyBag,
  createFlyer,
  markSpotFound,
  isSpotFound,
} from './items.js';

const AGORA_ROOM_ID = 'agora-houston';

// Hidden-search spots in Agora. `kind` is the furniture the clicks
// land on; `find` is what the search yields. One-time spots are
// gated by the per-profile found list; the trash can is repeatable.
function defaultSpots() {
  return [
    { id: 'trash-can', kind: 'trash', label: 'the trash can', repeatable: true },
    { id: 'note-table4', kind: 'note', label: 'under Table 4', repeatable: false },
    { id: 'diary-plant', kind: 'diary', label: 'behind the plant', repeatable: false },
    { id: 'flyer-couch', kind: 'flyer', label: 'on the south couch', repeatable: false },
    { id: 'cigs-portrait', kind: 'cigarettes', label: 'behind the portrait', repeatable: false },
  ];
}

// Visible ground litter that spawns fresh every time you enter the
// room (Agora). `emoji` is what you see on the floor.
function defaultAgoraLitter() {
  return [
    { id: 'litter-trash-entrance', type: ITEM_TYPES.TRASH, emoji: '🗑️', label: 'a crumpled wrapper by the entrance', x: 760, y: 690 },
    { id: 'litter-trash-rug', type: ITEM_TYPES.TRASH, emoji: '🗑️', label: 'a bit of trash by the rug', x: 480, y: 560 },
    { id: 'litter-food-bar', type: ITEM_TYPES.FOOD, emoji: '🥐', label: 'a dropped croissant by the coffee bar', x: 500, y: 205 },
  ];
}

// Hunger v1.1 (`sq-hunger-v1.1`): the trash can sometimes yields bits
// of food instead of trash — 1-in-3 digs (builder default; the user
// only said "sometimes"). The food carries trashFood: true, so eating
// it triggers the queasy gag (Hunger v1). Pure for testability: the
// live path passes Math.random().
export const TRASH_CAN_FOOD_CHANCE = 1 / 3;
export function rollTrashCanYield(roll) {
  if (roll < TRASH_CAN_FOOD_CHANCE) return { type: ITEM_TYPES.FOOD, trashFood: true };
  return { type: ITEM_TYPES.TRASH };
}

export class ItemsSystem {
  constructor(scene) {
    this.scene = scene;
    // sq-items-inventory-v1 — marker for the v1 landing check.
    this.marker = ITEMS_MARKER_V1;
    this._spots = []; // { id, kind, label, repeatable, hit: {kind:'circle'|'rect',...}, pos }
    this._searchTaps = new Map(); // spotId -> taps so far this room visit
    this._litter = []; // { id, type, item?, emoji, label, x, y, textObj }
    this._lastNoticeAt = 0;
  }

  get enabled() {
    // Hidden furniture search is Agora-only in v1. Ground litter
    // spawns in Agora and by any pond, wherever you are.
    return this.scene?.roomId === AGORA_ROOM_ID;
  }

  /** Plain-data state for the inventory panel (polls this ~2x/sec). */
  getState() {
    const state = getInventoryState();
    // Decoration Shop v1.1 (`sq-dec-shop-v1-1`): the latest
    // place/pickup news from DecorSystem (timeout, or a late
    // confirm). The pocket panel polls getState() every 500ms and
    // shows a fresh decorNotice in its own notice line — the scene
    // toast sits UNDER the panel (zIndex 1002 vs 1100), so without
    // this the player would never see a timeout while the pocket
    // is open.
    let decorNotice = { text: '', seq: 0 };
    try { decorNotice = this.scene?.decorSystem?.getPlaceNotice?.() || decorNotice; } catch {}
    // Santa Hat v1 (`sq-santa-hat-v1`): same notice channel as
    // decorations — the latest hat news (timeout, or a late confirm)
    // for the pocket panel's own notice line.
    let hatNotice = { text: '', seq: 0 };
    try { hatNotice = this.scene?.santaHatSystem?.getHatNotice?.() || hatNotice; } catch {}
    // Mailbox v1 (`sq-mailbox-v1`): the mailbox panel + the pocket
    // button dot poll these — the mailbox code, the room the
    // mailbox lives in, whether the key is in the pocket, and the
    // send failure reason (the pocket panel shows it).
    let mail = null;
    try { mail = this.scene?.mailSystem?.getState?.() || null; } catch {}
    return {
      ...state,
      decorNotice: decorNotice.text || '',
      decorNoticeSeq: decorNotice.seq || 0,
      hatNotice: hatNotice.text || '',
      hatNoticeSeq: hatNotice.seq || 0,
      mailboxCode: mail?.mailboxCode || '',
      mailPackages: mail?.packages || [],
      mailUnread: mail?.unread || 0,
      // Mailbox v1.2 (`sq-mailbox-v1.2`): the full list of the
      // player's mailbox rooms (one per place) — the pocket line
      // names them all; mailboxRoomId / mailboxRoomName stay the
      // NEAREST one (the Go button's target).
      mailboxRooms: mail?.mailboxRooms || [],
      mailboxRoomId: mail?.mailboxRoomId || '',
      mailboxRoomName: mail?.mailboxRoomName || '',
      isMailboxRoom: Boolean(mail?.isMailboxRoom),
      hasMailboxKey: Boolean(mail?.hasKey),
      mailNotice: mail?.mailNotice || '',
      mailNoticeSeq: mail?.mailNoticeSeq || 0,
      roomId: this.scene?.roomId || '',
      // Drop on the home floor v1: the panel shows a different
      // success line when Drop puts a persisted item on the home
      // floor instead of session litter.
      atHome: Boolean(this.scene?.homeStorageSystem?.enabled),
      canDispose: this.nearTrashCan(),
      // Santa Hat v1: standing by the cafe cat (awake or asleep) —
      // the pocket's "Put on the cat" button enables then.
      canHatCat: Boolean(
        this.scene?.cafeCat?.nearestCat?.(
          this.scene?.player?.gx ?? 0, this.scene?.player?.gy ?? 0,
        ) || this.scene?.cafeCat?.nearestSleepingCat?.(
          this.scene?.player?.gx ?? 0, this.scene?.player?.gy ?? 0,
        ),
      ),
      canFeedDucks: Boolean(this.scene?.duckPond?.nearestFeedablePond?.(
        this.scene?.player?.gx ?? 0, this.scene?.player?.gy ?? 0,
      )),
      canFeedCat: Boolean(this.scene?.cafeCat?.nearestCat?.(
        this.scene?.player?.gx ?? 0, this.scene?.player?.gy ?? 0,
      )),
    };
  }

  /** (Re)build spots + litter for this room. */
  refresh() {
    this._clearEntities();
    this._searchTaps.clear();
    this._resolveSpots();
    this._spawnLitter();
  }

  // ---- hidden search (3 clicks on furniture, like puzzle v1.2) ----------

  /** One search tap: the player clicked at world (wx, wy). Same
   * contract as PuzzleQuest.searchTapAt: silent unless it finds
   * something (no counter, no hint about which furniture hides an
   * item). After ITEM_SEARCH_CLICKS taps on the same spot, the item
   * comes out — into the pocket, if there is room. A full pocket
   * REFUSES the pickup (the taps stay counted, so one more click
   * after making room picks it up) and the scene shows the
   * full-pocket message. Returns { ok, tapped?, found?, item?, reason? }. */
  searchTapAt(wx, wy) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const spot = this._spotHitAt(wx, wy);
    if (!spot) return { ok: false, reason: 'no-spot' };
    if (!spot.repeatable && isSpotFound(spot.id)) return { ok: false, reason: 'already-found' };
    if (this._distanceToSpot(player, spot) > ITEM_SEARCH_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    const taps = (this._searchTaps.get(spot.id) || 0) + 1;
    if (taps < ITEM_SEARCH_CLICKS) {
      this._searchTaps.set(spot.id, taps);
      return { ok: true, tapped: true, remaining: ITEM_SEARCH_CLICKS - taps };
    }
    // Enough taps: the item comes out — if the pocket has room.
    const item = this._itemForSpot(spot);
    const res = addItem(item);
    if (!res.ok && res.reason === 'inventory-full') {
      // Keep the taps counted: one more click after making room
      // picks it up, instead of making the player start over.
      this._searchTaps.set(spot.id, ITEM_SEARCH_CLICKS);
      return { ok: false, reason: 'inventory-full', item: null };
    }
    if (!res.ok) return { ok: false, reason: res.reason || 'error' };
    this._searchTaps.delete(spot.id);
    if (!spot.repeatable) markSpotFound(spot.id);
    try {
      this.scene?.onSystemNotice?.(`🎒 You found ${res.item.label}! (${getInventoryState().count}/${getInventoryState().capacity} in your pocket)`);
    } catch {}
    return { ok: true, found: true, item: res.item };
  }

  _itemForSpot(spot) {
    switch (spot.kind) {
      case ITEM_TYPES.TRASH:
        // Hunger v1.1 (`sq-hunger-v1.1`): 1-in-3 the trash can yields
        // bits of food instead of trash.
        return rollTrashCanYield(Math.random());
      case ITEM_TYPES.NOTE: {
        const note = SEEDED_NOTES[0];
        return { type: ITEM_TYPES.NOTE, title: note.title, text: note.text };
      }
      case ITEM_TYPES.DIARY:
        return {
          type: ITEM_TYPES.DIARY,
          title: "Someone's diary",
          text: DIARY_ENTRIES.map((e) => `${e.title}\n${e.text}`).join('\n\n— — —\n\n'),
        };
      case ITEM_TYPES.FLYER: {
        const flyer = SEEDED_FLYERS[0];
        return { type: ITEM_TYPES.FLYER, title: flyer.title, text: flyer.text };
      }
      case ITEM_TYPES.CIGARETTES:
        return { type: ITEM_TYPES.CIGARETTES };
      default:
        return { type: ITEM_TYPES.TRASH };
    }
  }

  _spotHitAt(wx, wy) {
    for (const spot of this._spots) {
      const hit = spot.hit;
      if (!hit) continue;
      if (hit.kind === 'circle') {
        if (Math.hypot(wx - hit.x, wy - hit.y) <= hit.r) return spot;
      } else if (hit.kind === 'rect') {
        if (wx >= hit.x && wx <= hit.x + hit.w && wy >= hit.y && wy <= hit.y + hit.h) return spot;
      }
    }
    return null;
  }

  _distanceToSpot(player, spot) {
    const hit = spot.hit;
    if (!hit) return Infinity;
    if (hit.kind === 'rect') {
      const cx = Math.max(hit.x, Math.min(player.gx, hit.x + hit.w));
      const cy = Math.max(hit.y, Math.min(player.gy, hit.y + hit.h));
      return Math.hypot(player.gx - cx, player.gy - cy);
    }
    return Math.hypot(player.gx - hit.x, player.gy - hit.y);
  }

  /** Resolve each hidden spot to live furniture zones, same approach
   * as PuzzleQuest._resolveSpotPositions: real zones first, boundary
   * fractions as fallback. Spots deliberately use the puzzle's DECOY
   * furniture (Table 4, south couch) plus furniture the puzzle does
   * not use (NE plant, portrait) — the trash can is shared with
   * puzzle piece 5, so one click there counts toward both. */
  _resolveSpots() {
    this._spots = [];
    if (!this.enabled) return;
    const layout = this.scene?.roomLayout;
    let bounds = null;
    try { bounds = layout?.getBoundaryBounds?.(); } catch {}
    if (!bounds || !Number.isFinite(bounds.w) || bounds.w <= 100) {
      bounds = { x: 200, y: 200, w: 1200, h: 500 };
    }
    const frac = (fx, fy) => ({ x: bounds.x + bounds.w * fx, y: bounds.y + bounds.h * fy });
    const zones = Array.isArray(layout?.currentZones) && layout.currentZones.length
      ? layout.currentZones
      : (Array.isArray(layout?.interactZones) ? layout.interactZones : []);
    const zoneCenter = (z) => ({ x: z.x + (z.w || 0) / 2, y: z.y + (z.h || 0) / 2 });
    const zoneRect = (z, pad = 12) => ({
      kind: 'rect',
      x: (z.x ?? 0) - pad, y: (z.y ?? 0) - pad,
      w: (z.w || 0) + pad * 2, h: (z.h || 0) + pad * 2,
    });
    const clamp = (p) => (layout?.clampPointToRoom ? layout.clampPointToRoom(p.x, p.y, 24) : p);
    const spots = defaultSpots();
    const byId = (id) => spots.find((s) => s.id === id);

    const trash = zones.find((z) => z.type === 'trash_can' || /trash/i.test(z.label || ''));
    const trashSpot = byId('trash-can');
    if (trash) {
      const c = clamp(zoneCenter(trash));
      trashSpot.pos = c;
      trashSpot.hit = { kind: 'circle', x: c.x, y: c.y, r: 55 };
    } else {
      const c = clamp(frac(0.77, 0.15));
      trashSpot.pos = c;
      trashSpot.hit = { kind: 'circle', x: c.x, y: c.y, r: 55 };
    }

    const tables = zones.filter((z) => /table/i.test(z.label || ''));
    // Table 4 is the puzzle's decoy table — the note hides under it.
    const table4 = tables.find((z) => /4/.test(z.label || '')) || tables[3];
    const noteSpot = byId('note-table4');
    const noteC = clamp(table4 ? zoneCenter(table4) : frac(0.2, 0.7));
    noteSpot.pos = noteC;
    noteSpot.hit = { kind: 'circle', x: noteC.x, y: noteC.y, r: 60 };

    const plants = zones.filter((z) => z.type === 'plant');
    // North-east plant (puzzle piece 6 is behind the south-west one).
    plants.sort((a, b) => (b.x - b.y) - (a.x - a.y));
    const diarySpot = byId('diary-plant');
    const diaryC = clamp(plants[0] ? zoneCenter(plants[0]) : frac(0.9, 0.3));
    diarySpot.pos = diaryC;
    diarySpot.hit = { kind: 'circle', x: diaryC.x, y: diaryC.y, r: 55 };

    const couches = zones.filter((z) => z.type === 'couch');
    // South couch (puzzle piece 4 is in the north one).
    couches.sort((a, b) => (b.y || 0) - (a.y || 0));
    const flyerSpot = byId('flyer-couch');
    const flyerC = clamp(couches[0] ? zoneCenter(couches[0]) : frac(0.35, 0.65));
    flyerSpot.pos = flyerC;
    flyerSpot.hit = couches[0] ? zoneRect(couches[0]) : { kind: 'rect', x: flyerC.x - 100, y: flyerC.y - 30, w: 200, h: 60 };

    const portrait = zones.find((z) => z.type === 'portrait' || /portrait/i.test(z.label || ''));
    const cigsSpot = byId('cigs-portrait');
    const cigsC = clamp(portrait ? zoneCenter(portrait) : frac(0.82, 0.12));
    cigsSpot.pos = cigsC;
    cigsSpot.hit = portrait ? zoneRect(portrait) : { kind: 'circle', x: cigsC.x, y: cigsC.y, r: 60 };

    this._spots = spots;
  }

  // ---- visible ground litter (1 click, walk right up to it) -------------

  _spawnLitter() {
    const scene = this.scene;
    const spawnOne = (entry) => {
      let textObj = null;
      try {
        textObj = scene.add.text(entry.x, entry.y, entry.emoji, { fontSize: '22px' });
        textObj.setOrigin(0.5, 0.5);
        textObj.setDepth(DEPTH.ACTOR_MIN + Math.round(entry.y));
      } catch {}
      this._litter.push({ ...entry, textObj });
    };
    if (this.enabled) {
      for (const entry of defaultAgoraLitter()) spawnOne(entry);
    }
    // Bits of food by any pond, in any room — that is where the ducks
    // are, so that is where dropped food ends up.
    try {
      const zones = this.scene?.roomLayout?.currentZones || [];
      const ponds = zones.filter((z) => z && z.type === 'pond');
      for (const pond of ponds) {
        const x = pond.x + (pond.w || 0) * 0.15;
        const y = pond.y + (pond.h || 0) + 26;
        const p = this.scene?.roomLayout?.clampPointToRoom
          ? this.scene.roomLayout.clampPointToRoom(x, y, 24)
          : { x, y };
        spawnOne({
          id: `litter-food-pond-${Math.round(p.x)}-${Math.round(p.y)}`,
          type: ITEM_TYPES.FOOD, emoji: '🍞',
          label: 'bits of food by the pond', x: p.x, y: p.y,
        });
      }
    } catch {}
  }

  /** One pickup tap: the player clicked at world (wx, wy). If the
   * click lands on visible litter AND the player is standing close
   * enough, pick it up — into the pocket, if there is room. A full
   * pocket refuses it (the litter stays on the ground). Returns
   * { ok, picked?, item?, reason? }. */
  pickupTapAt(wx, wy) {
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const entry = this._litter.find((l) => Math.hypot(wx - l.x, wy - l.y) <= LITTER_CLICK_RANGE);
    if (!entry) return { ok: false, reason: 'no-litter' };
    if (Math.hypot(player.gx - entry.x, player.gy - entry.y) > LITTER_PICKUP_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    const res = addItem((() => {
      const pickupItem = entry.item || { type: entry.type };
      // Hunger System v1 (`sq-hunger-v1`): food picked up off the
      // ground is trash food — a dropped croissant by the bar, bits
      // by the pond, or anything dropped on the floor. Bought breads
      // carry a breadKind and are never trash food, even after a
      // drop (dropItem preserves the kind). The flag is what makes
      // eating it queasy.
      if (pickupItem.type === ITEM_TYPES.FOOD && !pickupItem.breadKind) {
        pickupItem.trashFood = true;
      }
      return pickupItem;
    })());
    if (!res.ok && res.reason === 'inventory-full') {
      return { ok: false, reason: 'inventory-full' };
    }
    if (!res.ok) return { ok: false, reason: res.reason || 'error' };
    this._removeLitter(entry.id);
    try {
      this.scene?.onSystemNotice?.(`🎒 Picked up ${res.item.label}! (${getInventoryState().count}/${getInventoryState().capacity} in your pocket)`);
    } catch {}
    return { ok: true, picked: true, item: res.item };
  }

  _removeLitter(id) {
    const idx = this._litter.findIndex((l) => l.id === id);
    if (idx < 0) return;
    try { this._litter[idx].textObj?.destroy(); } catch {}
    this._litter.splice(idx, 1);
  }

  // ---- inventory actions (called by the DOM panel) -----------------------

  /** Use an item: food feeds the ducks at a pond or the cafe cat.
   * Feed the Ducks v2 (`sq-feed-ducks-v2`): one charge per feed
   * (3 per item), not the whole item — _tryFeedDucks spends the duck
   * charge itself. Anywhere else, it explains itself. */
  useItem(id) {
    const item = getItem(id);
    if (!item) return { ok: false, reason: 'not-found' };
    if (item.type === ITEM_TYPES.PUZZLE_PIECE) {
      return { ok: false, reason: 'puzzle-piece-use-board' };
    }
    if (item.type !== ITEM_TYPES.FOOD) return { ok: false, reason: 'not-usable' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    // Ducks first: standing by a pond, toss the food to them.
    const pond = this.scene?.duckPond?.nearestFeedablePond?.(player.gx, player.gy);
    if (pond && (this.scene._feedCooldownMs || 0) <= 0) {
      // _tryFeedDucks spends one charge from THIS item (the one the
      // player tapped) and returns true only when a feed happened.
      if (this.scene._tryFeedDucks?.(id)) {
        try { this.scene?.onSystemNotice?.('🦆 You toss the food to the ducks!'); } catch {}
        return { ok: true, used: 'ducks' };
      }
    }
    // Then the cafe cat: a treat counts as a pet (same +1 coin and
    // quest step as petting — CafeCat owns the cooldown/asleep rules).
    const cat = this.scene?.cafeCat?.nearestCat?.(player.gx, player.gy);
    if (cat) {
      // Hungry Cat v1 (`sq-hungry-cat-v1`): a treat is FOOD, not a
      // hand pet — petCat gets fed: true so the server can complete
      // the hungry-cat quest for the first feeder in this window.
      // (Shared file with Feed the Ducks v2 — extract that kit
      // first, then this one on top.)
      try { this.scene.cafeCat.petCat(true, { fed: true }); } catch {}
      // One charge from the tapped item (not the whole item). The
      // pet-cooldown edge is pre-existing: petCat can no-op inside
      // its 5s cooldown, and the charge is spent anyway — it now
      // costs 1 feed instead of a whole item.
      spendFoodCharge(id);
      try { this.scene?.onSystemNotice?.('🐱 The cat gobbles up the treat!'); } catch {}
      return { ok: true, used: 'cat' };
    }
    if (this.scene?.cafeCat?.nearestSleepingCat?.(player.gx, player.gy)) {
      return { ok: false, reason: 'cat-asleep' };
    }
    return { ok: false, reason: 'nothing-to-feed' };
  }

  /** Eat a bite of food (Hunger System v1, `sq-hunger-v1`): one
   *  charge = one bite; 3 bites = full for 8 hours. This is its
   *  OWN path — it never routes through useItem's duck/cat logic
   *  above, and the charge is spent ONLY when the bite lands: the
   *  already-full check happens BEFORE spending, so a refused bite
   *  costs nothing. (The cat-cooldown edge — spend first, no-op
   *  after — is not repeated here: takeBite cannot refuse once
   *  the check above has passed, nothing else runs between the
   *  two.) Returns { ok, used?, full?, bites?, trashFood?,
   *  notice?, reason? } — `notice` is the exact line the pocket
   *  panel shows for this bite (the scene toast sits under the
   *  open pocket, so the bite result goes through the panel's
   *  notice line, not onSystemNotice). */
  eatItem(id) {
    const item = getItem(id);
    if (!item) return { ok: false, reason: 'not-found' };
    if (item.type !== ITEM_TYPES.FOOD) return { ok: false, reason: 'not-food' };
    const hunger = this.scene?.hungerSystem;
    if (hunger && !hunger.isHungry()) {
      return { ok: false, reason: 'already-full' };
    }
    const spent = spendFoodCharge(id);
    if (!spent.ok) return { ok: false, reason: 'no-food' };
    const wasTrashFood = Boolean(item.trashFood);
    // The bite landed (the charge is spent) — apply it to the
    // hunger state.
    const res = hunger ? hunger.eatBite(wasTrashFood) : null;
    return {
      ok: true,
      used: 'eat',
      full: res ? res.full : false,
      bites: res ? res.bites : null,
      trashFood: wasTrashFood,
      notice: res ? res.notice : 'Nom!',
    };
  }

  /** Drop an item on the ground where you stand (visible litter in
   * this room, this session). Puzzle pieces cannot be dropped — they
   * belong on the puzzle board. The Santa hat cannot be dropped
   * either (Santa Hat v1): it is a shared room item with server
   * state, and dropping it as session litter would strand it — the
   * server would say "carried" while the hat sat somewhere nobody
   * can see once the litter despawns. */
  /** Send a pocket item to the player with this mailbox code
   *  (Mailbox v1, `sq-mailbox-v1`): delegated to MailSystem; the
   *  item leaves the pocket only on the server's confirm. */
  sendMail(itemId, code) {
    return this.scene?.mailSystem?.sendMail?.(itemId, code)
      ?? { ok: false, reason: 'not-available' };
  }

  /** @deprecated No longer used: MailSystem.onSendResult removes
   *  the item only when the server confirms the send (Mailbox v1,
   *  `sq-mailbox-v1`) — removing it eagerly would lose the gift
   *  when the send is refused. Kept for reference so nobody
   *  re-invents it. */
  confirmSentMail(itemId) {
    removeItem(itemId);
  }

  dropItem(id) {
    const item = getItem(id);
    if (!item) return { ok: false, reason: 'not-found' };
    // Mailbox v1 (`sq-mailbox-v1`): the key can never be dropped —
    // dropping it would lock you out of your own mail. The reason
    // text is shown by the pocket panel's own notice line.
    if (item.type === ITEM_TYPES.MAILBOX_KEY) {
      return { ok: false, reason: 'mailbox-key-no-drop', message: 'You can’t drop your mailbox key — you’d lock yourself out of your own mail.' };
    }
    if (item.type === ITEM_TYPES.PUZZLE_PIECE) {
      return { ok: false, reason: 'puzzle-piece-no-drop' };
    }
    if (item.type === ITEM_TYPES.SANTA_HAT) {
      return { ok: false, reason: 'santa-hat-no-drop' };
    }
    const removed = removeItem(id);
    if (!removed) return { ok: false, reason: 'not-found' };
    const player = this.scene?.player;
    const x = player?.gx ?? 800;
    const y = player?.gy ?? 450;
    const emojiMap = {
      [ITEM_TYPES.TRASH]: '🗑️', [ITEM_TYPES.FLYER]: '📄', [ITEM_TYPES.NOTE]: '📝',
      [ITEM_TYPES.DIARY]: '📖', [ITEM_TYPES.FOOD]: '🥐', [ITEM_TYPES.CIGARETTES]: '🚬',
    };
    let textObj = null;
    try {
      textObj = this.scene.add.text(x, y, emojiMap[removed.type] || '📦', { fontSize: '22px' });
      textObj.setOrigin(0.5, 0.5);
      textObj.setDepth(DEPTH.ACTOR_MIN + Math.round(y));
    } catch {}
    this._litter.push({
      id: `dropped-${removed.id}`,
      type: removed.type,
      // Hunger System v1 (`sq-hunger-v1`): a dropped item keeps
      // what it was — a bought croissant keeps its breadKind (so
      // picking it back up does not turn it into trash food) and a
      // trash-food item keeps its trashFood flag, with its
      // remaining charges intact either way.
      item: { type: removed.type, title: removed.title, text: removed.text, label: removed.label, blurb: removed.blurb, breadKind: removed.breadKind, trashFood: removed.trashFood, usesLeft: removed.usesLeft },
      emoji: emojiMap[removed.type] || '📦',
      label: `dropped ${removed.label}`,
      x, y, textObj,
    });
    return { ok: true, dropped: removed };
  }

  /** Throw trash away — only while standing by the Agora trash can.
   * Trash is the only disposable item in v1. */
  disposeTrash(id) {
    const item = getItem(id);
    if (!item) return { ok: false, reason: 'not-found' };
    if (item.type !== ITEM_TYPES.TRASH) return { ok: false, reason: 'not-trash' };
    if (!this.nearTrashCan()) return { ok: false, reason: 'not-near-trash-can' };
    removeItem(id);
    try { this.scene?.onSystemNotice?.('🗑️ Tossed! The cafe stays tidy.'); } catch {}
    return { ok: true };
  }

  /** Player within throwing distance of the Agora trash can? */
  nearTrashCan() {
    if (!this.enabled) return false;
    const player = this.scene?.player;
    if (!player) return false;
    const spot = this._spots.find((s) => s.id === 'trash-can');
    if (!spot) return false;
    return this._distanceToSpot(player, spot) <= ITEM_SEARCH_RANGE;
  }

  /** Buy the bag (20 coins) and put it on the avatar right away. */
  buyBag() {
    const res = buyBag();
    if (!res.ok) return res;
    this._applyBagToAvatar();
    try { this.scene?.onSystemNotice?.('🎒 You got a bag! Your pocket now holds 10 items — and it shows on your avatar.'); } catch {}
    return res;
  }

  /** Apply the owned bag to the local avatar (drawn satchel). Remote
   * players get it from the join payload (see VillageScene) once the
   * server relays `hasBag` — v1 note in the kit report. */
  _applyBagToAvatar() {
    try {
      const avatar = this.scene?.player?.avatar;
      if (avatar && typeof avatar.setHasBag === 'function') avatar.setHasBag(true);
    } catch {}
  }

  /** Pin a flyer from the pocket to this room's notice board
   * (Notice Board everywhere v1). The flyer leaves the pocket only when the
   * server confirms the pin — see NoticeBoardSystem.applyState ->
   * confirmPinnedFlyer. If the pin never lands (offline,
   * rate-limited), the flyer simply stays in the pocket: pinning
   * never loses a flyer. */
  pinFlyerToBoard(id) {
    const item = getItem(id);
    if (!item) return { ok: false, reason: 'not-found' };
    if (item.type !== ITEM_TYPES.FLYER) return { ok: false, reason: 'not-flyer' };
    return this.scene?.noticeBoardSystem?.pinFlyer(item.title, item.text, item.id)
      || { ok: false, reason: 'not-available' };
  }

  /** The server confirmed a pin: the flyer leaves the pocket (the
   * slot frees up). Called by NoticeBoardSystem on the board_state
   * broadcast that shows the flyer. */
  confirmPinnedFlyer(itemId) {
    const removed = removeItem(itemId);
    return { ok: Boolean(removed), item: removed };
  }

  /** A flyer taken down from the board comes back to the pocket —
   * if there is room. Returns { ok, reason? } — 'inventory-full'
   * means the flyer was discarded instead (the board already let
   * it go). Called by NoticeBoardSystem on the broadcast that
   * confirms the owner's take-down. */
  returnFlyerToPocket(flyer) {
    if (!flyer || !flyer.title || !flyer.text) return { ok: false, reason: 'not-found' };
    const res = addItem({ type: ITEM_TYPES.FLYER, title: flyer.title, text: flyer.text });
    if (!res.ok) return { ok: false, reason: res.reason || 'error' };
    return { ok: true, item: res.item };
  }

  /** The server confirmed a place: the decoration leaves the pocket
   * (the slot frees up). Called by DecorSystem on the decor_state
   * broadcast that shows the decoration. */
  confirmPlacedDecoration(itemId) {
    const removed = removeItem(itemId);
    return { ok: Boolean(removed), item: removed };
  }

  /** The server confirmed the hat is on the cat: the hat leaves
   * the pocket (the slot frees up). Called by SantaHatSystem on
   * the hat_state broadcast that shows it on the cat. */
  confirmPlacedHat(itemId) {
    const removed = removeItem(itemId);
    return { ok: Boolean(removed), item: removed };
  }

  /** The server confirmed a ground pickup: the hat comes back to
   * the pocket — if there is room. Returns { ok, reason? } —
   * 'inventory-full' means the pickup was given back instead (the
   * hat goes back on the ground). Called by SantaHatSystem on the
   * broadcast that confirms the pickup. */
  returnHatToPocket() {
    const res = addItem({ type: ITEM_TYPES.SANTA_HAT });
    if (!res.ok) return { ok: false, reason: res.reason || 'error' };
    return { ok: true, item: res.item };
  }

  /** A decoration taken back down comes back to the pocket — if
   * there is room. Returns { ok, reason? } — 'inventory-full'
   * means the decoration was discarded instead (the room already
   * let it go). Called by DecorSystem on the broadcast that
   * confirms the owner's take-down. */
  returnDecorationToPocket(decor) {
    if (!decor || !decor.kind) return { ok: false, reason: 'not-found' };
    const res = addItem({ type: ITEM_TYPES.DECORATION, decorKind: decor.kind });
    if (!res.ok) return { ok: false, reason: res.reason || 'error' };
    return { ok: true, item: res.item };
  }

  /** Make a flyer (5 coins, title + text) — see items.createFlyer. */
  makeFlyer(title, text) {
    return createFlyer(title, text);
  }

  update() {
    // Nothing per-frame: finds arrive via pointerdown, litter is
    // static, and the panel polls getState().
  }

  _clearEntities() {
    for (const entry of this._litter) {
      try { entry.textObj?.destroy(); } catch {}
    }
    this._litter = [];
  }

  destroy() {
    this._clearEntities();
    this._spots = [];
    this._searchTaps.clear();
    this.scene = null;
  }
}
