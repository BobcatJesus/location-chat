// comicStyle.test.js — Agora Graphic-Novel Reskin v1
// (`sq-agora-reskin-v1`): the test toggle. Default OFF (original look);
// flipping the flag in the menu is instant and reversible — no
// rebuild, no push. The room gate is pure: comic art only for the
// Agora with the flag on.
//
// The module reads globalThis.localStorage (guarded) — tests install
// the same Map-backed stub the bread-shop tests use. The no-storage
// path (SSR / deleted storage) must never throw.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  COMIC_STYLE_KEY,
  COMIC_STYLE_MARKER_V1,
  isComicStyleOn,
  setComicStyleOn,
  comicCatKey,
  isComicRoom,
} from '../src/village/comicStyle.js';

function makeLocalStorageStub() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

const savedLocalStorage = globalThis.localStorage;

beforeEach(() => {
  globalThis.localStorage = makeLocalStorageStub();
});

afterEach(() => {
  globalThis.localStorage = savedLocalStorage;
});

describe('flag', () => {
  it('carries the v1 marker', () => {
    expect(COMIC_STYLE_MARKER_V1).toBe('sq-agora-reskin-v1');
  });

  it('defaults OFF — the original look is what players see', () => {
    expect(isComicStyleOn()).toBe(false);
  });

  it('set on/off round-trips through the flag key', () => {
    expect(setComicStyleOn(true)).toBe(true);
    expect(isComicStyleOn()).toBe(true);
    expect(globalThis.localStorage.getItem(COMIC_STYLE_KEY)).toBe('1');
    expect(setComicStyleOn(false)).toBe(false);
    expect(isComicStyleOn()).toBe(false);
    expect(globalThis.localStorage.getItem(COMIC_STYLE_KEY)).toBe('0');
  });

  it('ignores a junk stored value (only exactly "1" is on)', () => {
    globalThis.localStorage.setItem(COMIC_STYLE_KEY, 'yes');
    expect(isComicStyleOn()).toBe(false);
  });

  it('never throws with no storage at all', () => {
    globalThis.localStorage = undefined;
    expect(() => isComicStyleOn()).not.toThrow();
    expect(isComicStyleOn()).toBe(false);
    expect(() => setComicStyleOn(true)).not.toThrow();
  });
});

describe('cat keys', () => {
  it('uses the original frames when off', () => {
    expect(comicCatKey('cat-side')).toBe('cat-side');
    expect(comicCatKey('cat-sleep')).toBe('cat-sleep');
  });

  it('uses the comic frames when on', () => {
    setComicStyleOn(true);
    expect(comicCatKey('cat-side')).toBe('cat-side-comic');
    expect(comicCatKey('cat-sleep')).toBe('cat-sleep-comic');
  });
});

describe('room gate', () => {
  it('comic only for the Agora with the flag on', () => {
    expect(isComicRoom(true, true)).toBe(true);
  });

  it('Agora with the flag off draws the original', () => {
    expect(isComicRoom(true, false)).toBe(false);
  });

  it('any other room with the flag on draws the original', () => {
    expect(isComicRoom(false, true)).toBe(false);
  });
});
