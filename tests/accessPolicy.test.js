import { describe, expect, it } from 'vitest';
import {
  OPEN_ACCESS_ROOM_IDS,
  getRoomAccessRadius,
  isOpenAccessRoom,
  requiresGpsProximity,
} from '../src/accessPolicy.js';

describe('room access policy', () => {
  it('keeps the featured rooms open without GPS proximity', () => {
    expect(OPEN_ACCESS_ROOM_IDS).toEqual(['md-anderson-library', 'shepherd-park', 'asgard-games']);
    expect(isOpenAccessRoom('md-anderson-library')).toBe(true);
    expect(isOpenAccessRoom('shepherd-park')).toBe(true);
    expect(isOpenAccessRoom('asgard-games')).toBe(true);
    expect(requiresGpsProximity({ id: 'md-anderson-library', radiusMeters: 120 })).toBe(false);
    expect(requiresGpsProximity({ id: 'shepherd-park', radiusMeters: 220 })).toBe(false);
    expect(requiresGpsProximity({ id: 'asgard-games', radiusMeters: 100 })).toBe(false);
  });

  it('keeps ordinary rooms GPS-gated and normalizes radius fields', () => {
    expect(getRoomAccessRadius({ radiusMeters: 60 })).toBe(60);
    expect(getRoomAccessRadius({ radius: 75 })).toBe(75);
    expect(requiresGpsProximity({ id: 'downtown-hub', radiusMeters: 200 })).toBe(true);
    expect(requiresGpsProximity({ id: 'no-radius' })).toBe(false);
  });

  it('Two Places v1: personal places are GPS-gated like any other place', () => {
    // The `home-` open-access exemption is gone: you can only enter
    // your place by being next to it on the map. The server still
    // refuses strangers at the door (owner-only join guard).
    expect(isOpenAccessRoom('home-tfkelleher3-gmail-com')).toBe(false);
    expect(isOpenAccessRoom('home-tfkelleher3-gmail-com_2')).toBe(false);
    expect(requiresGpsProximity({ id: 'home-tfkelleher3-gmail-com', radiusMeters: 60 })).toBe(true);
    expect(requiresGpsProximity({ id: 'home-tfkelleher3-gmail-com_2', radiusMeters: 60 })).toBe(true);
  });
});