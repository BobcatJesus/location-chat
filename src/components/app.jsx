import React, { useState } from 'react';
import RetroAuthModal from './RetroAuthModal';
import SpatialCanvas from './SpatialCanvas';
import { useGeofencedMap } from '../hooks/UseGeofencingApp';
import { createUserRoom, findRoomByLocation, getAllRooms } from '../../rooms/rooms.js';
import { getDistanceMeters } from '../geo';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profile, setProfile] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState('downtown-hub');
  const [activeScene, setActiveScene] = useState('world');
  const { location, currentVenue, isInsideVenue, error, isLocating } = useGeofencedMap('/api/geofence/check');

  const handleLogin = (authProfile) => {
    setProfile(authProfile);
    setIsLoggedIn(true);
  };

  const staticRoomMatch = location ? findRoomByLocation(location.latitude, location.longitude) : null;
  const currentLocationRoom = location
    ? {
        id: 'your-room',
        name: 'Your Room',
        lat: location.latitude,
        lng: location.longitude,
        radiusMeters: 30
      }
    : null;
  const currentLocationMatch = currentLocationRoom && location
    ? {
        room: currentLocationRoom,
        distance: Math.round(getDistanceMeters(location.latitude, location.longitude, currentLocationRoom.lat, currentLocationRoom.lng))
      }
    : null;
  const roomMatch = currentLocationMatch || staticRoomMatch;
  const worldTitle = roomMatch ? `The ${roomMatch.room.name} Overworld` : 'The Lost Overworld';

  const handleCreateRoom = () => {
    if (!location) {
      return;
    }

    const contributorName = profile?.profile?.characterName || profile?.mode || 'guest';
    const newRoom = createUserRoom({
      id: `user-${Date.now()}`,
      name: `${contributorName}'s Spot`,
      lat: location.latitude,
      lng: location.longitude,
      radiusMeters: 60,
      contributor: contributorName
    });

    setSelectedRoom(newRoom.id);
    setActiveScene('room');
  };

  const roomCards = [
    {
      id: 'your-room',
      name: 'Your Room',
      icon: '🏠',
      blurb: 'This uses your current GPS position as a room.',
      status: location ? 'Current position' : 'Waiting for GPS'
    },
    ...getAllRooms().map((room) => ({
      id: room.id,
      name: room.name,
      icon: room.kind === 'user-created' ? '🗺️' : '🏛️',
      blurb: room.kind === 'user-created'
        ? `Community space contributed by ${room.contributors.join(', ')}`
        : 'GPS-anchored realm ready for discovery',
      status: roomMatch?.room?.id === room.id ? 'Nearby' : room.kind === 'user-created' ? 'Community room' : 'Ready'
    }))
  ];

  const activeRoom = roomCards.find((room) => room.id === selectedRoom) || roomMatch?.room || roomCards[0];
  const activeRoomSummary = selectedRoom === 'your-room'
    ? 'You are now standing inside your own room.'
    : roomMatch?.room?.id === selectedRoom
      ? `You are close enough to enter ${activeRoom.name}.`
      : `You have selected ${activeRoom.name}.`;
  const activeRoomScene = selectedRoom === 'your-room'
    ? {
        title: 'Your Room',
        mood: 'A retro top-down simulacrum of your current space, drawn in simple pixel tones.',
        accent: '#38bdf8',
        tile: '▣▣▣\n▣▓▓▣\n▣▣▣'
      }
    : getAllRooms().find((room) => room.id === selectedRoom)
      ? {
          title: activeRoom.name,
          mood: activeRoom.name === "Campfire Circle" || activeRoom.name === "Guest's Spot"
            ? 'A community hearth glows warmly in a tiny top-down map of the gathering place.'
            : 'A retro map of the real location, rendered as a simple blocky landscape.',
          accent: '#fbbf24',
          tile: '◼◻◼\n◻◼◻\n◼◻◼'
        }
      : {
          title: 'The Threshold',
          mood: 'A quiet border between the map and the place you are about to enter.',
          accent: '#64748b',
          tile: '◻◻◻\n◻◼◻\n◻◻◻'
        };
  const presentDistance = roomMatch ? roomMatch.distance : null;

  const handleEnterRoom = (roomId) => {
    setSelectedRoom(roomId);
    setActiveScene('room');
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)', color: '#f8fafc', fontFamily: 'monospace' }}>
      {!isLoggedIn && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 99999
          }}
        >
          <RetroAuthModal onLogin={handleLogin} />
        </div>
      )}

      {isLoggedIn && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 20, boxSizing: 'border-box', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #64748b', paddingBottom: 8 }}>
            <div>
              <div style={{ fontSize: 12, color: '#fbbf24', letterSpacing: 2, textTransform: 'uppercase' }}>Legend of the Local</div>
              <h1 style={{ margin: '4px 0 0', fontSize: 24 }}>{worldTitle}</h1>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: '#cbd5e1' }}>
              <div>{profile?.mode === 'guest' ? 'Guest Traveler' : profile?.profile?.characterName || profile?.profile?.email || 'Traveler'}</div>
              <div>{isLocating ? 'Scanning the land…' : isInsideVenue ? 'Within the sacred bounds' : 'Outside the marked realm'}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
            {activeScene === 'world' ? (
              <div style={{ flex: 1, border: '2px solid #334155', borderRadius: 12, padding: 12, background: '#111827', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 12, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 2 }}>Choose Your Realm</div>
                  <button
                    onClick={handleCreateRoom}
                    style={{ border: '1px solid #fbbf24', background: 'transparent', color: '#fef3c7', padding: '6px 10px', borderRadius: 6, cursor: 'pointer' }}
                  >
                    Contribute this spot
                  </button>
                </div>
                {isLocating && (
                  <div style={{ border: '1px dashed #64748b', borderRadius: 8, padding: 10, color: '#cbd5e1', fontSize: 13 }}>
                    Scanning for your current position… this can take a moment if GPS is still locking on.
                  </div>
                )}
                <div style={{ display: 'grid', gap: 10 }}>
                  {roomCards.map((room) => (
                    <div
                      key={room.id}
                      onClick={() => handleEnterRoom(room.id)}
                      style={{
                        border: room.id === activeRoom.id ? '1px solid #fbbf24' : '1px solid #475569',
                        borderRadius: 10,
                        padding: 12,
                        background: room.id === activeRoom.id ? '#1e3a2f' : '#0f172a',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ fontSize: 24 }}>{room.icon}</div>
                        <div>
                          <div style={{ fontWeight: 'bold' }}>{room.name}</div>
                          <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>{room.blurb}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 6 }}>{room.status}</div>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleEnterRoom(room.id);
                          }}
                          style={{ border: '1px solid #fbbf24', background: 'transparent', color: '#fef3c7', padding: '6px 10px', borderRadius: 6, cursor: 'pointer' }}
                        >
                          Enter
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, border: '2px solid #334155', borderRadius: 12, padding: 12, background: '#111827', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 12, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 2 }}>Live Room</div>
                  <button
                    onClick={() => setActiveScene('world')}
                    style={{ border: '1px solid #fbbf24', background: 'transparent', color: '#fef3c7', padding: '6px 10px', borderRadius: 6, cursor: 'pointer' }}
                  >
                    Back to rooms
                  </button>
                </div>
                <div style={{ flex: 1, border: '1px solid #475569', borderRadius: 10, padding: 12, background: 'linear-gradient(180deg, #1f2937 0%, #111827 100%)' }}>
                  <SpatialCanvas room={activeRoom} profile={profile} onLeave={() => setActiveScene('world')} />
                </div>
              </div>
            )}

            <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ border: `2px solid ${activeRoomScene.accent}`, borderRadius: 12, padding: 12, background: '#0f172a' }}>
                <div style={{ fontSize: 12, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>Room Scene</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 6 }}>{activeRoomScene.title}</div>
                <div style={{ margin: '8px 0', padding: '10px', borderRadius: 8, background: '#111827', fontFamily: 'monospace', fontSize: 20, letterSpacing: 2, color: '#fef3c7', whiteSpace: 'pre' }}>
                  {activeRoomScene.tile}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: '#cbd5e1' }}>{activeRoomScene.mood}</div>
              </div>

              <div style={{ border: '1px solid #475569', borderRadius: 12, padding: 12, background: '#0f172a' }}>
                <div style={{ fontSize: 12, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 6 }}>Current Quest</div>
                <div style={{ fontSize: 14 }}>
                  {activeRoomSummary}
                </div>
              </div>

              <div style={{ border: '1px solid #475569', borderRadius: 12, padding: 12, background: '#0f172a' }}>
                <div style={{ fontSize: 12, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>Location Status</div>
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                  <div><strong>Status:</strong> {isLocating ? 'Locating...' : isInsideVenue ? 'Inside verified venue' : 'Outside venue'}</div>
                  <div><strong>GPS:</strong> {location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : 'Waiting for location'}</div>
                  <div><strong>Venue:</strong> {currentVenue?.name || 'No venue detected'}</div>
                  <div><strong>Room Match:</strong> {roomMatch ? roomMatch.room.name : 'No room nearby'}</div>
                  <div><strong>Present Distance:</strong> {presentDistance !== null ? `${Math.round(presentDistance)}m` : '—'}</div>
                  {error && <div style={{ color: '#fca5a5', marginTop: 6 }}>{error}</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;


