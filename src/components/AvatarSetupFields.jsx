import React, { useRef } from 'react';
import { AVATAR_SKINS, AVATAR_HAIR_STYLES, AVATAR_BODY_TYPES } from './SpatialCanvas';

const AVATAR_PRESETS = [
  { id: 'og-shadow', label: 'OG Shadow', skinId: 'slate', hairStyle: 'side', bodyType: 'standard', pigment: 92, scarfHue: 220, eyeHue: 42 },
  { id: 'ember-imp', label: 'Ember Imp', skinId: 'red', hairStyle: 'mohawk', bodyType: 'compact', pigment: 75, scarfHue: 350, eyeHue: 22 },
  { id: 'violet-void', label: 'Violet Void', skinId: 'purple', hairStyle: 'short', bodyType: 'broad', pigment: 88, scarfHue: 275, eyeHue: 310 },
  { id: 'mint-wisp', label: 'Mint Wisp', skinId: 'green', hairStyle: 'buzz', bodyType: 'compact', pigment: 68, scarfHue: 148, eyeHue: 95 },
  { id: 'sun-glyph', label: 'Sun Glyph', skinId: 'orange', hairStyle: 'side', bodyType: 'standard', pigment: 54, scarfHue: 26, eyeHue: 50 },
  { id: 'rose-echo', label: 'Rose Echo', skinId: 'pink', hairStyle: 'short', bodyType: 'standard', pigment: 61, scarfHue: 330, eyeHue: 336 },
];

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

  const applyAvatarPreset = (preset) => {
    setFormData((prev) => ({
      ...prev,
      skinId: preset.skinId,
      hairStyle: preset.hairStyle,
      bodyType: preset.bodyType,
      pigment: preset.pigment,
      scarfHue: preset.scarfHue,
      eyeHue: preset.eyeHue,
    }));
  };

  const randomizeAvatar = () => {
    const skin = AVATAR_SKINS[Math.floor(Math.random() * AVATAR_SKINS.length)]?.id || 'blue';
    const hair = AVATAR_HAIR_STYLES[Math.floor(Math.random() * AVATAR_HAIR_STYLES.length)]?.id || 'short';
    const body = AVATAR_BODY_TYPES[Math.floor(Math.random() * AVATAR_BODY_TYPES.length)]?.id || 'standard';
    const pigment = Math.floor(Math.random() * 101);
    const scarfHue = Math.floor(Math.random() * 361);
    const eyeHue = Math.floor(Math.random() * 361);
    setFormData((prev) => ({ ...prev, skinId: skin, hairStyle: hair, bodyType: body, pigment, scarfHue, eyeHue }));
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

      <div style={{ border: '2px solid #1e293b', background: '#020617', padding: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8' }}>Choose Avatar</label>
          <button
            type="button"
            onClick={randomizeAvatar}
            style={{
              padding: '4px 8px',
              border: '2px solid #334155',
              background: 'transparent',
              color: '#93c5fd',
              fontFamily: 'Courier New, monospace',
              fontSize: 10,
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            Randomize
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid #fbbf24', background: (AVATAR_SKINS.find((s) => s.id === formData.skinId)?.swatch || '#3b82f6') }} />
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>
            {AVATAR_BODY_TYPES.find((b) => b.id === formData.bodyType)?.label || 'Classic'} · {AVATAR_HAIR_STYLES.find((h) => h.id === formData.hairStyle)?.label || 'Horns'}
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>
            Pigmentation Spectrum ({formData.pigment ?? 82})
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={formData.pigment ?? 82}
            onChange={(e) => setFormData((prev) => ({ ...prev, pigment: Number(e.target.value) }))}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>
            Scarf Hue ({formData.scarfHue ?? 220})
          </label>
          <input
            type="range"
            min="0"
            max="360"
            value={formData.scarfHue ?? 220}
            onChange={(e) => setFormData((prev) => ({ ...prev, scarfHue: Number(e.target.value) }))}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>
            Eye Glow Hue ({formData.eyeHue ?? 42})
          </label>
          <input
            type="range"
            min="0"
            max="360"
            value={formData.eyeHue ?? 42}
            onChange={(e) => setFormData((prev) => ({ ...prev, eyeHue: Number(e.target.value) }))}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>Presets</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {AVATAR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyAvatarPreset(preset)}
                style={{
                  padding: '4px 7px',
                  border: formData.skinId === preset.skinId && formData.hairStyle === preset.hairStyle && formData.bodyType === preset.bodyType
                    ? '2px solid #fbbf24'
                    : '2px solid #334155',
                  background: 'transparent',
                  color: '#cbd5e1',
                  fontFamily: 'Courier New, monospace',
                  fontSize: 10,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {AVATAR_SKINS.map((skin) => (
            <button
              key={skin.id}
              type="button"
              onClick={() => setFormData((prev) => ({ ...prev, skinId: skin.id }))}
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                border: formData.skinId === skin.id ? '2px solid #fbbf24' : '2px solid #334155',
                background: skin.swatch,
                cursor: 'pointer',
              }}
              title={skin.label}
            />
          ))}
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>Ears</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {AVATAR_HAIR_STYLES.map((hair) => (
              <button
                key={hair.id}
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, hairStyle: hair.id }))}
                style={{
                  padding: '4px 7px',
                  border: formData.hairStyle === hair.id ? '2px solid #fbbf24' : '2px solid #334155',
                  background: formData.hairStyle === hair.id ? '#1f2937' : 'transparent',
                  color: formData.hairStyle === hair.id ? '#fbbf24' : '#94a3b8',
                  fontFamily: 'Courier New, monospace',
                  fontSize: 10,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {hair.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>Build</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {AVATAR_BODY_TYPES.map((body) => (
              <button
                key={body.id}
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, bodyType: body.id }))}
                style={{
                  padding: '4px 7px',
                  border: formData.bodyType === body.id ? '2px solid #fbbf24' : '2px solid #334155',
                  background: formData.bodyType === body.id ? '#1f2937' : 'transparent',
                  color: formData.bodyType === body.id ? '#fbbf24' : '#94a3b8',
                  fontFamily: 'Courier New, monospace',
                  fontSize: 10,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {body.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
