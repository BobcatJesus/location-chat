// YouTubePlayer.js — hidden YouTube iframe player for room-wide jukebox playback.
// Uses the official YouTube IFrame Player API. No video is shown; audio only.

let apiPromise = null;
let player = null;
let currentVideoId = null;
let endedCallback = null;
let errorCallback = null;
let apiFailed = false;

function loadApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('no window'));
    if (window.YT && window.YT.Player) return resolve(window.YT);
    // Hidden container for the iframe.
    let holder = document.getElementById('sq-youtube-holder');
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'sq-youtube-holder';
      holder.style.cssText = 'position:fixed;width:2px;height:2px;left:-10px;top:-10px;opacity:0;pointer-events:none;';
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

function ensurePlayer(YT, holderId) {
  if (player) return player;
  player = new YT.Player(holderId || 'sq-youtube-holder', {
    width: '2',
    height: '2',
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      rel: 0,
    },
    events: {
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
  try {
    const YT = await loadApi();
    const p = ensurePlayer(YT);
    currentVideoId = videoId;
    // loadVideoById starts playback immediately.
    p.loadVideoById(videoId);
    return true;
  } catch {
    if (typeof errorCallback === 'function') {
      try { errorCallback(videoId); } catch {}
    }
    return false;
  }
}

export function stopYouTube() {
  try { player?.stopVideo(); } catch {}
  currentVideoId = null;
}

export function setYouTubeVolume(v) {
  // v: 0..1 -> YouTube 0..100
  try { player?.setVolume(Math.round(Math.max(0, Math.min(1, v)) * 100)); } catch {}
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
