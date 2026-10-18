SIDE QUEST — BARTENDER MEMORY WIPE
Removes the bartender's stored "facts" about the player from
data/npc-memory.json (the Lola's Depot entry only; the library
entry stays). His notes were mangled fragments of his own lines
("...a sweeter one if you want something easier"), which is why he
kept insisting you'd been drinking something sweet.

ORDER OF OPERATIONS MATTERS:
1. Stop the dev server first (Ctrl+C in the npm run dev window).
   A running server holds the old memories in RAM and can write
   them back over the clean file.
2. Extract this zip over the repo root.
3. Restart: npm run dev. He now meets you with no notes at all.

PRODUCTION NOTE: this file governs local / no-database runs. The
live site's bartender memory (if Postgres is wired on Railway)
lives in the npc_memory table instead — if the sweet-cider ghost
shows up on the public site too, that copy needs its own wipe.
And the extractor that wrote the junk facts is untouched: new
notes will accumulate over time. That's the deeper fix, parked.
