import { describe, expect, it } from 'vitest';
import {
  OPEN_ACCESS_ROOM_IDS,
  getRoomAccessRadius,
  isOpenAccessRoom,
  requiresGpsProximity,
} from '../src/accessPolicy.js';

describe('room access policy', () => {
  it('keeps the two featured rooms open without GPS proximity', () => {
    expect(OPEN_ACCESS_ROOM_IDS).toEqual(['md-anderson-library', 'shepherd-park']);
    expect(isOpenAccessRoom('md-anderson-library')).toBe(true);
    expect(isOpenAccessRoom('shepherd-park')).toBe(true);
    expect(requiresGpsProximity({ id: 'md-anderson-library', radiusMeters: 120 })).toBe(false);
    expect(requiresGpsProximity({ id: 'shepherd-park', radiusMeters: 220 })).toBe(false);
  });

  it('keeps ordinary rooms GPS-gated and normalizes radius fields', () => {
    expect(getRoomAccessRadius({ radiusMeters: 60 })).toBe(60);
    expect(getRoomAccessRadius({ radius: 75 })).toBe(75);
    expect(requiresGpsProximity({ id: 'downtown-hub', radiusMeters: 200 })).toBe(true);
    expect(requiresGpsProximity({ id: 'no-radius' })).toBe(false);
  });
});