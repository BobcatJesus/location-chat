SIDE QUEST — BARTENDER v4.1 (on top of v4)
Bigger board, wider ear.

THE BOARD (everywhere — picker data, his chat knowledge, parser)
Lone Star · Lager · IPA · Voodoo Ranger · Ultra · Cider · Stout
(+ "surprise me"). His persona line now lists all seven, so "what
do you have" gets a real answer in his own words.

WIDER EAR (why your words may have missed before)
- Requests: "can i have", "let me get", "gimme one", "pour me a
  beer", "i'll take a drink" and friends now count, not just
  "can i get a beer".
- A short bare mention ("a beer please", "beer") at the bar is an
  order for your usual.
- Reply-shaped phrases ("the usual", "sounds good", "same again")
  work even as your first line — they only make sense as answers.
  Bare "yes"/"sure" still need him to have spoken first (or you to
  have messaged him once), so a stray yes can't spend coins.
- "michelob" = Ultra, "eastciders"/"cider" = Cider.

FILES: src/village/VillageScene.js + server/socket.js.

TRY THESE LINES AT LOLA'S
- "what do you have" -> he lists the seven.
- "let me get a voodoo" -> Voodoo Ranger, served.
- "a beer please" -> your usual, served.
- after he asks what you want: "sure" -> your usual, served.
