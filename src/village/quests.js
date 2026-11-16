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

export const QUESTS = [
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
