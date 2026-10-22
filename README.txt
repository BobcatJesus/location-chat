Side Quest - Jack-o'-lantern lighting v1
=========================================
Clicking a jack-o'-lantern lights it — for everyone in the room.

WHAT CHANGED
- src/village/HalloweenMode.js: pumpkins now start unlit (cool dark tint
  over the art, which is drawn glowing). Click one and the tint clears
  with a little pop, a warm candlelight halo fades in behind it and
  flickers (fast shimmer + slow swell). Click state is tracked per
  pumpkin; pumpkins are indexed 0-3 by their fixed spots.
- src/village/VillageScene.js: on join, asks the server for the room's
  lit pumpkins (get_pumpkins) and routes pumpkin_lit / pumpkin_state
  events into HalloweenMode.
- server/socket.js: keeps a per-room Set of lit pumpkin indices in
  memory. light_pumpkin is membership-checked and rate-limited like
  feed_ducks; get_pumpkins answers with the current lit set so late
  joiners see pumpkins already lit. Lit state resets when the server
  restarts (it's seasonal decor, not data).

TEST ON LOCALHOST
1. Extract this zip into the clone (overwrites the 3 files).
2. RESTART npm run dev (Ctrl+C, run it again) - the server file changed,
   and server changes do not hot-reload.
3. Open http://localhost:5173/, walk into a room: the four pumpkins sit
   dim. Click one - it should pop into full glowing color with a
   flickering halo.
4. Open a second window (another browser or incognito) in the same
   room: the pumpkin you lit is already lit there, and lighting another
   one in either window lights it in both.

DEPLOY (after local test passes)
Same PowerShell block as always: git add -A, commit, pull --rebase, push.
