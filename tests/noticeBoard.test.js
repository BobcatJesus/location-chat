// noticeBoard.test.js — Notice Board v1 (`sq-notice-board-v1`).
// Pure-logic tests for src/village/noticeBoardState.js (same shape as
// tests/items.test.js: the module has no Phaser / Node deps).

import { describe, it, expect } from 'vitest';
import {
  NOTICE_BOARD_MARKER,
  NOTICE_BOARD_MAX_FLYERS,
  createNoticeBoardState,
  pinFlyer,
  removeFlyer,
  canRemoveFlyer,
  serializeNoticeBoardState,
  parseNoticeBoardState,
} from '../src/village/noticeBoardState.js';

const flyer = (over = {}) => ({
  id: over.id || `f-${Math.random().toString(36).slice(2, 8)}`,
  title: over.title || 'Guitar lessons',
  text: over.text || 'First lesson free!',
  addedBy: over.addedBy || 'alice@example.com',
  addedByName: over.addedByName || 'Alice',
  ...over,
});

describe('notice board v1', () => {
  it('carries the v1 marker', () => {
    expect(NOTICE_BOARD_MARKER).toBe('sq-notice-board-v1');
    expect(NOTICE_BOARD_MAX_FLYERS).toBe(10);
  });

  it('pins a flyer and serializes it', () => {
    const state = createNoticeBoardState();
    const res = pinFlyer(state, flyer({ id: 'f1' }));
    expect(res.ok).toBe(true);
    expect(res.flyer.id).toBe('f1');
    const s = serializeNoticeBoardState(state);
    expect(s.count).toBe(1);
    expect(s.flyers[0].title).toBe('Guitar lessons');
    expect(s.flyers[0].addedByName).toBe('Alice');
  });

  it('rejects an empty flyer and a duplicate id', () => {
    const state = createNoticeBoardState();
    expect(pinFlyer(state, flyer({ title: '   ', text: 'x' })).ok).toBe(false);
    expect(pinFlyer(state, flyer({ title: 'T', text: '   ' })).ok).toBe(false);
    pinFlyer(state, flyer({ id: 'dup' }));
    expect(pinFlyer(state, flyer({ id: 'dup' })).reason).toBe('duplicate');
    expect(state.flyers.length).toBe(1);
  });

  it('trims title and text to the flyer limits (60 / 200)', () => {
    const state = createNoticeBoardState();
    const res = pinFlyer(state, flyer({ title: 'T'.repeat(80), text: 'X'.repeat(300) }));
    expect(res.ok).toBe(true);
    expect(res.flyer.title.length).toBe(60);
    expect(res.flyer.text.length).toBe(200);
  });

  it('caps at 10: the 11th pin drops the oldest flyer', () => {
    const state = createNoticeBoardState();
    for (let i = 0; i < 10; i++) pinFlyer(state, flyer({ id: `f${i}` }));
    expect(state.flyers.length).toBe(10);
    const res = pinFlyer(state, flyer({ id: 'f10' }));
    expect(res.ok).toBe(true);
    expect(res.dropped.id).toBe('f0');
    expect(state.flyers.length).toBe(10);
    expect(state.flyers[0].id).toBe('f1');
    expect(state.flyers[9].id).toBe('f10');
  });

  it('lets the owner take down their own flyer', () => {
    const state = createNoticeBoardState();
    pinFlyer(state, flyer({ id: 'mine', addedBy: 'alice@example.com' }));
    pinFlyer(state, flyer({ id: 'theirs', addedBy: 'bob@example.com' }));
    const res = removeFlyer(state, 'mine', 'alice@example.com', false);
    expect(res.ok).toBe(true);
    expect(res.flyer.id).toBe('mine');
    expect(state.flyers.map((f) => f.id)).toEqual(['theirs']);
  });

  it('refuses someone else’s flyer to a non-moderator', () => {
    const state = createNoticeBoardState();
    pinFlyer(state, flyer({ id: 'theirs', addedBy: 'bob@example.com' }));
    const res = removeFlyer(state, 'theirs', 'alice@example.com', false);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-allowed');
    expect(state.flyers.length).toBe(1);
  });

  it('lets a moderator take down any flyer', () => {
    const state = createNoticeBoardState();
    pinFlyer(state, flyer({ id: 'theirs', addedBy: 'bob@example.com' }));
    const res = removeFlyer(state, 'theirs', 'alice@example.com', true);
    expect(res.ok).toBe(true);
    expect(state.flyers.length).toBe(0);
  });

  it('removing a missing flyer fails cleanly', () => {
    const state = createNoticeBoardState();
    expect(removeFlyer(state, 'nope', 'alice@example.com', true).reason).toBe('not-found');
    expect(canRemoveFlyer(null, 'alice@example.com', true)).toBe(false);
  });

  it('serialize / parse round-trips and drops bad entries', () => {
    const state = createNoticeBoardState();
    pinFlyer(state, flyer({ id: 'a' }));
    pinFlyer(state, flyer({ id: 'b' }));
    const parsed = parseNoticeBoardState(serializeNoticeBoardState(state));
    expect(parsed.flyers.map((f) => f.id)).toEqual(['a', 'b']);
    const dirty = parseNoticeBoardState({
      flyers: [
        { id: 'good', title: 'T', text: 'X', addedBy: 'a@b.c', addedByName: 'A' },
        { id: 'bad', title: '   ', text: 'X' },
        { id: 'good', title: 'T', text: 'X' }, // duplicate id
        null,
      ],
    });
    expect(dirty.flyers.map((f) => f.id)).toEqual(['good']);
    expect(parseNoticeBoardState(null).flyers).toEqual([]);
    expect(parseNoticeBoardState({ flyers: 'nope' }).flyers).toEqual([]);
  });
});
