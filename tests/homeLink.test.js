// homeLink.test.js — Home Link v1 (`sq-home-link-v1`).
// Pure-module tests for the landing-page gate and the landing room
// shortcut action: the landing used to render only when logged out,
// so a signed-in player could never get back to it from the map.
// The gate is now `showLanding && (!isLoggedIn || homeLandingOpen)`
// — the flag is set only by the map's "⌂ Home" link.

import { describe, it, expect } from 'vitest';
import {
  HOME_LINK_MARKER_V1,
  shouldShowLanding,
  resolveLandingRoomAction,
} from '../src/village/homeLink.js';

describe('homeLink marker', () => {
  it('exports the v1 marker', () => {
    expect(HOME_LINK_MARKER_V1).toBe('sq-home-link-v1');
  });
});

describe('shouldShowLanding', () => {
  it('shows the landing to a logged-out first visit (unchanged)', () => {
    expect(shouldShowLanding({ isLoggedIn: false, showLanding: true, homeLandingOpen: false })).toBe(true);
  });

  it('hides the landing for a logged-out player who pressed Enter (unchanged)', () => {
    expect(shouldShowLanding({ isLoggedIn: false, showLanding: false, homeLandingOpen: false })).toBe(false);
  });

  it('never shows the landing to a returning signed-in player who did not ask for it', () => {
    // showLanding starts true and the saved session is restored
    // after first paint — without the flag, the front door would
    // flash (or stick) in front of every returning session.
    expect(shouldShowLanding({ isLoggedIn: true, showLanding: true, homeLandingOpen: false })).toBe(false);
  });

  it('shows the landing to a signed-in player who tapped Home on the map', () => {
    expect(shouldShowLanding({ isLoggedIn: true, showLanding: true, homeLandingOpen: true })).toBe(true);
  });

  it('hides the landing again once Enter is pressed on it', () => {
    expect(shouldShowLanding({ isLoggedIn: true, showLanding: false, homeLandingOpen: false })).toBe(false);
  });

  it('hides the landing when the flag is set but the page was dismissed', () => {
    expect(shouldShowLanding({ isLoggedIn: true, showLanding: false, homeLandingOpen: true })).toBe(false);
  });
});

describe('resolveLandingRoomAction', () => {
  it('opens the room directly for a signed-in player', () => {
    // The ?openRoom= URL trick only works through the login
    // transition (the openRoom effect fires when isLoggedIn flips);
    // a signed-in player tapping a shortcut would set the URL and
    // nothing would happen, so the shortcut calls handleEnterRoom.
    expect(resolveLandingRoomAction({ isLoggedIn: true })).toBe('direct');
  });

  it('keeps the URL-param flow for a logged-out player', () => {
    // The param survives the auth modal and the openRoom effect
    // enters the room once the player logs in.
    expect(resolveLandingRoomAction({ isLoggedIn: false })).toBe('url-param');
  });
});
