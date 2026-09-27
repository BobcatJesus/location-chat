import { describe, it, expect } from 'vitest';
import {
  buildMemoryContext,
  buildNpcPromptFromProfile,
  createMemorySummary,
  deriveRelationshipState,
  getTimeOfDayMood,
  resolveNpcPersonalityProfile,
  resolveNpcArchetypeProfile,
  resolveNpcCharacterProfile,
} from '../lib/inworld.js';
import { formatVenueEventsForPrompt, getVenueEvents } from '../lib/venueEvents.js';

describe('NPC memory helpers', () => {
  it('builds a compact player memory summary from remembered facts', () => {
    const memory = [
      { fact: 'Ava loves mystery novels.' },
      { fact: 'Ava said she is studying design.' },
    ];

    const context = buildMemoryContext(memory);

    expect(context).toContain('Ava');
    expect(context).toContain('mystery');
    expect(context).toContain('design');
  });

  it('keeps the summary grounded in the actual player name and topic', () => {
    const summary = createMemorySummary({
      playerName: 'Ava',
      userMessage: 'I am Ava and I love mystery books.',
      assistantReply: 'I do too. What are you reading lately?',
    });

    expect(summary).toContain('Ava');
    expect(summary).toContain('mystery');
    expect(summary).toContain('reading');
  });

  it('adds emotional relationship context to the memory prompt', () => {
    const context = buildMemoryContext(
      [{ fact: 'Ava loves mystery books.' }],
      { relationshipScore: 2, mood: 'warm and curious' }
    );

    expect(context).toContain('relationship');
    expect(context).toContain('warm');
    expect(context).toContain('curious');
  });

  it('increases friendliness when the player is warm and lowers it when the conversation gets sharp', () => {
    const warm = deriveRelationshipState({
      userMessage: 'You always give great recommendations, thanks.',
      previousScore: 0,
      previousAffinity: 0.1,
      previousTrust: 0.1,
    });

    const sharp = deriveRelationshipState({
      userMessage: 'You seem dismissive and rude.',
      previousScore: 1,
      previousAffinity: 0.7,
      previousTrust: 0.7,
    });

    expect(warm.relationshipScore).toBeGreaterThan(0);
    expect(warm.affinity).toBeGreaterThan(0.1);
    expect(warm.trust).toBeGreaterThan(0.1);
    expect(warm.mood).toContain('warm');
    expect(sharp.relationshipScore).toBeLessThan(1);
    expect(sharp.affinity).toBeLessThan(0.7);
    expect(sharp.trust).toBeLessThan(0.7);
    expect(sharp.mood).toContain('guarded');
  });

  it('applies a distinct personality bias for different NPC types', () => {
    const libraryNpc = resolveNpcPersonalityProfile({ layoutId: 'md-anderson-library', isOutdoor: false });
    const parkNpc = resolveNpcPersonalityProfile({ layoutId: 'park', isOutdoor: true });

    expect(libraryNpc.warmthBias).toBeGreaterThan(parkNpc.warmthBias);
    expect(libraryNpc.trustBias).toBeGreaterThan(parkNpc.trustBias);
    expect(libraryNpc.profileLabel).toMatch(/warm|library|book/i);
  });

  it('uses distinct text patterns and topic preferences per archetype', () => {
    const libraryNpc = resolveNpcArchetypeProfile({ layoutId: 'md-anderson-library' });
    const parkNpc = resolveNpcArchetypeProfile({ layoutId: 'park', isOutdoor: true });

    expect(libraryNpc.preferredTopics).toContain('books');
    expect(libraryNpc.signaturePhrases).toContain('have you read');
    expect(parkNpc.preferredTopics).toContain('weather');
    expect(parkNpc.signaturePhrases).toContain('nice day');
  });

  it('applies a custom backstory and specific voice for named characters', () => {
    const rosa = resolveNpcCharacterProfile({ npcName: 'Rosa', layoutId: 'md-anderson-library' });
    const jules = resolveNpcCharacterProfile({ npcName: 'Jules', layoutId: 'cafe' });

    expect(rosa.backstory).toContain('library');
    expect(rosa.signaturePhrases).toContain('have you read');
    expect(jules.backstory).toContain('coffee');
    expect(jules.signaturePhrases).toContain('extra shot?');
  });

  it('keeps relationship continuity and remembered details in the player context', () => {
    const context = buildMemoryContext(
      [
        { fact: 'Ava likes mystery books.' },
        { fact: 'Ava is studying design.' },
      ],
      { relationshipScore: 2, affinity: 0.82, trust: 0.8, mood: 'warm and curious', profileLabel: 'Rosa the librarian' }
    );

    expect(context).toContain('knows this player');
    expect(context).toContain('warm and curious');
    expect(context).toContain('mystery');
    expect(context).toContain('design');
  });

  it('adds richer social habits and recurring routines for named characters', () => {
    const rosa = resolveNpcCharacterProfile({ npcName: 'Rosa', layoutId: 'md-anderson-library' });
    const jules = resolveNpcCharacterProfile({ npcName: 'Jules', layoutId: 'cafe' });
    const mara = resolveNpcCharacterProfile({ npcName: 'Mara', layoutId: 'park', isOutdoor: true });

    expect(rosa.socialHabits).toEqual(expect.arrayContaining([expect.stringMatching(/stacks|library/i)]));
    expect(jules.relationshipHooks).toEqual(expect.arrayContaining([expect.stringMatching(/coffee|regular/i)]));
    expect(mara.routine).toMatch(/walk|park/i);
    expect(mara.petPeves).toEqual(expect.arrayContaining([expect.stringMatching(/litter|noise/i)]));
  });

  it('recognizes favorite regulars and uses more personal repeat-visitor phrases', () => {
    const rosa = resolveNpcCharacterProfile({ npcName: 'Rosa', layoutId: 'md-anderson-library' });
    const jules = resolveNpcCharacterProfile({ npcName: 'Jules', layoutId: 'cafe' });

    expect(rosa.favoriteRegulars).toEqual(expect.arrayContaining([expect.stringMatching(/quiet readers|thoughtful/i)]));
    expect(rosa.specialPhrases).toEqual(expect.arrayContaining([expect.stringMatching(/back again|still looking/i)]));
    expect(jules.favoriteRegulars).toEqual(expect.arrayContaining([expect.stringMatching(/morning regulars|coffee people/i)]));
    expect(jules.specialPhrases).toEqual(expect.arrayContaining([expect.stringMatching(/back for another|still want/i)]));
  });

  it('recognizes a familiar regular after repeated visits and warm relationship history', () => {
    const prompt = buildNpcPromptFromProfile({
      npcName: 'Rosa',
      layoutId: 'md-anderson-library',
      relationshipState: { relationshipScore: 2, affinity: 0.9, trust: 0.88, mood: 'warm and curious' },
      memoryFacts: [
        'Ava likes mystery books.',
        'Ava is studying design.',
        'Ava likes quiet reading corners.',
      ],
    });

    expect(prompt).toContain('recognized regular');
    expect(prompt).toContain('warm and curious');
    expect(prompt).toContain('Ava');
  });

  it('adds a simple time-of-day mood to the NPC prompt', () => {
    const morning = getTimeOfDayMood(new Date('2026-01-01T08:30:00'));
    const prompt = buildNpcPromptFromProfile({
      npcName: 'Jules',
      layoutId: 'cafe',
      timeOfDay: morning,
      relationshipState: { relationshipScore: 1, affinity: 0.7, trust: 0.7, mood: 'friendly' },
    });

    expect(morning.label).toBe('morning');
    expect(prompt).toContain('morning');
    expect(prompt).toContain('fresh');
  });

  it('gives sunset and late-night moods distinct lighting cues', () => {
    const sunset = getTimeOfDayMood(new Date('2026-01-01T18:30:00'));
    const lateNight = getTimeOfDayMood(new Date('2026-01-01T23:30:00'));
    const sunsetPrompt = buildNpcPromptFromProfile({ timeOfDay: sunset });
    const lateNightPrompt = buildNpcPromptFromProfile({ timeOfDay: lateNight });

    expect(sunset.backgroundColor).not.toBe(lateNight.backgroundColor);
    expect(sunset.lighting).toContain('sunset');
    expect(lateNight.lighting).toContain('late-night');
    expect(sunsetPrompt).toContain('warm orange');
    expect(lateNightPrompt).toContain('cool, low');
  });

  it('gives NPCs real venue events they can recommend without inventing details', () => {
    const events = getVenueEvents('md-anderson-library', new Date('2026-09-17T19:30:00'));
    const prompt = buildNpcPromptFromProfile({
      npcName: 'Rosa',
      layoutId: 'md-anderson-library',
      venueEvents: events,
    });

    expect(events[0].status).toBe('active');
    expect(formatVenueEventsForPrompt(events)).toContain('Quiet Hours: Study Night');
    expect(prompt).toContain('Quiet Hours: Study Night');
    expect(prompt).toContain('one question you want to untangle');
    expect(prompt).toContain('Never invent event names');
  });
});
