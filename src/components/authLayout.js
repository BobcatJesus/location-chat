export const MOBILE_AUTH_BREAKPOINT = 980;

export function getAuthLayoutState(width) {
  const viewportWidth = Number(width) || 0;
  const isCompactLayout = viewportWidth < MOBILE_AUTH_BREAKPOINT;

  return {
    isCompactLayout,
    stickyActionBar: isCompactLayout,
    collapseAdvancedByDefault: isCompactLayout,
  };
}
