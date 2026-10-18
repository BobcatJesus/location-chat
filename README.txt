SIDE QUEST — BARTENDER SERVICE v3.1 (on top of v3)
The beer types move INTO the conversation.

- The taps are now HIS bar's list everywhere: Lone Star, IPA,
  Ultra, Voodoo Ranger (+ Surprise me). Picker, call-out bubbles,
  and chat ordering all use them. ("lager"/"stout" are gone; a
  stored v2 usual of lager/stout simply falls back to Lone Star.)
- The bartender now KNOWS his taps: both server personas (Lola's
  room persona + every static bartender) carry the line "On tap you
  serve exactly four beers: Lone Star, IPA, Michelob Ultra, and
  Voodoo Ranger — when someone asks what you have, name those."
  His wording stays his own; the facts are now true.
- Ask him "what do you have" / "what's on tap" / "what've you got"
  in NPC chat at the bar: the picker opens on your screen as the
  actionable list while he answers in character.

FILES: src/village/VillageScene.js + server/socket.js (Railway gets
the persona change on the same push).

CHECKS IN LOLA'S
1. Picker shows the four new taps.
2. Chat "what do you have": picker opens; his reply names real taps.
3. Chat "a voodoo" (or reply to him "voodoo"): Voodoo Ranger served.
4. E-flow, proximity gate, usual memory: unchanged from v3.
