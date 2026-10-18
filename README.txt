SIDE QUEST — BARTENDER SERVICE v2 (supersedes v1)
Drinks are ordered from the bartender, who asks what you want.

HOW IT PLAYS
- At the counter: "Order a drink · 2 coins [E]".
- Press E and the bartender asks — his bubble says "What'll ya have?"
  and a picker line appears: [1] Lone Star  [2] Lager  [3] IPA
  [4] Stout  [5] Surprise me. Press a number, or Enter for your usual
  (starred), or Esc to cancel. Walking away closes the picker.
- Your pick is remembered on this device: next time it's starred as
  your usual, so Enter alone reorders it.
- Orders queue first-come-first-served (max 4). He walks the counter
  to you, pours (~1 sec), and calls it out in a bubble — "One Lone
  Star" — as your drink animation plays. Coins (2) charge at the
  hand-off, never before. Every screen in the room sees the same serves.
- Wander off mid-serve: no drink, no charge ("You wandered off").
- "Surprise me" picks a random tap at order time; his call-out names
  what he chose.
- All beers are mechanically the same drink (by design — the name is
  the fiction). The bartender's Inworld chat is completely untouched;
  asking/serving is a scripted layer beside it.
- Bars with a counter but no bartender NPC keep the old instant buy.
- Picking by number is desktop-only in this version; on mobile, tap
  the interact button to open the picker and tap it again to take
  your usual.

FILES (extract over the repo root)
- src/village/VillageScene.js, server/socket.js (order relay w/ beer)
- src/village/CoinWallet.js, src/game/entities/SpriteAvatarBase.js
  (unchanged carriers from the bar-drink kit)

DEPLOY ORDER — takes the bar-drink kit's place (slot 2):
avatar-size -> THIS -> wallet -> photo -> gator.
- Title fix NOT deployed on main: use server/socket.js as-is.
- socket.with-title-fix.js is only for a future where the jukebox
  title fix is deployed; ignore it tonight (delete after extracting
  so it isn't committed).

AFTER DEPLOY, CHECK IN LOLA'S DEPOT
1. Counter prompt reads "Order a drink · 2 coins [E]".
2. E: bubble "What'll ya have?" + picker line. Press 1: order placed.
3. Balance unchanged until he pours and calls "One Lone Star" —
   then -2 and your mug animation plays.
4. Next order: Lone Star is starred; Enter alone reorders it.
5. Order then walk across the room: no charge.
6. Second screen in the room sees the serve + call-out bubble.
7. Chat with the bartender: Inworld banter unchanged.
