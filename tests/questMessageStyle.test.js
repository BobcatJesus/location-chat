// questMessageStyle.test.js — Quest messages mobile v1.1
// (`sq-quest-messages-mobile-v1.1`). Pure style selection for the
// quest banner + toast: narrow screens get smaller boxes and drop
// the banner description line; desktop keeps the exact top-right v1
// values.

import { describe, it, expect } from 'vitest';
import {
  QUEST_MESSAGE_NARROW_PX,
  isNarrowQuestViewport,
  questMessageStyles,
} from '../src/village/questMessageStyle.js';

describe('isNarrowQuestViewport', () => {
  it('uses the 640px mobile threshold', () => {
    expect(QUEST_MESSAGE_NARROW_PX).toBe(640);
    expect(isNarrowQuestViewport(640)).toBe(true);
    expect(isNarrowQuestViewport(641)).toBe(false);
    expect(isNarrowQuestViewport(390)).toBe(true);
    expect(isNarrowQuestViewport(1024)).toBe(false);
  });
});

describe('questMessageStyles', () => {
  it('shrinks the banner + toast on narrow screens and drops the description', () => {
    const s = questMessageStyles(true);
    expect(s.bannerWidth).toBe('min(260px, calc(100vw - 24px))');
    expect(s.bannerFontSize).toBe(13);
    expect(s.bannerTitleFontSize).toBe(14);
    expect(s.bannerPadding).toBe('8px 10px');
    expect(s.toastMaxWidth).toBe('min(260px, calc(100vw - 24px))');
    expect(s.toastFontSize).toBe(13);
    expect(s.toastPadding).toBe('8px 10px');
    expect(s.showDescription).toBe(false);
  });

  it('keeps the exact top-right v1 desktop values', () => {
    const s = questMessageStyles(false);
    expect(s.bannerWidth).toBe('min(360px, calc(100vw - 24px))');
    expect(s.bannerFontSize).toBe(15);
    expect(s.bannerTitleFontSize).toBe(16);
    expect(s.bannerPadding).toBe('10px 14px');
    expect(s.toastMaxWidth).toBe('min(360px, calc(100vw - 24px))');
    expect(s.toastFontSize).toBe(16);
    expect(s.toastPadding).toBe('10px 14px');
    expect(s.showDescription).toBe(true);
  });
});
