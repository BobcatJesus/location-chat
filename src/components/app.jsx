import React, { useState } from 'react';
import RetroAuthModal from './RetroAuthModal';
import SpatialCanvas from './SpatialCanvas';
import MapView from './MapView';
import { AVATAR_SKINS } from './SpatialCanvas';
import { useGeofencedMap } from '../hooks/UseGeofencingApp';
import { createUserRoom, loadUserRooms, acceptRoomInvite, findRoomByLocation, getAllRooms } from '../../rooms/rooms.js';
import { getDistanceMeters } from '../geo';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profile, setProfile] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState('downtown-hub');
  const [activeScene, setActiveScene] = useState('world');
  const [gpsToast, setGpsToast] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editForm, setEditForm] = useState({ characterName: '', photo: null });
  const editFileRef = React.useRef(null);
  const [osmRoom, setOsmRoom] = useState(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [inviteToast, setInviteToast] = useState(null);

  const openEditProfile = () => {
    setEditForm({
      characterName: profile?.profile?.characterName || '',
      photo: profile?.profile?.photo || null,
      skinId: profile?.profile?.skinId || 'blue',
    });
    setEditingProfile(true);
  };

  const handleEditPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const size = 96;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        setEditForm(f => ({ ...f, photo: canvas.toDataURL('image/jpeg', 0.7) }));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const saveEditProfile = () => {
    const updated = { ...profile.profile, characterName: editForm.characterName.trim() || profile.profile.characterName, photo: editForm.photo, skinId: editForm.skinId || 'blue' };
    localStorage.setItem('sidequest_profile', JSON.stringify(updated));
    setProfile({ ...profile, profile: updated });
    setEditingProfile(false);
  };
  const { location, currentVenue, isInsideVenue, error, isLocating } = useGeofencedMap('/api/geofence/check');

  const handleLogin = (authProfile) => {
    setProfile(authProfile);
    setIsLoggedIn(true);
    const uid = authProfile?.profile?.email || authProfile?.mode || 'guest';
    loadUserRooms(uid);
    // Accept invite from URL if present
    try {
      const params = new URLSearchParams(window.location.search);
      const inv = params.get('invite');
      if (inv) {
        const room = JSON.parse(atob(inv));
        acceptRoomInvite(room, uid);
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch {}
  };

  const handleLogout = () => {
    localStorage.removeItem('sidequest_profile');
    setIsLoggedIn(false);
    setProfile(null);
    setActiveScene('world');
  };

  const staticRoomMatch = location ? findRoomByLocation(location.latitude, location.longitude) : null;
  const roomMatch = staticRoomMatch;
  const worldTitle = roomMatch ? `The ${roomMatch.room.name} Overworld` : 'The Lost Overworld';

  const handleCreateRoom = () => {
    if (!location) return;
    setNewRoomName('');
    setCreatingRoom(true);
  };

  const confirmCreateRoom = () => {
    const contributorName = profile?.profile?.characterName || profile?.mode || 'guest';
    const ownerId = profile?.profile?.email || profile?.mode || 'guest';
    const roomName = newRoomName.trim() || `${contributorName}'s Spot`;
    const newRoom = createUserRoom({
      id: `user-${Date.now()}`,
      name: roomName,
      lat: location.latitude,
      lng: location.longitude,
      radiusMeters: 60,
      contributor: contributorName,
      ownerId,
    });
    setCreatingRoom(false);
    setSelectedRoom(newRoom.id);
    setActiveScene('room');
  };

  const roomCards = [
    ...getAllRooms().map((room) => ({
      id: room.id,
      name: room.name,
      kind: room.kind,
      icon: room.kind === 'user-created' ? '🔥' : { 'starbucks-spring': '☕', 'agora-houston': '🍷', 'downtown-hub': '🏙️', 'forest-gate': '🌲', 'sunset-temple': '⛩️' }[room.id] || '🏛️',
      blurb: room.kind === 'user-created'
        ? `Community space · ${room.contributors.join(', ')}`
        : `GPS-anchored · ${room.radiusMeters}m radius`,
      status: roomMatch?.room?.id === room.id ? '✦ You are here' : room.kind === 'user-created' ? 'Community' : 'GPS room',
      accent: room.kind === 'user-created' ? '#f97316' : { 'starbucks-spring': '#00704a', 'agora-houston': '#9333ea', 'downtown-hub': '#60a5fa', 'forest-gate': '#4ade80', 'sunset-temple': '#f472b6' }[room.id] || '#a78bfa',
      bg: room.kind === 'user-created'
        ? 'linear-gradient(135deg, #1a0e00 0%, #0f172a 100%)'
        : { 'starbucks-spring': 'linear-gradient(135deg, #00160e 0%, #0f172a 100%)', 'agora-houston': 'linear-gradient(135deg, #1a0028 0%, #0f172a 100%)', 'downtown-hub': 'linear-gradient(135deg, #0a1628 0%, #0f172a 100%)', 'forest-gate': 'linear-gradient(135deg, #0a1a0e 0%, #0f172a 100%)', 'sunset-temple': 'linear-gradient(135deg, #1a0a14 0%, #0f172a 100%)' }[room.id] || 'linear-gradient(135deg, #120a1a 0%, #0f172a 100%)',
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

  const handleEnterRoom = (roomId, poiMeta = null) => {
    // GPS rooms are blocked if outside radius
    if (!poiMeta) {
      const allRooms = getAllRooms();
      const target = allRooms.find(r => r.id === roomId);
      if (target && target.kind === 'gps' && location) {
        const dist = getDistanceMeters(location.latitude, location.longitude, target.lat, target.lng);
        if (dist > target.radiusMeters) {
          setGpsToast(`You need to be within ${target.radiusMeters}m of ${target.name} to enter. You are ${Math.round(dist)}m away.`);
          setTimeout(() => setGpsToast(null), 3500);
          return;
        }
      }
    }
    if (poiMeta) setOsmRoom(poiMeta);
    else setOsmRoom(null);
    setSelectedRoom(roomId);
    setActiveScene('room');
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)', color: '#f8fafc', fontFamily: 'monospace' }}>

      {/* GPS block toast */}
      {gpsToast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: '#1e293b', border: '2px solid #ef4444', color: '#fca5a5', padding: '10px 20px', fontFamily: 'Courier New', fontSize: 13, maxWidth: 360, textAlign: 'center', boxShadow: '0 4px 20px #000' }}>
          📍 {gpsToast}
        </div>
      )}

      {/* Edit profile modal */}
      {editingProfile && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setEditingProfile(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', border: '4px solid #fff', padding: 4, maxWidth: 360, width: '100%', margin: 16, boxShadow: '8px 8px 0 #000' }}>
            <div style={{ border: '2px solid #3b82f6', padding: 24, background: '#0f172a', color: '#fff', fontFamily: 'Courier New, monospace' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 12, borderBottom: '2px solid #1e293b' }}>
                <h2 style={{ margin: 0, color: '#fbbf24', fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.1em' }}>✏️ Edit Profile</h2>
                <button onClick={() => setEditingProfile(false)} style={{ background: 'none', border: 'none', color: '#64748b', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'Courier New', fontSize: 14 }}>[X]</button>
              </div>

              {/* Photo */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 6 }}>Profile Photo</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {editForm.photo
                    ? <img src={editForm.photo} alt="preview" style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid #fbbf24', objectFit: 'cover' }} />
                    : <div style={{ width: 48, height: 48, borderRadius: '50%', border: '2px dashed #475569', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>👤</div>
                  }
                  <button type="button" onClick={() => editFileRef.current?.click()}
                    style={{ flex: 1, padding: '8px 10px', background: 'transparent', border: '2px solid #475569', color: '#94a3b8', fontFamily: 'Courier New, monospace', fontSize: 12, cursor: 'pointer' }}>
                    {editForm.photo ? 'Change photo' : 'Upload photo'}
                  </button>
                  {editForm.photo && (
                    <button type="button" onClick={() => setEditForm(f => ({ ...f, photo: null }))}
                      style={{ padding: '8px 10px', background: 'transparent', border: '2px solid #475569', color: '#64748b', fontFamily: 'Courier New, monospace', fontSize: 12, cursor: 'pointer' }}>✕</button>
                  )}
                  <input ref={editFileRef} type="file" accept="image/*" onChange={handleEditPhoto} style={{ display: 'none' }} />
                </div>
              </div>

              {/* Name */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 6 }}>Display Name</label>
                <input type="text" value={editForm.characterName} onChange={e => setEditForm(f => ({ ...f, characterName: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box', background: '#000', border: '2px solid #475569', padding: '8px 10px', color: '#fbbf24', fontFamily: 'Courier New, monospace', fontSize: 13, outline: 'none' }} />
              </div>

              {/* Avatar skin */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 8 }}>Avatar Style</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {AVATAR_SKINS.map(skin => (
                    <div key={skin.id} onClick={() => setEditForm(f => ({ ...f, skinId: skin.id }))}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', opacity: editForm.skinId === skin.id ? 1 : 0.5 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: skin.swatch, border: editForm.skinId === skin.id ? '3px solid #fbbf24' : '3px solid transparent', boxShadow: editForm.skinId === skin.id ? `0 0 8px ${skin.swatch}` : 'none' }} />
                      <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase' }}>{skin.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={saveEditProfile}
                style={{ width: '100%', padding: '12px 0', background: '#16a34a', border: '2px solid #000', boxShadow: '2px 2px 0 #000', color: '#fff', fontWeight: 'bold', fontFamily: 'Courier New, monospace', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
                ✓ Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Create room name prompt */}
      {creatingRoom && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setCreatingRoom(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', border: '4px solid #fbbf24', padding: 28, maxWidth: 320, width: '100%', margin: 16, boxShadow: '8px 8px 0 #000', fontFamily: 'Courier New, monospace' }}>
            <div style={{ color: '#fbbf24', fontSize: 13, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16 }}>📍 Name Your Space</div>
            <input
              autoFocus
              type="text"
              placeholder="e.g. Rooftop Hangout"
              value={newRoomName}
              onChange={e => setNewRoomName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmCreateRoom()}
              maxLength={32}
              style={{ width: '100%', boxSizing: 'border-box', background: '#000', border: '2px solid #475569', padding: '10px 12px', color: '#f8fafc', fontFamily: 'Courier New, monospace', fontSize: 14, outline: 'none', marginBottom: 16 }}
            />
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 16 }}>This room will be anchored to your current GPS position. Only you can see it unless you share an invite link.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirmCreateRoom} style={{ flex: 1, padding: '10px 0', background: '#16a34a', border: '2px solid #000', boxShadow: '2px 2px 0 #000', color: '#fff', fontWeight: 'bold', fontFamily: 'Courier New, monospace', fontSize: 12, cursor: 'pointer', textTransform: 'uppercase' }}>
                Create
              </button>
              <button onClick={() => setCreatingRoom(false)} style={{ padding: '10px 16px', background: 'none', border: '2px solid #334155', color: '#94a3b8', fontFamily: 'Courier New, monospace', fontSize: 12, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite copied toast */}
      {inviteToast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: '#16a34a', border: '2px solid #000', color: '#fff', padding: '10px 20px', fontFamily: 'Courier New', fontSize: 13, boxShadow: '0 4px 20px #000' }}>
          ✓ Invite link copied!
        </div>
      )}

      {!isLoggedIn && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
          }}
        >
          <RetroAuthModal onLogin={handleLogin} />
        </div>
      )}

      {isLoggedIn && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 20, boxSizing: 'border-box', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #64748b', paddingBottom: 8 }}>
            <div>
              <div style={{ fontSize: 12, color: '#fbbf24', letterSpacing: 2, textTransform: 'uppercase' }}>Side Quest</div>
              <h1 style={{ margin: '4px 0 0', fontSize: 24 }}>{worldTitle}</h1>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: '#cbd5e1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                {profile?.profile?.photo && (
                  <img src={profile.profile.photo} alt="profile" style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid #fbbf24' }} />
                )}
                <div style={{ color: '#fbbf24', fontWeight: 'bold' }}>
                  {profile?.mode === 'guest' ? 'Guest Traveler' : profile?.profile?.characterName || profile?.profile?.email?.split('@')[0] || 'Traveler'}
                </div>
                <button onClick={openEditProfile} style={{ background: 'none', border: '1px solid #334155', color: '#94a3b8', fontSize: 10, cursor: 'pointer', padding: '1px 5px', fontFamily: 'monospace' }}>
                  edit
                </button>
              </div>
              <div>{isLocating ? 'Scanning the land…' : isInsideVenue ? 'Within the sacred bounds' : 'Outside the marked realm'}</div>
              <button onClick={handleLogout} style={{ marginTop: 4, background: 'none', border: '1px solid #334155', color: '#475569', fontSize: 10, cursor: 'pointer', padding: '2px 6px', fontFamily: 'monospace', textTransform: 'uppercase' }}>
                Log out
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
            {activeScene === 'world' ? (
              /* Map view fills the main area */
              <div style={{ flex: 1, borderRadius: 12, overflow: 'hidden', border: '2px solid #334155', position: 'relative' }}>
                <MapView
                  key="world-map"
                  location={location}
                  rooms={getAllRooms().map(r => ({ ...r, radiusMeters: r.radiusMeters || 100 }))}
                  onEnterRoom={handleEnterRoom}
                />
                {/* Create room at current GPS location */}
                {location && !isLocating ? (
                  <button
                    onClick={handleCreateRoom}
                    style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000, background: '#fbbf24', border: 'none', padding: '8px 14px', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'Courier New', fontSize: 12, boxShadow: '2px 2px 0 #000' }}>
                    + Create room here
                  </button>
                ) : (
                  <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000, background: '#1e293b', border: '1px solid #475569', padding: '8px 14px', fontFamily: 'Courier New', fontSize: 11, color: '#64748b', boxShadow: '2px 2px 0 #000' }}>
                    📍 Waiting for GPS…
                  </div>
                )}
              </div>
            ) : (
              <div style={{ flex: 1, border: '2px solid #334155', borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
                <SpatialCanvas room={osmRoom ? { ...osmRoom, id: osmRoom.id } : activeRoom} profile={profile} onLeave={() => { setActiveScene('world'); setOsmRoom(null); }} />
                {/* Invite button for user-created private rooms */}
                {activeRoom?.kind === 'user-created' && (
                  <button
                    onClick={() => {
                      const link = `${window.location.origin}${window.location.pathname}?invite=${btoa(JSON.stringify(activeRoom))}`;
                      navigator.clipboard.writeText(link).then(() => {
                        setInviteToast(true);
                        setTimeout(() => setInviteToast(null), 2500);
                      });
                    }}
                    style={{ position: 'absolute', top: 12, right: 12, zIndex: 1000, background: '#1e293b', border: '1px solid #fbbf24', color: '#fbbf24', padding: '6px 12px', fontFamily: 'Courier New', fontSize: 11, cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>
                    🔗 Copy invite link
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;


