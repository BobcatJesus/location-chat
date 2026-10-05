import React, { useEffect, useRef, useState } from 'react';

// ShelfPanel — browse the books on a library shelf, read a book card,
// or add a new book to the shelf. Talk to the server over the scene socket.
export default function ShelfPanel({ roomId, shelf, onClose, getSocket }) {
  const [books, setBooks] = useState([]);
  const [view, setView] = useState('list'); // list | read | add
  const [selected, setSelected] = useState(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [blurb, setBlurb] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const shelfRef = useRef(shelf);
  shelfRef.current = shelf;
  const getSocketRef = useRef(getSocket);
  getSocketRef.current = getSocket;
  const shelfKeyRef = useRef(shelf);

  useEffect(() => {
    const socket = getSocketRef.current?.();
    if (!socket) return;
    const shelfChanged = shelfKeyRef.current !== shelf;
    shelfKeyRef.current = shelf;
    // Only reset the view when switching shelves, not on parent re-renders.
    if (shelfChanged) {
      setBooks([]);
      setLoaded(false);
      setView('list');
      setSelected(null);
      setError('');
    }

    const onShelfBooks = ({ shelf: s, books: list }) => {
      if (s !== shelfRef.current) return;
      setBooks(Array.isArray(list) ? list : []);
      setLoaded(true);
    };
    const onBookAdded = ({ roomId: r, shelf: s, book }) => {
      if (s !== shelfRef.current) return;
      setBooks((prev) => (prev.some((b) => b.id === book.id) ? prev : [...prev, book]));
      setView('list');
      setSelected(null);
      setTitle('');
      setAuthor('');
      setBlurb('');
    };
    const onBookError = ({ message }) => setError(message || 'Could not add that book.');

    socket.on('shelf_books', onShelfBooks);
    socket.on('book_added', onBookAdded);
    socket.on('book_error', onBookError);
    socket.emit('get_shelf_books', { roomId, shelf: shelfRef.current });

    return () => {
      socket.off('shelf_books', onShelfBooks);
      socket.off('book_added', onBookAdded);
      socket.off('book_error', onBookError);
    };
  }, [roomId, shelf]);

  const submitBook = (e) => {
    e.preventDefault();
    setError('');
    const socket = getSocket?.();
    if (!socket?.connected) {
      setError('Not connected — try again in a moment.');
      return;
    }
    if (!title.trim()) {
      setError('Give the book a title.');
      return;
    }
    socket.emit('add_book', {
      roomId,
      shelf,
      title: title.trim(),
      author: author.trim(),
      blurb: blurb.trim(),
    });
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <div style={styles.kicker}>📚 MD Anderson Library</div>
            <div style={styles.shelfName}>{shelf}</div>
          </div>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {view === 'list' && (
          <>
            <div style={styles.list}>
              {!loaded && <div style={styles.empty}>Pulling books off the shelf…</div>}
              {loaded && books.length === 0 && (
                <div style={styles.empty}>This shelf is empty. Add the first book!</div>
              )}
              {books.map((b) => (
                <button
                  key={b.id}
                  style={styles.bookRow}
                  onClick={() => { setSelected(b); setView('read'); }}
                >
                  <span style={styles.bookTitle}>{b.title}</span>
                  {b.author ? <span style={styles.bookAuthor}> — {b.author}</span> : null}
                  <span style={styles.chevron}>›</span>
                </button>
              ))}
            </div>
            <button style={styles.addBtn} onClick={() => { setView('add'); setError(''); }}>
              ＋ Add a book to this shelf
            </button>
          </>
        )}

        {view === 'read' && selected && (
          <div style={styles.page}>
            <div style={styles.pageTitle}>{selected.title}</div>
            {selected.author ? <div style={styles.pageAuthor}>by {selected.author}</div> : null}
            <div style={styles.pageRule} />
            <div style={styles.pageBlurb}>
              {selected.blurb || 'No description yet — be the first to add one.'}
            </div>
            {selected.addedByName ? (
              <div style={styles.pageMeta}>Shelved by {selected.addedByName}</div>
            ) : null}
            <button style={styles.backBtn} onClick={() => setView('list')}>← Back to shelf</button>
          </div>
        )}

        {view === 'add' && (
          <form style={styles.form} onSubmit={submitBook}>
            <label style={styles.label}>
              Title *
              <input
                style={styles.input}
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. The Name of the Wind"
                autoFocus
              />
            </label>
            <label style={styles.label}>
              Author
              <input
                style={styles.input}
                value={author}
                maxLength={120}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="e.g. Patrick Rothfuss"
              />
            </label>
            <label style={styles.label}>
              About this book
              <textarea
                style={{ ...styles.input, minHeight: 84, resize: 'vertical' }}
                value={blurb}
                maxLength={500}
                onChange={(e) => setBlurb(e.target.value)}
                placeholder="A line or two — what is it, why is it on this shelf?"
              />
            </label>
            {error ? <div style={styles.error}>{error}</div> : null}
            <div style={styles.formRow}>
              <button type="button" style={styles.backBtn} onClick={() => setView('list')}>
                ← Cancel
              </button>
              <button type="submit" style={styles.addBtn}>Shelve it</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(20,12,6,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000, padding: 16,
  },
  panel: {
    width: '100%', maxWidth: 480, maxHeight: '82vh', overflowY: 'auto',
    backgroundColor: '#f7f0dd', border: '3px solid #5b3a1e', borderRadius: 10,
    boxShadow: '0 12px 40px rgba(0,0,0,0.45)', padding: 18,
    fontFamily: 'Georgia, serif', color: '#3a2410',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  kicker: { fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: '#8a6a3f' },
  shelfName: { fontSize: 22, fontWeight: 'bold' },
  closeBtn: {
    background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#5b3a1e', padding: 4,
  },
  list: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 },
  empty: { fontStyle: 'italic', color: '#8a6a3f', padding: '12px 4px' },
  bookRow: {
    display: 'flex', alignItems: 'baseline', gap: 6, textAlign: 'left',
    background: '#fffdf4', border: '1px solid #d8c49a', borderRadius: 6,
    padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', width: '100%',
  },
  bookTitle: { fontWeight: 'bold', fontSize: 15 },
  bookAuthor: { fontSize: 13, color: '#6b4f2a' },
  chevron: { marginLeft: 'auto', color: '#a98c5f', fontSize: 18 },
  addBtn: {
    background: '#5b3a1e', color: '#f7f0dd', border: 'none', borderRadius: 6,
    padding: '10px 16px', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
  },
  page: { background: '#fffdf4', border: '1px solid #d8c49a', borderRadius: 6, padding: 18 },
  pageTitle: { fontSize: 20, fontWeight: 'bold' },
  pageAuthor: { fontSize: 14, fontStyle: 'italic', color: '#6b4f2a', marginTop: 4 },
  pageRule: { borderTop: '1px solid #d8c49a', margin: '12px 0' },
  pageBlurb: { fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-wrap' },
  pageMeta: { marginTop: 14, fontSize: 12, color: '#8a6a3f', fontStyle: 'italic' },
  backBtn: {
    marginTop: 14, background: 'none', border: '1px solid #b89a67', borderRadius: 6,
    padding: '8px 14px', cursor: 'pointer', color: '#5b3a1e', fontFamily: 'inherit', fontSize: 14,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 'bold' },
  input: {
    fontFamily: 'inherit', fontSize: 14, padding: '9px 10px',
    border: '1px solid #c9ad7d', borderRadius: 6, background: '#fffdf4', color: '#3a2410',
  },
  formRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  error: { color: '#a12622', fontSize: 13, fontStyle: 'italic' },
};
