// treeState.js — shared Trim the Tree rules (Trim the Tree v1,
// `sq-trim-tree-v1`; v1.2 `sq-christmas-multi-v1.2` — every hang
// counts, the one-per-person rule is gone).
//
// Pure logic, no Phaser and no Node APIs, so BOTH sides import it:
//   - server/socket.js (canonical room state, validates every hang)
//   - src/village/TrimTreeQuest.js (local fallback + instant feedback
//     when the socket is down)
//
// The quest: a BIG Christmas tree stands in Agora, and an ornament
// box sits in a corner of the room. Ornaments are FREE — take one
// from the box, walk to the tree, hang it. 25 counted ornaments
// finish a tree, and the tree fills in STAGES as more ornaments
// go up (bare → sparse → half → full) — one ornament alone
// does not change the tree's stage.
//
// MULTI-HANG (v1.2, `sq-christmas-multi-v1.2` — user decision):
// every hang counts toward the 25, no per-person cap. There are
// not 25 users yet to finish a tree the old way, so a few players
// hanging several ornaments each can finish one. `contributors`
// still lists everyone who hung at least once on that tree (the
// badge list); `hungBy` counts each player's total hangs on that
// tree (the per-hang coin payment reads it). There is no `extras`
// concept any more — counted IS the total hangs on the tree, and
// every hang renders a counted ornament in its slot.
//
// Two trees per venue: when tree 1 is finished, tree 2 appears in
// the SAME room (Agora). Tree 2 is a fresh round — everyone counts
// again on tree 2. A finished tree STAYS finished
// (it is decor, not a puzzle that resets); there is no auto-reset.
// Max 2 trees: once tree 2 is done, the quest is over for the
// venue until a server restart wipes the in-memory state.

export const TREE_ID = 'trim-tree';
export const TREE_MARKER_V1 = 'sq-trim-tree-v1';
export const TREE_TOTAL = 25; // counted ornaments that finish one tree
export const TREE_MAX = 2; // max trees per venue (tree 1, then tree 2)
export const TREE_REWARD_COINS = 5; // builder decision — same as Group Puzzle
export const TREE_BOX_TAKE_RANGE = 140; // px from the box to take an ornament
export const TREE_HANG_RANGE = 170; // px from a tree's base to hang on it

// Fill stages for a tree, by counted ornaments.
// Stage 0 covers 0-1 counted: the first ornament alone leaves the
// tree looking bare — tinsel, lights and the star arrive only as
// more ornaments go up. Individual counted ornaments still render
// in their slots from the first hang (that is the feedback that a
// hang worked); the STAGE is what stays bare.
export const TREE_STAGE_THRESHOLDS = [2, 7, 13, 19, 25];

/** Fill stage 0..5 for `counted` counted ornaments. */
export function treeStage(counted) {
  const c = Number(counted) || 0;
  let stage = 0;
  for (const t of TREE_STAGE_THRESHOLDS) {
    if (c >= t) stage += 1;
  }
  return stage;
}

// Ornament slots on the tree: { dx, dy } offsets from the tree's
// base centre (dy is negative going up; the tree is ~280 tall,
// ~210 wide at the base). 25 slots, one per counted ornament,
// spread across the triangle so the tree fills evenly as the count
// grows. Deterministic — every client renders the same slots.
export const TREE_ORNAMENT_SLOTS = [
  // Row 1 (near the base, widest)
  { dx: -80, dy: -45 }, { dx: -40, dy: -45 }, { dx: 0, dy: -45 }, { dx: 40, dy: -45 }, { dx: 80, dy: -45 },
  // Row 2
  { dx: -60, dy: -95 }, { dx: -30, dy: -95 }, { dx: 0, dy: -95 }, { dx: 30, dy: -95 }, { dx: 60, dy: -95 },
  // Row 3
  { dx: -44, dy: -145 }, { dx: -22, dy: -145 }, { dx: 0, dy: -145 }, { dx: 22, dy: -145 }, { dx: 44, dy: -145 },
  // Row 4
  { dx: -26, dy: -195 }, { dx: -13, dy: -195 }, { dx: 0, dy: -195 }, { dx: 13, dy: -195 }, { dx: 26, dy: -195 },
  // Row 5 (near the top, narrowest)
  { dx: -10, dy: -240 }, { dx: -5, dy: -240 }, { dx: 0, dy: -240 }, { dx: 5, dy: -240 }, { dx: 10, dy: -240 },
];

// Ornament shapes (the tree must show ornaments of DIFFERENT shapes,
// not 25 identical dots): the shape for slot i cycles through four.
export const TREE_ORNAMENT_SHAPES = ['bauble', 'star', 'diamond', 'candy'];
export const TREE_ORNAMENT_COLORS = [0xef4444, 0xfbbf24, 0x3b82f6, 0xec4899, 0x22c55e, 0xa855f7];

/** Shape + colour for ornament slot `index` (0-based). */
export function ornamentStyle(index) {
  const i = Number(index) || 0;
  return {
    shape: TREE_ORNAMENT_SHAPES[i % TREE_ORNAMENT_SHAPES.length],
    color: TREE_ORNAMENT_COLORS[i % TREE_ORNAMENT_COLORS.length],
  };
}

function createSingleTree() {
  return {
    counted: 0, // ornaments on this tree (0..25) — the X/25 number; every hang counts (v1.2)
    contributors: [], // user ids who hung at least once on this tree (the badge list)
    hungBy: {}, // userId -> total hangs on this tree (per-hang coin payment reads this)
    completed: false,
    completedAt: 0, // Date.now() when the 25th counted ornament landed
  };
}

export function createTreeState() {
  return {
    // Which tree accepts ornaments now: 0 = tree 1, 1 = tree 2,
    // -1 = both trees done (the quest is over for this venue).
    active: 0,
    trees: [createSingleTree(), createSingleTree()],
  };
}

/** How many trees are finished in this venue (0..2). */
export function treesDone(state) {
  return (state?.trees || []).filter((t) => t?.completed).length;
}

/** Is the whole quest done here — both trees finished? */
export function isTreeComplete(state) {
  return treesDone(state) >= TREE_MAX;
}

/** Progress for the tracker: the ACTIVE tree's counted/total, which
 *  tree it is (1 or 2), and whether both trees are done. When both
 *  are done, `tree` is 0 and `counted` is the second tree's final
 *  count, so the tracker can say "both trees complete". */
export function activeTreeProgress(state) {
  const done = isTreeComplete(state);
  const i = state?.active;
  if (i == null || i < 0 || i >= TREE_MAX) {
    const last = state?.trees?.[TREE_MAX - 1];
    return { tree: 0, counted: Number(last?.counted) || 0, total: TREE_TOTAL, completed: done, allDone: done };
  }
  const t = state.trees[i];
  return {
    tree: i + 1,
    counted: Number(t?.counted) || 0,
    total: TREE_TOTAL,
    completed: Boolean(t?.completed),
    allDone: done,
  };
}

/** Plain JSON copy safe to send over the socket. */
export function serializeTreeState(state) {
  const s = state || createTreeState();
  const active = (Number.isInteger(s.active) && s.active >= -1 && s.active < TREE_MAX) ? s.active : 0;
  return {
    active,
    trees: (s.trees || [createSingleTree(), createSingleTree()]).slice(0, TREE_MAX).map((t) => ({
      counted: Math.max(0, Math.min(TREE_TOTAL, Number(t?.counted) || 0)),
      contributors: [...new Set((t?.contributors || []).map((u) => String(u)).filter(Boolean))].slice(0, 50),
      hungBy: Object.fromEntries(
        Object.entries(t?.hungBy || {})
          .filter(([u, n]) => u && Number.isFinite(Number(n)) && Number(n) > 0)
          .slice(0, 50),
      ),
      completed: Boolean(t?.completed),
      completedAt: Number(t?.completedAt) || 0,
    })),
    counted: activeTreeProgress(s).counted,
    total: TREE_TOTAL,
    treesDone: treesDone(s),
    allDone: isTreeComplete(s),
  };
}

/** Validate an incoming state object (never trust the wire). */
export function parseTreeState(raw) {
  const s = createTreeState();
  if (!raw || typeof raw !== 'object') return s;
  if (Number.isInteger(raw.active) && raw.active >= -1 && raw.active < TREE_MAX) s.active = raw.active;
  if (Array.isArray(raw.trees)) {
    for (let i = 0; i < Math.min(raw.trees.length, TREE_MAX); i++) {
      const t = raw.trees[i];
      if (!t || typeof t !== 'object') continue;
      const next = createSingleTree();
      next.counted = Math.max(0, Math.min(TREE_TOTAL, Number(t.counted) || 0));
      // v1.2 (`sq-christmas-multi-v1.2`): `extras` no longer exists —
      // a legacy row carrying it is simply ignored.
      if (Array.isArray(t.contributors)) {
        next.contributors = [...new Set(t.contributors.map((u) => String(u)).filter(Boolean))].slice(0, 50);
      }
      if (t.hungBy && typeof t.hungBy === 'object') {
        for (const [u, n] of Object.entries(t.hungBy)) {
          if (!u || !Number.isFinite(Number(n)) || Number(n) <= 0) continue;
          next.hungBy[u] = Math.min(999, Number(n));
        }
      }
      next.completed = Boolean(t.completed) || next.counted >= TREE_TOTAL;
      if (Number.isFinite(Number(t.completedAt))) next.completedAt = Number(t.completedAt);
      // A completed tree's counted number is always the full 25 —
      // a wire state that claims "complete" with fewer is repaired.
      if (next.completed) next.counted = TREE_TOTAL;
      s.trees[i] = next;
    }
  }
  // If the active pointer disagrees with the trees (e.g. tree 1 is
  // complete but active still says 0), repair it — the active tree
  // is always the first unfinished one, or -1 when both are done.
  const firstOpen = s.trees.findIndex((t) => !t.completed);
  s.active = firstOpen === -1 ? -1 : firstOpen;
  return s;
}

/**
 * One player hung an ornament on the ACTIVE tree. Returns
 * { ok, counted, treeFinished, tree, contributors }.
 *
 * MULTI-HANG (v1.2, `sq-christmas-multi-v1.2`): every hang on the
 * active tree counts toward the 25 — no per-person cap, no extras.
 * `counted` is always true on a successful hang. A finished tree
 * finishes the round for that tree: tree 1 finishing activates
 * tree 2; tree 2 finishing ends the quest for the venue
 * (active: -1).
 */
export function hangOrnament(state, userId) {
  const i = state?.active;
  if (i == null || !Number.isInteger(i) || i < 0 || i >= TREE_MAX) {
    return { ok: false, reason: 'all-done' };
  }
  const tree = state.trees[i];
  if (!tree || tree.completed) return { ok: false, reason: 'already-complete' };
  const uid = String(userId || '');
  if (!uid) return { ok: false, reason: 'bad-user' };
  tree.hungBy[uid] = (Number(tree.hungBy[uid]) || 0) + 1;
  if (!tree.contributors.includes(uid)) tree.contributors.push(uid);
  tree.counted += 1;
  let treeFinished = false;
  if (tree.counted >= TREE_TOTAL) {
    tree.completed = true;
    tree.completedAt = Date.now();
    treeFinished = true;
    // Tree 1 done -> tree 2 appears (same venue, fresh round).
    // Tree 2 done -> the quest is over here (max 2 trees).
    state.active = i === 0 ? 1 : -1;
  }
  return { ok: true, counted: true, treeFinished, tree: i + 1, contributors: [...tree.contributors] };
}

// ---- per-hang coin payment (v1.2, `sq-christmas-multi-v1.2`) ----
// Coins pay +5 per COUNTED hang, client-side, tracked per profile
// per tree in localStorage so a hang pays exactly once — including
// across a refresh/reconnect (the client re-applies the server
// state and the diff below pays only what is still unpaid). The
// key is NEW in v1.2: v1 paid once per tree on completion under
// the list guard `sidequest-tree-paid`; that guard is migrated
// below.
export const TREE_PAID_COUNTS_KEY = 'sidequest-tree-paid-counts';

export function loadPaidTreeCounts() {
  try {
    const raw = localStorage.getItem(TREE_PAID_COUNTS_KEY);
    if (!raw) return migratePaidTreeGuard({});
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function savePaidTreeCounts(paid) {
  try {
    localStorage.setItem(TREE_PAID_COUNTS_KEY, JSON.stringify(paid || {}));
  } catch {}
}

/**
 * One-time migration from the v1 list guard (`sidequest-tree-paid`:
 * { owner: [treeNums] } — paid once per tree, on completion). A
 * profile paid under v1 counted exactly one hang per listed tree,
 * so each listed tree starts v1.2 with a paid count of 1.
 */
export function migratePaidTreeGuard(paid) {
  try {
    const raw = localStorage.getItem('sidequest-tree-paid');
    if (!raw) return paid;
    const old = JSON.parse(raw);
    if (!old || typeof old !== 'object') return paid;
    const next = { ...(paid || {}) };
    for (const [owner, treeNums] of Object.entries(old)) {
      if (!Array.isArray(treeNums) || next[owner] != null) continue;
      const perTree = {};
      for (const n of treeNums) {
        if (n === 1 || n === 2) perTree[n] = 1;
      }
      next[owner] = perTree;
    }
    return next;
  } catch {
    return paid;
  }
}

/**
 * Pure diff: how many of my counted hangs on one tree are still
 * unpaid? Returns { owed, newPaid } — `owed` is what to pay now
 * (×5 coins), `newPaid` is the paid count to store. A counted
 * total LOWER than the paid count means the room state was wiped
 * (a server restart) and started over, so the paid count resets
 * to 0 and the current hangs pay in full.
 */
export function owedTreeHangs(myCounted, paidCount) {
  const counted = Number(myCounted) || 0;
  const paid = Number(paidCount) || 0;
  if (counted <= paid) {
    return counted > 0 && paid > counted
      ? { owed: counted, newPaid: counted }
      : { owed: 0, newPaid: paid };
  }
  return { owed: counted - paid, newPaid: counted };
}
