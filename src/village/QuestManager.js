// QuestManager.js — the Side Quest quest loop (Quest Wrapper v1).
//
// Give / track / complete / reward, in the same shape as DuckPond /
// CafeCat: a self-contained class owned by VillageScene (constructed
// in create(), ticked in update(), destroyed in shutdown(), refreshed
// on floor switches).
//
// What v1 does:
//   - Auto-starts the quest that belongs to the room you are in
//     (first quest in quests.js whose roomId matches this room and
//     which you have not finished yet).
//   - Tracks progress as events arrive (recordEvent('duck-fed') is
//     called by VillageScene when you pet a ROAMING duck — pond ducks
//     and pond feeding don't count toward the 3).
//   - Shows a tracker in the top-left of the screen (quest title +
//     your progress + the room's shared feed total) and a completion
//     toast (+ coins) when you finish.
//   - Shows a quest banner at the top-centre of the screen when a
//     quest first starts (emoji + title, description, reward), which
//     fades after ~5.5s or on click/tap. Once per session per quest:
//     it never shows for a quest you already finished, and it does
//     not pop up again if you leave and re-enter mid-quest.
//   - Syncs with the server (quest_progress / quest_state /
//     quest_completed in server/socket.js, same membership-checked,
//     rate-limited pattern as pet_cat): the server keeps a per-room
//     shared counter and per-player progress, so the room total is
//     real and your progress survives a reload. Coins are still the
//     local CoinWallet (localStorage, per profile) — persistent
//     server-side rewards are v2.
//
// What v1 does NOT do: onboarding, group shared-progress quests,
// or a quest list UI beyond the tracker. Those are v2.
//
// Quest batch v1.1 (2026-11-15): 6 more quests on the same loop —
// Cat Cuddles (Agora), Say Hello to the Bartender + Barfly (Lola's
// Depot), The Golden Key (hidden object, Agora), plus two ANYWHERE
// quests (roomId '*') that run alongside the room quest in every
// room: Wanderer (visit 3 places) and The Bartender's Errand (a
// 3-step chain: bartender → feed ducks → pet cat, in order). A room
// can hold several quests in sequence: refresh() picks the first
// unfinished one, and finishing it activates the next.

import { DEPTH } from './depth.js';
import { QUESTS, getQuest } from './quests.js';

const QUESTS_PREFIX = 'location-chat-quests';

// How long the quest banner stays up before fading (ms). It also
// goes away early if the player clicks / taps it.
const QUEST_BANNER_MS = 5500;

// Who owns this quest progress? Same per-profile scoping as
// CoinWallet: the profile email (guests get their own guest email),
// so two people on one browser don't share a quest log.
function currentOwner() {
  try {
    const raw = localStorage.getItem('sidequest_profile');
    if (!raw) return 'shared';
    const p = JSON.parse(raw);
    const id = p?.email || p?.profile?.email || p?.id || p?.profile?.id || p?.userId || p?.profile?.userId;
    const clean = String(id || '').trim().toLowerCase();
    return clean || 'shared';
  } catch {
    return 'shared';
  }
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(`${QUESTS_PREFIX}:${currentOwner()}`);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSaved(saved) {
  try {
    localStorage.setItem(`${QUESTS_PREFIX}:${currentOwner()}`, JSON.stringify(saved));
  } catch {}
}

export class QuestManager {
  constructor(scene) {
    this.scene = scene;
    this.saved = loadSaved(); // { [questId]: { count, completed } }
    this.activeQuest = null;
    this.sharedCount = 0; // room-wide total for the active quest (server)
    this.tracker = null; // Phaser text, pinned top-left of the screen
    this.toast = null; // Phaser text, centered completion toast
    this._toastTimer = null;
    this.banner = null; // Phaser text, top-centre quest banner
    this._bannerTimer = null;
    this._bannerQuestId = null; // quest id the live banner (if any) is for
    this._shownBanners = new Set(); // quest ids the banner already showed for, this session
  }

  /** Anywhere quests (roomId '*') you have not finished yet. */
  anywhereQuests() {
    return QUESTS.filter((q) => q.roomId === '*' && !this.saved[q.id]?.completed);
  }

  /**
   * A room entry counts toward the Wanderer quest. Called by VillageScene
   * AFTER refresh() (not from inside it — completing Wanderer here calls
   * refresh() again, and re-entering refresh mid-refresh would eat the
   * completion toast). Distinct rooms only: re-entering the same room
   * never counts (see recordDistinct).
   */
  noteRoomVisit() {
    const roomId = this.scene?.roomId;
    if (!roomId || roomId === '*') return;
    this.recordDistinct('room-visited', roomId, 'rooms');
  }

  /**
   * Count a DISTINCT value toward quests (different beers for Barfly,
   * different rooms for Wanderer). Repeats don't count: the seen values
   * live on the quest's saved entry under `key`, so progress survives
   * a reload. Checks the active room quest and every open anywhere
   * quest — whichever one listens for this event.
   */
  recordDistinct(eventName, value, key) {
    if (value == null || value === '') return;
    const quests = [this.activeQuest, ...this.anywhereQuests()].filter(Boolean);
    for (const quest of quests) {
      if (quest.event !== eventName) continue;
      const entry = this.saved[quest.id] || { count: 0, completed: false };
      if (entry.completed) continue;
      const list = Array.isArray(entry[key]) ? entry[key] : [];
      if (list.includes(value)) continue;
      list.push(value);
      entry[key] = list;
      entry.count = Math.min(list.length, quest.target);
      this.saved[quest.id] = entry;
      saveSaved(this.saved);
      this._drawTracker();
      try {
        this.scene.socket?.emit('quest_progress', { roomId: this.scene.roomId, questId: quest.id });
      } catch {}
      if (entry.count >= quest.target) this._completeQuest(quest);
    }
  }

  /** (Re)pick the quest for this room and (re)draw the tracker. */
  refresh() {
    // If a banner is live when we redraw, remember which quest it was
    // for. refresh() is also called from _completeQuest — e.g. when the
    // Wanderer completes on room entry (noteRoomVisit runs right after
    // this refresh in create), or when the server reports an anywhere
    // quest finished just after entry — and _clearTexts() destroys that
    // banner. Without the re-show below, _shownBanners would refuse to
    // show it again and the player would never see the room quest's
    // banner at all (the tracker survives, so it looks like the quest
    // is tracked but never announced).
    const liveBannerQuestId = this._bannerQuestId;
    this._clearTexts();
    const roomId = this.scene?.roomId;
    this.activeQuest = QUESTS.find(
      (q) => q.roomId === roomId && !this.saved[q.id]?.completed,
    ) || null;
    this.sharedCount = 0;
    // No room quest here? The tracker still shows if an anywhere quest
    // (Wanderer / Coin Collector / Room Full of Friends) is still open.
    if (!this.activeQuest && this.anywhereQuests().length === 0) return;
    try {
      const scene = this.scene;
      this.tracker = scene.add.text(16, 16, '', {
        fontSize: '15px',
        color: '#1a4971',
        backgroundColor: 'rgba(255,255,255,0.88)',
        padding: { x: 10, y: 8 },
      });
      this.tracker.setScrollFactor(0);
      this.tracker.setDepth(DEPTH.UI);
      this._drawTracker();
      if (this.activeQuest) {
        // The banner we just destroyed was for this same quest and the
        // player never got to see it — let it show again. (If it was
        // already dismissed by timer/tap, _bannerQuestId is null and
        // the once-per-session rule stands.)
        if (liveBannerQuestId && liveBannerQuestId === this.activeQuest.id) {
          this._shownBanners.delete(liveBannerQuestId);
        }
        this._showQuestBanner(this.activeQuest);
      }
    } catch {}
  }

  /** Your progress on the active quest (0..target). */
  get progress() {
    if (!this.activeQuest) return 0;
    return Math.min(
      Number(this.saved[this.activeQuest.id]?.count || 0),
      this.activeQuest.target,
    );
  }

  /** One quest event happened for the ROOM quest (e.g. you fed a duck). */
  recordEvent(eventName) {
    const quest = this.activeQuest;
    if (quest && quest.event === eventName) this._increment(quest);
    // The same action can also be a step of an anywhere quest (the
    // Bartender's Errand advances on bartender-talk / ducks-fed /
    // cat-pet), so anywhere quests always get a look too.
    this.recordGlobalEvent(eventName);
  }

  /**
   * One quest event happened for the ANYWHERE quests (roomId '*':
   * Wanderer, The Bartender's Errand). Unlike recordEvent, this is not
   * tied to the active room quest — every unfinished anywhere quest
   * listening for this event counts it. Chain quests only advance on
   * their NEXT step's event, in order — feeding the ducks before
   * talking to the bartender does nothing for the Errand.
   * The banner for an anywhere quest shows the first time it records
   * progress, so they stagger instead of popping at once.
   */
  recordGlobalEvent(eventName) {
    for (const quest of QUESTS) {
      if (quest.roomId !== '*') continue;
      const entry = this.saved[quest.id] || { count: 0, completed: false };
      if (entry.completed) continue;
      if (Array.isArray(quest.steps)) {
        const step = Number(entry.step || 0);
        if (quest.steps[step] !== eventName) continue;
      } else if (quest.event !== eventName) {
        continue;
      }
      const firstStep = (Number(entry.count) || 0) === 0;
      this._increment(quest);
      if (firstStep) this._showQuestBanner(quest);
    }
  }

  /** Count one event toward one quest: save, sync, complete at target. */
  _increment(quest) {
    const entry = this.saved[quest.id] || { count: 0, completed: false };
    if (entry.completed) return;
    if (Array.isArray(quest.steps)) {
      // Chain quest: one step done, in order. count IS the step index.
      entry.step = Math.min((Number(entry.step) || 0) + 1, quest.steps.length);
      entry.count = entry.step;
    } else {
      entry.count = Math.min((Number(entry.count) || 0) + 1, quest.target);
    }
    this.saved[quest.id] = entry;
    saveSaved(this.saved);
    this._drawTracker();
    // Tell the server so the room's shared counter moves too.
    try {
      this.scene.socket?.emit('quest_progress', { roomId: this.scene.roomId, questId: quest.id });
    } catch {}
    if (entry.count >= quest.target) this._completeQuest(quest);
  }

  /** Apply the server's canonical quest state (on join / on change). */
  applyServerState(payload = {}) {
    const quest = getQuest(payload.questId);
    if (!quest) return;
    // The room's shared total is always the server's number.
    if (Number.isFinite(Number(payload.shared))) {
      this.sharedCount = Number(payload.shared);
    }
    // Only the active room quest or an open anywhere quest can merge
    // server progress — a quest for another room never touches yours.
    const isMine = this.activeQuest?.id === quest.id
      || (quest.roomId === '*' && !this.saved[quest.id]?.completed);
    // Your own count: take the higher of local / server, so a server
    // restart (in-memory state) never wipes progress you already made.
    if (Number.isFinite(Number(payload.count)) && isMine) {
      const entry = this.saved[quest.id] || { count: 0, completed: false };
      const best = Math.max(Number(entry.count) || 0, Number(payload.count));
      if (best !== entry.count) {
        entry.count = Math.min(best, quest.target);
        this.saved[quest.id] = entry;
        saveSaved(this.saved);
      }
      // Chain quests: the server's count IS the step index — keep the
      // step pointer in sync with the merged count, or the next step
      // would expect the wrong event.
      if (Array.isArray(quest.steps)) {
        entry.step = Math.min(entry.count, quest.steps.length);
        this.saved[quest.id] = entry;
        saveSaved(this.saved);
      }
      if (payload.completed && !entry.completed) {
        entry.completed = true;
        this.saved[quest.id] = entry;
        saveSaved(this.saved);
        // Local save never paid for this one (payment happens in
        // _completeQuest, which sets completed) — so pay here.
        this._completeQuest(quest);
        return;
      }
    }
    this._drawTracker();
  }

  /** Another player finished a quest in this room (server broadcast). */
  onRemoteCompleted(payload = {}) {
    const quest = getQuest(payload.questId);
    if (!quest) return;
    // Your own completion already showed your toast — don't double it.
    if (payload.userId && this.scene?.userId && payload.userId === this.scene.userId) return;
    this._showToast(`🎉 Another player finished "${quest.title}"!`);
  }

  _completeQuest(quest = this.activeQuest) {
    if (!quest) return;
    const entry = this.saved[quest.id] || { count: 0, completed: false };
    entry.completed = true;
    entry.count = quest.target;
    this.saved[quest.id] = entry;
    saveSaved(this.saved);
    // Reward: coins from the local wallet (same as duck-pet coins).
    // Paid exactly once: this is the only path that sets completed
    // from false to true, and recordEvent / applyServerState both
    // bail out once completed is true.
    try {
      import('./CoinWallet.js')
        .then((m) => m.earnCoins(quest.rewardCoins, `quest-${quest.id}`))
        .catch(() => {});
    } catch {}
    const toastText = `🎉 Quest complete! ${quest.emoji} ${quest.title} — +${quest.rewardCoins} coins`;
    // The next quest for this room (if any) becomes active. Refresh
    // FIRST — it clears texts — then show the toast so it survives.
    this.refresh();
    this._showToast(toastText);
  }

  /**
   * Big top-centre banner when a quest first starts: emoji + title,
   * the one-line description, and the reward. Built generically from
   * the quest definition, so future quests get one for free.
   * Shows once per session per quest: never for a quest already
   * finished (refresh() only picks unfinished quests), and not again
   * if you leave and re-enter mid-quest. Fades after QUEST_BANNER_MS,
   * or right away on click / tap.
   */
  _showQuestBanner(quest) {
    if (!quest || this._shownBanners.has(quest.id)) return;
    this._shownBanners.add(quest.id);
    try {
      const scene = this.scene;
      const w = scene?.scale?.width || 800;
      const text = [
        `${quest.emoji} ${quest.title}`,
        quest.description,
        `Reward: +${quest.rewardCoins} coins`,
      ].join('\n');
      this.banner = scene.add.text(w / 2, 64, text, {
        fontSize: '18px',
        color: '#1a4971',
        backgroundColor: 'rgba(255,255,255,0.95)',
        padding: { x: 16, y: 12 },
        align: 'center',
        wordWrap: { width: Math.min(560, w - 40) },
      });
      this.banner.setOrigin(0.5, 0);
      this.banner.setScrollFactor(0);
      this.banner.setDepth(DEPTH.UI + 2);
      // Remember which quest this live banner is for, so refresh() can
      // tell a banner the player actually saw from one it destroyed
      // itself before the player ever saw it.
      this._bannerQuestId = quest.id;
      // Tap / click dismisses it early; it never blocks play for long.
      try {
        this.banner.setInteractive({ useHandCursor: true });
        this.banner.on('pointerdown', () => this._dismissBanner());
      } catch {}
      this._bannerTimer = scene.time.delayedCall(QUEST_BANNER_MS, () => this._dismissBanner());
    } catch {}
  }

  /** Fade the banner out and remove it (timer or tap). */
  _dismissBanner() {
    try { this._bannerTimer?.remove(); } catch {}
    this._bannerTimer = null;
    // Genuinely seen/dismissed: refresh() must NOT re-show it.
    this._bannerQuestId = null;
    if (!this.banner) return;
    const banner = this.banner;
    this.banner = null;
    try {
      this.scene.tweens.add({
        targets: banner, alpha: 0, duration: 600,
        onComplete: () => { try { banner.destroy(); } catch {} },
      });
    } catch {
      try { banner.destroy(); } catch {}
    }
  }

  _drawTracker() {
    if (!this.tracker) return;
    const lines = [];
    const quest = this.activeQuest;
    if (quest) {
      const mine = this.progress;
      lines.push(
        `${quest.emoji} ${quest.title}  ${mine}/${quest.target}`,
        quest.description,
      );
      if (this.sharedCount > 0) lines.push(`Room total: ${this.sharedCount}`);
    }
    // Anywhere quests ride along under the room quest.
    for (const q of this.anywhereQuests()) {
      const n = Math.min(Number(this.saved[q.id]?.count || 0), q.target);
      if (Array.isArray(q.steps)) {
        // Chain quest: show the NEXT step, not just the count.
        const next = q.stepLabels?.[n] || '';
        lines.push(`${q.emoji} ${q.title}  ${n}/${q.target}${next ? ` — ${next}` : ''}`);
      } else {
        lines.push(`${q.emoji} ${q.title}  ${n}/${q.target}`);
      }
    }
    if (lines.length === 0) return;
    try {
      this.tracker.setText(lines.join('\n'));
    } catch {}
  }

  _showToast(text) {
    try {
      const scene = this.scene;
      if (this._toastTimer) {
        try { this._toastTimer.remove(); } catch {}
        this._toastTimer = null;
      }
      if (this.toast) this.toast.destroy();
      const w = scene?.scale?.width || 800;
      const h = scene?.scale?.height || 600;
      this.toast = scene.add.text(w / 2, h * 0.28, text, {
        fontSize: '20px',
        color: '#14532d',
        backgroundColor: 'rgba(255,255,255,0.94)',
        padding: { x: 14, y: 10 },
        align: 'center',
        wordWrap: { width: Math.min(520, w - 40) },
      });
      this.toast.setOrigin(0.5, 0.5);
      this.toast.setScrollFactor(0);
      this.toast.setDepth(DEPTH.UI + 1);
      this._toastTimer = scene.time.delayedCall(4500, () => {
        try {
          scene.tweens.add({
            targets: this.toast, alpha: 0, duration: 600,
            onComplete: () => { try { this.toast?.destroy(); } catch {} this.toast = null; },
          });
        } catch {}
      });
    } catch {}
  }

  update() {
    // Nothing per-frame: progress arrives via recordEvent /
    // recordGlobalEvent / recordDistinct / noteRoomVisit, and the toast
    // fades on a timer.
  }

  _clearTexts() {
    try { this._toastTimer?.remove(); } catch {}
    this._toastTimer = null;
    try { this._bannerTimer?.remove(); } catch {}
    this._bannerTimer = null;
    try { this.banner?.destroy(); } catch {}
    this.banner = null;
    this._bannerQuestId = null;
    try { this.tracker?.destroy(); } catch {}
    this.tracker = null;
    try { this.toast?.destroy(); } catch {}
    this.toast = null;
  }

  destroy() {
    this._clearTexts();
    this.activeQuest = null;
    this.scene = null;
  }
}
