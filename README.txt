SIDE QUEST — DRUNKENNESS v3: MAKE IT READ ACROSS THE ROOM

v1/v2 swayed at ~4 degrees — about 3px of head movement on a
40px avatar. Invisible. The performance is now STAGED, and the
stages line up with the drink count and the cutoff:

  BUZZED  (after 1 drink)      lean 3.5 deg, gentle bob
  TIPSY   (decaying / between) sway 8 deg, stumble pulses,
                               *hic* floaters, weaving walk
  DRUNK   (after 2 drinks)     sway 13 deg + drift, 10 deg
                               stumble lurches, knee-bob,
                               hiccups and sparkles floaters

The CUTOFF now triggers at the DRUNK stage itself (>= 0.66):
he refuses you when the whole room can SEE you are drunk.
Water still takes 0.55 off — you visibly sober down through
the stages as you drink it.

Still 100% in SpriteAvatarBase: every avatar, made or unmade,
performs all three stages with zero per-model wiring. Remote
players perform on your screen from your local buzz ledger,
and you perform on theirs.

Cumulative with bartender v7.3 + drunk v1/v2. Extract, push.
