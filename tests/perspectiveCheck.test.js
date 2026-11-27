// perspectiveCheck.test.js — Notes Moderation v1
// (`sq-notes-moderation-v1`).
//
// Google Perspective checks a note's text before it is placed:
// refuse when ANY requested attribute scores at or above 0.7
// (builder default). The check FAILS OPEN — no key, an API
// error, a 429, a timeout, or an unexpected response shape all
// place the note unchecked; the report system is the backstop.
// doNotStore is set on every request, so the text is never
// stored by the API. These tests cover the pure module
// (server/perspectiveCheck.js) — socket.js boots a server on
// import and cannot run in vitest; the handler wiring (the
// note_drop check, the boot warning) is verified by node --check
// + code read, same as the jukebox guard.

import { describe, it, expect } from 'vitest';
import {
  PERSPECTIVE_MARKER,
  PERSPECTIVE_ATTRIBUTES,
  PERSPECTIVE_TOXICITY_THRESHOLD,
  PERSPECTIVE_TIMEOUT_MS,
  PERSPECTIVE_REFUSAL_MESSAGE,
  decidePerspectiveScores,
  checkPerspectiveText,
} from '../server/perspectiveCheck.js';

const KEY = 'test-perspective-key';

const scores = (overrides = {}) => {
  const base = {};
  for (const attr of PERSPECTIVE_ATTRIBUTES) base[attr] = { summaryScore: { value: 0.1 } };
  for (const [attr, value] of Object.entries(overrides)) {
    base[attr] = { summaryScore: { value } };
  }
  return base;
};

const okFetch = (summaries, capture) => async (url, opts) => {
  if (capture) capture.push({ url, opts });
  return { ok: true, json: async () => ({ attributeSummaries: summaries }) };
};

describe('perspectiveCheck: constants', () => {
  it('carries the v1 marker, the 0.7 threshold, and a plain refusal message', () => {
    expect(PERSPECTIVE_MARKER).toBe('sq-notes-moderation-v1');
    expect(PERSPECTIVE_TOXICITY_THRESHOLD).toBe(0.7);
    expect(PERSPECTIVE_TIMEOUT_MS).toBe(4000);
    expect(PERSPECTIVE_REFUSAL_MESSAGE).toBe(
      'That note looks hurtful — try writing something kinder.'
    );
    expect(PERSPECTIVE_ATTRIBUTES).toEqual([
      'TOXICITY',
      'SEVERE_TOXICITY',
      'IDENTITY_ATTACK',
      'INSULT',
      'PROFANITY',
      'THREAT',
    ]);
  });
});

describe('decidePerspectiveScores', () => {
  it('allows a note when every attribute scores below 0.7', () => {
    expect(decidePerspectiveScores(scores())).toEqual({ ok: true });
    expect(decidePerspectiveScores(scores({ TOXICITY: 0.69 }))).toEqual({ ok: true });
  });

  it('refuses at exactly 0.7 — the boundary is inclusive', () => {
    expect(decidePerspectiveScores(scores({ TOXICITY: 0.7 }))).toEqual({
      ok: false, reason: 'content',
    });
  });

  it('refuses when ANY attribute is high, not just TOXICITY', () => {
    expect(decidePerspectiveScores(scores({ PROFANITY: 0.85 }))).toEqual({
      ok: false, reason: 'content',
    });
    expect(decidePerspectiveScores(scores({ THREAT: 0.99 }))).toEqual({
      ok: false, reason: 'content',
    });
    expect(decidePerspectiveScores(scores({ IDENTITY_ATTACK: 0.71 }))).toEqual({
      ok: false, reason: 'content',
    });
  });

  it('treats a missing or empty scores map as a bad shape (fail open upstream)', () => {
    expect(decidePerspectiveScores(null)).toEqual({ ok: false, reason: 'bad-shape' });
    expect(decidePerspectiveScores(undefined)).toEqual({ ok: false, reason: 'bad-shape' });
    expect(decidePerspectiveScores({})).toEqual({ ok: false, reason: 'bad-shape' });
  });

  it('ignores a non-numeric score instead of refusing on it', () => {
    expect(decidePerspectiveScores(scores({ TOXICITY: 'high' }))).toEqual({ ok: true });
  });
});

describe('checkPerspectiveText', () => {
  it('fails open with no API key and never calls fetch', async () => {
    let called = 0;
    const res = await checkPerspectiveText('hello', {
      fetchImpl: async () => { called += 1; return { ok: true, json: async () => ({}) }; },
    });
    expect(res).toEqual({ ok: true, skipped: 'no-key' });
    expect(called).toBe(0);
  });

  it('allows clean text and refuses toxic text', async () => {
    const clean = await checkPerspectiveText('have a lovely day', {
      apiKey: KEY, fetchImpl: okFetch(scores()),
    });
    expect(clean).toEqual({ ok: true });
    const toxic = await checkPerspectiveText('you are garbage', {
      apiKey: KEY, fetchImpl: okFetch(scores({ TOXICITY: 0.9 })),
    });
    expect(toxic).toEqual({ ok: false, reason: 'content' });
  });

  it('sends doNotStore, English, and all six attributes — and the key in the URL, never the body', async () => {
    const capture = [];
    await checkPerspectiveText('test', { apiKey: KEY, fetchImpl: okFetch(scores(), capture) });
    expect(capture).toHaveLength(1);
    const { url, opts } = capture[0];
    expect(url).toContain('commentanalyzer.googleapis.com');
    expect(url).toContain(`key=${KEY}`);
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.doNotStore).toBe(true);
    expect(body.languages).toEqual(['en']);
    expect(body.comment).toEqual({ text: 'test' });
    expect(Object.keys(body.requestedAttributes).sort()).toEqual([...PERSPECTIVE_ATTRIBUTES].sort());
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it('fails open when the API rejects the request (network error)', async () => {
    const res = await checkPerspectiveText('hello', {
      apiKey: KEY,
      fetchImpl: async () => { throw new Error('down'); },
    });
    expect(res).toEqual({ ok: true, skipped: 'api-error' });
  });

  it('fails open on a non-2xx status — a 429 is an API error, never a refusal', async () => {
    const res = await checkPerspectiveText('hello', {
      apiKey: KEY,
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }),
    });
    expect(res).toEqual({ ok: true, skipped: 'api-error' });
  });

  it('fails open on an unparseable body', async () => {
    const res = await checkPerspectiveText('hello', {
      apiKey: KEY,
      fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }),
    });
    expect(res).toEqual({ ok: true, skipped: 'api-error' });
  });

  it('fails open on an unexpected response shape (no attributeSummaries)', async () => {
    const res = await checkPerspectiveText('hello', {
      apiKey: KEY,
      fetchImpl: async () => ({ ok: true, json: async () => ({ somethingElse: 1 }) }),
    });
    expect(res).toEqual({ ok: true, skipped: 'api-error' });
  });

  it('fails open on a timeout — a hanging API never blocks the note', async () => {
    const hangingFetch = (url, opts) => new Promise((_, reject) => {
      const signal = opts?.signal;
      if (!signal) return; // never resolves without a signal
      if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
    const start = Date.now();
    const res = await checkPerspectiveText('hello', {
      apiKey: KEY, fetchImpl: hangingFetch, timeoutMs: 50,
    });
    expect(res).toEqual({ ok: true, skipped: 'api-error' });
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
