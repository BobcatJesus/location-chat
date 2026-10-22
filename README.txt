Side Quest - Jack-o'-lantern lighting v10 (placement oracle)
==============================================================
Status: lighting itself works (walk up + [E], or click). The last
open bug was PLACEMENT in Asgard on the user's clone: pumpkins
kept landing below the room's slanted front edge, outside the
built area, even though the same code placed them inside on a
clean copy - the clone's boundary data/helpers evidently differ
from the reference build, so helper-dependent snaps silently
no-oped.

v10 placement uses an ORACLE LADDER for "is this spot inside?":
  1. the running build's OWN RoomLayout.isPointInsideRoom
     (its test agrees with its rendering by construction);
  2. point-in-polygon on tolerantly parsed boundary points
     ({points|vertices|path}, {x,y} or [x,y] shapes);
  3. accept-as-is when no oracle exists.
A failing spot walks toward the room center until accepted;
failing that, a spread of lower-room fallback spots is tried.
On entry, a toast reports the verdicts:
  "4 pumpkins placed - inside check: check marks"

Also includes everything prior: walk-up [E] prompt + click paths,
dark unlit texture + bright swap + halo, per-room server sync.

Files: src/village/HalloweenMode.js, src/village/VillageScene.js,
server/socket.js (full files, cumulative).

TEST: extract, RESTART npm run dev, refresh localhost:5173,
enter Asgard, screenshot the toast + room and send it.
