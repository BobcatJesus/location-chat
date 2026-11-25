// comicStyle.js — Agora Graphic-Novel Reskin v1 (`sq-agora-reskin-v1`):
// test toggle for the comic-book look (warm, cutesy, Scott Pilgrim /
// Spider-Verse — thick ink outlines, halftone dots, flat bright
// colors). Default OFF: the original look is what players see unless
// the tester flips "🎨 Comic style" in the menu. The flag lives in
// localStorage (per browser, like the onboarding-seen flag), so
// flipping it is instant and reversible — no rebuild, no push, and
// turning it off restores the original exactly.
//
// The room gate lives here as a pure function so it is unit-testable:
// the comic room draws only for the Agora AND the flag on. Every
// other room, and the Agora with the flag off, draw exactly as before.
// The cat frames are selected the same way: comic frames live under
// '<base>-comic' (public/assets/sprites/comic/), originals untouched.

export const COMIC_STYLE_KEY = 'sidequest-comic-test';
export const COMIC_STYLE_MARKER_V1 = 'sq-agora-reskin-v1';

function storage() {
  try {
    const ls = globalThis?.localStorage;
    return ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function' ? ls : null;
  } catch {
    return null;
  }
}

/** True when the comic-style test flag is on. Default OFF. */
export function isComicStyleOn() {
  try {
    return storage()?.getItem(COMIC_STYLE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Flip the test flag. Returns the value written. Never throws. */
export function setComicStyleOn(on) {
  const next = Boolean(on);
  try {
    storage()?.setItem(COMIC_STYLE_KEY, next ? '1' : '0');
  } catch {}
  return next;
}

/** Texture key for a cat frame: comic frames are '<base>-comic'. */
export function comicCatKey(base) {
  return isComicStyleOn() ? `${base}-comic` : base;
}

/** Pure gate: comic room art only for the Agora with the flag on. */
export function isComicRoom(isAgora, comicOn) {
  return Boolean(isAgora && comicOn);
}
