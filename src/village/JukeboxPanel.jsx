import React, { useEffect, useRef, useState } from 'react';
import { jukeboxAudio } from './JukeboxAudio.js';
import { getCoins, spendCoins, JUKEBOX_QUEUE_JUMP_COST } from './CoinWallet.js';

// JukeboxPanel — see what's playing on the bar jukebox, vote songs up the
// queue, request a song, or vote to skip the current track. Talk to the
// server over the scene socket when available. Client-side CC-licensed audio
// plays automatically near the jukebox (no server needed).
export default function JukeboxPanel({ roomId, onClose, getSocket }) {
  const [nowPlaying, setNowPlaying] = useState(null);
  const [queue, setQueue] = useState([]);
  const [view, setView] = useState('queue'); // queue | add
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const roomRef = useRef(roomId);
  roomRef.current = roomId;

  useEffect(() => {
    const socket = getSocket?.();
    if (!socket) return;
    setNowPlaying(null);
    setQueue([]);
    setLoaded(false);
    setView('queue');
    setError('');

    const onJukeboxState = ({ nowPlaying: np, queue: q }) => {
      setNowPlaying(np || null);
      setQueue(Array.isArray(q) ? q : []);
      setLoaded(true);
    };
    const onSongAdded = () => {
      setView('queue');
      setTitle('');
      setArtist('');
      setYoutubeUrl('');
    };
    const onSongError = ({ message }) => setError(message || 'Could not add that song.');

    socket.on('jukebox_state', onJukeboxState);
    socket.on('song_added', onSongAdded);
    socket.on('song_error', onSongError);
    socket.emit('get_jukebox', { roomId: roomRef.current });

    // Client-side audio fallback: show what's actually playing.
    const unsubAudio = jukeboxAudio.onChange((np) => {
      if (np && !nowPlaying) setNowPlaying({ title: np.title, artist: np.artist });
    });
    const initial = jukeboxAudio.nowPlaying;
    if (initial && jukeboxAudio.isPlaying) setNowPlaying({ title: initial.title, artist: initial.artist });

    return () => {
      socket.off('jukebox_state', onJukeboxState);
      socket.off('song_added', onSongAdded);
      socket.off('song_error', onSongError);
      unsubAudio();
    };
  }, [roomId, getSocket]);

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

  const [coins, setCoins] = useState(() => getCoins());
  const playNow = (index) => {
    if (!spendCoins(JUKEBOX_QUEUE_JUMP_COST)) {
      setError(`Not enough coins — you need ${JUKEBOX_QUEUE_JUMP_COST}.`);
      return;
    }
    setCoins(getCoins());
    setError('');
    if (jukeboxAudio.playTrack(index)) {
      const t = jukeboxAudio.tracks[index];
      setNowPlaying({ title: t.title, artist: 'Kevin MacLeod' });
    }
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
        <div style={{ fontSize: 13, color: '#8a8296' }}>
          {loaded ? 'Queue is empty — request something!' : 'Tuning up…'}
        </div>
      )}
    </div>
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

  const addEl = (
    <form onSubmit={submitSong} style={{ padding: '14px 16px', borderTop: '2px solid #ffb02e' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#35e0ff', marginBottom: 8 }}>➕ REQUEST A SONG</div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Song title"
        maxLength={120}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '8px 10px', marginBottom: 8,
          fontSize: 14, fontFamily: 'inherit', background: '#1e1830', color: '#f4f1e6',
          border: '2px solid #35e0ff', borderRadius: 8,
        }}
      />
      <input
        value={artist}
        onChange={(e) => setArtist(e.target.value)}
        placeholder="Artist (optional)"
        maxLength={120}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '8px 10px', marginBottom: 8,
          fontSize: 14, fontFamily: 'inherit', background: '#1e1830', color: '#f4f1e6',
          border: '2px solid #35e0ff', borderRadius: 8,
        }}
      />
      <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#ff3da6', marginBottom: 4, marginTop: 4 }}>
        ▶ YOUTUBE LINK
      </div>
      <div style={{ fontSize: 11, color: '#8a8296', marginBottom: 8, lineHeight: 1.5 }}>
        Paste any YouTube video link — it'll play for <b style={{ color: '#cfc6b4' }}>everyone in the room</b> when
        its turn comes up. Works with youtube.com, youtu.be, and Shorts links.
        Videos that block embedding get skipped automatically.
      </div>
      <input
        value={youtubeUrl}
        onChange={(e) => setYoutubeUrl(e.target.value)}
        placeholder="e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        maxLength={200}
        style={{
          width: '100%', padding: '8px 10px', marginBottom: 10,
          boxSizing: 'border-box',
          fontSize: 14, fontFamily: 'inherit', background: '#1e1830', color: '#f4f1e6',
          border: '2px solid #ff3da6', borderRadius: 8,
        }}
      />
      {error && <div style={{ fontSize: 12, color: '#ff3da6', marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="submit"
          style={{
            flex: 1, padding: '8px', fontSize: 13, cursor: 'pointer',
            background: '#ffb02e', border: 'none', color: '#14101e',
            borderRadius: 8, fontWeight: 700, fontFamily: 'inherit',
          }}
        >
          Add to queue
        </button>
        <button
          type="button"
          onClick={() => { setView('queue'); setError(''); }}
          style={{
            padding: '8px 14px', fontSize: 13, cursor: 'pointer',
            background: 'transparent', border: '2px solid #8a8296', color: '#8a8296',
            borderRadius: 8, fontFamily: 'inherit',
          }}
        >
          Back
        </button>
      </div>
    </form>
  );

  const localTracksEl = (
    <div style={{ padding: '14px 16px', borderTop: '2px solid #ffb02e' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#35e0ff', marginBottom: 4 }}>
        💿 HOUSE TRACKS <span style={{ color: '#ffb02e' }}>· 🪙 {coins}</span>
      </div>
      <div style={{ fontSize: 11, color: '#8a8296', marginBottom: 8 }}>
        Free rotation plays on its own. {JUKEBOX_QUEUE_JUMP_COST} coins to jump the queue.
      </div>
      {jukeboxAudio.tracks.map((t, i) => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 0', borderBottom: '1px solid rgba(255,176,46,0.12)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t.title}
            </div>
            <div style={{ fontSize: 11, color: '#8a8296' }}>Kevin MacLeod · CC BY 4.0</div>
          </div>
          <button
            onClick={() => playNow(i)}
            disabled={coins < JUKEBOX_QUEUE_JUMP_COST}
            style={{
              padding: '4px 10px', fontSize: 12, cursor: coins < JUKEBOX_QUEUE_JUMP_COST ? 'not-allowed' : 'pointer',
              background: coins < JUKEBOX_QUEUE_JUMP_COST ? '#3a3348' : '#ff3da6',
              border: 'none', color: '#f4f1e6',
              borderRadius: 999, fontWeight: 700, fontFamily: 'inherit',
              opacity: coins < JUKEBOX_QUEUE_JUMP_COST ? 0.5 : 1,
            }}
            title={`Play now for ${JUKEBOX_QUEUE_JUMP_COST} coins`}
          >
            ▶ {JUKEBOX_QUEUE_JUMP_COST}🪙
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
        {view === 'queue' ? queueEl : null}
        {view === 'queue' ? localTracksEl : null}
        {view === 'queue' ? (
          <div style={{ padding: '10px 16px 14px' }}>
            <button
              onClick={() => setView('add')}
              style={{
                width: '100%', padding: '8px', fontSize: 13, cursor: 'pointer',
                background: '#35e0ff', border: 'none', color: '#14101e',
                borderRadius: 8, fontWeight: 700, fontFamily: 'inherit',
              }}
            >
              ➕ Request a song
            </button>
          </div>
        ) : addEl}
      </div>
    </div>
  );
}
