// HomeStorageSystem.js — the in-room side of "Your Place"
// (`sq-your-place-v1`).
//
// Owned by VillageScene, same shape as NoticeBoardSystem /
// ItemsSystem: constructed in create(), refreshed on floor switches,
// destroyed in shutdown(). Home-room only.
//
// THE CHEST: a storage chest in your own home room (layouts/home.js).
// Walk up and press E, or click the chest itself, to open it
// (HomeStoragePanel.jsx): what is stored at home, and what is in
// your pocket — Store (pocket → home), Take (home → pocket, only if
// the pocket has room), and Unload All (the whole pocket/bag into
// storage at once, freeing up space for the day's quest).
//
// STORAGE IS SERVER STATE (server/socket.js, in-memory per player
// like badges): the client keeps its own localStorage record
// (homeStorage.js) and re-syncs it on connect (home_sync), so a
// Railway restart does not wipe stored items. The server is
// authoritative — a home_state broadcast replaces the local record.
// Merges are add-only unions by item id; removals only happen via
// explicit store / take / unload-all events, so a stale reconnect
// can never resurrect an item you already took back out.
//
// Puzzle pieces are NOT storable (they belong on the puzzle board —
// see homeStorage.js). Store / Unload All leave them in the pocket.

import { DEPTH } from './depth.js';
import {
  HOME_STORAGE_MARKER_V1,
  HOME_CHEST_OPEN_RANGE,
  isHomeRoom,
  homeOwnerOf,
  ownerKeyFromProfile,
  getHomeItems,
  setHomeItems,
  normalizeHomeItems,
  storeIntoHome,
  takeFromHome,
  unloadPocketIntoHome,
} from './homeStorage.js';
import {
  ITEM_DEFS,
  ITEM_TYPES,
  getInventory,
  getInventoryState,
  getItem,
  addItem,
  removeItem,
  canAddItem,
} from './items.js';

function describeStored(item) {
  const def = ITEM_DEFS[item?.type] || {};
  return {
    id: item.id,
    type: item.type,
    pieceId: typeof item.pieceId === 'number' ? item.pieceId : null,
    emoji: def.emoji || '📦',
    label: item.label || def.label || 'Item',
    blurb: item.blurb || def.blurb || '',
    text: item.text || null,
    title: item.title || null,
    readable: Boolean(def.readable),
    usable: Boolean(def.usable),
    disposable: Boolean(def.disposable),
  };
}

export class HomeStorageSystem {
  constructor(scene) {
    this.scene = scene;
    // sq-your-place-v1 — marker for the v1 landing check.
    this.marker = HOME_STORAGE_MARKER_V1;
    this._chest = null; // { x, y, w, h } of the chest, from the layout
  }

  // Only in your OWN home room — the server refuses anyone else at
  // the door (join_denied), and this check keeps the chest shut even
  // if a non-owner ever got in some other way. The owner key comes
  // from the scene's profile (set in init, before create), NOT from
  // scene.userId — that is only set in _connectSocket, which runs
  // AFTER create()/refresh(), so a userId-based check would leave
  // the chest unresolvable. The profile and the userId derive from
  // the same email, so the two agree.
  get enabled() {
    const roomId = this.scene?.roomId || '';
    if (!isHomeRoom(roomId)) return false;
    const owner = homeOwnerOf(roomId);
    const me = ownerKeyFromProfile(this.scene?.profile || '');
    return Boolean(owner && me && owner === me);
  }

  /** Plain-data state for the storage panel (polls this ~2x/sec). */
  getState() {
    const pocket = getInventoryState();
    const stored = getHomeItems().map(describeStored);
    return {
      stored,
      storedCount: stored.length,
      pocketItems: pocket.items,
      pocketCount: pocket.count,
      pocketCapacity: pocket.capacity,
      hasBag: pocket.hasBag,
      coins: pocket.coins,
      atHome: this.enabled,
      roomId: this.scene?.roomId || '',
    };
  }

  /** (Re)build the chest position and ask the server for its state. */
  refresh() {
    this._resolveChest();
    if (this.enabled && this.scene?.socket?.connected) {
      try { this.scene.socket.emit('get_home', { roomId: this.scene.roomId }); } catch {}
    }
  }

  /** Re-sync my local stored-items record to the server (badges
   *  pattern): this is what brings stored items back after a server
   *  restart wiped the in-memory store. The server merges the record
   *  and replies with the merged home_state. Called from the scene's
   *  socket connect handler. */
  syncToServer() {
    if (!this.enabled) return;
    if (!this.scene?.socket?.connected) return;
    try {
      this.scene.socket.emit('home_sync', {
        roomId: this.scene.roomId,
        items: getHomeItems(),
      });
    } catch {}
  }

  /** The server's authoritative stored-items list (home_state
   *  broadcast): replace the local record with it. Called from the
   *  scene's socket handler. */
  applyState(payload = {}) {
    if (!this.enabled) return;
    const items = normalizeHomeItems(payload.items);
    try { setHomeItems(items); } catch {}
  }

  /** Open the storage panel (E key / chest click / interact button). */
  openStorage() {
    if (!this.enabled || !this._chest) return { ok: false, reason: 'not-available' };
    try { this.scene?.onOpenHomeStorage?.(); } catch {}
    return { ok: true, opened: true };
  }

  /** One click on the chest itself: open it if the click lands on
   * the chest and the player is standing close enough. Same
   * scene-level pointerdown pattern as the notice board — the chest
   * is furniture, and per-object pointerdown proved unreliable on
   * decor. Returns { ok, opened?, reason? }. */
  chestTapAt(wx, wy) {
    if (!this.enabled || !this._chest) return { ok: false, reason: 'not-available' };
    const c = this._chest;
    if (wx < c.x || wx > c.x + c.w || wy < c.y || wy > c.y + c.h) {
      return { ok: false, reason: 'no-chest' };
    }
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const cx = Math.max(c.x, Math.min(player.gx, c.x + c.w));
    const cy = Math.max(c.y, Math.min(player.gy, c.y + c.h));
    if (Math.hypot(player.gx - cx, player.gy - cy) > HOME_CHEST_OPEN_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    this.openStorage();
    return { ok: true, opened: true };
  }

  /** The chest within HOME_CHEST_OPEN_RANGE of (x, y) — or null (E key). */
  nearestChest(px, py) {
    if (!this.enabled || !this._chest) return null;
    const c = this._chest;
    const cx = Math.max(c.x, Math.min(px, c.x + c.w));
    const cy = Math.max(c.y, Math.min(py, c.y + c.h));
    return Math.hypot(px - cx, py - cy) <= HOME_CHEST_OPEN_RANGE ? { ...c } : null;
  }

  /** Resolve the chest to the live room layout: the real
   * `storage_chest` zone (hand-placed in layouts/home.js). If the
   * room has no chest zone (e.g. an approved user layout replaced
   * the home layout), there is simply no chest here — _chest stays
   * null instead of pointing at another room's spot. */
  _resolveChest() {
    this._chest = null;
    if (!this.enabled) return;
    const layout = this.scene?.roomLayout;
    const zones = Array.isArray(layout?.currentZones) && layout.currentZones.length
      ? layout.currentZones
      : (Array.isArray(layout?.interactZones) ? layout.interactZones : []);
    const zone = zones.find((z) => z.type === 'storage_chest' || /storage chest/i.test(z.label || ''));
    if (zone) {
      this._chest = {
        x: zone.x ?? 740, y: zone.y ?? 160,
        w: zone.w ?? 120, h: zone.h ?? 80,
      };
    }
  }

  // ---- storage actions (called by the DOM panel) -------------------------

  /** Store one pocket item at home. Puzzle pieces are refused (they
   *  belong on the puzzle board). The item leaves the pocket right
   *  away; the server confirms by broadcasting the updated home_state
   *  (and the local record is the fallback if the socket is down). */
  storeItem(id) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const item = getItem(id);
    if (!item) return { ok: false, reason: 'not-found' };
    if (item.type === ITEM_TYPES.PUZZLE_PIECE) {
      return { ok: false, reason: 'puzzle-piece-no-store' };
    }
    const res = storeIntoHome(getHomeItems(), item);
    if (!res.ok) return { ok: false, reason: res.reason || 'error' };
    const removed = removeItem(id);
    if (!removed) return { ok: false, reason: 'not-found' };
    try { setHomeItems(res.list); } catch {}
    try {
      this.scene?.socket?.emit('home_store', { roomId: this.scene.roomId, item: res.item });
    } catch {}
    try { this.scene?.onSystemNotice?.(`📦 Stored ${res.item.label || 'item'} at home.`); } catch {}
    return { ok: true, stored: describeStored(res.item) };
  }

  /** Take one stored item back into the pocket — only if the pocket
   *  has room (pocket 3 / bag 10, same as everywhere else). */
  takeItem(id) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const stored = getHomeItems().find((it) => it.id === id);
    if (!stored) return { ok: false, reason: 'not-found' };
    const inv = getInventory();
    if (!canAddItem(stored, inv)) return { ok: false, reason: 'inventory-full' };
    const taken = takeFromHome(getHomeItems(), id);
    if (!taken.item) return { ok: false, reason: 'not-found' };
    const added = addItem(taken.item);
    if (!added.ok) {
      // The pocket filled up between the check and the add (two tabs,
      // a race) — put it back home instead of losing it.
      try { setHomeItems(storeIntoHome(getHomeItems(), taken.item).list); } catch {}
      return { ok: false, reason: added.reason || 'error' };
    }
    try { setHomeItems(taken.list); } catch {}
    try {
      this.scene?.socket?.emit('home_take', { roomId: this.scene.roomId, itemId: id });
    } catch {}
    return { ok: true, item: added.item };
  }

  /** Unload ALL of the pocket/bag into home storage at once — the
   *  user's "freeing up space for the day's quest". Puzzle pieces
   *  stay in the pocket (they belong on the board). Returns
   *  { ok, moved, left } — moved is how many items went home, left
   *  is how many stayed (pieces). */
  unloadAll() {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const inv = getInventory();
    if (!inv.items.length) return { ok: true, moved: 0, left: 0 };
    const res = unloadPocketIntoHome(getHomeItems(), inv.items);
    if (!res.moved.length) {
      // Nothing could move (only puzzle pieces in the pocket).
      return { ok: true, moved: 0, left: res.left.length, piecesOnly: true };
    }
    for (const item of res.moved) removeItem(item.id);
    try { setHomeItems(res.list); } catch {}
    try {
      this.scene?.socket?.emit('home_unload_all', { roomId: this.scene.roomId, items: res.moved });
    } catch {}
    try {
      this.scene?.onSystemNotice?.(`📦 Unloaded ${res.moved.length} item${res.moved.length === 1 ? '' : 's'} at home — pockets empty for the day's quest!`);
    } catch {}
    return { ok: true, moved: res.moved.length, left: res.left.length };
  }

  update() {
    // Nothing per-frame: storage arrives over the socket, opens arrive
    // via pointerdown / E, and the panel polls getState().
  }

  destroy() {
    this._chest = null;
    this.scene = null;
  }
}
