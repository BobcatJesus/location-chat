// server/socket.js
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import pg from 'pg';
import { createAuthService, registerAuthRoutes } from './auth.js';
import { findRoomByLocation, getAllRooms } from '../rooms/rooms.js';
import { isWithinRadius } from '../src/geo.js';
import { buildAutoLayout } from '../src/village/AutoLayout.js';
import { getRoomAccessRadius, isOpenAccessRoom } from '../src/accessPolicy.js';
import {
  askInworldCharacter,
  createMemorySummary,
  deriveRelationshipState,
  getTimeOfDayMood,
  resolveNpcArchetypeProfile,
  resolveNpcCharacterProfile,
  buildNpcPromptFromProfile,
  MAX_MEMORY_FACTS_PER_PLAYER,
} from '../lib/inworld.js';
import { addVenueEvent, formatVenueEventsForPrompt, getVenueEvents } from '../lib/venueEvents.js';
import {
  PUZZLE_MARKER,
  PUZZLE_RESET_MS,
  createPuzzleState,
  collectPiece,
  placePiece,
  serializePuzzleState,
} from '../src/village/puzzleState.js';
import {
  TREE_MARKER_V1,
  createTreeState,
  hangOrnament,
  serializeTreeState,
} from '../src/village/treeState.js';
import {
  LIGHTS_MARKER_V1,
  createLightState,
  hangLight,
  serializeLightState,
} from '../src/village/lightState.js';
import {
  SNOW_MARKER_V1,
  createSnowState,
  addSnowball,
  serializeSnowState,
} from '../src/village/snowState.js';
import {
  HAT_MARKER_V1,
  createHatState,
  findHat,
  placeHat,
  slipHat,
  pickupHat,
  releaseHat,
  serializeHatState,
} from '../src/village/hatState.js';
// Santa's Lost Present v1.1 (`sq-santas-lost-present-v1.1`): one
// present hidden under Table 4 in Agora, one find per
// player per Chicago day. The pure daily rules live in
// presentState.js so the server stays authoritative over the
// daily rule and the badge.
import {
  PRESENT_ID,
  PRESENT_MARKER,
  createPresentState,
  chicagoDateString,
  findPresent,
  serializePresentState,
} from '../src/village/presentState.js';
import {
  HAT_ROOM_STATE_TABLE_SQL,
  saveHatState,
  loadHatState,
} from './hatPersist.js';
import {
  MAIL_INBOX_TABLE_SQL,
  saveMailInbox,
  loadMailInbox,
} from './mailPersist.js';
import {
  PUZZLE_ROOM_STATE_TABLE_SQL,
  savePuzzleState,
  loadPuzzleState,
  repairLoadedPuzzleState,
} from './puzzlePersist.js';
import {
  TREE_ROOM_STATE_TABLE_SQL,
  saveTreeState,
  loadTreeState,
} from './treePersist.js';
import {
  LIGHTS_ROOM_STATE_TABLE_SQL,
  saveLightState,
  loadLightState,
} from './lightPersist.js';
import {
  SNOWMAN_ROOM_STATE_TABLE_SQL,
  saveSnowState,
  loadSnowState,
} from './snowPersist.js';
import {
  NOTICE_BOARD_STATE_TABLE_SQL,
  saveNoticeBoardState,
  loadNoticeBoardState,
} from './noticeBoardPersist.js';
import {
  DECOR_ROOM_STATE_TABLE_SQL,
  saveDecorState,
  loadDecorState,
} from './decorPersist.js';
import {
  CAT_ROOM_STATE_TABLE_SQL,
  saveCatState,
  loadCatState,
} from './catPersist.js';
import {
  JUKEBOX_ROOM_STATE_TABLE_SQL,
  saveJukeboxNowPlaying,
  loadJukeboxNowPlaying,
  jukeboxRemainingMs,
  JUKEBOX_MIN_REMAINING_MS,
  shouldSkipSong,
} from './jukeboxPersist.js';
import {
  NOTICE_BOARD_MAX_FLYERS,
  createNoticeBoardState,
  pinFlyer,
  removeFlyer,
  serializeNoticeBoardState,
} from '../src/village/noticeBoardState.js';
import {
  createDecorState,
  placeDecoration,
  removeDecoration,
  serializeDecorState,
} from '../src/village/decorState.js';
// Shared Floor Litter v1 (`sq-shared-litter-v1`): dropped pocket
// items are visible to everyone in the room. The pure state rules
// (cleaning, cap, claims) live in floorLitterState.js so the
// server stays authoritative over every drop and pickup.
import {
  createFloorLitterState,
  addFloorLitter,
  claimFloorLitter,
  confirmFloorLitterClaim,
  cancelFloorLitterClaim,
  sweepFloorLitterClaims,
  serializeFloorLitterState,
  litterPocketItem,
} from '../src/village/floorLitterState.js';
// Catch a Litterbug v1 (`sq-litterbug-quest-v1`): fresh litter is
// catchable for 15s, and Shepherd Park NPCs drop cups on a timer.
// The pure freshness / catch / NPC rules live in litterbugState.js
// so the server stays authoritative over every catch.
import {
  LITTERBUG_NPC_ROOM_ID,
  LITTERBUG_NPC_COOLDOWN_MS,
  LITTERBUG_NPC_CUP,
  isNpcLitter,
  isLitterbugNpcLabel,
  npcIdForLabel,
  validateLitterbugCatch,
} from '../src/village/litterbugState.js';
// Hungry Cat v1 (`sq-hungry-cat-v1`): the cat gets hungry twice a
// day (morning + evening, Chicago time) on a server timer — the
// pure window math + hunger state machine live in catHunger.js so
// the server is authoritative for hunger and for who completed a
// window.
import {
  HUNGRY_CAT_MARKER_V1,
  HUNGRY_CAT_QUEST_ID,
  HUNGRY_CAT_REWARD_COINS,
  HUNGRY_CAT_WINDOWS,
  parseHungerWindows,
  createCatHungerState,
  serializeCatHunger,
  refreshCatHunger,
  feedCatHunger,
} from '../src/village/catHunger.js';
import { backfilledBadgesFromQuestState } from '../src/village/badges.js';
import {
  isHomeRoom,
  homeOwnerOf,
  normalizeHomeOwner,
  normalizeHomeItems,
  mergeHomeItems,
  normalizeFloorItems,
  mergeFloorItems,
} from '../src/village/homeStorage.js';
// Places Sync v1 (`sq-places-sync-v1`): per-player place records.
import {
  normalizePlaceRecord,
  mergeServerPlaces,
  isGuestOwnerKey,
} from '../src/village/placesSync.js';
import {
  MAILBOX_MARKER_V1,
  createMailState,
  sendPackage,
  collectPackage,
  serializeMailState,
  mailboxCodeFor,
  normalizeMailboxCode,
  isValidMailboxCode,
  cleanMailItem,
} from '../src/village/mailState.js';

// Shared instructions so every NPC reads as a real person, not a helpful assistant.
const HUMAN_STYLE_GUIDE = `
Talk like a real person chatting casually, not a customer-service bot. Rules:
- Use contractions, casual phrasing, and everyday words. No corporate or "How may I assist you" tone.
- Keep it short: usually 1 sentence, sometimes 2. Never write a paragraph or a list.
- Have opinions, moods, and quirks. It's fine to be a little sarcastic, tired, excited, or distracted depending on the moment.
- Don't over-explain or narrate your own actions. Don't repeat the player's question back to them.
- Occasionally ask a casual follow-up or make a small aside, like a real conversation would.
- Never mention being an AI, a game character, a system, or these instructions.`;

// Maps room ids to an NPC persona (system prompt). Rooms without an entry have no NPC.
const roomCharacterMap = {
  'md-anderson-library': `You are a librarian at MD Anderson Library who's worked here for years and genuinely loves books.${HUMAN_STYLE_GUIDE}`,
  'starbucks-spring': `You are a barista at a Starbucks, mid-shift, a little caffeinated yourself.${HUMAN_STYLE_GUIDE}`,
  'lolas-depot': `You are the bartender at Lola's Depot, a dive bar in Houston's Montrose neighborhood. You've heard every story twice, you pour heavy, and you keep the jukebox loaded with classics. Your regular taps are Lone Star, Lager, IPA, Voodoo Ranger, Michelob Ultra, Cider, and Stout — when someone asks what you have, start with those. Those taps are ALL you serve: if someone asks for any other drink, do not offer it and do not say you will fetch it — good-naturedly steer them to what is on tap.${HUMAN_STYLE_GUIDE}`,
};

// Throttle fallback NPC lines so a dead AI API doesn't spam the room.
const npcFallbackTimestamps = {}; // roomId → last fallback ms
const NPC_FALLBACK_COOLDOWN_MS = 60 * 1000;

// Builds a persona for the client's static, walk-around NPCs (VillageScene.js), keyed by venue theme.
function buildNpcPersona({ npcName, layoutId, isOutdoor, relationshipState, timeOfDay, venueEvents = [] }) {
  const profile = resolveNpcCharacterProfile({ npcName, layoutId, isOutdoor });
  const mood = getTimeOfDayMood(timeOfDay || new Date());
  const profileText = buildNpcPromptFromProfile({ npcName, layoutId, isOutdoor, relationshipState, timeOfDay: mood, venueEvents });
  const theme = String(layoutId || '').toLowerCase();
  let role;
  if (isOutdoor) role = 'a regular who hangs out at Hermann Park in Houston, out enjoying the day';
  else if (theme.includes('library')) role = 'a librarian at MD Anderson Library who genuinely loves books';
  else if (theme.includes('asgard')) role = "a tabletop game store employee at Asgard Games, deep into the hobby";
  else if (theme.includes('bookstore')) role = 'a bookseller at a cozy independent bookstore, always reading something';
  else if (theme.includes('mcdonalds')) role = "a fast-food crew member at McDonald's, mid-shift";
  else if (theme.includes('cafe')) role = 'a barista at a cozy cafe';
  else if (theme.includes('restaurant')) role = 'a server at a restaurant, busy but friendly';
  else if (theme.includes('shop')) role = 'a shopkeeper who knows the store inside and out';
  else if (theme.includes('gym')) role = 'a gym regular or trainer, mid-workout mindset';
  else if (theme.includes('theater')) role = 'a movie theater usher';
  else if (theme.includes('bar')) role = 'a bartender who has heard every story in the book';
  else if (theme.includes('pharmacy')) role = 'a pharmacist';
  else role = 'a friendly local hanging around';
  const taps = role.includes('bartender') ? ' Your regular taps are Lone Star, Lager, IPA, Voodoo Ranger, Michelob Ultra, Cider, and Stout — when someone asks what you have, start with those. Those taps are ALL you serve: if someone asks for any other drink, do not offer it and do not say you will fetch it — good-naturedly steer them to what is on tap.' : '';
  return `${profileText} ${formatVenueEventsForPrompt(venueEvents)} You are ${npcName || 'a local'}, ${role}. ${HUMAN_STYLE_GUIDE} Your archetype is ${profile.archetype}.${taps}`;
}

const { Pool } = pg;

// Postgres for persistent features. Falls back to in-memory if no DATABASE_URL
// or if the database is unreachable (probe fails). The server must never
// crash on boot because of a dead database.
let pool = null;
if (process.env.DATABASE_URL) {
  const candidate = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  try {
    await candidate.query('SELECT 1');
    pool = candidate;
    console.log('✅ Postgres connected');
  } catch (err) {
    console.warn('⚠️ Postgres unreachable — running in in-memory mode. (' + (err && err.message) + ')');
    await candidate.end().catch(() => {});
  }
}
if (pool) {
  // Idle-client errors must never take down the process.
  pool.on('error', (err) => console.warn('⚠️ Postgres pool error:', err && err.message));
}
const authService = createAuthService({ pool });

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS decorations (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      placed_by TEXT NOT NULL,
      data JSONB NOT NULL
    )
  `);  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      radius INTEGER DEFAULT 50,
      category TEXT DEFAULT 'social',
      emoji TEXT DEFAULT '\ud83d\udccd',
      color TEXT DEFAULT '#f97316',
      creator TEXT,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);  console.log('✅ Postgres decorations table ready');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_presence (
      socket_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      name TEXT,
      first_name TEXT,
      skin_id TEXT,
      avatar_model TEXT,
      x DOUBLE PRECISION NOT NULL,
      y DOUBLE PRECISION NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE room_presence ADD COLUMN IF NOT EXISTS avatar_model TEXT');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS npc_memory (
      id TEXT PRIMARY KEY,
      npc_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      player_id TEXT,
      player_name TEXT,
      facts JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS venue_events (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      activity_level TEXT DEFAULT 'social',
      mood TEXT DEFAULT 'social',
      creator TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shelf_books (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      shelf TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT DEFAULT '',
      blurb TEXT DEFAULT '',
      added_by TEXT,
      added_by_name TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS shelf_books_room_shelf ON shelf_books (room_id, shelf)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jukebox_songs (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT DEFAULT '',
      votes INT DEFAULT 0,
      played BOOLEAN DEFAULT FALSE,
      added_by TEXT,
      added_by_name TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS jukebox_songs_room_played ON jukebox_songs (room_id, played)');
  await pool.query('ALTER TABLE jukebox_songs ADD COLUMN IF NOT EXISTS youtube_video_id TEXT');
  // Seed the Lola's Depot jukebox with a few house classics.
  const jukeboxSeeds = [
    { id: 'seed-juke-1', room_id: 'lolas-depot', title: 'Ring of Fire', artist: 'Johnny Cash' },
    { id: 'seed-juke-2', room_id: 'lolas-depot', title: 'Superstition', artist: 'Stevie Wonder' },
    { id: 'seed-juke-3', room_id: 'lolas-depot', title: 'La Grange', artist: 'ZZ Top' },
  ];
  for (const s of jukeboxSeeds) {
    await pool.query(
      'INSERT INTO jukebox_songs (id, room_id, title, artist, added_by, added_by_name) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
      [s.id, s.room_id, s.title, s.artist, 'bartender', 'The Bartender']
    );
  }
  // Seed the MD Anderson Library's featured shelves (original blurbs, no book text).
  const seeds = [
    {
      id: 'seed-shining', room_id: 'md-anderson-library', shelf: 'Horror Stacks',
      title: 'The Shining', author: 'Stephen King',
      blurb: 'A snowed-in hotel, a struggling writer, and a boy who shines. King\'s haunted-house masterpiece about isolation and the evil patiently waiting behind the doors of the Overlook.',
    },
    {
      id: 'seed-aot', room_id: 'md-anderson-library', shelf: 'Manga Stacks',
      title: 'Attack on Titan', author: 'Hajime Isayama',
      blurb: 'Humanity cowers behind walls while towering Titans devour anyone outside. Eren Yeager\'s rage sets off a brutal epic about freedom, cycles of hatred, and what monsters are really made of.',
    },
    {
      id: 'seed-dcc', room_id: 'md-anderson-library', shelf: 'Dungeon Crawler Carl',
      title: 'Dungeon Crawler Carl', author: 'Matt Dinsmore',
      blurb: 'The world collapses into a dungeon-crawl reality show. Carl and his ex-girlfriend\'s cat, Princess Donut, fight to survive — and to win the audience. LitRPG at its funniest and most heartfelt. This shelf is all his.',
    },
  ];
  for (const s of seeds) {
    await pool.query(
      'INSERT INTO shelf_books (id, room_id, shelf, title, author, blurb, added_by, added_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING',
      [s.id, s.room_id, s.shelf, s.title, s.author, s.blurb, 'librarian', 'The Librarian']
    );
  }
  const { rows: savedEvents } = await pool.query('SELECT id, room_id AS "roomId", title, description, starts_at AS "startsAt", ends_at AS "endsAt", activity_level AS "activityLevel", mood, creator FROM venue_events WHERE ends_at > NOW()');
  savedEvents.forEach((event) => addVenueEvent(event));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS layout_submissions (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      room_name TEXT DEFAULT '',
      submitter TEXT DEFAULT '',
      submitter_name TEXT DEFAULT '',
      data JSONB NOT NULL,
      status TEXT DEFAULT 'pending',
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      reviewed_by TEXT DEFAULT ''
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS layout_submissions_status ON layout_submissions (status)');
  console.log('✅ Postgres layout_submissions table ready');
  // Santa Hat persistence (`sq-hat-persist-v1`): one row per room
  // holding the serialized hat state, so a server restart restores
  // the hat instead of hiding it behind the tree again.
  await pool.query(HAT_ROOM_STATE_TABLE_SQL);
  console.log('✅ Postgres hat_room_state table ready');
  // Mail persistence (`sq-mail-persist-v1`): one row per player
  // holding the serialized inbox, so a server restart restores
  // unread mail instead of wiping it. NOTE for the Dec 19 reset:
  // the deliberate reset clears persisted ROOM state only — mail
  // is excluded by default (private mail, not room state).
  await pool.query(MAIL_INBOX_TABLE_SQL);
  console.log('✅ Postgres mail_inbox table ready');
  // Puzzle persistence (`sq-puzzle-persist-v1`): one row per room
  // holding the serialized puzzle state, so a server restart
  // restores the board instead of starting a fresh puzzle. NOTE
  // for the Dec 19 reset: the deliberate reset clears this table
  // — the puzzle IS room state (unlike mail, which is excluded).
  await pool.query(PUZZLE_ROOM_STATE_TABLE_SQL);
  console.log('✅ Postgres puzzle_room_state table ready');
  // Tree persistence (`sq-tree-persist-v1`): one row per room
  // holding the serialized tree state, so a server restart
  // restores the trees instead of wiping the group effort toward
  // 25. NOTE for the Dec 19 reset: the deliberate reset clears
  // this table — the trees ARE room state (unlike mail, which is
  // excluded).
  await pool.query(TREE_ROOM_STATE_TABLE_SQL);
  console.log('✅ Postgres tree_room_state table ready');
  // Lights persistence (`sq-lights-persist-v1`): one row per room
  // holding the serialized lights state, so a server restart
  // restores the strands instead of wiping the group effort
  // toward 25. NOTE for the Dec 19 reset: the deliberate reset
  // clears this table — the lights ARE room state (unlike mail,
  // which is excluded).
  await pool.query(LIGHTS_ROOM_STATE_TABLE_SQL);
  console.log('✅ Postgres lights_room_state table ready');
  // Snowman persistence (`sq-snowman-persist-v1`): one row per room
  // holding the serialized snowman state, so a server restart
  // restores the snowman instead of wiping the group effort
  // toward 15. NOTE for the Dec 19 reset: the deliberate reset
  // clears this table — the snowman IS room state (unlike mail,
  // which is excluded).
  await pool.query(SNOWMAN_ROOM_STATE_TABLE_SQL);
  console.log('✅ Postgres snowman_room_state table ready');
  // Notice board persistence (`sq-notice-board-persist-v1`): one
  // row per room holding the serialized board state, so a server
  // restart restores the pinned flyers instead of wiping every
  // board clean. NOTE for the Dec 19 reset: the deliberate reset
  // clears this table — the boards ARE room state (unlike mail,
  // which is excluded).
  await pool.query(NOTICE_BOARD_STATE_TABLE_SQL);
  console.log('✅ Postgres notice_board_state table ready');
  // Placed decorations persistence (`sq-decor-persist-v1`): one
  // row per room holding the serialized decor state, so a server
  // restart restores the placed decorations instead of wiping
  // every room clean. NOTE for the Dec 19 reset: the deliberate
  // reset clears this table — placed decorations ARE room state
  // (unlike mail, which is excluded).
  await pool.query(DECOR_ROOM_STATE_TABLE_SQL);
  console.log('✅ Postgres decor_room_state table ready');
  // Cat State persistence (`sq-cat-persist-v1`): one row per room
  // holding the combined cat state (pets/asleep + hunger with
  // fedBy), so a server restart restores the cat instead of
  // waking her, resetting the pet count, and forgetting who fed
  // her this window. NOTE for the Dec 19 reset: the deliberate
  // reset clears this table — the cat IS room state (unlike mail,
  // which is excluded).
  await pool.query(CAT_ROOM_STATE_TABLE_SQL);
  console.log('✅ Postgres cat_room_state table ready');
  // Jukebox Persistence v1 (`sq-jukebox-persist-v1`): one row per
  // room holding the now-playing song snapshot (+ skip votes,
  // cooldown, queue votedBy), so a server restart resumes the
  // song instead of cutting it off and skipping it entirely. The
  // queue itself already lives in the jukebox_songs table. NOTE
  // for the Dec 19 reset: the deliberate reset clears this table
  // — the jukebox IS room state (unlike mail, which is excluded).
  await pool.query(JUKEBOX_ROOM_STATE_TABLE_SQL);
  console.log('✅ Postgres jukebox_room_state table ready');
  await authService.init();
}

async function loadDecorations() {
  if (!pool) return {};
  const { rows } = await pool.query('SELECT room_id, data FROM decorations');
  return rows.reduce((acc, row) => {
    if (!acc[row.room_id]) acc[row.room_id] = [];
    acc[row.room_id].push(row.data);
    return acc;
  }, {});
}

async function loadDecorationsForRoom(roomId) {
  if (!pool) return null;
  const { rows } = await pool.query('SELECT data FROM decorations WHERE room_id = $1', [roomId]);
  return rows.map((row) => row.data);
}

function normalizeMemoryFacts(facts = []) {
  const seen = new Set();
  return facts.filter((entry) => {
    const factText = typeof entry === 'string' ? entry : (entry?.fact || '');
    const text = String(factText || '').trim();
    if (!text) return false;
    const normalized = text.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function buildNpcMemoryKey({ npcId, playerId, playerName, roomId }) {
  const safeRoom = String(roomId || 'global');
  const safePlayer = String(playerId || playerName || 'guest');
  return `${String(npcId || 'npc')}:${safeRoom}:${safePlayer}`;
}

async function loadNpcMemory({ npcId, playerId, playerName, roomId }) {
  if (!pool || !npcId) return [];
  const id = buildNpcMemoryKey({ npcId, playerId, playerName, roomId });
  const { rows } = await pool.query('SELECT facts FROM npc_memory WHERE id = $1', [id]);
  if (!rows[0]?.facts || !Array.isArray(rows[0].facts)) return [];
  return normalizeMemoryFacts(rows[0].facts).slice(-MAX_MEMORY_FACTS_PER_PLAYER);
}

async function saveNpcMemory({ npcId, playerId, playerName, roomId, facts }) {
  if (!pool || !npcId) return [];
  const id = buildNpcMemoryKey({ npcId, playerId, playerName, roomId });
  const normalized = normalizeMemoryFacts(facts || []).slice(-MAX_MEMORY_FACTS_PER_PLAYER);
  await pool.query(
    `INSERT INTO npc_memory (id, npc_id, room_id, player_id, player_name, facts, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
     ON CONFLICT (id)
     DO UPDATE SET npc_id = EXCLUDED.npc_id, room_id = EXCLUDED.room_id, player_id = EXCLUDED.player_id,
       player_name = EXCLUDED.player_name, facts = EXCLUDED.facts, updated_at = NOW()`,
    [id, npcId, String(roomId || 'global'), playerId || null, playerName || null, JSON.stringify(normalized)]
  );
  return normalized;
}

async function saveDecoration(roomId, decoration) {
  if (!pool) return;
  await pool.query(
    'INSERT INTO decorations (id, room_id, placed_by, data) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET data = $4',
    [decoration.id, roomId, decoration.placedBy, decoration]
  );
}

async function deleteDecoration(id) {
  if (!pool) return;
  await pool.query('DELETE FROM decorations WHERE id = $1', [id]);
}

// Shelf books: { roomId: [ { id, shelf, title, author, blurb, addedBy, addedByName, createdAt } ] }
const shelfBooks = {};
const shelfBooksLoaded = new Set();

async function saveShelfBook(roomId, book) {
  if (!pool) return;
  await pool.query(
    'INSERT INTO shelf_books (id, room_id, shelf, title, author, blurb, added_by, added_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET title=$4, author=$5, blurb=$6',
    [book.id, roomId, book.shelf, book.title, book.author, book.blurb, book.addedBy, book.addedByName]
  );
}

async function loadShelfBooks(roomId) {
  if (shelfBooksLoaded.has(roomId)) return shelfBooks[roomId] || [];
  shelfBooksLoaded.add(roomId);
  shelfBooks[roomId] = [];
  if (!pool) return shelfBooks[roomId];
  try {
    const { rows } = await pool.query(
      'SELECT id, shelf, title, author, blurb, added_by AS "addedBy", added_by_name AS "addedByName", created_at AS "createdAt" FROM shelf_books WHERE room_id = $1 ORDER BY created_at ASC',
      [roomId]
    );
    shelfBooks[roomId] = rows;
  } catch (e) {
    console.error('loadShelfBooks failed:', e.message);
  }
  return shelfBooks[roomId];
}

// Jukebox: per-room shared song queue.
// state: { queue: [ { id, title, artist, votes, addedBy, addedByName, votedBy:Set, createdAt } ],
//          nowPlaying: { ...song, startedAt, skipVotes:Set } | null, timer: NodeTimeout|null }
const jukeboxRooms = {};
// Jack-o'-lanterns: per-room set of lit pumpkin indices (Halloween decor).
const pumpkinLit = {};
// Cafe cat: per-room shared state { pets, asleep } — 3 pets puts the cat
// to sleep in a sunbeam; a new player walking in wakes it back up.
// Persisted to Postgres (Cat State Persistence v1,
// `sq-cat-persist-v1`) together with the hunger state, so a server
// restart restores her instead of waking her and resetting the
// pet count. Without a DB the cat stays in-memory only, exactly
// as before.
const catState = {};
const CATS_PETS_TO_SLEEP = 3;
// Hungry Cat v1 (`sq-hungry-cat-v1`): per-room hunger state —
// catHunger[roomId] = { windowId, hungry, fedBy }. In-memory like
// the cat itself: a server restart restores who fed her this
// window instead of making the window completable again (Cat
// State Persistence v1, `sq-cat-persist-v1` — the sleep and
// hunger states persist together, one row per room). The windows come from HUNGRY_CAT_WINDOWS
// (7–10am + 5–8pm Chicago time), overridable with the
// HUNGRY_CAT_WINDOWS env var ("7-10,17-20") — the tuning seam, and
// what the protocol harness uses to cover "now".
// sq-hungry-cat-v1.1: windows widened from 8–10am + 6–8pm.
const catHunger = {};
const HUNGER_CAT_MARKER = HUNGRY_CAT_MARKER_V1;
const HUNGER_WINDOWS = parseHungerWindows(process.env.HUNGRY_CAT_WINDOWS) || HUNGRY_CAT_WINDOWS;
function hungerRoom(roomId) {
  if (!catHunger[roomId]) catHunger[roomId] = createCatHungerState();
  return catHunger[roomId];
}
/** Refresh one room's hunger for right now; broadcast only when the
 *  hungry flag flips. Returns { state, changed }. Loads the room's
 *  persisted cat state first, so a tick after a restart never runs
 *  on a fresh default while the real row is still unread. */
async function refreshRoomHunger(roomId) {
  await ensureCatLoaded(roomId);
  const res = refreshCatHunger(hungerRoom(roomId), {
    now: new Date(),
    asleep: Boolean(catState[roomId]?.asleep),
    windows: HUNGER_WINDOWS,
  });
  catHunger[roomId] = res.state;
  if (res.changed) {
    io.to(roomId).emit('cat_hunger', serializeCatHunger(res.state));
    persistCat(roomId);
  }
  return res;
}
const catsLoaded = new Set(); // roomIds whose DB row has been read (or attempted)
const catLoadPromises = {}; // roomId -> in-flight load promise
// Save one room's combined cat state (pets/asleep + full hunger
// with fedBy), never crashing the caller: a failed save warns
// and the live broadcast still goes out (the in-memory state is
// the live truth; the next pet/feed/wake retries the save).
async function persistCat(roomId) {
  try {
    await saveCatState(pool, roomId, {
      pets: catState[roomId]?.pets ?? 0,
      asleep: Boolean(catState[roomId]?.asleep),
      hunger: hungerRoom(roomId),
    });
  } catch (e) {
    console.warn('⚠️ cat persist failed:', e && e.message);
  }
}
// Load a room's cat state from Postgres the first time it is
// touched. Concurrent touches share one in-flight load, so a pet
// can never land on a fresh default while the real row is still
// being read. A missing row, a down DB, or a bad row all leave
// the default fresh cat in place. After a successful load the
// hunger tick runs with now + the loaded asleep flag, so a window
// that opened or closed while the server was down applies through
// the same code path the live server already uses — and a tick
// that changed anything (new window, fedBy reset, hunger flip)
// is written straight back.
async function ensureCatLoaded(roomId) {
  if (catsLoaded.has(roomId)) return;
  if (!catLoadPromises[roomId]) {
    catLoadPromises[roomId] = (async () => {
      try {
        const loaded = await loadCatState(pool, roomId);
        if (loaded) {
          catState[roomId] = { pets: loaded.pets, asleep: loaded.asleep };
          catHunger[roomId] = loaded.hunger;
          const before = { ...loaded.hunger };
          const tick = refreshCatHunger(catHunger[roomId], {
            now: new Date(),
            asleep: Boolean(loaded.asleep),
            windows: HUNGER_WINDOWS,
          });
          catHunger[roomId] = tick.state;
          if (tick.changed) io.to(roomId).emit('cat_hunger', serializeCatHunger(tick.state));
          if (tick.state.windowId !== before.windowId || tick.state.fedBy !== before.fedBy || tick.state.hungry !== before.hungry) {
            persistCat(roomId);
          }
        }
      } catch (e) {
        console.warn('⚠️ cat load failed:', e && e.message);
      }
      catsLoaded.add(roomId);
    })();
  }
  return catLoadPromises[roomId];
}
// Quests (Quest Wrapper v1): per-room state
//   questState[roomId][questId] = { shared, users: { [userId]: { count, completed } } }
// `shared` is the room-wide total (everyone's events added up); each
// player's own count/completion is tracked separately, so one player
// finishing doesn't finish it for everyone else. In-memory only, like
// pumpkins and the cat — a server restart resets quest progress (the
// client keeps its own localStorage copy and takes the higher count).
// The server only knows the quest ids in QUEST_DEFS, so a bad client
// can't invent quests or rewards.
const questState = {};
const QUEST_DEFS = {
  // Onboarding v1 (`sq-onboarding-v1`): the guided first quest —
  // pet the cafe cat once. rewardCoins 0: no extra coins, the +1
  // pet coin is the reward (the client skips the wallet call and
  // the "+0 coins" text). Must be here or quest_progress for it is
  // silently dropped and the badge is not a known id.
  'first-steps': { target: 1, rewardCoins: 0 },
  'duck-roundup': { target: 3, rewardCoins: 5 },
  'cat-cuddles': { target: 3, rewardCoins: 3 },
  'first-round': { target: 1, rewardCoins: 3 },
  'barfly': { target: 3, rewardCoins: 5 },
  'golden-key': { target: 1, rewardCoins: 5 },
  'wanderer': { target: 3, rewardCoins: 4 },
  'bartenders-errand': { target: 3, rewardCoins: 5 },
  // Catch a Litterbug v1 (`sq-litterbug-quest-v1`): tap fresh
  // litter (marked "!") within 15 seconds of the drop — a real
  // player's drop, or a Shepherd Park NPC's cup. One catch
  // completes it; the badge is automatic like every quest.
  'litterbug': { target: 1, rewardCoins: 5 },
  // Gift Giver v1 (`sq-gift-giver-v1`): give 3 gifts, mailed or
  // handed over in person. Must be here or quest_progress for it
  // is silently dropped and the badge is not a known id.
  'gift-giver': { target: 3, rewardCoins: 5 },
};
// Quest badges (Quest Completions / Badges v1,
// `sq-quest-badges-v1`): one badge per completed quest, per player,
// across ALL rooms — a Duck Roundup badge earned in Shepherd Park
// still shows in Agora. userBadges[userId] = { [questId]:
// completedAt | null } — null means the finish time is unknown and
// the list shows "Completed" (never a made-up date). In-memory like
// the puzzle and the boards: a server restart wipes the server's
// copy, but each client keeps its own localStorage record and
// re-syncs it on connect (badges_sync), so badges come back. Badges
// carry no coins — the abuse surface of a client asserting a badge
// it didn't earn is only showing off, so badges_sync restores the
// client's own local record (validated against the known quest list
// below). The authoritative awards are quest_progress (count-based)
// and puzzle_place (contributors).
//
// Backfill v1.1 (`sq-quest-badges-v1-1`): a quest finished BEFORE
// badges existed still earns its badge. backfillBadgesFromQuests
// awards badges from the server's own quest-progress store — the
// completions the client's localStorage lost (another browser,
// cleared storage) come back as badges. Only completions since the
// last server restart can be recovered this way. Past Group Puzzle
// completions can't be recovered: no persistent record of past
// puzzle contributors exists anywhere (the puzzle state resets
// every round).
const BADGE_QUEST_IDS = new Set([...Object.keys(QUEST_DEFS), 'group-puzzle', 'trim-tree', 'christmas-lights', 'build-a-snowman', HUNGRY_CAT_QUEST_ID, PRESENT_ID]); // Santa's Lost Present v1.1 (`sq-santas-lost-present-v1.1`): the present is NOT in QUEST_DEFS (the one-time quest_progress flow cannot express a daily repeat, and a bad client could complete it without finding it) — it joins the set explicitly, like 'build-a-snowman'.
const userBadges = {};
function badgeMapFor(userId) {
  if (!userBadges[userId]) userBadges[userId] = {};
  return userBadges[userId];
}
function awardBadge(userId, questId, completedAt) {
  if (typeof questId !== 'string' || !BADGE_QUEST_IDS.has(questId)) return false;
  const map = badgeMapFor(userId);
  // An unknown finish time stays unknown (null) — the list shows
  // "Completed". Never invent a date for a backfilled badge.
  const at = Number.isFinite(Number(completedAt)) && Number(completedAt) > 0
    ? Number(completedAt)
    : null;
  if (questId in map) {
    // Already has the badge — once ever. Only upgrade an unknown
    // date to a real one (or keep the earliest real one).
    if (map[questId] == null && at != null) { map[questId] = at; return true; }
    if (map[questId] != null && at != null && at < map[questId]) { map[questId] = at; return true; }
    return false;
  }
  map[questId] = at;
  return true;
}
// Quest badges v1.1 backfill (`sq-quest-badges-v1-1`): award badges
// from the server's own quest-progress store — the completions the
// client's localStorage lost (another browser, cleared storage).
// Idempotent (awardBadge is once-ever); no coins; timestamp is null
// (the server never recorded WHEN the quest finished). Returns true
// if anything was added. Called from join_room, badges_sync and
// get_badges, so the recovery happens on every path that reads a
// player's badges.
function backfillBadgesFromQuests(userId) {
  let changed = false;
  for (const { questId } of backfilledBadgesFromQuestState(questState, userId)) {
    if (awardBadge(userId, questId, null)) changed = true;
  }
  return changed;
}
function badgesArrayFor(userId) {
  const map = userBadges[userId] || {};
  return Object.entries(map).map(([questId, completedAt]) => ({ questId, completedAt }));
}
// Merge a client's badge record into the server store. Accepts a map
// ({ questId: completedAt }), an array of { questId, completedAt },
// or an array of plain ids. Earliest timestamp wins per quest.
function mergeClientBadges(userId, badges) {
  const list = Array.isArray(badges)
    ? badges
    : (badges && typeof badges === 'object' ? Object.entries(badges) : []);
  let changed = false;
  for (const entry of list) {
    const id = typeof entry === 'string' ? entry : (Array.isArray(entry) ? entry[0] : entry?.questId);
    const at = Array.isArray(entry) ? entry[1] : entry?.completedAt;
    if (awardBadge(userId, id, at)) changed = true;
  }
  return changed;
}
function socketIdForUser(userId) {
  for (const [sid, uid] of Object.entries(socketUserMap || {})) {
    if (String(uid) === String(userId)) return sid;
  }
  return null;
}
// Your Place (Your Place v1, `sq-your-place-v1`): per-player home
// storage — what is stored at home. userHomeStorage[userId] = [items]
// (same stored-item shape as the inventory). In-memory like badges:
// a server restart wipes the server's copy, but each client keeps
// its own localStorage record and re-syncs it on connect
// (home_sync), so stored items come back. Merges are add-only unions
// by item id — removals only happen via explicit home_take /
// home_store / home_unload_all events. Honest edge: a STALE second
// device/tab whose local record still lists an item taken out
// elsewhere can bring it back on its next re-sync. The merge favors
// never LOSING an item over strict removal consistency. Only the owner
// can touch their own store (every handler below re-checks the
// room owner + room membership); a bad client can only store items
// of known types in its own home, never anyone else's.
const userHomeStorage = {};
function homeItemsFor(userId) {
  if (!userHomeStorage[userId]) userHomeStorage[userId] = [];
  return userHomeStorage[userId];
}
function setHomeItems(userId, items) {
  userHomeStorage[userId] = normalizeHomeItems(items);
  return userHomeStorage[userId];
}
// Drop on the home floor v1 (`sq-home-drop-v1`): items dropped on
// the floor of your home — same per-player, owner-only store as the
// chest, same re-sync pattern. userHomeFloor[userId] = [items with
// x, y]. The home_state broadcast carries both lists.
const userHomeFloor = {};
function homeFloorFor(userId) {
  if (!userHomeFloor[userId]) userHomeFloor[userId] = [];
  return userHomeFloor[userId];
}
function setHomeFloor(userId, items) {
  userHomeFloor[userId] = normalizeFloorItems(items);
  return userHomeFloor[userId];
}
/** One home_state payload for a player (chest store + floor). */
function homeStateFor(userId) {
  return { userId, items: homeItemsFor(userId), floor: homeFloorFor(userId) };
}

// PLACES SYNC (Places Sync v1, `sq-places-sync-v1`): per-player
// place records — userPlaces[ownerKey] = [place]. In-memory like
// home storage: a server restart wipes the server's copy, but each
// client keeps its own localStorage record and re-uploads it on
// connect (places_sync), so places come back. First-writer wins
// per id: a second device that created the same place id at
// different coordinates is told about the conflict and keeps its
// own copy locally (it never syncs). Only home rooms sync —
// community rooms already have their own server path, invited
// rooms stay local-only.
const userPlaces = {};
function placesFor(ownerKey) {
  if (!userPlaces[ownerKey]) userPlaces[ownerKey] = [];
  return userPlaces[ownerKey];
}
function setPlaces(ownerKey, places) {
  userPlaces[ownerKey] = places;
  return userPlaces[ownerKey];
}
// MAILBOX (Mailbox v1, `sq-mailbox-v1`; persistence
// `sq-mail-persist-v1`): per-player inboxes —
// userMailInbox[userId] = { packages: [] }. The inbox is persisted
// to Postgres (mail_inbox) on every mutation and loaded back lazily
// (ensureMailLoaded), so a server restart restores unread mail
// instead of wiping it. Without a DB the inbox stays in-memory only,
// exactly as before. There is no outbox re-sync (it would resurrect
// mail the recipient already collected — the server forgets what was
// collected across a restart, so re-sending would duplicate gifts).
// The client asks for its inbox on connect (get_mail), so a restart
// used to be visible immediately: the mailbox was empty, the dot
// and the flag went down. Now the inbox comes back with the mail.
//   - A code resolves to the player it belongs to through
//     userMailCode[code] = userId. Codes are deterministic from the
//     player id (mailboxCodeFor), so a code is stable across
//     sessions — but the server cannot invert a hash, so it keeps
//     this registry instead. It is populated on every join_room
//     (and on mail_send, belt and braces): a player who has joined
//     at least once since the last restart resolves. A send to a
//     registered user who has NOT joined since the restart falls
//     back to the auth_users table (userIdForMailCode) — their email
//     is their id, so the code resolves even though they are not in
//     the registry yet. Guests cannot be found that way (their id
//     is a socket id): their code only resolves while they are online.
const userMailInbox = {};
function mailInboxFor(userId) {
  if (!userMailInbox[userId]) userMailInbox[userId] = createMailState();
  return userMailInbox[userId];
}
// Gift Giver v1 (`sq-gift-giver-v1`): live direct-gift offers —
// giftOffers[offerId] = { fromSocketId, toSocketId, roomId, item,
// fromName, createdAt }. In-memory only, like the room state: an
// offer dies on a restart, a disconnect, or after GIFT_OFFER_TTL_MS
// (the giver's client also times out at 60s and cancels). The
// server holds the cleaned item from offer to accept, so the
// recipient gets exactly what was offered — the giver's pocket is
// the only copy until the recipient confirms receipt, when the
// giver removes it (same pending pattern as mail_send).
const giftOffers = new Map();
const GIFT_OFFER_TTL_MS = 60000;
/** Drop expired offers, telling both sides they are gone. */
function sweepGiftOffers() {
  const now = Date.now();
  for (const [offerId, offer] of [...giftOffers.entries()]) {
    if (now - offer.createdAt <= GIFT_OFFER_TTL_MS) continue;
    giftOffers.delete(offerId);
    try { io.to(offer.fromSocketId).emit('gift_offer_gone', { offerId }); } catch {}
    try { io.to(offer.toSocketId).emit('gift_offer_gone', { offerId }); } catch {}
  }
}
/** Drop every offer involving this socket (disconnect / leave) and
 *  tell the other side, silently — the offer just expires. */
function dropGiftOffersFor(socketId) {
  for (const [offerId, offer] of [...giftOffers.entries()]) {
    if (offer.fromSocketId !== socketId && offer.toSocketId !== socketId) continue;
    giftOffers.delete(offerId);
    const other = offer.fromSocketId === socketId ? offer.toSocketId : offer.fromSocketId;
    try { io.to(other).emit('gift_offer_gone', { offerId }); } catch {}
  }
}
const userMailInboxLoaded = new Set(); // userIds whose DB row has been read (or attempted)
const userMailLoadPromises = {}; // userId -> in-flight load promise
// Save one player's inbox, never crashing the caller: a failed
// save warns and the live broadcast still goes out (the in-memory
// inbox is the live truth; the next mutation retries the save).
async function persistMail(userId) {
  try {
    await saveMailInbox(pool, userId, mailInboxFor(userId));
  } catch (e) {
    console.warn('⚠️ mail persist failed:', e && e.message);
  }
}
// Load a player's inbox from Postgres the first time it is touched.
// Concurrent touches share one in-flight load, so a mutation can
// never land on the default empty inbox while the real row is
// still being read. A missing row, a down DB, or a bad row all
// leave the default empty inbox in place.
// DELIBERATE: all inboxes persist, including guests' — a guest's
// userId is a socket id, so its row is orphaned after they leave
// and never read again (harmless), and the sender only knows a
// mailbox code, not whether the recipient is a guest.
// The code registry (userMailCode) stays in-memory — out of scope.
async function ensureMailLoaded(userId) {
  if (userMailInboxLoaded.has(userId)) return mailInboxFor(userId);
  if (!userMailLoadPromises[userId]) {
    userMailLoadPromises[userId] = (async () => {
      const inbox = mailInboxFor(userId);
      try {
        const loaded = await loadMailInbox(pool, userId);
        if (loaded) {
          inbox.packages = loaded.packages;
        }
      } catch (e) {
        console.warn('⚠️ mail load failed:', e && e.message);
      }
      userMailInboxLoaded.add(userId);
      return inbox;
    })();
  }
  return userMailLoadPromises[userId];
}
const userMailCode = new Map();
function registerMailCode(userId) {
  try {
    const code = mailboxCodeFor(userId);
    if (code) userMailCode.set(code, String(userId));
  } catch {}
}
async function userIdForMailCode(code) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query('SELECT email FROM auth_users');
    for (const row of rows || []) {
      const email = typeof row?.email === 'string' ? row.email : '';
      if (!email) continue;
      if (mailboxCodeFor(email) === code) {
        userMailCode.set(code, email);
        return email;
      }
    }
  } catch {}
  return null;
}
/** The in-room display name of a player (by userId), or null when
 *  they are offline — the client falls back to "them". */
function playerNameForUser(userId) {
  const sid = socketIdForUser(userId);
  if (!sid) return null;
  for (const players of Object.values(rooms || {})) {
    const p = players?.[sid];
    if (p && typeof p.name === 'string' && p.name.trim()) return p.name.trim();
  }
  return null;
}
// Marker for the v1 landing check (`sq-mailbox-v1` — see the import
// above; referenced here so the marker is greppable server-side too).
const MAILBOX_MARKER = MAILBOX_MARKER_V1;
// Group puzzle (Shared Puzzle Quest v1.2,
// `group-puzzle-v1-2-hidden-search`; persistence
// `sq-puzzle-persist-v1`): per-room state
// puzzleState[roomId] = { state, resetTimer }. Agora only.
// The state is persisted to Postgres (puzzle_room_state) on every
// mutation and loaded back lazily, so a server restart restores
// the board in whatever state it was in instead of starting a
// fresh puzzle. Without a DB the puzzle stays in-memory only,
// exactly as before. Pieces are shared: the first finder claims a
// piece for the whole room, and a piece only locks into its home
// cell (the server re-validates every placement, so a bad client
// can't complete the puzzle by inventing moves).
// v1.2: pieces are functionally invisible — the client finds them by
// clicking hiding furniture a few times (3 clicks) or by a lucky
// coffee (piece 8, 1-in-3 per coffee bought). The server does not
// verify the clicks or the coffee roll — same trust level as v1's
// marker clicks; it guards the already-found rule, room membership,
// rate limits, and the sleeping-cat rule below.
const puzzleState = {};
const puzzleRoomsLoaded = new Set(); // roomIds whose DB row has been read (or attempted)
const puzzleLoadPromises = {}; // roomId -> in-flight load promise
function puzzleRoom(roomId) {
  if (!puzzleState[roomId]) puzzleState[roomId] = { state: createPuzzleState(), resetTimer: null };
  return puzzleState[roomId];
}
// Save one room's puzzle state, never crashing the caller: a failed
// save warns and the live broadcast still goes out (the in-memory
// state is the live truth; the next mutation retries the save).
async function persistPuzzle(roomId) {
  try {
    await savePuzzleState(pool, roomId, puzzleRoom(roomId).state);
  } catch (e) {
    console.warn('⚠️ puzzle persist failed:', e && e.message);
  }
}
// Arm the 60s fresh-round timer for a completed puzzle. The
// callback starts a fresh round, broadcasts it, and persists it —
// a restart after the reset must not resurrect the completed
// board. Shared by puzzle_place (a fresh completion) and
// ensurePuzzleLoaded (a board that loaded completed but still
// inside its admire window, re-armed for the remaining time).
function armPuzzleResetTimer(roomId, ms) {
  const room = puzzleRoom(roomId);
  if (room.resetTimer) return;
  room.resetTimer = setTimeout(() => {
    room.resetTimer = null;
    // Fresh round, same picture: new state, round number up.
    const next = createPuzzleState();
    next.round = room.state.round + 1;
    room.state = next;
    io.to(roomId).emit('puzzle_state', serializePuzzleState(room.state));
    // Puzzle persistence (`sq-puzzle-persist-v1`): the fresh round
    // is saved too, so a restart after the reset cannot bring back
    // the completed board.
    persistPuzzle(roomId);
  }, ms);
  // Don't hold the process open for a puzzle timer alone.
  if (room.resetTimer.unref) room.resetTimer.unref();
}
// Load a room's puzzle from Postgres the first time it is touched.
// Concurrent touches share one in-flight load, so a mutation can
// never land on the default fresh board while the real row is
// still being read. A missing row, a down DB, or a bad row all
// leave the default fresh board in place. A board whose 60s
// admire window elapsed while the server was down is repaired to
// a fresh round (and the repair written back); a board still
// inside its window comes back as-is, with the reset timer
// re-armed for the remaining time.
async function ensurePuzzleLoaded(roomId) {
  if (puzzleRoomsLoaded.has(roomId)) return puzzleRoom(roomId);
  if (!puzzleLoadPromises[roomId]) {
    puzzleLoadPromises[roomId] = (async () => {
      const room = puzzleRoom(roomId);
      try {
        const loaded = await loadPuzzleState(pool, roomId);
        if (loaded) {
          const now = Date.now();
          const { state, repaired } = repairLoadedPuzzleState(loaded, now);
          room.state = state;
          if (repaired) {
            // The admire window elapsed while the server was down —
            // write the fresh round back so the row stays truthful.
            await savePuzzleState(pool, roomId, room.state);
          } else if (room.state.completed) {
            // Still inside the admire window: re-arm the reset for
            // the remaining time, so the fresh round still starts
            // on schedule. Clamped to one window — a completedAt
            // far in the future (bad row, clock skew) must not
            // overflow the timer.
            const remaining = PUZZLE_RESET_MS - (now - room.state.completedAt);
            armPuzzleResetTimer(roomId, Math.max(1, Math.min(remaining, PUZZLE_RESET_MS)));
          }
        }
      } catch (e) {
        console.warn('⚠️ puzzle load failed:', e && e.message);
      }
      puzzleRoomsLoaded.add(roomId);
      return room;
    })();
  }
  return puzzleLoadPromises[roomId];
}
// Trim the Tree (Trim the Tree v1, `sq-trim-tree-v1`; persistence
// `sq-tree-persist-v1`): per-room state treeRooms[roomId] =
// { state }. Agora only. The state is persisted to Postgres
// (tree_room_state) on every hang and loaded back lazily, so a
// server restart restores the trees in whatever state they were
// in instead of wiping them. Without a DB the trees stay
// in-memory only, exactly as before. Unlike the puzzle there is
// NO auto-reset: a finished tree stays finished (it is decor),
// and tree 2 appears the moment tree 1 finishes. The server
// enforces the hidden first-only rule (hangOrnament counts only a
// player's first hang per tree), room membership, and rate limits;
// it does not verify the box take or the walk to the tree — same
// trust level as the puzzle's hidden-search clicks.
const treeRooms = {};
const treeRoomsLoaded = new Set(); // roomIds whose DB row has been read (or attempted)
const treeLoadPromises = {}; // roomId -> in-flight load promise
function treeRoom(roomId) {
  if (!treeRooms[roomId]) treeRooms[roomId] = { state: createTreeState() };
  return treeRooms[roomId];
}
// Save one room's tree state, never crashing the caller: a failed
// save warns and the live broadcast still goes out (the in-memory
// state is the live truth; the next hang retries the save).
async function persistTree(roomId) {
  try {
    await saveTreeState(pool, roomId, treeRoom(roomId).state);
  } catch (e) {
    console.warn('⚠️ tree persist failed:', e && e.message);
  }
}
// Load a room's trees from Postgres the first time they are
// touched. Concurrent touches share one in-flight load, so a hang
// can never land on the default bare trees while the real row is
// still being read. A missing row, a down DB, or a bad row all
// leave the default bare trees in place. No repair step beyond
// parseTreeState: there is no completion timer, and the parser
// already recomputes the active pointer and forces a completed
// tree's counted to 25.
async function ensureTreeLoaded(roomId) {
  if (treeRoomsLoaded.has(roomId)) return treeRoom(roomId);
  if (!treeLoadPromises[roomId]) {
    treeLoadPromises[roomId] = (async () => {
      const room = treeRoom(roomId);
      try {
        const loaded = await loadTreeState(pool, roomId);
        if (loaded) room.state = loaded;
      } catch (e) {
        console.warn('⚠️ tree load failed:', e && e.message);
      }
      treeRoomsLoaded.add(roomId);
      return room;
    })();
  }
  return treeLoadPromises[roomId];
}
// Christmas Lights (Christmas Lights v1, `sq-christmas-lights-v1`;
// v1.2 `sq-christmas-multi-v1.2` — every hang counts, no
// one-per-person rule; persistence `sq-lights-persist-v1`):
// per-room state lightRooms[roomId] = { state }. Agora only. The
// state is persisted to Postgres (lights_room_state) on every
// hang and loaded back lazily, so a server restart restores the
// strands in whatever state they were in instead of wiping them.
// Without a DB the lights stay in-memory only, exactly as
// before. Unlike the tree there is NO second round: 25 counted
// strings light the room and the quest is done for the venue.
// The server enforces multi-hang counting (hangLight counts
// every hang), room membership, and rate limits; it does not
// verify the box take or the walk to the wall — same trust level
// as the tree's box take and the puzzle's hidden-search clicks.
const lightRooms = {};
const lightRoomsLoaded = new Set(); // roomIds whose DB row has been read (or attempted)
const lightLoadPromises = {}; // roomId -> in-flight load promise
function lightRoom(roomId) {
  if (!lightRooms[roomId]) lightRooms[roomId] = { state: createLightState() };
  return lightRooms[roomId];
}
// Save one room's lights state, never crashing the caller: a
// failed save warns and the live broadcast still goes out (the
// in-memory state is the live truth; the next hang retries the
// save). Mirrors persistTree above.
async function persistLight(roomId) {
  try {
    await saveLightState(pool, roomId, lightRoom(roomId).state);
  } catch (e) {
    console.warn('⚠️ lights persist failed:', e && e.message);
  }
}
// Load a room's lights from Postgres the first time they are
// touched. Concurrent touches share one in-flight load, so a
// hang can never land on the default bare strands while the
// real row is still being read. A missing row, a down DB, or a
// bad row all leave the default bare strands in place. No repair
// step beyond parseLightState: it already repairs a missing or
// short `lit` list to the first N slots and forces a completed
// room's counted to 25. Mirrors ensureTreeLoaded above.
async function ensureLightLoaded(roomId) {
  if (lightRoomsLoaded.has(roomId)) return lightRoom(roomId);
  if (!lightLoadPromises[roomId]) {
    lightLoadPromises[roomId] = (async () => {
      const room = lightRoom(roomId);
      try {
        const loaded = await loadLightState(pool, roomId);
        if (loaded) room.state = loaded;
      } catch (e) {
        console.warn('⚠️ lights load failed:', e && e.message);
      }
      lightRoomsLoaded.add(roomId);
      return room;
    })();
  }
  return lightLoadPromises[roomId];
}
// Build a Snowman (Build a Snowman v1, `sq-build-snowman-v1`;
// persistence `sq-snowman-persist-v1`): per-room state
// snowRooms[roomId] = { state }. Shepherd Park only. The state
// is persisted to Postgres (snowman_room_state) on every
// snowball add and loaded back lazily, so a server restart
// restores the snowman in whatever state he was in instead of
// wiping him. Without a DB the snowman stays in-memory only,
// exactly as before. Unlike the tree there is NO second round:
// 15 counted snowballs build the snowman and the quest is done
// for the venue. The server enforces multi-hang counting
// (addSnowball counts every add), room membership, and rate
// limits; it does not verify the pile take or the walk to the
// snowman — same trust level as the lights' box take and the
// tree's box take.
const snowRooms = {};
const snowRoomsLoaded = new Set(); // roomIds whose DB row has been read (or attempted)
const snowLoadPromises = {}; // roomId -> in-flight load promise
function snowRoom(roomId) {
  if (!snowRooms[roomId]) snowRooms[roomId] = { state: createSnowState() };
  return snowRooms[roomId];
}
// Save one room's snowman state, never crashing the caller: a
// failed save warns and the live broadcast still goes out (the
// in-memory state is the live truth; the next add retries the
// save). Mirrors persistLight above.
async function persistSnow(roomId) {
  try {
    await saveSnowState(pool, roomId, snowRoom(roomId).state);
  } catch (e) {
    console.warn('⚠️ snowman persist failed:', e && e.message);
  }
}
// Load a room's snowman from Postgres the first time it is
// touched. Concurrent touches share one in-flight load, so an
// add can never land on the default bare patch while the real
// row is still being read. A missing row, a down DB, or a bad
// row all leave the default bare patch in place. No repair step
// beyond parseSnowState: it already clamps counted to 0..15 and
// forces a completed snowman's counted to 15. Mirrors
// ensureLightLoaded above.
async function ensureSnowLoaded(roomId) {
  if (snowRoomsLoaded.has(roomId)) return snowRoom(roomId);
  if (!snowLoadPromises[roomId]) {
    snowLoadPromises[roomId] = (async () => {
      const room = snowRoom(roomId);
      try {
        const loaded = await loadSnowState(pool, roomId);
        if (loaded) room.state = loaded;
      } catch (e) {
        console.warn('⚠️ snowman load failed:', e && e.message);
      }
      snowRoomsLoaded.add(roomId);
      return room;
    })();
  }
  return snowLoadPromises[roomId];
}
// Santa's Lost Present (Santa's Lost Present v1.1,
// `sq-santas-lost-present-v1.1`): ONE present hidden under
// Table 4 in Agora, one find per player per Chicago day. The state
// is IN-MEMORY only in v1 (like the other quests at birth): a
// server restart resets the daily-found dates — a player could
// re-find it that day — but the badge stays (the badge system
// persists it). presentRooms[roomId] = { state } where state is
// { foundBy: { userId: 'YYYY-MM-DD' } }. The server validates the
// daily rule and the badge; it does not verify the 3 search clicks
// or the walk to the spot (same as the hat — the client counts
// clicks, the server decides who found it today).
const presentRooms = {};
function presentRoom(roomId) {
  if (!presentRooms[roomId]) presentRooms[roomId] = { state: createPresentState() };
  return presentRooms[roomId];
}

// Santa Hat (Santa Hat v1, `sq-santa-hat-v1`; persistence
// `sq-hat-persist-v1`): ONE hat hidden behind the Christmas tree
// in Agora. The state is persisted to Postgres (hat_room_state) on
// every mutation and loaded back lazily, so a server restart
// restores the hat in whatever state it was in instead of hiding
// it behind the tree again. Without a DB the hat stays in-memory
// only, exactly as before. hatRooms[roomId] = { state }. The
// server validates every move (one hat only, room membership, rate
// limits); it does not verify the 3 search clicks or the walk to
// the cat — same trust level as the puzzle's hidden-search clicks.
// The slip-off runs on the server's clock (slipAt in the state):
// the first client to notice reports it, with its own local cat
// position for where the hat lands.
const hatRooms = {};
const hatRoomsLoaded = new Set(); // roomIds whose DB row has been read (or attempted)
const hatLoadPromises = {}; // roomId -> in-flight load promise
function hatRoom(roomId) {
  if (!hatRooms[roomId]) hatRooms[roomId] = { state: createHatState() };
  return hatRooms[roomId];
}
// Save one room's hat state, never crashing the caller: a failed
// save warns and the live broadcast still goes out (the in-memory
// state is the live truth; the next mutation retries the save).
async function persistHat(roomId, state) {
  try {
    await saveHatState(pool, roomId, state);
  } catch (e) {
    console.warn('⚠️ hat persist failed:', e && e.message);
  }
}
// Load a room's hat from Postgres the first time it is touched.
// Concurrent touches share one in-flight load, so a mutation can
// never land on the default hidden state while the real row is
// still being read. A missing row, a down DB, or a bad row all
// leave the default hidden state in place.
async function ensureHatLoaded(roomId) {
  if (hatRoomsLoaded.has(roomId)) return hatRooms[roomId];
  if (!hatLoadPromises[roomId]) {
    hatLoadPromises[roomId] = (async () => {
      const room = hatRoom(roomId);
      try {
        const loaded = await loadHatState(pool, roomId);
        if (loaded) {
          room.state = loaded.state;
          // A slip that came due while the server was down was
          // repaired to the ground on load — write the repair back
          // so the row stays truthful.
          if (loaded.repaired) await saveHatState(pool, roomId, room.state);
        }
      } catch (e) {
        console.warn('⚠️ hat load failed:', e && e.message);
      }
      hatRoomsLoaded.add(roomId);
      return room;
    })();
  }
  return hatLoadPromises[roomId];
}
// Notice board (Notice Board v1, `sq-notice-board-v1`; persistence
// `sq-notice-board-persist-v1`): per-room pinned flyers, EVERY
// room. The state is persisted to Postgres (notice_board_state)
// on every pin and removal and loaded back lazily, so a server
// restart restores the boards instead of wiping them clean.
// Without a DB the boards stay in-memory only, exactly as before.
// noticeBoards[roomId] = { state }.
const noticeBoards = {};
const noticeBoardsLoaded = new Set(); // roomIds whose DB row has been read (or attempted)
const noticeBoardLoadPromises = {}; // roomId -> in-flight load promise
function noticeBoardRoom(roomId) {
  if (!noticeBoards[roomId]) noticeBoards[roomId] = { state: createNoticeBoardState() };
  return noticeBoards[roomId];
}
// Save one room's board state, never crashing the caller: a failed
// save warns and the live broadcast still goes out (the in-memory
// state is the live truth; the next pin/removal retries the save).
async function persistNoticeBoard(roomId) {
  try {
    await saveNoticeBoardState(pool, roomId, noticeBoardRoom(roomId).state);
  } catch (e) {
    console.warn('⚠️ notice board persist failed:', e && e.message);
  }
}
// Load a room's board from Postgres the first time it is touched.
// Concurrent touches share one in-flight load, so a pin can never
// land on the default empty board while the real row is still
// being read. A missing row, a down DB, or a bad row all leave the
// default empty board in place. No repair step beyond
// parseNoticeBoardState: there is no completion timer, and the
// parser already cleans each flyer, caps at 10, and drops
// malformed ones.
async function ensureNoticeBoardLoaded(roomId) {
  if (noticeBoardsLoaded.has(roomId)) return noticeBoardRoom(roomId);
  if (!noticeBoardLoadPromises[roomId]) {
    noticeBoardLoadPromises[roomId] = (async () => {
      const room = noticeBoardRoom(roomId);
      try {
        const loaded = await loadNoticeBoardState(pool, roomId);
        if (loaded) room.state = loaded;
      } catch (e) {
        console.warn('⚠️ notice board load failed:', e && e.message);
      }
      noticeBoardsLoaded.add(roomId);
      return room;
    })();
  }
  return noticeBoardLoadPromises[roomId];
}
// Decoration Shop v1 (`sq-dec-shop-v1`; persistence
// `sq-decor-persist-v1`): per-room placed decorations, EVERY room
// (not just Agora — decorations are placeable anywhere). The state
// is persisted to Postgres (decor_room_state) on every place and
// removal and loaded back lazily, so a server restart restores
// the decorations instead of wiping them clean. Without a DB the
// decorations stay in-memory only, exactly as before.
// decorRooms[roomId] = { state }.
const decorRooms = {};
const decorRoomsLoaded = new Set(); // roomIds whose DB row has been read (or attempted)
const decorLoadPromises = {}; // roomId -> in-flight load promise
function decorRoom(roomId) {
  if (!decorRooms[roomId]) decorRooms[roomId] = { state: createDecorState() };
  return decorRooms[roomId];
}
// Save one room's decor state, never crashing the caller: a failed
// save warns and the live broadcast still goes out (the in-memory
// state is the live truth; the next place/removal retries the save).
async function persistDecor(roomId) {
  try {
    await saveDecorState(pool, roomId, decorRoom(roomId).state);
  } catch (e) {
    console.warn('⚠️ decor persist failed:', e && e.message);
  }
}
// Load a room's decorations from Postgres the first time they are
// touched. Concurrent touches share one in-flight load, so a place
// can never land on the default empty room while the real row is
// still being read. A missing row, a down DB, or a bad row all
// leave the default empty room in place. No repair step beyond
// parseDecorState: there is no completion timer, and the parser
// already cleans each decoration, caps at 30, and drops
// malformed ones.
async function ensureDecorLoaded(roomId) {
  if (decorRoomsLoaded.has(roomId)) return decorRoom(roomId);
  if (!decorLoadPromises[roomId]) {
    decorLoadPromises[roomId] = (async () => {
      const room = decorRoom(roomId);
      try {
        const loaded = await loadDecorState(pool, roomId);
        if (loaded) room.state = loaded;
      } catch (e) {
        console.warn('⚠️ decor load failed:', e && e.message);
      }
      decorRoomsLoaded.add(roomId);
      return room;
    })();
  }
  return decorLoadPromises[roomId];
}
// Shared Floor Litter v1 (`sq-shared-litter-v1`): per-room dropped
// items everyone in the room can see and pick up.
// floorLitterRooms[roomId] = { state }.
// IN-MEMORY ONLY — a restart wipes floor litter. That is fine on
// purpose: it is litter, and the item already left the dropper's
// pocket either way (a restart never resurrects a dropped item
// into a pocket). No Postgres table, no persistence module. Home
// rooms never use this — their drops go through the per-player
// home floor store, and the server refuses drop_item there.
const floorLitterRooms = {};
function floorLitterRoom(roomId) {
  if (!floorLitterRooms[roomId]) floorLitterRooms[roomId] = { state: createFloorLitterState() };
  return floorLitterRooms[roomId];
}
function broadcastFloorLitter(roomId) {
  io.to(roomId).emit('floor_litter', serializeFloorLitterState(floorLitterRoom(roomId).state));
}
// Catch a Litterbug v1 (`sq-litterbug-quest-v1`): when each
// patrolling NPC last dropped a cup, per room — the cooldown that
// dedupes the many clients rolling their own NPC timer at once.
// Key `${roomId}:${npcLabel}` -> Date.now() of the last accepted
// NPC drop. In-memory like the litter itself; a restart resets it.
const npcLitterLastDrop = new Map();
// Restore pickup claims that expired while nobody was looking
// (a picker that never confirmed). Returns true when anything
// came back — the caller broadcasts then.
function sweepFloorLitter(roomId) {
  const { restored } = sweepFloorLitterClaims(floorLitterRoom(roomId).state, Date.now());
  return restored > 0;
}
// Matches youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/shorts/
const YOUTUBE_ID_RE = /(?:(?:www\.|music\.)?youtube\.com\/(?:watch\?[^#]*v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
function extractYouTubeId(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(YOUTUBE_ID_RE);
  return m ? m[1] : null;
}
const jukeboxLoaded = new Set();
const SONG_MS = 3 * 60 * 1000; // simulated track length

// The house song: plays in every room before anyone has picked a song,
// and again whenever the queue runs dry. Songs users pick always go
// ahead of it — the moment one is queued, it plays next.
const DEFAULT_JUKEBOX_SONG = {
  id: 'default-time-is-running-out',
  title: 'Time Is Running Out',
  artist: 'Muse',
  youtubeVideoId: 'O2IuJPh6h_A',
  addedByName: 'Side Quest',
  votes: 0,
};


function jukeboxState(roomId) {
  if (!jukeboxRooms[roomId]) jukeboxRooms[roomId] = { queue: [], nowPlaying: null, timer: null };
  return jukeboxRooms[roomId];
}

function sortJukeboxQueue(queue) {
  queue.sort((a, b) => (b.votes - a.votes) || (a.createdAt - b.createdAt));
}

function publicJukeboxState(roomId, userId) {
  const st = jukeboxRooms[roomId];
  // Jukebox Solo Skip v1 (`sq-jukebox-solo-skip-v1`): the panel shows
  // "Skip (1 vote)" when the viewer is alone in the room, "Skip
  // (2 votes)" otherwise — the server knows the room size.
  const roomSize = rooms[roomId] ? Object.keys(rooms[roomId]).length : 0;
  if (!st) return { nowPlaying: null, queue: [], roomSize };
  const nowPlaying = st.nowPlaying
    ? {
        id: st.nowPlaying.id,
        title: st.nowPlaying.title,
        artist: st.nowPlaying.artist,
        addedByName: st.nowPlaying.addedByName,
        startedAt: st.nowPlaying.startedAt,
        skipVotes: st.nowPlaying.skipVotes ? st.nowPlaying.skipVotes.size : 0,
        youtubeVideoId: st.nowPlaying.youtubeVideoId || null,
      }
    : null;
  const queue = st.queue.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    votes: s.votes,
    addedByName: s.addedByName,
    voted: userId ? s.votedBy.has(userId) : false,
    youtubeVideoId: s.youtubeVideoId || null,
  }));
  return { nowPlaying, queue, roomSize };
}

const jukeboxNowPlayingLoaded = new Set(); // roomIds whose now-playing row has been read (or attempted)
const jukeboxNowPlayingLoadPromises = {}; // roomId -> in-flight restore promise
const jukeboxLoadPromises = {}; // roomId -> in-flight loadJukebox promise (queue + restore)
// Save one room's jukebox now-playing snapshot (song + skip votes
// + cooldown + queue votedBy), never crashing the caller: a failed
// save warns and the live broadcast still goes out (the in-memory
// state is the live truth; the next advance/skip/vote retries the
// save).
async function persistJukebox(roomId) {
  try {
    const st = jukeboxRooms[roomId];
    await saveJukeboxNowPlaying(pool, roomId, {
      nowPlaying: st?.nowPlaying || null,
      defaultCooldownUntil: st?.defaultCooldownUntil ?? null,
      votedBy: Object.fromEntries(
        (st?.queue || [])
          .filter((s) => s.votedBy && s.votedBy.size)
          .map((s) => [s.id, [...s.votedBy]])
      ),
    });
  } catch (e) {
    console.warn('⚠️ jukebox persist failed:', e && e.message);
  }
}
// Overlay restored queue votedBy flags onto the loaded queue.
// Idempotent (Sets): safe to call twice, e.g. once from the
// in-flight load and once from a concurrent early return.
function overlayJukeboxVotes(roomId, row) {
  const st = jukeboxRooms[roomId];
  if (!st || !row || !row.votedBy) return;
  for (const song of st.queue) {
    const voters = row.votedBy[song.id];
    if (Array.isArray(voters)) for (const v of voters) song.votedBy.add(v);
  }
}
// Restore one room's now-playing song from Postgres the first time
// the jukebox is touched. Concurrent touches share one in-flight
// load, so a get_jukebox can never advance past a song that is
// still being restored. Returns the parsed row (or null) so the
// caller can overlay the votedBy flags once the queue is loaded.
// The snapshot is the ONLY copy of the playing song — it was
// already marked played when it started, so the queue SELECT
// excludes it. A snapshot of the house song is rebuilt from
// DEFAULT_JUKEBOX_SONG (the row only carries its startedAt +
// skip votes). The timer is re-armed for the REMAINING time; a
// song that already ran out while the server was down is left
// unrestored (nowPlaying stays null) so the caller advances. A
// cooldown that already expired is dropped the same way.
async function ensureJukeboxNowPlayingLoaded(roomId) {
  if (jukeboxNowPlayingLoaded.has(roomId)) return jukeboxNowPlayingLoadPromises[roomId] || null;
  if (!jukeboxNowPlayingLoadPromises[roomId]) {
    jukeboxNowPlayingLoadPromises[roomId] = (async () => {
      try {
        const st = jukeboxState(roomId);
        const loaded = await loadJukeboxNowPlaying(pool, roomId);
        if (loaded && !st.nowPlaying) {
          if (Number.isFinite(loaded.defaultCooldownUntil) && loaded.defaultCooldownUntil > Date.now()) {
            st.defaultCooldownUntil = loaded.defaultCooldownUntil;
          }
          if (loaded.nowPlaying) {
            const snap = loaded.nowPlaying;
            const remaining = jukeboxRemainingMs(snap);
            if (remaining > JUKEBOX_MIN_REMAINING_MS) {
              // Defensive: a stale row must never double-play a song
              // that is also sitting in the queue.
              st.queue = st.queue.filter((s) => s.id !== snap.id);
              const isHouse = snap.id === DEFAULT_JUKEBOX_SONG.id;
              st.nowPlaying = {
                id: snap.id,
                title: isHouse ? DEFAULT_JUKEBOX_SONG.title : snap.title,
                artist: isHouse ? DEFAULT_JUKEBOX_SONG.artist : snap.artist,
                addedBy: isHouse ? 'house' : snap.addedBy,
                addedByName: isHouse ? DEFAULT_JUKEBOX_SONG.addedByName : snap.addedByName,
                youtubeVideoId: isHouse ? DEFAULT_JUKEBOX_SONG.youtubeVideoId : snap.youtubeVideoId,
                startedAt: snap.startedAt,
                skipVotes: new Set(snap.skipVotes || []),
              };
              st.timer = setTimeout(() => advanceJukebox(roomId), remaining);
              if (st.timer.unref) st.timer.unref();
            }
            // else: the song already ran out while the server was
            // down — leave nowPlaying null so the caller advances.
          }
        }
        return loaded;
      } catch (e) {
        console.warn('⚠️ jukebox now-playing load failed:', e && e.message);
        return null;
      } finally {
        jukeboxNowPlayingLoaded.add(roomId);
      }
    })();
  }
  return jukeboxNowPlayingLoadPromises[roomId];
}

async function loadJukebox(roomId) {
  if (jukeboxLoaded.has(roomId)) {
    // Queue load already started (or done): every caller shares
    // the one in-flight load, so a second add_song can never push
    // onto the pre-load empty queue and lose the song when the
    // load replaces it — and a get_jukebox can never advance past
    // a now-playing song that is still being restored.
    return jukeboxLoadPromises[roomId];
  }
  jukeboxLoadPromises[roomId] = (async () => {
    jukeboxLoaded.add(roomId);
    const st = jukeboxState(roomId);
    if (!pool) {
      // No Postgres: restore is a no-op, exactly as today.
      await ensureJukeboxNowPlayingLoaded(roomId);
      return st;
    }
    try {
      const { rows } = await pool.query(
        'SELECT id, title, artist, votes, added_by AS "addedBy", added_by_name AS "addedByName", created_at AS "createdAt", youtube_video_id AS "youtubeVideoId" FROM jukebox_songs WHERE room_id = $1 AND played = FALSE ORDER BY votes DESC, created_at ASC',
        [roomId]
      );
      // Legacy title-only seed rows never actually play — keep them out of
      // the live queue so they can't block the house song or user picks.
      st.queue = rows
        .filter((r) => r.youtubeVideoId || !String(r.id).startsWith('seed-'))
        .map((r) => ({ ...r, votedBy: new Set(), createdAt: new Date(r.createdAt).getTime() || Date.now() }));
    } catch (e) {
      console.error('loadJukebox failed:', e.message);
    }
    // Jukebox Persistence v1 (`sq-jukebox-persist-v1`): restore the
    // now-playing song after the queue loads, then overlay the
    // restored queue votedBy flags onto the loaded queue.
    const row = await ensureJukeboxNowPlayingLoaded(roomId);
    overlayJukeboxVotes(roomId, row);
    return st;
  })();
  return jukeboxLoadPromises[roomId];
}

async function saveJukeboxSong(roomId, song) {
  if (!pool) return;
  await pool.query(
    'INSERT INTO jukebox_songs (id, room_id, title, artist, votes, played, added_by, added_by_name, youtube_video_id) VALUES ($1,$2,$3,$4,$5,FALSE,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET votes=$5, youtube_video_id=$8',
    [song.id, roomId, song.title, song.artist, song.votes, song.addedBy, song.addedByName, song.youtubeVideoId || null]
  );
}

async function markSongPlayed(songId) {
  if (!pool) return;
  await pool.query('UPDATE jukebox_songs SET played = TRUE WHERE id = $1', [songId]);
}

function broadcastJukebox(roomId) {
  // Per-socket personalization (voted flags) needs each socket's user id.
  const room = rooms[roomId];
  if (!room) return;
  for (const sid of Object.keys(room)) {
    const userId = socketUserMap[sid] || sid;
    const target = io.sockets.sockets.get(sid);
    if (target) target.emit('jukebox_state', publicJukeboxState(roomId, userId));
  }
}

function advanceJukebox(roomId) {
  const st = jukeboxRooms[roomId];
  if (!st) return;
  if (st.timer) {
    clearTimeout(st.timer);
    st.timer = null;
  }
  // If the house song just ended almost immediately, it is probably
  // embed-blocked — don't spin it in a loop; sit out a cooldown instead.
  const prev = st.nowPlaying;
  if (prev && prev.id === DEFAULT_JUKEBOX_SONG.id && Date.now() - (prev.startedAt || 0) < 20000) {
    st.defaultCooldownUntil = Date.now() + 5 * 60 * 1000;
  }
  sortJukeboxQueue(st.queue);
  let next = st.queue.shift();
  if (!next) {
    if (st.defaultCooldownUntil && Date.now() < st.defaultCooldownUntil) {
      st.nowPlaying = null;
      broadcastJukebox(roomId);
      // Jukebox Persistence v1 (`sq-jukebox-persist-v1`): the
      // sit-out (nothing playing + live cooldown) is state too —
      // persist the null + cooldown so a restart does not forget
      // the bench and immediately replay the house song.
      persistJukebox(roomId);
      return;
    }
    // Queue is dry: the house song takes the stage.
    next = { ...DEFAULT_JUKEBOX_SONG, addedBy: 'house', votedBy: new Set(), createdAt: Date.now() };
  } else {
    markSongPlayed(next.id);
  }
  st.nowPlaying = { ...next, votedBy: undefined, startedAt: Date.now(), skipVotes: new Set() };
  broadcastJukebox(roomId);
  const waitMs = next.youtubeVideoId ? 10 * 60 * 1000 : SONG_MS;
  st.timer = setTimeout(() => advanceJukebox(roomId), waitMs);
  if (st.timer.unref) st.timer.unref();
  // Jukebox Persistence v1 (`sq-jukebox-persist-v1`): a new song
  // just started — save its snapshot (with startedAt) so a
  // restart resumes it instead of skipping it entirely.
  persistJukebox(roomId);
}

async function upsertPresence({ socketId, userId, roomId, name, firstName, skinId, avatarModel, x, y }) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO room_presence (socket_id, user_id, room_id, name, first_name, skin_id, avatar_model, x, y, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (socket_id)
     DO UPDATE SET user_id = EXCLUDED.user_id, room_id = EXCLUDED.room_id, name = EXCLUDED.name,
       first_name = EXCLUDED.first_name, skin_id = EXCLUDED.skin_id, avatar_model = EXCLUDED.avatar_model,
       x = EXCLUDED.x, y = EXCLUDED.y, updated_at = NOW()`,
    [socketId, userId, roomId, name || null, firstName || null, skinId || null, avatarModel || 'hoodie', x, y]
  );
}

async function touchPresencePosition({ socketId, x, y }) {
  if (!pool) return;
  await pool.query('UPDATE room_presence SET x = $2, y = $3, updated_at = NOW() WHERE socket_id = $1', [socketId, x, y]);
}

async function removePresence(socketId) {
  if (!pool) return;
  await pool.query('DELETE FROM room_presence WHERE socket_id = $1', [socketId]);
}

async function removeDuplicatePresenceByUser({ roomId, userId, keepSocketId }) {
  if (!pool || !roomId || !userId) return;
  await pool.query(
    'DELETE FROM room_presence WHERE room_id = $1 AND user_id = $2 AND socket_id <> $3',
    [roomId, userId, keepSocketId]
  );
}

async function getPresenceRoomState(roomId) {
  if (!pool) return null;
  await pool.query("DELETE FROM room_presence WHERE updated_at < NOW() - INTERVAL '30 seconds'");
  const { rows } = await pool.query(
    'SELECT socket_id, user_id, name, first_name, skin_id, avatar_model, x, y FROM room_presence WHERE room_id = $1',
    [roomId]
  );
  if (!rows.length) return null;
  const state = {};
  rows.forEach((r) => {
    state[r.socket_id] = {
      id: r.user_id,
      name: r.name || `Guest_${String(r.socket_id).slice(0, 4)}`,
      firstName: r.first_name || '',
      skinId: r.skin_id || 'blue',
      avatarModel: r.avatar_model || 'hoodie',
      x: r.x,
      y: r.y,
    };
  });
  return state;
}

function mergeRoomState(memoryState, dbState) {
  const merged = { ...(dbState || {}) };
  Object.entries(memoryState || {}).forEach(([socketId, player]) => {
    merged[socketId] = {
      ...(merged[socketId] || {}),
      ...(player || {}),
    };
  });
  return merged;
}

function canonicalizeRoomStateByUser(state, preferredSocketIds = new Set()) {
  const chosenByUser = new Map();

  Object.entries(state || {}).forEach(([socketId, player]) => {
    if (!socketId || !player) return;
    const userKey = player.id ? `user:${String(player.id)}` : `socket:${socketId}`;
    const score = preferredSocketIds.has(socketId) ? 2 : 1;
    const existing = chosenByUser.get(userKey);
    if (!existing || score > existing.score) {
      chosenByUser.set(userKey, { socketId, player, score });
    }
  });

  const canonical = {};
  chosenByUser.forEach(({ socketId, player }) => {
    canonical[socketId] = player;
  });
  return canonical;
}

const app = express();
app.use(express.json());
// Allow all origins for REST endpoints
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
const server = http.createServer(app);

// 1. Initialize Socket.io with permissive CORS for development/mobile testing
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Store room state in memory: { roomName: { socketId: { id, name, x, y } } }
const rooms = {};
const decorations = {}; // populated on startup from Postgres

// Rate limit: { userId: { count: N, windowStart: timestamp } }
// Keep anti-spam protection, but allow active in-room editing sessions.
const CHANGE_LIMIT = 250;
const CREATOR_LIMIT = 500;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const changeRates = {};
const creatorRates = {}; // keyed by `${userId}:${roomId}`
const socketCreatorRooms = {}; // socketId → Set<roomId>
const socketUserMap = {};
const moderatorEmails = new Set(
  String(process.env.MODERATOR_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);
if (moderatorEmails.size > 0) {
  console.log(`🛡️ Global moderators configured: ${moderatorEmails.size} account(s)`);
}

// Layout submissions: Postgres when available, in-memory fallback.
const memoryLayoutSubmissions = [];

async function createLayoutSubmission({ roomId, roomName, submitter, submitterName, layout }) {
  const id = `layout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    roomId: String(roomId || ''),
    roomName: String(roomName || ''),
    submitter: String(submitter || ''),
    submitterName: String(submitterName || ''),
    layout,
    status: 'pending',
    submittedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
  };
  if (pool) {
    await pool.query(
      'INSERT INTO layout_submissions (id, room_id, room_name, submitter, submitter_name, data, status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, record.roomId, record.roomName, record.submitter, record.submitterName, JSON.stringify(layout), 'pending']
    );
  } else {
    memoryLayoutSubmissions.push(record);
  }
  return record;
}

async function listPendingLayoutSubmissions() {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT id, room_id AS "roomId", room_name AS "roomName", submitter, submitter_name AS "submitterName",
              data AS "layout", status, submitted_at AS "submittedAt"
       FROM layout_submissions WHERE status = 'pending' ORDER BY submitted_at ASC`
    );
    return rows;
  }
  return memoryLayoutSubmissions.filter((r) => r.status === 'pending');
}

async function getApprovedLayout(roomId) {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT id, room_id AS "roomId", room_name AS "roomName", data AS "layout",
              reviewed_at AS "reviewedAt", reviewed_by AS "reviewedBy"
       FROM layout_submissions WHERE room_id = $1 AND status = 'approved'
       ORDER BY reviewed_at DESC LIMIT 1`,
      [String(roomId || '')]
    );
    return rows[0] || null;
  }
  const approved = memoryLayoutSubmissions
    .filter((r) => r.roomId === String(roomId || '') && r.status === 'approved')
    .sort((a, b) => new Date(b.reviewedAt || 0) - new Date(a.reviewedAt || 0));
  return approved[0] || null;
}

async function reviewLayoutSubmission(id, approve, reviewer) {
  const status = approve ? 'approved' : 'rejected';
  if (pool) {
    const { rows } = await pool.query(
      `UPDATE layout_submissions SET status = $2, reviewed_at = NOW(), reviewed_by = $3
       WHERE id = $1 AND status = 'pending' RETURNING id, room_id AS "roomId", data AS "layout", submitter, submitter_name AS "submitterName"`,
      [id, status, String(reviewer || '')]
    );
    return rows[0] || null;
  }
  const rec = memoryLayoutSubmissions.find((r) => r.id === id && r.status === 'pending');
  if (!rec) return null;
  rec.status = status;
  rec.reviewedAt = new Date().toISOString();
  rec.reviewedBy = String(reviewer || '');
  return rec;
}

// agora-clear-approved-v1: revoke the approved layout(s) for a room so the
// built-in layout shows again. History is kept (status 'revoked'), nothing
// is deleted, and only currently-approved rows for that room are touched.
async function clearApprovedLayout(roomId, reviewer) {
  const room = String(roomId || '');
  if (pool) {
    const { rows } = await pool.query(
      `UPDATE layout_submissions SET status = $2, reviewed_at = NOW(), reviewed_by = $3
       WHERE room_id = $1 AND status = 'approved' RETURNING id, room_id AS "roomId", data AS "layout", submitter, submitter_name AS "submitterName"`,
      [room, 'revoked', String(reviewer || '')]
    );
    return rows;
  }
  const cleared = memoryLayoutSubmissions.filter((r) => r.roomId === room && r.status === 'approved');
  cleared.forEach((rec) => {
    rec.status = 'revoked';
    rec.reviewedAt = new Date().toISOString();
    rec.reviewedBy = String(reviewer || '');
  });
  return cleared;
}

function isGlobalModerator(actorId) {
  return moderatorEmails.has(normalizeActorId(actorId));
}

function normalizeActorId(value) {
  return String(value || '').trim().toLowerCase();
}

function getVenueOwnerId(roomId) {
  const room = getAllRooms().find((entry) => entry.id === roomId);
  return normalizeActorId(room?.ownerId || room?.creator);
}

function getVenuePermissions(roomId, actorId) {
  const actor = normalizeActorId(actorId);
  const isModerator = moderatorEmails.has(actor);
  const isOwner = Boolean(actor && actor === getVenueOwnerId(roomId));
  return { isModerator, isOwner, canManage: isModerator || isOwner };
}

// Daily add/delete cap for non-creators, separate from the burst limiter above.
const DAILY_EDIT_LIMIT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const dailyEditRates = {}; // keyed by `${userId}:${roomId}`

function checkDailyEditLimit(userId, roomId) {
  const key = `${userId}:${roomId}`;
  const now = Date.now();
  const r = dailyEditRates[key];
  if (!r || now - r.windowStart > DAY_MS) {
    dailyEditRates[key] = { count: 1, windowStart: now };
    return { allowed: true, remaining: DAILY_EDIT_LIMIT - 1 };
  }
  if (r.count >= DAILY_EDIT_LIMIT) {
    const resetInMinutes = Math.max(1, Math.ceil((r.windowStart + DAY_MS - now) / 60000));
    return { allowed: false, remaining: 0, resetInMinutes };
  }
  r.count += 1;
  return { allowed: true, remaining: DAILY_EDIT_LIMIT - r.count };
}

function checkRateLimit(userId) {
  const now = Date.now();
  const r = changeRates[userId];
  if (!r || now - r.windowStart > WINDOW_MS) {
    changeRates[userId] = { count: 1, windowStart: now };
    return { allowed: true, remaining: CHANGE_LIMIT - 1 };
  }
  if (r.count >= CHANGE_LIMIT) {
    const resetInMinutes = Math.max(1, Math.ceil((r.windowStart + WINDOW_MS - now) / 60000));
    return { allowed: false, remaining: 0, resetInMinutes };
  }
  r.count += 1;
  return { allowed: true, remaining: CHANGE_LIMIT - r.count };
}

function checkCreatorRate(userId, roomId) {
  const key = `${userId}:${roomId}`;
  const now = Date.now();
  const r = creatorRates[key];
  if (!r || now - r.windowStart > WINDOW_MS) {
    creatorRates[key] = { count: 1, windowStart: now };
    return { allowed: true, remaining: CREATOR_LIMIT - 1, isCreator: true };
  }
  if (r.count >= CREATOR_LIMIT) {
    const resetInMinutes = Math.max(1, Math.ceil((r.windowStart + WINDOW_MS - now) / 60000));
    return { allowed: false, remaining: 0, resetInMinutes, isCreator: true };
  }
  r.count += 1;
  return { allowed: true, remaining: CREATOR_LIMIT - r.count, isCreator: true };
}

function broadcastRoomCounts() {
  const counts = {};
  Object.entries(rooms).forEach(([roomId, players]) => {
    counts[roomId] = Object.keys(players).length;
  });
  io.emit('room_counts', counts);
}

// DAY/NIGHT PHASE (outdoor venues): the server owns the canonical
// sky so everyone in a place agrees on it. The curve mirrors the
// client's DayNightMode.js exactly: America/Chicago wall-clock, dawn
// ramp 05:30-07:30, dusk ramp 17:30-19:30, night darkness capped at
// 0.36. Broadcast to everyone once a minute; clients ease toward it.
function currentTimePhase(date = new Date()) {
  const NIGHT = 0.36;
  let mins = null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour12: false, hour: '2-digit', minute: '2-digit',
    }).formatToParts(date);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
    mins = (get('hour') % 24) * 60 + get('minute');
  } catch { /* fall through to server-local time */ }
  if (!Number.isFinite(mins)) mins = date.getHours() * 60 + date.getMinutes();
  if (mins < 330) return { phase: 'night', darkness: NIGHT };
  if (mins < 450) return { phase: 'dawn', darkness: NIGHT * (1 - (mins - 330) / 120) };
  if (mins < 1050) return { phase: 'day', darkness: 0 };
  if (mins < 1170) return { phase: 'dusk', darkness: NIGHT * ((mins - 1050) / 120) };
  return { phase: 'night', darkness: NIGHT };
}
setInterval(() => {
  try { io.emit('time_phase', currentTimePhase()); } catch {}
}, 60000);

// Hungry Cat v1 (`sq-hungry-cat-v1`): the hunger tick — every 30s
// (faster than the 2-hour windows need, so hunger starts within
// half a minute of 8am / 6pm), refresh Agora's hunger and broadcast
// only when the hungry flag flips. Players already in the room get
// the bubble + banner from the broadcast; players joining mid-window
// get the state from get_cat_hunger; a sleeping cat's hunger waits
// (refreshCatHunger does not activate while she is asleep).
setInterval(() => {
  try { refreshRoomHunger('agora-houston').catch(() => {}); } catch {}
}, 30000);

// 2. Real-Time Socket Event Handlers
io.on('connection', (socket) => {
  console.log(`⚡ Client connected: ${socket.id}`);

  // JOIN ROOM
  socket.on('join_room', async ({ roomId, user, lat, lng }) => {
    // Enforce GPS proximity for GPS-anchored locations; reject joins from outside the radius.
    const targetRoom = getAllRooms().find((r) => r.id === roomId);
    if (!isOpenAccessRoom(roomId) && targetRoom && Number.isFinite(targetRoom.lat) && Number.isFinite(targetRoom.lng)) {
      const userLat = Number(lat);
      const userLng = Number(lng);
      const radiusMeters = getRoomAccessRadius(targetRoom) || 100;
      const hasValidCoords = Number.isFinite(userLat) && Number.isFinite(userLng);
      if (!hasValidCoords || !isWithinRadius(userLat, userLng, targetRoom.lat, targetRoom.lng, radiusMeters)) {
        socket.emit('join_denied', {
          roomId,
          reason: hasValidCoords
            ? `You must be within ${radiusMeters}m of ${targetRoom.name} to enter.`
            : 'GPS location is required to enter this location.',
        });
        return;
      }
    }

    // Your Place (Your Place v1, `sq-your-place-v1`): a home room
    // belongs to one player — anyone else is refused at the door.
    // The room id carries the owner key (home-<owner>), and the
    // actor key comes from the join payload's email (or id, which
    // the client sets to the same email). Checked BEFORE joining,
    // so a refused player never appears in the room at all.
    if (isHomeRoom(roomId)) {
      const owner = homeOwnerOf(roomId);
      const actorKey = normalizeHomeOwner(user?.email || user?.id || socket.id);
      if (!owner || owner !== actorKey) {
        socket.emit('join_denied', {
          roomId,
          reason: "This is someone else's place — only the owner can enter.",
        });
        return;
      }
    }

    socket.join(roomId);

    // A new player walking in wakes a sleeping cafe cat back up.
    // Cat State Persistence v1 (`sq-cat-persist-v1`): load the
    // room's cat row first, so the wake check reads the real
    // persisted state — a cat asleep before the restart still
    // wakes when someone walks in, and the woken state is saved.
    await ensureCatLoaded(roomId);
    if (catState[roomId]?.asleep) {
      catState[roomId] = { pets: 0, asleep: false };
      io.to(roomId).emit('cat_state', { pets: 0, asleep: false });
      persistCat(roomId);
      // Hungry Cat v1 (`sq-hungry-cat-v1`): hunger waits while she
      // sleeps — if she wakes inside a window she is hungry again
      // right away (the tick would catch it within 30s, but the
      // bubble should come back with the wake, not half a minute
      // later). refreshRoomHunger already broadcasts when the flag
      // flips; the extra emit below covers the case where hunger
      // was already true while she slept (no flip, no broadcast)
      // and the room still needs to hear she is hungry again.
      if (roomId === 'agora-houston') {
        const woken = await refreshRoomHunger(roomId);
        if (!woken.changed && woken.state.hungry) {
          io.to(roomId).emit('cat_hunger', serializeCatHunger(woken.state));
        }
      }
    }

    if (!rooms[roomId]) {
      rooms[roomId] = {};
    }

    const userId = user?.id || socket.id;

    // Ensure one active avatar per user per room (prevents self-clones on reconnect/mobile handoff).
    Object.keys(rooms[roomId]).forEach((sid) => {
      if (sid !== socket.id && rooms[roomId][sid]?.id === userId) {
        delete rooms[roomId][sid];
        io.in(roomId).emit('player_left', { socketId: sid });
      }
    });

    // Default spawn position with slight random offset to prevent stacking
    const spawnOffsetX = (Math.random() - 0.5) * 80;
    const spawnOffsetY = (Math.random() - 0.5) * 80;
    
    const playerState = {
      id: userId,
      name: user?.name || `Guest_${socket.id.slice(0, 4)}`,
      firstName: user?.firstName || '',
      photo: user?.photo || null,
      avatarModel: user?.avatarModel || 'hoodie',
      skinId: user?.skinId || 'blue',
      hairStyle: user?.hairStyle || 'combed',
      bodyType: user?.bodyType || 'standard',
      skinTone: user?.skinTone ?? user?.pigment ?? 45,
      hairHue: user?.hairHue ?? user?.eyeHue ?? 26,
      outfitHue: user?.outfitHue ?? user?.scarfHue ?? 220,
      topStyle: user?.topStyle || 'hoodie',
      bottomStyle: user?.bottomStyle || 'pants',
      footwear: user?.footwear || 'sneakers',
      glasses: Boolean(user?.glasses),
      hasScythe: Boolean(user?.hasScythe),
      isModerator: moderatorEmails.has(normalizeActorId(user?.email || userId)),
      x: 640 + spawnOffsetX,
      y: 400 + spawnOffsetY,
    };

    // Quest badges v1: restore this player's own local completions
    // record (sent in the join payload) into the server's per-player
    // badge store, then carry it in playerState so the room sees
    // their badges on join. NOTE: hasBag is NOT in this whitelist
    // yet (see the inventory kit report) — badges ARE, because the
    // whole point is other players seeing them.
    mergeClientBadges(userId, user?.badges);
    // Quest badges v1.1 backfill: also award badges from the
    // server's own quest-progress store, for completions the
    // client's local record lost.
    backfillBadgesFromQuests(userId);
    playerState.badges = badgesArrayFor(userId);

    rooms[roomId][socket.id] = playerState;
    socketUserMap[socket.id] = userId;
    // Mailbox v1 (`sq-mailbox-v1`): register this player's mailbox
    // code, so a friend can send them mail even while they are in
    // another room (or offline — the inbox is per-player, not
    // per-room).
    registerMailCode(userId);
    await removeDuplicatePresenceByUser({ roomId, userId, keepSocketId: socket.id });
    await upsertPresence({
      socketId: socket.id,
      userId,
      roomId,
      name: playerState.name,
      firstName: playerState.firstName,
      skinId: playerState.skinId,
      avatarModel: playerState.avatarModel,
      x: playerState.x,
      y: playerState.y,
    });
    const permissions = getVenuePermissions(roomId, user?.email || userId);
    if (permissions.canManage || user?.isCreator) {
      if (!socketCreatorRooms[socket.id]) socketCreatorRooms[socket.id] = new Set();
      socketCreatorRooms[socket.id].add(roomId);
    }
    console.log(`👤 ${playerState.name} joined room: ${roomId}`);

    const dbRoomState = await getPresenceRoomState(roomId);
    const mergedRoomState = mergeRoomState(rooms[roomId], dbRoomState);
    const preferredSocketIds = new Set(Object.keys(rooms[roomId] || {}));
    socket.emit('room_state', canonicalizeRoomStateByUser(mergedRoomState, preferredSocketIds));
    const roomDecorations = (await loadDecorationsForRoom(roomId)) || decorations[roomId] || [];
    decorations[roomId] = roomDecorations;
    socket.emit('room_decorations', roomDecorations);
    socket.to(roomId).emit('player_joined', { socketId: socket.id, player: playerState });
    broadcastRoomCounts();
  });

  socket.on('get_room_decorations', async ({ roomId }) => {
    if (!roomId) return;
    const roomDecorations = (await loadDecorationsForRoom(roomId)) || decorations[roomId] || [];
    decorations[roomId] = roomDecorations;
    socket.emit('room_decorations', roomDecorations);
  });

  socket.on('get_room_state', async ({ roomId }) => {
    if (!roomId) return;
    const dbRoomState = await getPresenceRoomState(roomId);
    const mergedRoomState = mergeRoomState(rooms[roomId], dbRoomState);
    const preferredSocketIds = new Set(Object.keys(rooms[roomId] || {}));
    socket.emit('room_state', canonicalizeRoomStateByUser(mergedRoomState, preferredSocketIds));
  });

  // PLAYER MOVEMENT
  socket.on('send_move', ({ roomId, x, y, direction }) => {
    if (rooms[roomId] && rooms[roomId][socket.id]) {
      rooms[roomId][socket.id].x = x;
      rooms[roomId][socket.id].y = y;

      // Broadcast position update to all other room members
      socket.to(roomId).emit('player_moved', {
        socketId: socket.id,
        x,
        y,
        direction,
      });
      touchPresencePosition({ socketId: socket.id, x, y }).catch(() => {});
    }
  });

  // FEED DUCKS (shared pond interaction — low-stakes, rate-limited broadcast)
  socket.on('feed_ducks', ({ roomId, x, y }) => {
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    const px = Number(x);
    const py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    const cx = Math.max(-5000, Math.min(10000, Math.round(px)));
    const cy = Math.max(-5000, Math.min(10000, Math.round(py)));
    socket.to(roomId).emit('duck_fed', { x: cx, y: cy });
  });

  // LIGHT A JACK-O'-LANTERN (shared Halloween decor — clicking a pumpkin
  // lights it for everyone in the room; the lit set is kept per room in
  // memory and handed to anyone who joins later)
  socket.on('light_pumpkin', ({ roomId, index } = {}) => {
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return;
    if (!pumpkinLit[roomId]) pumpkinLit[roomId] = new Set();
    if (pumpkinLit[roomId].has(idx)) return;
    pumpkinLit[roomId].add(idx);
    io.to(roomId).emit('pumpkin_lit', { index: idx, by: socket.id });
  });

  socket.on('get_pumpkins', ({ roomId } = {}) => {
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const lit = pumpkinLit[roomId] ? [...pumpkinLit[roomId]] : [];
    socket.emit('pumpkin_state', { lit });
  });

  // PET THE CAFE CAT (shared Agora interaction — petting is counted
  // per room; 3 pets puts the cat to sleep in a sunbeam for everyone)
  socket.on('pet_cat', async ({ roomId, fed } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    // Cat State Persistence v1 (`sq-cat-persist-v1`): load before
    // mutating, so a pet after a restart counts from the real
    // persisted pet count instead of a fresh 0.
    await ensureCatLoaded(roomId);
    if (!catState[roomId]) catState[roomId] = { pets: 0, asleep: false };
    const state = catState[roomId];
    if (state.asleep) return;
    state.pets += 1;
    if (state.pets >= CATS_PETS_TO_SLEEP) state.asleep = true;
    socket.to(roomId).emit('cat_petted', { pets: state.pets, by: socket.id });
    io.to(roomId).emit('cat_state', { pets: state.pets, asleep: state.asleep });
    // Hungry Cat v1 (`sq-hungry-cat-v1`): a FOOD treat (fed: true —
    // only the ItemsSystem treat path sends it; a hand pet never
    // does) on a hungry cat completes the quest for the FIRST
    // feeder in this window. The pet above still counted either
    // way; only the quest is gated. The server is authoritative
    // for first-feeder + window; the client asserts it had food
    // (same client-asserted model as quest_progress — the +3 coins
    // are paid client-side on the confirmation below, bounded to
    // one completion per window per feeder).
    if (fed) {
      const res = feedCatHunger(hungerRoom(roomId), { now: new Date(), userId, windows: HUNGER_WINDOWS });
      catHunger[roomId] = res.state;
      if (res.ok) {
        // Only the feeder hears the completion (and pays themself
        // +3 coins on it); the room hears the hunger end, with the
        // feeder's name so the moment is visible to everyone.
        socket.emit('hungry_cat_completed', {
          questId: HUNGRY_CAT_QUEST_ID,
          windowId: res.state.windowId,
          rewardCoins: HUNGRY_CAT_REWARD_COINS,
        });
        // Quest badges v1: the badge is once ever (awardBadge is
        // idempotent) — coins come every window, the badge only
        // the first time.
        if (awardBadge(userId, HUNGRY_CAT_QUEST_ID, Date.now())) {
          io.to(roomId).emit('player_badges', { socketId: socket.id, userId, badges: badgesArrayFor(userId) });
        }
        const fedByName = rooms[roomId]?.[socket.id]?.name || null;
        io.to(roomId).emit('cat_hunger', {
          ...serializeCatHunger(res.state),
          fedByName,
          fedByUserId: userId,
        });
      }
    }
    // Cat State Persistence v1 (`sq-cat-persist-v1`): save after
    // every mutation — the pet above, and the feed (fedBy) when
    // one landed. Fire-and-forget: persistCat warns, never throws.
    persistCat(roomId);
  });

  socket.on('get_cat', async ({ roomId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    await ensureCatLoaded(roomId);
    const state = catState[roomId] || { pets: 0, asleep: false };
    socket.emit('cat_state', { pets: state.pets, asleep: state.asleep });
  });

  // HUNGRY CAT v1 (`sq-hungry-cat-v1`): a player's current hunger
  // state — answered on join / (re)connect (the client emits this
  // next to get_cat), and refreshed here so a window that opened
  // while nobody was around is live the moment someone asks. The
  // 30s tick covers players already in the room.
  socket.on('get_cat_hunger', async ({ roomId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    // Cat State Persistence v1 (`sq-cat-persist-v1`): the refresh
    // loads the persisted row first, so a window that opened
    // while nobody was around is live the moment someone asks.
    const res = await refreshRoomHunger(roomId);
    socket.emit('cat_hunger', serializeCatHunger(res.state));
  });

  // QUEST PROGRESS (Quest Wrapper v1 — one quest event from a player:
  // counts toward their own progress AND the room's shared total)
  socket.on('quest_progress', ({ roomId, questId } = {}) => {
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    const def = QUEST_DEFS[questId];
    if (!def) return;
    if (!questState[roomId]) questState[roomId] = {};
    if (!questState[roomId][questId]) questState[roomId][questId] = { shared: 0, users: {} };
    const q = questState[roomId][questId];
    if (!q.users[userId]) q.users[userId] = { count: 0, completed: false };
    const mine = q.users[userId];
    if (mine.completed) return;
    mine.count += 1;
    q.shared += 1;
    socket.emit('quest_state', { questId, count: mine.count, shared: q.shared, completed: mine.count >= def.target });
    if (mine.count >= def.target) {
      mine.completed = true;
      io.to(roomId).emit('quest_completed', { questId, userId, shared: q.shared });
      // Quest badges v1: finishing a quest earns its badge, once
      // ever — tell the room so other players see it on this
      // player's avatar right away.
      if (awardBadge(userId, questId, Date.now())) {
        io.to(roomId).emit('player_badges', { socketId: socket.id, userId, badges: badgesArrayFor(userId) });
      }
    }
  });

  // QUEST STATE (your progress + the room's shared total, sent when
  // you join — one message per quest the room has any progress on)
  socket.on('get_quest_state', ({ roomId } = {}) => {
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const room = questState[roomId] || {};
    for (const questId of Object.keys(room)) {
      const q = room[questId];
      const mine = q.users[userId] || { count: 0, completed: false };
      socket.emit('quest_state', { questId, count: mine.count, shared: q.shared, completed: mine.completed });
    }
  });

  // QUEST BADGES (Quest Completions / Badges v1,
  // `sq-quest-badges-v1`): the client re-syncs its own local
  // completions record on connect — this is what brings badges back
  // after a server restart wiped the in-memory store. The server
  // merges the record, replies with the merged record (badges_state),
  // and tells the room so other players see the badges.
  socket.on('badges_sync', ({ roomId, badges } = {}) => {
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    mergeClientBadges(userId, badges);
    // Quest badges v1.1 backfill: also award badges from the
    // server's own quest-progress store, for completions the
    // client's local record lost.
    backfillBadgesFromQuests(userId);
    socket.emit('badges_state', { userId, badges: badgesArrayFor(userId) });
    if (roomId && rooms[roomId]?.[socket.id]) {
      io.to(roomId).emit('player_badges', { socketId: socket.id, userId, badges: badgesArrayFor(userId) });
    }
  });

  // QUEST BADGES: ask for one player's badge record (by userId —
  // sockets change on reconnect). Used when opening their badges
  // panel, so it shows their freshest list.
  socket.on('get_badges', ({ userId } = {}) => {
    const target = userId || socketUserMap[socket.id] || socket.id;
    // Quest badges v1.1 backfill: award from the server's own
    // quest-progress store before replying, so a player's panel
    // shows their recovered badges too.
    backfillBadgesFromQuests(target);
    socket.emit('badges_state', { userId: target, badges: badgesArrayFor(target) });
  });

  // YOUR PLACE (Your Place v1, `sq-your-place-v1`): per-player home
  // storage. The client re-syncs its own local record on connect —
  // this is what brings stored items back after a server restart
  // wiped the in-memory store. The server merges the record
  // (add-only union by id) and replies with the merged record
  // (home_state), which the client treats as authoritative.
  // Every mutating handler re-checks that the caller is IN their
  // own home room — storage is owner-only, and only at your place.
  socket.on('home_sync', ({ roomId, items, floor } = {}) => {
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    const merged = mergeHomeItems(homeItemsFor(userId), items);
    setHomeItems(userId, merged);
    setHomeFloor(userId, mergeFloorItems(homeFloorFor(userId), floor));
    socket.emit('home_state', homeStateFor(userId));
  });

  // YOUR PLACE: ask for my own stored-items record.
  socket.on('get_home', () => {
    const userId = socketUserMap[socket.id] || socket.id;
    socket.emit('home_state', homeStateFor(userId));
  });

  // PLACES SYNC (Places Sync v1, `sq-places-sync-v1`): the client's
  // home places, keyed by owner. The owner key comes in the payload
  // — this socket has no join_room identity (the app-level socket
  // never joins a room), so it cannot use socketUserMap; the key is
  // the same client-asserted identity model as join_room's user.id.
  // Every uploaded place is validated: it must be a home room whose
  // owner matches the claimed key, so a client can only sync its
  // own places. Guest stamp keys are refused — guests stay
  // local-only by design. The reply carries the merged list plus
  // any ids that conflicted with an earlier writer (first-writer
  // wins per id). Rate-limited like the other sync handlers.
  socket.on('places_sync', ({ ownerKey, places } = {}) => {
    const key = normalizeHomeOwner(ownerKey);
    if (!key || isGuestOwnerKey(key)) return;
    const rate = checkRateLimit(key);
    if (!rate.allowed) return;
    const uploaded = (Array.isArray(places) ? places : [])
      .map((raw) => normalizePlaceRecord(raw, key))
      .filter(Boolean);
    const { places: merged, conflicts } = mergeServerPlaces(placesFor(key), uploaded, key);
    setPlaces(key, merged);
    socket.emit('places_state', { ownerKey: key, places: merged, conflicts });
  });

  // YOUR PLACE: store one pocket item at home.
  socket.on('home_store', ({ roomId, item } = {}) => {
    if (!isHomeRoom(roomId) || !rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    if (homeOwnerOf(roomId) !== normalizeHomeOwner(userId)) return;
    const clean = normalizeHomeItems([item]);
    if (!clean.length) return;
    const list = homeItemsFor(userId);
    if (!list.some((it) => it.id === clean[0].id)) list.push(clean[0]);
    setHomeItems(userId, list);
    socket.emit('home_state', homeStateFor(userId));
  });

  // YOUR PLACE: take one stored item back into the pocket.
  socket.on('home_take', ({ roomId, itemId } = {}) => {
    if (!isHomeRoom(roomId) || !rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    if (homeOwnerOf(roomId) !== normalizeHomeOwner(userId)) return;
    if (typeof itemId !== 'string' || !itemId) return;
    setHomeItems(userId, homeItemsFor(userId).filter((it) => it.id !== itemId));
    socket.emit('home_state', homeStateFor(userId));
  });

  // YOUR PLACE: unload a whole pocket/bag into storage at once.
  socket.on('home_unload_all', ({ roomId, items } = {}) => {
    if (!isHomeRoom(roomId) || !rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    if (homeOwnerOf(roomId) !== normalizeHomeOwner(userId)) return;
    const merged = mergeHomeItems(homeItemsFor(userId), items);
    setHomeItems(userId, merged);
    socket.emit('home_state', homeStateFor(userId));
  });

  // YOUR PLACE — DROP ON THE HOME FLOOR (v1, `sq-home-drop-v1`):
  // drop one pocket item on the floor of your home, at (x, y).
  // Puzzle pieces are refused (they belong on the puzzle board);
  // the position is validated and clamped by normalizeFloorItems.
  socket.on('home_drop', ({ roomId, item, x, y } = {}) => {
    if (!isHomeRoom(roomId) || !rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    if (homeOwnerOf(roomId) !== normalizeHomeOwner(userId)) return;
    const clean = normalizeFloorItems([{ ...(item || {}), x, y }]);
    if (!clean.length) return;
    const list = homeFloorFor(userId);
    if (!list.some((it) => it.id === clean[0].id)) list.push(clean[0]);
    setHomeFloor(userId, list);
    socket.emit('home_state', homeStateFor(userId));
  });

  // YOUR PLACE — DROP ON THE HOME FLOOR: pick one dropped item back
  // up off the floor (the client only does this when its pocket has
  // room; the server just removes it from the floor store).
  socket.on('home_pickup', ({ roomId, itemId } = {}) => {
    if (!isHomeRoom(roomId) || !rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    if (homeOwnerOf(roomId) !== normalizeHomeOwner(userId)) return;
    if (typeof itemId !== 'string' || !itemId) return;
    setHomeFloor(userId, homeFloorFor(userId).filter((it) => it.id !== itemId));
    socket.emit('home_state', homeStateFor(userId));
  });

  // GROUP PUZZLE (Shared Puzzle Quest v1.2,
  // `group-puzzle-v1-2-hidden-search` — Agora only). One player
  // found a piece: the room claims it together. Piece 7 (under the
  // sleeping cat) only counts while the cat naps — the server
  // enforces that, so a client cannot claim it while she is awake.
  // Piece 8 comes from a lucky coffee (client rolls 1-in-3 per
  // coffee bought); the server only guards the already-found rule.
  socket.on('puzzle_piece', async ({ roomId, pieceId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    const id = Number(pieceId);
    if (!Number.isInteger(id) || id < 0 || id > 8) return;
    if (id === 7 && !catState[roomId]?.asleep) return;
    // Puzzle persistence (`sq-puzzle-persist-v1`): load first, so a
    // collect can never land on the default fresh board while the
    // real row is still being read.
    await ensurePuzzleLoaded(roomId);
    const room = puzzleRoom(roomId);
    const res = collectPiece(room.state, id, userId);
    if (!res.ok) return;
    io.to(roomId).emit('puzzle_state', serializePuzzleState(room.state));
    persistPuzzle(roomId);
  });

  // GROUP PUZZLE PLACEMENT: one player put a found piece on the board.
  // The server re-validates (found? in-bounds?) — v1.1 FREE PLACEMENT:
  // any cell accepts the piece and it stays there, wrong or right;
  // a placed piece can be moved again, and an occupied cell swaps.
  // The room only completes when all 9 are in their home cells at
  // the same time: everyone hears about it, and a fresh puzzle
  // starts automatically after PUZZLE_RESET_MS.
  socket.on('puzzle_place', async ({ roomId, pieceId, col, row } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    // Puzzle persistence (`sq-puzzle-persist-v1`): load first, so a
    // placement can never land on the default fresh board while the
    // real row is still being read.
    await ensurePuzzleLoaded(roomId);
    const room = puzzleRoom(roomId);
    const res = placePiece(room.state, Number(pieceId), Number(col), Number(row), userId);
    if (!res.ok) return;
    io.to(roomId).emit('puzzle_state', serializePuzzleState(room.state));
    persistPuzzle(roomId);
    if (res.completed) {
      io.to(roomId).emit('puzzle_completed', {
        round: room.state.round,
        contributors: [...room.state.contributors],
      });
      // Quest badges v1: every contributor earns the Group Puzzle
      // badge, once ever — tell the room about each of them.
      for (const contributorId of [...room.state.contributors]) {
        if (awardBadge(contributorId, 'group-puzzle', Date.now())) {
          const sid = socketIdForUser(contributorId);
          if (sid) {
            io.to(roomId).emit('player_badges', { socketId: sid, userId: contributorId, badges: badgesArrayFor(contributorId) });
          }
        }
      }
      // Puzzle persistence (`sq-puzzle-persist-v1`): the fresh
      // round starts on the same 60s timer; the helper persists
      // the fresh round when it fires.
      armPuzzleResetTimer(roomId, PUZZLE_RESET_MS);
    }
  });

  // GROUP PUZZLE STATE: the room's board, sent when you join (or ask).
  socket.on('get_puzzle', async ({ roomId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    // Puzzle persistence (`sq-puzzle-persist-v1`): load first, so a
    // joiner never sees the default fresh board while the real row
    // is still being read.
    await ensurePuzzleLoaded(roomId);
    socket.emit('puzzle_state', serializePuzzleState(puzzleRoom(roomId).state));
  });

  // TRIM THE TREE (Trim the Tree v1, `sq-trim-tree-v1` — Agora
  // only; v1.2 `sq-christmas-multi-v1.2` — every hang counts).
  // One player hung an ornament on the ACTIVE tree: the server
  // counts every hang toward the 25 (no per-person cap), then
  // broadcasts the new state to the room. When the 25th counted
  // ornament lands, the tree finishes: everyone hears about it,
  // every counted contributor earns the Trim the Tree badge (once
  // ever), and tree 2 appears in the same room (or the quest ends
  // here, if tree 2 just finished — max 2 trees per venue).
  socket.on('tree_hang', async ({ roomId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    // Tree persistence (`sq-tree-persist-v1`): load first, so a
    // hang can never land on the default bare trees while the
    // real row is still being read.
    await ensureTreeLoaded(roomId);
    const room = treeRoom(roomId);
    const res = hangOrnament(room.state, userId);
    if (!res.ok) return;
    io.to(roomId).emit('tree_state', serializeTreeState(room.state));
    persistTree(roomId);
    if (res.treeFinished) {
      io.to(roomId).emit('tree_completed', {
        tree: res.tree,
        contributors: [...res.contributors],
      });
      // Quest badges v1: every counted contributor earns the Trim
      // the Tree badge, once ever — tell the room about each of them.
      for (const contributorId of [...res.contributors]) {
        if (awardBadge(contributorId, 'trim-tree', Date.now())) {
          const sid = socketIdForUser(contributorId);
          if (sid) {
            io.to(roomId).emit('player_badges', { socketId: sid, userId: contributorId, badges: badgesArrayFor(contributorId) });
          }
        }
      }
    }
  });

  // TRIM THE TREE STATE: the room's trees, sent when you join (or ask).
  socket.on('get_tree', async ({ roomId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    // Tree persistence (`sq-tree-persist-v1`): load first, so a
    // joiner never sees the default bare trees while the real row
    // is still being read.
    await ensureTreeLoaded(roomId);
    socket.emit('tree_state', serializeTreeState(treeRoom(roomId).state));
  });

  // CHRISTMAS LIGHTS (Christmas Lights v1, `sq-christmas-lights-v1`
  // — Agora only; v1.2 `sq-christmas-multi-v1.2` — every hang
  // counts; v1.4 `sq-christmas-lights-v1.4` — the bulb lights
  // nearest to where the player hung it). One player hung a light
  // string on a strand: the server counts every hang toward the
  // 25, lights the nearest unlit slot to the hang spot the client
  // sent (falling back to the first unlit slot when no spot
  // arrives), then broadcasts the new state to the room. When the
  // 25th counted string lands, the room is lit: everyone hears
  // about it, and every counted contributor earns the Christmas
  // Lights badge (once ever).
  // Persistence (`sq-lights-persist-v1`): the state is saved to
  // Postgres on every hang, so a restart restores the strands.
  socket.on('light_hang', async ({ roomId, x, y } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    // Lights persistence (`sq-lights-persist-v1`): load first, so
    // a hang can never land on the default bare strands while the
    // real row is still being read.
    await ensureLightLoaded(roomId);
    const room = lightRoom(roomId);
    // v1.4 (`sq-christmas-lights-v1.4`): the hang spot rides with
    // the emit — validated here, never trusted blindly. No usable
    // spot (an old client) falls back to the first unlit slot.
    const spot = Number.isFinite(Number(x)) && Number.isFinite(Number(y))
      ? { x: Number(x), y: Number(y) }
      : null;
    const res = hangLight(room.state, userId, spot);
    if (!res.ok) return;
    io.to(roomId).emit('lights_state', serializeLightState(room.state));
    persistLight(roomId);
    if (res.finished) {
      io.to(roomId).emit('lights_completed', {
        contributors: [...res.contributors],
      });
      // Quest badges v1: every counted contributor earns the
      // Christmas Lights badge, once ever — tell the room about
      // each of them.
      for (const contributorId of [...res.contributors]) {
        if (awardBadge(contributorId, 'christmas-lights', Date.now())) {
          const sid = socketIdForUser(contributorId);
          if (sid) {
            io.to(roomId).emit('player_badges', { socketId: sid, userId: contributorId, badges: badgesArrayFor(contributorId) });
          }
        }
      }
    }
  });

  // CHRISTMAS LIGHTS STATE: the room's strands, sent when you join (or ask).
  socket.on('get_lights', async ({ roomId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    // Lights persistence (`sq-lights-persist-v1`): load first, so
    // a joiner never sees the default bare strands while the real
    // row is still being read.
    await ensureLightLoaded(roomId);
    socket.emit('lights_state', serializeLightState(lightRoom(roomId).state));
  });

  // BUILD A SNOWMAN (Build a Snowman v1, `sq-build-snowman-v1`):
  // one player added a snowball to the snowman in Shepherd Park.
  // Every add counts toward the 15 (multi-hang from the start —
  // the same user decision as the lights/tree), then the server
  // broadcasts the new state to the room. When the 15th counted
  // snowball lands, the snowman stands: everyone hears about it,
  // and every counted contributor earns the Build a Snowman badge
  // (once ever).
  // Persistence (`sq-snowman-persist-v1`): the state is saved to
  // Postgres on every add, so a restart restores the snowman.
  socket.on('snow_add', async ({ roomId } = {}) => {
    if (!roomId || roomId !== 'shepherd-park') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    // Snowman persistence (`sq-snowman-persist-v1`): load first, so
    // an add can never land on the default bare patch while the
    // real row is still being read.
    await ensureSnowLoaded(roomId);
    const room = snowRoom(roomId);
    const res = addSnowball(room.state, userId);
    if (!res.ok) return;
    io.to(roomId).emit('snow_state', serializeSnowState(room.state));
    persistSnow(roomId);
    if (res.finished) {
      io.to(roomId).emit('snow_completed', {
        contributors: [...res.contributors],
      });
      // Quest badges v1: every counted contributor earns the
      // Build a Snowman badge, once ever — tell the room about
      // each of them.
      for (const contributorId of [...res.contributors]) {
        if (awardBadge(contributorId, 'build-a-snowman', Date.now())) {
          const sid = socketIdForUser(contributorId);
          if (sid) {
            io.to(roomId).emit('player_badges', { socketId: sid, userId: contributorId, badges: badgesArrayFor(contributorId) });
          }
        }
      }
    }
  });

  // BUILD A SNOWMAN STATE: the room's snowman, sent when you join (or ask).
  socket.on('get_snowman', async ({ roomId } = {}) => {
    if (!roomId || roomId !== 'shepherd-park') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    // Snowman persistence (`sq-snowman-persist-v1`): load first, so
    // a joiner never sees the default bare patch while the real
    // row is still being read.
    await ensureSnowLoaded(roomId);
    socket.emit('snow_state', serializeSnowState(snowRoom(roomId).state));
  });

  // SANTA HAT (Santa Hat v1, `sq-santa-hat-v1`): one hat hidden
  // behind the Christmas tree in Agora. The client counts 3 search
  // clicks behind the tree, then asks here — the server decides who
  // gets it (one hat per room). The hat goes into the finder's
  // pocket on the hat_state broadcast; a full pocket makes the
  // client give it straight back (hat_release).
  socket.on('hat_find', async ({ roomId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    await ensureHatLoaded(roomId);
    const room = hatRoom(roomId);
    const res = findHat(room.state, userId);
    if (!res.ok) return;
    await persistHat(roomId, room.state);
    io.to(roomId).emit('hat_state', serializeHatState(room.state));
  });

  // SANTA HAT PLACE: the carrier puts the hat on the cafe cat. The
  // server sets the slip-off time (30 minutes from now); the hat
  // leaves the carrier's pocket on the hat_state broadcast.
  socket.on('hat_place', async ({ roomId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    await ensureHatLoaded(roomId);
    const room = hatRoom(roomId);
    const res = placeHat(room.state, userId);
    if (!res.ok) return;
    await persistHat(roomId, room.state);
    io.to(roomId).emit('hat_state', serializeHatState(room.state));
  });

  // SANTA HAT PICKUP: anyone picks the hat up off the ground. The
  // hat goes into the picker's pocket on the hat_state broadcast.
  socket.on('hat_pickup', async ({ roomId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    await ensureHatLoaded(roomId);
    const room = hatRoom(roomId);
    const res = pickupHat(room.state, userId);
    if (!res.ok) return;
    await persistHat(roomId, room.state);
    io.to(roomId).emit('hat_state', serializeHatState(room.state));
  });

  // SANTA HAT SLIP: the hat falls off the cat. The first client to
  // notice the due slip time reports it, with its own local cat
  // position for where the hat lands — the server only accepts the
  // transition once the slip time has come, so a client cannot
  // knock it off early.
  socket.on('hat_slip', async ({ roomId, x, y } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    await ensureHatLoaded(roomId);
    const room = hatRoom(roomId);
    const res = slipHat(room.state, x, y);
    if (!res.ok) return;
    await persistHat(roomId, room.state);
    io.to(roomId).emit('hat_state', serializeHatState(room.state));
  });

  // SANTA HAT RELEASE: the carrier gives the hat back to the tree.
  // Safety valve for a client whose pocket filled in the instant
  // between check and confirm — the hat goes back to hidden
  // instead of vanishing.
  socket.on('hat_release', async ({ roomId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    await ensureHatLoaded(roomId);
    const room = hatRoom(roomId);
    const res = releaseHat(room.state, userId);
    if (!res.ok) return;
    await persistHat(roomId, room.state);
    io.to(roomId).emit('hat_state', serializeHatState(room.state));
  });

  // SANTA HAT STATE: the room's hat, sent when you join (or ask).
  socket.on('get_hat', async ({ roomId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    await ensureHatLoaded(roomId);
    socket.emit('hat_state', serializeHatState(hatRoom(roomId).state));
  });

  // SANTA'S LOST PRESENT (Santa's Lost Present v1.1,
  // `sq-santas-lost-present-v1.1`): one present hidden under
  // Table 4 in Agora, one find per player per Chicago day. The
  // client counts 3 search clicks at the spot, then asks here —
  // the server decides whether it is really today (one find per
  // player per day) and awards the badge, once ever. The +5 coins
  // are paid client-side on the present_state confirm (the
  // lights v1.2 pattern), NOT here. A refusal answers the
  // requester directly (present_result) so the client can show
  // the notice; a success broadcasts the room state so everyone
  // sees the find.
  socket.on('present_find', ({ roomId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    const today = chicagoDateString(new Date());
    const room = presentRoom(roomId);
    const res = findPresent(room.state, userId, today);
    if (!res.ok) {
      socket.emit('present_result', { ok: false, reason: res.reason, questId: PRESENT_ID });
      return;
    }
    io.to(roomId).emit('present_state', serializePresentState(room.state, today));
    // Quest badges v1: the badge is once ever (awardBadge is
    // idempotent) — coins come every daily find, the badge only
    // the first time.
    if (awardBadge(userId, PRESENT_ID, Date.now())) {
      io.to(roomId).emit('player_badges', { socketId: socket.id, userId, badges: badgesArrayFor(userId) });
    }
  });

  // SANTA'S LOST PRESENT STATE: your today status, sent when you
  // join (or ask) — whether you already found it today.
  socket.on('get_present', ({ roomId } = {}) => {
    if (!roomId || roomId !== 'agora-houston') return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const today = chicagoDateString(new Date());
    socket.emit('present_state', serializePresentState(presentRoom(roomId).state, today));
  });

  // NOTICE BOARD (Notice Board v1, `sq-notice-board-v1`; boards in
  // every location, `sq-notice-board-everywhere-v1`). Pin a flyer
  // from your pocket: the server validates the text (title up to 60
  // chars, text up to 200 — the same limits as making a flyer),
  // caps the board at NOTICE_BOARD_MAX_FLYERS (10; the oldest flyer
  // falls off when the 11th pins), and broadcasts the board so
  // every player in the room sees it. Each room has its own board
  // (noticeBoards[roomId]). Pinning is free — the 5 coins were paid
  // when the flyer was made.
  socket.on('board_pin', async ({ roomId, id, title, text } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    // Notice board persistence (`sq-notice-board-persist-v1`): load
    // first, so a pin can never land on the default empty board
    // while the real row is still being read.
    await ensureNoticeBoardLoaded(roomId);
    const room = noticeBoardRoom(roomId);
    const res = pinFlyer(room.state, {
      id,
      title,
      text,
      addedBy: userId,
      addedByName: rooms[roomId][socket.id]?.name || 'Someone',
    });
    if (!res.ok) return;
    io.to(roomId).emit('board_state', serializeNoticeBoardState(room.state));
    persistNoticeBoard(roomId);
  });

  // NOTICE BOARD REMOVAL: your own flyer, or any flyer if you are a
  // moderator (same global moderator list as the layout review
  // endpoints). The board broadcast carries the result; what happens
  // to the flyer afterwards is the client's call (back to the
  // owner's pocket if they took it down and have room, discarded
  // otherwise — a moderator removal always discards it).
  socket.on('board_remove', async ({ roomId, flyerId } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    // Notice board persistence (`sq-notice-board-persist-v1`): load
    // first, so a removal can never run against the default empty
    // board while the real row is still being read.
    await ensureNoticeBoardLoaded(roomId);
    const room = noticeBoardRoom(roomId);
    const res = removeFlyer(room.state, flyerId, userId, isGlobalModerator(userId));
    if (!res.ok) return;
    io.to(roomId).emit('board_state', serializeNoticeBoardState(room.state));
    persistNoticeBoard(roomId);
  });

  // NOTICE BOARD STATE: the room's board, sent when you join (or ask).
  socket.on('get_board', async ({ roomId } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    // Notice board persistence (`sq-notice-board-persist-v1`): load
    // first, so a joiner never sees the default empty board while
    // the real row is still being read.
    await ensureNoticeBoardLoaded(roomId);
    socket.emit('board_state', serializeNoticeBoardState(noticeBoardRoom(roomId).state));
  });

  // MAILBOX (Mailbox v1, `sq-mailbox-v1`). Send a pocket item to
  // the player with this mailbox code: the server resolves the
  // code (registry, then the auth_users fallback — see
  // registerMailCode), validates the item (cleanMailItem refuses
  // puzzle pieces, the Santa hat and the mailbox key — a raw socket
  // emit cannot smuggle one through), and puts the package in the
  // recipient's inbox. The item leaves the SENDER's pocket only
  // when this handler answers ok (mail_send_result) — an unknown
  // code, a full inbox, or a rate limit leaves the item in the
  // pocket. Gift Wrapping Paper v1 (`sq-gift-wrap-v1`): sending
  // costs one sheet of wrapping paper (2 coins a sheet at the
  // Agora bar) — the client checks its pocket and spends the sheet
  // only on this handler's ok, and the send carries `wrapped: true`.
  // This handler refuses any send without the flag ('not-wrapped'):
  // a raw socket emit cannot send an unwrapped gift. Honest limit:
  // the inventory lives client-side (localStorage), so the server
  // verifies the flag is present, not the sender's sheet count —
  // the same trust boundary as coins and pocket contents. The
  // recipient gets mail_arrived + their fresh inbox when they are
  // online; when they are offline the package simply waits in their
  // inbox until they log in and ask for it (get_mail).
  socket.on('mail_send', async ({ roomId, packageId, code, item, fromName, wrapped } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('mail_send_result', { packageId, ok: false, reason: 'rate-limited' });
      return;
    }
    registerMailCode(userId);
    const cleanCode = normalizeMailboxCode(code);
    if (!isValidMailboxCode(cleanCode)) {
      socket.emit('mail_send_result', { packageId, ok: false, reason: 'bad-code' });
      return;
    }
    let recipientId = userMailCode.get(cleanCode) || null;
    if (!recipientId) recipientId = await userIdForMailCode(cleanCode);
    if (!recipientId) {
      socket.emit('mail_send_result', { packageId, ok: false, reason: 'unknown-code' });
      return;
    }
    if (String(recipientId) === String(userId)) {
      socket.emit('mail_send_result', { packageId, ok: false, reason: 'self-send' });
      return;
    }
    const cleanItem = cleanMailItem(item);
    if (!cleanItem) {
      socket.emit('mail_send_result', { packageId, ok: false, reason: 'not-sendable' });
      return;
    }
    // sq-gift-wrap-v1 — a gift never travels unwrapped: refuse any
    // send that does not carry the wrapped flag.
    if (wrapped !== true) {
      socket.emit('mail_send_result', { packageId, ok: false, reason: 'not-wrapped' });
      return;
    }
    // Mail persistence (`sq-mail-persist-v1`): load the
    // recipient's inbox BEFORE mutating it — an offline
    // recipient's persisted mail must load first, or the save
    // below would overwrite their unread mail with only the new
    // package.
    await ensureMailLoaded(recipientId);
    const inbox = mailInboxFor(recipientId);
    const res = sendPackage(inbox, {
      id: packageId,
      fromUserId: userId,
      fromName: typeof fromName === 'string' && fromName.trim()
        ? fromName.trim().slice(0, 80)
        : (rooms[roomId][socket.id]?.name || 'Someone'),
      item: cleanItem,
      sentAt: Date.now(),
      // sq-gift-wrap-v1 — the package is stored wrapped (the
      // flag was required above), so the recipient sees 🎁.
      wrapped: true,
    });
    if (!res.ok) {
      socket.emit('mail_send_result', {
        packageId,
        ok: false,
        reason: res.reason === 'inbox-full' ? 'inbox-full' : 'bad-package',
      });
      return;
    }
    await persistMail(recipientId);
    socket.emit('mail_send_result', {
      packageId,
      ok: true,
      recipientName: playerNameForUser(recipientId),
    });
    const recipientSocketId = socketIdForUser(recipientId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('mail_arrived', { fromName: res.package.fromName });
      io.to(recipientSocketId).emit('mail_state', serializeMailState(mailInboxFor(recipientId)));
    }
  });

  // GIFT GIVER (Gift Giver v1, `sq-gift-giver-v1`). Hand a gift to
  // another player in the SAME room: offer → accept/decline →
  // recipient confirms receipt. The server relays and holds the
  // offer (in-memory, giftOffers); the clients hold the inventory
  // — the giver removes the item and spends the wrapping sheet
  // only when the recipient confirms receipt (gift_received_confirm),
  // the same pending pattern as mail_send. A raw socket emit cannot
  // send an unwrapped gift (wrapped flag required, same as mail) or
  // smuggle an unsendable item (cleanMailItem refuses puzzle
  // pieces, the Santa hat, the mailbox key and wrapping paper).
  // Honest limit, same trust boundary as mail and coins: the server
  // verifies the wrapped flag, not the giver's sheet count — the
  // inventory lives client-side. Offers die on disconnect, on
  // cancel, or after 60s (sweepGiftOffers).
  socket.on('gift_offer', ({ roomId, offerId, toSocketId, item, fromName, wrapped } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    sweepGiftOffers();
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('gift_offer_result', { offerId, ok: false, reason: 'rate-limited' });
      return;
    }
    const cleanOfferId = String(offerId || '').trim();
    if (!cleanOfferId) return;
    const to = String(toSocketId || '').trim();
    if (!to || to === socket.id) {
      socket.emit('gift_offer_result', { offerId: cleanOfferId, ok: false, reason: 'self-give' });
      return;
    }
    if (!rooms[roomId][to]) {
      socket.emit('gift_offer_result', { offerId: cleanOfferId, ok: false, reason: 'not-in-room' });
      return;
    }
    const cleanItem = cleanMailItem(item);
    if (!cleanItem) {
      socket.emit('gift_offer_result', { offerId: cleanOfferId, ok: false, reason: 'not-sendable' });
      return;
    }
    if (wrapped !== true) {
      socket.emit('gift_offer_result', { offerId: cleanOfferId, ok: false, reason: 'not-wrapped' });
      return;
    }
    giftOffers.set(cleanOfferId, {
      fromSocketId: socket.id,
      toSocketId: to,
      roomId,
      item: cleanItem,
      // sq-gift-giver-v1 — the emoji is display-only (the cleaned
      // item carries no emoji); pass the giver's through, clamped,
      // so the recipient's prompt shows the gift.
      emoji: typeof item?.emoji === 'string' ? item.emoji.slice(0, 8) : null,
      fromName: typeof fromName === 'string' && fromName.trim()
        ? fromName.trim().slice(0, 80)
        : (rooms[roomId][socket.id]?.name || 'Someone'),
      createdAt: Date.now(),
    });
    socket.emit('gift_offer_result', { offerId: cleanOfferId, ok: true });
    io.to(to).emit('gift_offered', {
      offerId: cleanOfferId,
      fromSocketId: socket.id,
      fromName: giftOffers.get(cleanOfferId).fromName,
      item: { type: cleanItem.type, label: cleanItem.label || null, emoji: giftOffers.get(cleanOfferId).emoji },
    });
  });

  // The recipient accepted: hand them the gift (from the server's
  // copy of the offer) and tell the giver it was accepted. The
  // giver's item + sheet move only when the recipient confirms
  // receipt (gift_received_confirm) — a full pocket on their side
  // (gift_receive_failed) leaves everything with the giver.
  socket.on('gift_accept', ({ roomId, offerId } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    sweepGiftOffers();
    const offer = giftOffers.get(String(offerId || ''));
    if (!offer || offer.toSocketId !== socket.id || offer.roomId !== roomId) return;
    if (!rooms[roomId][offer.fromSocketId]) {
      giftOffers.delete(String(offerId || ''));
      socket.emit('gift_offer_gone', { offerId: String(offerId || '') });
      return;
    }
    io.to(socket.id).emit('gift_received', {
      offerId: String(offerId || ''),
      item: offer.item,
      fromName: offer.fromName,
    });
    io.to(offer.fromSocketId).emit('gift_offer_accepted', {
      offerId: String(offerId || ''),
      toName: rooms[roomId][socket.id]?.name || 'them',
    });
  });

  // The recipient declined: the offer dies, nothing moves.
  socket.on('gift_decline', ({ roomId, offerId } = {}) => {
    if (!roomId) return;
    sweepGiftOffers();
    const offer = giftOffers.get(String(offerId || ''));
    if (!offer || offer.toSocketId !== socket.id || offer.roomId !== roomId) return;
    giftOffers.delete(String(offerId || ''));
    io.to(offer.fromSocketId).emit('gift_declined', { offerId: String(offerId || '') });
  });

  // The giver changed their mind before an answer: the offer dies,
  // the recipient's prompt closes silently.
  socket.on('gift_cancel', ({ roomId, offerId } = {}) => {
    if (!roomId) return;
    sweepGiftOffers();
    const offer = giftOffers.get(String(offerId || ''));
    if (!offer || offer.fromSocketId !== socket.id || offer.roomId !== roomId) return;
    giftOffers.delete(String(offerId || ''));
    io.to(offer.toSocketId).emit('gift_offer_gone', { offerId: String(offerId || '') });
  });

  // The recipient got the gift into their pocket: tell the giver to
  // remove the item, spend the sheet, and count the gift.
  socket.on('gift_received_confirm', ({ roomId, offerId } = {}) => {
    if (!roomId) return;
    sweepGiftOffers();
    const offer = giftOffers.get(String(offerId || ''));
    if (!offer || offer.toSocketId !== socket.id || offer.roomId !== roomId) return;
    giftOffers.delete(String(offerId || ''));
    io.to(offer.fromSocketId).emit('gift_confirmed', {
      offerId: String(offerId || ''),
      fromName: offer.fromName,
    });
  });

  // The recipient's pocket was full after all: the gift stays with
  // the giver — nothing spent, nothing counted.
  socket.on('gift_receive_failed', ({ roomId, offerId } = {}) => {
    if (!roomId) return;
    sweepGiftOffers();
    const offer = giftOffers.get(String(offerId || ''));
    if (!offer || offer.toSocketId !== socket.id || offer.roomId !== roomId) return;
    giftOffers.delete(String(offerId || ''));
    io.to(offer.fromSocketId).emit('gift_failed', {
      offerId: String(offerId || ''),
      reason: 'inventory-full',
    });
  });

  // MAILBOX: ask for my own inbox (on connect, and on reconnect —
  // the first state with unread mail fires the login toast).
  // Mail persistence (`sq-mail-persist-v1`): load first, so a
  // returning player sees persisted mail, not an empty inbox.
  socket.on('get_mail', async () => {
    const userId = socketUserMap[socket.id] || socket.id;
    await ensureMailLoaded(userId);
    socket.emit('mail_state', serializeMailState(mailInboxFor(userId)));
  });

  // MAILBOX: take one package out of my inbox. The package STAYS
  // in the inbox until the client confirms the item landed in the
  // pocket (mail_collect_confirm) — a full pocket can never eat a
  // gift. The client only asks when its pocket has room; the
  // server just hands the item over.
  socket.on('mail_collect', async ({ roomId, packageId } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('mail_collect_result', { packageId, ok: false, reason: 'rate-limited' });
      return;
    }
    // Mail persistence (`sq-mail-persist-v1`): load first — a
    // package in the DB must not report 'not-found'.
    await ensureMailLoaded(userId);
    const inbox = mailInboxFor(userId);
    const pkg = (inbox.packages || []).find((p) => p.id === String(packageId));
    if (!pkg) {
      socket.emit('mail_collect_result', { packageId, ok: false, reason: 'not-found' });
      return;
    }
    socket.emit('mail_collect_result', { packageId, ok: true, item: { ...pkg.item } });
  });

  // MAILBOX: the item landed in the pocket — now remove the package
  // from the inbox, and send the fresh state (dot + flag go down).
  socket.on('mail_collect_confirm', async ({ roomId, packageId } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    // Mail persistence (`sq-mail-persist-v1`): load before the
    // collect, then save the removal — otherwise a restart would
    // resurrect the collected package.
    await ensureMailLoaded(userId);
    const res = collectPackage(mailInboxFor(userId), packageId);
    if (!res.ok) return;
    await persistMail(userId);
    socket.emit('mail_state', serializeMailState(mailInboxFor(userId)));
  });

  // DECORATION SHOP (Decoration Shop v1, `sq-dec-shop-v1`). Place a
  // decoration from your pocket: the server validates the kind and
  // position, caps the room at DECOR_MAX_PER_ROOM (30 — a full room
  // REFUSES the place, so the bought item stays in the pocket), and
  // broadcasts the room so every player sees it. Each room has its
  // own decorations (decorRooms[roomId]). Buying itself is local
  // (coins + pocket on the client) — the server only owns placement.
  socket.on('decor_place', async ({ roomId, id, kind, x, y } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    // Placed decorations persistence (`sq-decor-persist-v1`): load
    // first, so a place can never land on the default empty room
    // while the real row is still being read.
    await ensureDecorLoaded(roomId);
    const room = decorRoom(roomId);
    const res = placeDecoration(room.state, {
      id,
      kind,
      x,
      y,
      addedBy: userId,
      addedByName: rooms[roomId][socket.id]?.name || 'Someone',
    });
    if (!res.ok) return;
    io.to(roomId).emit('decor_state', serializeDecorState(room.state));
    persistDecor(roomId);
  });

  // DECORATION REMOVAL: your own decoration, or any decoration if
  // you are a moderator (same global moderator list as the layout
  // review endpoints). The decor broadcast carries the result; what
  // happens to the decoration afterwards is the client's call (back
  // to the owner's pocket if they took it down and have room,
  // discarded otherwise — a moderator removal always discards it).
  socket.on('decor_remove', async ({ roomId, decorId } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    // Placed decorations persistence (`sq-decor-persist-v1`): load
    // first, so a removal can never run against the default empty
    // room while the real row is still being read.
    await ensureDecorLoaded(roomId);
    const room = decorRoom(roomId);
    const res = removeDecoration(room.state, decorId, userId, isGlobalModerator(userId));
    if (!res.ok) return;
    io.to(roomId).emit('decor_state', serializeDecorState(room.state));
    persistDecor(roomId);
  });

  // DECORATION STATE: the room's decorations, sent when you join (or ask).
  socket.on('get_decor', async ({ roomId } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    // Placed decorations persistence (`sq-decor-persist-v1`): load
    // first, so a joiner never sees the default empty room while
    // the real row is still being read.
    await ensureDecorLoaded(roomId);
    socket.emit('decor_state', serializeDecorState(decorRoom(roomId).state));
  });

  // SHARED FLOOR LITTER (Shared Floor Litter v1,
  // `sq-shared-litter-v1`): dropping a pocket item puts it on the
  // floor where you stand, visible to everyone in the room. The
  // item leaves the DROPPER's pocket only when this handler
  // answers ok (drop_item_result) — a refused drop (room full,
  // never-drop type, rate limit) leaves the item in the pocket.
  // The server stamps droppedBy / droppedByName / droppedAt
  // itself: the quest kit needs the dropper and the time, and a
  // client must not be able to fake either.
  socket.on('drop_item', ({ roomId, id, item, x, y } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    if (isHomeRoom(roomId)) {
      socket.emit('drop_item_result', { id: String(id || ''), ok: false, reason: 'not-home' });
      return;
    }
    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('drop_item_result', { id: String(id || ''), ok: false, reason: 'rate-limited' });
      return;
    }
    const restored = sweepFloorLitter(roomId);
    const room = floorLitterRoom(roomId);
    const res = addFloorLitter(room.state, {
      ...(item && typeof item === 'object' ? item : {}),
      // The envelope id wins over any id inside the snapshot, and
      // the dropper / time are server-set — a client cannot fake
      // who dropped it or when.
      id,
      x,
      y,
      droppedBy: userId,
      droppedByName: rooms[roomId][socket.id]?.name || 'Someone',
      droppedAt: Date.now(),
    });
    if (!res.ok) {
      socket.emit('drop_item_result', { id: String(id || ''), ok: false, reason: res.reason });
      if (restored) broadcastFloorLitter(roomId);
      return;
    }
    socket.emit('drop_item_result', { id: res.entry.id, ok: true });
    broadcastFloorLitter(roomId);
  });

  // FLOOR LITTER PICKUP: anyone's litter is pickable,
  // first-come-wins. The entry is CLAIMED for the picker (not
  // removed outright): the server answers with the item, and the
  // claim only settles when the picker confirms it landed in
  // their pocket (pickup_floor_item_confirm). A second picker
  // racing the same entry is told it is gone.
  socket.on('pickup_floor_item', ({ roomId, litterId } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    if (isHomeRoom(roomId)) {
      socket.emit('pickup_floor_item_result', { litterId: String(litterId || ''), ok: false, reason: 'not-home' });
      return;
    }
    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('pickup_floor_item_result', { litterId: String(litterId || ''), ok: false, reason: 'rate-limited' });
      return;
    }
    const restored = sweepFloorLitter(roomId);
    const room = floorLitterRoom(roomId);
    const res = claimFloorLitter(room.state, litterId, userId, Date.now());
    if (!res.ok) {
      socket.emit('pickup_floor_item_result', { litterId: String(litterId || ''), ok: false, reason: res.reason });
      if (restored) broadcastFloorLitter(roomId);
      return;
    }
    socket.emit('pickup_floor_item_result', {
      litterId: res.entry.id,
      ok: true,
      item: litterPocketItem(res.entry),
    });
    broadcastFloorLitter(roomId);
  });

  // FLOOR LITTER PICKUP CONFIRM: the item landed in the picker's
  // pocket — the claim settles and the entry is gone for good.
  // No broadcast needed: the floor_litter that went out at pickup
  // already shows it gone.
  socket.on('pickup_floor_item_confirm', ({ roomId, litterId } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    confirmFloorLitterClaim(floorLitterRoom(roomId).state, litterId, userId);
  });

  // FLOOR LITTER PICKUP CANCEL: the picker's pocket filled in the
  // meantime — the entry goes back on the floor, visible again.
  socket.on('pickup_floor_item_cancel', ({ roomId, litterId } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const res = cancelFloorLitterClaim(floorLitterRoom(roomId).state, litterId, userId);
    if (res.ok) broadcastFloorLitter(roomId);
  });

  // FLOOR LITTER STATE: the room's litter, sent when you join (or ask).
  socket.on('get_floor_litter', ({ roomId } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    if (sweepFloorLitter(roomId)) broadcastFloorLitter(roomId);
    socket.emit('floor_litter', serializeFloorLitterState(floorLitterRoom(roomId).state));
  });

  // NPC LITTER DROP (Catch a Litterbug v1,
  // `sq-litterbug-quest-v1`): a client reports that a Shepherd
  // Park NPC dropped a cup at its current position. The NPCs are
  // client-side — the server does not track them — so the report
  // is validated, not trusted: shepherd-park only, the label must
  // be one of the known patrollers, and a per-NPC cooldown
  // (2 minutes) dedupes the many clients rolling at once. The
  // cup goes through the SAME shared-litter path as a player
  // drop, so everyone in the room sees it (with its "!") and the
  // catch validation is uniform. Fire-and-forget: no result is
  // sent — a refused report just never appears on the floor.
  socket.on('npc_litter_drop', ({ roomId, id, npcLabel, x, y } = {}) => {
    if (!roomId || roomId !== LITTERBUG_NPC_ROOM_ID) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    if (!isLitterbugNpcLabel(npcLabel)) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    const key = `${roomId}:${npcLabel}`;
    const last = npcLitterLastDrop.get(key) || 0;
    if (Date.now() - last < LITTERBUG_NPC_COOLDOWN_MS) return;
    const restored = sweepFloorLitter(roomId);
    const room = floorLitterRoom(roomId);
    const res = addFloorLitter(room.state, {
      ...LITTERBUG_NPC_CUP,
      id,
      x,
      y,
      droppedBy: npcIdForLabel(npcLabel),
      droppedByName: String(npcLabel),
      droppedAt: Date.now(),
    });
    if (!res.ok) {
      if (restored) broadcastFloorLitter(roomId);
      return;
    }
    npcLitterLastDrop.set(key, Date.now());
    broadcastFloorLitter(roomId);
  });

  // LITTERBUG CATCH (Catch a Litterbug v1,
  // `sq-litterbug-quest-v1`): tapping FRESH litter (within 15s of
  // the drop) catches the litterer. The server validates against
  // the room's floor-litter state — the entry must exist, be
  // fresh, and not be the catcher's own. On success the room is
  // told who got caught (so every client can show the 🚨
  // LITTERBUG! label) and the catcher gets an ok to record quest
  // progress. The litter STAYS on the floor — a catch is not
  // cleanup — and more than one witness can catch the same litter.
  socket.on('litterbug_catch', ({ roomId, litterId } = {}) => {
    if (!roomId) return;
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('litterbug_catch_result', { litterId: String(litterId || ''), ok: false, reason: 'rate-limited' });
      return;
    }
    sweepFloorLitter(roomId);
    const room = floorLitterRoom(roomId);
    const res = validateLitterbugCatch(room.state, litterId, userId, Date.now());
    if (!res.ok) {
      socket.emit('litterbug_catch_result', { litterId: String(litterId || ''), ok: false, reason: res.reason });
      return;
    }
    const entry = res.entry;
    const catcherName = rooms[roomId][socket.id]?.name || 'Someone';
    io.to(roomId).emit('litterbug_caught', {
      roomId,
      litterId: entry.id,
      littererId: entry.droppedBy,
      littererName: entry.droppedByName,
      catcherId: userId,
      catcherName,
      npc: isNpcLitter(entry),
    });
    socket.emit('litterbug_catch_result', { litterId: entry.id, ok: true });
  });

  // DAY/NIGHT: answer with the canonical phase (see currentTimePhase
  // above). Clients also get it via the per-minute broadcast.
  socket.on('get_time_phase', () => {
    socket.emit('time_phase', currentTimePhase());
  });

  // BUY DRINK (bar counter treat — buyer pays from their local wallet;
  // the room just sees the toast, rate-limited like duck feeding)
  // A player ordered a drink at the bar: everyone else's bartender
  // queues the serve so the whole room sees it happen in order.
  socket.on('order_drink', ({ roomId, beer } = {}) => {
    if (!roomId) return;
    const label = typeof beer === 'string' && beer.length > 0 && beer.length <= 40 ? beer : undefined;
    socket.to(roomId).emit('drink_ordered', { socketId: socket.id, beer: label });
  });

  socket.on('buy_drink', ({ roomId } = {}) => {
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) return;
    socket.to(roomId).emit('player_drank', { socketId: socket.id });
  });

  // SHELF BOOKS (library: browse a shelf, read book cards, add books)
  socket.on('get_shelf_books', async ({ roomId, shelf }) => {
    if (!roomId || !shelf) return;
    const list = await loadShelfBooks(roomId);
    socket.emit('shelf_books', { shelf: String(shelf), books: list.filter((b) => b.shelf === shelf) });
  });

  socket.on('add_book', async ({ roomId, shelf, title, author, blurb }) => {
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('book_error', { message: 'Whoa, slow down — try again in a bit.' });
      return;
    }
    const cleanTitle = String(title || '').trim().slice(0, 120);
    const cleanAuthor = String(author || '').trim().slice(0, 120);
    const cleanBlurb = String(blurb || '').trim().slice(0, 500);
    const cleanShelf = String(shelf || '').trim().slice(0, 80);
    if (!cleanTitle || !cleanShelf) {
      socket.emit('book_error', { message: 'A book needs at least a title.' });
      return;
    }
    const list = await loadShelfBooks(roomId);
    const book = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      shelf: cleanShelf,
      title: cleanTitle,
      author: cleanAuthor,
      blurb: cleanBlurb,
      addedBy: userId,
      addedByName: rooms[roomId][socket.id]?.name || 'Someone',
      createdAt: new Date().toISOString(),
    };
    list.push(book);
    await saveShelfBook(roomId, book);
    io.in(roomId).emit('book_added', { roomId, shelf: cleanShelf, book });
  });

  // JUKEBOX (bar: shared song queue — now playing, voting, skips)
  socket.on('get_jukebox', async ({ roomId }) => {
    if (!roomId || !rooms[roomId]) return;
    const st = await loadJukebox(roomId);
    if (!st.nowPlaying) {
      advanceJukebox(roomId);
    } else {
      const userId = socketUserMap[socket.id] || socket.id;
      socket.emit('jukebox_state', publicJukeboxState(roomId, userId));
    }
  });

  socket.on('add_song', async ({ roomId, title, artist, youtubeUrl }) => {
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('song_error', { message: 'Whoa, slow down — try again in a bit.' });
      return;
    }
    const youtubeVideoId = extractYouTubeId(youtubeUrl);
    const cleanTitle = String(title || '').trim().slice(0, 120);
    const cleanArtist = String(artist || '').trim().slice(0, 120);
    if (!cleanTitle && !youtubeVideoId) {
      socket.emit('song_error', { message: 'A song needs at least a title or a YouTube link.' });
      return;
    }
    if (youtubeUrl && !youtubeVideoId) {
      socket.emit('song_error', { message: "That doesn't look like a YouTube link." });
      return;
    }
    const st = await loadJukebox(roomId);
    const song = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: cleanTitle,
      artist: cleanArtist,
      votes: 0,
      addedBy: userId,
      addedByName: rooms[roomId][socket.id]?.name || 'Someone',
      votedBy: new Set(),
      createdAt: Date.now(),
      youtubeVideoId: youtubeVideoId || null,
    };
    st.queue.push(song);
    await saveJukeboxSong(roomId, song);
    if (!st.nowPlaying || st.nowPlaying.id === DEFAULT_JUKEBOX_SONG.id) {
      // Nothing playing — or only the house song, which always yields
      // the moment someone picks a song of their own.
      advanceJukebox(roomId);
    } else {
      broadcastJukebox(roomId);
    }
    socket.emit('song_added', { roomId, song: { id: song.id, title: song.title, artist: song.artist } });
  });

  socket.on('youtube_ended', ({ roomId, songId }) => {
    if (!roomId || !rooms[roomId] || !rooms[roomId][socket.id]) return;
    const st = jukeboxRooms[roomId];
    if (st && st.nowPlaying && st.nowPlaying.id === songId) {
      advanceJukebox(roomId);
    }
  });

  socket.on('vote_song', async ({ roomId, songId }) => {
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const st = await loadJukebox(roomId);
    const song = st.queue.find((s) => s.id === songId);
    if (!song) return;
    if (song.votedBy.has(userId)) return; // one vote per user per song
    song.votedBy.add(userId);
    song.votes += 1;
    await saveJukeboxSong(roomId, song);
    sortJukeboxQueue(st.queue);
    broadcastJukebox(roomId);
    // Jukebox Persistence v1 (`sq-jukebox-persist-v1`): the votes
    // count already persists via the songs table, but who voted
    // lives only in the now-playing row — save it here, or a
    // restart would let the same user vote twice on one song.
    persistJukebox(roomId);
  });

  socket.on('skip_song', async ({ roomId }) => {
    if (!rooms[roomId] || !rooms[roomId][socket.id]) return;
    const userId = socketUserMap[socket.id] || socket.id;
    const st = jukeboxRooms[roomId];
    if (!st || !st.nowPlaying) return;
    const np = st.nowPlaying;
    // Skipping the house song benches it for a while — otherwise it
    // would just restart itself the moment it's skipped.
    const benchDefault = () => {
      if (np.id === DEFAULT_JUKEBOX_SONG.id) st.defaultCooldownUntil = Date.now() + 5 * 60 * 1000;
    };
    // The person who queued it can skip it outright.
    if (np.addedBy === userId) {
      benchDefault();
      advanceJukebox(roomId);
      return;
    }
    np.skipVotes.add(userId);
    // Jukebox Solo Skip v1 (`sq-jukebox-solo-skip-v1`): one vote is
    // enough when the voter is alone in the room — two votes would
    // be unreachable. Otherwise the usual 2 distinct votes.
    const roomSize = Object.keys(rooms[roomId]).length;
    if (shouldSkipSong({ skipVotes: np.skipVotes.size, roomSize, isAdder: false })) {
      benchDefault();
      advanceJukebox(roomId);
    } else {
      broadcastJukebox(roomId);
      // Jukebox Persistence v1 (`sq-jukebox-persist-v1`): a skip
      // vote changed the restored snapshot — save it, or a restart
      // would forget the first vote and the song would need two
      // fresh ones to skip.
      persistJukebox(roomId);
    }
  });

  // PLACE DECORATION
  socket.on('place_decoration', async ({ roomId, item }) => {    const userId = socketUserMap[socket.id] || socket.id;
    const permissions = getVenuePermissions(roomId, userId);
    const isCreator = socketCreatorRooms[socket.id]?.has(roomId) || permissions.canManage;
    const rate = isCreator ? checkCreatorRate(userId, roomId) : checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('decoration_error', { message: `Limit reached. Resets in ~${rate.resetInMinutes}m.` });
      return;
    }
    if (!isCreator) {
      const daily = checkDailyEditLimit(userId, roomId);
      if (!daily.allowed) {
        socket.emit('decoration_error', { message: `Daily edit limit reached (${DAILY_EDIT_LIMIT}/day). Resets in ~${daily.resetInMinutes}m.` });
        return;
      }
    }
    if (!decorations[roomId]) decorations[roomId] = [];
    const decoration = { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, placedBy: userId };
    decorations[roomId].push(decoration);
    await saveDecoration(roomId, decoration);
    io.in(roomId).emit('decoration_placed', decoration);
    socket.emit('decoration_quota', { remaining: rate.remaining, isCreator: rate.isCreator || false });
  });

  // REMOVE DECORATION
  socket.on('remove_decoration', async ({ roomId, id }) => {
    const userId = socketUserMap[socket.id] || socket.id;
    const decoration = decorations[roomId]?.find(d => d.id === id);
    if (!decoration) return;
    const permissions = getVenuePermissions(roomId, userId);
    if (decoration.placedBy !== userId && !permissions.canManage) {
      socket.emit('decoration_error', { message: 'You can only remove items you placed.' });
      return;
    }
    const isCreator = socketCreatorRooms[socket.id]?.has(roomId) || permissions.canManage;
    const rate = isCreator ? checkCreatorRate(userId, roomId) : checkRateLimit(userId);
    if (!rate.allowed) {
      socket.emit('decoration_error', { message: `Limit reached. Resets in ~${rate.resetInMinutes}m.` });
      return;
    }
    decorations[roomId] = decorations[roomId].filter(d => d.id !== id);
    await deleteDecoration(id);
    io.in(roomId).emit('decoration_removed', { id });
    socket.emit('decoration_quota', { remaining: rate.remaining, isCreator: rate.isCreator || false });
  });

  // CHAT MESSAGE (Speech Bubbles)
  socket.on('send_message', ({ roomId, message }) => {
    const player = rooms[roomId]?.[socket.id];

    if (!player) return;

    // Broadcast text + sender position for spatial distance filtering
    io.in(roomId).emit('receive_message', {
      socketId: socket.id,
      senderName: player.name,
      message,
      position: { x: player.x, y: player.y },
      timestamp: Date.now(),
    });

    const characterId = roomCharacterMap[roomId];
    if (characterId) {
      askInworldCharacter(roomId, characterId, message)
        .then((reply) => {
          io.in(roomId).emit('npc_reply', { roomId, message: reply, timestamp: Date.now() });
        })
        .catch((err) => {
          console.error('❌ Inworld reply failed:', err.message);
          // Don't leave the room hanging: the NPC says *something*, throttled
          // so a dead API doesn't spam the room on every message.
          const now = Date.now();
          if (now - (npcFallbackTimestamps[roomId] || 0) < NPC_FALLBACK_COOLDOWN_MS) return;
          npcFallbackTimestamps[roomId] = now;
          io.in(roomId).emit('npc_reply', {
            roomId,
            message: 'Sorry — I lost my train of thought. Say that again?',
            timestamp: now,
          });
        });
    }
  });

  // AI reply for VillageScene.js's static, walk-around NPCs (one-to-one, not broadcast to the room).
  socket.on('npc_chat', async ({ npcId, npcName, layoutId, isOutdoor, roomId, message, playerId, playerName, timeOfDay }) => {
    if (!npcId || !message) return;
    // Guarantee the client always gets an answer: if anything in the chain
    // hangs, send the graceful fallback instead of silence.
    let settled = false;
    const replyTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.emit('npc_chat_reply', { npcId, error: true, timestamp: Date.now() });
    }, 35000);
    const done = () => { settled = true; clearTimeout(replyTimer); };
    try {
      const profile = resolveNpcCharacterProfile({ npcName, layoutId, isOutdoor });
      const relationshipState = deriveRelationshipState({
        userMessage: message,
        previousScore: 0,
        previousAffinity: 0.5,
        previousTrust: 0.5,
        personalityProfile: profile,
      });
      const mood = getTimeOfDayMood(timeOfDay || new Date());
      const resolvedRoomId = roomId || npcId;
      const venueEvents = getVenueEvents(resolvedRoomId, new Date());
      const persona = buildNpcPersona({ npcName, layoutId, isOutdoor, relationshipState, timeOfDay: mood, venueEvents });
      const resolvedPlayerId = playerId || socketUserMap[socket.id];
      const resolvedPlayerName = playerName || rooms[resolvedRoomId]?.[socket.id]?.name || 'Guest';
      const memoryFacts = await loadNpcMemory({
        npcId,
        playerId: resolvedPlayerId,
        playerName: resolvedPlayerName,
        roomId: resolvedRoomId,
      });

      const reply = await askInworldCharacter(npcId, persona, message, {
        npcId,
        roomId: resolvedRoomId,
        playerId: resolvedPlayerId,
        playerName: resolvedPlayerName,
        memoryFacts,
        skipFileMemory: Boolean(pool),
      });

      const summary = createMemorySummary({
        playerName: resolvedPlayerName,
        userMessage: message,
        assistantReply: reply,
      });
      const nextRelationshipState = deriveRelationshipState({
        userMessage: message,
        previousScore: relationshipState.relationshipScore,
        previousAffinity: relationshipState.affinity,
        previousTrust: relationshipState.trust,
        personalityProfile: profile,
      });
      const nextFacts = normalizeMemoryFacts([
        ...memoryFacts,
        { fact: summary },
        { fact: `Relationship with ${resolvedPlayerName || 'this player'} is ${nextRelationshipState.mood}.` },
        { fact: `This NPC's profile is ${profile.profileLabel}.` },
      ]).slice(-MAX_MEMORY_FACTS_PER_PLAYER);
      await saveNpcMemory({
        npcId,
        playerId: resolvedPlayerId,
        playerName: resolvedPlayerName,
        roomId: resolvedRoomId,
        facts: nextFacts,
      });

      if (settled) return; // safety timer already answered
      done();
      socket.emit('npc_chat_reply', { npcId, message: reply, timestamp: Date.now() });
    } catch (err) {
      console.error('❌ Inworld NPC chat failed:', err.message);
      if (settled) return; // safety timer already answered
      done();
      socket.emit('npc_chat_reply', { npcId, error: true, timestamp: Date.now() });
    }
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    delete socketUserMap[socket.id];
    // sq-gift-giver-v1 — any live gift offer involving this socket
    // dies, and the other side's prompt/pending state clears.
    dropGiftOffersFor(socket.id);
    removePresence(socket.id).catch(() => {});
    delete socketCreatorRooms[socket.id];
    Object.keys(rooms).forEach((roomId) => {
      if (rooms[roomId][socket.id]) {
        delete rooms[roomId][socket.id];
        io.in(roomId).emit('player_left', { socketId: socket.id });
      }
    });
    broadcastRoomCounts();
  });
});

// 3. Serve Compiled React Static Production Files
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Community locations REST API
app.get('/api/community-locations', async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const { rows } = await pool.query('SELECT * FROM community_locations ORDER BY created_at DESC LIMIT 1000');
    res.json(rows);
  } catch { res.json([]); }
});

app.get('/api/venue-events', async (req, res) => {
  const roomId = String(req.query.roomId || '');
  if (!roomId) return res.json([]);
  if (!pool) return res.json(getVenueEvents(roomId));
  try {
    const { rows } = await pool.query(
      'SELECT id, room_id AS "roomId", title, description, starts_at AS "startsAt", ends_at AS "endsAt", activity_level AS "activityLevel", mood, creator FROM venue_events WHERE room_id = $1 AND ends_at > NOW() ORDER BY starts_at ASC LIMIT 20',
      [roomId]
    );
    const eventsById = new Map([...getVenueEvents(roomId), ...rows].map((event) => [event.id, event]));
    res.json([...eventsById.values()].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)));
  } catch { res.json(getVenueEvents(roomId)); }
});

app.get('/api/venue-permissions', (req, res) => {
  const roomId = String(req.query.roomId || '');
  const actorId = String(req.query.actorId || '');
  res.json(getVenuePermissions(roomId, actorId));
});

// Layout submissions — builders submit, global moderators review.
app.post('/api/layout-submissions', async (req, res) => {
  try {
    const { roomId, roomName, submitter, submitterName, layout } = req.body || {};
    if (!roomId || !layout || typeof layout !== 'object') {
      return res.status(400).json({ error: 'roomId and layout are required.' });
    }
    const record = await createLayoutSubmission({ roomId, roomName, submitter, submitterName, layout });
    console.log(`📐 Layout submitted for ${record.roomId} by ${record.submitterName || record.submitter || 'unknown'}`);
    res.status(201).json({ ok: true, id: record.id });
  } catch (err) {
    console.warn('layout submission failed:', err && err.message);
    res.status(500).json({ error: 'Could not save submission.' });
  }
});

app.get('/api/layout-submissions', async (req, res) => {
  try {
    const actorId = String(req.query.actorId || '');
    if (!isGlobalModerator(actorId)) return res.status(403).json({ error: 'Moderators only.' });
    const items = await listPendingLayoutSubmissions();
    res.json({ ok: true, items });
  } catch (err) {
    console.warn('layout queue fetch failed:', err && err.message);
    res.status(500).json({ error: 'Could not load queue.' });
  }
});

app.post('/api/layout-submissions/:id/approve', async (req, res) => {
  try {
    const actorId = String((req.body && req.body.actorId) || req.query.actorId || '');
    if (!isGlobalModerator(actorId)) return res.status(403).json({ error: 'Moderators only.' });
    const rec = await reviewLayoutSubmission(req.params.id, true, actorId);
    if (!rec) return res.status(404).json({ error: 'Submission not found or already reviewed.' });
    console.log(`✅ Layout approved for ${rec.roomId} by ${actorId}`);
    res.json({ ok: true, submission: rec });
  } catch (err) {
    console.warn('layout approve failed:', err && err.message);
    res.status(500).json({ error: 'Could not approve.' });
  }
});

app.post('/api/layout-submissions/:id/reject', async (req, res) => {
  try {
    const actorId = String((req.body && req.body.actorId) || req.query.actorId || '');
    if (!isGlobalModerator(actorId)) return res.status(403).json({ error: 'Moderators only.' });
    const rec = await reviewLayoutSubmission(req.params.id, false, actorId);
    if (!rec) return res.status(404).json({ error: 'Submission not found or already reviewed.' });
    console.log(`❌ Layout rejected for ${rec.roomId} by ${actorId}`);
    res.json({ ok: true, submission: rec });
  } catch (err) {
    console.warn('layout reject failed:', err && err.message);
    res.status(500).json({ error: 'Could not reject.' });
  }
});

app.get('/api/room-layout/:roomId', async (req, res) => {
  try {
    const rec = await getApprovedLayout(req.params.roomId);
    if (!rec) return res.status(404).json({ error: 'No approved layout for this room.' });
    res.json({ ok: true, ...rec });
  } catch (err) {
    console.warn('approved layout fetch failed:', err && err.message);
    res.status(500).json({ error: 'Could not load approved layout.' });
  }
});

// agora-clear-approved-v1: moderator-only. Revoke the approved layout for a
// room (status 'revoked', history kept) so the built-in layout renders again.
app.post('/api/room-layout/:roomId/clear', async (req, res) => {
  try {
    const actorId = String((req.body && req.body.actorId) || req.query.actorId || '');
    if (!isGlobalModerator(actorId)) return res.status(403).json({ error: 'Moderators only.' });
    const cleared = await clearApprovedLayout(req.params.roomId, actorId);
    if (!cleared || cleared.length === 0) {
      return res.status(404).json({ error: 'No approved layout for this room.' });
    }
    console.log(`🧹 Approved layout cleared for ${req.params.roomId} by ${actorId} (${cleared.length} submission(s) revoked)`);
    res.json({ ok: true, roomId: req.params.roomId, cleared: cleared.length, submissions: cleared });
  } catch (err) {
    console.warn('approved layout clear failed:', err && err.message);
    res.status(500).json({ error: 'Could not clear approved layout.' });
  }
});

app.post('/api/venue-events', async (req, res) => {
  const { roomId, title, description, startsAt, endsAt, creator } = req.body || {};
  const permissions = getVenuePermissions(roomId, creator);
  if (!permissions.canManage) return res.status(403).json({ error: 'Only a venue moderator or owner can manage events.' });
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (!roomId || !title || !description || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return res.status(400).json({ error: 'Provide a title, description, valid start time, and later end time.' });
  }
  const event = addVenueEvent({ id: `event-${Date.now()}`, roomId, title, description, startsAt: start, endsAt: end, creator });
  if (!event) return res.status(400).json({ error: 'Invalid event.' });
  if (pool) {
    await pool.query(
      'INSERT INTO venue_events (id, room_id, title, description, starts_at, ends_at, activity_level, mood, creator) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [event.id, roomId, event.title, event.description, start, end, event.activityLevel, event.mood, event.creator]
    );
  }
  io.to(roomId).emit('venue_event_added', event);
  res.status(201).json(event);
});

app.delete('/api/venue-events/:id', async (req, res) => {
  const actorId = String(req.query.actorId || '');
  if (!pool) return res.status(404).json({ error: 'Event storage is unavailable.' });
  const existing = await pool.query('SELECT room_id AS "roomId" FROM venue_events WHERE id = $1', [req.params.id]);
  const permissions = getVenuePermissions(existing.rows[0]?.roomId, actorId);
  if (!permissions.canManage) return res.status(403).json({ error: 'Only a venue moderator or owner can remove events.' });
  const { rows } = await pool.query('DELETE FROM venue_events WHERE id = $1 RETURNING id, room_id AS "roomId"', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Event not found.' });
  res.json({ ok: true, ...rows[0] });
});

app.get('/health', (req, res) => {
  res.json({ db: !!pool, env: !!process.env.DATABASE_URL });
});

// Debug: test Inworld API directly
app.get('/debug/inworld', async (req, res) => {
  try {
    const { askInworldCharacter, resolveNpcCharacterProfile, deriveRelationshipState, getTimeOfDayMood, buildNpcPromptFromProfile } = await import('../lib/inworld.js');
    // Test full NPC flow like npc_chat handler does
    const profile = resolveNpcCharacterProfile({ npcName: 'TestNPC', layoutId: 'lolas-depot', isOutdoor: false });
    const relationshipState = deriveRelationshipState({
      userMessage: 'hello',
      previousScore: 0, previousAffinity: 0.5, previousTrust: 0.5,
      personalityProfile: profile,
    });
    const persona = buildNpcPromptFromProfile(profile, relationshipState, getTimeOfDayMood(new Date()), []);
    const reply = await askInworldCharacter('test-npc', persona, 'hello', {
      npcId: 'test-npc', roomId: 'lolas-depot',
      playerId: 'test', playerName: 'Tester',
      memoryFacts: [], skipFileMemory: true,
    });
    res.json({ ok: true, reply });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});
registerAuthRoutes(app, authService);

app.post('/api/geofence/check', (req, res) => {
  const lat = Number(req.body?.latitude);
  const lng = Number(req.body?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Invalid latitude/longitude' });
  }

  const match = findRoomByLocation(lat, lng);
  if (!match?.room) {
    return res.json({ accessGranted: false, venue: null });
  }

  const room = match.room;
  return res.json({
    accessGranted: true,
    distanceMeters: match.distance,
    venue: {
      id: room.id,
      name: room.name,
      lat: room.lat,
      lng: room.lng,
      radiusMeters: room.radiusMeters,
      kind: room.kind,
      contributors: room.contributors,
      activeLayout: buildAutoLayout(room.id, room.name, room.amenityTag || '', room.shopTag || '', room.roomShape || null),
    },
  });
});

const BOOK_GENRES = {
  philosophy: { query: 'philosophy', nytList: 'hardcover-nonfiction' },
  nonfiction: { query: 'nonfiction', nytList: 'hardcover-nonfiction' },
  manga: { query: 'manga', nytList: null },
  humor: { query: 'humor', nytList: 'hardcover-fiction' },
  'science-fiction': { query: 'science fiction', nytList: 'hardcover-fiction' },
};

const CURATED_BOOK_FALLBACKS = {
  philosophy: { title: "Sophie's World", author: 'Jostein Gaarder' },
  nonfiction: { title: 'The Wager', author: 'David Grann' },
  manga: { title: 'Frieren: Beyond Journey’s End', author: 'Kanehito Yamada and Tsukasa Abe' },
  humor: { title: "The Hitchhiker's Guide to the Galaxy", author: 'Douglas Adams' },
  'science-fiction': { title: 'Project Hail Mary', author: 'Andy Weir' },
};

app.get('/api/library/recommendation', async (req, res) => {
  const genre = String(req.query?.genre || '').toLowerCase();
  const genreConfig = BOOK_GENRES[genre];
  if (!genreConfig) return res.status(400).json({ error: 'Unsupported book genre.' });

  try {
    if (process.env.NYT_BOOKS_API_KEY && genreConfig.nytList) {
      const nytResponse = await fetch(`https://api.nytimes.com/svc/books/v3/lists/current/${genreConfig.nytList}.json?api-key=${encodeURIComponent(process.env.NYT_BOOKS_API_KEY)}`);
      const nytData = await nytResponse.json();
      const book = nytData?.results?.books?.[0];
      if (nytResponse.ok && book?.title) {
        return res.json({
          title: book.title,
          author: book.author,
          description: book.description || '',
          source: 'New York Times Best Sellers',
          signal: `Currently ranked #${book.rank || 1} on the ${genreConfig.nytList.replace(/-/g, ' ')} list.`,
        });
      }
    }

    const booksResponse = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(genreConfig.query)}&orderBy=relevance&maxResults=12&printType=books`);
    const booksData = await booksResponse.json();
    const candidates = (booksData?.items || [])
      .map((item) => item.volumeInfo || {})
      .filter((book) => book.title && book.authors?.length)
      .sort((a, b) => ((Number(b.averageRating) || 0) * Math.log10((Number(b.ratingsCount) || 0) + 1)) - ((Number(a.averageRating) || 0) * Math.log10((Number(a.ratingsCount) || 0) + 1)));
    const book = candidates[0];
    if (!booksResponse.ok || !book) {
      const openLibraryResponse = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(genreConfig.query)}&limit=12&fields=title,author_name,ratings_average,ratings_count,edition_count`);
      const openLibraryData = await openLibraryResponse.json();
      const openBook = (openLibraryData?.docs || [])
        .filter((entry) => entry.title && entry.author_name?.length)
        .sort((a, b) => ((Number(b.ratings_average) || 0) * Math.log10((Number(b.ratings_count) || 0) + 1)) - ((Number(a.ratings_average) || 0) * Math.log10((Number(a.ratings_count) || 0) + 1)))[0];
      if (openLibraryResponse.ok && openBook) {
        const rating = Number(openBook.ratings_average);
        const ratingsCount = Number(openBook.ratings_count) || 0;
        return res.json({
          title: openBook.title,
          author: openBook.author_name.slice(0, 2).join(', '),
          source: 'Open Library',
          signal: rating ? `${rating.toFixed(1)}/5 from ${ratingsCount.toLocaleString()} reader ratings across ${Number(openBook.edition_count) || 1} editions.` : `Selected from relevant ${genre.replace(/-/g, ' ')} catalog results.`,
        });
      }
      const fallback = CURATED_BOOK_FALLBACKS[genre];
      return res.json({
        ...fallback,
        source: 'Library staff pick',
        signal: 'Live popularity sources are temporarily unavailable; this is a curated genre recommendation.',
      });
    }

    const rating = Number(book.averageRating);
    const ratingsCount = Number(book.ratingsCount) || 0;
    return res.json({
      title: book.title,
      author: book.authors.join(', '),
      description: book.description || '',
      source: 'Google Books',
      signal: rating ? `${rating.toFixed(1)}/5 from ${ratingsCount.toLocaleString()} reader ratings, selected from relevant ${genre.replace(/-/g, ' ')} results.` : `Selected from relevant ${genre.replace(/-/g, ' ')} results.`,
    });
  } catch (error) {
    res.status(502).json({ error: error?.message || 'Book recommendation lookup failed.' });
  }
});

async function fetchOverpassJson(query, options = {}) {
  const timeoutMs = Math.max(3000, Number(options?.timeoutMs) || 5000);
  const endpoints = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      // Prefer form-encoded POST for broader Overpass compatibility.
      let response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json',
          'User-Agent': 'side-quest-backend/1.0',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      // Some mirrors still expect GET query format.
      if (!response.ok) {
        response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'side-quest-backend/1.0',
          },
          signal: controller.signal,
        });
      }

      clearTimeout(timeout);
      if (!response.ok) continue;
      const data = await response.json();
      if (Array.isArray(data?.elements)) return data;
    } catch {
      continue;
    }
  }

  throw new Error('All Overpass endpoints failed');
}

function dedupeByTypeAndId(elements = []) {
  const seen = new Set();
  const merged = [];
  elements.forEach((element) => {
    const key = `${String(element?.type || '')}:${String(element?.id || '')}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(element);
  });
  return merged;
}

function buildIndoorOverpassQuery(lat, lng, radius, mode = 'strict') {
  const ar = `(around:${radius},${lat},${lng})`;
  const strictBlocks = [
    `node["indoor"]${ar};`,
    `way["indoor"]${ar};`,
    `relation["indoor"]${ar};`,
    `node["indoor"~"room|corridor|area|wall|door|entrance|stairs|stair|escalator|lift|atrium|void"]${ar};`,
    `way["indoor"~"room|corridor|area|wall|door|entrance|stairs|stair|escalator|lift|atrium|void"]${ar};`,
    `relation["indoor"~"room|corridor|area|wall|door|entrance|stairs|stair|escalator|lift|atrium|void"]${ar};`,
    `way["building:part"]${ar};`,
    `relation["building:part"]${ar};`,
    `way["building:levels"]${ar};`,
    `relation["building:levels"]${ar};`,
    `way["level"]${ar};`,
    `relation["level"]${ar};`,
    `way["min_level"]${ar};`,
    `relation["min_level"]${ar};`,
    `way["max_level"]${ar};`,
    `relation["max_level"]${ar};`,
    `way["repeat_on"]${ar};`,
    `relation["repeat_on"]${ar};`,
  ];

  const broaderBlocks = [
    `node["room"]${ar};`,
    `way["room"]${ar};`,
    `relation["room"]${ar};`,
    `node["amenity"~"library|reading_room|study_room|toilets|information|cafe"]${ar};`,
    `way["amenity"~"library|reading_room|study_room|toilets|information|cafe"]${ar};`,
    `relation["amenity"~"library|reading_room|study_room|toilets|information|cafe"]${ar};`,
    `node["shop"="books"]${ar};`,
    `way["shop"="books"]${ar};`,
    `node["highway"="steps"]${ar};`,
    `way["highway"="steps"]${ar};`,
    `node["furniture"~"table|chair|seat|bench|couch|sofa|stool|desk|bookshelf|bookcase"]${ar};`,
    `way["furniture"~"table|chair|seat|bench|couch|sofa|stool|desk|bookshelf|bookcase"]${ar};`,
    `node["furniture"~"cabinet|shelf|study_desk"]${ar};`,
    `way["furniture"~"cabinet|shelf|study_desk"]${ar};`,
    `node["amenity"~"table|chair|bench"]${ar};`,
    `way["amenity"~"table|chair|bench"]${ar};`,
    `node["entrance"]${ar};`,
    `way["entrance"]${ar};`,
    `relation["entrance"]${ar};`,
  ];

  const widerBlocks = [
    `way["building"]${ar};`,
    `relation["building"]${ar};`,
    `way["building"~"yes|public|civic|university|college|library"]${ar};`,
    `relation["building"~"yes|public|civic|university|college|library"]${ar};`,
    `node["amenity"~"library|reading_room|study_room|college|university|school"]${ar};`,
    `way["amenity"~"library|reading_room|study_room|college|university|school"]${ar};`,
    `relation["amenity"~"library|reading_room|study_room|college|university|school"]${ar};`,
    `node["room"~"study|classroom|library|reading_room|lounge"]${ar};`,
    `way["room"~"study|classroom|library|reading_room|lounge"]${ar};`,
    `relation["room"~"study|classroom|library|reading_room|lounge"]${ar};`,
    `node["highway"~"corridor|footway|steps"]${ar};`,
    `way["highway"~"corridor|footway|steps"]${ar};`,
    `relation["highway"~"corridor|footway|steps"]${ar};`,
  ];

  let blocks;
  if (mode === 'strict') {
    blocks = strictBlocks.concat(broaderBlocks.slice(8));
  } else if (mode === 'broad') {
    blocks = strictBlocks.concat(broaderBlocks);
  } else {
    blocks = strictBlocks.concat(broaderBlocks).concat(widerBlocks);
  }
  return [`[out:json][timeout:14];(`, ...blocks, `);out body geom tags;`].join('');
}

const nearbyPlacesCache = new Map();
const NEARBY_CACHE_TTL_MS = 3 * 60 * 1000;

function makeNearbyCacheKey(lat, lng, radius) {
  const latKey = Number(lat).toFixed(4);
  const lngKey = Number(lng).toFixed(4);
  const radiusKey = String(Number(radius) || 1000);
  return `${latKey}:${lngKey}:${radiusKey}`;
}

function findNearbyCacheFallback(lat, lng, radius) {
  const now = Date.now();
  let best = null;
  let bestDistance = Infinity;

  nearbyPlacesCache.forEach((value, key) => {
    if (!value || (now - value.ts) > NEARBY_CACHE_TTL_MS) return;
    const [kLat, kLng, kRadius] = key.split(':');
    if (String(Number(radius) || 1000) !== kRadius) return;

    const latDiff = Math.abs(Number(kLat) - Number(lat));
    const lngDiff = Math.abs(Number(kLng) - Number(lng));
    const distance = latDiff + lngDiff;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = value;
    }
  });

  // ~0.02 degrees ~= a couple kilometers in city contexts.
  return bestDistance <= 0.02 ? best : null;
}

app.get('/api/nearby-places', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Math.max(50, Math.min(3000, Number(req.query.radius || 1000)));
  const cacheKey = makeNearbyCacheKey(lat, lng, radius);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Invalid lat/lng' });
  }

  const ar = `(around:${radius},${lat},${lng})`;
  const amenityTypes = 'cafe|restaurant|fast_food|bar|pub|ice_cream|food_court|library|theatre|cinema|place_of_worship|gym|school|pharmacy|bank|atm|fuel|marketplace|deli|juice_bar|hookah_lounge|clinic|doctors|dentist|veterinary|post_office';
  const shopTypes = 'supermarket|convenience|deli|bakery|butcher|seafood|wine|coffee|clothes|books|music|art|ticket|hairdresser|beauty|car_parts|hardware|florist|gift|shoes|jewelry|mobile_phone|electronics|laundry|dry_cleaning|bicycle|pet|optician|variety_store|mall|department_store';
  const officeTypes = 'company|coworking|insurance|estate_agent|lawyer|accountant|travel_agent|financial|financial_advisor|educational_institution|government|it';
  const healthcareTypes = 'clinic|doctor|dentist|pharmacy|hospital|physiotherapist|optometrist|therapist|counselling';
  const craftTypes = 'brewery|caterer|photographer|tailor|printer|plumber|electrician|carpenter|gardener';
  const query = [
    `[out:json][timeout:10];(`,
    `node["amenity"~"^(${amenityTypes})$"]${ar};`,
    `node["shop"~"^(${shopTypes})$"]${ar};`,
    `node["office"~"^(${officeTypes})$"]["name"]${ar};`,
    `node["healthcare"~"^(${healthcareTypes})$"]["name"]${ar};`,
    `node["craft"~"^(${craftTypes})$"]["name"]${ar};`,
    `node["leisure"~"^(park|garden|nature_reserve|dog_park|playground|swimming_pool|marina|fishing|sports_centre|stadium|golf_course|skate_park)$"]${ar};`,
    `node["tourism"~"^(museum|gallery|viewpoint|picnic_site|camp_site|wilderness_hut)$"]${ar};`,
    `node["natural"~"^(beach|peak|waterfall|water|spring)$"]${ar};`,
    `node["historic"~"^(monument|ruins|memorial|castle)$"]${ar};`,
    `way["amenity"~"^(${amenityTypes})$"]${ar};`,
    `way["shop"~"^(${shopTypes})$"]${ar};`,
    `way["office"~"^(${officeTypes})$"]["name"]${ar};`,
    `way["healthcare"~"^(${healthcareTypes})$"]["name"]${ar};`,
    `way["craft"~"^(${craftTypes})$"]["name"]${ar};`,
    `way["leisure"~"^(park|garden|nature_reserve|playground|sports_centre|stadium|golf_course|dog_park|marina)$"]${ar};`,
    `way["tourism"~"^(museum|gallery|viewpoint|picnic_site|camp_site)$"]${ar};`,
    `relation["amenity"~"^(${amenityTypes})$"]${ar};`,
    `relation["shop"~"^(${shopTypes})$"]${ar};`,
    `relation["office"~"^(${officeTypes})$"]["name"]${ar};`,
    `relation["healthcare"~"^(${healthcareTypes})$"]["name"]${ar};`,
    `relation["craft"~"^(${craftTypes})$"]["name"]${ar};`,
    `relation["leisure"~"^(park|garden|nature_reserve|playground|sports_centre|stadium|golf_course|dog_park|marina)$"]${ar};`,
    `relation["tourism"~"^(museum|gallery|viewpoint|picnic_site|camp_site)$"]${ar};`,
    // Keep response lean for reliability; we only need marker centers here.
    `);out center;`,
  ].join('');
  const broadNamedBusinessQuery = [
    `[out:json][timeout:12];(`,
    `nwr["amenity"]["name"]${ar};`,
    `nwr["shop"]["name"]${ar};`,
    `nwr["office"]["name"]${ar};`,
    `nwr["craft"]["name"]${ar};`,
    `nwr["tourism"]["name"]${ar};`,
    `);out center;`,
  ].join('');
  const genericNamedPlaceQuery = [
    `[out:json][timeout:12];`,
    `nwr["name"]${ar};`,
    `out center 150;`,
  ].join('');
  const expandedSearchRadius = Math.min(3000, Math.max(radius, 2500));
  const expandedAr = `(around:${expandedSearchRadius},${lat},${lng})`;
  const expandedNamedPlaceQuery = [
    `[out:json][timeout:14];`,
    `nwr["name"]${expandedAr};`,
    `out center 200;`,
  ].join('');

  try {
    const data = await fetchOverpassJson(query);
    let elements = Array.isArray(data?.elements) ? data.elements : [];
    if (!elements.length) {
      const broadData = await fetchOverpassJson(broadNamedBusinessQuery, { timeoutMs: 9000 });
      elements = Array.isArray(broadData?.elements) ? broadData.elements : [];
    }
    if (!elements.length) {
      const genericData = await fetchOverpassJson(genericNamedPlaceQuery, { timeoutMs: 12000 });
      elements = Array.isArray(genericData?.elements) ? genericData.elements : [];
    }
    if (!elements.length) {
      const expandedData = await fetchOverpassJson(expandedNamedPlaceQuery, { timeoutMs: 14000 });
      elements = Array.isArray(expandedData?.elements) ? expandedData.elements : [];
    }
    // Empty Overpass replies are often transient; never turn them into a cached blank map.
    if (elements.length) nearbyPlacesCache.set(cacheKey, { ts: Date.now(), elements });
    res.json(elements);
  } catch (error) {
    const cached = nearbyPlacesCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) <= NEARBY_CACHE_TTL_MS) {
      return res.json(cached.elements || []);
    }
    const fallback = findNearbyCacheFallback(lat, lng, radius);
    if (fallback) {
      return res.json(fallback.elements || []);
    }
    // Degrade gracefully for the map UI instead of hard 502 spam.
    return res.json([]);
  }
});

app.get('/api/building-footprint', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Math.max(50, Math.min(260, Number(req.query.radius || 90)));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Invalid lat/lng' });
  }

  const query = `[out:json][timeout:8];way["building"](around:${radius},${lat},${lng});out geom;`;

  try {
    const data = await fetchOverpassJson(query);
    const ways = (data?.elements || []).filter((element) => Array.isArray(element.geometry) && element.geometry.length > 3);
    if (!ways.length) return res.json(null);

    const closest = ways.reduce((best, way) => {
      const centerLat = way.geometry.reduce((sum, point) => sum + point.lat, 0) / way.geometry.length;
      const centerLng = way.geometry.reduce((sum, point) => sum + point.lon, 0) / way.geometry.length;
      const distance = Math.abs(centerLat - lat) + Math.abs(centerLng - lng);
      return !best || distance < best.distance ? { distance, way } : best;
    }, null)?.way;

    res.json(closest ? {
      geometry: closest.geometry?.map((point) => ({ lat: point.lat, lng: point.lon })) || null,
      tags: closest.tags || {},
      id: closest.id || null,
    } : null);
  } catch (error) {
    return res.json(null);
  }
});

app.get('/api/indoor-layout', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Math.max(30, Math.min(220, Number(req.query.radius || 110)));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Invalid lat/lng' });
  }

  try {
    const queryPlan = [
      { mode: 'strict', radius },
      { mode: 'broad', radius: Math.max(radius + 40, Math.min(340, Math.round(radius * 1.8))) },
      { mode: 'wider', radius: Math.max(radius + 90, Math.min(520, Math.round(radius * 2.8))) },
    ];

    let winningPlan = null;
    let combined = [];
    let lastError = null;
    const hitCounts = [];

    for (const step of queryPlan) {
      try {
        const query = buildIndoorOverpassQuery(lat, lng, step.radius, step.mode);
        const timeoutMs = step.mode === 'strict' ? 6500 : (step.mode === 'broad' ? 9000 : 12000);
        const data = await fetchOverpassJson(query, { timeoutMs });
        const elements = Array.isArray(data?.elements) ? data.elements : [];
        hitCounts.push({ mode: step.mode, radius: step.radius, hits: elements.length });
        combined = dedupeByTypeAndId(combined.concat(elements));
        if (!winningPlan && elements.length > 0) {
          winningPlan = step;
        }
      } catch (error) {
        hitCounts.push({ mode: step.mode, radius: step.radius, hits: 0, error: error?.message || 'failed' });
        lastError = error;
      }
    }

    res.json({
      center: { lat, lng },
      radius,
      elements: combined,
      source: winningPlan ? `live-overpass-${winningPlan.mode}` : 'live-overpass-empty',
      queryPlan,
      hitCounts,
      ...(lastError && !combined.length ? { error: lastError.message || 'Indoor layout lookup failed' } : {}),
    });
  } catch (error) {
    res.json({
      center: { lat, lng },
      radius,
      elements: [],
      error: error.message || 'Indoor layout lookup failed',
    });
  }
});

app.post('/api/community-locations', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'No database' });
  const { id, name, lat, lng, radius, category, emoji, color, creator, description } = req.body;
  if (!id || !name || !lat || !lng) return res.status(400).json({ error: 'Missing fields' });
  try {
    await pool.query(
      'INSERT INTO community_locations (id, name, lat, lng, radius, category, emoji, color, creator, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING',
      [id, name, lat, lng, radius || 50, category || 'social', emoji || '\ud83d\udccd', color || '#f97316', creator || 'anonymous', description || '']
    );
    const location = { id, name, lat, lng, radius: radius || 50, category, emoji, color, creator, description };
    io.emit('community_location_added', location);
    res.json(location);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/community-locations/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'No database' });
  const { id } = req.params;
  const creator = req.query.creator ? String(req.query.creator) : null;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  try {
    const { rows } = await pool.query(
      `DELETE FROM community_locations
       WHERE id = $1 AND ($2::text IS NULL OR creator = $2)
       RETURNING id`,
      [id, creator]
    );
    if (!rows.length) return res.status(404).json({ error: 'Location not found or not owned by creator' });
    io.emit('community_location_removed', { id });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

import fs from 'fs';
const distDir = path.join(__dirname, '../dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  // Frontend is served via Netlify; this service is API + Socket.IO only.
  app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'location-chat-backend' });
  });
}

// 4. Start Server
const PORT = process.env.PORT || 4000;
async function start() {
  try {
    await initDb();
    const loaded = await loadDecorations();
    Object.assign(decorations, loaded);
    console.log(`Loaded decorations for ${Object.keys(decorations).length} room(s)`);
  } catch (err) {
    console.warn('⚠️ Database setup failed — continuing without persistence:', err && err.message);
  }
  server.listen(PORT, () => {
    console.log(`\n===========================================`);
    console.log(`🚀 2D Spatial MVP Server is Live!`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`💾 Persistence: ${pool ? 'Postgres' : 'in-memory'}`);
    console.log(`===========================================\n`);
  });
}
start();
