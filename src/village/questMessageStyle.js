// questMessageStyle.js — Quest banner + toast sizing for narrow
// screens (Quest messages mobile v1.1, `sq-quest-messages-mobile-v1.1`).
//
// The top-right banner/toast column is nearly full-width on a phone
// (min(360px, 100vw - 24px)), so moving it out of the centre did not
// shrink it. On narrow screens the boxes get smaller and the banner
// drops its description line (title + reward carry the meaning).
// Pure functions (no React), so they are unit testable — the canvas
// component itself is too heavy to instantiate in vitest.

// Narrow threshold, the same 640px the mobile kits use.
export const QUEST_MESSAGE_NARROW_PX = 640;

export function isNarrowQuestViewport(width) {
  return Number(width) <= QUEST_MESSAGE_NARROW_PX;
}

// Inline-style values for the banner + toast. Desktop returns the
// exact values the top-right v1 kit shipped, so the desktop layout
// is unchanged; narrow returns the smaller set.
export function questMessageStyles(isNarrow) {
  if (isNarrow) {
    return {
      bannerWidth: 'min(260px, calc(100vw - 24px))',
      bannerFontSize: 13,
      bannerTitleFontSize: 14,
      bannerPadding: '8px 10px',
      toastMaxWidth: 'min(260px, calc(100vw - 24px))',
      toastFontSize: 13,
      toastPadding: '8px 10px',
      showDescription: false,
    };
  }
  return {
    bannerWidth: 'min(360px, calc(100vw - 24px))',
    bannerFontSize: 15,
    bannerTitleFontSize: 16,
    bannerPadding: '10px 14px',
    toastMaxWidth: 'min(360px, calc(100vw - 24px))',
    toastFontSize: 16,
    toastPadding: '10px 14px',
    showDescription: true,
  };
}
