SIDE QUEST — BARTENDER SERVICE v4 (on top of v3.1)
Buying a beer at a staffed bar is now TOTALLY conversational.
VillageScene.js only; the server is unchanged from v3.1.

GONE at staffed bars
- The "press E, get a picker" flow: no E action, no menu line, no
  number keys. (The E prompt at the counter now reads "Talk to the
  bartender to order · 2 coins" — a signpost, not a button.)
- Unstaffed bars keep the old instant [E] buy, untouched.

THE CONVERSATION IS THE REGISTER (all already in v3/v3.1, now the
only way at a staffed bar)
- Walk up to him (within ~170px) and talk in NPC chat.
- "what do you have" -> he answers from his tap knowledge (v3.1).
- Name a tap (lonestar / ipa / ultra / voodoo) -> ordered.
- "i'll have a beer" / "can i get a beer" -> your usual.
- "surprise me" -> a random tap (new in v4).
- After he speaks, a short "sure" / "yes" / "the usual" within the
  45-second conversation window -> your usual.
- His scripted bubble confirms ("One Lone Star — coming right up"),
  he walks, pours, calls it out; coins charge at the hand-off.
- NEW: order while broke and his bubble answers instead: "Tab's
  closed till you scare up some coins, friend."
- Ordering by name also updates your remembered usual now.

CHECKS IN LOLA'S
1. E at the counter: nothing happens; prompt says talk to him.
2. Chat: "what do you have" -> he lists Lone Star / IPA / Ultra /
   Voodoo Ranger in his own words.
3. Reply "lonestar" (or "sure" after he asks) -> confirm bubble,
   serve, call-out, -2 at the hand-off.
4. Far end of the bar: hint prompt; chat order attempts do nothing
   until you're within reach of him.
