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
//   kind        — 'solo' (your own progress) or 'group' (a shared room
//                 counter). v1 ships solo only; group is a v2 shape.
//   event       — the event name QuestManager.recordEvent() listens for.
//   target      — how many of that event completes the quest.
//   rewardCoins — coins paid from the local CoinWallet on completion.
//   emoji       — tracker/toast decoration.

export const QUESTS = [
  {
    id: 'duck-roundup',
    title: 'The Duck Roundup',
    description: 'Feed the ducks at the Shepherd Park pond 3 times.',
    roomId: 'shepherd-park',
    kind: 'solo',
    event: 'duck-fed',
    target: 3,
    rewardCoins: 3,
    emoji: '🦆',
  },
];

/** Quest definition by id, or null. */
export function getQuest(id) {
  return QUESTS.find((q) => q.id === id) || null;
}
