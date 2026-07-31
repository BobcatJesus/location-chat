import { getRoomForCoordinates } from './rooms/rooms.js';

// Sample test coordinates
const testLocations = [
  {
    name: 'Downtown Plaza (Inside Room Radius)',
    lat: 29.7605, // Very close to target 29.7604
    lng: -95.3697  // Very close to target -95.3698
  },
  {
    name: 'Airport (Far Away / Outside Radius)',
    lat: 29.9902,
    lng: -95.3368
  }
];

console.log('--- GPS Room Lookup Test ---\n');

testLocations.forEach((location) => {
  console.log(`Testing location: ${location.name}`);
  console.log(`Coordinates: (${location.lat}, ${location.lng})`);

  const matchedRoom = getRoomForCoordinates(location.lat, location.lng);

  if (matchedRoom) {
    console.log(` SUCCESS: Joined room "${matchedRoom.name}" (ID: ${matchedRoom.id})\n`);
  } else {
    console.log(` NO ROOM: User is too far away from any active room.\n`);
  }
});

