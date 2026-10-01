// Client-side jukebox audio: plays CC-licensed tracks via HTML5 audio.
// Works without the backend — proximity-based (fades with distance).
// All tracks by Kevin MacLeod (incompetech.com), CC BY 4.0.

const TRACKS = [
  { title: 'Boogie Party', url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Boogie%20Party.mp3' },
  { title: 'Hillbilly Swing', url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Hillbilly%20Swing.mp3' },
  { title: 'Cantina Blues', url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Cantina%20Blues.mp3' },
  { title: 'Bama Country', url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Bama%20Country.mp3' },
  { title: 'Hot Swing', url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Hot%20Swing.mp3' },
  { title: 'Porch Blues', url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Porch%20Blues.mp3' },
  { title: 'OctoBlues', url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/OctoBlues.mp3' },
  { title: 'Jazz Brunch', url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Jazz%20Brunch.mp3' },
  { title: 'The Cannery', url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/The%20Cannery.mp3' },
];

const ARTIST = 'Kevin MacLeod';
const ATTRIBUTION = 'Music by Kevin MacLeod (incompetech.com), CC BY 4.0';

// Audible within this radius (px), full volume inside the inner radius.
const AUDIBLE_RADIUS = 700;
const FULL_VOLUME_RADIUS = 250;

class JukeboxAudio {
  constructor() {
    this.audio = null;
    this.trackIndex = 0;
    this.listeners = new Set();
    this._roomId = null;
  }

  get tracks() { return TRACKS; }
  get attribution() { return ATTRIBUTION; }
  get nowPlaying() {
    const t = TRACKS[this.trackIndex];
    return t ? { title: t.title, artist: ARTIST } : null;
  }
  get isPlaying() { return !!this.audio && !this.audio.paused; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { this.listeners.forEach((fn) => { try { fn(this.nowPlaying, this.isPlaying); } catch {} }); }

  _ensureAudio() {
    if (this.audio) return this.audio;
    const a = new Audio();
    a.preload = 'auto';
    a.addEventListener('ended', () => this.next());
    a.addEventListener('error', () => {
      // Skip dead tracks instead of going silent.
      this.next();
    });
    this.audio = a;
    return a;
  }

  _loadCurrent() {
    const a = this._ensureAudio();
    const t = TRACKS[this.trackIndex];
    if (!t) return;
    if (a.dataset.track !== t.url) {
      a.dataset.track = t.url;
      a.src = t.url;
    }
  }

  play() {
    this._loadCurrent();
    const a = this.audio;
    if (!a) return;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
    this._emit();
  }

  pause() {
    if (this.audio) this.audio.pause();
    this._emit();
  }

  next() {
    this.trackIndex = (this.trackIndex + 1) % TRACKS.length;
    const wasPlaying = this.isPlaying;
    this._loadCurrent();
    if (wasPlaying) this.play();
    else this._emit();
  }

  // Jump to a specific track (for coin-paid queue jumps).
  playTrack(index) {
    if (index < 0 || index >= TRACKS.length) return false;
    this.trackIndex = index;
    this._loadCurrent();
    this.play();
    return true;
  }

  // Call every frame (or on move) with player + jukebox positions.
  // Returns true if audible.
  updateProximity(px, py, jx, jy) {
    const dist = Math.hypot(px - jx, py - jy);
    if (dist > AUDIBLE_RADIUS) {
      if (this.isPlaying) this.pause();
      return false;
    }
    // Fade volume with distance.
    const a = this._ensureAudio();
    if (dist <= FULL_VOLUME_RADIUS) a.volume = 0.8;
    else a.volume = Math.max(0.05, 0.8 * (1 - (dist - FULL_VOLUME_RADIUS) / (AUDIBLE_RADIUS - FULL_VOLUME_RADIUS)));
    if (!this.isPlaying) this.play();
    return true;
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio.dataset.track = '';
    }
    this._emit();
  }
}

export const jukeboxAudio = new JukeboxAudio();
export const JUKEBOX_ARTIST = ARTIST;
