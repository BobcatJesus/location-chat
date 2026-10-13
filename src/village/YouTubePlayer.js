// YouTubePlayer.js — hidden YouTube iframe player for room-wide jukebox playback.
// Uses the official YouTube IFrame Player API. No video is shown; audio only.
//
// Reliability notes (why this version exists):
//  - The IFrame API is asynchronous: player calls made before onReady are
//    silently dropped by many browsers, especially on mobile. Every call is
//    gated on readiness, and a video requested early is loaded the moment
//    the player is actually ready.
//  - Browsers block programmatic playback with sound until the user has
//    interacted with the page. If a play attempt stalls (the state never
//    reaches PLAYING/BUFFERING), the player is marked "blocked" and playback
//    is retried on the next real user gesture (tap / click / keypress)
//    instead of sitting silent for the whole song — and instead of skipping
//    the song for the whole room when only this device is blocked.
//  - Embed errors (owner disabled embedding, video removed, ...) arrive via
//    onError and DO skip the song: those fail for every viewer equally.

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

function stopWatchdog() {
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
}

function startWatchdog() {
  stopWatchdog();
  let checks = 0;
  watchdog = setInterval(() => {
    checks += 1;
    let state = null;
    try { state = player?.getPlayerState?.(); } catch {}
    if (state === 1 || state === 3) { // playing or buffering: healthy
      blocked = false;
      stopWatchdog();
      return;
    }
    if (checks >= 10) { // ~5s with no playback: assume an autoplay block
      blocked = true;
      stopWatchdog();
      armGestureUnlock();
    }
  }, 500);
}

function armGestureUnlock() {
  if (gestureArmed || typeof window === 'undefined') return;
  gestureArmed = true;
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    gestureArmed = false;
    if (player && currentVideoId) {
      if (desiredVolume != null) { try { player.setVolume(desiredVolume); } catch {} }
      try { player.playVideo(); } catch {}
      startWatchdog();
    }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function loadNow(videoId) {
  currentVideoId = videoId;
  blocked = false;
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
  if (!videoId || apiFailed) return false;
  endedCallback = callbacks.onEnded || null;
  errorCallback = callbacks.onError || null;
  currentVideoId = videoId;
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
// is waiting for the player's next tap/click/keypress to start the audio.
export function isYouTubeBlocked() {
  return blocked;
}
