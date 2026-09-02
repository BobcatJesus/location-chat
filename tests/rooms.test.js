import { describe, it, expect, beforeEach } from 'vitest';
import {
  ROOMS,
  USER_CREATED_ROOMS,
  getAllRooms,
  getRoomForCoordinates,
  findRoomByLocation,
  createUserRoom,
} from '../rooms/rooms.js';
import { buildAutoLayout } from '../src/village/AutoLayout.js';
import { isOutdoorLocation } from '../src/village/outdoorRoomDetection.js';
import { hasTemporaryAccess } from '../src/components/app.jsx';

describe('getAllRooms', () => {
  it('includes system rooms', () => {
    const all = getAllRooms();
    expect(all.some(r => r.id === 'downtown-hub')).toBe(true);
    expect(all.some(r => r.id === 'forest-gate')).toBe(true);
  });

  it('returns at least 4 rooms', () => {
    expect(getAllRooms().length).toBeGreaterThanOrEqual(4);
  });

  it('includes MD Anderson Library GPS/OSM metadata needed for location-based generation', () => {
    const room = getAllRooms().find((entry) => entry.id === 'md-anderson-library');
    expect(room).toBeDefined();
    expect(room.amenity).toBe('library');
    expect(room.buildingLevels).toBeGreaterThanOrEqual(2);
    expect(room.tags.amenity).toBe('library');
    expect(room.source).toBe('gps+osm');
    expect(Array.isArray(room.roomShape)).toBe(true);
    expect(room.roomShape.length).toBeGreaterThanOrEqual(4);
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

describe('outdoor room detection', () => {
  it('treats forest/nature rooms as outdoor park layouts', () => {
    const layout = buildAutoLayout('forest-gate', 'Forest Gate', '', '');
    expect(layout.id).toContain('auto-park');
  });

  it('allows shepherd park variants to bypass GPS gating for temporary access', () => {
    expect(hasTemporaryAccess('shepherd-park', 'Shepherd Park')).toBe(true);
    expect(hasTemporaryAccess('shepherd_park', 'Shepherd Park')).toBe(true);
    expect(hasTemporaryAccess('shepherd park', 'North Lawn')).toBe(true);
    expect(hasTemporaryAccess('downtown-hub', 'Downtown Plaza')).toBe(false);
  });

  it('treats shepherd park as an outdoor location even when names use separators', () => {
    expect(isOutdoorLocation('shepherd-park', 'Shepherd Park', '', '')).toBe(true);
    expect(isOutdoorLocation('shepherd_park', 'North Lawn', '', '')).toBe(true);
    expect(isOutdoorLocation('downtown-hub', 'Downtown Plaza', '', '')).toBe(false);
  });

  it('uses the park auto-layout when the room ID names the space but the display name is generic', () => {
    const layout = buildAutoLayout('shepherd-park', 'North Lawn', '', '');
    expect(layout.id).toContain('auto-park');
    expect(layout.floors[0].carpet).toBe(0x8bd77a);
    expect(layout.width).toBe(3600);
    expect(layout.height).toBe(2400);
  });

  it("fills Shepherd Park's OSM footprint with trees while keeping the spawn clear", () => {
    const shepherd = getAllRooms().find((entry) => entry.id === 'shepherd-park');
    const layout = buildAutoLayout(shepherd.id, shepherd.name, shepherd.amenity, '', shepherd.roomShape);
    const trees = layout.floors[0].zones.filter((zone) => zone.type === 'tree');

    expect(trees.length).toBeGreaterThan(20);
    expect(trees.every((tree) => Math.hypot(tree.x - layout.spawnF1.x, tree.y - layout.spawnF1.y) >= 240)).toBe(true);
  });

  it('treats green square and lawn names as outdoor park layouts', () => {
    expect(isOutdoorLocation('green-square', 'Green Square', '', '')).toBe(true);
    expect(buildAutoLayout('green-square', 'Green Square', '', '').id).toContain('auto-park');
    expect(hasTemporaryAccess('green-square', 'Green Square')).toBe(true);
  });

  it('includes a shepherd park room in the catalog so it can be entered directly', () => {
    const room = getAllRooms().find((entry) => entry.id === 'shepherd-park');
    expect(room).toBeDefined();
    expect(room.name).toBe('Shepherd Park');
    expect(room.amenity).toBe('park');
  });
});
