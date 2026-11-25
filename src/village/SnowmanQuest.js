// SnowmanQuest.js — Build a Snowman (Build a Snowman v1,
// `sq-build-snowman-v1`).
//
// A FREE snow pile sits in Shepherd Park. Take a snowball, walk to
// the snowman spot nearby, and add it. 15 counted snowballs build
// the snowman — he grows in stages as more balls land (base, then
// middle, then head, then face at 12+). When the 15th lands, a
// snowman stands in the park and the quest is done for the venue
// until a server restart wipes the in-memory state.
//
// The state is SHARED: everyone in the room sees the same snowman,
// the same count (server/socket.js `snow_add` / `get_snowman`,
// in-memory per room like the group puzzle and the lights — a
// server restart wipes it, exactly like Trim the Tree before
// `sq-tree-persist-v1`).
//
// MULTI-HANG FROM THE START: every add counts toward the 15, no
// per-person cap — the same user decision as the lights/tree
// (`sq-christmas-multi-v1.2`): there are not 15 users yet to finish
// a room the old way. The tracker shows X/15 and the add toast
// states the count plainly; there is nothing left to hide.
//
// One round per venue: when the snowman stands, the quest is done
// here (unlike the tree, there is no second round — the snowman
// stays up as decor until a server restart wipes the in-memory
// state).
//
// Reward: a badge (wired into the existing badges system, one
// badge per completed quest, once ever) + 5 coins per counted
// add, paid client-side as adds land (see _payForCountedAdds —
// the paid count is tracked per profile in localStorage, so an
// add pays exactly once, including across a refresh).
//
// Owned by VillageScene: constructed in create(), ticked in
// update(), destroyed in shutdown(), refreshed on floor switches.
// Shepherd Park only (roomId === 'shepherd-park'); every other
// room is a no-op. Trim the Tree, the lights, the puzzle, the
// boards and the shop are NOT touched by this quest.

import { DEPTH } from './depth.js';
import {
  SNOW_MARKER_V1,
  SNOW_TOTAL,
  SNOW_REWARD_COINS,
  SNOW_PILE_TAKE_RANGE,
  SNOW_ADD_RANGE,
  SNOWMAN_POS,
  SNOW_PILE_POS,
  createSnowState,
  snowProgress,
  snowStage,
  addSnowball,
  serializeSnowState,
  parseSnowState,
  loadPaidSnowCounts,
  savePaidSnowCounts,
  owedSnowAdds,
} from './snowState.js';

const SHEPHERD_PARK_ROOM_ID = 'shepherd-park';
const RESPAWN_CHECK_MS = 1000; // how often update() re-checks the pile/snowman

// BUILDER DECISION — pile + snowman spots in Shepherd Park (see
// snowState.js for the layout data they were picked from):
//   pile — (1300, 2000): a ~224px walk from the snowman.
//   snowman — (1100, 2100): south of the pond and every patrol
//     path, clear of the spawn, entry, notice board, and mailbox.
// The pile and the snowman are NOT solid (same as the lights box
// and strands): players walk up to them freely.
// Click half-extents for the pile's tap zone — the same 48x40 box
// the lights box uses (see ChristmasLightsQuest.boxTapAt), so a
// click on the pile counts.
const PILE_TAP_HALF_X = 48;
const PILE_TAP_HALF_Y = 40;
// The snowman is a tall figure (base to head ~100px), so his tap
// zone is a tall box around him, not a 48x40 square — a click on
// his head or middle counts, not just his base.
const SNOWMAN_TAP_HALF_X = 70;
const SNOWMAN_TAP_TOP = 120; // px above the ground point
const SNOWMAN_TAP_BOTTOM = 20; // px below the ground point

// Per-profile paid-snowball counts (mirrors lights v1.2,
// `sq-christmas-multi-v1.2`): coins pay +5 per COUNTED add, as
// adds land — not once on completion. The guard is a per-profile
// count of adds already paid for, in localStorage under
// 'sidequest-snow-paid-counts' ({ owner -> number }). The guard is
// written BEFORE the async wallet call, so a double broadcast can
// never pay twice; a refresh/reconnect re-reads the state and pays
// only the difference. A server restart wipes the in-memory room
// state, so hungBy restarts at 0 — the diff helper treats a lower
// counted total than the stored paid count as a fresh epoch (see
// owedSnowAdds). Same profile scoping as QuestManager /
// ChristmasLightsQuest. (Guests share the 'shared' owner —
// pre-existing, same as the lights.)
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

export class SnowmanQuest {
  constructor(scene) {
    this.scene = scene;
    // sq-build-snowman-v1 — marker for the v1 landing check.
    this.marker = SNOW_MARKER_V1;
    this.state = createSnowState();
    this.carrying = false; // I am holding a snowball from the pile
    this._carryText = null; // carried-snowball marker above my head
    this.iCounted = false; // my first snowball counted toward the 15
    this._snowmanContainer = null;
    this._pileContainer = null;
    this._pendingAdd = false; // my add is awaiting server confirm
    this._lastCheckMs = 0;
  }

  get enabled() {
    return this.scene?.roomId === SHEPHERD_PARK_ROOM_ID;
  }

  _myUserId() {
    return this.scene?.userId || this.scene?.socket?.id || '__local__';
  }

  /** Room progress for the tracker: { counted, total, completed }. */
  getProgress() {
    if (!this.enabled) return null;
    return snowProgress(this.state);
  }

  /** (Re)build the pile + snowman in Shepherd Park; clear elsewhere. */
  refresh() {
    this._clearEntities();
    if (!this.enabled) return;
    this._drawAll();
    this._requestState();
  }

  _requestState() {
    try {
      if (this.scene?.socket?.connected) {
        this.scene.socket.emit('get_snowman', { roomId: this.scene.roomId });
      }
    } catch {}
  }

  /** Apply the server's canonical state (or a local fallback). */
  applyState(payload = {}) {
    const prev = this.state;
    const next = parseSnowState(payload);
    // My add, confirmed: I am a contributor now — every add
    // counts, so any confirmed pending add means I counted. The
    // pending flag clears either way.
    if (this._pendingAdd) {
      if (next.contributors.includes(this._myUserId())) {
        this.iCounted = true;
      }
      this._pendingAdd = false;
      // The add toast carries the real count, from the
      // server-confirmed state — so the player can see the snowman
      // growing instead of wondering what one snowball means.
      // (When this add finished the snowman, the completion toast
      // below is the feedback instead, so no count toast here.)
      if (!next.completed) {
        try { this.scene?.onSystemNotice?.(`⛄ You added a snowball! (${next.counted} of ${SNOW_TOTAL})`); } catch {}
      }
    }
    // Per-add payment (mirrors lights v1.2): pay for any of my
    // counted adds not yet paid for — this also heals a missed
    // broadcast after a refresh/reconnect.
    this._payForCountedAdds(next);
    // The snowman just stood up: badge contributors, once.
    if (next.completed && !prev.completed) {
      this._onSnowmanCompleted(next);
    }
    this.state = next;
    this._drawAll();
    this._bumpHud();
  }

  /**
   * Pay +5 coins per counted add of mine not yet paid for (mirrors
   * lights v1.2). Reads my total adds from the room state
   * (hungBy[me]), diffs against the per-profile paid count in
   * localStorage, and pays only the difference — a duplicate
   * broadcast pays nothing, and a refresh/reconnect pays exactly
   * the adds that landed while I was away. The paid count is
   * written BEFORE the async wallet call, so a crash mid-payment
   * cannot double-pay either. Silent per add: the coins just land
   * in the wallet (the add toast already shows the count).
   */
  _payForCountedAdds(state) {
    try {
      const counted = Number(state?.hungBy?.[this._myUserId()]) || 0;
      if (counted <= 0) return;
      const owner = currentOwner();
      const paid = loadPaidSnowCounts();
      const { owed, newPaid } = owedSnowAdds(counted, paid[owner]);
      if (owed <= 0) return;
      paid[owner] = newPaid;
      savePaidSnowCounts(paid);
      const coins = owed * SNOW_REWARD_COINS;
      try {
        import('./CoinWallet.js')
          .then((m) => m.earnCoins(coins, 'build-a-snowman'))
          .catch(() => {});
      } catch {}
    } catch {}
  }

  /** The snowman just stood up (maybe by me, maybe by the room). */
  _onSnowmanCompleted(state) {
    const banner = {
      id: 'build-a-snowman',
      emoji: '⛄',
      title: 'A Snowman Stands!',
      description: '15 snowballs added — a snowman stands in Shepherd Park!',
      rewardCoins: SNOW_REWARD_COINS,
    };
    try { this.scene?.questManager?.showQuestBannerFor?.(banner); } catch {}
    if (this.iCounted) {
      // Quest badges v1: helping build the snowman earns the Build
      // a Snowman badge, once ever. The server awards the same badge
      // to every contributor, so both paths converge. (Coins are
      // NOT paid here — they pay +5 per counted add as adds land,
      // in _payForCountedAdds.)
      try { this.scene?.questManager?.recordSnowmanCompletion?.(); } catch {}
    }
    this.scene?.questManager?.showToast?.('🎉 A snowman stands in Shepherd Park!');
  }

  _bumpHud() {
    try { this.scene?.questManager?.bumpHud?.(); } catch {}
  }

  // ---- taking + adding snowballs ------------------------------------

  /** Take a free snowball from the pile. You can only carry one
   *  at a time — and you can take another after adding one, as
   *  many times as you like: every add counts, no one-per-person
   *  limit. Refusals all SPEAK. */
  takeSnowball() {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (this.state.completed) {
      try { this.scene?.onSystemNotice?.('⛄ The snowman already stands — thank you!'); } catch {}
      return { ok: false, reason: 'all-done' };
    }
    if (this.carrying) {
      try { this.scene?.onSystemNotice?.("⛄ You're already holding a snowball — add it to the snowman first."); } catch {}
      return { ok: false, reason: 'already-carrying' };
    }
    this.carrying = true;
    this._updateCarryIndicator();
    try { this.scene?.onSystemNotice?.('⛄ You took a snowball from the pile. Add it to the snowman!'); } catch {}
    return { ok: true };
  }

  /** Add the snowball I am carrying to the snowman. */
  addSnowball() {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    if (!this.carrying) return { ok: false, reason: 'no-snowball' };
    if (this.state.completed) return { ok: false, reason: 'all-done' };
    this._pendingAdd = true;
    this.carrying = false;
    this._updateCarryIndicator();
    const socket = this.scene?.socket;
    if (socket?.connected) {
      // The server validates and broadcasts the new state to the
      // room; applyState confirms it — and toasts the count there,
      // from the server-confirmed state, instead of guessing here.
      try {
        socket.emit('snow_add', { roomId: this.scene.roomId });
      } catch {}
      return { ok: true, pending: true };
    }
    // Offline: apply locally so the quest still works solo.
    const res = addSnowball(this.state, this._myUserId());
    if (!res.ok) return res;
    if (res.counted) this.iCounted = true;
    // Pay for this add now, from the local state the add just updated.
    this._payForCountedAdds(this.state);
    // Same count toast as the online path, from the local state the
    // add just updated. (When this add finished the snowman, the
    // completion toast in _onSnowmanCompleted below is the feedback
    // instead.)
    this._afterLocalChange(res.finished ? null : `⛄ You added a snowball! (${this.state.counted} of ${SNOW_TOTAL})`);
    if (res.finished) this._onSnowmanCompleted(this.state);
    return { ok: true, counted: res.counted };
  }

  _afterLocalChange(notice) {
    this._drawAll();
    this._bumpHud();
    if (notice) {
      try { this.scene?.onSystemNotice?.(notice); } catch {}
    }
  }

  /** One click at world (wx, wy): on the snow pile, take a
   *  snowball (if standing close enough). Silent unless it takes
   *  — clicks elsewhere do nothing. Returns { ok, took? }. */
  pileTapAt(wx, wy) {
    if (!this.enabled || this.state.completed) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    if (Math.abs(wx - SNOW_PILE_POS.x) > PILE_TAP_HALF_X || Math.abs(wy - SNOW_PILE_POS.y) > PILE_TAP_HALF_Y) {
      return { ok: false, reason: 'no-spot' };
    }
    if (Math.hypot(player.gx - SNOW_PILE_POS.x, player.gy - SNOW_PILE_POS.y) > SNOW_PILE_TAKE_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    const res = this.takeSnowball();
    return { ...res, took: res.ok };
  }

  /** One click at world (wx, wy): on the snowman, add the
   *  snowball I am carrying (if standing close enough). Silent
   *  unless it adds — clicks on a finished snowman, or with empty
   *  hands, do nothing. Returns { ok, added? }. */
  addTapAt(wx, wy) {
    if (!this.enabled || this.state.completed) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    if (
      Math.abs(wx - SNOWMAN_POS.x) > SNOWMAN_TAP_HALF_X
      || wy < SNOWMAN_POS.y - SNOWMAN_TAP_TOP
      || wy > SNOWMAN_POS.y + SNOWMAN_TAP_BOTTOM
    ) {
      return { ok: false, reason: 'no-spot' };
    }
    if (Math.hypot(player.gx - SNOWMAN_POS.x, player.gy - SNOWMAN_POS.y) > SNOW_ADD_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    const res = this.addSnowball();
    return { ...res, added: res.ok };
  }

  /** The snow pile within take range of (px, py) — or null (E key). */
  nearestPile(px, py) {
    if (!this.enabled || this.state.completed) return null;
    return Math.hypot(px - SNOW_PILE_POS.x, py - SNOW_PILE_POS.y) <= SNOW_PILE_TAKE_RANGE
      ? { x: SNOW_PILE_POS.x, y: SNOW_PILE_POS.y }
      : null;
  }

  /** The snowman within add range of (px, py) — or null (E key). */
  nearestSnowman(px, py) {
    if (!this.enabled || this.state.completed) return null;
    return Math.hypot(px - SNOWMAN_POS.x, py - SNOWMAN_POS.y) <= SNOW_ADD_RANGE
      ? { x: SNOWMAN_POS.x, y: SNOWMAN_POS.y }
      : null;
  }

  // ---- drawing ----------------------------------------------------------

  _drawAll() {
    this._clearEntities();
    if (!this.enabled) return;
    this._drawPile();
    this._drawSnowman();
  }

  _drawPile() {
    const scene = this.scene;
    const { x, y } = SNOW_PILE_POS;
    const g = scene.add.graphics();
    // A mound of snow: three overlapping white balls, with a couple
    // of loose snowballs on top, and a soft blue outline so it reads
    // on the grass.
    g.lineStyle(1.5, 0x7dd3fc, 1);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(-26, 0, 16);
    g.fillCircle(0, -6, 20);
    g.fillCircle(26, 0, 16);
    g.fillCircle(-10, -22, 9);
    g.fillCircle(12, -20, 8);
    g.strokeCircle(-26, 0, 16);
    g.strokeCircle(0, -6, 20);
    g.strokeCircle(26, 0, 16);
    const label = scene.add.text(
      0, -48,
      '⛄ Snow Pile · FREE',
      { fontSize: '12px', color: '#1a4971', backgroundColor: 'rgba(255,255,255,0.92)', padding: { x: 6, y: 3 } },
    );
    label.setOrigin(0.5, 0.5);
    const container = scene.add.container(x, y, [g, label]);
    container.setDepth(DEPTH.ACTOR_MIN + Math.round(y));
    container.setSize(110, 90);
    this._pileContainer = container;
  }

  /** The growing snowman. Stage 0 (0 counted) is just a flat snow
   *  patch where he will stand, so the spot reads as "snowman goes
   *  here" before the first ball lands. Stage 1: the base ball.
   *  Stage 2: + middle ball. Stage 3: + head. Stage 4 (12+): +
   *  face (coal eyes, carrot nose), a red scarf, and stick arms.
   *  The look reuses the shop snowman decoration (DecorSystem.js):
   *  white balls, coal eyes, carrot nose — bigger here, since this
   *  one is the quest's centrepiece, not a pocket decoration. */
  _drawSnowman() {
    const scene = this.scene;
    const state = this.state;
    const stage = snowStage(state.counted);
    const { x, y } = SNOWMAN_POS;
    const g = scene.add.graphics();
    if (stage === 0) {
      // A flat snow patch, so the spot is visible before the first ball.
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(0, 0, 30);
      g.fillStyle(0xdbeafe, 1);
      g.fillCircle(-8, -2, 6);
      g.fillCircle(10, 2, 5);
    } else {
      // Base ball (stage 1+), middle ball (stage 2+), head (stage 3+).
      g.lineStyle(1.5, 0x7dd3fc, 1);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(0, -26, 30);
      g.strokeCircle(0, -26, 30);
      if (stage >= 2) {
        g.fillCircle(0, -68, 21);
        g.strokeCircle(0, -68, 21);
      }
      if (stage >= 3) {
        g.fillCircle(0, -100, 14);
        g.strokeCircle(0, -100, 14);
      }
      if (stage >= 4) {
        // Face: coal eyes + carrot nose, on the head.
        g.fillStyle(0x1f2937, 1);
        g.fillCircle(-5, -102, 1.5);
        g.fillCircle(5, -102, 1.5);
        g.fillStyle(0xea580c, 1);
        g.beginPath();
        g.moveTo(-2, -98);
        g.lineTo(12, -96);
        g.lineTo(-2, -94);
        g.closePath();
        g.fillPath();
        // Red scarf: a band under the head + a tail down the side.
        g.fillStyle(0xdc2626, 1);
        g.fillRect(-15, -88, 30, 7);
        g.fillRect(8, -82, 7, 22);
        // Stick arms, out from the middle ball.
        g.lineStyle(2, 0x6b4226, 1);
        g.lineBetween(-20, -66, -38, -80);
        g.lineBetween(20, -66, 38, -80);
      }
    }
    const label = scene.add.text(
      0, -128,
      state.completed
        ? '⛄ A snowman stands in Shepherd Park! 🎉'
        : `⛄ Build a Snowman — ${state.counted}/${SNOW_TOTAL}`,
      { fontSize: '12px', color: '#1a4971', backgroundColor: 'rgba(255,255,255,0.92)', padding: { x: 6, y: 3 } },
    );
    label.setOrigin(0.5, 0.5);
    // The snowman sits ON the grass: depth ACTOR_MIN puts him above
    // the floor (RoomLayout draws at GROUND + 1) and below every
    // player (ACTOR_MIN + y), so nobody walks in front of him and
    // gets covered by him.
    const container = scene.add.container(x, y, [g, label]);
    container.setDepth(DEPTH.ACTOR_MIN);
    this._snowmanContainer = container;
  }

  /** Carried-snowball marker: while I am carrying a snowball, a ⛄
   *  rides above my head so the state is visible — same pattern as
   *  the tree's 🎄 marker and the lights' 💡 marker: a scene-level
   *  text repositioned every frame. Offset to the side so it never
   *  covers my name. */
  _updateCarryIndicator() {
    try {
      const player = this.scene?.player;
      const show = Boolean(this.carrying && this.enabled && player);
      if (!show) {
        this._carryText?.setAlpha(0);
        return;
      }
      if (!this._carryText) {
        this._carryText = this.scene.add.text(0, 0, '⛄', { fontSize: '20px' });
        this._carryText.setOrigin(0.5, 1);
        this._carryText.setDepth(DEPTH.ACTOR_MIN + 500);
      }
      this._carryText.setPosition(player.gx + 22, player.gy - 56).setAlpha(1);
    } catch {}
  }

  update() {
    // Keep the carried-snowball marker on my head every frame.
    this._updateCarryIndicator();
    if (!this.enabled) return;
    const now = Date.now();
    if (now - (this._lastCheckMs || 0) < RESPAWN_CHECK_MS) return;
    this._lastCheckMs = now;
    // The pile + snowman re-spawn if a floor switch cleared them.
    if (!this._pileContainer || !this._snowmanContainer) this._drawAll();
  }

  _clearEntities() {
    try { this._pileContainer?.destroy(); } catch {}
    this._pileContainer = null;
    try { this._snowmanContainer?.destroy(); } catch {}
    this._snowmanContainer = null;
  }

  destroy() {
    this._clearEntities();
    try { this._carryText?.destroy(); } catch {}
    this._carryText = null;
    this.scene = null;
  }
}
