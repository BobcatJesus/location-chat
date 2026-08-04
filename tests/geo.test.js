import { describe, it, expect } from 'vitest';
import { getDistanceMeters, isWithinRadius } from '../src/geo.js';

describe('getDistanceMeters', () => {
  it('returns 0 for identical coordinates', () => {
    expect(getDistanceMeters(29.76, -95.37, 29.76, -95.37)).toBe(0);
  });

  it('calculates ~111km per degree of latitude', () => {
    const dist = getDistanceMeters(0, 0, 1, 0);
    expect(dist).toBeGreaterThan(110_000);
    expect(dist).toBeLessThan(112_000);
  });

  it('is symmetric', () => {
    const a = getDistanceMeters(29.76, -95.37, 29.77, -95.38);
    const b = getDistanceMeters(29.77, -95.38, 29.76, -95.37);
    expect(a).toBeCloseTo(b, 5);
  });

  it('returns a positive number for different points', () => {
    expect(getDistanceMeters(29.76, -95.37, 29.80, -95.42)).toBeGreaterThan(0);
  });
});

describe('isWithinRadius', () => {
  const lat = 29.7604;
  const lng = -95.3698;

  it('returns true when point is inside radius', () => {
    // Same point — 0 metres away, radius 200m
    expect(isWithinRadius(lat, lng, lat, lng, 200)).toBe(true);
  });

  it('returns false when point is outside radius', () => {
    // ~5km away
    expect(isWithinRadius(lat + 0.05, lng, lat, lng, 200)).toBe(false);
  });

  it('returns true exactly on the boundary', () => {
    const dist = getDistanceMeters(lat, lng, lat + 0.001, lng);
    expect(isWithinRadius(lat + 0.001, lng, lat, lng, Math.ceil(dist))).toBe(true);
  });
});
