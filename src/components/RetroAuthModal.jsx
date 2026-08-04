import React, { useState, useEffect, useRef } from 'react';

// --- Web Audio Helper for Retro SFX ---
const playSound = (type) => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'blip') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.05);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.linearRampToValueAtTime(80, now + 0.2);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'success') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch {
    // Ignore audio restriction errors if audio context isn't allowed yet
  }
};

export default function RetroAuthModal({ onLogin }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const initialForm = { email: '', password: '', characterName: '' };
  const [formData, setFormData] = useState(initialForm);
  const [photoDataUrl, setPhotoDataUrl] = useState(null);

  const firstInputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Compress uploaded photo to a 48×48 circle base64 thumbnail
  const handlePhotoChange = (e) => {
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
        setPhotoDataUrl(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  // Auto-login if saved profile exists
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
  }, []);

  // Auto-focus first input field on modal open or tab change
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [isOpen, isSignUp]);

  // Close on ESC key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleOpen = () => {
    playSound('blip');
    setIsOpen(true);
  };

  const handleClose = () => {
    playSound('blip');
    setIsOpen(false);
    setFormData(initialForm);
    setError(null);
  };

  const handleTabSwitch = (signUpMode) => {
    playSound('blip');
    setIsSignUp(signUpMode);
    setError(null);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError(null); // Clear error on typing
  };

  // --- Client-side Validation Logic ---
  const validateForm = () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      return 'INVALID SCROLL! Please enter a valid email address.';
    }

    if (formData.password.length < 8) {
      return 'DEFENSE TOO LOW! Password must be at least 8 characters.';
    }

    if (isSignUp) {
      if (formData.characterName.trim().length < 3) {
        return 'NAME TOO SHORT! Character handle needs 3+ characters.';
      }
      const handleRegex = /^[a-zA-Z0-9_]+$/;
      if (!handleRegex.test(formData.characterName)) {
        return 'ILLEGAL RUNES! Name can only contain letters, numbers, and underscores.';
      }
    }

    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      playSound('error');
      setError(validationError);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Derive display name: prefer characterName, else part before @ in email
      const characterName = formData.characterName.trim() || formData.email.split('@')[0];
      const profile = { email: formData.email, characterName };

      if (isSignUp) {
        // Store new account
        localStorage.setItem('sidequest_profile', JSON.stringify(profile));
      } else {
        // Check saved account matches
        const saved = localStorage.getItem('sidequest_profile');
        if (saved) {
          const existing = JSON.parse(saved);
          if (existing.email !== formData.email) {
            throw new Error('No save file found for this email.');
          }
        } else {
          // First time login — save it
          localStorage.setItem('sidequest_profile', JSON.stringify(profile));
        }
      }

      playSound('success');
      handleClose();
      onLogin?.({ mode: isSignUp ? 'signup' : 'login', profile });
    } catch (err) {
      playSound('error');
      setError('HP CRITICAL! Invalid credentials or connection error.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Courier New, monospace', userSelect: 'none', overflow: 'hidden' }}>

      {/* Starfield background */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {Array.from({ length: 60 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              borderRadius: '50%',
              background: 'white',
              width: Math.random() > 0.85 ? 2 : 1,
              height: Math.random() > 0.85 ? 2 : 1,
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              opacity: 0.2 + Math.random() * 0.6,
              animation: `pulse ${1.5 + Math.random() * 3}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>

      {/* Ground grid */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.06, backgroundImage: 'linear-gradient(#4ade80 1px, transparent 1px), linear-gradient(90deg, #4ade80 1px, transparent 1px)', backgroundSize: '32px 32px', pointerEvents: 'none' }} />

      {/* Vignette */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, transparent 40%, #000 100%)', pointerEvents: 'none' }} />

      {/* Title card */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center', padding: '0 32px' }}>
        {/* Game title */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ color: '#fbbf24', fontSize: 12, letterSpacing: '0.4em', textTransform: 'uppercase', opacity: 0.7 }}>A location-based adventure</div>
          <h1 style={{
            color: '#fbbf24',
            fontWeight: 'bold',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            lineHeight: 1,
            margin: 0,
            fontSize: 'clamp(2.5rem, 8vw, 5rem)',
            textShadow: '0 0 20px #fbbf24, 4px 4px 0 #92400e, 8px 8px 0 #000',
          }}>
            Side Quest
          </h1>
          <div style={{ color: '#475569', fontSize: 12, letterSpacing: '0.3em', textTransform: 'uppercase', marginTop: 8 }}>Find your people. In the real world.</div>
        </div>

        {/* Characters */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, margin: '0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: 0.8 }}>
            <div style={{ fontSize: 48, animation: 'bounce 2s infinite' }}>🧙‍♂️</div>
            <div style={{ color: '#475569', fontSize: 11 }}>Explorer</div>
          </div>
          <div style={{ width: 1, height: 40, background: '#1e293b' }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: 0.8 }}>
            <div style={{ fontSize: 48, animation: 'bounce 2.4s 0.3s infinite' }}>🤖</div>
            <div style={{ color: '#475569', fontSize: 11 }}>Traveler</div>
          </div>
        </div>

        {/* Press Start button */}
        {!isOpen && (
          <button
            onClick={handleOpen}
            style={{ padding: '16px 40px', background: '#fbbf24', border: '4px solid #000', boxShadow: '4px 4px 0 #000', fontWeight: 'bold', fontFamily: 'Courier New, monospace', fontSize: 20, letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer', animation: 'pulse 2s ease-in-out infinite' }}
          >
            ▶ Press Start
          </button>
        )}

        {/* Flavour text */}
        <div style={{ color: '#334155', fontSize: 11, marginTop: 8, maxWidth: 280 }}>
          Walk near someone to unlock the ability to chat with them.
        </div>
      </div>

      {/* Auth Modal */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div onClick={handleClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 20 }} />

          {/* Dialog */}
          <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ width: '100%', maxWidth: 400, background: '#0f172a', border: '4px solid #fff', padding: 4, boxShadow: '8px 8px 0 #000' }}>
              <div style={{ border: '2px solid #3b82f6', padding: 24, background: '#0f172a', color: '#fff', fontFamily: 'Courier New, monospace' }}>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 12, borderBottom: '2px solid #1e293b' }}>
                  <h2 style={{ margin: 0, color: '#fbbf24', fontWeight: 'bold', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 16 }}>
                    {isSignUp ? '📜 Create Character' : '🔑 Player Login'}
                  </h2>
                  <button onClick={handleClose} aria-label="Close Modal" style={{ background: 'none', border: 'none', color: '#64748b', fontWeight: 'bold', fontSize: 14, cursor: 'pointer', fontFamily: 'Courier New, monospace' }}>
                    [X]
                  </button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', marginBottom: 20, border: '2px solid #000', background: '#1e293b', padding: 4, gap: 4 }}>
                  {[['Log In', false], ['Sign Up', true]].map(([label, su]) => (
                    <button key={label} type="button" onClick={() => handleTabSwitch(su)} style={{ flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', fontFamily: 'Courier New, monospace', border: 'none', background: isSignUp === su ? '#2563eb' : 'transparent', color: isSignUp === su ? '#fff' : '#64748b' }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Error */}
                {error && (
                  <div style={{ marginBottom: 16, padding: 8, background: 'rgba(127,29,29,0.8)', border: '2px solid #ef4444', color: '#fca5a5', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ⚠️ {error}
                  </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {isSignUp && (
                    <div>
                      <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 4 }}>Avatar Name</label>
                      <input ref={firstInputRef} type="text" name="characterName" placeholder="e.g. HeroOfTime" value={formData.characterName} onChange={handleInputChange}
                        style={{ width: '100%', boxSizing: 'border-box', background: '#000', border: '2px solid #475569', padding: '8px 10px', color: '#fbbf24', fontFamily: 'Courier New, monospace', fontSize: 13, outline: 'none' }} />
                    </div>
                  )}
                  {isSignUp && (
                    <div>
                      <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 4 }}>Profile Photo <span style={{ color: '#475569' }}>(optional)</span></label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {photoDataUrl
                          ? <img src={photoDataUrl} alt="preview" style={{ width: 40, height: 40, borderRadius: '50%', border: '2px solid #fbbf24', objectFit: 'cover' }} />
                          : <div style={{ width: 40, height: 40, borderRadius: '50%', border: '2px dashed #475569', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>👤</div>
                        }
                        <button type="button" onClick={() => fileInputRef.current?.click()}
                          style={{ flex: 1, padding: '7px 10px', background: 'transparent', border: '2px solid #475569', color: '#94a3b8', fontFamily: 'Courier New, monospace', fontSize: 12, cursor: 'pointer' }}>
                          {photoDataUrl ? 'Change photo' : 'Upload photo'}
                        </button>
                        {photoDataUrl && (
                          <button type="button" onClick={() => setPhotoDataUrl(null)}
                            style={{ padding: '7px 10px', background: 'transparent', border: '2px solid #475569', color: '#64748b', fontFamily: 'Courier New, monospace', fontSize: 12, cursor: 'pointer' }}>
                            ✕
                          </button>
                        )}
                        <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoChange} style={{ display: 'none' }} />
                      </div>
                    </div>
                  )}
                  <div>
                    <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 4 }}>Email Address</label>
                    <input ref={firstInputRef} type="email" name="email" placeholder="player@world.com" value={formData.email} onChange={handleInputChange}
                      style={{ width: '100%', boxSizing: 'border-box', background: '#000', border: '2px solid #475569', padding: '8px 10px', color: '#fbbf24', fontFamily: 'Courier New, monospace', fontSize: 13, outline: 'none' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 4 }}>Password</label>
                    <input type="password" name="password" placeholder="••••••••" value={formData.password} onChange={handleInputChange}
                      style={{ width: '100%', boxSizing: 'border-box', background: '#000', border: '2px solid #475569', padding: '8px 10px', color: '#fbbf24', fontFamily: 'Courier New, monospace', fontSize: 13, outline: 'none' }} />
                  </div>
                  <button type="submit" disabled={isLoading}
                    style={{ marginTop: 4, padding: '12px 0', background: isLoading ? '#1e293b' : '#16a34a', border: '2px solid #000', boxShadow: '2px 2px 0 #000', color: '#fff', fontWeight: 'bold', fontFamily: 'Courier New, monospace', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: isLoading ? 'not-allowed' : 'pointer' }}>
                    {isLoading ? '⏳ Connecting...' : isSignUp ? '⚔️ Enter World' : '🚀 Load Save'}
                  </button>
                </form>

              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
