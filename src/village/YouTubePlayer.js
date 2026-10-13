// YouTubePlayer.js — hidden YouTube iframe player for room-wide jukebox playback.
// Uses the official YouTube IFrame Player API. No video is shown; audio only.
//
// Reliability notes (why this version exists):
//  - The IFrame API is asynchronous: player calls made before onReady are
//    silently dropped by many browsers, especially on mobile. Every call is
//    gated on readiness, and a video requested early is loaded the moment
//    the player is actually ready.
//  - Browsers block programmatic playback WITH SOUND until the user has
//    interacted with the page, but muted playback is always allowed. So a
//    song starts muted when the browser hasn't seen a gesture yet, and the
//    first tap / click / keypress unmutes it. If even that stalls, the
//    player is marked "blocked" (the panel tells the user to tap) and
//    every following gesture retries — a blocked device never skips the
//    song for the whole room.
//  - Embed errors (owner disabled embedding, video removed, ...) arrive via
//    onError and DO skip the song: those fail for every viewer equally.
//    A failed API load reports through the same path so the queue moves on
//    instead of pretending a song is playing.

let apiPromise = null;
let player = null;
let playerReady = false;
let pendingVideoId = null;
let currentVideoId = null;
let endedCallback = null;
let errorCallback = null;
let apiFailed = false;
let blocked = false;
let watchdog = null;
let gestureArmed = false;
let desiredVolume = null; // 0..100

function loadApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('no window'));
    if (window.YT && window.YT.Player) return resolve(window.YT);
    // Holder for the iframe. Sized like a real (small) player and parked
    // off-viewport: 1-2px or fully transparent players get their playback
    // throttled or refused by some browsers.
    let holder = document.getElementById('sq-youtube-holder');
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'sq-youtube-holder';
      holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:113px;pointer-events:none;';
      document.body.appendChild(holder);
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') { try { prev(); } catch {} }
      resolve(window.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => { apiFailed = true; reject(new Error('yt api load failed')); };
    document.head.appendChild(tag);
    // Safety timeout: don't hang forever if the API never loads.
    setTimeout(() => {
      if (!window.YT || !window.YT.Player) { apiFailed = true; reject(new Error('yt api timeout')); }
    }, 15000);
  });
  return apiPromise;
}

function safeState() {
  try { return player?.getPlayerState?.(); } catch { return null; }
}

function safeMuted() {
  try { return !!player?.isMuted?.(); } catch { return false; }
}

// "Audible" = actually playing, and not stuck muted while the user is
// close enough to expect sound.
function isAudible() {
  const st = safeState();
  if (st !== 1 && st !== 3) return false; // not playing / buffering
  if (safeMuted() && desiredVolume != null && desiredVolume > 0) return false;
  return true;
}

function stopWatchdog() {
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
}

function startWatchdog() {
  stopWatchdog();
  let checks = 0;
  watchdog = setInterval(() => {
    checks += 1;
    if (isAudible()) {
      blocked = false;
      stopWatchdog();
      disarmGestureUnlock();
      return;
    }
    if (checks >= 10) { // ~5s without audible playback
      blocked = true;
      stopWatchdog();
      armGestureUnlock();
    }
  }, 500);
}

function unlock() {
  if (!player || !currentVideoId) return;
  const st = safeState();
  if ((st === 1 || st === 3) && safeMuted()) {
    // Playing silently: this gesture is our permission to make noise.
    try { player.unMute(); } catch {}
    if (desiredVolume != null) { try { player.setVolume(desiredVolume); } catch {} }
  } else if (st !== 1 && st !== 3) {
    // Not playing at all: muted playback is always allowed — start there,
    // and the next gesture (or this one, checked just after) unmutes.
    try { player.mute(); } catch {}
    try { player.playVideo(); } catch {}
  }
  setTimeout(() => {
    if (isAudible()) {
      blocked = false;
      disarmGestureUnlock();
    } else if (currentVideoId) {
      blocked = true;
      startWatchdog();
    }
  }, 700);
}

function armGestureUnlock() {
  if (gestureArmed || typeof window === 'undefined') return;
  gestureArmed = true;
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function disarmGestureUnlock() {
  if (!gestureArmed || typeof window === 'undefined') return;
  gestureArmed = false;
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
}

function loadNow(videoId) {
  currentVideoId = videoId;
  blocked = false;
  // If this browser hasn't seen a user gesture yet, sound-first playback
  // will be refused — start muted (always allowed) and let the first
  // gesture unmute. If the user already interacted, go straight for sound.
  const hasGestured = typeof navigator !== 'undefined'
    && navigator.userActivation
    ? navigator.userActivation.hasBeenActive
    : true;
  if (!hasGestured) { try { player.mute(); } catch {} }
  try { player.loadVideoById(videoId); } catch {}
  startWatchdog();
}

function ensurePlayer(YT) {
  if (player) return player;
  player = new YT.Player('sq-youtube-holder', {
    width: '200',
    height: '113',
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      rel: 0,
      playsinline: 1,
      modestbranding: 1,
      origin: (typeof window !== 'undefined' && window.location) ? window.location.origin : undefined,
    },
    events: {
      onReady: () => {
        playerReady = true;
        if (desiredVolume != null) { try { player.setVolume(desiredVolume); } catch {} }
        if (pendingVideoId) {
          const vid = pendingVideoId;
          pendingVideoId = null;
          loadNow(vid);
        }
      },
      onStateChange: (e) => {
        // YT.PlayerState.ENDED === 0
        if (e.data === 0 && typeof endedCallback === 'function') {
          try { endedCallback(currentVideoId); } catch {}
        }
      },
      onError: () => {
        // Embed blocked / unavailable: tell the room to skip.
        if (typeof errorCallback === 'function') {
          try { errorCallback(currentVideoId); } catch {}
        }
      },
    },
  });
  return player;
}

/**
 * Play a YouTube video (audio only, hidden player).
 * callbacks: { onEnded(videoId), onError(videoId) }
 */
export async function playYouTube(videoId, callbacks = {}) {
  if (!videoId) return false;
  endedCallback = callbacks.onEnded || null;
  errorCallback = callbacks.onError || null;
  currentVideoId = videoId;
  if (apiFailed) {
    // Report it like an embed error so the room's queue moves on
    // instead of sitting on a song this device can never play.
    if (typeof errorCallback === 'function') {
      try { errorCallback(videoId); } catch {}
    }
    return false;
  }
  if (player && playerReady) {
    loadNow(videoId);
    return true;
  }
  // Player not ready yet: remember the request; onReady loads it.
  pendingVideoId = videoId;
  try {
    const YT = await loadApi();
    ensurePlayer(YT);
    if (playerReady && pendingVideoId === videoId) {
      pendingVideoId = null;
      loadNow(videoId);
    }
    return true;
  } catch {
    if (typeof errorCallback === 'function') {
      try { errorCallback(videoId); } catch {}
    }
    return false;
  }
}

export function stopYouTube() {
  stopWatchdog();
  disarmGestureUnlock();
  blocked = false;
  pendingVideoId = null;
  try { player?.stopVideo(); } catch {}
  currentVideoId = null;
}

export function setYouTubeVolume(v) {
  // v: 0..1 -> YouTube 0..100
  desiredVolume = Math.round(Math.max(0, Math.min(1, v)) * 100);
  if (player && playerReady) {
    try { player.setVolume(desiredVolume); } catch {}
  }
}

export function getYouTubeVideoId() {
  return currentVideoId;
}

export function isYouTubePlaying() {
  try {
    const st = player?.getPlayerState?.();
    // 1 = playing, 3 = buffering
    return st === 1 || st === 3;
  } catch { return false; }
}

// True when this device is stuck behind the browser's autoplay rules and
// needs a tap/click/keypress before the music can be heard.
export function isYouTubeBlocked() {
  return blocked;
}
