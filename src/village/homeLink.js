// Home Link v1 (`sq-home-link-v1`): the map's "⌂ Home" link takes you
// back to the RetroLandingPage. The landing used to render only when
// logged out (`!isLoggedIn && showLanding`), so a signed-in player
// could never get back to it. The gate is now `showLanding` PLUS
// "either logged out, or the player asked for the landing from the
// map" — the `homeLandingOpen` flag. That flag matters: `showLanding`
// starts `true` and `isLoggedIn` starts `false` (the saved session is
// restored after first paint), so gating on `showLanding` alone would
// flash — or stick — the landing in front of every returning signed-in
// player. The flag is only ever set by the Home link, and cleared by
// Enter, by any landing room shortcut, and by logout.

export const HOME_LINK_MARKER_V1 = 'sq-home-link-v1';

// Should the RetroLandingPage render? Pure truth table, tested in
// tests/homeLink.test.js.
export function shouldShowLanding({ isLoggedIn, showLanding, homeLandingOpen }) {
  return Boolean(showLanding && (!isLoggedIn || homeLandingOpen));
}

// How does a landing room shortcut open its room?
//  - signed in  -> 'direct': call handleEnterRoom right away. The
//    old ?openRoom= URL-param trick only works through the login
//    transition (the openRoom effect fires when isLoggedIn flips);
//    a signed-in player tapping a shortcut would set the URL and
//    nothing would happen, because no effect dep changes.
//  - logged out -> 'url-param': keep the existing flow — the param
//    survives the auth modal and the openRoom effect enters the room
//    once the player logs in.
export function resolveLandingRoomAction({ isLoggedIn }) {
  return isLoggedIn ? 'direct' : 'url-param';
}
