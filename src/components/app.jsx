import React, { useState, useEffect, lazy, Suspense } from 'react';
import { io } from 'socket.io-client';
import RetroAuthModal from './RetroAuthModal';
import AvatarSetupFields from './AvatarSetupFields';
import { useGeofencedMap } from '../hooks/UseGeofencingApp';
import { createUserRoom, deleteUserRoom, loadUserRooms, acceptRoomInvite, getAllRooms } from '../../rooms/rooms.js';
import { getDistanceMeters } from '../geo';
import { normalizeAvatarModel } from '../game/entities/avatarModelInfo';

const VillageCanvas = lazy(() => import('../village/VillageCanvas.jsx'));
const WorldMapCanvas = lazy(() => import('../village/WorldMapCanvas.jsx'));

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const normalizeHairStyle = (hairStyle) => {
  const allowed = new Set(['bun', 'bob', 'curly', 'lob', 'messy', 'combed']);
  if (allowed.has(hairStyle)) return hairStyle;
  if (hairStyle === 'side' || hairStyle === 'mohawk') return 'messy';
  return 'bun';
};

const normalizeAvatarGender = (value) => (String(value || '').toLowerCase() === 'female' ? 'female' : 'male');

const normalizeEmailKey = (value = '') => String(value || '').trim().toLowerCase();

const isAvatarOnboardingComplete = (savedProfile) => {
  if (!savedProfile) return false;
  if (savedProfile.avatarOnboardingComplete === true) return true;
  return hasText(savedProfile.firstName)
    && hasText(savedProfile.characterName)
    && hasText(savedProfile.skinId)
    && hasText(savedProfile.hairStyle)
    && hasText(savedProfile.bodyType)
    && hasText(savedProfile.topStyle)
    && hasText(savedProfile.bottomStyle)
    && hasText(savedProfile.footwear);
};

const normalizeCommunityRoom = (room) => {
  if (!room || room.lat == null || room.lng == null) return null;
  return {
    id: room.id,
    name: room.name || 'Community Location',
    lat: Number(room.lat),
    lng: Number(room.lng),
    radiusMeters: Number(room.radius ?? room.radiusMeters ?? 60),
    kind: 'community',
    category: room.category || 'social',
    emoji: room.emoji || '📍',
    color: room.color || '#f97316',
    ownerId: room.creator || 'community',
    contributors: [room.creator || 'community'],
    isPublic: true,
  };
};

const mergeRoomsById = (...roomSets) => {
  const byId = new Map();
  roomSets.flat().forEach((room) => {
    if (!room?.id) return;
    byId.set(room.id, room);
  });
  return Array.from(byId.values());
};

const migrateProfileForAvatar = (savedProfile) => {
  const profile = savedProfile || {};
  const emailStem = (profile.email || 'traveler').split('@')[0] || 'traveler';
  const migrated = {
    ...profile,
    characterName: hasText(profile.characterName) ? profile.characterName : emailStem,
    skinId: hasText(profile.skinId) ? profile.skinId : 'slate',
    avatarGender: normalizeAvatarGender(profile.avatarGender),
    hairStyle: normalizeHairStyle(profile.hairStyle),
    bodyType: hasText(profile.bodyType) ? profile.bodyType : 'standard',
    skinTone: profile.skinTone ?? profile.pigment ?? 45,
    hairHue: profile.hairHue ?? profile.eyeHue ?? 26,
    outfitHue: profile.outfitHue ?? profile.scarfHue ?? 220,
    topStyle: hasText(profile.topStyle) ? profile.topStyle : 'hoodie',
    bottomStyle: hasText(profile.bottomStyle) ? profile.bottomStyle : 'pants',
    footwear: hasText(profile.footwear) ? profile.footwear : 'sneakers',
    glasses: Boolean(profile.glasses),
    hasScythe: Boolean(profile.hasScythe),
    avatarModel: normalizeAvatarModel(profile.avatarModel),
  };

  const changed = (
    migrated.characterName !== profile.characterName
    || migrated.skinId !== profile.skinId
    || migrated.avatarGender !== profile.avatarGender
    || migrated.hairStyle !== profile.hairStyle
    || migrated.bodyType !== profile.bodyType
    || migrated.skinTone !== profile.skinTone
    || migrated.hairHue !== profile.hairHue
    || migrated.outfitHue !== profile.outfitHue
    || migrated.topStyle !== profile.topStyle
    || migrated.bottomStyle !== profile.bottomStyle
    || migrated.footwear !== profile.footwear
    || migrated.glasses !== profile.glasses
    || migrated.hasScythe !== profile.hasScythe
    || migrated.avatarModel !== profile.avatarModel
  );

  return { migrated, changed };
};

function AvatarStudioPage({
  formData,
  setFormData,
  profileError,
  onSave,
  onCancel,
  onForceEnter,
  onboardingRequired,
}) {
  const emergencyAction = onboardingRequired ? onForceEnter : onCancel;
  const emergencyLabel = onboardingRequired ? 'Exit To World' : 'Exit Editor';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 20000, minHeight: '100vh', width: '100%', background: 'radial-gradient(120% 100% at 0% 0%, #12203a 0%, #0f172a 45%, #020617 100%)', color: '#f8fafc', fontFamily: 'Courier New, monospace', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      {emergencyAction && (
        <a
          href="?quickStart=complete"
          onClick={(e) => {
            e.preventDefault();
            emergencyAction();
          }}
          style={{ position: 'fixed', top: 10, right: 10, zIndex: 20050, padding: '8px 12px', border: '2px solid #f59e0b', background: '#111827', color: '#fde68a', fontFamily: 'Courier New, monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', cursor: 'pointer', textDecoration: 'none' }}
        >
          {emergencyLabel}
        </a>
      )}
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '22px 14px 34px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <aside style={{ border: '2px solid #1e293b', background: 'linear-gradient(140deg, rgba(15,23,42,0.95), rgba(13,33,60,0.8))', padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#93c5fd', marginBottom: 8 }}>Avatar Studio</div>
          <h1 style={{ margin: '0 0 10px', color: '#fde68a', fontSize: 'clamp(1.8rem, 6vw, 2.7rem)', lineHeight: 0.95, textTransform: 'uppercase' }}>
            Build Your Human Avatar
          </h1>
          <p style={{ margin: '0 0 12px', color: '#cbd5e1', fontSize: 13, lineHeight: 1.5 }}>
            This is now a dedicated page. Finish your avatar here, then continue into map and location rooms.
          </p>

          <div style={{ border: '2px solid #334155', background: '#0b1220', padding: 10, marginBottom: 10 }}>
            <div style={{ color: '#fbbf24', fontSize: 11, textTransform: 'uppercase', marginBottom: 6 }}>Checklist</div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>- First name + display name</div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>- Pick one avatar: male or female</div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>- Fixed style (no color sliders)</div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>- Save to enter the world</div>
          </div>

          {onboardingRequired && (
            <div style={{ border: '2px solid #f59e0b', background: 'rgba(120,53,15,0.35)', color: '#fde68a', padding: '8px 10px', fontSize: 12 }}>
              Avatar onboarding is required before entering map locations.
            </div>
          )}
        </aside>

        <section style={{ border: '4px solid #fff', background: '#0f172a', padding: 4, boxShadow: '8px 8px 0 #000' }}>
          <div style={{ border: '2px solid #3b82f6', background: '#0f172a', padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 14, borderBottom: '2px solid #1e293b', paddingBottom: 10 }}>
              <h2 style={{ margin: 0, color: '#fbbf24', fontSize: 16, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {onboardingRequired ? 'Complete Avatar Setup' : 'Edit Avatar'}
              </h2>
              {!onboardingRequired && onCancel && (
                <button onClick={onCancel} style={{ background: 'none', border: '1px solid #334155', color: '#94a3b8', fontFamily: 'Courier New, monospace', fontSize: 11, cursor: 'pointer', padding: '3px 8px', textTransform: 'uppercase' }}>
                  Back to map
                </button>
              )}
            </div>

            {profileError && (
              <div style={{ marginBottom: 12, padding: '8px 10px', border: '2px solid #ef4444', background: 'rgba(127,29,29,0.8)', color: '#fca5a5', fontSize: 11 }}>
                {profileError}
              </div>
            )}

            <AvatarSetupFields
              formData={formData}
              setFormData={setFormData}
              photoDataUrl={formData.photo}
              setPhotoDataUrl={(photo) => setFormData((f) => ({ ...f, photo }))}
              firstNameLabel="First Name"
              characterNameLabel="Display Name"
            />

            <div style={{ display: 'flex', gap: 8, marginTop: 14, position: 'sticky', bottom: 0, zIndex: 20, background: 'linear-gradient(180deg, rgba(15,23,42,0.25) 0%, rgba(15,23,42,0.98) 40%)', paddingTop: 10, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}>
              {!onboardingRequired && onCancel && (
                <button onClick={onCancel} style={{ flex: 1, padding: '10px 0', background: 'transparent', border: '2px solid #334155', color: '#94a3b8', fontFamily: 'Courier New, monospace', fontSize: 12, textTransform: 'uppercase', cursor: 'pointer' }}>
                  Cancel
                </button>
              )}
              {onboardingRequired && onForceEnter && (
                <button
                  onClick={onForceEnter}
                  style={{ flex: 1, padding: '10px 0', background: 'transparent', border: '2px dashed #f59e0b', color: '#fde68a', fontFamily: 'Courier New, monospace', fontSize: 12, textTransform: 'uppercase', cursor: 'pointer' }}
                >
                  Enter World Now
                </button>
              )}
              <button
                onClick={onSave}
                style={{ flex: 1, padding: '10px 0', background: '#16a34a', border: '2px solid #000', boxShadow: '2px 2px 0 #000', color: '#fff', fontWeight: 'bold', fontFamily: 'Courier New, monospace', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}
              >
                {onboardingRequired ? 'Save and Enter World' : 'Save Avatar'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function RetroLandingPage({ onEnter }) {
  const referenceArtCandidates = ['/assets/landing-original.png', '/assets/landing-reference.png'];
  const [useReferenceArt, setUseReferenceArt] = useState(true);
  const [referenceArtIndex, setReferenceArtIndex] = useState(0);
  const avatarDots = [
    { left: '3%', top: '3%', size: 108, bg: '#cfe6ff', photo: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '26%', top: '9%', size: 154, bg: '#fff2cc', photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '64%', top: '5%', size: 130, bg: '#d8ecff', photo: 'https://images.unsplash.com/photo-1542206395-9feb3edaa68d?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '82%', top: '10%', size: 138, bg: '#fce7ea', photo: 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '98%', top: '3%', size: 118, bg: '#ffe1d8', photo: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '93%', top: '16%', size: 112, bg: '#fff1cf', photo: 'https://images.unsplash.com/photo-1506863530036-1efeddceb993?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '79%', top: '24%', size: 138, bg: '#bfe9ff', photo: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '0%', top: '24.5%', size: 108, bg: '#fff0d7', photo: 'https://images.unsplash.com/photo-1506277886164-e25aa3f4ef7f?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '5%', top: '48.5%', size: 150, bg: '#cfe4ff', photo: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '93.5%', top: '41%', size: 136, bg: '#fff0d7', photo: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '72.2%', top: '60.7%', size: 146, bg: '#fff0d7', photo: 'https://images.unsplash.com/photo-1552058544-f2b08422138a?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '89%', top: '71.9%', size: 120, bg: '#fff1c7', photo: 'https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '87.9%', top: '86.9%', size: 128, bg: '#fff0d7', photo: 'https://images.unsplash.com/photo-1521119989659-a83eee488004?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '66.2%', top: '81.8%', size: 140, bg: '#fff0d7', photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '41.1%', top: '87.5%', size: 122, bg: '#f8cbe0', photo: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '16.3%', top: '79.6%', size: 145, bg: '#fde2c8', photo: 'https://images.unsplash.com/photo-1546961329-78bef0414d7c?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '28.4%', top: '79.7%', size: 118, bg: '#fff0d7', photo: 'https://images.unsplash.com/photo-1525134479668-1bee5c7c6845?auto=format&fit=crop&w=320&h=320&q=80' },
    { left: '4%', top: '67%', size: 138, bg: '#cbe9ff', photo: 'https://images.unsplash.com/photo-1541577141970-eebc83ebe30e?auto=format&fit=crop&w=320&h=320&q=80' },
  ];

  const useNextReferenceArtOrFallback = () => {
    if (referenceArtIndex < referenceArtCandidates.length - 1) {
      setReferenceArtIndex((value) => value + 1);
      return;
    }
    setUseReferenceArt(false);
  };

  const validateArt = (event) => {
    try {
      const img = event.currentTarget;
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      if (!width || !height) {
        useNextReferenceArtOrFallback();
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.min(48, width);
      canvas.height = Math.min(48, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        useNextReferenceArtOrFallback();
        return;
      }

      const sx = Math.floor(width * 0.2);
      const sy = Math.floor(height * 0.2);
      const sw = Math.max(1, Math.floor(width * 0.6));
      const sh = Math.max(1, Math.floor(height * 0.6));
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let alphaSum = 0;
      let minLuma = 255;
      let maxLuma = 0;
      for (let i = 3; i < pixels.length; i += 4) alphaSum += pixels[i];
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const luma = Math.round((r + g + b) / 3);
        if (luma < minLuma) minLuma = luma;
        if (luma > maxLuma) maxLuma = luma;
      }

      // Reject transparent or near-flat placeholder images.
      if (alphaSum === 0 || maxLuma - minLuma < 8) {
        useNextReferenceArtOrFallback();
      }
    } catch {
      useNextReferenceArtOrFallback();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 22000,
        minHeight: '100vh',
        width: '100%',
        overflow: 'hidden',
        color: '#111',
        fontFamily: 'Helvetica Neue, Arial, sans-serif',
        background: 'radial-gradient(circle at center, #f0c12a 0%, #e5b61f 60%, #d8ab16 100%)',
      }}
    >
      {!useReferenceArt && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'radial-gradient(rgba(0,0,0,0.08) 1px, transparent 1px)',
              backgroundSize: '6px 6px',
              opacity: 0.45,
              pointerEvents: 'none',
            }}
          />
          {avatarDots.map((dot, index) => (
            <div
              key={`${dot.left}-${dot.top}-${index}`}
              style={{
                position: 'absolute',
                left: dot.left,
                top: dot.top,
                width: dot.size,
                height: dot.size,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                border: '2px solid rgba(0,0,0,0.8)',
                background: `radial-gradient(circle at 50% 35%, ${dot.bg} 0 58%, rgba(255,255,255,0.94) 59% 100%)`,
                boxShadow: '0 3px 0 rgba(0,0,0,0.2)',
                display: 'grid',
                placeItems: 'center',
                backgroundColor: dot.bg,
              }}
            >
              <img
                src={dot.photo}
                alt="person"
                style={{
                  width: Math.round(dot.size * 0.9),
                  height: Math.round(dot.size * 0.9),
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '2px solid rgba(255,255,255,0.95)',
                }}
              />
            </div>
          ))}
        </>
      )}

      {useReferenceArt && (
        <img
          src={referenceArtCandidates[referenceArtIndex]}
          alt="Landing art"
          onLoad={validateArt}
          onError={useNextReferenceArtOrFallback}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
      )}

      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: useReferenceArt ? 'auto' : '50%',
          bottom: useReferenceArt ? '7.5%' : 'auto',
          transform: useReferenceArt ? 'translateX(-50%)' : 'translate(-50%, -50%)',
          textAlign: 'center',
          zIndex: 2,
          width: 'min(640px, calc(100vw - 32px))',
        }}
      >
        {!useReferenceArt && (
          <>
            <h1
              style={{
                margin: 0,
                color: '#111',
                fontSize: 'clamp(2.8rem, 6.8vw, 5rem)',
                lineHeight: 0.95,
                letterSpacing: '-0.04em',
                textTransform: 'uppercase',
                fontWeight: 900,
                textShadow: '2px 2px 0 rgba(255,255,255,0.08)',
                fontFamily: 'Impact, Haettenschweiler, Arial Narrow Bold, sans-serif',
              }}
            >
              A Location
              <br />
              Based
              <br />
              Adventure
            </h1>
            <p
              style={{
                margin: '16px 0 22px',
                fontSize: 'clamp(1.15rem, 2.5vw, 1.9rem)',
                lineHeight: 1.05,
                color: '#111',
                fontWeight: 500,
              }}
            >
              Meet your people.
              <br />
              In the real world.
            </p>
          </>
        )}

        <button
          onClick={onEnter}
          style={{
            padding: '12px 24px',
            background: '#111',
            border: '3px solid #111',
            color: '#f6d24a',
            fontWeight: 900,
            cursor: 'pointer',
            borderRadius: 999,
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            boxShadow: '0 5px 0 rgba(0,0,0,0.32)',
          }}
        >
          Enter Lounge
        </button>
      </div>
    </div>
  );
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profile, setProfile] = useState(null);
  const [showLanding, setShowLanding] = useState(true);
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
    skinId: 'slate',
    avatarGender: 'male',
    hairStyle: 'combed',
    bodyType: 'standard',
    skinTone: 45,
    hairHue: 26,
    outfitHue: 220,
    topStyle: 'hoodie',
    bottomStyle: 'pants',
    footwear: 'sneakers',
    glasses: false,
    hasScythe: false,
    avatarModel: 'hoodie',
  });
  const [osmRoom, setOsmRoom] = useState(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomCategory, setNewRoomCategory] = useState('social');
  const [newRoomPublic, setNewRoomPublic] = useState(false);
  const [inviteToast, setInviteToast] = useState(null);
  const [communityRooms, setCommunityRooms] = useState([]);

  const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL ||
    (import.meta.env.PROD ? 'https://location-chat-production.up.railway.app' : 'http://localhost:4000');

  const clearQuickStartParam = () => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (!params.has('quickStart')) return;
      params.delete('quickStart');
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', next);
    } catch {}
  };

  const persistAuthProfile = async (nextProfile) => {
    const email = String(nextProfile?.email || '').trim().toLowerCase();
    if (!email || profile?.mode === 'guest') return;
    try {
      await fetch(`${SOCKET_SERVER_URL}/api/auth/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, profile: nextProfile }),
      });
    } catch {
      // Keep local avatar updates even if profile sync fails.
    }
  };

  const openEditProfile = () => {
    setEditForm({
      characterName: profile?.profile?.characterName || '',
      firstName: profile?.profile?.firstName || '',
      photo: profile?.profile?.photo || null,
      skinId: profile?.profile?.skinId || 'slate',
      avatarGender: normalizeAvatarGender(profile?.profile?.avatarGender),
      hairStyle: normalizeHairStyle(profile?.profile?.hairStyle),
      bodyType: profile?.profile?.bodyType || 'standard',
      skinTone: profile?.profile?.skinTone ?? profile?.profile?.pigment ?? 45,
      hairHue: profile?.profile?.hairHue ?? profile?.profile?.eyeHue ?? 26,
      outfitHue: profile?.profile?.outfitHue ?? profile?.profile?.scarfHue ?? 220,
      topStyle: profile?.profile?.topStyle || 'hoodie',
      bottomStyle: profile?.profile?.bottomStyle || 'pants',
      footwear: profile?.profile?.footwear || 'sneakers',
      glasses: Boolean(profile?.profile?.glasses),
      hasScythe: Boolean(profile?.profile?.hasScythe),
      avatarModel: normalizeAvatarModel(profile?.profile?.avatarModel),
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
      skinId: p.skinId || 'slate',
      avatarGender: normalizeAvatarGender(p.avatarGender),
      hairStyle: normalizeHairStyle(p.hairStyle),
      bodyType: p.bodyType || 'standard',
      skinTone: p.skinTone ?? p.pigment ?? 45,
      hairHue: p.hairHue ?? p.eyeHue ?? 26,
      outfitHue: p.outfitHue ?? p.scarfHue ?? 220,
      topStyle: p.topStyle || 'hoodie',
      bottomStyle: p.bottomStyle || 'pants',
      footwear: p.footwear || 'sneakers',
      glasses: Boolean(p.glasses),
      hasScythe: Boolean(p.hasScythe),
      avatarModel: normalizeAvatarModel(p.avatarModel),
    });
    setProfileError(null);
    setOnboardingRequired(true);
    setEditingProfile(true);
  };

  const saveEditProfile = async () => {
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
      skinId: editForm.skinId || 'slate',
      avatarGender: normalizeAvatarGender(editForm.avatarGender),
      hairStyle: normalizeHairStyle(editForm.hairStyle),
      bodyType: editForm.bodyType || 'standard',
      skinTone: editForm.skinTone ?? 45,
      hairHue: editForm.hairHue ?? 26,
      outfitHue: editForm.outfitHue ?? 220,
      topStyle: editForm.topStyle || 'hoodie',
      bottomStyle: editForm.bottomStyle || 'pants',
      footwear: editForm.footwear || 'sneakers',
      glasses: Boolean(editForm.glasses),
      hasScythe: Boolean(editForm.hasScythe),
      avatarModel: normalizeAvatarModel(editForm.avatarModel),
      avatarOnboardingComplete: true,
    };
    localStorage.setItem('sidequest_profile', JSON.stringify(updated));
    setProfile({ ...profile, profile: updated });
    await persistAuthProfile(updated);
    setProfileError(null);
    setOnboardingRequired(false);
    setEditingProfile(false);
  };

  const forceEnterWorld = async () => {
    const base = profile?.profile || {};
    const fallbackFirst = editForm.firstName.trim() || base.firstName || 'Traveler';
    const rawName = editForm.characterName.trim() || base.characterName || fallbackFirst;
    const safeName = rawName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24) || `traveler_${Date.now().toString().slice(-4)}`;

    const updated = {
      ...base,
      characterName: safeName,
      firstName: fallbackFirst,
      photo: editForm.photo,
      skinId: editForm.skinId || 'slate',
      avatarGender: normalizeAvatarGender(editForm.avatarGender),
      hairStyle: normalizeHairStyle(editForm.hairStyle),
      bodyType: editForm.bodyType || 'standard',
      skinTone: editForm.skinTone ?? 45,
      hairHue: editForm.hairHue ?? 26,
      outfitHue: editForm.outfitHue ?? 220,
      topStyle: editForm.topStyle || 'hoodie',
      bottomStyle: editForm.bottomStyle || 'pants',
      footwear: editForm.footwear || 'sneakers',
      glasses: Boolean(editForm.glasses),
      hasScythe: Boolean(editForm.hasScythe),
      avatarModel: normalizeAvatarModel(editForm.avatarModel),
      avatarOnboardingComplete: true,
    };

    localStorage.setItem('sidequest_profile', JSON.stringify(updated));
    setProfile((prev) => ({ ...(prev || {}), profile: updated }));
    await persistAuthProfile(updated);
    setProfileError(null);
    setOnboardingRequired(false);
    setEditingProfile(false);
  };

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const quickStart = params.get('quickStart');
      if (!quickStart) return;

      if (quickStart === 'guest' && !isLoggedIn) {
        const stamp = Date.now().toString().slice(-4);
        const guestProfile = {
          email: `guest_${stamp}@side.quest`,
          characterName: `guest_${stamp}`,
          firstName: `Guest${stamp}`,
          skinId: 'slate',
          avatarGender: 'male',
          hairStyle: 'combed',
          bodyType: 'standard',
          skinTone: 45,
          hairHue: 26,
          outfitHue: 220,
          topStyle: 'hoodie',
          bottomStyle: 'pants',
          footwear: 'sneakers',
          glasses: false,
          hasScythe: false,
          avatarModel: 'hoodie',
          avatarOnboardingComplete: true,
          guestMode: true,
        };
        localStorage.setItem('sidequest_profile', JSON.stringify(guestProfile));
        setProfile({ mode: 'guest', profile: guestProfile });
        setIsLoggedIn(true);
        setOnboardingRequired(false);
        setEditingProfile(false);
        loadUserRooms(guestProfile.email);
        clearQuickStartParam();
        return;
      }

      if (quickStart === 'complete' && isLoggedIn) {
        if (profile?.profile) {
          const updated = {
            ...profile.profile,
            avatarOnboardingComplete: true,
          };
          localStorage.setItem('sidequest_profile', JSON.stringify(updated));
          setProfile((prev) => ({ ...(prev || {}), profile: updated }));
        }
        setOnboardingRequired(false);
        setEditingProfile(false);
        clearQuickStartParam();
      }
    } catch {
      clearQuickStartParam();
    }
  }, [isLoggedIn, profile]);
  const { location, currentVenue, isInsideVenue, error, isLocating } = useGeofencedMap('/api/geofence/check', isLoggedIn);

  const handleLogin = (authProfile) => {
    let cachedProfile = null;
    try {
      const raw = localStorage.getItem('sidequest_profile');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') cachedProfile = parsed;
    } catch {
      cachedProfile = null;
    }

    const authSource = authProfile?.profile && typeof authProfile.profile === 'object'
      ? authProfile.profile
      : {};
    const sameAccount = normalizeEmailKey(cachedProfile?.email) &&
      normalizeEmailKey(cachedProfile?.email) === normalizeEmailKey(authSource?.email);
    const mergedSource = sameAccount
      ? {
        ...cachedProfile,
        ...authSource,
        photo: authSource.photo || cachedProfile.photo || null,
      }
      : authSource;

    const { migrated, changed } = migrateProfileForAvatar(mergedSource);
    const normalizedAuthProfile = { ...authProfile, profile: migrated };
    setProfile(normalizedAuthProfile);
    setIsLoggedIn(true);
    if (changed || migrated.photo !== authSource.photo) {
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
    localStorage.removeItem('sidequest_signup_draft_v1');
    setIsLoggedIn(false);
    setProfile(null);
    setOnboardingRequired(false);
    setEditingProfile(false);
    setProfileError(null);
    setActiveScene('world');
    setCommunityRooms([]);
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;

    const fetchCommunityRooms = async () => {
      try {
        const resp = await fetch(`${SOCKET_SERVER_URL}/api/community-locations`);
        if (!resp.ok) return;
        const raw = await resp.json();
        if (cancelled) return;
        const normalized = (Array.isArray(raw) ? raw : []).map(normalizeCommunityRoom).filter(Boolean);
        setCommunityRooms(normalized);
      } catch {
        // Keep existing list if fetch fails.
      }
    };

    fetchCommunityRooms();
    const timer = setInterval(fetchCommunityRooms, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isLoggedIn, SOCKET_SERVER_URL]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const socket = io(SOCKET_SERVER_URL, { transports: ['websocket'] });

    socket.on('community_location_added', (room) => {
      const normalized = normalizeCommunityRoom(room);
      if (!normalized) return;
      setCommunityRooms((prev) => mergeRoomsById(prev, [normalized]));
    });

    socket.on('community_location_removed', ({ id }) => {
      if (!id) return;
      setCommunityRooms((prev) => prev.filter((room) => room.id !== id));
    });

    return () => {
      socket.disconnect();
    };
  }, [isLoggedIn, SOCKET_SERVER_URL]);

  const allRooms = mergeRoomsById(getAllRooms(), communityRooms);

  const staticRoomMatch = location
    ? (() => {
      for (const room of allRooms) {
        const distance = getDistanceMeters(location.latitude, location.longitude, room.lat, room.lng);
        if (distance <= room.radiusMeters) return { room, distance: Math.round(distance) };
      }
      return null;
    })()
    : null;
  const roomMatch = staticRoomMatch;
  const worldTitle = roomMatch ? `The ${roomMatch.room.name} Overworld` : 'The Lost Overworld';

  const handleCreateRoom = () => {
    if (!location) return;
    setNewRoomName('');
    setNewRoomCategory('social');
    setNewRoomPublic(false);
    setCreatingRoom(true);
  };

  const handleDeleteRoom = async (room) => {
    if (!room || room.kind === 'gps') return;
    const ownerId = profile?.profile?.email || profile?.mode || 'guest';
    const creatorName = profile?.profile?.characterName || '';
    const ownsRoom = room.ownerId === ownerId || room.ownerId === creatorName;

    if (!ownsRoom) {
      setGpsToast('You can only delete rooms you created.');
      setTimeout(() => setGpsToast(null), 3000);
      return;
    }

    const ok = window.confirm(`Delete "${room.name}"? This cannot be undone.`);
    if (!ok) return;

    if (room.kind === 'community' || room.isPublic === true) {
      try {
        const qs = creatorName ? `?creator=${encodeURIComponent(creatorName)}` : '';
        await fetch(`${SOCKET_SERVER_URL}/api/community-locations/${encodeURIComponent(room.id)}${qs}`, {
          method: 'DELETE',
        });
      } catch {}
      setCommunityRooms((prev) => prev.filter((r) => r.id !== room.id));
    }

    deleteUserRoom(room.id, ownerId);
    setSelectedRoom('downtown-hub');
    setOsmRoom(null);
    setActiveScene('world');
    setGpsToast(`Deleted room: ${room.name}`);
    setTimeout(() => setGpsToast(null), 3000);
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

  const confirmCreateRoom = async () => {
    const contributorName = profile?.profile?.characterName || profile?.mode || 'guest';
    const ownerId = profile?.profile?.email || profile?.mode || 'guest';
    const roomName = newRoomName.trim() || `${contributorName}'s Spot`;
    const cat = COMMUNITY_CATEGORIES.find(c => c.id === newRoomCategory) || COMMUNITY_CATEGORIES[0];
    const roomId = `user-${Date.now()}`;

    let publicRoomCreated = !newRoomPublic;

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
          setCreatingRoom(false);
          setGpsToast(`Community save failed: ${err.error || resp.status}`);
          setTimeout(() => setGpsToast(null), 5000);
          return;
        } else {
          const created = normalizeCommunityRoom(await resp.json().catch(() => null));
          if (created) {
            setCommunityRooms((prev) => mergeRoomsById(prev, [created]));
            publicRoomCreated = true;
          }
          localStorage.setItem('sidequest_loc_ts', Date.now().toString());
        }
      } catch (e) {
        setCreatingRoom(false);
        setGpsToast(`Community save error: ${e.message}`);
        setTimeout(() => setGpsToast(null), 5000);
        return;
      }
    }

    let newRoom = null;
    if (!newRoomPublic || publicRoomCreated) {
      newRoom = createUserRoom({
        id: roomId, name: roomName,
        lat: location.latitude, lng: location.longitude,
        radiusMeters: 60, contributor: contributorName, ownerId, isPublic: newRoomPublic,
      });
    }

    setCreatingRoom(false);
    if (newRoom) {
      setSelectedRoom(newRoom.id);
      setActiveScene('room');
    }
  };

  const roomCards = [
    ...allRooms.map((room) => ({
      id: room.id,
      name: room.name,
      kind: room.kind,
      lat: room.lat,
      lng: room.lng,
      radiusMeters: room.radiusMeters,
      ownerId: room.ownerId,
      contributors: room.contributors,
      icon: (room.kind === 'user-created' || room.kind === 'community') ? (room.emoji || '🔥') : { 'starbucks-spring': '☕', 'agora-houston': '🍷', 'downtown-hub': '🏙️', 'forest-gate': '🌲', 'sunset-temple': '⛩️' }[room.id] || '🏛️',
      blurb: (room.kind === 'user-created' || room.kind === 'community')
        ? `Community space · ${room.contributors.join(', ')}`
        : `GPS-anchored · ${room.radiusMeters}m radius`,
      status: roomMatch?.room?.id === room.id ? '✦ You are here' : (room.kind === 'user-created' || room.kind === 'community') ? 'Community' : 'GPS room',
      accent: (room.kind === 'user-created' || room.kind === 'community') ? (room.color || '#f97316') : { 'starbucks-spring': '#00704a', 'agora-houston': '#9333ea', 'downtown-hub': '#60a5fa', 'forest-gate': '#4ade80', 'sunset-temple': '#f472b6' }[room.id] || '#a78bfa',
      bg: (room.kind === 'user-created' || room.kind === 'community')
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
    : allRooms.find((room) => room.id === selectedRoom)
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
  const avatarStudioOpen = isLoggedIn && editingProfile;

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        minHeight: '100vh',
        height: isLoggedIn && !avatarStudioOpen ? '100vh' : 'auto',
        overflowX: 'hidden',
        overflowY: isLoggedIn && !avatarStudioOpen ? 'hidden' : 'auto',
        background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
        color: '#f8fafc',
        fontFamily: 'monospace',
      }}
    >

      {/* GPS block toast */}
      {gpsToast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: '#1e293b', border: '2px solid #ef4444', color: '#fca5a5', padding: '10px 20px', fontFamily: 'Courier New', fontSize: 13, maxWidth: 360, textAlign: 'center', boxShadow: '0 4px 20px #000' }}>
          📍 {gpsToast}
        </div>
      )}

      {/* Create room name prompt */}
      {!avatarStudioOpen && creatingRoom && (
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
      {!avatarStudioOpen && inviteToast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: '#16a34a', border: '2px solid #000', color: '#fff', padding: '10px 20px', fontFamily: 'Courier New', fontSize: 13, boxShadow: '0 4px 20px #000' }}>
          ✓ Invite link copied!
        </div>
      )}

      {!isLoggedIn && showLanding && (
        <RetroLandingPage onEnter={() => setShowLanding(false)} />
      )}

      {!isLoggedIn && !showLanding && <RetroAuthModal onLogin={handleLogin} />}

      {avatarStudioOpen && (
        <AvatarStudioPage
          formData={editForm}
          setFormData={setEditForm}
          profileError={profileError}
          onSave={saveEditProfile}
          onCancel={onboardingRequired ? null : () => setEditingProfile(false)}
          onForceEnter={onboardingRequired ? forceEnterWorld : null}
          onboardingRequired={onboardingRequired}
        />
      )}

      {isLoggedIn && !avatarStudioOpen && (
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
                    rooms={allRooms.map((r) => ({ ...r, radiusMeters: r.radiusMeters || r.radius || 100 }))}
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
                {(activeRoom?.kind === 'user-created' || activeRoom?.kind === 'community') && (activeRoom.ownerId === (profile?.profile?.email || profile?.mode || 'guest') || activeRoom.ownerId === (profile?.profile?.characterName || '')) && (
                  <button
                    onClick={() => handleDeleteRoom(activeRoom)}
                    style={{ position: 'absolute', bottom: 16, left: 12, zIndex: 1000, background: '#7f1d1d', border: '1px solid #ef4444', color: '#fecaca', padding: '6px 12px', fontFamily: 'Courier New', fontSize: 11, cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>
                    🗑 Delete room
                  </button>
                )}
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


