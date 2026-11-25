// TrimTreeQuest.js — Trim the Tree (Trim the Tree v1, `sq-trim-tree-v1`;
// v1.2 `sq-christmas-multi-v1.2` — every hang counts, the
// one-per-person rule is gone, and coins pay per counted hang).
//
// A BIG Christmas tree stands in Agora, and an ornament box sits in
// a corner of the room. Ornaments are FREE: walk to the box, press E
// (or click it) to take one, walk to the tree, press E (or click the
// tree) to hang it. 25 counted ornaments finish a tree; the tree
// fills in STAGES as more ornaments go up (bare → sparse → half
// → full) — one ornament alone does not change the tree's stage.
// The state is SHARED: everyone in the room sees the same tree,
// the same count, the same ornaments (server/socket.js `tree_hang`
// / `get_tree`, in-memory per room like the group puzzle).
//
// MULTI-HANG (v1.2, `sq-christmas-multi-v1.2` — user decision):
// every hang counts toward the 25, no per-person cap — there are
// not 25 users yet to finish a tree the old way. The tracker
// shows X/25 and the hang feedback states the count plainly;
// there is nothing left to hide.
//
// Two trees per venue: when tree 1 is finished, tree 2 appears in
// the SAME room (Agora). Tree 2 is a fresh round — everyone counts
// again on tree 2. A finished tree STAYS finished
// (it is decor, not a puzzle that resets); there is no auto-reset.
// Max 2 trees: once tree 2 is done, the quest is over for the
// venue until a server restart wipes the in-memory state.
//
// Reward: a badge (wired into the existing badges system, one
// badge per completed quest, once ever) + 5 coins per counted
// hang, paid client-side as hangs land (see _payForCountedHangs —
// the paid count is tracked per profile per tree in localStorage,
// so a hang pays exactly once, including across a refresh).
//
// Owned by VillageScene: constructed in create(), ticked in update(),
// destroyed in shutdown(), refreshed on floor switches. Agora only
// (roomId === 'agora-houston'); every other room is a no-op. The
// Golden Key, the puzzle, the boards and the shop are NOT touched
// by this quest — the decorations shop (buy at the bar) is a
// separate later build.

import { DEPTH } from './depth.js';
import {
  TREE_MARKER_V1,
  TREE_TOTAL,
  TREE_MAX,
  TREE_REWARD_COINS,
  TREE_BOX_TAKE_RANGE,
  TREE_HANG_RANGE,
  TREE_ORNAMENT_SLOTS,
  ornamentStyle,
  createTreeState,
  activeTreeProgress,
  treeStage,
  hangOrnament,
  serializeTreeState,
  parseTreeState,
} from './treeState.js';

const AGORA_ROOM_ID = 'agora-houston';
const RESPAWN_CHECK_MS = 1000; // how often update() re-checks the tree/box

// BUILDER DECISION — tree + box placement in Agora (free spots that
// do not collide with the coffee bar (north wall), entrance (bottom
// centre), couches, tables, plants, trash can, or portrait):
//   tree 1 — east side, (1400, 480): clear of Table 3 (1260,640),
//     the east plants (1470,260) / (1470,690), and the cat's sunbeam
//     (~1117,583). Base at y=480, ~280 tall, ~210 wide at the base.
//   tree 2 — west side, (190, 470): clear of Table 1 (300,280),
//     Table 4 (300,640), and the west plants. Same size as tree 1.
//   box — south-west corner, (170, 760): clear of the SW plant
//     (130,690) and Table 4, inside the boundary (y max 820).
// The trees and the box are NOT solid (same as the puzzle table):
// players can walk through the tree's lower branches. A future pass
// can register dynamic solids for them.
export const TREE_SPOTS = [
  { x: 1400, y: 480 }, // tree 1
  { x: 190, y: 470 }, // tree 2
];
export const TREE_BOX_POS = { x: 170, y: 760 };

// Light positions on the tree (deterministic — every client renders
// the same lights). Stage 3 lights the first 12, stage 4 all 20.
const TREE_LIGHT_SPOTS = [
  { dx: -70, dy: -60 }, { dx: 20, dy: -55 }, { dx: 70, dy: -75 },
  { dx: -45, dy: -110 }, { dx: 45, dy: -105 }, { dx: 0, dy: -125 },
  { dx: -60, dy: -160 }, { dx: 55, dy: -165 }, { dx: -20, dy: -185 },
  { dx: 25, dy: -200 }, { dx: -35, dy: -225 }, { dx: 10, dy: -235 },
  { dx: -85, dy: -30 }, { dx: 85, dy: -35 }, { dx: -10, dy: -80 },
  { dx: 60, dy: -140 }, { dx: -55, dy: -190 }, { dx: 40, dy: -220 },
  { dx: 0, dy: -160 }, { dx: -25, dy: -145 },
];

// Per-profile paid-tree counts (v1.2, `sq-christmas-multi-v1.2`):
// coins pay +5 per COUNTED hang, as hangs land — not once per tree
// on completion. The guard is a per-profile, per-tree count of
// hangs already paid for, in localStorage under
// 'sidequest-tree-paid-counts' ({ owner -> { 1: n, 2: m } }). The
// guard is written BEFORE the async wallet call, so a double
// broadcast can never pay twice; a refresh/reconnect re-reads the
// state and pays only the difference. A server restart wipes the
// in-memory room state (the persisted tree row reloads with its
// hungBy intact, so the diff still holds); a lower counted total
// than the stored paid count means a fresh epoch (see
// owedTreeHangs). Same profile scoping as QuestManager /
// ChristmasLightsQuest. (Guests share the 'shared' owner —
// pre-existing, same as v1.)
function currentOwner() {
  try {
    const raw = localStorage.getItem('sidequest_profile');
    if (!raw) return 'shared';
    const p = JSON.parse(raw);
    const id = p?.email || p?.profile?.email || p?.id || p?.profile?.id || p?.userId || p?.profile?.userId;
    return String(id || '').trim().toLowerCase() || 'shared';
  } catch {
    return 'shared';
  }
}

function loadPaidTreeCounts() {
  try {
    const raw = localStorage.getItem('sidequest-tree-paid-counts');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  // Migrate the v1 guard ('sidequest-tree-paid', { owner: [treeNums]
  // } — paid +5 once per tree on completion): a v1 contributor on a
  // tree had exactly one counted hang there, so each listed tree
  // migrates to a count of 1.
  try {
    const old = JSON.parse(localStorage.getItem('sidequest-tree-paid') || '{}');
    const migrated = {};
    for (const [owner, trees] of Object.entries(old || {})) {
      if (!Array.isArray(trees)) continue;
      const counts = {};
      for (const t of trees) {
        const n = Number(t);
        if (Number.isInteger(n) && n >= 1 && n <= 2) counts[n] = 1;
      }
      if (Object.keys(counts).length) migrated[owner] = counts;
    }
    return migrated;
  } catch {
    return {};
  }
}

function savePaidTreeCounts(paid) {
  try { localStorage.setItem('sidequest-tree-paid-counts', JSON.stringify(paid)); } catch {}
}

/**
 * Pure diff for the per-hang payment on one tree: how many of my
 * counted hangs there are still unpaid, and what the paid count
 * becomes. `myCounted` is my total hangs on that tree in the
 * current room state (hungBy[me]); `paidCount` is how many I have
 * already been paid for on that tree. A counted total LOWER than
 * the paid count means the room state was wiped (server restart)
 * and started over — a fresh epoch, so the paid count resets to 0
 * and the current hangs pay in full. Returns { owed, newPaid }.
 */
export function owedTreeHangs(myCounted, paidCount) {
  const counted = Math.max(0, Number(myCounted) || 0);
  const paid = Math.max(0, Number(paidCount) || 0);
  if (counted <= 0) return { owed: 0, newPaid: paid };
  if (counted < paid) return { owed: counted, newPaid: counted };
  return { owed: counted - paid, newPaid: counted };
}

export class TrimTreeQuest {
  constructor(scene) {
    this.scene = scene;
    // sq-trim-tree-v1 — marker for the v1 landing check.
    this.marker = TREE_MARKER_V1;
    this.state = createTreeState();
    this.carrying = false; // I am holding an ornament from the box
    this._carryText = null; // carried-ornament marker above my head (sq-carry-ornament-v1)
    this.myCountedTrees = new Set(); // tree numbers (1/2) my first ornament counted on
    this._treeContainers = new Map(); // 'tree1' | 'tree2' -> Phaser container
    this._boxContainer = null;
    this._pendingHangTree = null; // tree number of my hang awaiting server confirm
    this._lastCheckMs = 0;
  }

  get enabled() {
    return this.scene?.roomId === AGORA_ROOM_ID;
  }

  _myUserId() {
    return this.scene?.userId || this.scene?.socket?.id || '__local__';
  }

  /** Room progress for the tracker: { tree, counted, total, completed, allDone }. */
  getProgress() {
    if (!this.enabled) return null;
    return activeTreeProgress(this.state);
  }

  /** (Re)build the trees + box in Agora; clear elsewhere. */
  refresh() {
    this._clearEntities();
    if (!this.enabled) return;
    this._drawAll();
    this._requestState();
  }

  _requestState() {
    try {
      if (this.scene?.socket?.connected) {
        this.scene.socket.emit('get_tree', { roomId: this.scene.roomId });
      }
    } catch {}
  }

  /** Apply the server's canonical state (or a local fallback). */
  applyState(payload = {}) {
    const prev = this.state;
    const next = parseTreeState(payload);
    // My hang, confirmed: I am a contributor on the tree I hung on
    // now — every hang counts (v1.2), so any confirmed pending hang
    // means I counted on that tree. The pending flag clears either way.
    if (this._pendingHangTree != null) {
      const tree = next.trees[this._pendingHangTree - 1];
      if (tree && tree.contributors.includes(this._myUserId())) {
        this.myCountedTrees.add(this._pendingHangTree);
      }
      this._pendingHangTree = null;
    }
    // Per-hang payment (v1.2, `sq-christmas-multi-v1.2`): pay for
    // any of my counted hangs not yet paid for — this also heals a
    // missed broadcast after a refresh/reconnect.
    this._payForCountedHangs(next);
    // Tree(s) that just finished: badge contributors, once.
    for (let i = 0; i < TREE_MAX; i++) {
      if (next.trees[i]?.completed && !prev.trees[i]?.completed) {
        this._onTreeCompleted(i + 1, next.trees[i]);
      }
    }
    this.state = next;
    this._drawAll();
    this._bumpHud();
  }

  /**
   * Pay +5 coins per counted hang of mine not yet paid for (v1.2,
   * `sq-christmas-multi-v1.2`), per tree. Reads my total hangs on
   * each tree from the room state (hungBy[me]), diffs against the
   * per-profile per-tree paid counts in localStorage, and pays only
   * the difference — a duplicate broadcast pays nothing, and a
   * refresh/reconnect pays exactly the hangs that landed while I
   * was away. The paid counts are written BEFORE the async wallet
   * call, so a crash mid-payment cannot double-pay either. Silent
   * per hang: the coins just land in the wallet.
   */
  _payForCountedHangs(state) {
    try {
      const owner = currentOwner();
      const paid = loadPaidTreeCounts();
      const mine = paid[owner] && typeof paid[owner] === 'object' ? paid[owner] : {};
      let totalOwed = 0;
      let changed = false;
      for (let i = 0; i < TREE_MAX; i++) {
        const treeNum = i + 1;
        const counted = Number(state?.trees?.[i]?.hungBy?.[this._myUserId()]) || 0;
        if (counted <= 0) continue;
        const { owed, newPaid } = owedTreeHangs(counted, mine[treeNum]);
        if (owed <= 0) continue;
        mine[treeNum] = newPaid;
        totalOwed += owed;
        changed = true;
      }
      if (!changed) return;
      paid[owner] = mine;
      savePaidTreeCounts(paid);
      const coins = totalOwed * TREE_REWARD_COINS;
      try {
        import('./CoinWallet.js')
          .then((m) => m.earnCoins(coins, 'trim-tree'))
          .catch(() => {});
      } catch {}
    } catch {}
  }

  /** A tree just finished (maybe by me, maybe by the room). */
  _onTreeCompleted(treeNum, tree) {
    const iCounted = this.myCountedTrees.has(treeNum);
    const banner = {
      id: `trim-tree-${treeNum}`,
      emoji: '🎄',
      title: treeNum === 1 ? 'Tree 1 Trimmed!' : 'Tree 2 Trimmed!',
      description: treeNum === 1
        ? 'The first tree is fully trimmed — a second tree has appeared in Agora!'
        : 'Both trees are fully trimmed — Agora is ready for Christmas!',
      rewardCoins: TREE_REWARD_COINS,
    };
    try { this.scene?.questManager?.showQuestBannerFor?.(banner); } catch {}
    if (iCounted) {
      // Quest badges v1: helping finish a tree earns the Trim the
      // Tree badge, once ever — a later tree finishing does not
      // re-earn it. The server awards the same badge to every
      // contributor, so both paths converge. (Coins are NOT paid
      // here any more — v1.2 pays +5 per counted hang as hangs
      // land, in _payForCountedHangs.)
      try { this.scene?.questManager?.recordTreeCompletion?.(); } catch {}
    }
    this.scene?.questManager?.showToast?.(
      treeNum === 1
        ? '🎉 Tree 1 is fully trimmed! A second tree has appeared in Agora.'
        : '🎉 Tree 2 is fully trimmed! Agora is ready for Christmas.',
    );
  }

  _bumpHud() {
    try { this.scene?.questManager?.bumpHud?.(); } catch {}
  }

  // ---- taking + hanging ornaments -------------------------------------

  /** Take a free ornament from the box. You can only carry one at a
   *  time — and you can take another after hanging one, as many
   *  times as you like (v1.2, `sq-christmas-multi-v1.2`: every hang
   *  counts, no one-per-person limit). */
  takeOrnament() {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (this.state.active < 0) {
      try { this.scene?.onSystemNotice?.('🎄 Both trees are finished — thank you!'); } catch {}
      return { ok: false, reason: 'all-done' };
    }
    if (this.carrying) {
      try { this.scene?.onSystemNotice?.("🎄 You're already holding an ornament — hang it on the tree first."); } catch {}
      return { ok: false, reason: 'already-carrying' };
    }
    this.carrying = true;
    this._updateCarryIndicator();
    try { this.scene?.onSystemNotice?.('🎄 You took an ornament from the box. Hang it on the tree!'); } catch {}
    return { ok: true };
  }

  /** Hang the ornament I am carrying on the ACTIVE tree. */
  hangOrnament() {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (!this.carrying) return { ok: false, reason: 'no-ornament' };
    if (this.state.active < 0) return { ok: false, reason: 'all-done' };
    const treeNum = this.state.active + 1;
    this._pendingHangTree = treeNum;
    this.carrying = false;
    this._updateCarryIndicator();
    const socket = this.scene?.socket;
    if (socket?.connected) {
      // The server validates and broadcasts the new state to the
      // room; applyState confirms it.
      try { socket.emit('tree_hang', { roomId: this.scene.roomId }); } catch {}
      try { this.scene?.onSystemNotice?.('🎄 You hung an ornament on the tree!'); } catch {}
      return { ok: true, pending: true };
    }
    // Offline: apply locally so the quest still works solo.
    const res = hangOrnament(this.state, this._myUserId());
    if (!res.ok) return res;
    if (res.counted) this.myCountedTrees.add(res.tree);
    // v1.2 (`sq-christmas-multi-v1.2`): pay for this hang now, from
    // the local state the hang just updated.
    this._payForCountedHangs(this.state);
    this._afterLocalChange('🎄 You hung an ornament on the tree!');
    if (res.treeFinished) this._onTreeCompleted(res.tree, this.state.trees[res.tree - 1]);
    return { ok: true, counted: res.counted };
  }

  _afterLocalChange(notice) {
    this._drawAll();
    this._bumpHud();
    if (notice) {
      try { this.scene?.onSystemNotice?.(notice); } catch {}
    }
  }

  /** One click at world (wx, wy): on the ornament box, take an
   *  ornament (if standing close enough). Silent unless it takes —
   *  clicks elsewhere do nothing. Returns { ok, took? }. */
  boxTapAt(wx, wy) {
    if (!this.enabled || this.state.active < 0) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    if (Math.abs(wx - TREE_BOX_POS.x) > 48 || Math.abs(wy - TREE_BOX_POS.y) > 40) {
      return { ok: false, reason: 'no-spot' };
    }
    if (Math.hypot(player.gx - TREE_BOX_POS.x, player.gy - TREE_BOX_POS.y) > TREE_BOX_TAKE_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    const res = this.takeOrnament();
    return { ...res, took: res.ok };
  }

  /** One click at world (wx, wy): on the ACTIVE tree, hang the
   *  ornament I am carrying (if standing close enough). Silent
   *  unless it hangs — clicks on a finished tree, or with empty
   *  hands, do nothing. Returns { ok, hung? }. */
  treeTapAt(wx, wy) {
    if (!this.enabled || this.state.active < 0) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    const spot = TREE_SPOTS[this.state.active];
    if (!spot) return { ok: false, reason: 'not-available' };
    // The tree is big (210 wide, ~280 tall): the whole triangle
    // counts as the tree, not just its trunk.
    if (Math.abs(wx - spot.x) > 115 || wy < spot.y - 285 || wy > spot.y + 30) {
      return { ok: false, reason: 'no-spot' };
    }
    if (Math.hypot(player.gx - spot.x, player.gy - spot.y) > TREE_HANG_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    const res = this.hangOrnament();
    return { ...res, hung: res.ok };
  }

  /** The ornament box within take range of (px, py) — or null (E key). */
  nearestBox(px, py) {
    if (!this.enabled || this.state.active < 0) return null;
    return Math.hypot(px - TREE_BOX_POS.x, py - TREE_BOX_POS.y) <= TREE_BOX_TAKE_RANGE
      ? { x: TREE_BOX_POS.x, y: TREE_BOX_POS.y }
      : null;
  }

  /** The ACTIVE tree within hang range of (px, py) — or null (E key). */
  nearestTree(px, py) {
    if (!this.enabled || this.state.active < 0) return null;
    const spot = TREE_SPOTS[this.state.active];
    if (!spot) return null;
    return Math.hypot(px - spot.x, py - spot.y) <= TREE_HANG_RANGE
      ? { x: spot.x, y: spot.y, tree: this.state.active + 1 }
      : null;
  }

  // ---- drawing ----------------------------------------------------------

  _drawAll() {
    this._clearEntities();
    if (!this.enabled) return;
    this._drawBox();
    // Tree 1 always stands in the room (bare at first). Tree 2
    // appears only once tree 1 is finished.
    this._drawTree(0);
    if (this.state.trees[0]?.completed) this._drawTree(1);
  }

  _drawBox() {
    const scene = this.scene;
    const { x, y } = TREE_BOX_POS;
    const g = scene.add.graphics();
    // Wooden box with a lid, a few ornaments peeking out of it.
    g.fillStyle(0x8b5a2b, 1);
    g.fillRect(-32, -20, 64, 42);
    g.fillStyle(0x6b4226, 1);
    g.fillRect(-34, -26, 68, 10);
    g.fillStyle(0xa16207, 1);
    g.fillRect(-4, -26, 8, 48);
    g.lineStyle(1.5, 0x2b2b33, 1);
    g.strokeRect(-32, -20, 64, 42);
    g.fillStyle(0xef4444, 1);
    g.fillCircle(-18, -28, 6);
    g.fillStyle(0xfbbf24, 1);
    g.fillCircle(0, -32, 6);
    g.fillStyle(0x3b82f6, 1);
    g.fillCircle(18, -28, 6);
    const label = scene.add.text(
      0, -48,
      '🎁 Ornament Box · FREE',
      { fontSize: '12px', color: '#1a4971', backgroundColor: 'rgba(255,255,255,0.92)', padding: { x: 6, y: 3 } },
    );
    label.setOrigin(0.5, 0.5);
    const container = scene.add.container(x, y, [g, label]);
    container.setDepth(DEPTH.ACTOR_MIN + Math.round(y));
    container.setSize(80, 90);
    this._boxContainer = container;
  }

  /** Draw tree `index` (0 = tree 1, 1 = tree 2) at its spot. */
  _drawTree(index) {
    const scene = this.scene;
    const spot = TREE_SPOTS[index];
    if (!spot) return;
    const tree = this.state.trees[index];
    if (!tree) return;
    const { x, y } = spot;
    const stage = treeStage(tree.counted);
    const g = scene.add.graphics();
    // Trunk.
    g.fillStyle(0x6b4226, 1);
    g.fillRect(-14, -34, 28, 38);
    // Three green tiers, widest at the base.
    const tiers = [
      { hw: 108, top: -6, apex: -150, color: 0x166534 },
      { hw: 88, top: -78, apex: -215, color: 0x15803d },
      { hw: 62, top: -150, apex: -278, color: 0x16a34a },
    ];
    for (const t of tiers) {
      g.fillStyle(t.color, 1);
      g.beginPath();
      g.moveTo(-t.hw, t.top);
      g.lineTo(t.hw, t.top);
      g.lineTo(0, t.apex);
      g.closePath();
      g.fillPath();
    }
    // Tinsel garlands — stage 1: one, stage 2: two, stage 4+: three.
    // (Stage 0 is bare: the first ornament alone does not change it.)
    const garlands = stage >= 4 ? [-60, -130, -195] : stage >= 2 ? [-60, -130] : stage >= 1 ? [-60] : [];
    for (const gy of garlands) {
      const half = gy === -60 ? 95 : gy === -130 ? 70 : 45;
      g.lineStyle(2, 0xfbbf24, 1);
      let prevX = -half;
      let prevY = gy;
      for (let px = -half + 12; px <= half; px += 12) {
        const py = gy + (Math.round(px / 12) % 2 === 0 ? 5 : -5);
        g.lineBetween(prevX, prevY, px, py);
        prevX = px;
        prevY = py;
      }
    }
    // Lights — stage 3: the first 12 spots, stage 4+: all 20.
    if (stage >= 3) {
      const lights = stage >= 4 ? TREE_LIGHT_SPOTS : TREE_LIGHT_SPOTS.slice(0, 12);
      for (const l of lights) {
        g.fillStyle(0xfef08a, 0.35);
        g.fillCircle(l.dx, l.dy, 6);
        g.fillStyle(0xfde047, 1);
        g.fillCircle(l.dx, l.dy, 3.5);
      }
    }
    // Counted ornaments, in their slots, in hang order.
    for (let i = 0; i < Math.min(tree.counted, TREE_TOTAL); i++) {
      const slot = TREE_ORNAMENT_SLOTS[i];
      if (slot) this._drawOrnament(g, slot.dx, slot.dy, ornamentStyle(i));
    }
    // Gold star on top — only when the tree is complete (stage 5).
    if (stage >= 5) this._drawStar(g, 0, -292, 16, 0xfbbf24);
    const label = scene.add.text(
      0, -318,
      tree.completed
        ? `🎄 Tree ${index + 1} — complete! 🎉`
        : `🎄 Tree ${index + 1} — ${tree.counted}/${TREE_TOTAL}`,
      { fontSize: '12px', color: '#1a4971', backgroundColor: 'rgba(255,255,255,0.92)', padding: { x: 6, y: 3 } },
    );
    label.setOrigin(0.5, 0.5);
    const container = scene.add.container(x, y, [g, label]);
    container.setDepth(DEPTH.ACTOR_MIN + Math.round(y));
    container.setSize(230, 340);
    this._treeContainers.set(index === 0 ? 'tree1' : 'tree2', container);
  }

  /** One ornament at (dx, dy), in one of four shapes. */
  _drawOrnament(g, dx, dy, style) {
    const c = style.color;
    if (style.shape === 'star') {
      this._drawStar(g, dx, dy, 8, c);
    } else if (style.shape === 'diamond') {
      g.fillStyle(c, 1);
      g.beginPath();
      g.moveTo(dx, dy - 8);
      g.lineTo(dx + 7, dy);
      g.lineTo(dx, dy + 8);
      g.lineTo(dx - 7, dy);
      g.closePath();
      g.fillPath();
    } else if (style.shape === 'candy') {
      g.fillStyle(0xef4444, 1);
      g.fillRoundedRect(dx - 7, dy - 4, 14, 8, 3);
      g.lineStyle(1.5, 0xffffff, 1);
      g.lineBetween(dx - 3, dy - 4, dx - 3, dy + 4);
      g.lineBetween(dx + 3, dy - 4, dx + 3, dy + 4);
    } else {
      // bauble (default)
      g.fillStyle(c, 1);
      g.fillCircle(dx, dy, 7);
      g.fillStyle(0xffffff, 0.55);
      g.fillCircle(dx - 2, dy - 2, 2);
    }
  }

  /** A 5-point star centred at (x, y), outer radius r. */
  _drawStar(g, x, y, r, color) {
    const inner = r * 0.45;
    g.fillStyle(color, 1);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillPath();
  }

  /** Carried-ornament marker (`sq-carry-ornament-v1`): while I am
   *  carrying a free ornament, a 🎄 rides above my head so the state
   *  is visible — no more invisible "am I holding one?" (the 2.6s
   *  take toast alone was too easy to miss). Same pattern as the
   *  cat's "hungry..." bubble: a scene-level text repositioned
   *  every frame. Offset to the side so it never covers my name. */
  _updateCarryIndicator() {
    try {
      const player = this.scene?.player;
      const show = Boolean(this.carrying && this.enabled && player);
      if (!show) {
        this._carryText?.setAlpha(0);
        return;
      }
      if (!this._carryText) {
        this._carryText = this.scene.add.text(0, 0, '🎄', { fontSize: '20px' });
        this._carryText.setOrigin(0.5, 1);
        this._carryText.setDepth(DEPTH.ACTOR_MIN + 500);
      }
      this._carryText.setPosition(player.gx + 22, player.gy - 56).setAlpha(1);
    } catch {}
  }

  update() {
    // Keep the carried-ornament marker on my head every frame.
    this._updateCarryIndicator();
    if (!this.enabled) return;
    const now = Date.now();
    if (now - (this._lastCheckMs || 0) < RESPAWN_CHECK_MS) return;
    this._lastCheckMs = now;
    // The trees re-spawn if a floor switch cleared them.
    if (!this._boxContainer || !this._treeContainers.get('tree1')) this._drawAll();
  }

  _clearEntities() {
    try { this._boxContainer?.destroy(); } catch {}
    this._boxContainer = null;
    for (const c of this._treeContainers.values()) {
      try { c?.destroy(); } catch {}
    }
    this._treeContainers.clear();
  }

  destroy() {
    this._clearEntities();
    try { this._carryText?.destroy(); } catch {}
    this._carryText = null;
    this.scene = null;
  }
}
