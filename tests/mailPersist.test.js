// mailPersist.test.js — Mail persistence (`sq-mail-persist-v1`).
//
// Piece 2 of the room-state persistence fix: per-player mail
// inboxes are saved to Postgres on every mutation and loaded back
// lazily, so a server restart restores unread mail instead of
// wiping it.
//
// These tests cover the persistence layer (server/mailPersist.js)
// against a fake in-memory pool — no real Postgres needed. The
// socket.js wiring (ensureMailLoaded / persistMail in the mail
// handlers) is verified by node --check + code read: socket.js
// boots a server on import and cannot run in vitest.

import { describe, it, expect } from 'vitest';
import {
  MAIL_PERSIST_MARKER,
  MAIL_INBOX_TABLE,
  MAIL_INBOX_TABLE_SQL,
  saveMailInbox,
  loadMailInbox,
} from '../server/mailPersist.js';
import {
  MAIL_MAX_PER_INBOX,
  createMailState,
  sendPackage,
  collectPackage,
  serializeMailState,
  parseMailState,
} from '../src/village/mailState.js';

// Tiny in-memory stand-in for a pg Pool: one Map keyed by user_id,
// answering only the two queries the persistence layer issues.
function makeFakePool(initial = {}) {
  const store = new Map(Object.entries(initial));
  const queries = [];
  return {
    store,
    queries,
    async query(text, params = []) {
      queries.push({ text, params });
      const sql = String(text);
      if (/SELECT data FROM mail_inbox/i.test(sql)) {
        const data = store.get(params[0]);
        return { rows: data !== undefined ? [{ data }] : [] };
      }
      if (/INSERT INTO mail_inbox/i.test(sql)) {
        store.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
}

const USER = 'alice@test';
const OTHER = 'bob@test';

function makeItem(n) {
  return { id: `item-${n}`, type: 'food', label: 'Bits of food' };
}

function makePackage(n, fromUserId = OTHER, fromName = 'Bob') {
  return {
    id: `pkg-${n}`,
    fromUserId,
    fromName,
    item: makeItem(n),
    sentAt: 1700000000000 + n,
  };
}

/** An inbox with n packages (oldest first), built through the real send path. */
function inboxWith(n) {
  const state = createMailState();
  for (let i = 1; i <= n; i += 1) {
    const res = sendPackage(state, makePackage(i));
    if (!res.ok) throw new Error(`sendPackage failed at ${i}: ${res.reason}`);
  }
  return state;
}

describe('constants', () => {
  it('carries the v1 marker and the table name', () => {
    expect(MAIL_PERSIST_MARKER).toBe('sq-mail-persist-v1');
    expect(MAIL_INBOX_TABLE).toBe('mail_inbox');
  });

  it('creates one row per player with the serialized inbox as JSONB', () => {
    expect(MAIL_INBOX_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS mail_inbox/);
    expect(MAIL_INBOX_TABLE_SQL).toMatch(/user_id TEXT PRIMARY KEY/);
    expect(MAIL_INBOX_TABLE_SQL).toMatch(/data JSONB NOT NULL/);
  });
});

describe('save/load round-trip', () => {
  it('restores an empty inbox', async () => {
    const pool = makeFakePool();
    expect(await saveMailInbox(pool, USER, createMailState())).toBe(true);
    const loaded = await loadMailInbox(pool, USER);
    expect(loaded).toEqual({ packages: [] });
  });

  it('restores packages exactly, oldest first', async () => {
    const pool = makeFakePool();
    const before = inboxWith(3);
    expect(await saveMailInbox(pool, USER, before)).toBe(true);
    const loaded = await loadMailInbox(pool, USER);
    expect(loaded.packages.map((p) => p.id)).toEqual(['pkg-1', 'pkg-2', 'pkg-3']);
    expect(serializeMailState(loaded)).toEqual(serializeMailState(before));
  });

  it('restores a full inbox (20 packages) intact', async () => {
    const pool = makeFakePool();
    const before = inboxWith(MAIL_MAX_PER_INBOX);
    expect(before.packages).toHaveLength(20);
    await saveMailInbox(pool, USER, before);
    const loaded = await loadMailInbox(pool, USER);
    expect(loaded.packages).toHaveLength(20);
    expect(loaded.packages.map((p) => p.id)).toEqual(before.packages.map((p) => p.id));
  });

  it('writes an upsert (INSERT ... ON CONFLICT), one row per player', async () => {
    const pool = makeFakePool();
    await saveMailInbox(pool, USER, inboxWith(1));
    await saveMailInbox(pool, USER, inboxWith(2));
    expect(pool.store.size).toBe(1);
    expect(pool.queries.filter((q) => /INSERT INTO mail_inbox/i.test(q.text))).toHaveLength(2);
    expect(pool.queries[0].text).toMatch(/ON CONFLICT \(user_id\)/);
    const loaded = await loadMailInbox(pool, USER);
    expect(loaded.packages).toHaveLength(2);
  });

  it('keeps players apart — one row per user_id', async () => {
    const pool = makeFakePool();
    await saveMailInbox(pool, USER, inboxWith(1));
    await saveMailInbox(pool, OTHER, inboxWith(2));
    expect(pool.store.size).toBe(2);
    expect((await loadMailInbox(pool, USER)).packages).toHaveLength(1);
    expect((await loadMailInbox(pool, OTHER)).packages).toHaveLength(2);
  });
});

describe('load of a missing row', () => {
  it('returns null — the caller starts with an empty inbox, as today', async () => {
    const pool = makeFakePool();
    expect(await loadMailInbox(pool, USER)).toBeNull();
    expect(await loadMailInbox(pool, 'nobody@test')).toBeNull();
  });
});

describe('no pool (local dev without Postgres)', () => {
  it('save is a no-op that never throws; load returns null', async () => {
    await expect(saveMailInbox(null, USER, createMailState())).resolves.toBe(false);
    await expect(loadMailInbox(null, USER)).resolves.toBeNull();
    await expect(saveMailInbox(undefined, USER, createMailState())).resolves.toBe(false);
  });
});

describe('bad-row repair (never trust the row blindly)', () => {
  it('drops invalid packages and keeps the good ones', async () => {
    const pool = makeFakePool({
      [USER]: {
        packages: [
          makePackage(1),
          { id: '', fromUserId: 'x', item: makeItem(2) }, // no id
          { id: 'pkg-3', fromUserId: 'x', item: { id: 'item-3', type: 'puzzle-piece' } }, // unsendable
          makePackage(4),
        ],
        unread: 4,
      },
    });
    const loaded = await loadMailInbox(pool, USER);
    expect(loaded.packages.map((p) => p.id)).toEqual(['pkg-1', 'pkg-4']);
  });

  it('repairs a row with no packages array to an empty inbox', async () => {
    const pool = makeFakePool({ [USER]: { unread: 3 } });
    expect(await loadMailInbox(pool, USER)).toEqual({ packages: [] });
    const pool2 = makeFakePool({ [USER]: { packages: 'not an array' } });
    expect(await loadMailInbox(pool2, USER)).toEqual({ packages: [] });
  });

  it('returns null for a row with no usable data', async () => {
    const pool = makeFakePool({ [USER]: 'not an object' });
    expect(await loadMailInbox(pool, USER)).toBeNull();
    const pool2 = makeFakePool({ [USER]: null });
    expect(await loadMailInbox(pool2, USER)).toBeNull();
  });

  it('returns null instead of throwing when the query fails', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(loadMailInbox(pool, USER)).resolves.toBeNull();
  });
});

describe('restart-restore flow', () => {
  it('save, drop the in-memory inbox, load again: same mail', async () => {
    const pool = makeFakePool();
    const before = inboxWith(2);
    await saveMailInbox(pool, USER, before);
    // The restart drops the in-memory inbox entirely; the load
    // rebuilds it from the row alone.
    const after = await loadMailInbox(pool, USER);
    expect(serializeMailState(after)).toEqual(serializeMailState(before));
  });

  it('load-before-mutate: a send to an offline player keeps their old mail', async () => {
    const pool = makeFakePool();
    // Before the "restart": two packages arrive.
    await saveMailInbox(pool, USER, inboxWith(2));
    // After the restart the in-memory cache is fresh and empty —
    // the handler MUST load first (ensureMailLoaded), or the save
    // below would overwrite the two old packages with only the new
    // one. This is the load-before-mutate rule, simulated here.
    const inbox = (await loadMailInbox(pool, USER)) || createMailState();
    const res = sendPackage(inbox, makePackage(3));
    expect(res.ok).toBe(true);
    await saveMailInbox(pool, USER, inbox);
    const reloaded = await loadMailInbox(pool, USER);
    expect(reloaded.packages.map((p) => p.id)).toEqual(['pkg-1', 'pkg-2', 'pkg-3']);
  });

  it('a collect after a restart removes only that package', async () => {
    const pool = makeFakePool();
    await saveMailInbox(pool, USER, inboxWith(3));
    const inbox = await loadMailInbox(pool, USER);
    const res = collectPackage(inbox, 'pkg-2');
    expect(res.ok).toBe(true);
    expect(res.package.id).toBe('pkg-2');
    await saveMailInbox(pool, USER, inbox);
    const reloaded = await loadMailInbox(pool, USER);
    expect(reloaded.packages.map((p) => p.id)).toEqual(['pkg-1', 'pkg-3']);
  });
});

describe('save errors', () => {
  it('saveMailInbox propagates a DB error (the socket.js caller catches it)', async () => {
    const pool = { async query() { throw new Error('db down'); } };
    await expect(saveMailInbox(pool, USER, createMailState())).rejects.toThrow('db down');
  });
});

describe('parseMailState cap on load', () => {
  it('never loads more than 20 packages, even from a fat row', () => {
    const fat = { packages: Array.from({ length: 25 }, (_v, i) => makePackage(i + 1)) };
    expect(parseMailState(fat).packages).toHaveLength(MAIL_MAX_PER_INBOX);
  });
});
