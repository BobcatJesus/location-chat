import React, { useEffect, useRef, useState } from 'react';

const AVATAR_MODELS = {
  og: {
    id: 'og',
    label: 'OG Demon',
    previewSrc: '/village-sprites/characters/demon-front-step1.png',
  },
  bunny: {
    id: 'bunny',
    label: 'Bunny',
    previewSrc: '/avatars/bunny/front-step1.png',
  },
  turtle: {
    id: 'turtle',
    label: 'Turtle',
    previewSrc: '/avatars/turtle/front-step1.png',
  },
  snake: {
    id: 'snake',
    label: 'Snake',
    previewSrc: '/avatars/snake/front-step1.png',
  },
};

const BASE_AVATAR_LEGACY = {
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
};

function getAvatarModel(formData = {}) {
  const selected = String(formData.avatarModel || '').trim().toLowerCase();
  if (['og', 'demon', 'og-demon', 'original', 'legacy'].includes(selected)) return AVATAR_MODELS.og;
  if (['bunny', 'rabbit', 'bun', 'modular', 'bunny-avatar'].includes(selected)) return AVATAR_MODELS.bunny;
  if (['turtle', 'tortoise', 'turtle-avatar'].includes(selected)) return AVATAR_MODELS.turtle;
  if (['snake', 'serpent', 'snake-avatar'].includes(selected)) return AVATAR_MODELS.snake;
  return AVATAR_MODELS.bunny;
}

function AvatarBuildPreview({ formData }) {
  const model = getAvatarModel(formData);

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
      <div style={{ width: '100%', height: 102, overflow: 'hidden', borderRadius: 8, position: 'relative', background: '#fff' }}>
        <img
          src={model.previewSrc}
          alt={`${model.label} avatar reference`}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            imageRendering: 'pixelated',
          }}
        />
      </div>
      <div style={{ color: '#475569', fontSize: 10, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {model.label}
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

  const applyAvatarModel = (modelId) => {
    setFormData((prev) => ({
      ...prev,
      ...BASE_AVATAR_LEGACY,
      avatarModel: modelId,
    }));

    const model = AVATAR_MODELS[modelId] || AVATAR_MODELS.bunny;
    showPreviewPulse(`${model.label} selected`);
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

  const selectedModel = getAvatarModel(formData);

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
          Profile Photo <span style={{ color: '#fbbf24' }}>(recommended)</span>
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
            {photoDataUrl ? 'Change photo' : 'Upload profile photo'}
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
            <div style={{ marginBottom: 4 }}>{selectedModel.label}</div>
            <div style={{ marginBottom: 4 }}>Model: {selectedModel.label}</div>
            <div>Sprite model set</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {Object.values(AVATAR_MODELS).map((model) => {
            const selected = selectedModel.id === model.id;
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => applyAvatarModel(model.id)}
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
                {model.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
