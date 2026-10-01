// lib/inworld.js
// Character Studio (Scenes/Characters, @inworld/nodejs-sdk) is retired. NPC replies now go
// through Inworld Router's OpenAI-compatible Chat Completions API instead.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INWORLD_API_URL = 'https://api.inworld.ai/v1/chat/completions';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEMORY_DIR = path.join(__dirname, '..', 'data');
const MEMORY_FILE = path.join(MEMORY_DIR, 'npc-memory.json');

// Router model id: bare id lets the Router pick the provider; use `<provider>/gemma-4-31b-it` to pin one.
const DEFAULT_MODEL = 'gemma-4-31b-it';
const DEFAULT_REASONING_EFFORT = 'low';

// Gemma 4's 262K window lets us keep far more history/memory than the old 10-message / 6-fact caps.
const roomHistories = new Map();
const MAX_HISTORY_MESSAGES = 60;
export const MAX_MEMORY_FACTS_PER_PLAYER = 50;

function sanitizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// Removes inline thought blocks some providers leave in `content` (closed or truncated by max_tokens).
export function stripReasoning(text = '') {
  return String(text || '')
    .replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\|channel\|?>thought[\s\S]*?<\|?channel\|>/gi, '')
    .replace(/<(think|thinking|thought)>[\s\S]*$/i, '')
    .replace(/<\|channel\|?>thought[\s\S]*$/i, '')
    .trim();
}

async function readMemoryStore() {
  try {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    const raw = await fs.readFile(MEMORY_FILE, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    return {};
  }
}

async function writeMemoryStore(store) {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
  await fs.writeFile(MEMORY_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function dedupeFacts(facts = []) {
  const seen = new Set();
  return facts.filter((entry) => {
    const text = sanitizeText(entry?.fact || entry || '');
    if (!text || seen.has(text.toLowerCase())) return false;
    seen.add(text.toLowerCase());
    return true;
  });
}

export function resolveNpcPersonalityProfile({ layoutId = '', isOutdoor = false, npcName = '' } = {}) {
  const theme = String(layoutId || '').toLowerCase();
  const nameLower = String(npcName || '').toLowerCase();

  if (isOutdoor || theme.includes('park') || theme.includes('outdoor')) {
    return {
      profileLabel: 'outdoor regular',
      warmthBias: 0.72,
      trustBias: 0.58,
      sassBias: 0.35,
      patienceBias: 0.62,
    };
  }

  if (theme.includes('library') || nameLower.includes('librarian') || theme.includes('book')) {
    return {
      profileLabel: 'bookish librarian',
      warmthBias: 0.85,
      trustBias: 0.8,
      sassBias: 0.25,
      patienceBias: 0.8,
    };
  }

  if (theme.includes('cafe') || theme.includes('coffee') || theme.includes('barista')) {
    return {
      profileLabel: 'busy barista',
      warmthBias: 0.76,
      trustBias: 0.7,
      sassBias: 0.38,
      patienceBias: 0.6,
    };
  }

  if (theme.includes('theater') || theme.includes('movie')) {
    return {
      profileLabel: 'theater regular',
      warmthBias: 0.7,
      trustBias: 0.65,
      sassBias: 0.3,
      patienceBias: 0.7,
    };
  }

  return {
    profileLabel: 'friendly local',
    warmthBias: 0.68,
    trustBias: 0.62,
    sassBias: 0.28,
    patienceBias: 0.66,
  };
}

export function resolveNpcArchetypeProfile({ layoutId = '', isOutdoor = false, npcName = '' } = {}) {
  const baseProfile = resolveNpcPersonalityProfile({ layoutId, isOutdoor, npcName });
  const theme = String(layoutId || '').toLowerCase();

  if (isOutdoor || theme.includes('park') || theme.includes('outdoor')) {
    return {
      ...baseProfile,
      archetype: 'park regular',
      preferredTopics: ['weather', 'fitness', 'food trucks', 'local hangs'],
      signaturePhrases: ['nice day', 'you seen this weather?', 'that view is unreal'],
      speechStyle: 'laid-back and observational',
      contentTone: 'casual, sunny, conversational',
    };
  }

  if (theme.includes('library') || theme.includes('book')) {
    return {
      ...baseProfile,
      archetype: 'library caretaker',
      preferredTopics: ['books', 'author recommendations', 'quiet study tips', 'reading lists'],
      signaturePhrases: ['have you read', 'this one is a great pick', 'quiet corner is best'],
      speechStyle: 'thoughtful and warm',
      contentTone: 'bookish, gentle, thoughtful',
    };
  }

  if (theme.includes('cafe') || theme.includes('coffee') || theme.includes('barista')) {
    return {
      ...baseProfile,
      archetype: 'barista',
      preferredTopics: ['coffee', 'mornings', 'music', 'neighborhood gossip'],
      signaturePhrases: ['extra shot?', 'you need a break?', 'this one is my favorite'],
      speechStyle: 'busy but friendly',
      contentTone: 'slightly rushed, warm, practical',
    };
  }

  return {
    ...baseProfile,
    archetype: 'friendly local',
    preferredTopics: ['hangouts', 'local stories', 'food', 'community'],
    signaturePhrases: ['you should check that out', 'it’s been a while', 'have you been here before'],
    speechStyle: 'easygoing and social',
    contentTone: 'welcoming, grounded, familiar',
  };
}

export function resolveNpcCharacterProfile({ npcName = '', layoutId = '', isOutdoor = false } = {}) {
  const base = resolveNpcArchetypeProfile({ npcName, layoutId, isOutdoor });
  const name = String(npcName || '').trim();
  const theme = String(layoutId || '').toLowerCase();

  const namedProfiles = {
    rosa: {
      backstory: 'Rosa has spent years running the library stacks and can tell what a person needs by the way they browse.',
      preferredTopics: ['books', 'quiet study corners', 'recommendations', 'library rituals'],
      signaturePhrases: ['have you read', 'the good stuff is usually in the back', 'try the quiet corner'],
      speechStyle: 'patient, warm, quietly amused',
      contentTone: 'bookish and grounded',
      profileLabel: 'Rosa the librarian',
      warmthBias: 0.9,
      trustBias: 0.82,
      socialHabits: ['straightens the stacks before opening', 'recommends books based on how a person browses', 'always notices if someone looks overwhelmed'],
      relationshipHooks: ['likes thoughtful, curious people', 'warms up when someone respects the quiet'],
      routine: 'opens the reading room, walks the stacks, and checks the study tables before settling in with a novel',
      petPeves: ['noisy conversations in the quiet corners', 'people treating recommendations like homework'],
      favoriteRegulars: ['quiet readers who come back for thoughtful recommendations', 'students who keep returning to the same shelves'],
      specialPhrases: ['back again? I was wondering when you would stop by', 'still looking for a quiet corner? I know the right shelf'],
      recognitionThreshold: 2,
      memoryThreshold: 2,
    },
    jules: {
      backstory: 'Jules started making coffee before sunrise and treats every guest like a regular, even if they only came in once.',
      preferredTopics: ['coffee', 'music', 'late-night plans', 'the neighborhood'],
      signaturePhrases: ['extra shot?', 'you need a break?', 'this one is my favorite'],
      speechStyle: 'fast, sharp, and caring',
      contentTone: 'busy but warm',
      profileLabel: 'Jules the barista',
      warmthBias: 0.8,
      trustBias: 0.72,
      socialHabits: ['starts the morning by checking the espresso machine', 'recognizes regulars by their order before they speak', 'keeps a running list of people who need a break'],
      relationshipHooks: ['likes people who ask for something specific', 'treats warm, easygoing people like regulars immediately', 'gets more patient with people who keep coming back'],
      routine: 'wakes early, preps the bar, and checks in on regulars before the rush hits',
      petPeves: ['rushed customers who never say what they want', 'people who treat the counter like a drive-through'],
      favoriteRegulars: ['morning regulars who know their order by heart', 'coffee people who come back for the same small ritual'],
      specialPhrases: ['back for another round? I got you', 'still want the usual? good, I was hoping you would'],
      recognitionThreshold: 1,
      memoryThreshold: 2,
    },
    mara: {
      backstory: 'Mara is the neighborhood park regular who knows every walking path, weather shift, and hidden sunset spot in the area.',
      preferredTopics: ['walking trails', 'weather', 'fitness', 'food trucks', 'local stories'],
      signaturePhrases: ['nice day for a walk', 'the trail gets better at sunset', 'you should try the east path'],
      speechStyle: 'easygoing, observant, outdoorsy',
      contentTone: 'sunny, grounded, lightly playful',
      profileLabel: 'Mara the park regular',
      warmthBias: 0.78,
      trustBias: 0.7,
      socialHabits: ['walks the same loop every morning', 'checks the weather before recommending a route', 'greets familiar faces by name'],
      relationshipHooks: ['likes people who show up consistently', 'gets more relaxed around kind and easygoing people', 'remembers who keeps showing up after a rough week'],
      routine: 'starts with a short walk, watches the sky, and stays near the path until the park starts to fill up',
      petPeves: ['litter left on the trail', 'people blasting loud music early in the morning'],
      favoriteRegulars: ['people who make the same walk every week', 'folks who stop by after a long day'],
      specialPhrases: ['back for the loop? I was just thinking you would show', 'sunset is better when the usual crew is here'],
      recognitionThreshold: 1,
      memoryThreshold: 2,
    },
  };

  const override = namedProfiles[String(name).toLowerCase()] || null;
  if (!override) return base;

  return {
    ...base,
    ...override,
    backstory: override.backstory,
    profileLabel: override.profileLabel || base.profileLabel,
    preferredTopics: override.preferredTopics || base.preferredTopics,
    signaturePhrases: override.signaturePhrases || base.signaturePhrases,
    speechStyle: override.speechStyle || base.speechStyle,
    contentTone: override.contentTone || base.contentTone,
    warmthBias: override.warmthBias ?? base.warmthBias,
    trustBias: override.trustBias ?? base.trustBias,
    socialHabits: override.socialHabits || base.socialHabits || [],
    relationshipHooks: override.relationshipHooks || base.relationshipHooks || [],
    routine: override.routine || base.routine || '',
    petPeves: override.petPeves || base.petPeves || [],
    favoriteRegulars: override.favoriteRegulars || [],
    specialPhrases: override.specialPhrases || [],
    recognitionThreshold: override.recognitionThreshold ?? 2,
    memoryThreshold: override.memoryThreshold ?? 2,
    archetype: base.archetype,
    theme,
  };
}

export function deriveRelationshipState({
  userMessage = '',
  previousScore = 0,
  previousAffinity = 0.5,
  previousTrust = 0.5,
  personalityProfile = null,
} = {}) {
  const text = sanitizeText(userMessage || '').toLowerCase();
  const profile = personalityProfile || resolveNpcPersonalityProfile();
  const warmthBias = Number(profile?.warmthBias ?? 0.7);
  const trustBias = Number(profile?.trustBias ?? 0.65);

  if (!text) {
    return {
      relationshipScore: Number.isFinite(previousScore) ? Number(previousScore) : 0,
      affinity: Number.isFinite(previousAffinity) ? Number(previousAffinity) : 0.5,
      trust: Number.isFinite(previousTrust) ? Number(previousTrust) : 0.5,
      mood: 'neutral',
      profileLabel: profile.profileLabel,
    };
  }

  const warmSignals = [
    'thanks', 'love', 'great', 'helpful', 'kind', 'awesome', 'recommendation', 'like', 'good',
    'happy', 'please', 'appreciate', 'nice', 'cool', 'fun'
  ];
  const sharpSignals = [
    'rude', 'dismissive', 'annoying', 'mean', 'cold', 'bad', 'hate', 'terrible', 'stupid',
    'frustrated', 'lazy', 'boring', 'ignore'
  ];

  let score = Number.isFinite(previousScore) ? Number(previousScore) : 0;
  let affinity = Number.isFinite(previousAffinity) ? Number(previousAffinity) : 0.5;
  let trust = Number.isFinite(previousTrust) ? Number(previousTrust) : 0.5;

  const warmHits = warmSignals.filter((signal) => text.includes(signal)).length;
  const sharpHits = sharpSignals.filter((signal) => text.includes(signal)).length;

  if (warmHits > 0) {
    score += warmHits;
    affinity = Math.min(1, affinity + warmHits * (0.18 + warmthBias * 0.06));
    trust = Math.min(1, trust + warmHits * (0.14 + trustBias * 0.05));
  }
  if (sharpHits > 0) {
    score -= sharpHits;
    affinity = Math.max(0, affinity - sharpHits * (0.22 + warmthBias * 0.05));
    trust = Math.max(0, trust - sharpHits * (0.25 + trustBias * 0.06));
  }

  affinity = Math.max(0, Math.min(1, affinity - (0.02 + (1 - warmthBias) * 0.03)));
  trust = Math.max(0, Math.min(1, trust - (0.01 + (1 - trustBias) * 0.02)));
  score = Math.max(-3, Math.min(3, score));

  let mood = 'neutral';
  if (score >= 2 || affinity >= 0.8 && trust >= 0.7) mood = 'warm and curious';
  else if (score >= 1 || affinity >= 0.6) mood = 'friendly';
  else if (score <= -2 || trust <= 0.3) mood = 'guarded and irritated';
  else if (score <= -1 || affinity <= 0.4) mood = 'guarded';

  return {
    relationshipScore: score,
    affinity: Number(affinity.toFixed(2)),
    trust: Number(trust.toFixed(2)),
    mood,
    profileLabel: profile.profileLabel,
  };
}

export function buildMemoryContext(memories = [], relationshipState = {}) {
  const facts = dedupeFacts(memories);
  const score = Number.isFinite(relationshipState?.relationshipScore)
    ? Number(relationshipState.relationshipScore)
    : 0;
  const affinity = Number.isFinite(relationshipState?.affinity)
    ? Number(relationshipState.affinity)
    : 0.5;
  const trust = Number.isFinite(relationshipState?.trust)
    ? Number(relationshipState.trust)
    : 0.5;
  const mood = relationshipState?.mood || deriveRelationshipState({ previousScore: score, previousAffinity: affinity, previousTrust: trust }).mood;
  const profileLabel = relationshipState?.profileLabel || 'friendly local';

  const relationshipLine = `relationship: ${score >= 0 ? 'positive' : 'strained'} (${score}), affinity ${affinity.toFixed(2)}, trust ${trust.toFixed(2)}, mood is ${mood}, profile is ${profileLabel}.`;
  if (!facts.length) {
    return `This NPC knows this player only a little so far. No saved memories about this player yet. ${relationshipLine}`;
  }

  const continuityLine = `This NPC knows this player and remembers their recent details.`;
  return `${continuityLine}\nRelevant memories about this player:\n- ${facts.map((entry) => sanitizeText(entry?.fact || entry)).join('\n- ')}\n\n${relationshipLine}`;
}

export function getTimeOfDayMood(date = new Date()) {
  if (date && typeof date === 'object' && 'label' in date && 'tone' in date) {
    return date;
  }

  const resolvedDate = date instanceof Date ? date : new Date(date);
  const hour = Number.isFinite(resolvedDate?.getTime?.()) ? resolvedDate.getHours() : 12;

  if (hour >= 5 && hour < 11) {
    return {
      label: 'morning',
      tone: 'fresh, half-awake, and practical',
      description: 'The place feels calm and a little sleepy, with coffee and quiet routines taking over.',
    };
  }

  if (hour >= 11 && hour < 17) {
    return {
      label: 'afternoon',
      tone: 'busy, bright, and social',
      description: 'The place is active, people are moving through, and everyone is a little more animated.',
    };
  }

  if (hour >= 17 && hour < 21) {
    return {
      label: 'evening',
      tone: 'warm, relaxed, and a little social',
      description: 'The atmosphere is softer and more conversational, with people lingering longer.',
      lighting: 'sunset light stretches warm orange across the room',
      backgroundColor: 0xe7835b,
    };
  }

  return {
    label: 'night',
    tone: 'quiet, dim, and intimate',
    description: 'The room is winding down, conversations are lower, and the vibe is more private.',
    lighting: 'late-night light is cool, low, and pooled around the quiet areas',
    backgroundColor: 0x111827,
  };
}

export function buildNpcPromptFromProfile({ npcName, layoutId, isOutdoor, relationshipState, memoryFacts = [], timeOfDay, venueEvents = [] } = {}) {
  const profile = resolveNpcCharacterProfile({ npcName, layoutId, isOutdoor });
  const name = sanitizeText(npcName || 'a local');
  const topicList = (profile?.preferredTopics || []).slice(0, 3).join(', ');
  const phraseList = (profile?.signaturePhrases || []).slice(0, 2).join(' / ');
  const socialHabits = (profile?.socialHabits || []).slice(0, 2).join('; ');
  const relationshipHooks = (profile?.relationshipHooks || []).slice(0, 2).join('; ');
  const favoriteRegulars = (profile?.favoriteRegulars || []).slice(0, 2).join('; ');
  const specialPhrases = (profile?.specialPhrases || []).slice(0, 2).join(' / ');
  const routineText = profile?.routine ? `Routine: ${profile.routine}.` : '';
  const petPeeves = (profile?.petPeves || []).slice(0, 2).join(', ');
  const moodText = relationshipState?.mood || 'neutral';
  const timeMood = timeOfDay ? getTimeOfDayMood(timeOfDay) : getTimeOfDayMood(new Date());
  const memoryCount = Array.isArray(memoryFacts) ? memoryFacts.length : 0;
  const relationshipScore = Number(relationshipState?.relationshipScore ?? 0);
  const affinity = Number(relationshipState?.affinity ?? 0);
  const trust = Number(relationshipState?.trust ?? 0);
  const recognitionThreshold = Number(profile?.recognitionThreshold ?? 2);
  const memoryThreshold = Number(profile?.memoryThreshold ?? 2);
  const familiarityThreshold = relationshipScore >= recognitionThreshold
    || (memoryCount >= memoryThreshold && relationshipScore >= 1)
    || (affinity >= 0.8 && trust >= 0.75)
    || (affinity >= 0.7 && trust >= 0.7 && memoryCount >= 2);
  const familiarityText = familiarityThreshold
    ? 'This is a recognized regular and you should treat them like someone you already know.'
    : 'This is a first or casual interaction, so keep it friendly but a little formal.';
  const memoryText = Array.isArray(memoryFacts) && memoryFacts.length
    ? `You remember this person: ${memoryFacts.map((fact) => sanitizeText(fact?.fact || fact)).join('; ')}.`
    : 'You do not know this person yet.';
  const backstoryText = profile?.backstory ? `Backstory: ${profile.backstory}` : '';
  const relationshipText = relationshipState?.relationshipScore != null
    ? `You currently feel ${moodText} toward this person, with a relationship score of ${relationshipState.relationshipScore}.`
    : 'You are meeting this person for the first time.';
  const timeOfDayText = `It is ${timeMood.label} time. The vibe is ${timeMood.tone}. ${timeMood.description} ${timeMood.lighting || ''}`.trim();
  const eventText = Array.isArray(venueEvents) && venueEvents.length
    ? `Venue events you can recommend: ${venueEvents.map((event) => `${event.title} (${event.status || 'upcoming'}): ${event.description}`).join(' | ')}.`
    : 'There are no scheduled venue events to recommend right now.';

  return [
    `You are ${name}. ${backstoryText}`.trim(),
    `You are a ${profile.archetype}.`,
    `Your personality is ${profile.speechStyle} and your energy is ${profile.contentTone}.`,
    timeOfDayText,
    eventText,
    'Recommend an event only when it fits the player\'s question or the conversation. Never invent event names, times, or details.',
    `Favorite topics: ${topicList}.`,
    `Social habits: ${socialHabits}.`,
    routineText,
    `Relationship cues: ${relationshipHooks}.`,
    favoriteRegulars ? `Favorite regulars include: ${favoriteRegulars}.` : '',
    petPeeves ? `Things that annoy you: ${petPeeves}.` : '',
    `You naturally say things like: ${phraseList}.`,
    specialPhrases ? `When someone is a familiar regular, say something like: ${specialPhrases}.` : '',
    familiarityText,
    memoryText,
    `Keep your reply short, casual, and human.`,
    relationshipText,
  ].filter(Boolean).join(' ');
}

export function createMemorySummary({ playerName, userMessage, assistantReply } = {}) {
  const name = sanitizeText(playerName || 'player');
  const combined = sanitizeText(`${userMessage || ''} ${assistantReply || ''}`);
  const summary = [];

  const directedName = combined.match(/(?:i am|i'm|my name is|call me)\s+([A-Za-z][A-Za-z'\- ]{1,30})/i);
  if (directedName?.[1]) {
    summary.push(`${sanitizeText(directedName[1])} is the player.`);
  }

  const likes = combined.match(/(?:i (?:really )?love|i enjoy|i like|i'm into|i am into|i keep thinking about)\s+([^.!?]+)/i);
  if (likes?.[1]) {
    summary.push(`${name || 'The player'} likes ${sanitizeText(likes[1]).toLowerCase()}.`);
  }

  const studying = combined.match(/(?:i am studying|i'm studying|i study|i work on|i am learning|i'm learning)\s+([^.!?]+)/i);
  if (studying?.[1]) {
    summary.push(`${name || 'The player'} is studying ${sanitizeText(studying[1]).toLowerCase()}.`);
  }

  const favorite = combined.match(/(?:favorite|favourite)\s+(?:book|genre|thing|topic|food|place)\s+(?:is|:|=)?\s*([^.!?]+)/i);
  if (favorite?.[1]) {
    summary.push(`${name || 'The player'} likes ${sanitizeText(favorite[1]).toLowerCase()}.`);
  }

  const reading = combined.match(/(?:reading|read(?:ing)?\s+(?:lately|now|currently)|what are you reading|what do you read|reading lately|reading now)/i);
  if (reading) {
    summary.push(`${name || 'The player'} is talking about reading.`);
  }

  const topic = combined.match(/(?:love|like|enjoy|into|studying|reading)\s+([^.!?]+)/i);
  if (topic?.[1] && !summary.length) {
    summary.push(`${name || 'The player'} is talking about ${sanitizeText(topic[1]).toLowerCase()}.`);
  }

  if (!summary.length && name && !/player/i.test(name)) {
    summary.push(`${name} is talking about the current conversation.`);
  }

  if (!summary.length) {
    const sample = combined.split(/\s+/).slice(0, 8).join(' ');
    summary.push(`The player mentioned: ${sanitizeText(sample) || 'the current conversation'}.`);
  }

  return summary.slice(0, 3).join(' ');
}

async function getPlayerMemory({ npcId, playerId, playerName, roomId }) {
  const store = await readMemoryStore();
  const key = `${npcId || roomId || 'global'}:${playerId || playerName || 'guest'}`;
  return dedupeFacts(store[key]?.facts || []).slice(-MAX_MEMORY_FACTS_PER_PLAYER);
}

async function savePlayerMemory({ npcId, playerId, playerName, roomId, userMessage, assistantReply }) {
  const store = await readMemoryStore();
  const key = `${npcId || roomId || 'global'}:${playerId || playerName || 'guest'}`;
  const summary = createMemorySummary({ playerName, userMessage, assistantReply });
  if (!summary) return;

  const bucket = store[key] || { playerName: playerName || 'Guest', facts: [] };
  bucket.playerName = playerName || bucket.playerName || 'Guest';
  bucket.facts = dedupeFacts([
    ...bucket.facts,
    { fact: summary },
  ]).slice(-MAX_MEMORY_FACTS_PER_PLAYER);

  store[key] = bucket;
  await writeMemoryStore(store);
  return bucket.facts;
}

// If the Inworld API stalls, fail fast instead of leaving the player in
// silence forever: the npc_chat handler's catch turns this into a graceful
// "Sorry, could you say that again?" reply.
const INWORLD_TIMEOUT_MS = Number(process.env.INWORLD_TIMEOUT_MS) || 25000;

async function postChatCompletion(body) {
  const response = await fetch(INWORLD_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.INWORLD_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(INWORLD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Inworld API error ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function runToolCalls(toolCalls, toolHandlers = {}) {
  return Promise.all(toolCalls.map(async (call) => {
    const name = call.function?.name;
    let result;
    if (!name || !Object.hasOwn(toolHandlers, name)) {
      result = { error: `Unknown tool: ${name}` };
    } else {
      try {
        result = await toolHandlers[name](JSON.parse(call.function.arguments || '{}'));
      } catch (error) {
        result = { error: error.message };
      }
    }
    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result ?? {}) };
  }));
}

// Sends `userMessage` to the router using `systemPrompt` as the NPC's persona and returns its reply text.
// Optional: options.tools (OpenAI format) + options.toolHandlers ({ name: async (args) => result }),
// options.responseFormat (e.g. { type: 'json_object' }).
export async function askInworldCharacter(roomId, systemPrompt, userMessage, options = {}) {
  const history = roomHistories.get(roomId) || [];
  const memoryFacts = Array.isArray(options.memoryFacts)
    ? options.memoryFacts
    : (options?.playerName || options?.playerId || options?.npcId
      ? await getPlayerMemory({ npcId: options.npcId || roomId, playerId: options.playerId, playerName: options.playerName, roomId })
      : []);
  const memoryContext = options.memoryContext || buildMemoryContext(memoryFacts);
  const systemContent = [systemPrompt, memoryContext].filter(Boolean).join('\n\n');
  const messages = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const baseRequest = {
    model: process.env.INWORLD_MODEL || DEFAULT_MODEL,
    temperature: Number(process.env.INWORLD_TEMPERATURE) || 1.0,
    presence_penalty: 0.6,
    reasoning_effort: process.env.INWORLD_REASONING_EFFORT || DEFAULT_REASONING_EFFORT,
    // Reasoning tokens count against this budget; reply brevity is enforced by the persona prompt instead.
    max_tokens: Number(process.env.INWORLD_MAX_TOKENS) || 1024,
    ...(options.responseFormat && { response_format: options.responseFormat }),
  };
  const tools = Array.isArray(options.tools) && options.tools.length ? options.tools : null;

  let data = await postChatCompletion({
    ...baseRequest,
    messages,
    ...(tools && { tools, tool_choice: options.toolChoice || 'auto' }),
  });
  let message = data.choices?.[0]?.message;

  if (tools && message?.tool_calls?.length) {
    const toolMessages = await runToolCalls(message.tool_calls, options.toolHandlers);
    data = await postChatCompletion({
      ...baseRequest,
      messages: [
        ...messages,
        { role: 'assistant', content: message.content || '', tool_calls: message.tool_calls },
        ...toolMessages,
      ],
    });
    message = data.choices?.[0]?.message;
  }

  // Separate reasoning fields (reasoning / reasoning_content) are intentionally ignored.
  const reply = stripReasoning(message?.content);
  if (!reply) throw new Error('Inworld API returned no reply');

  const nextHistory = [...history, { role: 'user', content: userMessage }, { role: 'assistant', content: reply }].slice(
    -MAX_HISTORY_MESSAGES
  );
  roomHistories.set(roomId, nextHistory);

  if ((options?.playerName || options?.playerId || options?.npcId) && !options?.skipFileMemory) {
    await savePlayerMemory({
      npcId: options.npcId || roomId,
      playerId: options.playerId,
      playerName: options.playerName,
      roomId,
      userMessage,
      assistantReply: reply,
    });
  }

  return reply;
}

