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

  const firstInputRef = useRef(null);

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
      await new Promise((resolve) => setTimeout(resolve, 800));

      playSound('success');
      handleClose();
      onLogin?.({ mode: isSignUp ? 'signup' : 'login', profile: formData });
    } catch (err) {
      playSound('error');
      setError('HP CRITICAL! Invalid credentials or connection error.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative w-full h-screen bg-slate-900 flex items-center justify-center font-mono select-none overflow-hidden">
      {/* MAP BACKGROUND PLACEHOLDER */}
      <div className="absolute inset-0 opacity-40 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px]">
        <div className="absolute top-1/3 left-1/2 animate-bounce text-2xl">🧙‍♂️</div>
        <div className="absolute top-2/3 left-1/3 animate-pulse text-2xl">🤖</div>
      </div>

      {/* START BUTTON */}
      {!isOpen && (
        <button
          onClick={handleOpen}
          className="z-10 px-8 py-4 bg-yellow-400 hover:bg-yellow-300 text-black font-bold border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all uppercase tracking-widest text-xl cursor-pointer"
        >
          ▶ Press Start
        </button>
      )}

      {/* RETRO RPG DIALOGUE BOX (Auth Modal) */}
      {isOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 z-20" onClick={handleClose} />

          <div
            className="relative z-30 w-full max-w-md mx-4 bg-blue-950 border-4 border-white p-1 rounded-sm shadow-[8px_8px_0px_0px_rgba(0,0,0,0.8)]"
            role="dialog"
            aria-modal="true"
          >
            <div className="border-2 border-blue-400 p-6 bg-slate-900 text-white">
              {/* Header */}
              <div className="flex justify-between items-center mb-6 border-b-2 border-slate-700 pb-2">
                <h2 className="text-yellow-400 font-bold tracking-wider uppercase text-lg">
                  {isSignUp ? '📜 Create Character' : '🔑 Player Login'}
                </h2>
                <button
                  onClick={handleClose}
                  aria-label="Close Modal"
                  className="text-slate-400 hover:text-red-400 font-bold px-2 cursor-pointer"
                >
                  [X]
                </button>
              </div>

              {/* TAB SWITCHER */}
              <div className="flex mb-6 border-2 border-black bg-slate-800 p-1">
                <button
                  type="button"
                  onClick={() => handleTabSwitch(false)}
                  className={`flex-1 py-1 text-center text-sm font-bold uppercase transition-colors cursor-pointer ${
                    !isSignUp ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Log In
                </button>
                <button
                  type="button"
                  onClick={() => handleTabSwitch(true)}
                  className={`flex-1 py-1 text-center text-sm font-bold uppercase transition-colors cursor-pointer ${
                    isSignUp ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Sign Up
                </button>
              </div>

              {/* ERROR ALERT BOX */}
              {error && (
                <div className="mb-4 p-2 bg-red-900/80 border-2 border-red-500 text-red-200 text-xs font-bold uppercase tracking-wider animate-pulse">
                  ⚠️ {error}
                </div>
              )}

              {/* FORM */}
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                {isSignUp && (
                  <div>
                    <label className="block text-xs uppercase text-slate-300 mb-1">
                      Avatar Handle / Character Name
                    </label>
                    <input
                      ref={firstInputRef}
                      type="text"
                      name="characterName"
                      placeholder="e.g. HeroOfTime"
                      value={formData.characterName}
                      onChange={handleInputChange}
                      className="w-full bg-black border-2 border-slate-600 p-2 text-yellow-300 focus:outline-none focus:border-yellow-400 font-mono text-sm"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs uppercase text-slate-300 mb-1">Email Address</label>
                  <input
                    ref={firstInputRef}
                    type="email"
                    name="email"
                    placeholder="player@world.com"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="w-full bg-black border-2 border-slate-600 p-2 text-yellow-300 focus:outline-none focus:border-yellow-400 font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase text-slate-300 mb-1">Password</label>
                  <input
                    type="password"
                    name="password"
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={handleInputChange}
                    className="w-full bg-black border-2 border-slate-600 p-2 text-yellow-300 focus:outline-none focus:border-yellow-400 font-mono text-sm"
                  />
                </div>

                {/* ACTION BUTTON */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full mt-4 py-3 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 text-white font-bold border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none uppercase tracking-wider text-sm cursor-pointer disabled:cursor-not-allowed transition-all"
                >
                  {isLoading
                    ? '⏳ Connecting...'
                    : isSignUp
                    ? '⚔️ Enter World (Register)'
                    : '🚀 Load Save (Log In)'}
                </button>
              </form>

              {/* QUICK GUEST OPTION */}
              <div className="mt-6 pt-4 border-t border-slate-800 text-center">
                <p className="text-xs text-slate-500 mb-2 uppercase">Quick Entrance</p>
                <button
                  type="button"
                  onClick={() => {
                    playSound('blip');
                    handleClose();
                    onLogin?.({ mode: 'guest', profile: { email: 'guest@local', password: '', characterName: 'Guest' } });
                  }}
                  className="text-xs text-yellow-400 hover:underline uppercase cursor-pointer"
                >
                  [ Continue as Anonymous Guest ]
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
