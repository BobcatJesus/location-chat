SIDE QUEST — BARTENDER v7.1: CLEAR THE STAGE (VillageScene only)

The serve/drink moment was buried under four text elements at
once: both name tags, the order prompt, and the speech bubble —
all floating in the exact band where the mug rises to the face.

Fix, while YOUR drink is being poured and drunk (~2.6s):
- Your name tag and the bartender's hide, then come back.
- The order prompt hides (the Coming right up state is gone —
  the bubble already says it).
- The bartender's speech bubble rides higher (gy-104), so
  "Here you go" floats above the action instead of on it.
Everything else is v7 (card only) — this file is cumulative.

If v7 is not pushed yet: extract v7 first, then this, one commit.
Otherwise extract this alone and push. Hard-refresh after deploy.
