// app/api/location-chat/route.ts
import { NextResponse } from 'next/server';
import { getInworldConnection } from '@/lib/inworld';

export async function POST(req: Request) {
  const { lat, lng } = await req.json();
  const connection = getInworldConnection();

  const meaning = interpretLocation(lat, lng);

  return new Promise((resolve) => {
    connection.onMessage((msg) => {
      resolve(NextResponse.json({ reply: msg.text }));
    });

    connection.sendText(`Location update: ${meaning}`);
  });
}

function interpretLocation(lat: number, lng: number) {
  // Your zone logic
  if (isInsideZone(lat, lng, 'campus_north')) {
    return 'User entered the North Campus zone.';
  }

  if (isInsideZone(lat, lng, 'danger_area')) {
    return 'User is near the restricted area.';
  }

  return 'User is somewhere else.';
}
// app/api/location-chat/route.ts

const zoneCharacterMap = {
  northCampus: 'north_guide',
  southCampus: 'south_guard',
  warehouse: 'warehouse_ghost',
  riverbank: 'river_historian',
  restricted: 'restricted_officer',
};
import { NextResponse } from 'next/server';
import { getInworldConnection } from '@/lib/inworld';

export async function POST(req: Request) {
  const { lat, lng } = await req.json();

  const zone = getZoneFromLocation(lat, lng);
  const characterId = zoneCharacterMap[zone];

  const connection = getInworldConnection(characterId);

  return new Promise((resolve) => {
    connection.onMessage((msg) => {
      resolve(
        NextResponse.json({
          zone,
          character: characterId,
          reply: msg.text,
        })
      );
    });

    connection.sendText(`User entered zone: ${zone}. React accordingly.`);
  });
}

function getZoneFromLocation(lat: number, lng: number) {
  // Your zone logic here
  if (lat > 29.75 && lng < -95.35) return 'northCampus';
  if (lat > 29.74 && lng < -95.36) return 'southCampus';
  if (lat > 29.73 && lng < -95.37) return 'warehouse';
  if (lat > 29.72 && lng < -95.38) return 'riverbank';
  return 'restricted';
}

const zoneCharacterMap = {
  northCampus: 'north_guide',
  southCampus: 'south_guard',
  warehouse: 'warehouse_ghost',
  riverbank: 'river_historian',
  restricted: 'restricted_officer',
};
