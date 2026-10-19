SIDE QUEST — BARTENDER v6.1 FULL (the complete deploy in one kit)

Everything v6 + the v6.1 harvest fixes, in one extract:
- src/village/VillageScene.js: specials harvest (his invented drinks
  stock for 10 min, max 3, as star rows on the card + orderable by
  name), the narrowed negation guard, room-persona line harvesting.
- server/socket.js: persona license in both bartender spots — beyond
  the taps he may invent a special of the moment; the house stocks
  whatever he names.

Extract over the repo root, then add + commit + pull --rebase + push.
Netlify (client) and Railway (server) each take ~5 min; hard-refresh.
NOT included: the patrol fix (separate decision, separate kit).
