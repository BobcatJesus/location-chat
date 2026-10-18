SIDE QUEST — BARTENDER SERVICE v1
Replaces the automatic bar buy: drinks are ordered from the bartender.

WHAT CHANGES
- At the bar counter the prompt now reads "Order a drink · 2 coins [E]".
- Pressing E places an ORDER (no charge yet). The bartender leaves his
  patrol, walks the counter to you, pours (~1 sec), and hands it over —
  your drink animation plays and 2 coins are charged AT THE HAND-OFF.
- Orders queue first-come-first-served (max 4 waiting). Everyone in the
  room sees the same serves, in the same order.
- Wander more than a few steps from the bar before he finishes and the
  order fizzles: no drink, no charge ("You wandered off — no charge").
- While your order is in flight the prompt reads "Coming right up…".
- Bars with a counter but NO bartender NPC keep the old instant buy.
- The bartender's Inworld dialogue AI is untouched — serving is a
  scripted movement task layered beside it, not inside it.

FILES (extract over the repo root, same as other kits)
- src/village/VillageScene.js        (ordering, queue, serve sequence)
- server/socket.js                   (order_drink relay)
- src/village/CoinWallet.js          (unchanged, included for completeness)
- src/game/entities/SpriteAvatarBase.js (unchanged drink animation carrier)

DEPLOY ORDER — IMPORTANT
This kit takes the place of the bar-drink kit in the deploy order
(avatar-size -> THIS -> wallet-per-profile -> photo-above-head -> gator).
- If you have NOT deployed the jukebox title fix: use server/socket.js.
- If you HAVE deployed the jukebox title fix (or do it later):
  use server/socket.with-title-fix.js INSTEAD — copy it over
  server/socket.js. Never deploy the old title-fix kit's socket after
  this kit; it would erase the bartender order relay.

AFTER DEPLOY, CHECK IN LOLA'S DEPOT
1. Walk to the counter: prompt says "Order a drink · 2 coins [E]".
2. Press E with 2+ coins: balance unchanged until the bartender
   reaches you and pours; then -2 and your mug animation plays.
3. Order with 0-1 coins: "Need 2 coins!" flash, no order placed.
4. Order, then walk across the room: no charge, "wandered off" note.
5. On a second screen/account in the same room: the serve is visible
   there too, and the drinker's toast plays on that screen.
6. Talk to the bartender (NPC chat) before/after a serve: dialogue
   behaves exactly as before.
