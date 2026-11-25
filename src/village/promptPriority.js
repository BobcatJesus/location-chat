// promptPriority.js — floating-prompt priority helpers for
// VillageScene. Pure functions (no Phaser), so they are unit
// testable — the scene itself is too heavy to instantiate in
// vitest. Same pattern as movement.js (stuck-drop).

/**
 * Should the hang prompt show? Christmas Quests v1.2
 * (`sq-christmas-multi-v1.2`) + v1.3 (`sq-christmas-lights-v1.3`).
 *
 * The hang spot (the tree, the lights wall) is suppressed whenever
 * the pond, the cat, or a puzzle table is also near — those prompts
 * win. EXCEPT when the player is carrying the thing to hang: with
 * an ornament / a light string in hand, the hang prompt wins over
 * the suppression and shows whenever the player is at the hang
 * spot. Standing at the coffee bar with a string in hand, the game
 * must not go silent about where to hang it.
 *
 * Without anything in hand the old suppression still applies, so
 * the "grab one from the box first" hint stays quiet when
 * something else is nearer.
 *
 * v1.3 (`sq-christmas-lights-v1.3`): `otherCarrying` — the player
 * is holding the OTHER quest's item (a light string while the tree
 * prompt is deciding, or an ornament while the lights prompt is
 * deciding). The east/west light strands pass within the trees'
 * hang ranges, so at the south corner spots both hang prompts
 * could fire at once ("Hang the ornament" / "Grab an ornament
 * from the box first" over "Hang the lights") — contradictory
 * text at the same spot. The item in hand decides: a hang prompt
 * never shows while the other quest's item is being carried.
 */
export function showHangPrompt({ nearHangSpot, nearPond, nearCat, nearTable, carrying, otherCarrying }) {
  return Boolean(
    nearHangSpot && !otherCarrying && (carrying || (!nearPond && !nearCat && !nearTable)),
  );
}
