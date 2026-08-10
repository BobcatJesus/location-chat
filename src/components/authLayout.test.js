import { describe, expect, it } from 'vitest';
import { getAuthLayoutState, MOBILE_AUTH_BREAKPOINT } from './authLayout';

describe('getAuthLayoutState', () => {
  it('enables compact-safe layout below mobile breakpoint', () => {
    const state = getAuthLayoutState(MOBILE_AUTH_BREAKPOINT - 1);

    expect(state.isCompactLayout).toBe(true);
    expect(state.stickyActionBar).toBe(true);
    expect(state.collapseAdvancedByDefault).toBe(true);
  });

  it('disables compact-only behavior at and above breakpoint', () => {
    const exact = getAuthLayoutState(MOBILE_AUTH_BREAKPOINT);
    const desktop = getAuthLayoutState(1280);

    expect(exact.isCompactLayout).toBe(false);
    expect(exact.stickyActionBar).toBe(false);
    expect(exact.collapseAdvancedByDefault).toBe(false);

    expect(desktop.isCompactLayout).toBe(false);
    expect(desktop.stickyActionBar).toBe(false);
    expect(desktop.collapseAdvancedByDefault).toBe(false);
  });
});
