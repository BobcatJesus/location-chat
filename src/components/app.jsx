import React, { useState, lazy, Suspense } from 'react';
import RetroAuthModal from './RetroAuthModal';
import AvatarSetupFields from './AvatarSetupFields';
import { useGeofencedMap } from '../hooks/UseGeofencingApp';
import { createUserRoom, loadUserRooms, acceptRoomInvite, findRoomByLocation, getAllRooms } from '../../rooms/rooms.js';
import { getDistanceMeters } from '../geo';

const VillageCanvas = lazy(() => import('../village/VillageCanvas.jsx'));
const WorldMapCanvas = lazy(() => import('../village/WorldMapCanvas.jsx'));

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const isAvatarOnboardingComplete = (savedProfile) => {
  if (!savedProfile) return false;
  if (savedProfile.avatarOnboardingComplete === true) return true;
  return hasText(savedProfile.firstName)
    && hasText(savedProfile.characterName)
    && hasText(savedProfile.skinId)
    && hasText(savedProfile.hairStyle)
    && hasText(savedProfile.bodyType);
};

const migrateProfileForAvatar = (savedProfile) => {
  const profile = savedProfile || {};
  const emailStem = (profile.email || 'traveler').split('@')[0] || 'traveler';
  const migrated = {
    ...profile,
    characterName: hasText(profile.characterName) ? profile.characterName : emailStem,
    skinId: hasText(profile.skinId) ? profile.skinId : 'blue',
    hairStyle: hasText(profile.hairStyle) ? profile.hairStyle : 'short',
    bodyType: hasText(profile.bodyType) ? profile.bodyType : 'standard',
  };

  const changed = (
    migrated.characterName !== profile.characterName
    || migrated.skinId !== profile.skinId
    || migrated.hairStyle !== profile.hairStyle
    || migrated.bodyType !== profile.bodyType
  );

  return { migrated, changed };
};

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profile, setProfile] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState('downtown-hub');
  const [activeScene, setActiveScene] = useState('world');
  const [gpsToast, setGpsToast] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [editForm, setEditForm] = useState({
    characterName: '',
    firstName: '',
    photo: null,
    skinId: 'blue',
    hairStyle: 'short',
    bodyType: 'standard',
  });
  const [osmRoom, setOsmRoom] = useState(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomCategory, setNewRoomCategory] = useState('social');
  const [newRoomPublic, setNewRoomPublic] = useState(false);
  const [inviteToast, setInviteToast] = useState(null);

  const openEditProfile = () => {
    setEditForm({
      characterName: profile?.profile?.characterName || '',
      firstName: profile?.profile?.firstName || '',
      photo: profile?.profile?.photo || null,
      skinId: profile?.profile?.skinId || 'blue',
      hairStyle: profile?.profile?.hairStyle || 'short',
      bodyType: profile?.profile?.bodyType || 'standard',
    });
    setProfileError(null);
    setEditingProfile(true);
  };

  const startAvatarOnboarding = (authProfile) => {
    const p = authProfile?.profile || {};
    setEditForm({
      characterName: p.characterName || '',
      firstName: p.firstName || '',
      photo: p.photo || null,
      skinId: p.skinId || 'blue',
      hairStyle: p.hairStyle || 'short',
      bodyType: p.bodyType || 'standard',
    });
    setProfileError(null);
    setOnboardingRequired(true);
    setEditingProfile(true);
  };

  const saveEditProfile = () => {
    if (!editForm.firstName.trim()) {
      setProfileError('Enter your first name before saving.');
      return;
    }
    if (editForm.characterName.trim().length < 3) {
      setProfileError('Avatar name must be at least 3 characters.');
      return;
    }
    const handleRegex = /^[a-zA-Z0-9_]+$/;
    if (!handleRegex.test(editForm.characterName.trim())) {
      setProfileError('Avatar name can only contain letters, numbers, and underscores.');
      return;
    }

    const updated = {
      ...profile.profile,
      characterName: editForm.characterName.trim() || profile.profile.characterName,
      firstName: editForm.firstName.trim(),
      photo: editForm.photo,
      skinId: editForm.skinId || 'blue',
      hairStyle: editForm.hairStyle || 'short',
      bodyType: editForm.bodyType || 'standard',
      avatarOnboardingComplete: true,
    };
    localStorage.setItem('sidequest_profile', JSON.stringify(updated));
    setProfile({ ...profile, profile: updated });
    setProfileError(null);
    setOnboardingRequired(false);
    setEditingProfile(false);
  };
  const { location, currentVenue, isInsideVenue, error, isLocating } = useGeofencedMap('/api/geofence/check');

  const handleLogin = (authProfile) => {
    const { migrated, changed } = migrateProfileForAvatar(authProfile?.profile);
    const normalizedAuthProfile = { ...authProfile, profile: migrated };
    setProfile(normalizedAuthProfile);
    setIsLoggedIn(true);
    if (changed) {
      localStorage.setItem('sidequest_profile', JSON.stringify(migrated));
    }
    const uid = migrated?.email || authProfile?.mode || 'guest';
    loadUserRooms(uid);
    // Accept invite from URL if present
    try {
      const params = new URLSearchParams(window.location.search);
      const inv = params.get('invite');
      if (inv) {
        const room = JSON.parse(decodeURIComponent(inv));
        acceptRoomInvite(room, uid);
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch {}

    if (!isAvatarOnboardingComplete(migrated)) {
      startAvatarOnboarding(normalizedAuthProfile);
    } else {
      setOnboardingRequired(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('sidequest_profile');
    setIsLoggedIn(false);
    setProfile(null);
    setOnboardingRequired(false);
    setEditingProfile(false);
    setProfileError(null);
    setActiveScene('world');
  };

  const staticRoomMatch = location ? findRoomByLocation(location.latitude, location.longitude) : null;
  const roomMatch = staticRoomMatch;
  const worldTitle = roomMatch ? `The ${roomMatch.room.name} Overworld` : 'The Lost Overworld';

  const handleCreateRoom = () => {
    if (!location) return;
    setNewRoomName('');
    setNewRoomCategory('social');
    setNewRoomPublic(false);
    setCreatingRoom(true);
  };

  const COMMUNITY_CATEGORIES = [
    { id: 'social',    emoji: '🔥', label: 'Social',    color: '#f97316' },
    { id: 'nature',    emoji: '🌲', label: 'Nature',    color: '#16a34a' },
    { id: 'trail',     emoji: '🥾', label: 'Trail',     color: '#a16207' },
    { id: 'culture',   emoji: '🏛️', label: 'Culture',   color: '#7c3aed' },
    { id: 'spiritual', emoji: '🙏', label: 'Spiritual', color: '#d97706' },
    { id: 'water',     emoji: '🏖️', label: 'Water',     color: '#0369a1' },
    { id: 'arts',      emoji: '🎭', label: 'Arts',      color: '#e11d48' },
    { id: 'sport',     emoji: '🏃', label: 'Sport',     color: '#0891b2' },
  ];

  const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL ||
    (import.meta.env.PROD ? 'https://location-chat-production.up.railway.app' : 'http://localhost:4000');

  const confirmCreateRoom = async () => {
    const contributorName = profile?.profile?.characterName || profile?.mode || 'guest';
    const ownerId = profile?.profile?.email || profile?.mode || 'guest';
    const roomName = newRoomName.trim() || `${contributorName}'s Spot`;
    const cat = COMMUNITY_CATEGORIES.find(c => c.id === newRoomCategory) || COMMUNITY_CATEGORIES[0];
    const roomId = `user-${Date.now()}`;

    if (newRoomPublic) {
      const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
      const lastTs = parseInt(localStorage.getItem('sidequest_loc_ts') || '0', 10);
      const resetIn = Math.ceil((lastTs + THREE_DAYS - Date.now()) / 3600000);
      if (Date.now() - lastTs < THREE_DAYS) {
        setCreatingRoom(false);
        setGpsToast(`You can create 1 community location every 3 days. Try again in ~${resetIn}h.`);
        setTimeout(() => setGpsToast(null), 4000);
        return;
      }
      // Save to server so everyone can discover it
      try {
        const resp = await fetch(`${SOCKET_SERVER_URL}/api/community-locations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: roomId, name: roomName,
            lat: location.latitude, lng: location.longitude,
            radius: 60, category: cat.id,
            emoji: cat.emoji, color: cat.color,
            creator: contributorName, description: '',
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setGpsToast(`Community save failed: ${err.error || resp.status}`);
          setTimeout(() => setGpsToast(null), 5000);
        } else {
          localStorage.setItem('sidequest_loc_ts', Date.now().toString());
        }
      } catch (e) {
        setGpsToast(`Community save error: ${e.message}`);
        setTimeout(() => setGpsToast(null), 5000);
      }
    }

    const newRoom = createUserRoom({
      id: roomId, name: roomName,
      lat: location.latitude, lng: location.longitude,
      radiusMeters: 60, contributor: contributorName, ownerId,
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
      lat: room.lat,
      lng: room.lng,
      radiusMeters: room.radiusMeters,
      ownerId: room.ownerId,
      contributors: room.contributors,
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
    // GPS gating for named GPS rooms (no poiMeta)
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
    // GPS gating for community/user rooms passed via poiMeta with a radius
    if (poiMeta?.radius && poiMeta?.lat && location) {
      const dist = getDistanceMeters(location.latitude, location.longitude, poiMeta.lat, poiMeta.lng);
      if (dist > poiMeta.radius) {
        setGpsToast(`You need to be within ${poiMeta.radius}m of ${poiMeta.name || 'this location'} to enter. You are ${Math.round(dist)}m away.`);
        setTimeout(() => setGpsToast(null), 3500);
        return;
      }
    }
    if (poiMeta) setOsmRoom({ ...poiMeta, id: roomId });
    else setOsmRoom(null);
    setSelectedRoom(roomId);
    setActiveScene('room');
  };

  const _THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
  const _lastLocTs = parseInt(localStorage.getItem('sidequest_loc_ts') || '0', 10);
  const locCooldown = Date.now() - _lastLocTs < _THREE_DAYS;
  const locCooldownHours = Math.ceil((_lastLocTs + _THREE_DAYS - Date.now()) / 3600000);
  const avatarComplete = isAvatarOnboardingComplete(profile?.profile);
  const onboardingStepLabel = onboardingRequired ? 'Onboarding Step 2/2: Complete Avatar Setup' : null;

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
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { if (!onboardingRequired) setEditingProfile(false); }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', border: '4px solid #fff', padding: 4, maxWidth: 360, width: '100%', margin: 16, boxShadow: '8px 8px 0 #000' }}>
            <div style={{ border: '2px solid #3b82f6', padding: 24, background: '#0f172a', color: '#fff', fontFamily: 'Courier New, monospace' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 12, borderBottom: '2px solid #1e293b' }}>
                <h2 style={{ margin: 0, color: '#fbbf24', fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {onboardingRequired ? 'Complete Avatar Setup' : 'Edit Profile'}
                </h2>
                {!onboardingRequired && (
                  <button onClick={() => setEditingProfile(false)} style={{ background: 'none', border: 'none', color: '#64748b', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'Courier New', fontSize: 14 }}>[X]</button>
                )}
              </div>

              {onboardingRequired && (
                <div style={{ marginBottom: 14, padding: '8px 10px', border: '2px solid #fbbf24', background: '#111827', color: '#fde68a', fontSize: 11 }}>
                  Create your avatar to enter the world.
                </div>
              )}

              {profileError && (
                <div style={{ marginBottom: 14, padding: '8px 10px', border: '2px solid #ef4444', background: 'rgba(127,29,29,0.8)', color: '#fca5a5', fontSize: 11 }}>
                  {profileError}
                </div>
              )}

              <div style={{ marginBottom: 20 }}>
                <AvatarSetupFields
                  formData={editForm}
                  setFormData={setEditForm}
                  photoDataUrl={editForm.photo}
                  setPhotoDataUrl={(photo) => setEditForm((f) => ({ ...f, photo }))}
                  firstNameLabel="First Name"
                  characterNameLabel="Display Name"
                />
              </div>

              <button onClick={saveEditProfile}
                style={{ width: '100%', padding: '12px 0', background: '#16a34a', border: '2px solid #000', boxShadow: '2px 2px 0 #000', color: '#fff', fontWeight: 'bold', fontFamily: 'Courier New, monospace', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
                {onboardingRequired ? 'Save and Enter World' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Create room name prompt */}
      {creatingRoom && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setCreatingRoom(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', border: '4px solid #fbbf24', padding: 28, maxWidth: 340, width: '100%', margin: 16, boxShadow: '8px 8px 0 #000', fontFamily: 'Courier New, monospace' }}>
            <div style={{ color: '#fbbf24', fontSize: 13, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16 }}>📍 Create a Place</div>
            <input
              autoFocus
              type="text"
              placeholder="Name this place…"
              value={newRoomName}
              onChange={e => setNewRoomName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmCreateRoom()}
              maxLength={32}
              style={{ width: '100%', boxSizing: 'border-box', background: '#000', border: '2px solid #475569', padding: '10px 12px', color: '#f8fafc', fontFamily: 'Courier New, monospace', fontSize: 14, outline: 'none', marginBottom: 14 }}
            />
            {/* Category picker */}
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Category</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {COMMUNITY_CATEGORIES.map(cat => (
                <button key={cat.id} onClick={() => setNewRoomCategory(cat.id)}
                  style={{ background: newRoomCategory === cat.id ? cat.color : '#1e293b', border: `2px solid ${newRoomCategory === cat.id ? cat.color : '#334155'}`, color: '#fff', padding: '4px 10px', fontFamily: 'Courier New, monospace', fontSize: 11, cursor: 'pointer', borderRadius: 4 }}>
                  {cat.emoji} {cat.label}
                </button>
              ))}
            </div>
            {/* Public toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 12px', background: '#1e293b', border: `2px solid ${newRoomPublic && !locCooldown ? '#16a34a' : '#334155'}`, cursor: locCooldown ? 'not-allowed' : 'pointer', opacity: locCooldown && !newRoomPublic ? 0.5 : 1 }} onClick={() => !locCooldown && setNewRoomPublic(p => !p)}>
              <div style={{ width: 36, height: 20, background: newRoomPublic && !locCooldown ? '#16a34a' : '#475569', borderRadius: 10, position: 'relative', transition: 'background 0.2s' }}>
                <div style={{ position: 'absolute', top: 2, left: newRoomPublic && !locCooldown ? 18 : 2, width: 16, height: 16, background: '#fff', borderRadius: '50%', transition: 'left 0.2s' }} />
              </div>
              <div>
                <div style={{ color: newRoomPublic && !locCooldown ? '#4ade80' : '#94a3b8', fontSize: 12, fontWeight: 'bold' }}>
                  {locCooldown ? `⏳ Cooldown — ${locCooldownHours}h remaining` : newRoomPublic ? '🌍 Community — visible to everyone' : '🔒 Private — only you'}
                </div>
                <div style={{ color: '#475569', fontSize: 10 }}>
                  {locCooldown ? '1 community location per 3 days' : newRoomPublic ? "Appears on all users' maps" : 'Share via invite link to add others'}
                </div>
              </div>
            </div>
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
              <button
                type="button"
                onClick={openEditProfile}
                style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', border: `1px solid ${avatarComplete ? '#16a34a' : '#ef4444'}`, color: avatarComplete ? '#86efac' : '#fca5a5', background: avatarComplete ? 'rgba(20,83,45,0.35)' : 'rgba(127,29,29,0.35)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer', fontFamily: 'monospace' }}
                title="Open avatar settings"
              >
                <span>{avatarComplete ? 'Avatar Complete' : 'Avatar Incomplete'}</span>
              </button>
              {onboardingStepLabel && (
                <div style={{ marginTop: 4, border: '1px solid #f59e0b', color: '#fde68a', background: 'rgba(120,53,15,0.35)', padding: '2px 8px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {onboardingStepLabel}
                </div>
              )}
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
                <Suspense fallback={<div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#94a3b8', background: '#0f172a' }}>Loading map…</div>}>
                  <WorldMapCanvas
                    key="world-map"
                    location={location}
                    profile={profile}
                    rooms={getAllRooms().map(r => ({ ...r, radiusMeters: r.radiusMeters || 100 }))}
                    onEnterRoom={handleEnterRoom}
                  />
                </Suspense>
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
                <Suspense fallback={<div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#94a3b8', background: '#0f172a' }}>Loading room…</div>}>
                  <VillageCanvas room={osmRoom ? { ...osmRoom, id: osmRoom.id } : activeRoom} profile={profile} onLeave={() => { setActiveScene('world'); setOsmRoom(null); }} />
                </Suspense>
                {/* Invite button for user-created private rooms */}
                {activeRoom?.kind === 'user-created' && (
                  <button
                    onClick={() => {
                      const link = `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(JSON.stringify(activeRoom))}`;
                      try {
                        navigator.clipboard.writeText(link).then(() => {
                          setInviteToast(true);
                          setTimeout(() => setInviteToast(null), 2500);
                        }).catch(() => {
                          prompt('Copy this invite link:', link);
                        });
                      } catch {
                        prompt('Copy this invite link:', link);
                      }
                    }}
                    style={{ position: 'absolute', bottom: 16, right: 12, zIndex: 1000, background: '#1e293b', border: '1px solid #fbbf24', color: '#fbbf24', padding: '6px 12px', fontFamily: 'Courier New', fontSize: 11, cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>
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


