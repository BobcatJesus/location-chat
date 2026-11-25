// promptPriority.test.js — hang-prompt priority (Christmas Quests
// v1.2, `sq-christmas-multi-v1.2`; v1.3, `sq-christmas-lights-v1.3`).
//
// The bug: standing at the coffee bar with a light string in hand,
// the "Hang the lights" prompt never showed — the pond / cat /
// puzzle-table suppression hid it. The rule: carrying wins. The
// scene (VillageScene.js) calls showHangPrompt for both the tree
// and the lights hang spots; this pins the decision itself (the
// scene is Phaser and cannot be instantiated in vitest — the live
// check is the prompt actually appearing in the Agora).
//
// v1.3 (`sq-christmas-lights-v1.3`): `otherCarrying` — the east/west
// light strands pass within the trees' hang ranges, so at the south
// corner spots both hang prompts could fire at once. The item in
// hand decides: a hang prompt never shows while the other quest's
// item is being carried.

import { describe, it, expect } from 'vitest';
import { showHangPrompt } from '../src/village/promptPriority.js';

describe('showHangPrompt — carrying wins over the pond/cat/table suppression', () => {
  it('shows while carrying even when the cat is near', () => {
    expect(showHangPrompt({
      nearHangSpot: true, nearPond: false, nearCat: true, nearTable: false, carrying: true,
    })).toBe(true);
  });

  it('shows while carrying even when a puzzle table is near', () => {
    expect(showHangPrompt({
      nearHangSpot: true, nearPond: false, nearCat: false, nearTable: true, carrying: true,
    })).toBe(true);
  });

  it('shows while carrying even when the pond is near', () => {
    expect(showHangPrompt({
      nearHangSpot: true, nearPond: true, nearCat: false, nearTable: false, carrying: true,
    })).toBe(true);
  });

  it('shows while carrying even when the pond, the cat, and a table are all near', () => {
    expect(showHangPrompt({
      nearHangSpot: true, nearPond: true, nearCat: true, nearTable: true, carrying: true,
    })).toBe(true);
  });

  it('stays hidden when not carrying and the cat is near', () => {
    expect(showHangPrompt({
      nearHangSpot: true, nearPond: false, nearCat: true, nearTable: false, carrying: false,
    })).toBe(false);
  });

  it('stays hidden when not carrying and a table is near', () => {
    expect(showHangPrompt({
      nearHangSpot: true, nearPond: false, nearCat: false, nearTable: true, carrying: false,
    })).toBe(false);
  });

  it('stays hidden when not carrying and the pond is near', () => {
    expect(showHangPrompt({
      nearHangSpot: true, nearPond: true, nearCat: false, nearTable: false, carrying: false,
    })).toBe(false);
  });

  it('shows when not carrying and nothing else is near', () => {
    expect(showHangPrompt({
      nearHangSpot: true, nearPond: false, nearCat: false, nearTable: false, carrying: false,
    })).toBe(true);
  });

  it('never shows when not at the hang spot, carrying or not', () => {
    expect(showHangPrompt({
      nearHangSpot: false, nearPond: false, nearCat: false, nearTable: false, carrying: true,
    })).toBe(false);
    expect(showHangPrompt({
      nearHangSpot: false, nearPond: false, nearCat: false, nearTable: false, carrying: false,
    })).toBe(false);
  });
});

describe('showHangPrompt — v1.3 otherCarrying: the item in hand decides', () => {
  it('stays hidden while carrying the OTHER quest item, even at the spot', () => {
    // A light string in hand at the tree: no tree hang prompt.
    expect(showHangPrompt({
      nearHangSpot: true, nearPond: false, nearCat: false, nearTable: false,
      carrying: false, otherCarrying: true,
    })).toBe(false);
    // An ornament in hand at a lights spot: no lights hang prompt.
    expect(showHangPrompt({
      nearHangSpot: true, nearPond: false, nearCat: false, nearTable: false,
      carrying: true, otherCarrying: true,
    })).toBe(false);
  });

  it('otherCarrying false (or absent) changes nothing', () => {
    expect(showHangPrompt({
      nearHangSpot: true, nearPond: false, nearCat: false, nearTable: false,
      carrying: true, otherCarrying: false,
    })).toBe(true);
    expect(showHangPrompt({
      nearHangSpot: true, nearPond: false, nearCat: false, nearTable: false,
      carrying: true,
    })).toBe(true);
  });
});
