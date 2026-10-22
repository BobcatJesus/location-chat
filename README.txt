SIDE QUEST — WATER ANIMATION v5

His catch: drinking water reused the beer animation. Water now
has its own, in the same shared base class as everything else
(SpriteAvatarBase) — every avatar gets it for free.

WHAT WATER LOOKS LIKE NOW:
- a small CLEAR GLASS (drawn, pale blue) instead of the beer mug
- a shallow tip (-3 degrees) instead of the deep mug tip-back —
  water drinkers stay upright
- quick gulps instead of slow sips (~1.5s total, beer is ~1.9s)
- two little droplet sparkles beside the head as you finish
- the buzz still drops by the same 0.55 at hand-off; nothing
  about ordering, the cutoff, or the bartender changes

Files: src/game/entities/SpriteAvatarBase.js (new
playWaterDrink beside playDrink, same cleanup) and
src/village/VillageScene.js (the serve hand-off now picks the
water animation when the drink is Water — for you and for
anyone you watch get served).

Extract over the repo root and push.
