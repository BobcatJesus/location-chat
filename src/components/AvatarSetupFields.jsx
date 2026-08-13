import React, { useEffect, useRef, useState } from 'react';

const AVATAR_VARIANTS = {
  male: {
    id: 'male',
    label: 'Male Avatar',
    skin: '#ffd4b0',
    hair: '#e6b16b',
    hoodie: '#a9dfc4',
    hoodieShade: '#8ac8aa',
    eye: '#4a3f58',
    legacy: {
      skinId: 'tone-03',
      hairStyle: 'combed',
      bodyType: 'standard',
      skinTone: 30,
      hairHue: 36,
      outfitHue: 156,
      topStyle: 'hoodie',
      bottomStyle: 'pants',
      footwear: 'sneakers',
      glasses: false,
      hasScythe: false,
      avatarModel: 'hoodie',
    },
  },
  female: {
    id: 'female',
    label: 'Female Avatar',
    skin: '#ffd0b2',
    hair: '#d39a66',
    hoodie: '#aadfc8',
    hoodieShade: '#87c2a9',
    eye: '#4a3f58',
    legacy: {
      skinId: 'tone-02',
      hairStyle: 'lob',
      bodyType: 'standard',
      skinTone: 24,
      hairHue: 28,
      outfitHue: 156,
      topStyle: 'hoodie',
      bottomStyle: 'pants',
      footwear: 'sneakers',
      glasses: false,
      hasScythe: false,
      avatarModel: 'hoodie',
    },
  },
};

function getAvatarVariant(formData = {}) {
  const selected = String(formData.avatarGender || '').toLowerCase();
  if (selected === 'female') return AVATAR_VARIANTS.female;
  return AVATAR_VARIANTS.male;
}

function AvatarBuildPreview({ formData }) {
  const avatar = getAvatarVariant(formData);
  const isFemale = avatar.id === 'female';

  return (
    <div
      style={{
        width: 122,
        minWidth: 122,
        border: '2px solid #334155',
        borderRadius: 10,
        background: 'linear-gradient(180deg, #fafaf9 0%, #f4f4f5 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
        padding: 8,
      }}
    >
      <svg viewBox="0 0 96 106" width="100%" height="102" role="img" aria-label="Avatar preview">
        <rect x="23" y="95" width="50" height="4" rx="2" fill="rgba(0,0,0,0.2)" />

        <circle cx="48" cy="32" r="19" fill={avatar.skin} />
        <circle cx="29" cy="37" r="7" fill={avatar.skin} />
        <circle cx="67" cy="37" r="7" fill={avatar.skin} />

        <ellipse cx="48" cy="22" rx="23" ry="11.5" fill={avatar.hair} />
        <rect x="25" y="19" width="46" height="14" rx="6" fill={avatar.hair} />
        <path d="M25 28 L30 35 L34 31 L40 35 L46 31 L52 35 L58 31 L64 33 L68 28 L71 21 L25 21 Z" fill={avatar.hair} />
        <circle cx="50" cy="12" r="2.4" fill={avatar.hair} />
        {isFemale && (
          <>
            <rect x="24" y="31" width="7" height="9" rx="4" fill={avatar.hair} />
            <rect x="65" y="31" width="7" height="9" rx="4" fill={avatar.hair} />
          </>
        )}

        <rect x="44" y="50" width="8" height="7" rx="3" fill="rgba(0,0,0,0.12)" />

        <rect x="28" y="54" width="40" height="24" rx="11" fill={avatar.hoodie} />
        <rect x="34" y="68" width="28" height="8" rx="5" fill="rgba(0,0,0,0.2)" />
        <rect x="38" y="50" width="20" height="10" rx="6" fill={avatar.hoodieShade} />
        <line x1="42" y1="60" x2="42" y2="74" stroke="#2e2a30" strokeWidth="1.7" strokeLinecap="round" />
        <line x1="54" y1="60" x2="54" y2="74" stroke="#2e2a30" strokeWidth="1.7" strokeLinecap="round" />

        <rect x="24" y="58" width="8" height="15" rx="4" fill={avatar.hoodie} />
        <rect x="64" y="58" width="8" height="15" rx="4" fill={avatar.hoodie} />
        <circle cx="28" cy="74" r="5" fill={avatar.skin} />
        <circle cx="68" cy="74" r="5" fill={avatar.skin} />

        <rect x="36" y="78" width="11" height="15" rx="5" fill="#55516a" />
        <rect x="50" y="78" width="11" height="15" rx="5" fill="#55516a" />
        <rect x="33" y="92" width="15" height="9" rx="5" fill="#141313" />
        <rect x="50" y="92" width="15" height="9" rx="5" fill="#141313" />

        <ellipse cx="40" cy="40" rx="4.2" ry="6.2" fill={avatar.eye} />
        <ellipse cx="56" cy="40" rx="4.2" ry="6.2" fill={avatar.eye} />
        <circle cx="33" cy="46" r="3.6" fill="rgba(246,195,165,0.65)" />
        <circle cx="63" cy="46" r="3.6" fill="rgba(246,195,165,0.65)" />
        <path d="M45.6 46 Q48 49.4 50.4 46" stroke="#df8168" strokeWidth="1.7" fill="none" strokeLinecap="round" />

        <circle cx="48" cy="32" r="19" fill="none" stroke="rgba(52,45,51,0.92)" strokeWidth="1.9" />
        <circle cx="29" cy="37" r="7" fill="none" stroke="rgba(52,45,51,0.92)" strokeWidth="1.9" />
        <circle cx="67" cy="37" r="7" fill="none" stroke="rgba(52,45,51,0.92)" strokeWidth="1.9" />
        <rect x="28" y="54" width="40" height="24" rx="11" fill="none" stroke="rgba(52,45,51,0.92)" strokeWidth="1.9" />
        <rect x="32" y="92" width="34" height="9" rx="5" fill="none" stroke="rgba(52,45,51,0.92)" strokeWidth="1.9" />
      </svg>
      <div style={{ color: '#475569', fontSize: 10, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {avatar.label}
      </div>
    </div>
  );
}

export default function AvatarSetupFields({
  formData,
  setFormData,
  photoDataUrl,
  setPhotoDataUrl,
  firstNameInputRef,
  firstNameLabel = 'First Name',
  characterNameLabel = 'Avatar Name',
  showHints = true,
  fieldErrors = {},
  onFieldEdited,
}) {
  const fileInputRef = useRef(null);
  const previewHideTimerRef = useRef(null);
  const [previewPulse, setPreviewPulse] = useState({ visible: false, label: '' });

  useEffect(() => () => {
    if (previewHideTimerRef.current) clearTimeout(previewHideTimerRef.current);
  }, []);

  const showPreviewPulse = (label) => {
    setPreviewPulse({ visible: true, label });
    if (previewHideTimerRef.current) clearTimeout(previewHideTimerRef.current);
    previewHideTimerRef.current = setTimeout(() => {
      setPreviewPulse((prev) => ({ ...prev, visible: false }));
    }, 850);
  };

  const applyAvatarVariant = (variantId) => {
    const variant = variantId === 'female' ? AVATAR_VARIANTS.female : AVATAR_VARIANTS.male;
    setFormData((prev) => ({
      ...prev,
      avatarGender: variant.id,
      ...variant.legacy,
    }));
    showPreviewPulse(`${variant.label} selected`);
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const size = 96;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        setPhotoDataUrl(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const selectedVariant = getAvatarVariant(formData);

  return (
    <>
      <div>
        <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 4 }}>
          {firstNameLabel} {showHints && <span style={{ color: '#475569' }}>(shown above your avatar)</span>}
        </label>
        <input
          ref={firstNameInputRef}
          type="text"
          name="firstName"
          placeholder="e.g. Alex"
          value={formData.firstName || ''}
          onChange={(e) => {
            setFormData((prev) => ({ ...prev, firstName: e.target.value }));
            onFieldEdited?.('firstName');
          }}
          maxLength={20}
          style={{ width: '100%', boxSizing: 'border-box', background: '#000', border: '2px solid #475569', padding: '8px 10px', color: '#fbbf24', fontFamily: 'Courier New, monospace', fontSize: 13, outline: 'none' }}
        />
        {fieldErrors.firstName && (
          <div style={{ marginTop: 4, fontSize: 10, color: '#fca5a5' }}>{fieldErrors.firstName}</div>
        )}
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 4 }}>{characterNameLabel}</label>
        <input
          type="text"
          name="characterName"
          placeholder="e.g. HeroOfTime"
          value={formData.characterName || ''}
          onChange={(e) => {
            setFormData((prev) => ({ ...prev, characterName: e.target.value }));
            onFieldEdited?.('characterName');
          }}
          style={{ width: '100%', boxSizing: 'border-box', background: '#000', border: '2px solid #475569', padding: '8px 10px', color: '#fbbf24', fontFamily: 'Courier New, monospace', fontSize: 13, outline: 'none' }}
        />
        {fieldErrors.characterName && (
          <div style={{ marginTop: 4, fontSize: 10, color: '#fca5a5' }}>{fieldErrors.characterName}</div>
        )}
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 4 }}>
          Profile Photo <span style={{ color: '#475569' }}>(optional)</span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {photoDataUrl
            ? <img src={photoDataUrl} alt="preview" style={{ width: 40, height: 40, borderRadius: '50%', border: '2px solid #fbbf24', objectFit: 'cover' }} />
            : <div style={{ width: 40, height: 40, borderRadius: '50%', border: '2px dashed #475569', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>👤</div>
          }
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{ flex: 1, padding: '7px 10px', background: 'transparent', border: '2px solid #475569', color: '#94a3b8', fontFamily: 'Courier New, monospace', fontSize: 12, cursor: 'pointer' }}
          >
            {photoDataUrl ? 'Change photo' : 'Upload photo'}
          </button>
          {photoDataUrl && (
            <button
              type="button"
              onClick={() => setPhotoDataUrl(null)}
              style={{ padding: '7px 10px', background: 'transparent', border: '2px solid #475569', color: '#64748b', fontFamily: 'Courier New, monospace', fontSize: 12, cursor: 'pointer' }}
            >
              X
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoChange} style={{ display: 'none' }} />
        </div>
      </div>

      <div style={{ border: '2px solid #1e293b', background: '#020617', padding: 10, position: 'relative' }}>
        {previewPulse.visible && (
          <div style={{ position: 'absolute', top: -10, right: 8, zIndex: 3, border: '2px solid #fbbf24', background: '#111827', color: '#fde68a', padding: '4px 8px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', boxShadow: '2px 2px 0 #000', pointerEvents: 'none' }}>
            Avatar updated: {previewPulse.label}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8' }}>Choose Avatar</label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <AvatarBuildPreview formData={formData} />
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>
            <div style={{ marginBottom: 4 }}>{selectedVariant.label}</div>
            <div style={{ marginBottom: 4 }}>Model: Human Chibi</div>
            <div>Fixed style set</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {Object.values(AVATAR_VARIANTS).map((variant) => {
            const selected = selectedVariant.id === variant.id;
            return (
              <button
                key={variant.id}
                type="button"
                onClick={() => applyAvatarVariant(variant.id)}
                style={{
                  padding: '6px 10px',
                  border: selected ? '2px solid #fbbf24' : '2px solid #334155',
                  background: selected ? '#1f2937' : 'transparent',
                  color: selected ? '#fbbf24' : '#94a3b8',
                  fontFamily: 'Courier New, monospace',
                  fontSize: 11,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {variant.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
