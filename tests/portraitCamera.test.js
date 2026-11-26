// portraitCamera.test.js — Portrait fill v1 (`sq-portrait-fill-v1`).
// Pure camera math for the VillageScene: the zoom adapts to the real
// viewport once the canvas stops being a fixed 1600x900 FIT box.
// Desktop 16:9 must resolve to the exact old constants; a portrait
// phone zooms out so a useful slice of the room stays visible.
// Avatar shrink v1 (`sq-avatar-shrink-zoom-v1`): the avatar scale is
// the mode's base scale — no zoom compensation — so the avatar shrinks
// on screen as the zoom drops, like everything else in the room.

import { describe, it, expect } from 'vitest';
import {
  resolveFollowCamera,
  resolveOverviewZoom,
  resolveOverviewAvatarScale,
} from '../src/village/portraitCamera.js';

const AGORA = { boundsW: 1600, boundsH: 900 };

describe('resolveFollowCamera', () => {
  it('desktop 1600x900 follow resolves to the exact old constants', () => {
    const c = resolveFollowCamera({ viewportW: 1600, viewportH: 900, baseZoom: 1.9, baseAvatarScale: 1, ...AGORA });
    expect(c.zoom).toBe(1.9);
    expect(c.avatarScale).toBe(1);
    // Visible world is the same 842x474 slice FIT showed.
    expect(1600 / c.zoom).toBeCloseTo(842, 0);
    expect(900 / c.zoom).toBeCloseTo(474, 0);
  });

  it('desktop 16:9 keeps every camera mode exact', () => {
    const modes = [
      { baseZoom: 2.85, baseAvatarScale: 1.3 },
      { baseZoom: 2.35, baseAvatarScale: 1.18 },
      { baseZoom: 1.9, baseAvatarScale: 1 },
      { baseZoom: 1.45, baseAvatarScale: 1.3 },
    ];
    for (const m of modes) {
      const c = resolveFollowCamera({ viewportW: 1600, viewportH: 900, ...m, ...AGORA });
      expect(c.zoom).toBe(m.baseZoom);
      expect(c.avatarScale).toBe(m.baseAvatarScale);
    }
  });

  it('portrait phone 390x844 zooms out to a 330-wide slice, avatar shrinks with the zoom', () => {
    const c = resolveFollowCamera({ viewportW: 390, viewportH: 844, baseZoom: 1.9, baseAvatarScale: 1, ...AGORA });
    expect(c.zoom).toBeCloseTo(390 / 330, 5);
    expect(390 / c.zoom).toBeCloseTo(330, 5);
    expect(844 / c.zoom).toBeCloseTo(714, 0);
    // Avatar scale is the base now — no compensation — so on screen it
    // is 48 * 1 * (390/330), smaller than desktop follow's 48 * 1 * 1.9.
    expect(c.avatarScale).toBe(1);
    expect(48 * c.avatarScale * c.zoom).toBeCloseTo(48 * (390 / 330), 5);
    expect(48 * c.avatarScale * c.zoom).toBeLessThan(48 * 1.9);
  });

  it('portrait phone applies the same zoom to every follow mode', () => {
    for (const [baseZoom, baseAvatarScale] of [[2.85, 1.3], [2.35, 1.18], [1.45, 1.3]]) {
      const c = resolveFollowCamera({ viewportW: 390, viewportH: 844, baseZoom, baseAvatarScale, ...AGORA });
      expect(c.zoom).toBeCloseTo(390 / 330, 5);
      // Each mode's avatarScale is its base scale; on screen it scales
      // with the zoom (48 * baseAvatarScale * zoom), not the desktop size.
      expect(c.avatarScale).toBe(baseAvatarScale);
      expect(48 * c.avatarScale * c.zoom).toBeCloseTo(48 * baseAvatarScale * (390 / 330), 5);
      expect(48 * c.avatarScale * c.zoom).toBeLessThan(48 * baseAvatarScale * baseZoom);
    }
  });

  it('landscape phone 844x390 keeps a 450-tall slice', () => {
    const c = resolveFollowCamera({ viewportW: 844, viewportH: 390, baseZoom: 1.9, baseAvatarScale: 1, ...AGORA });
    expect(c.zoom).toBeCloseTo(390 / 450, 5);
    expect(390 / c.zoom).toBeCloseTo(450, 5);
    // Avatar scale is the base now, so on screen it is 48 * 1 * (390/450).
    expect(c.avatarScale).toBe(1);
    expect(48 * c.avatarScale * c.zoom).toBeCloseTo(48 * (390 / 450), 5);
  });

  it('ultrawide short window never shows past the room bounds', () => {
    const c = resolveFollowCamera({ viewportW: 2000, viewportH: 400, baseZoom: 1.9, baseAvatarScale: 1, ...AGORA });
    expect(c.zoom).toBeCloseTo(1.25, 5);
    expect(2000 / c.zoom).toBeLessThanOrEqual(1600);
    expect(400 / c.zoom).toBeLessThanOrEqual(900);
  });

  it('tablet portrait keeps the base zoom', () => {
    const c = resolveFollowCamera({ viewportW: 768, viewportH: 1024, baseZoom: 1.9, baseAvatarScale: 1, ...AGORA });
    expect(c.zoom).toBe(1.9);
    expect(c.avatarScale).toBe(1);
  });

  it('small desktop window zooms out to keep the minimum slice', () => {
    const c = resolveFollowCamera({ viewportW: 800, viewportH: 450, baseZoom: 1.9, baseAvatarScale: 1, ...AGORA });
    expect(c.zoom).toBe(1);
    // Avatar scale is the base now (1), not the compensated 1.9.
    expect(c.avatarScale).toBe(1);
    expect(48 * c.avatarScale * c.zoom).toBe(48);
  });

  it('never zooms in past the base zoom on a huge monitor', () => {
    const c = resolveFollowCamera({ viewportW: 3840, viewportH: 2160, baseZoom: 1.9, baseAvatarScale: 1, ...AGORA });
    expect(c.zoom).toBe(1.9);
  });

  it('large outdoor room does not change the portrait zoom', () => {
    const c = resolveFollowCamera({ viewportW: 390, viewportH: 844, baseZoom: 1.9, baseAvatarScale: 1, boundsW: 3600, boundsH: 2400 });
    expect(c.zoom).toBeCloseTo(390 / 330, 5);
  });

  it('landscape phone close mode keeps FITs height, not the 450 floor', () => {
    const c = resolveFollowCamera({ viewportW: 844, viewportH: 390, baseZoom: 2.35, baseAvatarScale: 1.18, ...AGORA });
    expect(c.zoom).toBeCloseTo(390 / (900 / 2.35), 5);
    expect(390 / c.zoom).toBeCloseTo(900 / 2.35, 5);
  });

  it('degenerate viewport stays finite', () => {
    const c = resolveFollowCamera({ viewportW: 0, viewportH: 0, baseZoom: 1.9, baseAvatarScale: 1, ...AGORA });
    expect(Number.isFinite(c.zoom)).toBe(true);
    expect(Number.isFinite(c.avatarScale)).toBe(true);
    expect(c.zoom).toBeGreaterThan(0);
  });
});

describe('resolveOverviewZoom', () => {
  it('desktop fits a 1600x900 room at 1.2, as before', () => {
    expect(resolveOverviewZoom({ viewportW: 1600, viewportH: 900, boundsW: 1600, boundsH: 900 })).toBe(1.2);
  });

  it('portrait phone fits the wide room instead of stopping at the old 0.95 floor', () => {
    const z = resolveOverviewZoom({ viewportW: 390, viewportH: 844, boundsW: 1600, boundsH: 900 });
    expect(z).toBeCloseTo(Math.min(390 / 1600, 844 / 900) * 1.2, 5);
    expect(z).toBeLessThan(0.95);
  });

  it('still caps at 2.4 for a small room', () => {
    expect(resolveOverviewZoom({ viewportW: 1600, viewportH: 900, boundsW: 800, boundsH: 600 })).toBeCloseTo(1.8, 10);
  });
});

describe('resolveOverviewAvatarScale', () => {
  it('desktop overview keeps the old avatar scale', () => {
    expect(resolveOverviewAvatarScale({ fitZoom: 1.2, baseAvatarScale: 1.42 })).toBeCloseTo(1.42, 5);
  });

  it('portrait overview keeps the base avatar scale, so it shrinks with the fit zoom', () => {
    const fitZoom = Math.min(390 / 1600, 844 / 900) * 1.2;
    const s = resolveOverviewAvatarScale({ fitZoom, baseAvatarScale: 1.42 });
    // No compensation: on screen it is 48 * 1.42 * fitZoom, smaller
    // than desktop overview's 48 * 1.42 * 1.2.
    expect(s).toBe(1.42);
    expect(48 * s * fitZoom).toBeLessThan(48 * 1.42 * 1.2);
  });

  it('scale is the base regardless of fit zoom', () => {
    expect(resolveOverviewAvatarScale({ fitZoom: 0.1, baseAvatarScale: 1.42 })).toBe(1.42);
    expect(resolveOverviewAvatarScale({ fitZoom: 2.4, baseAvatarScale: 1.42 })).toBe(1.42);
  });
});
