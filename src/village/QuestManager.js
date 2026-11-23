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
// Quest badges v1 (2026-11-16, `sq-quest-badges-v1`): finishing a
// quest earns a badge, once ever. Your completions list lives in
// the pocket popup as a second tab (Badges), and other players can
// see your badges by clicking you — the server keeps a per-player
// badge record (in-memory, re-synced from your local record on
// connect), so badges show across rooms. Coffee purchases are quest
// steps, not badges: only completing a quest earns its badge.
//
// Quest badges v1.1 backfill (2026-11-16, `sq-quest-badges-v1-1`):
// a quest finished BEFORE badges existed still earns its badge.
// Badges derive from the completions record itself (there is no
// separate badge store client-side), so the backfill is a read of
// that record — backfillBadges() runs at construction and before
// every sync. A backfilled badge with no stored finish time shows
// "Completed" (never a made-up date). The server also backfills
// from its own quest-progress store (server/socket.js), so
// completions the local record lost (another browser, cleared
// storage) still come back. Past Group Puzzle completions can't be
// recovered — no persistent record of past puzzle contributors
// exists anywhere (the server's puzzle state resets every round,
// and the client only recorded puzzle completions after v1).
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
import { QUESTS, getQuest, FIRST_STEPS_QUEST_ID } from './quests.js';
import {
  FIRST_STEPS_STEP_PROMPT,
  FIRST_STEPS_ASLEEP_PROMPT,
  ONBOARDING_MARKER_V1,
} from './onboarding.js';
import {
  BADGES_MARKER_V1,
  BADGES_BACKFILL_MARKER_V1_1,
  GROUP_PUZZLE_BADGE,
  TRIM_TREE_BADGE,
  badgeListFrom,
  completionsFromSaved,
  mergeBadgeMaps,
  normalizeBadgeMap,
  formatBadgeDate,
} from './badges.js';
import { HUNGRY_CAT_QUEST_ID } from './catHunger.js';

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
    // Quest badges v1.1 backfill (`sq-quest-badges-v1-1`): turn every
    // pre-existing completion in the local record into a badge, so
    // quests finished before badges existed show up on first load.
    this.backfillBadges();
    this.activeQuest = null;
    this.sharedCount = 0; // room-wide total for the active quest (server)
    this.tracker = null; // Phaser text, pinned top-left of the screen
    this.toast = null; // Phaser text, centered completion toast
    this._toastTimer = null;
    this.banner = null; // Phaser text, top-centre quest banner
    this._bannerTimer = null;
    this._bannerQuestId = null; // quest id the live banner (if any) is for
    this._shownBanners = new Set(); // quest ids the banner already showed for, this session
    // Quest badges v1 (`sq-quest-badges-v1`): completions the SERVER
    // knows about for me (its reply to badges_sync, or a badge it
    // awarded while I was online). getCompletions() unions these
    // with my localStorage record, so a badge the server saw but my
    // local save missed still shows in my list.
    this._serverBadges = {}; // { [questId]: completedAt }
    this.marker = BADGES_MARKER_V1;
    this.backfillMarker = BADGES_BACKFILL_MARKER_V1_1;
    // Onboarding v1 (`sq-onboarding-v1`): live reference so the
    // marker survives minification in the built bundle.
    this.onboardingMarker = ONBOARDING_MARKER_V1;
    // DOM HUD (VillageCanvas renders tracker/banner/toast as DOM): when
    // true, QuestManager keeps the same state but exposes it via
    // getHudState() instead of drawing Phaser text. Default false keeps
    // the old in-canvas UI for any scene without a DOM HUD.
    this.domHud = false;
    this._bannerInfo = null; // { emoji, title, description, rewardCoins }
    this._toastText = null;
    this._hudVersion = 0; // bumped on every HUD change; the DOM polls it
  }

  /** Bump the HUD version so the DOM poll knows something changed. */
  _bumpHud() {
    this._hudVersion += 1;
  }

  /** Public HUD bump for other systems (e.g. PuzzleQuest) whose state
   *  the DOM tracker shows — same version the tracker poll watches. */
  bumpHud() {
    this._bumpHud();
  }

  /** Public toast for other systems (e.g. PuzzleQuest completion). */
  showToast(text) {
    this._showToast(text);
  }

  /** Plain-data HUD for the DOM (VillageCanvas polls this ~2x/sec).
   * trackerLines: the same lines _drawTracker would render.
   * trackerSections: { room, anywhere } — the room quest on its own
   * and the anywhere quests separately, so the DOM can lead with
   * this room's quest and label the anywhere ones as not-this-room.
   * banner: the live banner info, or null. toast: live toast text, or null.
   * stepPrompt: the Onboarding v1 nudge for First Steps, or null. */
  getHudState() {
    return {
      version: this._hudVersion,
      trackerLines: this._trackerLines(),
      trackerSections: this._trackerSections(),
      banner: this._bannerInfo ? { ...this._bannerInfo } : null,
      toast: this._toastText,
      stepPrompt: this.getStepPrompt(),
    };
  }

  /** Onboarding v1 (`sq-onboarding-v1`): the one-line nudge for the
   *  First Steps quest, or null. Only while First Steps is the
   *  active quest and unfinished — the moment it completes, the
   *  prompt is gone (refresh() picks Cat Cuddles next). If the cat
   *  is napping (3 pets put her to sleep — she wakes when someone
   *  new walks in), the prompt says so instead of sending the
   *  player to a cat that can't be petted. The DOM polls
   *  getHudState, so the text flips when she falls asleep / wakes
   *  up. A returning player who never did First Steps sees the
   *  same prompt — the quest is completable by anyone, once ever. */
  getStepPrompt() {
    const quest = this.activeQuest;
    if (!quest || quest.id !== FIRST_STEPS_QUEST_ID) return null;
    if (this.saved[quest.id]?.completed) return null;
    if (this.scene?.cafeCat?.asleep) return FIRST_STEPS_ASLEEP_PROMPT;
    return FIRST_STEPS_STEP_PROMPT;
  }

  /** Public dismiss for the DOM banner's click handler. */
  dismissBanner() {
    this._dismissBanner();
  }

  /** CSS-pixel size of the game canvas under FIT scaling. Quest UI text
   * is drawn in world units, so on a phone (canvas ~390 CSS px wide
   * for a 1600-unit game) a 15px font renders at ~4 CSS px — the
   * tracker/banner/toast exist but are unreadable. Scale fonts,
   * padding and wrap widths by 1/f so text reads ~15-20 CSS px on
   * any screen. Desktop (f≈0.8-1) barely changes. */
  _uiScale() {
    try {
      const s = this.scene?.scale;
      const gameW = Number(s?.width) || 1600;
      const dispW = Number(s?.displaySize?.width) || gameW;
      const f = dispW / gameW;
      if (Number.isFinite(f) && f > 0.05) return f;
    } catch {}
    return 1;
  }

  /** World-unit font size that reads as ~cssPx CSS pixels. */
  _fontFor(cssPx) {
    return Math.min(96, Math.max(cssPx, Math.round(cssPx / this._uiScale())));
  }

  /** World-unit wrap width that reads as ~cssPx CSS pixels wide. */
  _wrapFor(cssPx) {
    const f = this._uiScale();
    return Math.min(1500, Math.max(200, Math.round(cssPx / f)));
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
    // The tracker is always drawn — even with no open quest it says
    // "All quests complete", so an empty corner never reads as a
    // broken quest system (and a finished Cat Cuddles visibly hands
    // over to the Golden Key).
    try {
      if (!this.domHud) {
        const scene = this.scene;
        const f = this._uiScale();
        this.tracker = scene.add.text(16, 16, '', {
          fontSize: `${this._fontFor(15)}px`,
          color: '#1a4971',
          backgroundColor: 'rgba(255,255,255,0.88)',
          padding: { x: Math.round(10 / f), y: Math.round(8 / f) },
          wordWrap: { width: this._wrapFor(340) },
        });
        this.tracker.setScrollFactor(0);
        this.tracker.setDepth(DEPTH.UI);
      }
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

  // ---- quest badges v1 (`sq-quest-badges-v1`) -----------------------

  /** Quest badges v1.1 backfill (`sq-quest-badges-v1-1`): every quest
   *  finished BEFORE the badges system existed still earns its
   *  badge. Badges derive from the completions record itself (there
   *  is no separate badge store client-side), so the backfill is a
   *  read of that record — any entry with completed: true is a
   *  badge, with its stored finish time when one exists and no date
   *  ("Completed") when it doesn't. Runs at construction and before
   *  every sync — once ever per quest, idempotent (a second load
   *  returns the same set), never pays coins (completion / rewards
   *  still go through _completeQuest alone). Returns the backfilled
   *  map { questId: completedAt | null }. */
  backfillBadges() {
    return completionsFromSaved(this.saved);
  }

  /** My own completions record, as a map { questId: completedAt |
   *  null }, from localStorage only — this IS the backfilled record
   *  (see backfillBadges). Sent to the server on connect
   *  (badges_sync) so a restart never loses badges I already earned. */
  getCompletedMap() {
    return this.backfillBadges();
  }

  /** Ids of the quests I have finished (local record only). */
  getCompletedIds() {
    return Object.keys(this.getCompletedMap());
  }

  /** My completions list for the Badges tab: every finished quest
   *  (local record + anything the server knows about), newest
   *  first — [{ questId, emoji, title, description, completedAt,
   *  completedLabel }]. Old saves without a timestamp show as
   *  "Completed" with no date. */
  getCompletions() {
    const merged = mergeBadgeMaps(this.getCompletedMap(), this._serverBadges);
    return badgeListFrom(merged).map((b) => ({
      ...b,
      completedLabel: formatBadgeDate(b.completedAt),
    }));
  }

  /** Record the shared Group Puzzle badge: I helped finish the cat
   *  puzzle in Agora (PuzzleQuest calls this from
   *  _onPuzzleCompleted). Once ever — a later round finishing does
   *  not re-earn it, and the server awards the same badge to every
   *  contributor, so both paths converge on one entry. */
  recordPuzzleCompletion() {
    const entry = this.saved[GROUP_PUZZLE_BADGE.id] || { count: 0, completed: false };
    if (entry.completed) return false;
    entry.completed = true;
    entry.count = 1;
    entry.completedAt = Date.now();
    this.saved[GROUP_PUZZLE_BADGE.id] = entry;
    saveSaved(this.saved);
    this._bumpHud();
    return true;
  }

  /** Record the Trim the Tree badge: I helped finish a Christmas
   *  tree in Agora (TrimTreeQuest calls this from _onTreeCompleted).
   *  Once ever — finishing the second tree does not re-earn it, and
   *  the server awards the same badge to every contributor, so both
   *  paths converge on one entry. */
  recordTreeCompletion() {
    const entry = this.saved[TRIM_TREE_BADGE.id] || { count: 0, completed: false };
    if (entry.completed) return false;
    entry.completed = true;
    entry.count = 1;
    entry.completedAt = Date.now();
    this.saved[TRIM_TREE_BADGE.id] = entry;
    saveSaved(this.saved);
    this._bumpHud();
    return true;
  }

  /** Record the Hungry Cat badge: I fed the cafe cat while she was
   *  hungry (VillageScene calls this when the server confirms the
   *  hungry-cat quest). Once ever — the quest itself is repeatable
   *  (twice a day, +3 coins every window), but the badge is earned
   *  on the FIRST hungry feeding only, like the puzzle/tree badges.
   *  The server awards the same badge (awardBadge is once-ever),
   *  so both paths converge on one entry. The coins are paid on
   *  every server confirmation, NOT here — this only records the
   *  badge. Note this marks saved['hungry-cat'] completed, but the
   *  quest is NOT in QUESTS, so refresh() / anywhereQuests() never
   *  see it and the one-time quest flow is untouched. */
  recordHungryCatCompletion() {
    const entry = this.saved[HUNGRY_CAT_QUEST_ID] || { count: 0, completed: false };
    if (entry.completed) return false;
    entry.completed = true;
    entry.count = 1;
    entry.completedAt = Date.now();
    this.saved[HUNGRY_CAT_QUEST_ID] = entry;
    saveSaved(this.saved);
    this._bumpHud();
    return true;
  }

  /** Public banner for other systems (e.g. TrimTreeQuest): show the
   *  big top-centre quest banner for a quest-like object
   *  { id, emoji, title, description, rewardCoins }. Same once-per-
   *  session guard as the room quests. */
  showQuestBannerFor(quest) {
    try { this._showQuestBanner(quest); } catch {}
  }

  /** Merge the server's badge record for me (its reply to
   *  badges_sync / get_badges) into my list. Display-only: this
   *  never pays coins — quest completion / rewards still go through
   *  _completeQuest / applyServerState alone. */
  applyServerBadges(badges) {
    const next = mergeBadgeMaps(this._serverBadges, normalizeBadgeMap(badges));
    const changed = JSON.stringify(next) !== JSON.stringify(this._serverBadges);
    this._serverBadges = next;
    if (changed) this._bumpHud();
    return changed;
  }

  /** Send my local completions record to the server (on connect):
   *  the server merges it into its per-player badge store, replies
   *  with the merged record (badges_state), and tells the room so
   *  other players can see my badges. */
  syncBadgesToServer() {
    try {
      const socket = this.scene?.socket;
      if (!socket?.connected) return false;
      socket.emit('badges_sync', {
        roomId: this.scene?.roomId,
        badges: Object.entries(this.getCompletedMap())
          .map(([questId, completedAt]) => ({ questId, completedAt })),
      });
      return true;
    } catch {
      return false;
    }
  }

  /** One quest event happened for the ROOM quests (e.g. you pet the
   *  cat). Onboarding v1 (`sq-onboarding-v1`): a room event can
   *  advance MORE than the active quest — the First Steps pet is
   *  also Cat Cuddles 1/3, so every unfinished room quest listening
   *  for this event counts it. (Before this, only the active room
   *  quest counted; anywhere quests already shared events via
   *  recordGlobalEvent.) The list is captured up front because
   *  completing one quest refresh()es the active quest mid-loop;
   *  _increment bails on completed quests, so nothing double-counts.
   *  In practice only the Agora cat-pet overlaps (First Steps +
   *  Cat Cuddles) — every other room's quests listen for different
   *  events. */
  recordEvent(eventName) {
    const roomQuests = QUESTS.filter(
      (q) => q.roomId === this.scene?.roomId && q.event === eventName && !this.saved[q.id]?.completed,
    );
    for (const quest of roomQuests) this._increment(quest);
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
    // Quest badges v1: stamp the finish so the Badges tab can show
    // when it happened. Old saves without a stamp show "Completed".
    if (!Number.isFinite(Number(entry.completedAt)) || Number(entry.completedAt) <= 0) {
      entry.completedAt = Date.now();
    }
    this.saved[quest.id] = entry;
    saveSaved(this.saved);
    // Reward: coins from the local wallet (same as duck-pet coins).
    // Paid exactly once: this is the only path that sets completed
    // from false to true, and recordEvent / applyServerState both
    // bail out once completed is true.
    // Onboarding v1 (`sq-onboarding-v1`): First Steps pays NO extra
    // coins — the normal +1 pet coin IS the reward. Skip the wallet
    // call entirely (earnCoins(0) would be a no-op write) and leave
    // coins out of the toast, so it never reads "+0 coins".
    if (quest.rewardCoins > 0) {
      try {
        import('./CoinWallet.js')
          .then((m) => m.earnCoins(quest.rewardCoins, `quest-${quest.id}`))
          .catch(() => {});
      } catch {}
    }
    const toastText = quest.rewardCoins > 0
      ? `🎉 Quest complete! ${quest.emoji} ${quest.title} — +${quest.rewardCoins} coins`
      : `🎉 Quest complete! ${quest.emoji} ${quest.title}`;
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
    // The banner's data lives here whether it renders in-canvas or in
    // the DOM — getHudState() reads it. (On PC the in-canvas banner
    // sat underneath the DOM top bar, so the DOM is the render path
    // that can actually be seen.)
    this._bannerInfo = {
      emoji: quest.emoji,
      title: quest.title,
      description: quest.description,
      rewardCoins: quest.rewardCoins,
    };
    // Remember which quest this live banner is for, so refresh() can
    // tell a banner the player actually saw from one it destroyed
    // itself before the player ever saw it.
    this._bannerQuestId = quest.id;
    this._bumpHud();
    if (this.domHud) {
      // DOM renders it; the timer below still dismisses it on schedule.
      try {
        this._bannerTimer = this.scene.time.delayedCall(QUEST_BANNER_MS, () => this._dismissBanner());
      } catch {}
      return;
    }
    try {
      const scene = this.scene;
      const w = scene?.scale?.width || 800;
      const f = this._uiScale();
      const text = [
        `${quest.emoji} ${quest.title}`,
        quest.description,
        // Onboarding v1: a 0-coin reward shows no reward line at all
        // (never "Reward: +0 coins" — First Steps pays in pet coins).
        ...(quest.rewardCoins > 0 ? [`Reward: +${quest.rewardCoins} coins`] : []),
      ].join('\n');
      this.banner = scene.add.text(w / 2, 64, text, {
        fontSize: `${this._fontFor(18)}px`,
        color: '#1a4971',
        backgroundColor: 'rgba(255,255,255,0.95)',
        padding: { x: Math.round(16 / f), y: Math.round(12 / f) },
        align: 'center',
        wordWrap: { width: this._wrapFor(360) },
      });
      this.banner.setOrigin(0.5, 0);
      this.banner.setScrollFactor(0);
      this.banner.setDepth(DEPTH.UI + 2);
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
    this._bannerInfo = null;
    this._bumpHud();
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

  /** The tracker split into two sections: this room's quest, and the
   * anywhere quests (roomId '*') kept separate so they never read as
   * quests for the room you're standing in. A chain quest's next step
   * already names where it happens ("Say hi to the bartender at
   * Lola's Depot"), so no extra location hint is needed.
   * The Agora group puzzle rides along UNDER the room quest (it is a
   * room thing, not an anywhere quest): "🧩 Group Puzzle X/9". */
  _trackerSections() {
    const room = [];
    const anywhere = [];
    const quest = this.activeQuest;
    if (quest) {
      const mine = this.progress;
      room.push(
        `${quest.emoji} ${quest.title}  ${mine}/${quest.target}`,
        quest.description,
      );
      if (this.sharedCount > 0) room.push(`Room total: ${this.sharedCount}`);
    }
    // Hungry Cat v1 (`sq-hungry-cat-v1`): the hungry-cat quest rides
    // along UNDER the room quest while she is hungry — CafeCat owns
    // the line (null outside a hunger window, so the quest is
    // invisible in the tracker until the next window; the banner
    // announces it when a window opens). Same pattern as the puzzle
    // and the trees below.
    const hungryLine = this.scene?.cafeCat?.getTrackerLine?.();
    if (hungryLine) room.push(hungryLine);
    const puzzle = this.scene?.puzzleQuest?.getProgress?.();
    if (puzzle) {
      room.push(
        puzzle.completed
          ? `🧩 Group Puzzle  ${puzzle.placed}/${puzzle.total} — complete!`
          : `🧩 Group Puzzle  ${puzzle.placed}/${puzzle.total}`,
      );
    }
    // Trim the Tree v1 (`sq-trim-tree-v1`): the shared Christmas
    // trees ride along under the room quest too — "🎄 Trim the Tree
    // (Tree 1) X/25". Only the ACTIVE tree's count shows (the hidden
    // first-only rule is never explained here — the tracker just
    // shows X/25). Both trees done reads as complete.
    const tree = this.scene?.trimTreeQuest?.getProgress?.();
    if (tree) {
      room.push(
        tree.allDone
          ? '🎄 Trim the Tree — both trees complete! 🎉'
          : `🎄 Trim the Tree (Tree ${tree.tree})  ${tree.counted}/${tree.total}`,
      );
    }
    for (const q of this.anywhereQuests()) {
      const n = Math.min(Number(this.saved[q.id]?.count || 0), q.target);
      if (Array.isArray(q.steps)) {
        // Chain quest: show the NEXT step, not just the count.
        const next = q.stepLabels?.[n] || '';
        anywhere.push(`${q.emoji} ${q.title}  ${n}/${q.target}${next ? ` — ${next}` : ''}`);
      } else {
        anywhere.push(`${q.emoji} ${q.title}  ${n}/${q.target}`);
      }
    }
    return { room, anywhere };
  }

  /** The tracker lines, shared by the canvas text and the DOM HUD.
   * Room quest first; anywhere quests under a labelled separator. */
  _trackerLines() {
    const { room, anywhere } = this._trackerSections();
    const lines = [...room];
    if (anywhere.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('🌍 Anywhere quests');
      lines.push(...anywhere);
    }
    if (lines.length === 0) {
      // Nothing open: say so, instead of leaving a blank corner that
      // reads as a broken quest system.
      lines.push('✅ All quests complete — more coming soon!');
    }
    return lines;
  }

  _drawTracker() {
    this._bumpHud();
    if (this.domHud) return; // the DOM renders getHudState() instead
    if (!this.tracker) return;
    try {
      this.tracker.setText(this._trackerLines().join('\n'));
    } catch {}
  }

  _showToast(text) {
    this._toastText = text;
    this._bumpHud();
    if (this.domHud) {
      // DOM renders it; clear it on the same 4.5s schedule.
      try {
        if (this._toastTimer) this._toastTimer.remove();
        this._toastTimer = this.scene.time.delayedCall(4500, () => {
          this._toastText = null;
          this._toastTimer = null;
          this._bumpHud();
        });
      } catch {}
      return;
    }
    try {
      const scene = this.scene;
      if (this._toastTimer) {
        try { this._toastTimer.remove(); } catch {}
        this._toastTimer = null;
      }
      if (this.toast) this.toast.destroy();
      const w = scene?.scale?.width || 800;
      const h = scene?.scale?.height || 600;
      const f = this._uiScale();
      this.toast = scene.add.text(w / 2, h * 0.28, text, {
        fontSize: `${this._fontFor(20)}px`,
        color: '#14532d',
        backgroundColor: 'rgba(255,255,255,0.94)',
        padding: { x: Math.round(14 / f), y: Math.round(10 / f) },
        align: 'center',
        wordWrap: { width: this._wrapFor(360) },
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
    this._bannerInfo = null;
    this._toastText = null;
    this._bumpHud();
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
