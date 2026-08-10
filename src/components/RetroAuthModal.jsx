import React, { useEffect, useMemo, useRef, useState } from 'react';
import AvatarSetupFields from './AvatarSetupFields';
import { accessoryHueToColor, hairHueToColor, skinToneToColor } from '../utils/avatarColors';
import { getAuthLayoutState } from './authLayout';

const normalizeHairStyle = (hairStyle) => {
  if (hairStyle === 'messy' || hairStyle === 'combed') return hairStyle;
  if (hairStyle === 'side' || hairStyle === 'mohawk') return 'messy';
  return 'combed';
};

const sanitizeCharacterName = (value = '') => value
  .toLowerCase()
  .trim()
  .replace(/\s+/g, '_')
  .replace(/[^a-z0-9_]/g, '')
  .slice(0, 24);

const getStepTitle = (isSignUp, signUpStep) => {
  if (!isSignUp) return 'Log In';
  if (signUpStep === 1) return 'Step 1: Build Your Avatar';
  if (signUpStep === 2) return 'Step 2: Account Security';
  return 'Step 3: Quest Readiness';
};

const formatLabel = (value = '') => {
  if (!value) return '';
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const SIGNUP_DRAFT_KEY = 'sidequest_signup_draft_v1';

export default function RetroAuthModal({ onLogin }) {
  const [isSignUp, setIsSignUp] = useState(true);
  const [signUpStep, setSignUpStep] = useState(1);
  const [transitionDirection, setTransitionDirection] = useState('mode');
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isCompactLayout, setIsCompactLayout] = useState(() => {
    if (typeof window === 'undefined') return false;
    return getAuthLayoutState(window.innerWidth).isCompactLayout;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [draftStatus, setDraftStatus] = useState('Idle');
  const [draftUpdatedAt, setDraftUpdatedAt] = useState(null);
  const [draftReady, setDraftReady] = useState(false);

  const initialForm = {
    email: '',
    password: '',
    characterName: '',
    firstName: '',
    skinId: 'slate',
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
    playstyle: 'explorer',
    agreeConduct: false,
    agreeLocationRules: false,
  };

  const [formData, setFormData] = useState(initialForm);
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const firstInputRef = useRef(null);
  const heroPanelRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem('sidequest_profile');
    if (saved) {
      try {
        const profile = JSON.parse(saved);
        onLogin?.({ mode: 'returning', profile });
      } catch {
        localStorage.removeItem('sidequest_profile');
      }
    }
  }, [onLogin]);

  useEffect(() => {
    setTimeout(() => firstInputRef.current?.focus(), 50);
  }, [isSignUp, signUpStep]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIGNUP_DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft?.formData) {
          setFormData((prev) => ({
            ...prev,
            ...draft.formData,
            password: '',
          }));
          setPhotoDataUrl(draft.photoDataUrl || null);
          setDraftUpdatedAt(draft.updatedAt || null);
          setDraftStatus('Draft restored');
        } else {
          setDraftStatus('Idle');
        }
      } else {
        setDraftStatus('Idle');
      }
    } catch {
      localStorage.removeItem(SIGNUP_DRAFT_KEY);
      setDraftStatus('Idle');
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    if (!isSignUp) {
      setDraftStatus('Paused');
      return;
    }
    setDraftStatus('Saving...');
    const timeout = setTimeout(() => {
      const payload = {
        formData: {
          ...formData,
          password: '',
        },
        photoDataUrl,
        updatedAt: Date.now(),
      };
      localStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify(payload));
      setDraftUpdatedAt(payload.updatedAt);
      setDraftStatus('Saved');
    }, 260);

    return () => clearTimeout(timeout);
  }, [draftReady, formData, photoDataUrl, isSignUp, signUpStep]);

  useEffect(() => {
    const onResize = () => setIsCompactLayout(getAuthLayoutState(window.innerWidth).isCompactLayout);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(media.matches);
    updatePreference();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', updatePreference);
      return () => media.removeEventListener('change', updatePreference);
    }

    media.addListener(updatePreference);
    return () => media.removeListener(updatePreference);
  }, []);

  const clearFieldError = (fieldName) => {
    if (!fieldErrors[fieldName]) return;
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    if (error) setError(null);
    clearFieldError(name);
  };

  const getAvatarFieldErrors = () => {
    const nextErrors = {};
    const first = formData.firstName.trim();
    const charName = formData.characterName.trim();
    const normalized = sanitizeCharacterName(charName);

    if (!first) {
      nextErrors.firstName = 'Please enter your first name.';
    }
    if (charName.length < 3) {
      nextErrors.characterName = 'Avatar name needs at least 3 characters.';
    }
    if (charName.length >= 3 && normalized.length < 3) {
      nextErrors.characterName = 'Use only letters, numbers, and underscores.';
    }
    return nextErrors;
  };

  const getAccountFieldErrors = () => {
    const nextErrors = {};
    if (!formData.email.trim()) {
      nextErrors.email = 'Enter an email (or username).';
    }
    if (formData.password.length < 4) {
      nextErrors.password = 'Password must be at least 4 characters.';
    }
    return nextErrors;
  };

  const getReadinessFieldErrors = () => {
    const nextErrors = {};
    if (!formData.agreeConduct) {
      nextErrors.agreeConduct = 'You need to agree to respectful behavior.';
    }
    if (!formData.agreeLocationRules) {
      nextErrors.agreeLocationRules = 'You need to confirm safe location sharing.';
    }
    return nextErrors;
  };

  const validateAvatarStep = () => {
    const nextErrors = getAvatarFieldErrors();
    setFieldErrors((prev) => ({ ...prev, ...nextErrors }));
    if (nextErrors.firstName) return 'WHO GOES THERE? Enter your first name.';
    if (nextErrors.characterName) return 'ILLEGAL RUNES! Name can only contain letters, numbers, and underscores.';
    return null;
  };

  const validateAccountStep = () => {
    const nextErrors = getAccountFieldErrors();
    setFieldErrors((prev) => ({ ...prev, ...nextErrors }));
    if (nextErrors.email) return 'INVALID SCROLL! Please enter a valid email address.';
    if (nextErrors.password) return 'DEFENSE TOO LOW! Password must be at least 8 characters.';
    return null;
  };

  const validateReadinessStep = () => {
    const nextErrors = getReadinessFieldErrors();
    setFieldErrors((prev) => ({ ...prev, ...nextErrors }));
    if (nextErrors.agreeConduct) return 'You must agree to the code of conduct.';
    if (nextErrors.agreeLocationRules) return 'You must confirm safe location sharing.';
    return null;
  };

  const switchMode = (signUpMode) => {
    setTransitionDirection('mode');
    setIsSignUp(signUpMode);
    setSignUpStep(1);
    setError(null);
    setFieldErrors({});
  };

  const stepForward = () => {
    if (signUpStep === 1) {
      const firstName = formData.firstName.trim();
      const proposedName = formData.characterName.trim() || firstName;
      const normalized = sanitizeCharacterName(proposedName);
      if (normalized && normalized !== formData.characterName) {
        setFormData((prev) => ({ ...prev, characterName: normalized }));
      }

      const err = validateAvatarStep();
      if (err) return setError(err);
      setTransitionDirection('forward');
      setError(null);
      setFieldErrors({});
      return setSignUpStep(2);
    }

    if (signUpStep === 2) {
      const emailValue = formData.email.trim();
      if (emailValue && !emailValue.includes('@')) {
        setFormData((prev) => ({ ...prev, email: `${sanitizeCharacterName(emailValue)}@side.quest` }));
      }
      const err = validateAccountStep();
      if (err) return setError(err);
      setTransitionDirection('forward');
      setError(null);
      setFieldErrors({});
      return setSignUpStep(3);
    }

    return null;
  };

  const stepBack = () => {
    setTransitionDirection('back');
    setError(null);
    setFieldErrors({});
    setSignUpStep((prev) => Math.max(1, prev - 1));
  };

  const canSubmit = !isSignUp || signUpStep === 3;

  const readinessItems = useMemo(() => ([
    { id: 'avatar', label: 'Avatar built', done: signUpStep > 1 },
    { id: 'account', label: 'Account secured', done: signUpStep > 2 },
    { id: 'conduct', label: 'Safety confirmed', done: Boolean(formData.agreeConduct && formData.agreeLocationRules) },
  ]), [formData.agreeConduct, formData.agreeLocationRules, signUpStep]);

  const setupSteps = useMemo(() => ([
    { id: 1, title: 'Avatar Forge', hint: 'Human style, outfit, accessories' },
    { id: 2, title: 'Security Seal', hint: 'Account and password' },
    { id: 3, title: 'Readiness Oath', hint: 'Safety confirmations' },
  ]), []);

  const skinSwatch = skinToneToColor(formData.skinTone ?? 45);
  const hairSwatch = hairHueToColor(formData.hairHue ?? 26);
  const outfitSwatch = accessoryHueToColor(formData.outfitHue ?? 220);
  const outfitDark = accessoryHueToColor(formData.outfitHue ?? 220, 48, 34);
  const stepAnimationKey = isSignUp ? `signup-${signUpStep}` : 'login';
  const showHeroPanel = !isCompactLayout;
  const stepAnimationName = transitionDirection === 'back'
    ? 'authStepEnterBack'
    : transitionDirection === 'forward'
      ? 'authStepEnterForward'
      : 'authStepEnterMode';
  const stepAnimationValue = prefersReducedMotion
    ? 'none'
    : isCompactLayout
      ? 'none'
      : `${stepAnimationName} 340ms cubic-bezier(.22,.9,.25,1)`;

  const handleHeroPointerMove = (e) => {
    if (prefersReducedMotion) return;
    const node = heroPanelRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width - 0.5;
    const relY = (e.clientY - rect.top) / rect.height - 0.5;
    const tiltX = -(relY * 6);
    const tiltY = relX * 8;
    const shiftX = relX * 5;
    const shiftY = relY * 4;

    node.style.setProperty('--hero-tilt-x', `${tiltX.toFixed(2)}deg`);
    node.style.setProperty('--hero-tilt-y', `${tiltY.toFixed(2)}deg`);
    node.style.setProperty('--hero-shift-x', `${shiftX.toFixed(2)}px`);
    node.style.setProperty('--hero-shift-y', `${shiftY.toFixed(2)}px`);
  };

  const resetHeroPointer = () => {
    const node = heroPanelRef.current;
    if (!node) return;
    node.style.setProperty('--hero-tilt-x', '0deg');
    node.style.setProperty('--hero-tilt-y', '0deg');
    node.style.setProperty('--hero-shift-x', '0px');
    node.style.setProperty('--hero-shift-y', '0px');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isSignUp && signUpStep !== 3) {
      stepForward();
      return;
    }

    const validationError = isSignUp ? validateReadinessStep() : validateAccountStep();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const normalizedEmail = formData.email.includes('@') ? formData.email : `${sanitizeCharacterName(formData.email) || 'player'}@side.quest`;
      const characterName = sanitizeCharacterName(formData.characterName.trim() || normalizedEmail.split('@')[0]) || `traveler_${Date.now().toString().slice(-4)}`;
      let profile = {
        email: normalizedEmail,
        characterName,
        firstName: formData.firstName.trim(),
        photo: photoDataUrl,
        skinId: formData.skinId || 'slate',
        hairStyle: normalizeHairStyle(formData.hairStyle),
        bodyType: formData.bodyType || 'standard',
        skinTone: formData.skinTone ?? 45,
        hairHue: formData.hairHue ?? 26,
        outfitHue: formData.outfitHue ?? 220,
        topStyle: formData.topStyle || 'hoodie',
        bottomStyle: formData.bottomStyle || 'pants',
        footwear: formData.footwear || 'sneakers',
        glasses: Boolean(formData.glasses),
        hasScythe: Boolean(formData.hasScythe),
        playstyle: formData.playstyle || 'explorer',
        avatarOnboardingComplete: isSignUp,
        avatarRevision: Date.now(),
      };

      if (isSignUp) {
        localStorage.removeItem('sidequest_profile');
        localStorage.setItem('sidequest_profile', JSON.stringify(profile));
      } else {
        const saved = localStorage.getItem('sidequest_profile');
        if (saved) {
          const existing = JSON.parse(saved);
          if (existing.email !== formData.email) {
            throw new Error('No save file found for this email.');
          }
          profile = {
            ...existing,
            skinId: existing.skinId || 'slate',
            hairStyle: normalizeHairStyle(existing.hairStyle),
            bodyType: existing.bodyType || 'standard',
            skinTone: existing.skinTone ?? existing.pigment ?? 45,
            hairHue: existing.hairHue ?? existing.eyeHue ?? 26,
            outfitHue: existing.outfitHue ?? existing.scarfHue ?? 220,
            topStyle: existing.topStyle || 'hoodie',
            bottomStyle: existing.bottomStyle || 'pants',
            footwear: existing.footwear || 'sneakers',
            glasses: Boolean(existing.glasses),
            hasScythe: Boolean(existing.hasScythe),
          };
        } else {
          localStorage.setItem('sidequest_profile', JSON.stringify(profile));
        }
      }

      onLogin?.({ mode: isSignUp ? 'signup' : 'login', profile });
      localStorage.removeItem(SIGNUP_DRAFT_KEY);
      setDraftUpdatedAt(null);
    } catch {
      setError('HP CRITICAL! Invalid credentials or connection error.');
    } finally {
      setIsLoading(false);
    }
  };

  const enterAsGuest = () => {
    const stamp = Date.now().toString().slice(-4);
    const fallbackFirst = formData.firstName.trim() || `Guest${stamp}`;
    const fallbackName = sanitizeCharacterName(formData.characterName.trim() || fallbackFirst) || `guest_${stamp}`;
    const profile = {
      email: `guest_${stamp}@side.quest`,
      characterName: fallbackName,
      firstName: fallbackFirst,
      photo: photoDataUrl,
      skinId: formData.skinId || 'slate',
      hairStyle: normalizeHairStyle(formData.hairStyle),
      bodyType: formData.bodyType || 'standard',
      skinTone: formData.skinTone ?? 45,
      hairHue: formData.hairHue ?? 26,
      outfitHue: formData.outfitHue ?? 220,
      topStyle: formData.topStyle || 'hoodie',
      bottomStyle: formData.bottomStyle || 'pants',
      footwear: formData.footwear || 'sneakers',
      glasses: Boolean(formData.glasses),
      hasScythe: Boolean(formData.hasScythe),
      playstyle: formData.playstyle || 'explorer',
      avatarOnboardingComplete: true,
      guestMode: true,
    };
    localStorage.setItem('sidequest_profile', JSON.stringify(profile));
    localStorage.removeItem(SIGNUP_DRAFT_KEY);
    onLogin?.({ mode: 'guest', profile });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 21000, minHeight: '100vh', width: '100%', background: 'radial-gradient(120% 100% at 0% 0%, #3f1d18 0%, #160f21 38%, #030712 100%)', color: '#f8fafc', fontFamily: 'Rajdhani, Bebas Neue, Segoe UI, sans-serif', overflowY: 'auto', WebkitOverflowScrolling: 'touch', pointerEvents: 'auto' }}>
      <style>{`
        @keyframes authGlowPulse {
          0% { box-shadow: 0 0 0 rgba(251, 191, 36, 0.0); }
          50% { box-shadow: 0 0 26px rgba(251, 191, 36, 0.32); }
          100% { box-shadow: 0 0 0 rgba(251, 191, 36, 0.0); }
        }
        @keyframes authFloat {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
          100% { transform: translateY(0px); }
        }
        @keyframes authStepEnter {
          0% { opacity: 0; transform: translateY(10px) scale(0.985); }
          100% { opacity: 1; transform: translateY(0px) scale(1); }
        }
        @keyframes authStepEnterForward {
          0% { opacity: 0; transform: translateX(28px) scale(0.992); }
          100% { opacity: 1; transform: translateX(0px) scale(1); }
        }
        @keyframes authStepEnterBack {
          0% { opacity: 0; transform: translateX(-28px) scale(0.992); }
          100% { opacity: 1; transform: translateX(0px) scale(1); }
        }
        @keyframes authStepEnterMode {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0px); }
        }
      `}</style>
      <a
        href="?quickStart=guest"
        onClick={(e) => {
          e.preventDefault();
          enterAsGuest();
        }}
        style={{ position: 'fixed', top: 10, right: 10, zIndex: 21050, padding: '8px 12px', border: '2px solid #f59e0b', background: '#111827', color: '#fde68a', fontFamily: 'Rajdhani, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', cursor: 'pointer', textDecoration: 'none' }}
      >
        Enter As Guest
      </a>
      <div
        style={{
          maxWidth: 1200,
          margin: '42px auto 0',
          padding: isCompactLayout ? '14px 10px 22px' : '24px 16px 36px',
          display: 'grid',
          gridTemplateColumns: isCompactLayout ? '1fr' : 'minmax(280px, 1fr) minmax(330px, 560px)',
          gap: isCompactLayout ? 10 : 18,
          alignItems: 'start',
        }}
      >
        {showHeroPanel && (
        <aside
          ref={heroPanelRef}
          onMouseMove={prefersReducedMotion ? undefined : handleHeroPointerMove}
          onMouseLeave={resetHeroPointer}
          style={{
            border: '2px solid #3a2631',
            background: 'linear-gradient(145deg, rgba(18,12,32,0.98) 0%, rgba(45,22,28,0.88) 100%)',
            padding: isCompactLayout ? 14 : 20,
            boxShadow: '0 14px 30px rgba(0,0,0,0.45)',
            order: isCompactLayout ? 2 : 1,
            transform: prefersReducedMotion
              ? 'none'
              : 'perspective(980px) rotateX(var(--hero-tilt-x, 0deg)) rotateY(var(--hero-tilt-y, 0deg)) translate3d(var(--hero-shift-x, 0px), var(--hero-shift-y, 0px), 0)',
            transformStyle: 'preserve-3d',
            transition: prefersReducedMotion ? 'none' : 'transform 140ms ease-out',
            willChange: 'transform',
          }}
        >
          <div style={{ display: 'inline-block', color: '#fbbf24', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', border: '1px solid #7c2d12', padding: '5px 10px', background: 'rgba(124,45,18,0.25)', marginBottom: 10, transform: 'translateZ(18px)' }}>
            Side Quest Access Node
          </div>
          <h1 style={{ margin: '0 0 10px', fontFamily: 'Bebas Neue, Impact, sans-serif', fontSize: 'clamp(2.4rem, 7vw, 4rem)', lineHeight: 0.9, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#fef3c7', transform: 'translateZ(28px)' }}>
            Create Your Entry
          </h1>
          <p style={{ margin: '0 0 14px', color: '#cbd5e1', fontSize: 14, lineHeight: 1.5, maxWidth: 460, transform: 'translateZ(12px)' }}>
            Your first impression now has weight: craft your human avatar, lock your account, and complete entry conditions before you hit the world map.
          </p>

          <div style={{ border: '2px solid #4c1d95', padding: 12, background: 'linear-gradient(140deg, rgba(22,29,54,0.7), rgba(11,18,32,0.85))', marginBottom: 12, transform: 'translateZ(16px)' }}>
            <div style={{ fontSize: 11, color: '#a5b4fc', textTransform: 'uppercase', marginBottom: 9, letterSpacing: '0.08em' }}>Progress Rail</div>
            {setupSteps.map((step) => {
              const active = isSignUp && signUpStep === step.id;
              const done = !isSignUp ? false : signUpStep > step.id;
              return (
                <div key={step.id} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', columnGap: 8, marginBottom: 8, alignItems: 'start' }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${done ? '#22c55e' : active ? '#fbbf24' : '#475569'}`, background: done ? '#14532d' : active ? '#78350f' : 'transparent', color: done ? '#bbf7d0' : active ? '#fde68a' : '#64748b', fontSize: 11, display: 'grid', placeItems: 'center', fontWeight: 700 }}>
                    {done ? 'OK' : step.id}
                  </div>
                  <div>
                    <div style={{ color: done || active ? '#f8fafc' : '#64748b', fontSize: 13, fontWeight: 700, letterSpacing: '0.03em' }}>{step.title}</div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>{step.hint}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ border: '2px solid #334155', padding: 11, background: '#0b1120', marginBottom: 12, transform: 'translateZ(10px)' }}>
            <div style={{ fontSize: 11, color: '#93c5fd', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.08em' }}>Readiness Checklist</div>
            {readinessItems.map((item) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, color: item.done ? '#86efac' : '#64748b', fontSize: 12 }}>
                <span>{item.done ? 'OK' : '--'}</span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          <div style={{ border: '2px solid #1f2937', padding: 10, background: '#030712', transform: 'translateZ(14px)' }}>
            <div style={{ fontSize: 11, color: '#cbd5e1', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.08em' }}>Character Dossier</div>
            <div style={{ marginBottom: 10, border: '1px solid #334155', background: 'radial-gradient(circle at 50% 18%, #111827 0%, #020617 72%)', height: 136, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: '50%', top: 114, width: 54, height: 10, borderRadius: '50%', background: '#00000088', transform: 'translateX(-50%)' }} />

              <div style={{ position: 'absolute', left: '50%', top: 82, width: 10, height: 24, background: formData.bottomStyle === 'skirt' ? outfitDark : outfitSwatch, transform: 'translateX(-13px)', borderRadius: 2 }} />
              <div style={{ position: 'absolute', left: '50%', top: 82, width: 10, height: 24, background: formData.bottomStyle === 'skirt' ? outfitDark : outfitSwatch, transform: 'translateX(3px)', borderRadius: 2 }} />

              <div style={{ position: 'absolute', left: '50%', top: 70, width: 16, height: 10, background: formData.footwear === 'heels' ? '#111827' : '#1f2937', transform: 'translateX(-17px)', borderRadius: 2 }} />
              <div style={{ position: 'absolute', left: '50%', top: 70, width: 16, height: 10, background: formData.footwear === 'heels' ? '#111827' : '#1f2937', transform: 'translateX(1px)', borderRadius: 2 }} />

              <div style={{ position: 'absolute', left: '50%', top: 50, width: 34, height: 28, background: outfitSwatch, transform: 'translateX(-50%)', borderRadius: 4 }} />
              {formData.bottomStyle === 'skirt' && (
                <div style={{ position: 'absolute', left: '50%', top: 68, width: 38, height: 11, background: outfitDark, transform: 'translateX(-50%)', clipPath: 'polygon(0% 0%, 100% 0%, 84% 100%, 16% 100%)' }} />
              )}
              {formData.topStyle === 'hoodie' ? (
                <div style={{ position: 'absolute', left: '50%', top: 44, width: 24, height: 11, border: `3px solid ${outfitDark}`, borderBottom: 'none', borderRadius: '16px 16px 0 0', transform: 'translateX(-50%)' }} />
              ) : (
                <>
                  <div style={{ position: 'absolute', left: '50%', top: 48, width: 28, height: 3, background: outfitDark, transform: 'translateX(-50%)' }} />
                  <div style={{ position: 'absolute', left: '50%', top: 52, width: 22, height: 2, background: outfitDark, transform: 'translateX(-50%)' }} />
                </>
              )}

              <div style={{ position: 'absolute', left: '50%', top: 44, width: 7, height: 4, background: skinSwatch, transform: 'translateX(-50%)', borderRadius: 2 }} />
              <div style={{ position: 'absolute', left: '50%', top: 22, width: 24, height: 24, background: skinSwatch, transform: 'translateX(-50%)', borderRadius: '50%', border: '1px solid #1f2937' }} />

              {formData.hairStyle === 'messy' ? (
                <>
                  <div style={{ position: 'absolute', left: '50%', top: 17, width: 28, height: 9, background: hairSwatch, transform: 'translateX(-50%)', borderRadius: 4 }} />
                  <div style={{ position: 'absolute', left: '50%', top: 16, width: 7, height: 8, background: hairSwatch, transform: 'translateX(-14px) rotate(-16deg)', borderRadius: 2 }} />
                  <div style={{ position: 'absolute', left: '50%', top: 16, width: 7, height: 8, background: hairSwatch, transform: 'translateX(7px) rotate(12deg)', borderRadius: 2 }} />
                </>
              ) : (
                <>
                  <div style={{ position: 'absolute', left: '50%', top: 16, width: 29, height: 10, background: hairSwatch, transform: 'translateX(-50%)', borderRadius: '4px 4px 2px 2px' }} />
                  <div style={{ position: 'absolute', left: '50%', top: 22, width: 5, height: 9, background: hairSwatch, transform: 'translateX(10px)', borderRadius: 2 }} />
                </>
              )}

              {formData.glasses && (
                <>
                  <div style={{ position: 'absolute', left: '50%', top: 30, width: 6, height: 6, border: '1px solid #0f172a', transform: 'translateX(-9px)', background: '#ffffff22' }} />
                  <div style={{ position: 'absolute', left: '50%', top: 30, width: 6, height: 6, border: '1px solid #0f172a', transform: 'translateX(3px)', background: '#ffffff22' }} />
                  <div style={{ position: 'absolute', left: '50%', top: 33, width: 4, height: 1, transform: 'translateX(-2px)', background: '#0f172a' }} />
                </>
              )}

              {formData.hasScythe && (
                <>
                  <div style={{ position: 'absolute', left: '50%', top: 26, width: 2, height: 60, background: '#6b7280', transform: 'translateX(23px) rotate(22deg)', transformOrigin: 'top' }} />
                  <div style={{ position: 'absolute', left: '50%', top: 19, width: 14, height: 8, borderTop: '2px solid #dbe4f2', borderRight: '2px solid #dbe4f2', borderRadius: '0 10px 0 0', transform: 'translateX(22px) rotate(10deg)' }} />
                </>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              {photoDataUrl
                ? <img src={photoDataUrl} alt="avatar portrait" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '2px solid #fbbf24' }} />
                : <div style={{ width: 48, height: 48, borderRadius: '50%', border: '2px dashed #475569', display: 'grid', placeItems: 'center', color: '#64748b', fontSize: 12 }}>ID</div>
              }
              <div>
                <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 700 }}>{formData.firstName || 'Unnamed Traveler'}</div>
                <div style={{ color: '#94a3b8', fontSize: 12 }}>@{formData.characterName || 'character_name'}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
              <div style={{ height: 18, borderRadius: 3, background: skinSwatch, border: '1px solid #475569' }} title="Skin tone" />
              <div style={{ height: 18, borderRadius: 3, background: hairSwatch, border: '1px solid #475569' }} title="Hair hue" />
              <div style={{ height: 18, borderRadius: 3, background: outfitSwatch, border: '1px solid #475569' }} title="Outfit hue" />
            </div>

            <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.45 }}>
              {formatLabel(formData.topStyle || 'hoodie')} · {formatLabel(formData.bottomStyle || 'pants')} · {formatLabel(formData.footwear || 'sneakers')}
              {formData.glasses ? ' · glasses' : ''}
              {formData.hasScythe ? ' · scythe' : ''}
            </div>
          </div>
        </aside>
        )}

        <section style={{ border: '4px solid #fef3c7', background: 'linear-gradient(170deg, #0b1226 0%, #111827 100%)', padding: 4, boxShadow: '10px 10px 0 #020617', animation: prefersReducedMotion || isCompactLayout ? 'none' : 'authGlowPulse 3.8s ease-in-out infinite', order: isCompactLayout ? 1 : 2 }}>
          <div style={{ border: '2px solid #3b82f6', background: 'linear-gradient(175deg, rgba(15,23,42,0.95), rgba(9,12,22,0.95))', padding: isCompactLayout ? 12 : 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, borderBottom: '2px solid #1e293b', paddingBottom: 10, marginBottom: 14 }}>
              <h2 style={{ margin: 0, color: '#fbbf24', fontFamily: 'Bebas Neue, Impact, sans-serif', fontSize: 24, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{getStepTitle(isSignUp, signUpStep)}</h2>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{isSignUp ? `Step ${signUpStep} of 3` : 'Returning player'}</div>
                {isSignUp && (
                  <>
                    <div style={{ fontSize: 10, border: '1px solid #334155', padding: '2px 6px', color: draftStatus === 'Saving...' ? '#fbbf24' : draftStatus === 'Draft restored' ? '#93c5fd' : '#86efac', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Draft: {draftStatus}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {draftUpdatedAt ? `Saved ${new Date(draftUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'No local draft'}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', marginBottom: 14, border: '2px solid #1f2937', background: '#0f172a', padding: 4, gap: 4, borderRadius: 999 }}>
              {[['Log In', false], ['Sign Up', true]].map(([label, signUpMode]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => switchMode(signUpMode)}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    fontSize: 12,
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    cursor: 'pointer',
                    fontFamily: 'Rajdhani, sans-serif',
                    border: 'none',
                    borderRadius: 999,
                    background: isSignUp === signUpMode ? 'linear-gradient(90deg, #2563eb, #1d4ed8)' : 'transparent',
                    color: isSignUp === signUpMode ? '#fff' : '#64748b',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={enterAsGuest}
              style={{ width: '100%', marginBottom: 14, padding: '9px 10px', background: 'transparent', border: '2px dashed #475569', color: '#cbd5e1', fontFamily: 'Rajdhani, sans-serif', fontSize: 12, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', cursor: 'pointer' }}
            >
              Continue as Guest
            </button>

            {error && (
              <div style={{ marginBottom: 12, padding: '8px 10px', background: 'rgba(127,29,29,0.8)', border: '2px solid #ef4444', color: '#fca5a5', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: isCompactLayout ? 74 : 0 }}>
              <div key={stepAnimationKey} style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: stepAnimationValue }}>
                {isSignUp && signUpStep === 1 && (
                  <AvatarSetupFields
                    formData={formData}
                    setFormData={setFormData}
                    photoDataUrl={photoDataUrl}
                    setPhotoDataUrl={setPhotoDataUrl}
                    firstNameInputRef={firstInputRef}
                    fieldErrors={fieldErrors}
                    onFieldEdited={clearFieldError}
                    collapseAdvancedByDefault={isCompactLayout}
                  />
                )}

                {(!isSignUp || signUpStep === 2) && (
                  <>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 4 }}>Email Address</label>
                      <input
                        ref={firstInputRef}
                        type="email"
                        name="email"
                        placeholder="player@world.com"
                        value={formData.email}
                        onChange={handleInputChange}
                        style={{ width: '100%', boxSizing: 'border-box', background: '#000', border: '2px solid #475569', padding: '8px 10px', color: '#fbbf24', fontFamily: 'Courier New, monospace', fontSize: 13, outline: 'none' }}
                      />
                      {fieldErrors.email && <div style={{ marginTop: 4, fontSize: 10, color: '#fca5a5' }}>{fieldErrors.email}</div>}
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 4 }}>Password</label>
                      <input
                        type="password"
                        name="password"
                        placeholder="8+ characters"
                        value={formData.password}
                        onChange={handleInputChange}
                        style={{ width: '100%', boxSizing: 'border-box', background: '#000', border: '2px solid #475569', padding: '8px 10px', color: '#fbbf24', fontFamily: 'Courier New, monospace', fontSize: 13, outline: 'none' }}
                      />
                      {fieldErrors.password && <div style={{ marginTop: 4, fontSize: 10, color: '#fca5a5' }}>{fieldErrors.password}</div>}
                    </div>
                  </>
                )}

                {isSignUp && signUpStep === 3 && (
                  <>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 5 }}>Playstyle</label>
                      <select
                        name="playstyle"
                        value={formData.playstyle}
                        onChange={handleInputChange}
                        style={{ width: '100%', background: '#000', border: '2px solid #475569', padding: '8px 10px', color: '#fbbf24', fontFamily: 'Courier New, monospace', fontSize: 13 }}
                      >
                        <option value="explorer">Explorer</option>
                        <option value="social">Socializer</option>
                        <option value="builder">Builder</option>
                      </select>
                    </div>

                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', border: '2px solid #334155', background: '#111827', fontSize: 12, color: '#cbd5e1' }}>
                      <input type="checkbox" name="agreeConduct" checked={formData.agreeConduct} onChange={handleInputChange} />
                      <span>I agree to keep chats respectful and avoid harassment.</span>
                    </label>
                    {fieldErrors.agreeConduct && <div style={{ marginTop: -6, fontSize: 10, color: '#fca5a5' }}>{fieldErrors.agreeConduct}</div>}

                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', border: '2px solid #334155', background: '#111827', fontSize: 12, color: '#cbd5e1' }}>
                      <input type="checkbox" name="agreeLocationRules" checked={formData.agreeLocationRules} onChange={handleInputChange} />
                      <span>I understand location rooms are proximity based and I should share responsibly.</span>
                    </label>
                    {fieldErrors.agreeLocationRules && <div style={{ marginTop: -6, fontSize: 10, color: '#fca5a5' }}>{fieldErrors.agreeLocationRules}</div>}
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4, position: isCompactLayout ? 'sticky' : 'static', bottom: isCompactLayout ? 0 : 'auto', zIndex: isCompactLayout ? 15 : 'auto', background: isCompactLayout ? 'linear-gradient(180deg, rgba(15,23,42,0.2) 0%, rgba(15,23,42,0.96) 30%)' : 'transparent', paddingTop: isCompactLayout ? 10 : 0, paddingBottom: isCompactLayout ? 'calc(env(safe-area-inset-bottom, 0px) + 6px)' : 0 }}>
                {isSignUp && signUpStep > 1 && (
                  <button
                    type="button"
                    onClick={stepBack}
                    style={{ flex: 1, padding: '11px 0', background: 'transparent', border: '2px solid #334155', color: '#94a3b8', fontWeight: 'bold', fontFamily: 'Rajdhani, sans-serif', fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer' }}
                  >
                    Back
                  </button>
                )}

                {isSignUp && signUpStep < 3 && (
                  <button
                    type="button"
                    onClick={stepForward}
                    style={{ flex: 1, padding: '11px 0', background: 'linear-gradient(90deg, #2563eb, #0ea5e9)', border: '2px solid #000', boxShadow: '2px 2px 0 #000', color: '#fff', fontWeight: 'bold', fontFamily: 'Rajdhani, sans-serif', fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer' }}
                  >
                    Next
                  </button>
                )}

                {canSubmit && (
                  <button
                    type="submit"
                    disabled={isLoading}
                    style={{ flex: 1, padding: '11px 0', background: isLoading ? '#1e293b' : 'linear-gradient(90deg, #16a34a, #22c55e)', border: '2px solid #000', boxShadow: '2px 2px 0 #000', color: '#fff', fontWeight: 'bold', fontFamily: 'Rajdhani, sans-serif', fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: isLoading ? 'not-allowed' : 'pointer' }}
                  >
                    {isLoading ? 'Connecting...' : isSignUp ? 'Create and Enter' : 'Load Save'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
