// SantasPresentSystem.js — Santa's Lost Present (Santa's Lost
// Present v1, `sq-santas-lost-present-v1`).
//
// Owned by VillageScene, same shape as SantaHatSystem /
// SnowmanQuest: constructed in create(), ticked in update(),
// destroyed in shutdown(), refreshed on floor switches. Agora only.
//
// The loop: ONE present hides at the foot of tree 2 in Agora, one
// find per player per Chicago day. Find it by clicking at the
// hiding spot 3 times (hidden-search, hat/puzzle pattern —
// scene-level pointerdown + distance checks, never per-object
// pointerdown), it is revealed (a 🎁 at the spot, briefly) + a
// toast + 5 coins + the badge, once ever. It re-hides for you the
// next Chicago day: the server tracks each player's last-found
// date, and a second find the same day is refused with a notice.
//
// Server state is canonical (server/socket.js `present_find` /
// `get_present`, in-memory per room like the hat): the find goes
// to the server, and the `present_state` broadcast confirms it.
// A pending find times out after 5s with a retry notice (the
// decor v1.1 pattern — never wait forever). A restart wipes the
// daily-found dates back to none — a player could re-find it that
// day — but the badge stays (the badge system persists it).
//
// Coins pay client-side, +5 per find, guarded by the last-paid
// Chicago date in localStorage (presentState.js — the lights v1.2
// pattern): a duplicate broadcast pays nothing, and a
// refresh/reconnect pays only a find whose date is still unpaid.
// The badge is recorded once ever, both paths converging:
// the server awards it in the present_find handler, and this
// system records it locally via QuestManager
// (recordSantasPresentCompletion) on the confirmed find.

import { DEPTH } from './depth.js';
import {
  PRESENT_ID,
  PRESENT_MARKER_V1,
  PRESENT_REWARD_COINS,
  PRESENT_SEARCH_CLICKS,
  PRESENT_SEARCH_RANGE,
  PRESENT_HIDE_RADIUS,
  PRESENT_HIDE_SPOT,
  PRESENT_PENDING_TIMEOUT_MS,
  createPresentState,
  chicagoDateString,
  foundToday,
  serializePresentState,
  parsePresentState,
  loadPaidPresentDates,
  savePaidPresentDates,
  owedPresentFind,
} from './presentState.js';

const AGORA_ROOM_ID = 'agora-houston';
const REVEAL_MS = 6000; // how long the found 🎁 stays visible at the spot

// Per-profile paid-present dates (mirrors lights v1.2,
// `sq-christmas-multi-v1.2`): coins pay +5 per find, as finds
// land — not once on completion. The guard is a per-profile last
// paid Chicago date, in localStorage under
// 'sidequest-present-paid-dates' ({ owner -> 'YYYY-MM-DD' }). The
// guard is written BEFORE the async wallet call, so a double
// broadcast can never pay twice; a refresh/reconnect re-reads the
// state and pays only a find whose date is still unpaid. Same
// profile scoping as QuestManager / SantaHatSystem. (Guests share
// the 'shared' owner — pre-existing, same as the lights.)
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

export class SantasPresentSystem {
  constructor(scene) {
    this.scene = scene;
    // sq-santas-lost-present-v1 — marker for the v1 landing check.
    this.marker = PRESENT_MARKER_V1;
    this.questId = PRESENT_ID;
    this.state = createPresentState();
    this._searchTaps = 0; // taps at the hiding spot this room visit
    this._pendingFind = false; // my find is awaiting server confirm
    this._findTimer = null;
    this._stateLoaded = false; // first present_state adopted silently
    this._revealText = null; // the found 🎁 shown at the spot, briefly
    this._revealUntil = 0;
    this._lastCheckMs = 0;
  }

  get enabled() {
    return this.scene?.roomId === AGORA_ROOM_ID;
  }

  _myUserId() {
    return this.scene?.userId || this.scene?.socket?.id || '__local__';
  }

  /** Today, Chicago time — the day the daily rule runs on. */
  _today() {
    return chicagoDateString(new Date());
  }

  /** Have I already found the present today? */
  _iFoundToday() {
    return foundToday(this.state, this._myUserId(), this._today());
  }

  /** Room progress for the tracker: { foundToday, date } — null
   *  outside Agora, so the line only shows in the room. */
  getProgress() {
    if (!this.enabled) return null;
    return { foundToday: this._iFoundToday(), date: this._today() };
  }

  /** (Re)build the present for this room; clear elsewhere. */
  refresh() {
    this._clearEntities();
    this._searchTaps = 0;
    this._stateLoaded = false;
    if (!this.enabled) return;
    this._requestState();
  }

  _requestState() {
    try {
      if (this.scene?.socket?.connected) {
        this.scene.socket.emit('get_present', { roomId: this.scene.roomId });
      }
    } catch {}
  }

  _clearFindTimer() {
    if (this._findTimer) { clearTimeout(this._findTimer); this._findTimer = null; }
  }

  /** Apply the server's canonical state. My own find is confirmed
   *  only by the pending flag (set when I emit present_find): the
   *  broadcast then pays +5 (date-keyed guard), records the badge
   *  once ever, and shows the banner + toast + reveal. A re-join
   *  load that already says I found it today adopts silently — no
   *  second toast, no second payment (the date guard would refuse
   *  it anyway). A NEW finder who is not me gets a "someone found
   *  it" toast + the reveal — but never on the first load, so
   *  walking into a room where someone found it earlier does not
   *  announce stale news. */
  applyState(payload = {}) {
    const prev = this.state;
    const next = parsePresentState(payload);
    const today = this._today();
    const me = String(this._myUserId());
    const wasFirstLoad = !this._stateLoaded;
    this._stateLoaded = true;
    const prevFoundByMe = foundToday(prev, me, today);
    const nextFoundByMe = foundToday(next, me, today);
    // A new finder today who was not in the previous state.
    const prevToday = new Set(
      Object.entries(prev.foundBy || {})
        .filter(([, d]) => d === today)
        .map(([u]) => u),
    );
    const newFinders = Object.entries(next.foundBy || {})
      .filter(([u, d]) => d === today && !prevToday.has(u))
      .map(([u]) => u);
    this.state = next;

    if (this._pendingFind && nextFoundByMe) {
      // My find, confirmed by the server.
      this._pendingFind = false;
      this._clearFindTimer();
      this._searchTaps = 0;
      this._onMyFindConfirmed(today);
    } else if (this._pendingFind && !nextFoundByMe) {
      // The broadcast does not have my find yet — keep waiting for
      // the confirm (or the 5s timeout). The taps stay counted.
    }
    if (!wasFirstLoad) {
      for (const finder of newFinders) {
        if (finder === me) continue; // my own find is toasted above
        try { this.scene?.onSystemNotice?.('🎁 Someone found Santa\'s lost present!'); } catch {}
        this._showReveal();
      }
    }
    this._bumpHud();
  }

  /** The server refused my find (the backstop for a race the
   *  client did not see — e.g. a second device found it first).
   *  The client usually refuses locally before emitting, so this
   *  is the rare path. */
  onFindResult(payload = {}) {
    if (!payload || payload.ok) return;
    if (!this._pendingFind) return;
    this._pendingFind = false;
    this._clearFindTimer();
    if (payload.reason === 'already-found-today') {
      this._searchTaps = 0;
      try { this.scene?.onSystemNotice?.('🎁 You already found Santa\'s present today — it hides again tomorrow!'); } catch {}
    }
  }

  /** My find, confirmed: reveal + banner + toast + coins + badge.
   *  Coins pay +5 per find, guarded by the last-paid Chicago date
   *  (written BEFORE the async wallet call, lights pattern) — a
   *  duplicate broadcast pays nothing. */
  _onMyFindConfirmed(today) {
    this._showReveal();
    const banner = {
      id: PRESENT_ID,
      emoji: '🎁',
      title: 'Santa\'s Lost Present!',
      description: 'You found Santa\'s lost present! It hides again tomorrow.',
      rewardCoins: PRESENT_REWARD_COINS,
    };
    try { this.scene?.questManager?.showQuestBannerFor?.(banner); } catch {}
    // Badge once ever (local record; the server awards the same
    // badge in the present_find handler, so both paths converge).
    try { this.scene?.questManager?.recordSantasPresentCompletion?.(); } catch {}
    const paid = loadPaidPresentDates();
    const owner = currentOwner();
    const { owed, newPaid } = owedPresentFind(today, paid[owner]);
    if (owed > 0) {
      paid[owner] = newPaid;
      savePaidPresentDates(paid);
      try {
        import('./CoinWallet.js')
          .then((m) => m.earnCoins(PRESENT_REWARD_COINS, 'santas-lost-present'))
          .catch(() => {});
      } catch {}
      try { this.scene?.onSystemNotice?.(`🎁 You found Santa's lost present! +${PRESENT_REWARD_COINS} coins.`); } catch {}
    } else {
      try { this.scene?.onSystemNotice?.('🎁 You found Santa\'s lost present!'); } catch {}
    }
  }

  /** A pending find got no present_state confirm in time. The
   *  taps stay counted — one more click retries the find. */
  _onFindTimeout() {
    this._findTimer = null;
    if (!this._pendingFind) return;
    this._pendingFind = false;
    this._requestState();
    try { this.scene?.onSystemNotice?.('🎁 The room didn\'t answer — tap the spot again.'); } catch {}
  }

  // ---- finding (3 clicks at the hiding spot) ---------------------------

  /** One search tap: the player clicked at world (wx, wy). Same
   *  contract as SantaHatSystem.searchTapAt: silent unless it finds
   *  something (no counter, no hint about where the present hides).
   *  After PRESENT_SEARCH_CLICKS taps at the spot, the find goes
   *  to the server — the server decides whether it is really today
   *  (one find per player per Chicago day). Taps still count when
   *  already found today, so a player deliberately searching again
   *  hears the refusal once on the 3rd tap — not spammed on every
   *  click at the foot of tree 2 (which also hangs ornaments).
   *  Offline, the find refuses — a shared daily find cannot be
   *  confirmed without the server (no local fallback: an offline
   *  find would be a phantom).
   *  Returns { ok, tapped?, finding?, reason? }. */
  searchTapAt(wx, wy) {
    if (!this.enabled) return { ok: false, reason: 'not-available' };
    const player = this.scene?.player;
    if (!player) return { ok: false, reason: 'no-player' };
    if (Math.hypot(wx - PRESENT_HIDE_SPOT.x, wy - PRESENT_HIDE_SPOT.y) > PRESENT_HIDE_RADIUS) {
      return { ok: false, reason: 'no-spot' };
    }
    if (Math.hypot(player.gx - PRESENT_HIDE_SPOT.x, player.gy - PRESENT_HIDE_SPOT.y) > PRESENT_SEARCH_RANGE) {
      return { ok: false, reason: 'too-far' };
    }
    const taps = this._searchTaps + 1;
    if (taps < PRESENT_SEARCH_CLICKS) {
      this._searchTaps = taps;
      return { ok: true, tapped: true, remaining: PRESENT_SEARCH_CLICKS - taps };
    }
    // Enough taps: if I already found it today, refuse with the
    // notice (and reset the taps, so the next search starts fresh).
    if (this._iFoundToday()) {
      this._searchTaps = 0;
      return { ok: false, reason: 'already-found-today' };
    }
    if (!this.scene?.socket?.connected) return { ok: false, reason: 'offline' };
    if (this.scene?.isRoomJoined?.() === false) return { ok: false, reason: 'not-joined' };
    if (this._pendingFind) return { ok: true, finding: true };
    this._clearFindTimer();
    this._pendingFind = true;
    this._findTimer = setTimeout(() => this._onFindTimeout(), PRESENT_PENDING_TIMEOUT_MS);
    try {
      this.scene.socket.emit('present_find', { roomId: this.scene.roomId });
    } catch {
      this._clearFindTimer();
      this._pendingFind = false;
      return { ok: false, reason: 'error' };
    }
    // Taps stay counted until the present_state broadcast confirms
    // the find — one more click retries.
    this._searchTaps = PRESENT_SEARCH_CLICKS;
    return { ok: true, finding: true };
  }

  _bumpHud() {
    try { this.scene?.questManager?.bumpHud?.(); } catch {}
  }

  // ---- drawing ----------------------------------------------------------

  /** Show the found 🎁 at the hiding spot, briefly. */
  _showReveal() {
    try {
      if (!this._revealText) {
        this._revealText = this.scene.add.text(
          PRESENT_HIDE_SPOT.x, PRESENT_HIDE_SPOT.y - 10, '🎁',
          { fontSize: '28px' },
        );
        this._revealText.setOrigin(0.5, 0.5);
        this._revealText.setDepth(DEPTH.ACTOR_MIN + Math.round(PRESENT_HIDE_SPOT.y));
      }
      this._revealText.setAlpha(1);
      this._revealUntil = Date.now() + REVEAL_MS;
    } catch {}
  }

  update() {
    if (!this.enabled) return;
    if (this._revealText && this._revealUntil > 0 && Date.now() >= this._revealUntil) {
      try { this._revealText.setAlpha(0); } catch {}
      this._revealUntil = 0;
    }
  }

  _clearEntities() {
    try { this._revealText?.destroy(); } catch {}
    this._revealText = null;
    this._revealUntil = 0;
  }

  destroy() {
    this._clearFindTimer();
    this._clearEntities();
    this._searchTaps = 0;
    this._pendingFind = false;
    this._stateLoaded = false;
    this.scene = null;
  }
}
