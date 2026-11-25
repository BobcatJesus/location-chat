// quests.js — Side Quest quest definitions (Quest Wrapper v1).
//
// One quest = one plain object. Adding a quest for v2 is just adding
// another entry here — no scene or server code changes needed as long
// as the new quest's `event` is one QuestManager already hears about
// (see QuestManager.recordEvent) or a new `recordEvent` call site is
// wired in VillageScene.
//
// Fields:
//   id          — stable id, used in server messages + localStorage.
//   title       — shown in the tracker and the completion toast.
//   description — one line telling the player what to do.
//   roomId      — the room this quest lives in. Quests only auto-start
//                 in their own room; everywhere else they stay hidden.
//                 roomId '*' means an ANYWHERE quest: it is active in
//                 every room, alongside that room's own quest (see
//                 QuestManager.recordGlobalEvent).
//   kind        — 'solo' (your own progress) or 'group' (a shared room
//                 counter). v1 ships solo only; group is a v2 shape.
//   event       — the event name QuestManager.recordEvent() listens for
//                 (room quests) or recordGlobalEvent() listens for
//                 (anywhere quests). Step quests (see below) match
//                 against their steps instead, so `event` is just the
//                 first step, for documentation.
//   steps       — optional chain: an ordered list of event names. The
//                 quest only advances when the NEXT step's event fires,
//                 in order. `stepLabels` is the matching one-line text
//                 for each step, shown in the tracker.
//   distinctKey — optional: recordDistinct() counts DISTINCT values
//                 (not repeats) into entry[distinctKey] — e.g. different
//                 beers, different rooms. `target` is then how many
//                 distinct values complete the quest.
//   target      — how many of that event completes the quest.
//   rewardCoins — coins paid from the local CoinWallet on completion.
//   emoji       — tracker/toast decoration.

/** The guided first quest (Onboarding v1, `sq-onboarding-v1`):
 *  walk up to the cafe cat in Agora and pet her once. Declared
 *  above QUESTS — the def below references it, and consts are
 *  not usable before their declaration. */
export const FIRST_STEPS_QUEST_ID = 'first-steps';

export const QUESTS = [
  // Onboarding v1 (`sq-onboarding-v1`): the guided first quest.
  // FIRST among the Agora quests, so refresh() picks it before Cat
  // Cuddles — a new player's first pet completes this, and the same
  // pet also counts as Cat Cuddles 1/3 (QuestManager.recordEvent
  // advances every unfinished room quest listening for the event).
  // rewardCoins 0: NO extra coins — the normal +1 pet coin IS the
  // reward (QuestManager skips the wallet call and the "+0 coins"
  // text when the reward is 0). The badge is automatic, like every
  // completed quest. Completable by anyone, once ever — the landing
  // card is what points first-timers at it.
  {
    id: FIRST_STEPS_QUEST_ID,
    title: 'First Steps',
    description: 'Walk up to the cafe cat and pet her once. (Press E when you are close.)',
    roomId: 'agora-houston',
    kind: 'solo',
    event: 'cat-pet',
    target: 1,
    rewardCoins: 0,
    emoji: '👋',
  },
  {
    id: 'duck-roundup',
    title: 'The Duck Roundup',
    description: 'Find the roaming ducks around Shepherd Park and pet 3 of them.',
    roomId: 'shepherd-park',
    kind: 'solo',
    event: 'duck-fed',
    target: 3,
    rewardCoins: 3,
    emoji: '🦆',
  },
  {
    id: 'cat-cuddles',
    title: 'Cat Cuddles',
    description: 'Pet the cafe cat in Agora 3 times. (She naps after 3 pets — she wakes when someone new walks in.)',
    roomId: 'agora-houston',
    kind: 'solo',
    event: 'cat-pet',
    target: 3,
    rewardCoins: 3,
    emoji: '🐱',
  },
  {
    id: 'first-round',
    title: 'Say Hello to the Bartender',
    description: "Walk up to the bartender at Lola's Depot and say hi.",
    roomId: 'lolas-depot',
    kind: 'solo',
    event: 'bartender-talk',
    target: 1,
    rewardCoins: 3,
    emoji: '🍺',
  },
  {
    id: 'barfly',
    title: 'Barfly',
    description: "Order 3 different beers at Lola's Depot. (Water doesn't count — this is a bar.)",
    roomId: 'lolas-depot',
    kind: 'solo',
    event: 'beer-ordered',
    distinctKey: 'beers',
    target: 3,
    rewardCoins: 5,
    emoji: '🍻',
  },
  {
    id: 'golden-key',
    title: 'The Golden Key',
    description: 'A golden key is hidden somewhere in Agora. Find it and pick it up.',
    roomId: 'agora-houston',
    kind: 'solo',
    event: 'key-found',
    target: 1,
    rewardCoins: 5,
    emoji: '🔑',
  },
  // Anywhere quests (roomId '*') — active in every room at once.
  // Catch a Litterbug v1 (`sq-litterbug-quest-v1`): tap fresh
  // litter (marked "!") within 15 seconds of the drop — a real
  // player's drop, or a Shepherd Park NPC's cup. One catch
  // completes it; the badge is automatic like every quest.
  {
    id: 'litterbug',
    title: 'Catch a Litterbug',
    description: 'Catch someone littering — tap fresh litter (marked !) within 15 seconds of the drop. A real player or a park NPC, either one counts.',
    roomId: '*',
    kind: 'solo',
    event: 'litterbug-caught',
    target: 1,
    rewardCoins: 5,
    emoji: '🚨',
  },
  {
    id: 'wanderer',
    title: 'Wanderer',
    description: 'Visit 3 different places.',
    roomId: '*',
    kind: 'solo',
    event: 'room-visited',
    distinctKey: 'rooms',
    target: 3,
    rewardCoins: 4,
    emoji: '🗺️',
  },
  // Gift Giver v1 (`sq-gift-giver-v1`): give 3 gifts — mail one
  // (MailSystem counts it on the send confirm) or hand one over
  // in person (GiftSystem counts it on the recipient's confirm).
  // Either way counts; gifts need wrapping paper (2 coins a sheet
  // at the Agora bar), so the quest is never free to grind.
  // rewardCoins 5 is a builder default — the user never set the
  // amount; say so if it should change.
  {
    id: 'gift-giver',
    title: 'Gift Giver',
    description: 'Give 3 gifts — mail one, or hand one to someone in person. (Gifts need wrapping paper.)',
    roomId: '*',
    kind: 'solo',
    event: 'gift-given',
    target: 3,
    rewardCoins: 5,
    emoji: '🎁',
  },
  {
    id: 'bartenders-errand',
    title: "The Bartender's Errand",
    description: "The bartender needs a favour, in three parts — and he won't say what the third one is for.",
    roomId: '*',
    kind: 'solo',
    event: 'bartender-talk',
    steps: ['bartender-talk', 'ducks-fed', 'cat-pet'],
    stepLabels: [
      "Say hi to the bartender at Lola's Depot",
      'Feed the pond ducks (any pond works)',
      'Pet the cafe cat in Agora',
    ],
    target: 3,
    rewardCoins: 5,
    emoji: '🗝️',
  },
];

/** Quest definition by id, or null. */
export function getQuest(id) {
  return QUESTS.find((q) => q.id === id) || null;
}
