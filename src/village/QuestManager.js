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
//     called by VillageScene when you feed the ducks, and by DuckPond
//     when you pet one — either counts toward the 3).
//   - Shows a tracker in the top-left of the screen (quest title +
//     your progress + the room's shared feed total) and a completion
//     toast (+ coins) when you finish.
//   - Syncs with the server (quest_progress / quest_state /
//     quest_completed in server/socket.js, same membership-checked,
//     rate-limited pattern as pet_cat): the server keeps a per-room
//     shared counter and per-player progress, so the room total is
//     real and your progress survives a reload. Coins are still the
//     local CoinWallet (localStorage, per profile) — persistent
//     server-side rewards are v2.
//
// What v1 does NOT do: onboarding, group shared-progress quests,
// quest chaining / next-quest, or a quest list UI beyond the one
// active tracker. Those are v2.

import { DEPTH } from './depth.js';
import { QUESTS, getQuest } from './quests.js';

const QUESTS_PREFIX = 'location-chat-quests';

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
  }

  /** (Re)pick the quest for this room and (re)draw the tracker. */
  refresh() {
    this._clearTexts();
    const roomId = this.scene?.roomId;
    this.activeQuest = QUESTS.find(
      (q) => q.roomId === roomId && !this.saved[q.id]?.completed,
    ) || null;
    this.sharedCount = 0;
    if (!this.activeQuest) return;
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

  /** One quest event happened (e.g. you fed a duck). */
  recordEvent(eventName) {
    const quest = this.activeQuest;
    if (!quest || quest.event !== eventName) return;
    const entry = this.saved[quest.id] || { count: 0, completed: false };
    if (entry.completed) return;
    entry.count = Math.min((Number(entry.count) || 0) + 1, quest.target);
    this.saved[quest.id] = entry;
    saveSaved(this.saved);
    this._drawTracker();
    // Tell the server so the room's shared counter moves too.
    try {
      this.scene.socket?.emit('quest_progress', { roomId: this.scene.roomId, questId: quest.id });
    } catch {}
    if (entry.count >= quest.target) this._completeQuest();
  }

  /** Apply the server's canonical quest state (on join / on change). */
  applyServerState(payload = {}) {
    const quest = getQuest(payload.questId);
    if (!quest) return;
    // The room's shared total is always the server's number.
    if (Number.isFinite(Number(payload.shared))) {
      this.sharedCount = Number(payload.shared);
    }
    // Your own count: take the higher of local / server, so a server
    // restart (in-memory state) never wipes progress you already made.
    if (Number.isFinite(Number(payload.count)) && this.activeQuest?.id === quest.id) {
      const entry = this.saved[quest.id] || { count: 0, completed: false };
      const best = Math.max(Number(entry.count) || 0, Number(payload.count));
      if (best !== entry.count) {
        entry.count = Math.min(best, quest.target);
        this.saved[quest.id] = entry;
        saveSaved(this.saved);
      }
      if (payload.completed && !entry.completed) {
        entry.completed = true;
        this.saved[quest.id] = entry;
        saveSaved(this.saved);
        // Local save never paid for this one (payment happens in
        // _completeQuest, which sets completed) — so pay here.
        this._completeQuest();
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

  _completeQuest() {
    const quest = this.activeQuest;
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

  _drawTracker() {
    if (!this.tracker || !this.activeQuest) return;
    const quest = this.activeQuest;
    const mine = this.progress;
    const lines = [
      `${quest.emoji} ${quest.title}  ${mine}/${quest.target}`,
      quest.description,
    ];
    if (this.sharedCount > 0) lines.push(`Room total: ${this.sharedCount} feeds`);
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
    // Nothing per-frame in v1: progress arrives via recordEvent /
    // applyServerState, and the toast fades on a timer.
  }

  _clearTexts() {
    try { this._toastTimer?.remove(); } catch {}
    this._toastTimer = null;
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
