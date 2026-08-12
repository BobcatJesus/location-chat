import React, { useEffect, useRef, useState } from 'react';
import { AVATAR_SKINS, AVATAR_HAIR_STYLES, AVATAR_BODY_TYPES } from './avatarOptions';
import { skinToneToColor, hairHueToColor, accessoryHueToColor } from '../utils/avatarColors';
import { AVATAR_MODELS } from '../game/entities/avatarModelInfo';

const AVATAR_PRESETS = [
  {
    id: 'street-commander',
    label: 'Street Commander',
    skinId: 'slate',
    hairStyle: 'messy',
    bodyType: 'broad',
    skinTone: 52,
    hairHue: 18,
    outfitHue: 218,
    topStyle: 'hoodie',
    bottomStyle: 'pants',
    footwear: 'heels',
    glasses: true,
    hasScythe: true,
  },
  {
    id: 'city-scholar',
    label: 'City Scholar',
    skinId: 'blue',
    hairStyle: 'combed',
    bodyType: 'standard',
    skinTone: 40,
    hairHue: 30,
    outfitHue: 196,
    topStyle: 'turtleneck',
    bottomStyle: 'skirt',
    footwear: 'heels',
    glasses: true,
    hasScythe: false,
  },
  {
    id: 'sunset-rebel',
    label: 'Sunset Rebel',
    skinId: 'orange',
    hairStyle: 'messy',
    bodyType: 'compact',
    skinTone: 66,
    hairHue: 338,
    outfitHue: 18,
    topStyle: 'hoodie',
    bottomStyle: 'skirt',
    footwear: 'sneakers',
    glasses: false,
    hasScythe: false,
  },
  {
    id: 'neon-warden',
    label: 'Neon Warden',
    skinId: 'teal',
    hairStyle: 'combed',
    bodyType: 'standard',
    skinTone: 32,
    hairHue: 252,
    outfitHue: 164,
    topStyle: 'turtleneck',
    bottomStyle: 'pants',
    footwear: 'sneakers',
    glasses: false,
    hasScythe: true,
  },
];

const TOP_OPTIONS = [
  { id: 'hoodie', label: 'Hoodie' },
  { id: 'turtleneck', label: 'Turtleneck' },
];

const BOTTOM_OPTIONS = [
  { id: 'pants', label: 'Pants' },
  { id: 'skirt', label: 'Skirt' },
];

const FOOTWEAR_OPTIONS = [
  { id: 'sneakers', label: 'Sneakers' },
  { id: 'heels', label: 'Heels' },
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
  collapseAdvancedByDefault = false,
}) {
  const fileInputRef = useRef(null);
  const [showAdvanced, setShowAdvanced] = useState(!collapseAdvancedByDefault);
  const previewHideTimerRef = useRef(null);
  const [previewPulse, setPreviewPulse] = useState({ visible: false, label: '' });

  useEffect(() => {
    setShowAdvanced(!collapseAdvancedByDefault);
  }, [collapseAdvancedByDefault]);

  useEffect(() => {
    return () => {
      if (previewHideTimerRef.current) {
        clearTimeout(previewHideTimerRef.current);
      }
    };
  }, []);

  const showPreviewPulse = (label) => {
    setPreviewPulse({ visible: true, label });
    if (previewHideTimerRef.current) {
      clearTimeout(previewHideTimerRef.current);
    }
    previewHideTimerRef.current = setTimeout(() => {
      setPreviewPulse((prev) => ({ ...prev, visible: false }));
    }, 850);
  };

  const applyAvatarPreset = (preset) => {
    setFormData((prev) => ({
      ...prev,
      skinId: preset.skinId,
      hairStyle: preset.hairStyle,
      bodyType: preset.bodyType,
      skinTone: preset.skinTone,
      hairHue: preset.hairHue,
      outfitHue: preset.outfitHue,
      topStyle: preset.topStyle,
      bottomStyle: preset.bottomStyle,
      footwear: preset.footwear,
      glasses: preset.glasses,
      hasScythe: preset.hasScythe,
    }));
    showPreviewPulse(`${preset.label} preset`);
  };

  const randomizeAvatar = () => {
    const skin = AVATAR_SKINS[Math.floor(Math.random() * AVATAR_SKINS.length)]?.id || 'blue';
    const hair = AVATAR_HAIR_STYLES[Math.floor(Math.random() * AVATAR_HAIR_STYLES.length)]?.id || 'combed';
    const body = AVATAR_BODY_TYPES[Math.floor(Math.random() * AVATAR_BODY_TYPES.length)]?.id || 'standard';
    const topStyle = TOP_OPTIONS[Math.floor(Math.random() * TOP_OPTIONS.length)]?.id || 'hoodie';
    const bottomStyle = BOTTOM_OPTIONS[Math.floor(Math.random() * BOTTOM_OPTIONS.length)]?.id || 'pants';
    const footwear = FOOTWEAR_OPTIONS[Math.floor(Math.random() * FOOTWEAR_OPTIONS.length)]?.id || 'sneakers';
    setFormData((prev) => ({
      ...prev,
      skinId: skin,
      hairStyle: hair,
      bodyType: body,
      skinTone: Math.floor(Math.random() * 101),
      hairHue: Math.floor(Math.random() * 361),
      outfitHue: Math.floor(Math.random() * 361),
      topStyle,
      bottomStyle,
      footwear,
      glasses: Math.random() > 0.5,
      hasScythe: Math.random() > 0.65,
    }));
    showPreviewPulse('Randomized style');
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

      <div style={{ border: '2px solid #1e293b', background: '#020617', padding: 10, position: 'relative' }}>
        {previewPulse.visible && (
          <div style={{ position: 'absolute', top: -10, right: 8, zIndex: 3, border: '2px solid #fbbf24', background: '#111827', color: '#fde68a', padding: '4px 8px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', boxShadow: '2px 2px 0 #000', pointerEvents: 'none' }}>
            Avatar updated: {previewPulse.label}
          </div>
        )}
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
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '2px solid #fbbf24',
              background: `linear-gradient(160deg, ${skinToneToColor(formData.skinTone ?? 45)} 0%, ${hairHueToColor(formData.hairHue ?? 26)} 55%, ${accessoryHueToColor(formData.outfitHue ?? 220)} 100%)`,
            }}
          />
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>
            {AVATAR_BODY_TYPES.find((b) => b.id === formData.bodyType)?.label || 'Core Build'} · {AVATAR_HAIR_STYLES.find((h) => h.id === formData.hairStyle)?.label || 'Combed Hair'}
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>
            Avatar Model
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {AVATAR_MODELS.map((model) => {
              const isSelected = (formData.avatarModel || 'hoodie') === model.id;
              const isDefault = model.id === 'hoodie';
              const iconAccent = model.id === 'bunny' ? '#fda4af' : (model.id === 'og' ? '#f97316' : '#cbd5e1');
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    setFormData((prev) => ({ ...prev, avatarModel: model.id }));
                    showPreviewPulse(`${model.label} model`);
                  }}
                  style={{
                    padding: isDefault ? '6px 10px' : '4px 7px',
                    border: isSelected ? '2px solid #fbbf24' : (isDefault ? '2px solid #475569' : '2px solid #334155'),
                    background: isSelected ? '#1f2937' : (isDefault ? '#0f172a' : 'transparent'),
                    color: isSelected ? '#fbbf24' : (isDefault ? '#cbd5e1' : '#94a3b8'),
                    fontFamily: 'Courier New, monospace',
                    fontSize: isDefault ? 11 : 10,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    fontWeight: isDefault ? 700 : 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'relative',
                      width: 16,
                      height: 16,
                      display: 'inline-block',
                      border: `1px solid ${isSelected ? '#fbbf24' : '#475569'}`,
                      borderRadius: 4,
                      background: '#111827',
                    }}
                  >
                    {model.id === 'bunny' ? (
                      <>
                        <span style={{ position: 'absolute', left: 4, top: 1, width: 3, height: 5, borderRadius: 2, background: iconAccent }} />
                        <span style={{ position: 'absolute', left: 9, top: 1, width: 3, height: 5, borderRadius: 2, background: iconAccent }} />
                        <span style={{ position: 'absolute', left: 3, top: 6, width: 10, height: 8, borderRadius: 999, background: iconAccent }} />
                      </>
                    ) : model.id === 'og' ? (
                      <>
                        <span style={{ position: 'absolute', left: 4, top: 2, width: 8, height: 8, borderRadius: 999, background: '#111111' }} />
                        <span style={{ position: 'absolute', left: 3, top: 1, width: 2, height: 4, transform: 'rotate(-25deg)', background: iconAccent, borderRadius: 2 }} />
                        <span style={{ position: 'absolute', left: 11, top: 1, width: 2, height: 4, transform: 'rotate(25deg)', background: iconAccent, borderRadius: 2 }} />
                        <span style={{ position: 'absolute', left: 3, top: 9, width: 10, height: 2, borderRadius: 2, background: '#ef4444' }} />
                      </>
                    ) : (
                      <>
                        <span style={{ position: 'absolute', left: 2, top: 2, width: 12, height: 11, borderRadius: 5, background: iconAccent }} />
                        <span style={{ position: 'absolute', left: 5, top: 10, width: 6, height: 3, borderRadius: 3, background: '#111827' }} />
                      </>
                    )}
                  </span>
                  <span>{model.label}</span>
                  {isDefault && (
                    <span style={{ fontSize: 9, color: '#94a3b8' }}>Default</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>
            Skin Tone Spectrum ({formData.skinTone ?? 45})
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={formData.skinTone ?? 45}
            onChange={(e) => {
              setFormData((prev) => ({ ...prev, skinTone: Number(e.target.value) }));
              showPreviewPulse('Skin tone spectrum');
            }}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>
            Hair Color Hue ({formData.hairHue ?? 26})
          </label>
          <input
            type="range"
            min="0"
            max="360"
            value={formData.hairHue ?? 26}
            onChange={(e) => {
              setFormData((prev) => ({ ...prev, hairHue: Number(e.target.value) }));
              showPreviewPulse('Hair hue');
            }}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>
            Outfit Color Hue ({formData.outfitHue ?? 220})
          </label>
          <input
            type="range"
            min="0"
            max="360"
            value={formData.outfitHue ?? 220}
            onChange={(e) => {
              setFormData((prev) => ({ ...prev, outfitHue: Number(e.target.value) }));
              showPreviewPulse('Outfit hue');
            }}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>Style Depth</label>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{ marginBottom: 8, padding: '4px 8px', border: '2px solid #334155', background: 'transparent', color: '#93c5fd', fontFamily: 'Courier New, monospace', fontSize: 10, textTransform: 'uppercase', cursor: 'pointer' }}
          >
            {showAdvanced ? 'Hide advanced style' : 'Show advanced style'}
          </button>
        </div>

        {showAdvanced && (
          <>
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
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>Hair Style</label>
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

        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>Top</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TOP_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, topStyle: option.id }))}
                style={{
                  padding: '4px 7px',
                  border: formData.topStyle === option.id ? '2px solid #fbbf24' : '2px solid #334155',
                  background: formData.topStyle === option.id ? '#1f2937' : 'transparent',
                  color: formData.topStyle === option.id ? '#fbbf24' : '#94a3b8',
                  fontFamily: 'Courier New, monospace',
                  fontSize: 10,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>Bottom</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {BOTTOM_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, bottomStyle: option.id }))}
                style={{
                  padding: '4px 7px',
                  border: formData.bottomStyle === option.id ? '2px solid #fbbf24' : '2px solid #334155',
                  background: formData.bottomStyle === option.id ? '#1f2937' : 'transparent',
                  color: formData.bottomStyle === option.id ? '#fbbf24' : '#94a3b8',
                  fontFamily: 'Courier New, monospace',
                  fontSize: 10,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>Footwear</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {FOOTWEAR_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, footwear: option.id }))}
                style={{
                  padding: '4px 7px',
                  border: formData.footwear === option.id ? '2px solid #fbbf24' : '2px solid #334155',
                  background: formData.footwear === option.id ? '#1f2937' : 'transparent',
                  color: formData.footwear === option.id ? '#fbbf24' : '#94a3b8',
                  fontFamily: 'Courier New, monospace',
                  fontSize: 10,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {option.label}
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

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setFormData((prev) => ({ ...prev, glasses: !prev.glasses }))}
            style={{
              flex: 1,
              padding: '6px 8px',
              border: formData.glasses ? '2px solid #fbbf24' : '2px solid #334155',
              background: formData.glasses ? '#1f2937' : 'transparent',
              color: formData.glasses ? '#fbbf24' : '#94a3b8',
              fontFamily: 'Courier New, monospace',
              fontSize: 10,
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            Glasses: {formData.glasses ? 'On' : 'Off'}
          </button>
          <button
            type="button"
            onClick={() => setFormData((prev) => ({ ...prev, hasScythe: !prev.hasScythe }))}
            style={{
              flex: 1,
              padding: '6px 8px',
              border: formData.hasScythe ? '2px solid #fbbf24' : '2px solid #334155',
              background: formData.hasScythe ? '#1f2937' : 'transparent',
              color: formData.hasScythe ? '#fbbf24' : '#94a3b8',
              fontFamily: 'Courier New, monospace',
              fontSize: 10,
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            Scythe: {formData.hasScythe ? 'On' : 'Off'}
          </button>
        </div>
          </>
        )}
      </div>
    </>
  );
}
