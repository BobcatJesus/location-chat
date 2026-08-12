import { describe, it, expect, beforeEach } from 'vitest';
import {
  ROOMS,
  USER_CREATED_ROOMS,
  getAllRooms,
  getRoomForCoordinates,
  findRoomByLocation,
  createUserRoom,
} from '../rooms/rooms.js';

describe('getAllRooms', () => {
  it('includes system rooms', () => {
    const all = getAllRooms();
    expect(all.some(r => r.id === 'downtown-hub')).toBe(true);
    expect(all.some(r => r.id === 'forest-gate')).toBe(true);
  });

  it('returns at least 4 rooms', () => {
    expect(getAllRooms().length).toBeGreaterThanOrEqual(4);
  });
});

describe('findRoomByLocation', () => {
  it('returns null when outside all rooms', () => {
    // Middle of the ocean
    expect(findRoomByLocation(0, 0)).toBeNull();
  });

  it('matches Downtown Plaza when standing inside it', () => {
    const result = findRoomByLocation(29.7604, -95.3698);
    expect(result).not.toBeNull();
    expect(result.room.id).toBe('downtown-hub');
    expect(result.distance).toBeLessThanOrEqual(200);
  });

  it('returns distance in metres rounded to integer', () => {
    const result = findRoomByLocation(29.7604, -95.3698);
    expect(Number.isInteger(result.distance)).toBe(true);
  });
});

describe('getRoomForCoordinates', () => {
  it('returns null outside all rooms', () => {
    expect(getRoomForCoordinates(0, 0)).toBeNull();
  });

  it('returns the room object when inside a room', () => {
    const room = getRoomForCoordinates(29.7604, -95.3698);
    expect(room).toBeDefined();
    expect(room.id).toBe('downtown-hub');
  });
});

describe('createUserRoom', () => {
  it('adds a new room to USER_CREATED_ROOMS', () => {
    const before = USER_CREATED_ROOMS.length;
    createUserRoom({ id: 'test-room', name: 'Test', lat: 1, lng: 1, contributor: 'tester' });
    expect(USER_CREATED_ROOMS.length).toBe(before + 1);
  });

  it('uses anonymous contributor when none provided', () => {
    const room = createUserRoom({ id: 'anon-room', name: 'Anon', lat: 2, lng: 2 });
    expect(room.contributors).toContain('anonymous');
  });

  it('sets default radiusMeters to 50', () => {
    const room = createUserRoom({ id: 'radius-test', name: 'R', lat: 3, lng: 3 });
    expect(room.radiusMeters).toBe(50);
  });
});
