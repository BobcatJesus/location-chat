import React, { useEffect, useRef, useState } from 'react';
import { getCoins, spendCoins, JUKEBOX_YOUTUBE_REQUEST_COST } from './CoinWallet.js';
import { isYouTubeBlocked } from './YouTubePlayer.js';

// JukeboxPanel — YouTube is the jukebox. Paste a link and it plays for the
// whole room (3 coins, charged when the song is added). Below: what's
// playing and the shared queue (vote / skip), plus a free title-only
// wishlist for songs someone should add later.
export default function JukeboxPanel({ roomId, onClose, getSocket }) {
  const [nowPlaying, setNowPlaying] = useState(null);
  const [queue, setQueue] = useState([]);
  const [showTitleForm, setShowTitleForm] = useState(false);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [coins, setCoins] = useState(() => getCoins());
  const [ytBlocked, setYtBlocked] = useState(false);
  const roomRef = useRef(roomId);
  roomRef.current = roomId;

  const getSocketRef = useRef(getSocket);
  getSocketRef.current = getSocket;
  const roomIdRef = useRef(roomId);
  // A YouTube request is charged only once the server confirms it was added.
  const pendingYouTubeChargeRef = useRef(false);

  useEffect(() => {
    const socket = getSocketRef.current?.();
    if (!socket) return;
    const roomChanged = roomIdRef.current !== roomId;
    roomIdRef.current = roomId;
    // Only reset the form when switching rooms, not on parent re-renders.
    if (roomChanged) {
      setNowPlaying(null);
      setQueue([]);
      setLoaded(false);
      setShowTitleForm(false);
      setError('');
      pendingYouTubeChargeRef.current = false;
    }

    const onJukeboxState = ({ nowPlaying: np, queue: q }) => {
      setNowPlaying(np || null);
      setQueue(Array.isArray(q) ? q : []);
      setLoaded(true);
      setCoins(getCoins());
    };
    const onSongAdded = () => {
      if (pendingYouTubeChargeRef.current) {
        pendingYouTubeChargeRef.current = false;
        if (spendCoins(JUKEBOX_YOUTUBE_REQUEST_COST)) setCoins(getCoins());
      }
      setShowTitleForm(false);
      setTitle('');
      setArtist('');
      setYoutubeUrl('');
    };
    const onSongError = ({ message }) => {
      pendingYouTubeChargeRef.current = false;
      setError(message || 'Could not add that song.');
    };

    socket.on('jukebox_state', onJukeboxState);
    socket.on('song_added', onSongAdded);
    socket.on('song_error', onSongError);
    socket.emit('get_jukebox', { roomId: roomRef.current });

    return () => {
      socket.off('jukebox_state', onJukeboxState);
      socket.off('song_added', onSongAdded);
      socket.off('song_error', onSongError);
    };
  }, [roomId, getSocket]);

  // Poll the player's autoplay-block state so the panel can tell the
  // user exactly how to unstick the music ("tap anywhere") instead of
  // sitting there claiming a song is playing in silence.
  useEffect(() => {
    const id = setInterval(() => setYtBlocked(isYouTubeBlocked()), 1000);
    return () => clearInterval(id);
  }, []);

  const submitSong = (e) => {
    e.preventDefault();
    setError('');
    const socket = getSocket?.();
    if (!socket?.connected) {
      setError('Not connected — try again in a moment.');
      return;
    }
    const t = title.trim();
    const yt = youtubeUrl.trim();
    if (!t && !yt) {
      setError('Give the song a title or paste a YouTube link.');
      return;
    }
    if (yt) {
      if (getCoins() < JUKEBOX_YOUTUBE_REQUEST_COST) {
        setError(`Not enough coins — a YouTube request costs ${JUKEBOX_YOUTUBE_REQUEST_COST} 🪙.`);
        return;
      }
      pendingYouTubeChargeRef.current = true;
    } else {
      pendingYouTubeChargeRef.current = false;
    }
    socket.emit('add_song', { roomId, title: t, artist: artist.trim(), youtubeUrl: yt || undefined });
  };

  const vote = (songId) => {
    const socket = getSocket?.();
    if (socket?.connected) socket.emit('vote_song', { roomId, songId });
  };

  const skip = () => {
    const socket = getSocket?.();
    if (socket?.connected) socket.emit('skip_song', { roomId });
  };

  const panelStyle = {
    position: 'absolute',
    top: 48,
    right: 12,
    width: 340,
    maxHeight: '78%',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    background: '#14101e',
    border: '3px solid #ffb02e',
    borderRadius: 14,
    color: '#f4f1e6',
    zIndex: 1002,
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    fontFamily: 'Courier New, monospace',
  };

  const inputStyle = (border) => ({
    width: '100%', padding: '8px 10px',
    boxSizing: 'border-box',
    fontSize: 14, fontFamily: 'inherit', background: '#1e1830', color: '#f4f1e6',
    border: `2px solid ${border}`, borderRadius: 8,
  });

  const nowPlayingEl = (
    <div style={{ padding: '14px 16px', borderBottom: '2px solid #ffb02e', background: '#1e1830' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#35e0ff', marginBottom: 6 }}>🎵 NOW PLAYING</div>
      {nowPlaying ? (
        <>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#ffb02e' }}>{nowPlaying.youtubeVideoId ? '▶ ' : ''}{nowPlaying.title}</div>
          {nowPlaying.artist && <div style={{ fontSize: 13, color: '#cfc6b4' }}>{nowPlaying.artist}</div>}
          <div style={{ fontSize: 11, color: '#8a8296', marginTop: 6 }}>
            added by {nowPlaying.addedByName || 'someone'}
            {typeof nowPlaying.skipVotes === 'number' && nowPlaying.skipVotes > 0
              ? ` · ${nowPlaying.skipVotes} skip vote${nowPlaying.skipVotes === 1 ? '' : 's'}`
              : ''}
          </div>
          {nowPlaying.youtubeVideoId && ytBlocked && (
            <div style={{
              marginTop: 10, padding: '8px 10px', fontSize: 12, lineHeight: 1.5,
              background: '#3a0f24', border: '2px solid #ff3da6', borderRadius: 8, color: '#ffd7ec',
            }}>
              🔇 Your browser is holding this song hostage — <b>tap or click anywhere in the game</b> and it'll start.
            </div>
          )}
          <button
            onClick={skip}
            style={{
              marginTop: 10, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
              background: 'transparent', border: '2px solid #ff3da6', color: '#ff3da6',
              borderRadius: 999, fontWeight: 700, fontFamily: 'inherit',
            }}
          >
            ⏭ Skip (2 votes)
          </button>
        </>
      ) : (
        <div style={{ fontSize: 13, color: '#8a8296', lineHeight: 1.5 }}>
          {loaded
            ? 'Nothing playing. Paste a YouTube link in the box below — it plays for everyone in the room.'
            : 'Tuning up…'}
        </div>
      )}
    </div>
  );

  const youtubeEl = (
    <form onSubmit={submitSong} style={{ padding: '14px 16px', borderBottom: '2px solid #ffb02e' }}>
      <div style={{ fontSize: 12, letterSpacing: '0.15em', color: '#ff3da6', marginBottom: 4, fontWeight: 700 }}>
        ▶ PLAY A YOUTUBE SONG · {JUKEBOX_YOUTUBE_REQUEST_COST} 🪙
      </div>
      <div style={{ fontSize: 11, color: '#8a8296', marginBottom: 8, lineHeight: 1.5 }}>
        Paste any YouTube link — it'll play for <b style={{ color: '#cfc6b4' }}>everyone in the room</b> when
        its turn comes up. Works with youtube.com, youtu.be, and Shorts links.
        Videos that block embedding get skipped automatically. You're charged only when the song is added.
        Your balance: <b style={{ color: '#ffb02e' }}>{coins} 🪙</b>
      </div>
      <input
        value={youtubeUrl}
        onChange={(e) => setYoutubeUrl(e.target.value)}
        placeholder="e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        maxLength={200}
        style={{ ...inputStyle('#ff3da6'), marginBottom: 10 }}
      />
      {error && <div style={{ fontSize: 12, color: '#ff3da6', marginBottom: 8 }}>{error}</div>}
      <button
        type="submit"
        style={{
          width: '100%', padding: '9px', fontSize: 13, cursor: 'pointer',
          background: '#ffb02e', border: 'none', color: '#14101e',
          borderRadius: 8, fontWeight: 700, fontFamily: 'inherit',
        }}
      >
        Add to queue · {JUKEBOX_YOUTUBE_REQUEST_COST} 🪙
      </button>
      {!showTitleForm ? (
        <button
          type="button"
          onClick={() => { setShowTitleForm(true); setError(''); }}
          style={{
            width: '100%', marginTop: 8, padding: '6px', fontSize: 12, cursor: 'pointer',
            background: 'transparent', border: 'none', color: '#8a8296',
            fontFamily: 'inherit', textDecoration: 'underline',
          }}
        >
          or request a song title instead (free — wishlist only, doesn't play)
        </button>
      ) : (
        <div style={{ marginTop: 10 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Song title"
            maxLength={120}
            style={{ ...inputStyle('#35e0ff'), marginBottom: 8 }}
          />
          <input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Artist (optional)"
            maxLength={120}
            style={{ ...inputStyle('#35e0ff'), marginBottom: 10 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              style={{
                flex: 1, padding: '8px', fontSize: 13, cursor: 'pointer',
                background: '#35e0ff', border: 'none', color: '#14101e',
                borderRadius: 8, fontWeight: 700, fontFamily: 'inherit',
              }}
            >
              Add title request
            </button>
            <button
              type="button"
              onClick={() => { setShowTitleForm(false); setError(''); }}
              style={{
                padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                background: 'transparent', border: '2px solid #8a8296', color: '#8a8296',
                borderRadius: 8, fontFamily: 'inherit',
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </form>
  );

  const queueEl = (
    <div style={{ padding: '10px 16px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#35e0ff', marginBottom: 8 }}>📻 UP NEXT</div>
      {queue.length === 0 && (
        <div style={{ fontSize: 13, color: '#8a8296' }}>Nothing queued yet.</div>
      )}
      {queue.map((song, i) => (
        <div
          key={song.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 0', borderBottom: '1px solid rgba(255,176,46,0.18)',
          }}
        >
          <span style={{ fontSize: 12, color: '#8a8296', minWidth: 22 }}>#{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {song.youtubeVideoId ? '▶ ' : ''}{song.title}
            </div>
            {song.artist && (
              <div style={{ fontSize: 11, color: '#8a8296', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {song.artist}
              </div>
            )}
          </div>
          <button
            onClick={() => vote(song.id)}
            style={{
              padding: '4px 10px', fontSize: 12, cursor: 'pointer',
              background: '#ffb02e', border: 'none', color: '#14101e',
              borderRadius: 999, fontWeight: 700, fontFamily: 'inherit',
              opacity: song.voted ? 0.45 : 1,
            }}
            title={song.voted ? 'You voted for this one' : 'Vote this song up'}
          >
            ▲ {song.votes || 0}
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div style={panelStyle}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', background: '#ffb02e', color: '#14101e',
        borderTopLeftRadius: 11, borderTopRightRadius: 11,
      }}>
        <span style={{ fontWeight: 900, fontSize: 14, letterSpacing: '0.1em' }}>JUKEBOX</span>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', color: '#14101e',
            fontSize: 18, cursor: 'pointer', fontWeight: 900, fontFamily: 'inherit',
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {nowPlayingEl}
        {youtubeEl}
        {queueEl}
      </div>
    </div>
  );
}
