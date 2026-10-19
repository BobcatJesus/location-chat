SIDE QUEST — DRUNKENNESS ANIMATION v1

WHERE IT LIVES: SpriteAvatarBase, right next to playDrink. That
is the shared base every avatar is built on — demon, bunny,
gator, and every avatar drawn in the future inherits the drunk
performance automatically. Zero per-model wiring: the sway
rotates the whole sprite around its foot pivot, so there is no
face position or fill table to extend for new models.

THE PERFORMANCE (setDrunkenness, 0 sober -> 1 wobbly):
- a slow lean/sway from the feet, plus an occasional stumble
- a faint extra bob; hiccups (*hic* floaters) at level >= 0.5
- pauses politely while playDrink owns the sprite

THE BUZZ (VillageScene): each finished drink adds ~1/3 of the
meter and it drains over ~4 minutes. Applies to you AND to any
player you watch drink (player_drank relay). Bartender exempt —
a professional.

NOT INCLUDED (still his call from the original pitch): the
bartender cutting you off at the cap, and free water that
sobers you faster. This kit is the animation + meter only.

Cumulative with bartender v7.3. Extract over repo root, push.
