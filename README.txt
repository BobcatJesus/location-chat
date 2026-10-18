SIDE QUEST — BARTENDER SERVICE v3 (on top of v2, already live)
Two changes, both in src/village/VillageScene.js. The server file is
unchanged from v2 — nothing to do on Railway beyond the normal push.

1) ORDER AT THE BARTENDER, NOT THE BAR
- At a staffed bar, the order prompt (and the E key, and the picker)
  only works within reach of the bartender himself (~170px), wherever
  he's standing. Down the bar, the prompt reads "Get closer to the
  bartender to order" instead. Unstaffed bars still use the counter
  zone, exactly as before.

2) ORDER IN CONVERSATION
Talk to him (NPC chat) while standing at the bar. Your own words can
be the order — his AI lines are never parsed or touched:
- Name a tap: "lonestar", "an ipa", "stout", "lager" -> that beer.
- Ask plainly: "i'll have a beer", "can i get a beer", "give me a
  beer" -> your usual.
- Answer him: after he replies, a short "sure" / "yes" / "yeah" /
  "the usual" (45-second window, re-armed by each of his replies and
  each message you send him) -> your usual.
On a conversational order his scripted bubble confirms: "One Lone
Star — coming right up", then the normal serve runs. Charges still
land at the hand-off; wandering off still cancels free. A stray
"yes" can't order unless you're at the bar, mid-conversation with
him, and it starts your (short) message.

DEPLOY: extract over the repo root, git pull --rebase, add, commit,
push — frontend only in effect (Netlify), Railway rebuilds the same
socket as v2.

CHECKS IN LOLA'S
1. Stand at the far end of the bar: hint prompt, no order on E.
2. Walk up to him: order prompt appears; E + picker still work.
3. Chat: "can i get a beer" -> bubble confirms, he serves your usual.
4. Chat until he asks what you want; reply "sure" -> same serve.
5. Say "yes" to a nearby player (not in NPC chat): nothing happens.
