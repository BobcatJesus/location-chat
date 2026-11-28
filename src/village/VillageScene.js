import Phaser from 'phaser';
import { DEPTH } from './depth.js';
import { DuckPond } from './DuckPond.js';
import { CafeCat } from './CafeCat.js';
import { HiddenKey } from './HiddenKey.js';
import { PuzzleQuest } from './PuzzleQuest.js';
import { TrimTreeQuest } from './TrimTreeQuest.js';
import { ChristmasLightsQuest } from './ChristmasLightsQuest.js'; // Christmas Lights v1 (`sq-christmas-lights-v1`)
import { SnowmanQuest } from './SnowmanQuest.js'; // Build a Snowman v1 (`sq-build-snowman-v1`)
import { SantaHatSystem } from './SantaHatSystem.js';
import { SantasPresentSystem } from './SantasPresentSystem.js'; // Santa's Lost Present v1.1 (`sq-santas-lost-present-v1.1`)
// Temperature System v1 (`sq-temperature-v1`): seasonal cold/warm,
// warm drinks (cocoa, coffee) and cold drinks (beer, iced coffee).
import { TemperatureSystem } from './TemperatureSystem.js';
// Hunger System v1 (`sq-hunger-v1`): hungry by default, any food
// feeds you — 3 bites = full for 8 hours; trash food makes you
// queasy for a minute.
import { HungerSystem } from './HungerSystem.js';
import { QuestManager } from './QuestManager.js';
import { ItemsSystem } from './ItemsSystem.js';
import { NoticeBoardSystem } from './NoticeBoardSystem.js';
import { NoteSystem } from './NoteSystem.js';
import { MailSystem } from './MailSystem.js';
import { GiftSystem } from './GiftSystem.js';
import { DecorSystem } from './DecorSystem.js';
import { FloorLitterSystem } from './FloorLitterSystem.js';
// Catch a Litterbug v1 (`sq-litterbug-quest-v1`): how long the
// 🚨 LITTERBUG! label rides above the litterer.
import { LITTERBUG_LABEL_MS } from './litterbugState.js';
import { HomeStorageSystem } from './HomeStorageSystem.js';
import { hasBag as inventoryHasBag, INVENTORY_FULL_MESSAGE, getInventory, findFoodItem, spendFoodCharge, NO_FOOD_MESSAGE } from './items.js';
// Bread Shop v1 (`sq-bread-shop-v1`): the stock table — one
// function keyed by shop type — decides whether this room sells
// bread at all, and which kinds.
import { breadStockFor } from './breadShop.js';
import { badgeListFrom, normalizeBadgeMap, formatBadgeDate } from './badges.js';
import { io } from 'socket.io-client';
import { RoomLayout } from './RoomLayout.js';
import { stuckDropCheck } from './movement.js';
import { showHangPrompt } from './promptPriority.js'; // Christmas Quests v1.2 (`sq-christmas-multi-v1.2`)
import { pickLayout } from './layoutPicker.js';
import { RoomEditor } from './RoomEditor.js';
import { OutdoorEditor } from './OutdoorEditor.js';
// Portrait fill v1 (`sq-portrait-fill-v1`): pure camera math so the
// zoom adapts to the real viewport once the canvas stops being a fixed
// 1600x900 FIT box.
import { resolveFollowCamera, resolveOverviewZoom, resolveOverviewAvatarScale } from './portraitCamera.js';
import { Prop, PROP_DEFS } from './Prop.js';
import { createAvatarEntity, preloadAvatarTextures } from '../game/entities/avatarFactory';
import { playYouTube, stopYouTube, setYouTubeVolume, getYouTubeVideoId, jukeboxElapsedSeconds } from './YouTubePlayer.js';
import { HalloweenMode } from './HalloweenMode.js';
import { DayNightMode } from './DayNightMode.js';
import { SnowfallMode } from './snowfall.js'; // Snowfall v1 (`sq-snowfall-v1`)
import { normalizeAvatarModel } from '../game/entities/avatarModels';
import { isOutdoorLocation } from './outdoorRoomDetection.js';

function getTimeOfDayMood(date = new Date()) {
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

const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.PROD ? 'https://location-chat-production.up.railway.app' : 'http://localhost:4000');

const SPEED = 180;
const TICK_MS = 50; // position broadcast interval
const PROXIMITY_RADIUS = 150;

// The bartender's taps. Mechanically every beer is the same drink; the
// name is the fiction, and the fiction is the point. 'surprise' resolves
// to a random real tap when the order is placed.
const BEER_MENU = [
  { id: 'lonestar', label: 'Lone Star' },
  { id: 'lager', label: 'Lager' },
  { id: 'ipa', label: 'IPA' },
  { id: 'voodoo', label: 'Voodoo Ranger' },
  { id: 'ultra', label: 'Ultra' },
  { id: 'cider', label: 'Cider' },
  { id: 'stout', label: 'Stout' },
  { id: 'surprise', label: 'Surprise me' },
];
const LAST_BEER_KEY = 'sidequest:lastBeer';

// Conversational ordering vocabulary (see _maybeConversationalOrder).
const AFFIRM_FIRST_WORDS = new Set(['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'please', 'absolutely', 'definitely', 'alright']);
const AFFIRM_PHRASES = new Set(['the usual', 'my usual', 'sounds good', 'hit me', 'same again', 'one more', 'do it']);
const BEER_REQUEST = /\b(can i get|could i get|can i have|could i have|give me|get me|let me get|let me have|gimme|pour me|i'll have|ill have|i'll take|ill take|i want|i need|i'd like|id like)\b/;

const WHAT_HAVE_RE = /(what\s+(do|dou|d)\s*(you|u)\s*(have|got)|what'?s on tap|whatcha got|what you (have|got)|what (beers|drinks) (do|you|u)|\bmenu\b|\bthirsty\b|what.*\b(serve|serving|pour|pouring)\b)/;
const DECOR_SYNC_MS = 8000;
const PRESENCE_SYNC_MS = 4000;
const DECOR_SYNC_HEALTHY_MS = 30000;
const PRESENCE_SYNC_HEALTHY_MS = 20000;
const EDIT_TOGGLE_KEY_CODE = 'Backquote';
const COLLISION_DEBUG_KEY_CODE = 'F2';
const FOOTPRINT_DEBUG_KEY_CODE = 'F3';
const ULTRA_CLOSE_FOLLOW_ZOOM = 2.85;
const CLOSE_FOLLOW_ZOOM = 2.35;
const FOLLOW_ZOOM = 1.9;
const WIDE_FOLLOW_ZOOM = 1.45;
const ULTRA_CLOSE_AVATAR_SCALE = 1.3;
const CLOSE_AVATAR_SCALE = 1.18;
const FOLLOW_AVATAR_SCALE = 1;
const WIDE_AVATAR_SCALE = 1.3;
const OVERVIEW_AVATAR_SCALE = 1.42;
const LOCAL_AVATAR_SPAWN_RETRIES = 3;

function normalizeAvatarState(source = {}) {
  const resolvedPhoto = source.photo || source.photoDataUrl || source.avatarPhoto || null;
  return {
    photo: resolvedPhoto,
    avatarModel: normalizeAvatarModel(source.avatarModel),
    skinId: source.skinId || 'slate',
    hairStyle: source.hairStyle || 'combed',
    bodyType: source.bodyType || 'standard',
    skinTone: source.skinTone ?? source.pigment ?? 45,
    hairHue: source.hairHue ?? source.eyeHue ?? 26,
    outfitHue: source.outfitHue ?? source.scarfHue ?? 220,
    topStyle: source.topStyle || 'hoodie',
    bottomStyle: source.bottomStyle || 'pants',
    footwear: source.footwear || 'sneakers',
    glasses: Boolean(source.glasses),
    hasScythe: Boolean(source.hasScythe),
    // Bag upgrade (Items + Inventory v1): the bought bag shows on the
    // avatar. Carried in the avatar state so remote spawns can draw
    // it too (see join_room — the server must relay it; v1 note in
    // the kit report).
    hasBag: Boolean(source.hasBag),
  };
}

const LEGACY_TYPE_TO_FRAME_KEY = {
  table: 'prop_table_round',
  chair: 'prop_chair_wooden',
  plant: 'prop_plant_potted',
  jukebox: 'prop_jukebox',
  rug: 'prop_rug_rolled',
  art: 'prop_portrait_framed',
};

const OUTDOOR_TYPES = new Set(['oak_tree', 'tree', 'shrub', 'hedge', 'bench', 'lamppost', 'flowerbed']);

function inferOutdoorType(type, width, height) {
  const normalized = String(type || '').toLowerCase().trim();
  if (OUTDOOR_TYPES.has(normalized)) return normalized;

  if (normalized.includes('lamp') || normalized.includes('post')) return 'lamppost';
  if (normalized.includes('bench') || normalized.includes('seat')) return 'bench';
  if (normalized.includes('flower') || normalized.includes('bed')) return 'flowerbed';
  if (normalized.includes('hedge')) return 'hedge';
  if (normalized.includes('shrub') || normalized.includes('bush')) return 'shrub';
  if (normalized.includes('oak')) return 'oak_tree';
  if (normalized.includes('tree')) return 'tree';

  // Legacy outdoor entries without type hints can be inferred from dimensions.
  if (height >= 92 && width <= 42) return 'lamppost';
  if (height >= 116) return 'oak_tree';
  if (height >= 82) return 'tree';
  if (width >= 98 && height <= 52) return 'hedge';
  if (width >= 82 && height <= 46) return 'bench';
  if (width >= 72 && height <= 50) return 'flowerbed';
  return 'shrub';
}

function getOutdoorSpriteMeta(type = '') {
  const normalized = String(type || '').toLowerCase();
  switch (normalized) {
    case 'oak_tree':
      // Big park tree: ~2.5x a humanoid avatar (64-76px). The oak art is a
      // wide canopy on a short trunk, so height is what makes it read as a tree.
      return { textureKey: 'tree-oak', targetHeight: 175, rotation: 0 };
    case 'tree':
      // Ordinary tree: ~2x avatar height — clearly taller than a person,
      // not a shrub and not a skyscraper.
      return { textureKey: 'tree-oak', targetHeight: 140, rotation: 0 };
    case 'shrub':
      return { textureKey: 'tree-oak', targetHeight: 40, rotation: 0 };
    case 'hedge':
      return { textureKey: 'tree-oak', targetHeight: 44, rotation: 0 };
    case 'bench':
      // Park bench: back top ~chest height on an avatar, seat below the knee.
      // (Was 64 — as tall as a person, which made benches read as walls.)
      return { textureKey: 'bench', targetHeight: 48, rotation: 0 };
    case 'lamppost':
      return { textureKey: 'lamppost', targetHeight: 106, rotation: 0 };
    case 'flowerbed':
      return { textureKey: 'tree-cherry', targetHeight: 38, rotation: 0 };
    default:
      return { textureKey: 'tree-oak', targetHeight: 72, rotation: 0 };
  }
}

function getLibraryNpcResponse(npcName, message) {
  const text = String(message || '').toLowerCase();
  const asksForSuggestion = text.includes('suggest') || text.includes('recommend') || text.includes('what should i read');
  const asksForFavoriteSection = text.includes('favorite section') || text.includes('favourite section') || text.includes('best section');
  const asksForFavoriteBook = text.includes('favorite book') || text.includes('favourite book') || text.includes('best book');
  const mentionsReading = text.includes('reading') || text.includes('read');
  const mentionsAllNighter = text.includes('all nighter') || text.includes('all-nighter') || text.includes('study all night') || text.includes('staying up');
  const mentionsStudyHelp = text.includes('study') || text.includes('exam') || text.includes('test') || text.includes('assignment') || text.includes('paper');
  const lovesReading = text.includes('love reading') || text.includes('love books') || text.includes('reader');
  const isGreeting = /^(hi|hello|hey|howdy|good morning|good afternoon|good evening)[!.?\s]*$/i.test(text.trim());
  if (isGreeting) {
    return "What's your favorite book?";
  }
  if (mentionsAllNighter) {
    return 'Pick three tasks, then take a break.';
  }
  if (asksForFavoriteBook) {
    const favorites = {
      'Archives Guide': 'Mine is A Pattern Language.',
      'Research Mentor': 'Mine is The Demon-Haunted World.',
      'Reference Desk': 'Mine is The Left Hand of Darkness.',
      Librarian: 'Mine is The City and the City.',
    };
    return favorites[npcName] || 'Mine is The Shining.';
  }
  if (lovesReading) {
    return 'I love books too. Try Station Eleven.';
  }
  if (mentionsStudyHelp) {
    return 'Try 25 minutes, then a break.';
  }
  if (npcName === 'Archives Guide') {
    if (text.includes('map') || text.includes('history')) return 'Old maps are upstairs.';
    if (asksForFavoriteSection) return 'Local history is my favorite.';
    if (asksForSuggestion) return 'Try The Library Book by Susan Orlean.';
    return 'Try The Library Book by Susan Orlean.';
  }
  if (npcName === 'Research Mentor') {
    if (text.includes('source') || text.includes('cite')) return 'Save citations as you go.';
    if (asksForSuggestion) return 'Try The Wager by David Grann.';
    if (mentionsReading) return 'Start with the intro.';
    return 'Try The Wager by David Grann.';
  }
  if (npcName === 'Reference Desk') {
    if (text.includes('book') || text.includes('find')) return 'Try Project Hail Mary.';
    if (asksForFavoriteSection) return 'Science shelves, easy.';
    if (asksForSuggestion) return 'Try Project Hail Mary by Andy Weir.';
    return 'Try Project Hail Mary by Andy Weir.';
  }
  if (asksForFavoriteSection) return 'Arts shelves today.';
  if (asksForSuggestion) return 'Try The Shining by Stephen King.';
  if (mentionsReading) return 'Good reading weather.';
  if (text.includes('book') || text.includes('borrow') || text.includes('checkout')) return 'Try the front desk.';
  return 'Try The Shining by Stephen King.';
}

function getRecommendationFromFavoriteBook(message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('shining') || text.includes('stephen king') || text.includes('horror')) return "Try Salem's Lot by Stephen King.";
  if (text.includes('dune')) return 'Try Hyperion by Dan Simmons.';
  if (text.includes('harry potter') || text.includes('fantasy')) return 'Try A Wizard of Earthsea by Ursula K. Le Guin.';
  if (text.includes('gatsby')) return 'Try The Secret History by Donna Tartt.';
  if (text.includes('pride') || text.includes('austen') || text.includes('romance')) return 'Try Persuasion by Jane Austen.';
  if (text.includes('1984') || text.includes('orwell')) return 'Try Brave New World by Aldous Huxley.';
  if (text.includes('manga') || text.includes('anime')) return 'Try Frieren: Beyond Journey’s End.';
  if (text.includes('project hail mary') || text.includes('martian') || text.includes('science fiction') || text.includes('sci-fi')) return 'Try Dark Matter by Blake Crouch.';
  if (text.includes('wager') || text.includes('history') || text.includes('nonfiction')) return 'Try The Devil in the White City.';
  if (text.includes('poetry')) return 'Try Devotions by Mary Oliver.';
  return 'Try The Shining by Stephen King.';
}

function getParkNpcResponse(npcName, message) {
  const text = String(message || '').toLowerCase();
  const isGreeting = /^(hi|hello|hey|howdy|good morning|good afternoon|good evening)[!.?\s]*$/i.test(text.trim());
  if (text.includes('how are you') || text.includes('how r you')) return 'Doing good. Nice breeze.';
  if (text.includes('feeding the ducks') || text.includes('feed the ducks')) return 'Duck food, not bread.';
  if (text.includes('beautiful day') || text.includes('day is beautiful') || text.includes('nice day')) return 'Beautiful day.';
  if (text.includes('raining') || text.includes('rainy') || text.includes('rain today')) return 'Might rain soon.';
  if (text.includes('jog') || text.includes('run') || text.includes('exercise')) return 'Good day for a loop.';
  if (text.includes('sun') || text.includes('weather') || text.includes('outside')) return 'Nice weather.';
  if (text.includes('playground') || text.includes('play')) return 'Playground is lively.';
  if (text.includes('duck') || text.includes('pond') || text.includes('bird')) return 'The pond is calm.';
  if (text.includes('picnic') || text.includes('eat') || text.includes('lunch')) return 'Picnic weather.';
  if (npcName === 'Morning Jogger') return isGreeting ? 'Hey! Nice day for a loop.' : 'The path is quiet right now.';
  if (npcName === 'Pond Watcher') return isGreeting ? 'Hey. The pond is calm today.' : 'The water looks peaceful.';
  if (npcName === 'Duck Feeder') return isGreeting ? 'Hey! The ducks are busy.' : 'The pond is lively today.';
  if (npcName === 'Paddleboat Guide') return isGreeting ? 'Hey! Good lake weather.' : 'The lake is smooth today.';
  if (npcName === 'Trail Runner') return isGreeting ? 'Hey! Great trail weather.' : 'Might rain soon.';
  return isGreeting ? 'Hey! What a nice day.' : 'It might rain soon.';
}

function getAsgardNpcResponse(npcName, message) {
  const text = String(message || '').toLowerCase();
  const isGreeting = /^(hi|hello|hey|howdy|good morning|good afternoon|good evening)[!.?\s]*$/i.test(text.trim());
  const asksAboutPokemon = text.includes('pokemon') || text.includes('pokémon');
  const asksAboutMagic = text.includes('magic') || text.includes('mtg') || text.includes('commander');
  const asksAboutDnd = text.includes('d&d') || text.includes('dnd') || text.includes('dungeon') || text.includes('dragon');
  const asksAboutWarhammer = text.includes('warhammer') || text.includes('40k') || text.includes('miniature') || text.includes('paint');
  const asksAboutCards = text.includes('card') || text.includes('tcg') || text.includes('deck');
  const asksAboutBoardGames = text.includes('board') || text.includes('game night') || text.includes('tabletop');
  const asksForRecommendation = text.includes('recommend') || text.includes('suggest') || text.includes('what should') || text.includes('best game');

  if (isGreeting) {
    if (npcName === 'Dungeon Master') return 'Welcome, adventurer. What are we rolling tonight?';
    return 'Welcome to Asgard. Looking for a game or a party?';
  }
  if (asksAboutPokemon) return 'Pokémon nights get competitive fast. Bring a deck and a trade binder.';
  if (asksAboutMagic) return 'Commander is a great way to meet people. Politics are part of the format.';
  if (asksAboutDnd) return 'D&D needs three things: a character, a d20, and a story worth telling.';
  if (asksAboutWarhammer) return 'Warhammer starts on the table and ends in the paint station. Pick a faction you love.';
  if (asksAboutCards) return 'Card games reward practice, but the best matchups start with a good hello.';
  if (asksAboutBoardGames) return 'There is a table for almost every kind of night: quick, strategic, cooperative, or chaotic.';
  if (asksForRecommendation) {
    if (npcName === 'Dungeon Master') return 'Try a cooperative campaign game. It gives everyone a role.';
    return 'Try a game you can teach in five minutes, then stay for the rematch.';
  }
  if (text.includes('event') || text.includes('tournament')) return 'Check the event board by the back tables.';
  if (text.includes('paint') || text.includes('model')) return 'Thin your paints, take your time, and let the details carry the army.';
  if (text.includes('party') || text.includes('people') || text.includes('meet')) return 'The open-play tables are the easiest way to find your party.';
  if (npcName === 'Dungeon Master') return 'Every campaign needs a good hook. What story are you bringing?';
  return 'The demo tables are open. Pick something and let us teach you.';
}

function getVenueNpcResponse(layoutId, message) {
  const text = String(message || '').toLowerCase();
  const isGreeting = /^(hi|hello|hey|howdy|good morning|good afternoon|good evening)[!.?\s]*$/i.test(text.trim());
  const theme = String(layoutId || '').replace(/^auto-/, '').replace(/-poly.*$/, '');
  if (theme.includes('asgard')) return getAsgardNpcResponse('', message);
  const greetings = {
    cafe: 'Study sesh?',
    restaurant: 'Smells good, right?',
    shop: 'Browsing day?',
    gym: 'Workout time?',
    theater: 'Movie night?',
    bar: 'Good music tonight.',
    pharmacy: 'Hope you find it.',
    default: 'Hey!',
  };
  const responses = {
    cafe: text.includes('study') ? 'Good study spot.' : text.includes('drink') || text.includes('coffee') ? 'Coffee smells great today.' : 'Window seat looks cozy.',
    restaurant: text.includes('order') || text.includes('food') ? 'The special looks good.' : text.includes('dessert') ? 'Save room for dessert.' : 'Smells good in here.',
    shop: text.includes('find') || text.includes('looking') ? 'Good finds near the back.' : text.includes('opinion') ? 'I like that one.' : 'Take your time browsing.',
    gym: text.includes('leg') ? 'Leg day?' : text.includes('workout') || text.includes('train') ? 'Warm up first.' : 'Remember water.',
    theater: text.includes('movie') || text.includes('see') ? 'Trailers start soon.' : text.includes('popcorn') ? 'Popcorn time.' : 'Movie night.',
    bar: text.includes('music') ? 'Good music tonight.' : text.includes('friend') || text.includes('meeting') ? 'Your friends might be inside.' : 'Nice night out.',
    pharmacy: text.includes('medicine') || text.includes('prescription') ? 'Ask the pharmacist.' : 'Take care.',
    default: text.includes('nearby') || text.includes('place') ? 'Lots nearby today.' : 'Nice seeing people out.',
  };
  return isGreeting ? (greetings[theme] || greetings.default) : (responses[theme] || responses.default);
}

function getNpcOpeningResponse(layoutId, isOutdoorLocation) {
  if (isOutdoorLocation) return 'Beautiful day.';
  const layoutName = String(layoutId || '');
  const theme = layoutName.includes('library') ? 'library' : layoutName.replace(/^auto-/, '').replace(/-poly.*$/, '');
  if (theme.includes('asgard')) return 'Welcome to Asgard. What are we rolling tonight?';
  if (theme === 'library') return "What's your favorite book?";
  if (theme === 'cafe') return 'Study sesh?';
  if (theme === 'restaurant') return 'Smells good, right?';
  if (theme === 'shop') return 'Browsing day?';
  if (theme === 'gym') return 'Workout time?';
  if (theme === 'theater') return 'Movie night?';
  if (theme === 'bar') return 'Good music tonight.';
  if (theme === 'pharmacy') return 'Hope you find it.';
  return 'Hey!';
}

function getRequestedBookGenre(message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('philosophy') || text.includes('philosophical')) return 'philosophy';
  if (text.includes('nonfiction') || text.includes('non-fiction') || text.includes('non fiction')) return 'nonfiction';
  if (text.includes('manga') || text.includes('anime')) return 'manga';
  if (text.includes('humor') || text.includes('funny') || text.includes('comedy') || text.includes('comedic')) return 'humor';
  if (text.includes('science fiction') || text.includes('sci-fi') || text.includes('scifi') || text.includes('space opera')) return 'science-fiction';
  return null;
}

async function getLiveBookRecommendation(genre) {
  const response = await fetch(`${SOCKET_SERVER_URL}/api/library/recommendation?genre=${encodeURIComponent(genre)}`);
  if (!response.ok) throw new Error('Book lookup unavailable.');
  return response.json();
}

function varyNpcResponse(response, replyNumber, isOutdoorLocation) {
  return response;
}

function getNpcAmbientLines(layoutId, isOutdoorLocation, npcName = '') {
  const layoutName = String(layoutId || '').toLowerCase();
  if (isOutdoorLocation) {
    const pondLines = ['What a nice day.', 'Might rain soon.', 'The water is calm.', 'The ducks are busy.', 'Good pond weather.', 'Nice breeze today.'];
    const parkLines = ['What a nice day.', 'It might rain soon.', 'The path is quiet.', 'Fresh air helps.', 'Nice shade here.', 'Good day for a walk.'];
    if (layoutName.includes('hermann') || ['Pond Watcher', 'Duck Feeder', 'Paddleboat Guide'].includes(npcName)) return pondLines;
    return parkLines;
  }

  if (layoutName.includes('library')) {
    return ['Try The Shining.', 'Try Project Hail Mary.', 'Try The Wager.', 'Try Station Eleven.', 'Try The Library Book.', 'Good reading weather.'];
  }

  if (layoutName.includes('asgard')) {
    return [
      'Demo tables are open.',
      'Someone is always looking for a fourth player.',
      'The event board has the latest game nights.',
      'Pokémon trades happen near the front.',
      'Commander pods are forming.',
      'The paint station is busy tonight.',
      'A good campaign starts with a good table.',
      'Roll for initiative.',
    ];
  }

  if (layoutName.includes('cafe')) return ['Coffee smells great.', 'Nice corner table.', 'Busy morning.', 'Good pastry day.', 'Window seat is open.'];
  if (layoutName.includes('theater')) return ['Trailers start soon.', 'Popcorn smells good.', 'Good seats today.', 'Quiet before the show.'];
  if (layoutName.includes('gym')) return ['Good warm-up.', 'Remember water.', 'Light stretch first.', 'Strong pace today.'];
  return ['Hey!', 'Nice place.', 'Good to see people out.', 'Quiet moment here.', 'This spot feels calm.'];
}

const BLOCKED_NPC_RESPONSE_PATTERNS = [
  /tell me what you are looking for/i,
  /i can offer a different shelf/i,
  /what are you in the mood/i,
  /do you have any interests/i,
  /genre recommendation, a favorite book/i,
];

function normalizeNpcResponseLine(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isOverlongNpcResponse(value = '') {
  const text = String(value || '').trim();
  if (/^try\s+.+\s+by\s+.+\.$/i.test(text)) return text.length > 90;
  return text.length > 72;
}

function shouldReplaceNpcResponse(value = '') {
  const text = String(value || '').trim();
  return !text || isOverlongNpcResponse(text) || BLOCKED_NPC_RESPONSE_PATTERNS.some((pattern) => pattern.test(text));
}


export class VillageScene extends Phaser.Scene {
  constructor() { super({ key: 'VillageScene' }); }

  static _boot = null;

  init(data) {
    const registryData = this.game?.registry?.get?.('bootData') || null;
    const d = (data && Object.keys(data).length > 0) ? data : (registryData || VillageScene._boot || {});
    this.roomId     = d.roomId     ?? 'default-room';
    this.roomName   = d.roomName   ?? '';
    this.roomOwnerId = d.roomOwnerId ?? '';
    this.amenityTag = d.amenityTag ?? '';
    this.shopTag    = d.shopTag    ?? '';
    this.roomShape  = d.roomShape  ?? null;
    this.roomData   = d.roomData   ?? null;
    this.explicitLayout = d.explicitLayout ?? null;
    this.profile    = d.profile    ?? {};
    this.canManageVenue = Boolean(d.canManageVenue);
    // Decoration Shop v1: moderators can take down ANY placed
    // decoration (the scene needs this for the pickup check).
    this.isModerator = Boolean(d.isModerator);
    this.userLocation = d.userLocation ?? null;
    this.onLeave    = d.onLeave    ?? (() => {});
    this.onOpenShelf = d.onOpenShelf ?? (() => {});
    this.onOpenJukebox = d.onOpenJukebox ?? (() => {});
    this.onOpenPuzzle = d.onOpenPuzzle ?? (() => {});
    this.onOpenInventory = d.onOpenInventory ?? (() => {});
    this.onOpenNoticeBoard = d.onOpenNoticeBoard ?? (() => {});
    // Pick-Up Notes v1 (`sq-pickup-notes-v1`): opens the read
    // popup for one note on the floor.
    this.onOpenNote = d.onOpenNote ?? (() => {});
    // Mailbox v1 (`sq-mailbox-v1`): opens the mailbox overlay.
    this.onOpenMailbox = d.onOpenMailbox ?? (() => {});
    // Mailbox v1 (`sq-mailbox-v1`): every room the app knows about
    // (featured + user-created), so MailSystem can find the
    // player's nearest park room (their mailbox room).
    this.allRooms = Array.isArray(d.allRooms) ? d.allRooms : [];
    // Your Place v1: opens the storage chest panel (DOM).
    this.onOpenHomeStorage = d.onOpenHomeStorage ?? (() => {});
    // Decoration Shop v1: opens the coffee-bar shop panel (DOM).
    this.onOpenDecorShop = d.onOpenDecorShop ?? (() => {});
    // Bread Shop v1 (`sq-bread-shop-v1`): opens the Register-counter
    // bread shop panel (DOM) in a food-shop room.
    this.onOpenBreadShop = d.onOpenBreadShop ?? (() => {});
    // Quest badges v1: opens another player's badges panel (DOM).
    this.onOpenPlayerBadges = d.onOpenPlayerBadges ?? (() => {});
    // Gift Giver v1 (`sq-gift-giver-v1`): a direct gift offer
    // arrived (DOM prompt) / the prompt should close.
    this.onGiftOffer = d.onGiftOffer ?? (() => {});
    this.onGiftOfferGone = d.onGiftOfferGone ?? (() => {});
    this.preferredCameraMode = ['ultra-close-follow', 'close-follow', 'follow', 'wide-follow', 'overview'].includes(d.preferredCameraMode)
      ? d.preferredCameraMode
      : null;
    this.avatarState = normalizeAvatarState(d.profile?.profile || {});
    this.onEditorChange = d.onEditorChange ?? (() => {});
    this.onNearbyChange = d.onNearbyChange ?? (() => {});
    this.onNearbyNpcChange = d.onNearbyNpcChange ?? (() => {});
    this.onNpcConversationClear = d.onNpcConversationClear ?? (() => {});
    this.onRoomPopulationChange = d.onRoomPopulationChange ?? (() => {});
    this.onChatMessage = d.onChatMessage ?? (() => {});
    this.onSystemNotice = d.onSystemNotice ?? (() => {});
    this.onFloorStatusChange = d.onFloorStatusChange ?? (() => {});
    this.npcReplyCounts = new Map();
    this.npcRecentResponses = new Map();
    this.npcConversationState = new Map();
  }

  _emitFloorStatus() {
    const floors = Array.isArray(this.layout?.floors) ? this.layout.floors.length : 1;
    const floorIndex = Number.isFinite(this.currentFloor) ? this.currentFloor : 0;
    const layoutId = String(this.layout?.id || '');
    const stairScaffoldActive = layoutId.includes('-2f');
    this.onFloorStatusChange({
      currentFloor: floorIndex,
      totalFloors: Math.max(1, floors),
      stairScaffoldActive,
      layoutId,
    });
  }

  _applyRoomMood() {
    const mood = getTimeOfDayMood(this.roomMood || new Date());
    this.roomMood = mood;
    const bgMap = {
      morning: 0xf8d7a2,
      afternoon: 0xcfe7ff,
      evening: mood.backgroundColor ?? 0xe7835b,
      night: mood.backgroundColor ?? 0x111827,
    };
    this.cameras?.main?.setBackgroundColor(bgMap[mood.label] ?? 0xffffff);
    return mood;
  }

  preload() {
    preloadAvatarTextures(this);
    this.load.atlas('props', '/assets/props/props.png', '/assets/props/props.json');
    this.load.image('bench', '/assets/props/bench.png');
    this.load.image('lamppost', '/assets/props/lampost.png');
    this.load.image('tree-oak', '/assets/props/tree-oak.png');
    this.load.image('tree-cherry', '/assets/props/tree-cherry.png');
    this.load.image('pond-art', '/places/pond.png');
    this.load.image('duck-art', '/places/duck-swim.png');
    this.load.image('duck-stand-art', '/places/duck-stand.png');
    this.load.image('shelf-front', '/places/shelf-front.png');
    this.load.image('shelf-34', '/places/shelf-34.png');
    this.load.image('cat-sleep', '/assets/sprites/cat-sleep.png');
    this.load.image('cat-side', '/assets/sprites/cat-side.png');
    this.load.image('cat-front', '/assets/sprites/cat-front.png');
    this.load.image('cat-threequarter', '/assets/sprites/cat-threequarter.png');
    this.load.image('cat-back', '/assets/sprites/cat-back.png');
    // Agora Graphic-Novel Reskin v1 (`sq-agora-reskin-v1`): the comic
    // cat set — loaded under '<base>-comic' keys alongside the
    // originals, so CafeCat can pick by flag and the toggle's scene
    // restart swaps the cat with no extra load. Originals untouched.
    this.load.image('cat-sleep-comic', '/assets/sprites/comic/cat-sleep.png');
    this.load.image('cat-side-comic', '/assets/sprites/comic/cat-side.png');
    this.load.image('cat-front-comic', '/assets/sprites/comic/cat-front.png');
    this.load.image('cat-threequarter-comic', '/assets/sprites/comic/cat-threequarter.png');
    this.load.image('cat-back-comic', '/assets/sprites/comic/cat-back.png');
    this.load.image('sq-jackolantern', '/assets/sprites/halloween/jackolantern.png');
    this.load.image('sq-ghost', '/assets/sprites/halloween/ghost.png');
    this.load.image('sq-batmist', '/assets/sprites/halloween/bat-mist.png');
    this.load.image('sq-bat-up', '/assets/sprites/halloween/bat-up.png');
    this.load.image('sq-bat-flat', '/assets/sprites/halloween/bat-flat.png');
  }

  create() {
    const W = this.scale.width, H = this.scale.height;

    // Ensure cleanup runs whenever Phaser stops or destroys this scene.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.shutdown, this);

    // Pick and draw layout
    this.layout = this.explicitLayout || pickLayout(this.roomId, this.roomName, this.amenityTag, this.shopTag, this.roomShape, this.roomData);
    console.log('[VillageScene] room:', this.roomId, '| name:', this.roomName, '| layout:', this.layout.id);
    // Award coins for first visit to a new place
    try {
      import('./CoinWallet.js').then((m) => m.awardNewPlaceVisit(this.roomId)).catch(() => {});
    } catch {}
    this.roomLayout = new RoomLayout(this, this.layout);
    this.currentFloor = 0;
    this.roomLayout.drawFloor(0);
    this._emitFloorStatus();
    this.showCollisionDebug = false;
    this.showFootprintDebug = false;
    this.roomLayout.setCollisionDebug(false);
    this.roomLayout.setFootprintDebug(false);
    this.cameraMode = this.preferredCameraMode || 'follow';
    this.isOutdoorLocation = isOutdoorLocation(this.roomId, this.roomName, this.amenityTag, this.shopTag);
    this.roomMood = getTimeOfDayMood(new Date());
    this._applyRoomMood();

    // Initialize editor (press ~ or use the UI toggle)
    this.roomEditor = this.isOutdoorLocation ? new OutdoorEditor(this) : new RoomEditor(this);
    this.customZones = [];
    this.onEditorChange(false);
    this.roomLayout.setDynamicSolids(this.customZones);
    // Render any custom zones already saved
    this._propSprites = [];
    this._renderSavedProps();
    this.staticNpcs = [];
    this._npcRenderVersion = 0;
    this._renderStaticNpcs();

    const spawn = this._resolveInitialSpawn();

    // Local player
    const displayName = this.profile?.profile?.characterName || this.profile?.mode || 'Traveler';
    const firstName = this.profile?.profile?.firstName || displayName.split(' ')[0] || 'You';
    this.player = {
      gx: spawn.x,
      gy: spawn.y,
      avatar: null,
      facingLeft: false,
      sync: () => {
        if (!this.player?.avatar) return;
        this.player.avatar.setPosition(this.player.gx, this.player.gy);
        this.player.avatar.setDepth(DEPTH.ACTOR_MIN + Math.round(this.player.gy));
        this.player.avatar.syncLabel();
      },
      destroy: () => {
        this.player?.avatar?.destroy();
      },
    };
    this.pendingRemoteSpawns = new Set();
    this._localSpawnName = firstName;
    this._localSpawnPoint = { x: spawn.x, y: spawn.y };
    this._localRespawnPending = false;
    this._spawnLocalAvatar(firstName, spawn, 0);

    // Coffee cup overhead (shown near café)
    this.coffeeCup = this.add.text(0, 0, '☕', { fontSize: '18px' })
      .setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Duck pond interaction (procedural: any pond zone gets ducks + feeding)
    this.duckPond = new DuckPond(this);
    this.duckPond.refresh();
    // Cafe cat (Agora only — CafeCat itself no-ops in every other room).
    this.cafeCat = new CafeCat(this);
    this.cafeCat.refresh();
    // Quest loop (Quest Wrapper v1): auto-starts the quest for this
    // room, tracks it in the corner, toasts + pays coins on completion.
    // Petting a ROAMING duck counts toward the duck quest; petting a
    // pond duck does not (it neither adds to nor subtracts from it).
    this.questManager = new QuestManager(this);
    // Quest UI renders as DOM (VillageCanvas polls getHudState):
    // in-canvas tracker/banner sit underneath the DOM top bar on PC.
    this.questManager.domHud = true;
    this.questManager.refresh();
    this.duckPond.onDuckPet = (duck) => {
      if (duck?.roaming) this.questManager?.recordEvent('duck-fed');
    };
    // Cat Cuddles quest: a successful local pet counts (also a step of
    // the Bartender's Errand, via recordEvent -> recordGlobalEvent).
    this.cafeCat.onCatPet = () => {
      this.questManager?.recordEvent('cat-pet');
    };
    // Golden Key quest (Agora only — HiddenKey itself no-ops elsewhere).
    this.hiddenKey = new HiddenKey(this);
    this.hiddenKey.refresh();
    // Group puzzle quest (Agora only — PuzzleQuest itself no-ops
    // elsewhere): the puzzle table + hidden pieces in the room.
    this.puzzleQuest = new PuzzleQuest(this);
    this.puzzleQuest.refresh();
    // Trim the Tree (Agora only — TrimTreeQuest itself no-ops
    // elsewhere): the big Christmas tree(s) + the free ornament box.
    this.trimTreeQuest = new TrimTreeQuest(this);
    this.trimTreeQuest.refresh();
    // Christmas Lights (Agora only — ChristmasLightsQuest itself
    // no-ops elsewhere): the wall light strands + the free lights
    // box in the south-east corner.
    this.christmasLightsQuest = new ChristmasLightsQuest(this);
    this.christmasLightsQuest.refresh();
    // Build a Snowman (Shepherd Park only — SnowmanQuest itself
    // no-ops elsewhere): the free snow pile + the growing snowman.
    this.snowmanQuest = new SnowmanQuest(this);
    this.snowmanQuest.refresh();
    // Items + inventory v1 (Agora hidden search; ground litter also
    // by any pond): pocket/bag, trash, flyers, notes, diary, food,
    // cigarette box. Puzzle pieces live in this inventory too.
    this.itemsSystem = new ItemsSystem(this);
    this.itemsSystem.refresh();
    // Notice board in every room (boards in every location,
    // `sq-notice-board-everywhere-v1`): the cork board by the
    // entrance, server-synced flyers everyone in the room can read.
    // Each room's board is separate.
    this.noticeBoardSystem = new NoticeBoardSystem(this);
    this.noticeBoardSystem.refresh();
    // Pick-Up Notes v1 (`sq-pickup-notes-v1`): notes on the floor
    // anyone in the room can pick up and read, server-synced.
    // Each room's floor is separate.
    this.noteSystem = new NoteSystem(this);
    this.noteSystem.refresh();
    // Mailbox v1 (`sq-mailbox-v1`): the post box at the player's
    // nearest park (or the nearest public place when no park is
    // close) + sending and collecting mail. Renders only in the
    // player's mailbox room; sending works from the pocket in any
    // room.
    this.mailSystem = new MailSystem(this);
    this.mailSystem.refresh();
    // Gift Giver v1 (`sq-gift-giver-v1`): hand a gift to another
    // player in the same room — offer / accept / decline, with the
    // item + wrapping sheet moving only on the recipient's confirm.
    this.giftSystem = new GiftSystem(this);
    // Decoration Shop v1 (`sq-dec-shop-v1`): buy decorations at the
    // Agora bar, place them anywhere — server-synced, everyone in
    // the room sees them. Placing works in every room; the shop
    // itself is Agora only (DecorSystem enforces that).
    this.decorSystem = new DecorSystem(this);
    this.decorSystem.refresh();
    // Shared Floor Litter v1 (`sq-shared-litter-v1`): dropped
    // pocket items on the floor, visible to everyone in the room
    // — server-synced, anyone can pick them up. Every room except
    // home rooms (their drops go through the home floor store).
    this.floorLitterSystem = new FloorLitterSystem(this);
    this.floorLitterSystem.refresh();
    // Catch a Litterbug v1 (`sq-litterbug-quest-v1`): a confirmed
    // catch counts toward the quest — the server already said ok,
    // so recordEvent is the only thing left to do.
    this.floorLitterSystem.onCatchConfirmed = () => {
      try { this.questManager?.recordEvent('litterbug-caught'); } catch {}
    };
    // Litterbug labels live here (littererId -> { textObj, until,
    // resolve }) — see _showLitterbugLabel / _updateLitterbugLabels.
    this._litterbugLabels = new Map();
    // Your Place v1 (`sq-your-place-v1`): the storage chest in your
    // own home room — Store / Take / Unload All. Home-room only;
    // the system itself no-ops everywhere else.
    this.homeStorageSystem = new HomeStorageSystem(this);
    this.homeStorageSystem.refresh();
    // Santa Hat v1 (`sq-santa-hat-v1`): one Santa hat hidden behind
    // the Christmas tree in Agora — find it, put it on the cafe cat,
    // pick it up again when it slips off. Agora only; the system
    // itself no-ops everywhere else.
    this.santaHatSystem = new SantaHatSystem(this);
    this.santaHatSystem.refresh();
    // Santa's Lost Present v1.1 (`sq-santas-lost-present-v1.1`): one
    // present hidden under Table 4 in Agora — find it once
    // per Chicago day, badge once ever. Agora only; the system
    // itself no-ops everywhere else.
    this.santasPresentSystem = new SantasPresentSystem(this);
    this.santasPresentSystem.refresh();
    // Temperature System v1 (`sq-temperature-v1`): fall/winter you
    // are cold (shiver + "You're cold, get a warm drink"),
    // spring/summer you are warm (sweat + "You're warm, get a
    // cold drink"); a matching drink fixes it for 30 minutes.
    // Client-side only — no server state, no quest.
    this.temperatureSystem = new TemperatureSystem(this);
    this.temperatureSystem.refresh();
    // Hunger System v1 (`sq-hunger-v1`): hungry by default
    // ("you're hungry..." once per spell); eat any food — 3 bites
    // = full for 8 hours. Client-side only — no server state, no
    // quest, no penalty. Trash food works fine but makes you
    // queasy for a minute.
    this.hungerSystem = new HungerSystem(this);
    this.hungerSystem.refresh();
    // Wanderer quest: this room entry counts (after refresh, not in it).
    this.questManager?.noteRoomVisit();
    // Seasonal: pumpkins, bats, spooky tint in October.
    this.halloween = new HalloweenMode(this);
    this.halloween.start();
    // Day/night grade + lamppost glows — outdoor venues only; the
    // module itself no-ops indoors (see DayNightMode.js).
    this.dayNight = new DayNightMode(this);
    this.dayNight.start();
    // Snowfall v1 (`sq-snowfall-v1`): gentle snow in outdoor rooms
    // through December; the module itself no-ops indoors or
    // outside December (see snowfall.js). `?snow=1` forces it on
    // for testing.
    this.snowfall = new SnowfallMode(this);
    this.snowfall.start();
    this._feedCooldownMs = 0;
    this.feedPrompt = this.add.text(0, 0, '🦆 Feed the ducks [E]', {
      fontSize: '15px',
      color: '#1a4971',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Pet prompt: shown when a duck is right next to the player.
    this.duckPrompt = this.add.text(0, 0, '🦆 Pet the duck [E]', {
      fontSize: '15px',
      color: '#1a4971',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Cafe cat interaction (Agora).
    this.catPrompt = this.add.text(0, 0, '🐱 Pet the cat [E]', {
      fontSize: '15px',
      color: '#7c2d12',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Santa Hat v1: prompt near the hat on the ground (pick it up).
    this.hatPrompt = this.add.text(0, 0, '🎅 Pick up the Santa hat [E]', {
      fontSize: '15px',
      color: '#7c2d12',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Group puzzle interaction (Agora): piece on the floor / table.
    this.puzzlePrompt = this.add.text(0, 0, '🧩 Puzzle [E]', {
      fontSize: '15px',
      color: '#7c2d12',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Trim the Tree interaction (Agora): ornament box / tree.
    this.treePrompt = this.add.text(0, 0, '🎄 Take an ornament [E]', {
      fontSize: '15px',
      color: '#7c2d12',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Christmas Lights interaction (Agora): lights box / north wall.
    this.lightsPrompt = this.add.text(0, 0, '💡 Take a light string [E]', {
      fontSize: '15px',
      color: '#7c2d12',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Build a Snowman interaction (Shepherd Park): snow pile / snowman.
    this.snowPrompt = this.add.text(0, 0, '⛄ Take a snowball [E]', {
      fontSize: '15px',
      color: '#7c2d12',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Decoration Shop v1: prompt near a placed decoration (pick it up).
    this.decorPrompt = this.add.text(0, 0, '🎄 Decoration [E]', {
      fontSize: '15px',
      color: '#7c2d12',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Mailbox v1 (`sq-mailbox-v1`): prompt near the mailbox (open
    // it with E — the key must be in your pocket).
    this.mailPrompt = this.add.text(0, 0, '📬 Mailbox [E]', {
      fontSize: '15px',
      color: '#1a4971',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Bookshelf interaction (library shelves)
    this.shelfPrompt = this.add.text(0, 0, '📚 Browse shelf [E]', {
      fontSize: '15px',
      color: '#4a2c14',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Jukebox interaction (bar jukeboxes)
    this.jukeboxPrompt = this.add.text(0, 0, '🎵 Jukebox [E]', {
      fontSize: '15px',
      color: '#0b5a6e',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Bar counter interaction (order a drink, 2 coins — the bartender serves it)
    this._drinkCooldownMs = 0;
    this._drinkBrokeUntil = 0;
    this._drinkMissedUntil = 0;
    this._drinkQueue = [];
    this._convoArmUntil = 0;
    this._drinkCard = null;
    this._drinkCardUntil = 0;
    this._serveBubbleNpc = null;
    this._serveBubbleText = '';
    this._serveBubbleUntil = 0;
    this._drinkAnimUntil = 0;
    this._serveBubbleFrom = 0;
    this._buzz = new Map();
    this.drinkPrompt = this.add.text(0, 0, '🍺 Order a drink · 2 coins [E]', {
      fontSize: '15px',
      color: '#7c2d12',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Speech bubble over the bartender ("What'll ya have?", "One Lone Star").
    this.bartenderBubble = this.add.text(0, 0, '', {
      fontSize: '14px',
      color: '#1f2937',
      backgroundColor: 'rgba(255,255,255,0.95)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Bread Shop v1 (`sq-bread-shop-v1`): prompt at the Register
    // counter in a food-shop room ("Buy bread · 3 coins [E]").
    this.shopPrompt = this.add.text(0, 0, '🛒 Buy bread · 3 coins [E]', {
      fontSize: '15px',
      color: '#7c2d12',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.UI).setAlpha(0);

    // Escalator debounce flag
    this._escalatorCooldown = 0;

    // Remote players map: socketId → Actor
    this.remotePlayers = new Map();
    this._nearbyCount = -1;
    this._nearbyNpcId = null;

    // Walk animation state
    this.dir = 'front';

    // Position broadcast throttle
    this.tickAccum = 0;
    this.lastPos = { x: this.player.gx, y: this.player.gy };

    // Camera
    const layoutBounds = this.layout?.width && this.layout?.height
      ? { x: 0, y: 0, w: this.layout.width, h: this.layout.height }
      : (this.roomLayout?.getBoundaryBounds?.() || { x: 0, y: 0, w: 1600, h: 900 });
    const cameraW = Math.max(1600, Math.ceil(layoutBounds.x + layoutBounds.w));
    const cameraH = Math.max(900, Math.ceil(layoutBounds.y + layoutBounds.h));
    this.cameras.main.setBounds(0, 0, cameraW, cameraH);
    // Portrait fill v1 (`sq-portrait-fill-v1`): remember the bounds so
    // the zoom helper can keep the viewport inside them. The zoom itself
    // is applied by _applyCameraMode below (and again on every resize),
    // which resolves it for this viewport instead of hardcoding
    // FOLLOW_ZOOM — on a portrait phone that would show only a ~205-unit
    // slice of the room.
    this._cameraBounds = { w: cameraW, h: cameraH };
    this._applyCameraMode();

    // Portrait fill v1 (`sq-portrait-fill-v1`): with Scale.RESIZE the
    // canvas follows the window (rotation, split-screen, resize) — re-apply
    // the camera so the zoom and centering track the new viewport.
    this._onScaleResize = () => {
      if (this._isShuttingDown) return;
      this._applyCameraMode();
    };
    this.scale.on('resize', this._onScaleResize);
    this._emitRoomPopulation();

    // Input
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.wasd = this.input.keyboard?.addKeys('W,A,S,D', false);
    // Don't let Phaser swallow spacebar/arrows in text fields — we gate movement ourselves.
    try { this.input.keyboard?.removeCapture('SPACE,UP,DOWN,LEFT,RIGHT'); } catch {}
    this._isTypingContext = (event) => {
      if (window.__chatInputFocused) return true;
      const target = event?.target;
      const active = document.activeElement;
      const isEditableElement = (el) => {
        if (!el || !el.tagName) return false;
        const tag = String(el.tagName).toUpperCase();
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el.isContentEditable);
      };
      return isEditableElement(target) || isEditableElement(active);
    };

    this._onKeyDown = (e) => {
      if (!e) return;
      if (e.isComposing || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (this._isTypingContext(e)) return;

      const key = String(e.key || '').toLowerCase();
      const isEditToggleKey = e.code === EDIT_TOGGLE_KEY_CODE || key === '`' || key === '~';
      if (isEditToggleKey) {
        this.toggleEditor();
        return;
      }

      if (e.code === COLLISION_DEBUG_KEY_CODE) {
        this.toggleCollisionDebug();
        return;
      }

      if (e.code === FOOTPRINT_DEBUG_KEY_CODE) {
        this.toggleFootprintDebug();
        return;
      }

      if (key === 'e') {
        this.triggerInteract();
        return;
      }

      if (key === 'escape' && this.roomEditor?.isActive) {
        this.toggleEditor();
      }
    };

    this._onKeyUp = () => {};
    this._onWindowBlur = () => {
      // Clear sticky movement keys when focus leaves the tab/window.
      this.target = null;
      this.cursors?.left?.reset?.();
      this.cursors?.right?.reset?.();
      this.cursors?.up?.reset?.();
      this.cursors?.down?.reset?.();
      this.wasd?.W?.reset?.();
      this.wasd?.A?.reset?.();
      this.wasd?.S?.reset?.();
      this.wasd?.D?.reset?.();
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onWindowBlur);

    // Tap-to-move
    this.target = null;
    this.tapDot = this.add.circle(0, 0, 6, 0xffffff, 0).setDepth(DEPTH.OVERHEAD);
    this.input.on('pointerdown', (ptr) => {
      if (this.roomEditor?.isActive) return; // editor handles its own clicks
      const bt = this._bartenderNpc();
      if (bt
        && Math.hypot(ptr.worldX - bt.gx, ptr.worldY - bt.gy) < 46
        && Math.hypot(this.player.gx - bt.gx, this.player.gy - bt.gy) <= 170) {
        this._openDrinkCard();
        this.target = null;
        return;
      }
      // Quest badges v1: click another player (standing close
      // enough to look at them) to see their badges — same
      // scene-level pointerdown pattern as the bartender. Consumes
      // the click, so it never also walks you there or searches
      // the furniture under them.
      try {
        const clickedPlayer = this._playerAt(ptr.worldX, ptr.worldY);
        if (clickedPlayer) {
          this._openPlayerBadges(clickedPlayer);
          this.target = null;
          return;
        }
      } catch {}
      const target = this.roomLayout?.clampPointToRoom(ptr.worldX, ptr.worldY, 20)
        || { x: Phaser.Math.Clamp(ptr.worldX, 20, W * 4 - 20), y: Phaser.Math.Clamp(ptr.worldY, 60, H * 4 - 10) };
      // Group puzzle v1.2 (hidden search): a click on furniture
      // hiding a piece counts as one search tap (3 taps finds it).
      // Silent unless the tap finds a piece — no hint about which
      // furniture hides one. Tap-to-move still happens below, as
      // before, so clicking a table both walks you there and
      // searches it. A FULL pocket refuses a piece pickup:
      // "Your pocket is full — place a piece on the puzzle board first."
      try {
        const pr = this.puzzleQuest?.searchTapAt(ptr.worldX, ptr.worldY);
        if (pr && pr.reason === 'inventory-full') {
          this.onSystemNotice?.(`🎒 ${INVENTORY_FULL_MESSAGE}`);
        }
      } catch {}
      // Trim the Tree v1: a click on the ornament box takes one
      // (free), a click on the active tree hangs the one you are
      // carrying. Tap-to-move still happens below, so clicking the
      // box or the tree both walks you there and acts on it.
      try { this.trimTreeQuest?.boxTapAt(ptr.worldX, ptr.worldY); } catch {}
      try { this.trimTreeQuest?.treeTapAt(ptr.worldX, ptr.worldY); } catch {}
      // Christmas Lights v1: a click on the lights box takes one
      // (free), a click on the north wall above the coffee bar hangs
      // the one you are carrying. Tap-to-move still happens below,
      // so clicking the box or the wall both walks you there and
      // acts on it.
      try { this.christmasLightsQuest?.boxTapAt(ptr.worldX, ptr.worldY); } catch {}
      try { this.christmasLightsQuest?.hangTapAt(ptr.worldX, ptr.worldY); } catch {}
      // Build a Snowman v1: a click on the snow pile takes a
      // snowball (free), a click on the snowman adds the one you
      // are carrying. Tap-to-move still happens below, so clicking
      // the pile or the snowman both walks you there and acts on it.
      try { this.snowmanQuest?.pileTapAt(ptr.worldX, ptr.worldY); } catch {}
      try { this.snowmanQuest?.addTapAt(ptr.worldX, ptr.worldY); } catch {}
      // Santa Hat v1: a click behind the Christmas tree counts as
      // one search tap (3 taps finds the hat). Silent unless it
      // finds it — no hint about where the hat hides. A FULL pocket
      // refuses the find (taps stay counted, so one more click
      // after making room tries again); offline, the find refuses.
      try {
        const hr = this.santaHatSystem?.searchTapAt(ptr.worldX, ptr.worldY);
        if (hr && hr.reason === 'inventory-full') {
          this.onSystemNotice?.(`🎒 ${INVENTORY_FULL_MESSAGE}`);
        } else if (hr && hr.reason === 'offline') {
          this.onSystemNotice?.('You seem to be offline — try again when you’re connected.');
        }
      } catch {}
      // Santa's Lost Present v1.1: a click under Table 4
      // counts as one search tap (3 taps finds the present). Silent
      // unless it finds it — no hint about where the present hides.
      // A second find the same day is refused with a notice (the
      // taps still counted, so the refusal fires once on the 3rd
      // tap, not on every click under the table); offline, the find
      // refuses.
      try {
        const pr = this.santasPresentSystem?.searchTapAt(ptr.worldX, ptr.worldY);
        if (pr && pr.reason === 'already-found-today') {
          this.onSystemNotice?.('🎁 You already found Santa\'s present today — it hides again tomorrow!');
        } else if (pr && pr.reason === 'offline') {
          this.onSystemNotice?.('You seem to be offline — try again when you’re connected.');
        }
      } catch {}
      // Items + inventory v1: the same click can also count toward a
      // hidden item (trash can, Table 4, plant, couch, portrait) or
      // pick up visible ground litter you are standing next to.
      try {
        const ir = this.itemsSystem?.searchTapAt(ptr.worldX, ptr.worldY);
        if (ir && ir.reason === 'inventory-full') {
          this.onSystemNotice?.(`🎒 ${INVENTORY_FULL_MESSAGE}`);
        }
      } catch {}
      try {
        const lr = this.itemsSystem?.pickupTapAt(ptr.worldX, ptr.worldY);
        if (lr && lr.reason === 'inventory-full') {
          this.onSystemNotice?.(`🎒 ${INVENTORY_FULL_MESSAGE}`);
        }
      } catch {}
      // Shared Floor Litter v1: a click on shared litter picks it
      // up (if you are standing close enough). A full pocket
      // refuses it — the litter stays on the floor.
      try {
        const flr = this.floorLitterSystem?.litterTapAt(ptr.worldX, ptr.worldY);
        if (flr && flr.reason === 'inventory-full') {
          this.onSystemNotice?.(`🎒 ${INVENTORY_FULL_MESSAGE}`);
        }
      } catch {}
      // Notice board v1: a click on the board itself opens it (if
      // you are standing close enough) — same scene-level
      // pointerdown pattern as the puzzle / items search.
      try {
        const br = this.noticeBoardSystem?.boardTapAt(ptr.worldX, ptr.worldY);
        if (br && br.opened) return;
      } catch {}
      // Pick-Up Notes v1 (`sq-pickup-notes-v1`): a click on a note
      // on the floor opens it to read (if you are standing close
      // enough) — same scene-level pointerdown pattern as the
      // notice board. A click that only MISSES a note falls through
      // to tap-to-move below.
      try {
        const nr = this.noteSystem?.noteTapAt(ptr.worldX, ptr.worldY);
        if (nr && nr.opened) return;
      } catch {}
      // Mailbox v1 (`sq-mailbox-v1`): a click on the mailbox itself
      // opens it (if you are standing close enough and the key is
      // in your pocket) — same scene-level pointerdown pattern as
      // the notice board. A click that only MISSES the box falls
      // through to tap-to-move below.
      try {
        const mr = this.mailSystem?.mailboxTapAt(ptr.worldX, ptr.worldY);
        if (mr && mr.opened) return;
      } catch {}
      // Your Place v1: a click on the storage chest itself opens it
      // (if you are standing close enough) — same scene-level
      // pointerdown pattern as the notice board.
      try {
        const cr = this.homeStorageSystem?.chestTapAt(ptr.worldX, ptr.worldY);
        if (cr && cr.opened) return;
      } catch {}
      // Drop on the home floor v1: a click on a dropped item picks
      // it back up (if you are standing close enough). A full
      // pocket refuses it — the item stays on the floor.
      try {
        const fr = this.homeStorageSystem?.floorTapAt(ptr.worldX, ptr.worldY);
        if (fr && fr.reason === 'inventory-full') {
          this.onSystemNotice?.(`🎒 ${INVENTORY_FULL_MESSAGE}`);
        }
      } catch {}
      // Decoration Shop v1: a click on a placed decoration picks
      // it back up (if you are standing close enough and it is
      // yours — or you are a moderator). Tap-to-move still happens
      // below, as before.
      try { this.decorSystem?.decorTapAt(ptr.worldX, ptr.worldY); } catch {}
      // Santa Hat v1: a click on the hat on the ground picks it back
      // up (if you are standing close enough). A full pocket
      // refuses it — the hat stays on the ground.
      try {
        const gr = this.santaHatSystem?.groundTapAt(ptr.worldX, ptr.worldY);
        if (gr && gr.reason === 'inventory-full') {
          this.onSystemNotice?.(`🎒 ${INVENTORY_FULL_MESSAGE}`);
        } else if (gr && gr.reason === 'offline') {
          this.onSystemNotice?.('You seem to be offline — try again when you’re connected.');
        }
      } catch {}
      this.target = target;
      this.tapDot.setPosition(ptr.worldX, ptr.worldY).setAlpha(0.7);
      this.tweens.add({ targets: this.tapDot, alpha: 0, duration: 400 });
    });

    // Connect Socket.IO
    this._connectSocket();
    this.onNearbyChange(0);
    this.onNearbyNpcChange(null);
  }

  toggleEditor() {
    this.target = null;
    this.roomEditor?.toggle();
    this.onEditorChange(!!this.roomEditor?.isActive);
  }

  toggleCollisionDebug() {
    this.showCollisionDebug = !this.showCollisionDebug;
    this.roomLayout?.setCollisionDebug(this.showCollisionDebug);
    this.onSystemNotice(this.showCollisionDebug ? 'Collision debug ON' : 'Collision debug OFF');
    return this.showCollisionDebug;
  }

  toggleFootprintDebug() {
    this.showFootprintDebug = !this.showFootprintDebug;
    this.roomLayout?.setFootprintDebug(this.showFootprintDebug);
    this.onSystemNotice(this.showFootprintDebug ? 'Footprint debug ON' : 'Footprint debug OFF');
    return this.showFootprintDebug;
  }

  toggleCameraMode() {
    const modes = ['ultra-close-follow', 'close-follow', 'follow', 'wide-follow', 'overview'];
    const currentIndex = Math.max(0, modes.indexOf(this.cameraMode));
    this.cameraMode = modes[(currentIndex + 1) % modes.length];
    this._applyCameraMode();
    if (this.cameraMode === 'overview') {
      this.onSystemNotice('Overview camera ON');
    } else if (this.cameraMode === 'ultra-close-follow') {
      this.onSystemNotice('Ultra close camera ON');
    } else if (this.cameraMode === 'close-follow') {
      this.onSystemNotice('Close camera ON');
    } else if (this.cameraMode === 'wide-follow') {
      this.onSystemNotice('Wide follow camera ON');
    } else {
      this.onSystemNotice('Follow camera ON');
    }
    return this.cameraMode;
  }

  _applyCameraMode() {
    const cam = this.cameras.main;
    if (!cam || !this.roomLayout) return;

    if (this.cameraMode === 'overview') {
      const b = this.roomLayout.getBoundaryBounds();
      // Portrait fill v1 (`sq-portrait-fill-v1`): fit the whole room —
      // the old 0.95 floor could not fit a wide room on a portrait phone.
      const fitZoom = resolveOverviewZoom({
        viewportW: this.scale.width,
        viewportH: this.scale.height,
        boundsW: b.w,
        boundsH: b.h,
      });
      this._resolvedCamera = {
        zoom: fitZoom,
        avatarScale: resolveOverviewAvatarScale({ fitZoom, baseAvatarScale: OVERVIEW_AVATAR_SCALE }),
      };
      cam.stopFollow();
      cam.setZoom(fitZoom);
      cam.centerOn(b.x + b.w / 2, b.y + b.h / 2);
      this._applyAvatarVisualScale();
      return;
    }

    const baseZoom = this.cameraMode === 'ultra-close-follow'
      ? ULTRA_CLOSE_FOLLOW_ZOOM
      : this.cameraMode === 'close-follow'
      ? CLOSE_FOLLOW_ZOOM
      : this.cameraMode === 'wide-follow'
        ? WIDE_FOLLOW_ZOOM
        : FOLLOW_ZOOM;
    // Portrait fill v1 (`sq-portrait-fill-v1`): resolve the zoom for this
    // viewport — a portrait phone zooms out so a useful slice of the room
    // stays visible. Avatar shrink v1 (`sq-avatar-shrink-zoom-v1`): the
    // avatar scale is the mode's base scale now, so the avatar shrinks
    // on screen as the zoom drops.
    this._resolvedCamera = resolveFollowCamera({
      viewportW: this.scale.width,
      viewportH: this.scale.height,
      baseZoom,
      baseAvatarScale: this._baseAvatarScale(),
      boundsW: this._cameraBounds?.w ?? 1600,
      boundsH: this._cameraBounds?.h ?? 900,
    });
    cam.setZoom(this._resolvedCamera.zoom);
    if (this.player?.avatar) {
      cam.startFollow(this.player.avatar, true, 0.1, 0.1);
    }
    this._applyAvatarVisualScale();
  }

  // Base (desktop) avatar visual scale for the current follow mode.
  // Avatar shrink v1 (`sq-avatar-shrink-zoom-v1`): this is the scale
  // the avatar is drawn at — no zoom compensation, so it shrinks on
  // screen as the zoom drops.
  _baseAvatarScale() {
    if (this.cameraMode === 'ultra-close-follow') return ULTRA_CLOSE_AVATAR_SCALE;
    if (this.cameraMode === 'close-follow') return CLOSE_AVATAR_SCALE;
    if (this.cameraMode === 'wide-follow') return WIDE_AVATAR_SCALE;
    return FOLLOW_AVATAR_SCALE;
  }

  _currentAvatarScale() {
    // Avatar shrink v1 (`sq-avatar-shrink-zoom-v1`): the resolved camera
    // (set by _applyCameraMode) carries the mode's base avatar scale —
    // no zoom compensation, so the avatar shrinks on screen when the
    // zoom drops. Before the first resolve, fall back to the mode's
    // base scale.
    if (this.cameraMode === 'overview') {
      return this._resolvedCamera?.avatarScale ?? OVERVIEW_AVATAR_SCALE;
    }
    return this._resolvedCamera?.avatarScale ?? this._baseAvatarScale();
  }

  _applyAvatarVisualScale() {
    const scale = this._currentAvatarScale();
    if (this.player?.avatar?.setScale) {
      this.player.avatar.setScale(scale);
      this.player.avatar.syncLabel?.();
    }
    this.remotePlayers?.forEach((remotePlayer) => {
      if (remotePlayer?.avatar?.setScale) {
        remotePlayer.avatar.setScale(scale);
        remotePlayer.avatar.syncLabel?.();
      }
    });
  }

  _resolveInitialSpawn() {
    const boundaryBounds = this.roomLayout?.getBoundaryBounds?.() || null;
    // Portrait fill v1 (`sq-portrait-fill-v1`): the fallback spawn used
    // to be the viewport center, which moves with the screen aspect —
    // the room's own center is the aspect-independent fallback.
    const defaultSpawn = boundaryBounds
      ? { x: boundaryBounds.x + boundaryBounds.w / 2, y: boundaryBounds.y + boundaryBounds.h / 2 }
      : { x: this.scale.width / 2, y: this.scale.height / 2 };
    const roomSpawn = this.layout?.spawnF1 || defaultSpawn;

    // Outdoor rooms are large and irregular; spawn near the boundary center so
    // the local player reliably starts inside the visible area.
    const preferredSpawn = this.isOutdoorLocation && boundaryBounds
      ? {
          x: boundaryBounds.x + boundaryBounds.w / 2,
          y: boundaryBounds.y + boundaryBounds.h / 2,
        }
      : roomSpawn;

    return this.roomLayout?.resolveSafeSpawnPoint?.([
      preferredSpawn,
      roomSpawn,
      boundaryBounds
        ? { x: boundaryBounds.x + boundaryBounds.w * 0.5, y: boundaryBounds.y + boundaryBounds.h * 0.72 }
        : null,
      defaultSpawn,
    ], 22)
      || this.roomLayout?.clampPointToRoom(preferredSpawn.x, preferredSpawn.y, 24)
      || preferredSpawn
      || defaultSpawn;
  }

  _emitRoomPopulation() {
    this.onRoomPopulationChange(Math.max(1, 1 + this.remotePlayers.size));
  }

  _refreshDecorationsView() {
    if (this._isShuttingDown || !this.sys?.isActive?.() || !this.roomLayout) return;
    this.roomEditor?.setZones(this.customZones);
    this.roomLayout?.drawFloor(this.currentFloor);
    this.roomLayout?.setDynamicSolids(this.customZones);
    this.roomLayout?.setCollisionDebug(this.showCollisionDebug);
    this.roomLayout?.setFootprintDebug(this.showFootprintDebug);
    this._renderSavedProps();
  }

  async _spawnLocalAvatar(firstName, spawn, attempt = 0) {
    if (!this.player) return;
    this._localRespawnPending = true;

    try {
      const localAvatar = await createAvatarEntity(this, spawn.x, spawn.y, {
        ...this.avatarState,
        // Bag upgrade (Items + Inventory v1): drawn on the avatar.
        hasBag: (() => { try { return inventoryHasBag(); } catch { return false; } })(),
        name: firstName,
        isLocal: true,
      });

      if (!this.player) {
        localAvatar?.destroy?.();
        return;
      }

      if (localAvatar) {
        this.player.avatar = localAvatar;
        if (this.avatarState.photo) localAvatar.attachPhoto(this, this.avatarState.photo);
        this.cameras.main.centerOn(spawn.x, spawn.y);
        if (this.cameraMode !== 'overview') {
          this.cameras.main.startFollow(localAvatar, true, 0.1, 0.1);
        }
        this.player.sync();
        this._applyCameraMode();
        this._localRespawnPending = false;
        return;
      }
    } catch (error) {
      console.warn('[VillageScene] local avatar spawn failed', error);
    }

    if (attempt < LOCAL_AVATAR_SPAWN_RETRIES) {
      this.time.delayedCall(120 * (attempt + 1), () => {
        this._spawnLocalAvatar(firstName, spawn, attempt + 1);
      });
      return;
    }

    // Last-resort visible marker so the local player is never invisible.
    const fallback = this.add.circle(spawn.x, spawn.y, 14, 0xef4444, 0.95)
      .setStrokeStyle(2, 0xffffff, 0.95)
      .setDepth(DEPTH.ACTOR_MIN + Math.round(spawn.y));
    fallback.setMovementState = () => {};
    fallback.tick = () => {};
    fallback.syncLabel = () => {};
    fallback.attachPhoto = () => {};
    this.player.avatar = fallback;
    this.cameras.main.centerOn(spawn.x, spawn.y);
    if (this.cameraMode !== 'overview') {
      this.cameras.main.startFollow(fallback, true, 0.1, 0.1);
    }
    this.player.sync();
    this._applyCameraMode();
    this.onSystemNotice('Avatar loader stalled. Showing fallback marker.');
    this._localRespawnPending = false;
  }

  _remoteUserKey(player, socketId) {
    const raw = player?.id;
    if (raw === undefined || raw === null || raw === '') return `socket:${socketId}`;
    return `user:${String(raw)}`;
  }

  _findRemoteSocketIdByUserKey(userKey, excludeSocketId = null) {
    if (!userKey) return null;
    for (const [sid, remotePlayer] of this.remotePlayers.entries()) {
      if (sid === excludeSocketId) continue;
      if (remotePlayer?.userKey === userKey) return sid;
    }
    return null;
  }

  _removeRemoteBySocketId(socketId) {
    const remotePlayer = this.remotePlayers.get(socketId);
    if (remotePlayer) {
      this._convertToGhost(remotePlayer);
      this.remotePlayers.delete(socketId);
    }
    this.pendingRemoteSpawns?.delete(socketId);
  }

  // Lingering presence: departed players leave a translucent ghost.
  // No name, no photo, no chat — just a presence that fades after 10 min.
  _convertToGhost(remotePlayer) {
    const avatar = remotePlayer.avatar;
    if (!avatar) return;
    try {
      // Hide name label and photo
      if (avatar._label) avatar._label.setVisible(false);
      if (avatar._photo) avatar._photo.setVisible(false);
      // Make translucent
      avatar.setAlpha(0.4);
      // Track for fade-out
      if (!this.ghosts) this.ghosts = new Map();
      const ghostId = 'ghost_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      this.ghosts.set(ghostId, {
        avatar,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
        destroy: () => {
          try { avatar.destroy(); } catch {}
          this.ghosts.delete(ghostId);
        },
      });
    } catch (e) {
      // Fallback: just destroy if ghost conversion fails
      try { remotePlayer.destroy(); } catch {}
    }
  }

  _updateGhosts() {
    if (!this.ghosts || this.ghosts.size === 0) return;
    const now = Date.now();
    for (const [id, ghost] of this.ghosts) {
      const remaining = ghost.expiresAt - now;
      if (remaining <= 0) {
        ghost.destroy();
      } else if (remaining < 60000) {
        // Fade out in the last minute
        ghost.avatar.setAlpha(0.4 * (remaining / 60000));
      }
    }
  }

  /** Feed the ducks at the nearest pond (E key). Broadcast to the room. */
  // Public: same logic as the E key. Called by the mobile interact button.
  triggerInteract() {
    const kind = this.getInteractKind();
    if (kind === 'shelf') {
      const shelf = this._nearestShelf();
      if (shelf) this.onOpenShelf({ shelf: shelf.label, roomId: this.roomId });
    } else if (kind === 'jukebox') {
      this.onOpenJukebox({ roomId: this.roomId });
    } else if (kind === 'duck') {
      // Pet the duck right next to the player (E key, close-up only).
      const duck = this.duckPond?.nearestPettableDuck(this.player.gx, this.player.gy);
      if (duck) this.duckPond.petDuck(duck);
    } else if (kind === 'ducks') {
      this._tryFeedDucks();
    } else if (kind === 'santa-hat-ground') {
      // Santa Hat v1: pick the hat on the ground back up (a full
      // pocket refuses it — the scene shows the standard message,
      // same as the litter pickup).
      const res = this.santaHatSystem?.pickupNearest();
      if (res && res.reason === 'inventory-full') {
        this.onSystemNotice?.(`🎒 ${INVENTORY_FULL_MESSAGE}`);
      }
    } else if (kind === 'cat') {
      this.cafeCat?.petCat(true);
    } else if (kind === 'cat-asleep') {
      // Group puzzle v1.2: E near the sleeping cat counts as one
      // search tap under her (3 taps finds her piece). Silent unless
      // it finds the piece — only when her piece is already found
      // does E just say she's asleep.
      const res = this.puzzleQuest?.searchTapCat();
      if (res && res.reason === 'already-found') {
        this.onSystemNotice?.('💤 The cat is asleep — she wakes up when someone new walks in.');
      }
    } else if (kind === 'key') {
      // Golden Key quest: pick it up, then count the find.
      if (this.hiddenKey?.collect()) this.questManager?.recordEvent('key-found');
    } else if (kind === 'puzzle-table') {
      // Group puzzle quest: open the zoomed-in board.
      this.puzzleQuest?.openBoard();
    } else if (kind === 'tree-box') {
      // Trim the Tree v1: take a free ornament from the box.
      this.trimTreeQuest?.takeOrnament();
    } else if (kind === 'trim-tree') {
      // Trim the Tree v1: hang the ornament I am carrying.
      this.trimTreeQuest?.hangOrnament();
    } else if (kind === 'lights-box') {
      // Christmas Lights v1: take a free light string from the box.
      this.christmasLightsQuest?.takeLight();
    } else if (kind === 'christmas-lights') {
      // Christmas Lights v1: hang the light string I am carrying.
      this.christmasLightsQuest?.hangLight();
    } else if (kind === 'snow-pile') {
      // Build a Snowman v1: take a free snowball from the pile.
      this.snowmanQuest?.takeSnowball();
    } else if (kind === 'build-snowman') {
      // Build a Snowman v1: add the snowball I am carrying.
      this.snowmanQuest?.addSnowball();
    } else if (kind === 'notice-board') {
      // Notice board v1: open the pinned-flyers board.
      this.noticeBoardSystem?.openBoard();
    } else if (kind === 'note') {
      // Pick-Up Notes v1 (`sq-pickup-notes-v1`): read the nearest
      // note on the floor.
      this.noteSystem?.readNearest();
    } else if (kind === 'mailbox') {
      // Mailbox v1: open your mailbox (the key must be in your
      // pocket — MailSystem says so when it is not).
      this.mailSystem?.openMailbox();
    } else if (kind === 'storage-chest') {
      // Your Place v1: open the storage chest panel.
      this.homeStorageSystem?.openStorage();
    } else if (kind === 'floor-item') {
      // Drop on the home floor v1: pick the nearest dropped item
      // back up (a full pocket refuses it — the scene shows the
      // standard message, same as the litter pickup). In a home
      // room that is the home floor store; anywhere else it is the
      // shared floor litter (anyone's litter is pickable).
      if (this.homeStorageSystem?.nearestFloorItem(this.player.gx, this.player.gy)) {
        const res = this.homeStorageSystem?.pickupNearest();
        if (res && res.reason === 'inventory-full') {
          this.onSystemNotice?.(`🎒 ${INVENTORY_FULL_MESSAGE}`);
        }
      } else {
        const res = this.floorLitterSystem?.pickupNearest();
        if (res && res.reason === 'inventory-full') {
          this.onSystemNotice?.(`🎒 ${INVENTORY_FULL_MESSAGE}`);
        }
      }
    } else if (kind === 'decoration') {
      // Decoration Shop v1: pick up the nearest placed decoration
      // (yours comes back to your pocket; a moderator can take down
      // anyone's; someone else's just says whose it is).
      this.decorSystem?.pickupNearest();
    } else if (kind === 'bar' || kind === 'coffee-bar') {
      this._tryBuyDrink();
    } else if (kind === 'shop') {
      // Bread Shop v1 (`sq-bread-shop-v1`): open the Register
      // counter's bread panel (DOM) — the panel itself lists this
      // shop's breads and takes the coins.
      this.onOpenBreadShop?.();
    }
  }

  // Public: what would the E key do right now? Priority: pet a duck
  // right next to you > grab the golden key > feed at the pond >
  // cat > puzzle table > shelf > jukebox. (v1.2: there is no
  // 'puzzle-piece' E action anymore — hidden pieces are found by
  // clicking their furniture, not by an E prompt that would give
  // away where they are.)
  getInteractKind() {
    if (!this.player) return null;
    if (this.duckPond?.nearestPettableDuck(this.player.gx, this.player.gy)) return 'duck';
    if (this.hiddenKey?.nearestKey(this.player.gx, this.player.gy)) return 'key';
    const nearPond = this.duckPond?.nearestFeedablePond(this.player.gx, this.player.gy);
    if (nearPond && this._feedCooldownMs <= 0) return 'ducks';
    // Santa Hat v1: the hat on the ground wins over petting the cat
    // — it fell right beside her, so E picks it up first.
    if (this.santaHatSystem?.nearestGroundHat(this.player.gx, this.player.gy)) return 'santa-hat-ground';
    if (this.cafeCat?.nearestCat(this.player.gx, this.player.gy)) return 'cat';
    if (this.cafeCat?.nearestSleepingCat(this.player.gx, this.player.gy)) return 'cat-asleep';
    if (this.puzzleQuest?.nearestTable(this.player.gx, this.player.gy)) return 'puzzle-table';
    // Christmas Lights v1.3 (`sq-christmas-lights-v1.3`): with a
    // light string in hand, hanging it wins the E key over the
    // tree — the east/west strands pass within the trees' 170px
    // hang ranges, so at the south corner spots E would otherwise
    // hang an ornament (or offer one from the box) instead of the
    // lights. The item in hand decides. Without a string in hand
    // the order below is unchanged.
    if (this.christmasLightsQuest?.carrying && this.christmasLightsQuest?.nearestHangSpot(this.player.gx, this.player.gy)) return 'christmas-lights';
    if (this.trimTreeQuest?.nearestBox(this.player.gx, this.player.gy)) return 'tree-box';
    if (this.trimTreeQuest?.nearestTree(this.player.gx, this.player.gy)) return 'trim-tree';
    if (this.christmasLightsQuest?.nearestBox(this.player.gx, this.player.gy)) return 'lights-box';
    if (this.christmasLightsQuest?.nearestHangSpot(this.player.gx, this.player.gy)) return 'christmas-lights';
    // Build a Snowman v1 (`sq-build-snowman-v1`): with a snowball
    // in hand, adding it wins the E key — same pattern as the
    // lights' carrying line above. Shepherd Park and Agora never
    // share a room, so this never fights the tree or the lights;
    // the order is structural mirroring, not a live conflict.
    if (this.snowmanQuest?.carrying && this.snowmanQuest?.nearestSnowman(this.player.gx, this.player.gy)) return 'build-snowman';
    if (this.snowmanQuest?.nearestPile(this.player.gx, this.player.gy)) return 'snow-pile';
    if (this.snowmanQuest?.nearestSnowman(this.player.gx, this.player.gy)) return 'build-snowman';
    if (this.noticeBoardSystem?.nearestBoard(this.player.gx, this.player.gy)) return 'notice-board';
    // Pick-Up Notes v1 (`sq-pickup-notes-v1`): a note on the floor
    // wins over the mailbox and the litter — it is a distinct
    // readable thing, and standing on it should read it, not open
    // the box behind it.
    if (this.noteSystem?.nearestNote(this.player.gx, this.player.gy)) return 'note';
    // Mailbox v1: the post box at the player's nearest park (or the
    // fallback public place) — after the board, before the chest.
    if (this.mailSystem?.nearestMailbox(this.player.gx, this.player.gy)) return 'mailbox';
    if (this.homeStorageSystem?.nearestChest(this.player.gx, this.player.gy)) return 'storage-chest';
    if (this.homeStorageSystem?.nearestFloorItem(this.player.gx, this.player.gy)) return 'floor-item';
    // Shared Floor Litter v1 (`sq-shared-litter-v1`): shared
    // litter on the floor, same kind as a home floor item — the
    // E key / mobile button picks it up the same way.
    if (this.floorLitterSystem?.nearestLitter(this.player.gx, this.player.gy)) return 'floor-item';
    if (this.decorSystem?.nearestDecoration(this.player.gx, this.player.gy)) return 'decoration';
    // Bread Shop v1 (`sq-bread-shop-v1`): the Register counter in
    // a food-shop room. Checked before the shelves — the counter
    // sits ~60px from the first shelf row, and standing at the
    // counter should open the shop, not a shelf.
    if (this._nearestShopCounter() && this._shopStock().length > 0) return 'shop';
    if (this._nearestShelf()) return 'shelf';
    if (this._nearestJukebox()) return 'jukebox';
    // Coffee bar mobile (`sq-coffee-bar-mobile-v1`): the Agora coffee
    // bar gets its own kind, so the phone's interact button shows a
    // coffee mug instead of a beer mug there.
    const bar = this._nearestBar();
    if (bar) return /coffee/i.test(bar.label || '') ? 'coffee-bar' : 'bar';
    return null;
  }

  _nearestShelf() {
    if (!this.player || !this.roomLayout?.interactZones) return null;
    const px = this.player.gx, py = this.player.gy;
    let best = null, bestD = 110;
    for (const z of this.roomLayout.interactZones) {
      if (z.type !== 'shelf' && z.type !== 'wall_shelf') continue;
      if (!z.label) continue;
      const cx = Math.max(z.x, Math.min(px, z.x + (z.w || 0)));
      const cy = Math.max(z.y, Math.min(py, z.y + (z.h || 0)));
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestD) { bestD = d; best = z; }
    }
    return best ? { label: best.label } : null;
  }

  _nearestJukebox() {
    if (!this.player || !this.roomLayout?.interactZones) return null;
    const px = this.player.gx, py = this.player.gy;
    let best = null, bestD = 110;
    for (const z of this.roomLayout.interactZones) {
      if (z.type !== 'jukebox') continue;
      const cx = Math.max(z.x, Math.min(px, z.x + (z.w || 0)));
      const cy = Math.max(z.y, Math.min(py, z.y + (z.h || 0)));
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestD) { bestD = d; best = z; }
    }
    return best ? { label: best.label } : null;
  }

  _nearestBar() {
    if (!this.player || !this.roomLayout?.interactZones) return null;
    const px = this.player.gx, py = this.player.gy;
    let best = null, bestD = 110;
    for (const z of this.roomLayout.interactZones) {
      if (z.type !== 'counter') continue;
      if (!/bar/i.test(z.label || '')) continue;
      const cx = Math.max(z.x, Math.min(px, z.x + (z.w || 0)));
      const cy = Math.max(z.y, Math.min(py, z.y + (z.h || 0)));
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestD) { bestD = d; best = z; }
    }
    return best ? { label: best.label } : null;
  }

  // Bread Shop v1 (`sq-bread-shop-v1`): the nearest shop counter
  // (the 🛒 Register in a shop room, the ☕ Counter in a cafe) — or
  // null. A counter alone does NOT mean bread: getInteractKind and
  // the prompt also require a non-empty stock (see _shopStock), so
  // a pharmacy or bookshop counter does nothing at all.
  _nearestShopCounter() {
    if (!this.player || !this.roomLayout?.interactZones) return null;
    const px = this.player.gx, py = this.player.gy;
    let best = null, bestD = 110;
    for (const z of this.roomLayout.interactZones) {
      if (z.type !== 'counter') continue;
      if (!/register/i.test(z.label || '') && !/counter/i.test(z.label || '')) continue;
      const cx = Math.max(z.x, Math.min(px, z.x + (z.w || 0)));
      const cy = Math.max(z.y, Math.min(py, z.y + (z.h || 0)));
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestD) { bestD = d; best = z; }
    }
    return best ? { label: best.label } : null;
  }

  /** The bread kinds this room sells (breadStockFor in
   *  breadShop.js) — [] in a non-food shop, so the counter there
   *  does nothing. */
  _shopStock() {
    try {
      return breadStockFor({
        roomId: this.roomId || '',
        roomName: this.roomName || '',
        amenityTag: this.amenityTag || '',
        shopTag: this.shopTag || '',
      });
    } catch {
      return [];
    }
  }

  // Order a drink at the bar counter. The bartender NPC serves it:
  // coins are charged when the drink is handed over, not when ordered.
  // Rooms with a bar counter but no bartender keep the old instant buy.
  // Agora is the exception: the coffee bar there opens the shop
  // panel (Decoration Shop v1) — coffee OR a decoration — instead
  // of buying a coffee on the spot.
  async _tryBuyDrink() {
    if (this._drinkCooldownMs > 0) return;
    const avatar = this.player?.avatar;
    if (!avatar || typeof avatar.playDrink !== 'function') return;
    // Staffed bar: E asks the bartender, and HE presents the options
    // (the drink card). No card from down the bar — walk up to him.
    const btNpc = this._bartenderNpc();
    if (btNpc) {
      if (Math.hypot(this.player.gx - btNpc.gx, this.player.gy - btNpc.gy) <= 170) {
        // Say Hello to the Bartender quest (also step 1 of the
        // Bartender's Errand): opening the drink card IS the hello.
        this.questManager?.recordEvent('bartender-talk');
        this._openDrinkCard();
      }
      return;
    }
    // Agora coffee bar: the shop panel offers coffee or a
    // decoration — no instant buy from E anymore.
    if (this.roomId === 'agora-houston') {
      this.onOpenDecorShop?.();
      return;
    }
    await this._buyCoffeeInstant();
  }

  /** The shop panel's coffee button: the same instant buy E at the
   * bar used to do in Agora. Returns { ok, reason? } for the panel. */
  async buyCoffeeFromShop() {
    return this._buyCoffeeInstant();
  }

  /** Buy a hot cocoa or an iced coffee at the Agora bar
   * (Temperature System v1, `sq-temperature-v1`): -2 coins like
   * coffee, the same drink animation, and the temperature effect
   * — cocoa warms (cold season), iced coffee cools (warm
   * season). A drink of the wrong temperature for the season is
   * just a drink. No puzzle piece roll (that is coffee-only),
   * no buzz (these are soft drinks — unlike coffee, which keeps
   * its existing buzz behaviour). Returns { ok, reason? }. */
  async buyBarDrink(kind) {
    if (kind !== 'cocoa' && kind !== 'iced-coffee') return { ok: false, reason: 'bad-kind' };
    if (this._drinkCooldownMs > 0) return { ok: false, reason: 'cooldown' };
    const avatar = this.player?.avatar;
    if (!avatar || typeof avatar.playDrink !== 'function') return { ok: false, reason: 'error' };
    let wallet;
    try {
      wallet = await import('./CoinWallet.js');
    } catch {
      return { ok: false, reason: 'error' };
    }
    if (wallet.getCoins() < wallet.BAR_DRINK_COST) {
      this._drinkBrokeUntil = this.time.now + 1300;
      return { ok: false, reason: 'not-enough-coins' };
    }
    if (!wallet.spendCoins(wallet.BAR_DRINK_COST)) {
      this._drinkBrokeUntil = this.time.now + 1300;
      return { ok: false, reason: 'not-enough-coins' };
    }
    this._drinkCooldownMs = 3000;
    this._drinkAnimUntil = this.time.now + 2600;
    avatar.playDrink();
    if (kind === 'cocoa') {
      this.onSystemNotice?.('🍫 Hot cocoa! -2 coins — enjoy!');
      this.temperatureSystem?.drinkWarm();
    } else {
      this.onSystemNotice?.('🧊 Iced coffee! -2 coins — enjoy!');
      this.temperatureSystem?.drinkCool();
    }
    this.socket?.emit('buy_drink', { roomId: this.roomId });
    return { ok: true };
  }

  /** Instant coffee/drink buy at a bar with no bartender on shift:
   * -2 coins, drink animation, puzzle coffee roll in Agora.
   * Returns { ok, reason? } — 'not-enough-coins' flashes the
   * "need coins" prompt instead. */
  async _buyCoffeeInstant() {
    if (this._drinkCooldownMs > 0) return { ok: false, reason: 'cooldown' };
    const avatar = this.player?.avatar;
    if (!avatar || typeof avatar.playDrink !== 'function') return { ok: false, reason: 'error' };
    let wallet;
    try {
      wallet = await import('./CoinWallet.js');
    } catch {
      return { ok: false, reason: 'error' };
    }
    if (wallet.getCoins() < wallet.BAR_DRINK_COST) {
      this._drinkBrokeUntil = this.time.now + 1300;
      return { ok: false, reason: 'not-enough-coins' };
    }
    // No bartender on shift here: instant buy, as before.
    if (!wallet.spendCoins(wallet.BAR_DRINK_COST)) {
      this._drinkBrokeUntil = this.time.now + 1300;
      return { ok: false, reason: 'not-enough-coins' };
    }
    this._drinkCooldownMs = 3000;
    this._drinkAnimUntil = this.time.now + 2600;
    this._raiseBuzz(this.socket?.id || '__local__');
    avatar.playDrink();
    // Agora coffee: say so in the notice, so the -2 coins reads as a
    // coffee purchase, not a beer. (No Coffee Quest yet — this is just
    // the bar + buy-coffee from the Agora furniture pass.)
    if (this.roomId === 'agora-houston') {
      this.onSystemNotice?.('☕ Fresh coffee! -2 coins — enjoy!');
      // Group puzzle v1.2: a coffee has a 1-in-3 chance of
      // containing puzzle piece 8. The coffee still costs 2 coins;
      // the piece is the reward, never coins. The piece is an
      // INVENTORY item: a full pocket means it stays in the coffee
      // (unclaimed) — the next coffee rolls again.
      try {
        const coffeePiece = this.puzzleQuest?.tryCoffeePiece();
        if (coffeePiece && coffeePiece.reason === 'inventory-full') {
          this.onSystemNotice?.(`🎒 ${INVENTORY_FULL_MESSAGE}`);
        }
      } catch {}
    }
    // Temperature System v1 (`sq-temperature-v1`): coffee is a
    // warm drink — it warms you for 30 minutes in the cold season
    // (a no-op in the warm season; the system decides).
    this.temperatureSystem?.drinkWarm();
    this.socket?.emit('buy_drink', { roomId: this.roomId });
    return { ok: true };
  }

  // Index of the player's remembered usual in BEER_MENU (0 if none yet).
  _usualBeerIndex() {
    try {
      const last = window.localStorage.getItem(LAST_BEER_KEY);
      const idx = BEER_MENU.findIndex((b) => b.id === last);
      return idx >= 0 ? idx : 0;
    } catch {
      return 0;
    }
  }

  // THE DRINK CARD: the bartender presents the options himself — a
  // floating card at his shoulder, his question as its header, one
  // tappable row per drink. Pick a row: he says "here you go" (at the
  // hand-off bubble), you pay, you drink. This is the transaction,
  // presented inside the conversation with him — no free-text
  // guessing required (chat ordering still works as a side door).
  _buildDrinkCard() {
    const rows = [...BEER_MENU, { id: 'water', label: 'Water' }];
    const rowH = 21;
    const headerH = 24;
    const W = 176;
    const H = headerH + rows.length * rowH + 8;
    const c = this.add.container(0, 0).setDepth(DEPTH.UI + 5).setVisible(false);
    const bg = this.add.rectangle(0, 0, W, H, 0x1f2937, 0.94).setOrigin(0.5, 1);
    bg.setStrokeStyle(1, 0xf59e0b, 0.9);
    c.add(bg);
    const header = this.add.text(0, -H + 4, "What'll ya have?", {
      fontSize: '13px', color: '#fbbf24', fontStyle: 'bold',
    }).setOrigin(0.5, 0);
    c.add(header);
    rows.forEach((beer, i) => {
      const y = -H + headerH + i * rowH + 2;
      const label = beer.id === 'surprise' ? '🎲 Surprise me'
        : beer.id === 'water' ? '💧 Water · free' : `${beer.label} · 2🪙`;
      const t = this.add.text(0, y, label, {
        fontSize: '13px', color: '#f9fafb',
        backgroundColor: 'rgba(255,255,255,0.08)',
        padding: { x: 6, y: 2 },
      }).setOrigin(0.5, 0);
      t.setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => { this._orderFromCard(beer); this.target = null; });
      c.add(t);
    });
    this._drinkCard = c;
  }

  _openDrinkCard() {
    const bt = this._bartenderNpc();
    if (!bt) return;
    // Rebuilt per open.
    this._drinkCard?.destroy();
    this._drinkCard = null;
    this._buildDrinkCard();
    this._drinkCard.setPosition(bt.gx, bt.gy - 60).setVisible(true);
    this._drinkCardUntil = this.time.now + 25000;
  }

  _orderFromCard(beer) {
    this._drinkCard?.setVisible(false);
    const bt = this._bartenderNpc();
    if (!bt) return;
    let pick = beer;
    if (pick.id === 'surprise') {
      const taps = BEER_MENU.filter((b) => b.id !== 'surprise');
      pick = taps[Math.floor(Math.random() * taps.length)];
    }
    if (pick.id !== 'water' && this.walletMod && this.walletMod.getCoins() < this.walletMod.BAR_DRINK_COST) {
      this._serveBubbleNpc = bt;
      this._serveBubbleText = "Tab's closed till you scare up some coins, friend";
      this._serveBubbleUntil = this.time.now + 2600;
      this._serveBubbleFrom = 0;
      return;
    }
    if (this._placeDrinkOrder(pick.label)) this._announceOrder(bt, pick.label);
  }

  // The order speaks: his bubble + a line in the chat, together.
  _announceOrder(npc, label) {
    this._serveBubbleNpc = npc;
    this._serveBubbleText = `One ${label} — coming right up`;
    this._serveBubbleUntil = this.time.now + 2400;
    this._serveBubbleFrom = 0;
    this.onChatMessage({
      senderName: npc.name || 'Bartender',
      message: `One ${label} — coming right up.`,
      isSelf: false,
      distance: Math.round(Math.hypot(this.player.gx - npc.gx, this.player.gy - npc.gy)),
      timestamp: Date.now(),
      channel: 'npc',
      npcId: npc.id,
    });
  }

  // Queue an order for the local player and tell the room. Ordering a
  // beer also makes it the remembered usual. Returns false when an
  // order is already outstanding or the queue is full.
  _placeDrinkOrder(beerLabel) {
    const myId = this.socket?.id || '__local__';
    if (this._drinkQueue.some((entry) => entry.socketId === myId)) return false;
    if (this.staticNpcs.some((npc) => npc.serve?.socketId === myId)) return false;
    if (this._drinkQueue.length >= 4) return false;
    // The cutoff: substantially drunk and asking for alcohol, he
    // won't serve you. Water always gets through — it's the way back.
    if (beerLabel !== 'Water' && this._buzzLevel(myId) >= 0.66) {
      const bt = this._bartenderNpc();
      if (bt) {
        this._serveBubbleNpc = bt;
        this._serveBubbleText = "You've had enough, friend — water's free 💧";
        this._serveBubbleFrom = 0;
        this._serveBubbleUntil = this.time.now + 3200;
      }
      return false;
    }
    const tap = BEER_MENU.find((b) => b.label === beerLabel);
    if (tap) {
      try { window.localStorage.setItem(LAST_BEER_KEY, tap.id); } catch { /* private mode */ }
    }
    this._enqueueDrinkOrder(myId, beerLabel);
    this.socket?.emit('order_drink', { roomId: this.roomId, beer: beerLabel });
    // Barfly quest: a placed order for a NEW beer counts (water doesn't
    // — this is a bar). The card and the conversational order both land
    // here, so both count.
    if (beerLabel !== 'Water') {
      this.questManager?.recordDistinct('beer-ordered', beerLabel, 'beers');
    }
    return true;
  }

  // Conversational ordering: the player is talking to the bartender and
  // their words can BE the order. We never parse the bartender's AI
  // lines (his wording is his own) — only the player's own message:
  //   - naming a tap ("lonestar", "an ipa") orders that beer;
  //   - an explicit request ("i'll have a beer", "get me one") orders
  //     the usual;
  //   - a short affirmation ("sure", "yes please", "the usual") orders
  //     the usual, but ONLY while a conversation window is armed (he
  //     replied recently / we're mid-exchange), so a stray "yes" aimed
  //     at a friend can't spend coins. The serve still charges at the
  //     hand-off, and wandering off still cancels for free.
  _maybeConversationalOrder(message, npc, wasArmed) {
    if (!npc?.isBartender || !this.player) return;
    if (Math.hypot(this.player.gx - npc.gx, this.player.gy - npc.gy) > 170) return;
    const norm = String(message || '').toLowerCase().replace(/[.!?,]+$/, '').trim();
    if (!norm) return;
    let label = null;
    if (!label && /\blone\s?star\b/.test(norm)) label = 'Lone Star';
    else if (!label && /\bvoodoo\b/.test(norm)) label = 'Voodoo Ranger';
    else if (!label && /\bipa\b/.test(norm)) label = 'IPA';
    else if (!label && /\bultra\b|\bmichelob\b/.test(norm)) label = 'Ultra';
    else if (!label && /\bcider\b|\beastciders\b/.test(norm)) label = 'Cider';
    else if (!label && /\blager\b/.test(norm)) label = 'Lager';
    else if (!label && /\bstout\b/.test(norm)) label = 'Stout';
    else if (!label && /\bwater\b/.test(norm)) label = 'Water';
    else if (!label && /\bsurprise\b/.test(norm)) {
      const taps = BEER_MENU.filter((b) => b.id !== 'surprise');
      label = taps[Math.floor(Math.random() * taps.length)].label;
    }
    else if (!label && BEER_REQUEST.test(norm) && /\b(beer|drink|one)\b/.test(norm)) label = BEER_MENU[this._usualBeerIndex()].label;
    else if (!label && /\bbeer\b/.test(norm) && norm.split(/\s+/).length <= 4) label = BEER_MENU[this._usualBeerIndex()].label;
    else {
      // Reply-shaped phrases ("the usual", "sounds good") only make
      // sense as answers to his offer, so they work unarmed; bare
      // yes/sure still need the armed conversation window.
      const words = norm.split(/\s+/);
      if (words.length <= 5 && (AFFIRM_PHRASES.has(norm) || (wasArmed && AFFIRM_FIRST_WORDS.has(words[0])))) {
        label = BEER_MENU[this._usualBeerIndex()].label;
      }
    }
    if (!label) return;
    if (this.walletMod && this.walletMod.getCoins() < this.walletMod.BAR_DRINK_COST) {
      this._serveBubbleNpc = npc;
      this._serveBubbleText = "Tab's closed till you scare up some coins, friend";
      this._serveBubbleUntil = this.time.now + 2600;
      this._serveBubbleFrom = 0;
      return;
    }
    if (this._placeDrinkOrder(label)) this._announceOrder(npc, label);
  }

  // The room's bartender: an employee NPC whose label says so.
  _bartenderNpc() {
    return this.staticNpcs?.find((npc) => /bartender/i.test(npc.name || '')) || null;
  }

  _enqueueDrinkOrder(socketId, beer) {
    if (!socketId) return;
    if (this._drinkQueue.some((entry) => entry.socketId === socketId)) return;
    if (this.staticNpcs?.some((npc) => npc.serve?.socketId === socketId)) return;
    if (this._drinkQueue.length >= 4) return;
    const label = typeof beer === 'string' && beer.length > 0 && beer.length <= 40 ? beer : 'Beer';
    this._drinkQueue.push({ socketId, beer: label });
    this._pumpDrinkQueue();
  }

  // Hand queued orders to idle bartenders, first come first served.
  _pumpDrinkQueue() {
    if (!this._drinkQueue?.length || !this.staticNpcs?.length) return;
    const bartender = this.staticNpcs.find(
      (npc) => /bartender/i.test(npc.name || '') && !npc.serve
    );
    if (!bartender) return;
    const entry = this._drinkQueue.shift();
    const spot = this._serveSpotFor(bartender, entry.socketId);
    bartender.target = null;
    bartender.serve = { socketId: entry.socketId, beer: entry.beer, phase: 'toSpot', spotX: spot.x, spotY: spot.y, pourUntil: 0 };
  }

  // Where the bartender stands to serve: on his own line (homeY), at the
  // x nearest the customer, clamped to the counter's span.
  _serveSpotFor(bartender, socketId) {
    const actor = socketId === (this.socket?.id || '__local__') || socketId === '__local__'
      ? this.player
      : this.remotePlayers.get(socketId);
    const zone = this._nearestBarZone();
    let x = bartender.homeX;
    if (actor && Number.isFinite(actor.gx)) x = actor.gx;
    if (zone) x = Math.max(zone.x + 30, Math.min(x, zone.x + (zone.w || 0) - 30));
    const y = bartender.homeY;
    if (this.roomLayout?.isPointInsideRoom(x, y, 20) && !this.roomLayout?.collidesWithSolid(x, y, 18)) {
      return { x, y };
    }
    return { x: bartender.homeX, y };
  }

  _nearestBarZone() {
    if (!this.roomLayout?.interactZones) return null;
    for (const z of this.roomLayout.interactZones) {
      if (z.type === 'counter' && /bar/i.test(z.label || '')) return z;
    }
    return null;
  }

  // Step an NPC through a drink serve. Returns whether it moved.
  // Runs instead of patrol while npc.serve is set; the Inworld dialogue
  // side of the NPC is not touched by any of this.
  _stepNpcServe(npc, delta) {
    const serve = npc.serve;
    const stepToward = (tx, ty, speedFactor) => {
      const dx = tx - npc.gx;
      const dy = ty - npc.gy;
      const distance = Math.hypot(dx, dy);
      if (distance < 5) return { arrived: true, moving: false };
      const step = Math.min(distance, (SPEED * speedFactor * delta) / 1000);
      const nextX = npc.gx + (dx / distance) * step;
      const nextY = npc.gy + (dy / distance) * step;
      const resolved = this.roomLayout?.resolveAgainstSolids(npc.gx, npc.gy, nextX, nextY, 16);
      const rx = resolved?.x ?? nextX;
      const ry = resolved?.y ?? nextY;
      if (Math.hypot(rx - npc.gx, ry - npc.gy) < 1) return { arrived: true, moving: false };
      npc.gx = rx;
      npc.gy = ry;
      if (Math.abs(dy) >= Math.abs(dx)) npc.direction = dy > 0 ? 'front' : 'back';
      else { npc.direction = 'side'; npc.facingLeft = dx < 0; }
      return { arrived: false, moving: true };
    };

    if (serve.phase === 'toSpot') {
      const r = stepToward(serve.spotX, serve.spotY, 0.55);
      if (r.arrived) {
        serve.phase = 'pour';
        serve.pourUntil = this.time.now + 1100;
        // His line lands with the pour — before the mug ever rises.
        this._serveBubbleNpc = npc;
        this._serveBubbleText = serve.beer === 'Water' ? 'Here you go 💧' : 'Here you go 🍺';
        this._serveBubbleFrom = 0;
        this._serveBubbleUntil = serve.pourUntil + 250;
        // Face the customer across the counter.
        const actor = serve.socketId === (this.socket?.id || '__local__') || serve.socketId === '__local__'
          ? this.player
          : this.remotePlayers.get(serve.socketId);
        if (actor && Number.isFinite(actor.gx)) {
          const pdx = actor.gx - npc.gx;
          const pdy = actor.gy - npc.gy;
          if (Math.abs(pdy) >= Math.abs(pdx)) npc.direction = pdy > 0 ? 'front' : 'back';
          else { npc.direction = 'side'; npc.facingLeft = pdx < 0; }
        }
      }
      return r.moving;
    }

    if (serve.phase === 'pour') {
      if (this.time.now < serve.pourUntil) return false;
      this._finishServe(npc);
      serve.phase = 'return';
      return false;
    }

    // 'return': walk back home, then take the next order in the queue.
    const r = stepToward(npc.homeX, npc.homeY, 0.45);
    if (r.arrived) {
      npc.serve = null;
      this._pumpDrinkQueue();
    }
    return r.moving;
  }

  // The hand-off moment: if the customer is still at the bar, they get
  // their drink (and the local customer pays now). If they wandered off,
  // no drink, no charge.
  // Buzz bookkeeping: each finished drink adds ~a third of the
  // meter; the meter drains linearly (full-to-sober in ~4 min).
  // The avatars perform whatever level this returns.
  _raiseBuzz(id) {
    if (!id) return;
    const eff = this._buzzLevel(id);
    this._buzz.set(id, { level: Math.min(1, eff + 0.34), at: this.time.now });
  }

  _soberBuzz(id, amount) {
    if (!id) return;
    const eff = this._buzzLevel(id);
    this._buzz.set(id, { level: Math.max(0, eff - amount), at: this.time.now });
  }

  _buzzLevel(id) {
    const cur = this._buzz.get(id);
    if (!cur) return 0;
    return Math.max(0, cur.level - (this.time.now - cur.at) / 240000);
  }

  _finishServe(npc) {
    const serve = npc.serve;
    if (!serve) return;
    const isMine = serve.socketId === '__local__' || serve.socketId === this.socket?.id;
    const actor = isMine ? this.player : this.remotePlayers.get(serve.socketId);
    if (!actor?.avatar || typeof actor.avatar.playDrink !== 'function') return;
    const zone = this._nearestBarZone();
    let nearBar = true;
    if (zone && Number.isFinite(actor.gx)) {
      const cx = Math.max(zone.x, Math.min(actor.gx, zone.x + (zone.w || 0)));
      const cy = Math.max(zone.y, Math.min(actor.gy, zone.y + (zone.h || 0)));
      nearBar = Math.hypot(actor.gx - cx, actor.gy - cy) <= 170;
    }
    if (!nearBar) {
      if (isMine) this._drinkMissedUntil = this.time.now + 1600;
      return;
    }
    if (isMine && serve.beer !== 'Water') {
      import('./CoinWallet.js')
        .then((wallet) => { wallet.spendCoins(wallet.BAR_DRINK_COST); })
        .catch(() => {});
    }
    if (isMine) {
      this.onChatMessage({
        senderName: npc.name || 'Bartender',
        message: `*hands you the ${serve.beer || 'beer'}*`,
        isSelf: false,
        distance: Math.round(Math.hypot(this.player.gx - npc.gx, this.player.gy - npc.gy)),
        timestamp: Date.now(),
        channel: 'npc',
        npcId: npc.id,
      });
    }
    if (serve.beer === 'Water') this._soberBuzz(serve.socketId, 0.55);
    else this._raiseBuzz(serve.socketId);
    if (serve.beer === 'Water') {
      if (isMine) this._drinkAnimUntil = this.time.now + 1900;
      // Water has its own animation — a clear glass, quick gulps.
      if (typeof actor.avatar.playWaterDrink === 'function') actor.avatar.playWaterDrink();
      else actor.avatar.playDrink();
    } else {
      if (isMine) this._drinkAnimUntil = this.time.now + 2600;
      actor.avatar.playDrink();
      // Temperature System v1 (`sq-temperature-v1`): a served beer
      // is a cold drink — it cools the local player for 30 minutes
      // in the warm season (a no-op in the cold season; the system
      // decides). Remote players' serves never touch our state.
      if (isMine) this.temperatureSystem?.drinkCool();
    }
  }

  _syncYouTubeJukebox(nowPlaying) {
    const vid = nowPlaying?.youtubeVideoId || null;
    const songId = nowPlaying?.id || null;
    this._ytSongId = songId;
    this._ytWantedVid = vid;
    if (vid) {
      if (getYouTubeVideoId() === vid) return; // already playing
      // Jukebox Seek v1 (`sq-jukebox-seek-v1`): start mid-song when
      // joining late or rejoining after a restart — the server's
      // startedAt says how far in the room already is. A client already
      // playing this video never reloads (early return above), so this
      // only fires on a fresh load. Missing/unusable startedAt seeks 0.
      const startSeconds = jukeboxElapsedSeconds(nowPlaying?.startedAt);
      playYouTube(vid, {
        startSeconds,
        onEnded: (endedVid) => {
          if (this.socket?.connected && this._ytSongId) {
            this.socket.emit('youtube_ended', { roomId: this.roomId, songId: this._ytSongId });
          }
        },
        onError: () => {
          // Embed blocked: skip it so the queue doesn't stall.
          if (this.socket?.connected && this._ytSongId) {
            this.socket.emit('youtube_ended', { roomId: this.roomId, songId: this._ytSongId });
          }
        },
      });
    } else {
      stopYouTube();
    }
  }

  _updateJukeboxAudio() {
    // YouTube is the only jukebox audio — this just fades it with
    // distance to the nearest jukebox (full volume close, silent far).
    if (!this._ytWantedVid) return;
    if (!this.player || !this.roomLayout?.interactZones) {
      setYouTubeVolume(0);
      return;
    }
    let best = null, bestD = Infinity;
    for (const z of this.roomLayout.interactZones) {
      if (z.type !== 'jukebox') continue;
      const jx = z.x + (z.w || 0) / 2;
      const jy = z.y + (z.h || 0) / 2;
      const d = Math.hypot(this.player.gx - jx, this.player.gy - jy);
      if (d < bestD) { bestD = d; best = { x: jx, y: jy }; }
    }
    if (best) {
      const dist = Math.hypot(this.player.gx - best.x, this.player.gy - best.y);
      const vol = dist <= 250 ? 0.8 : Math.max(0.05, 0.8 * (1 - (dist - 250) / 450));
      setYouTubeVolume(dist <= 700 ? vol : 0);
    } else {
      setYouTubeVolume(0);
    }
  }

  // Feed the Ducks v2 (`sq-feed-ducks-v2`): feeding costs food — one
  // charge from a bits-of-food item (3 feeds per item). The pond
  // prompt stays visible with no food so players discover feeding;
  // pressing E then just says so (no crumb, no broadcast, no quest
  // step). preferredFoodId is the item the player tapped Use on (the
  // pocket path); the E-key path passes none and spends from the food
  // with the fewest charges left. Returns true when a feed happened.
  _tryFeedDucks(preferredFoodId = null) {
    if (!this.duckPond || this._feedCooldownMs > 0) return false;
    if (!this.player) return false;
    const pond = this.duckPond.nearestFeedablePond(this.player.gx, this.player.gy);
    if (!pond) return false;
    // The gate: no food in the pocket, no feed.
    if (!findFoodItem(getInventory(), preferredFoodId)) {
      try { this.onSystemNotice?.(NO_FOOD_MESSAGE); } catch {}
      return false;
    }
    // Toss the crumb toward the pond center from the player's position.
    const cx = pond.x + pond.w / 2;
    const cy = pond.y + pond.h / 2;
    const dx = cx - this.player.gx;
    const dy = cy - this.player.gy;
    const d = Math.hypot(dx, dy) || 1;
    const toss = Math.min(d * 0.45, 120);
    const fx = this.player.gx + (dx / d) * toss;
    const fy = this.player.gy + (dy / d) * toss;
    if (this.duckPond.feed(fx, fy)) {
      // One charge, not the whole item. The gate above guarantees a
      // food item exists, so this cannot fail in normal play.
      spendFoodCharge(preferredFoodId);
      this._feedCooldownMs = 2500;
      this.socket?.emit('feed_ducks', { roomId: this.roomId, x: Math.round(fx), y: Math.round(fy) });
      // Feeding tosses crumbs to the pond ducks, and pond ducks don't
      // count toward the Duck Roundup — so feeding no longer records
      // a quest step. Only petting a roaming duck does. It DOES count
      // as step 2 of the Bartender's Errand (via recordGlobalEvent).
      this.questManager?.recordEvent('ducks-fed');
      return true;
    }
    return false;
  }

  /** Decoration Shop v1.1 (`sq-dec-shop-v1-1`): true once the server
   * has confirmed this socket's room join (first room_state after
   * connecting). DecorSystem gates decor_place / decor_remove on it:
   * the server silently drops those emits when room membership is
   * not registered yet, which used to leave a place stuck at
   * "Placing it…" forever. */
  isRoomJoined() {
    return this._roomJoinConfirmed === true;
  }

  _connectSocket() {
    const socket = io(SOCKET_SERVER_URL, { transports: ['websocket'] });
    this.socket = socket;
    // Decoration Shop v1.1 (`sq-dec-shop-v1-1`): true once the server
    // has confirmed this socket's room join (first room_state after
    // connecting). DecorSystem gates decor_place / decor_remove on
    // it — the server silently drops those emits before room
    // membership is registered. Cleared on disconnect and on every
    // (re)connect, before join_room goes out again.
    this._roomJoinConfirmed = false;
    this._fallbackSyncTimer = null;
    this._lastDecorSyncAt = 0;
    this._lastPresenceSyncAt = 0;
    const userId = this.profile?.profile?.email || this.profile?.mode || 'guest';
    this.userId = userId;
    const userName = this.profile?.profile?.characterName || 'Traveler';
    const firstName = this.profile?.profile?.firstName || userName.split(' ')[0];
    const ownerId = String(this.roomOwnerId || '').trim();
    const isCreator = Boolean(ownerId && (ownerId === String(userId) || ownerId === String(userName)));

    socket.on('join_denied', ({ reason } = {}) => {
      this.onSystemNotice?.(reason || 'You must be within GPS range of this location to enter.');
      this.onLeave?.();
    });

    socket.on('connect', () => {
      // Decoration Shop v1.1: a fresh (re)connect starts unjoined
      // until the first room_state proves the server processed the
      // join — see isRoomJoined().
      this._roomJoinConfirmed = false;
      socket.emit('join_room', {
        roomId: this.roomId,
        lat: this.userLocation?.latitude ?? null,
        lng: this.userLocation?.longitude ?? null,
        user: {
          id: userId,
          email: this.profile?.profile?.email || '',
          // Notes Guest Block v1.1 (`sq-notes-guest-block-v1.1`):
          // tell the server explicitly whether this player is a
          // guest. The email alone cannot say it — a guest carries
          // a fake `guest_XXXX@side.quest` email (app.jsx), so the
          // server's "no email" check never fired. The server also
          // treats an @side.quest email as a guest, as a backstop
          // for older clients that do not send this flag.
          guestMode: this.profile?.mode === 'guest' || Boolean(this.profile?.profile?.guestMode),
          name: userName,
          firstName,
          isCreator,
          ...this.avatarState,
          // Bag upgrade (Items + Inventory v1): sent so other players'
          // clients can draw the bag on this avatar. NOTE: the server
          // builds playerState from a fixed whitelist (server/socket.js
          // join_room) that does NOT include hasBag yet — other players
          // will only see the bag once that one line lands (see the kit
          // report). Your own avatar shows it immediately.
          hasBag: (() => { try { return inventoryHasBag(); } catch { return false; } })(),
          // Quest badges v1: my own local completions record, so the
          // server can put my badges in playerState and the room
          // sees them on join (validated server-side against the
          // known quest list; a restart never loses them because
          // the client re-sends them every connect).
          badges: (() => { try { return this.questManager?.getCompletedMap?.() || {}; } catch { return {}; } })(),
        },
      });
      socket.emit('get_room_state', { roomId: this.roomId });
      socket.emit('get_room_decorations', { roomId: this.roomId });
      // Decoration Shop v1.1 (`sq-dec-shop-v1-1`): re-request the
      // room's placed decorations on (re)connect. The burst had
      // every other get_* call but never get_decor, so a decoration
      // the server stored during a disconnect window never came
      // back until something else triggered a refresh.
      socket.emit('get_decor', { roomId: this.roomId });
      // Shared Floor Litter v1 (`sq-shared-litter-v1`): re-request
      // the room's floor litter on (re)connect, so a drop made
      // during a disconnect window comes back.
      socket.emit('get_floor_litter', { roomId: this.roomId });
      socket.emit('get_jukebox', { roomId: this.roomId });
      socket.emit('get_pumpkins', { roomId: this.roomId });
      socket.emit('get_cat', { roomId: this.roomId });
      // Hungry Cat v1 (`sq-hungry-cat-v1`): re-request the hunger
      // state on (re)connect, so a window that opened during a
      // disconnect comes back with the bubble + banner.
      socket.emit('get_cat_hunger', { roomId: this.roomId });
      // Santa Hat v1: re-request the hat's state on (re)connect, so
      // a hat placed / slipped during a disconnect window comes back.
      socket.emit('get_hat', { roomId: this.roomId });
      socket.emit('get_quest_state', { roomId: this.roomId });
      socket.emit('get_puzzle', { roomId: this.roomId });
      // Fetch fix v1 (`sq-fetch-fix-v1`): re-request the Christmas
      // lights, tree, and snowman state on (re)connect. The burst
      // asked for every other room state but never these three, so
      // a fresh joiner rendered bare strands even when the server
      // had the saved state — the only get_lights / get_tree emits
      // lived in the completion handlers, which only fire after a
      // room finishes. Same precedent as the Decoration Shop v1.1
      // and Shared Floor Litter v1 fixes.
      socket.emit('get_lights', { roomId: this.roomId });
      socket.emit('get_tree', { roomId: this.roomId });
      socket.emit('get_snowman', { roomId: this.roomId });
      socket.emit('get_board', { roomId: this.roomId });
      // Pick-Up Notes v1 (`sq-pickup-notes-v1`): re-request the
      // room's notes on (re)connect, so a note left during a
      // disconnect window comes back — and one whose 48 hours ran
      // out does not.
      socket.emit('get_notes', { roomId: this.roomId });
      socket.emit('get_home', { roomId: this.roomId });
      // Mailbox v1: re-request the inbox on (re)connect, so mail
      // sent during a disconnect window comes back — and the login
      // toast fires when there is unread mail.
      socket.emit('get_mail', { roomId: this.roomId });
      socket.emit('get_time_phase', {});
      // Quest badges v1: re-sync my local completions record so the
      // server's per-player badge store (wiped by a restart) comes
      // back, and the room hears about my badges.
      try { this.questManager?.syncBadgesToServer?.(); } catch {}
      // Your Place v1: re-sync my local stored-items record so the
      // server's per-player home store (wiped by a restart) comes
      // back — stored items survive a restart the same way badges do.
      try { this.homeStorageSystem?.syncToServer?.(); } catch {}
      const now = Date.now();
      this._lastPresenceSyncAt = now;
      this._lastDecorSyncAt = now;
      if (this._fallbackSyncTimer) clearInterval(this._fallbackSyncTimer);
      this._fallbackSyncTimer = setInterval(() => this._runFallbackSync(), 1000);
    });

    socket.on('disconnect', () => {
      // Decoration Shop v1.1: the join confirmation belongs to this
      // socket — a disconnect voids it until the next connect's
      // room_state.
      this._roomJoinConfirmed = false;
      if (this._fallbackSyncTimer) {
        clearInterval(this._fallbackSyncTimer);
        this._fallbackSyncTimer = null;
      }
    });

    socket.on('room_state', (state) => {
      // Decoration Shop v1.1: the server emits room_state to the
      // joiner at the END of join_room (after membership is
      // registered), and answers get_room_state the same way — the
      // burst sends join_room first, so any room_state received on
      // this socket proves the join is confirmed.
      this._roomJoinConfirmed = true;
      const groupedState = new Map();
      const canonicalState = new Map();
      const nextIds = new Set();

      Object.entries(state || {}).forEach(([sid, player]) => {
        if (!sid || sid === socket.id) return;
        if (player?.id && this.userId && String(player.id) === String(this.userId)) return;

        const userKey = this._remoteUserKey(player, sid);
        if (!groupedState.has(userKey)) groupedState.set(userKey, []);
        groupedState.get(userKey).push({ sid, player });
      });

      groupedState.forEach((entries, userKey) => {
        const activeSidForUser = this._findRemoteSocketIdByUserKey(userKey);
        const activeEntry = activeSidForUser
          ? entries.find((entry) => entry.sid === activeSidForUser)
          : null;
        const chosen = activeEntry || entries[0];
        if (chosen) canonicalState.set(userKey, chosen);
      });

      canonicalState.forEach(({ sid }) => nextIds.add(sid));

      this.remotePlayers.forEach((remotePlayer, sid) => {
        if (!nextIds.has(sid)) {
          this._removeRemoteBySocketId(sid);
        }
      });

      canonicalState.forEach(({ sid, player }) => {
        const remotePlayer = this.remotePlayers.get(sid);
        if (remotePlayer) {
          const nextPoint = this._clampRemotePosition(player.x ?? remotePlayer.gx, player.y ?? remotePlayer.gy);
          const prevX = remotePlayer.gx;
          const prevY = remotePlayer.gy;
          remotePlayer.gx = nextPoint.x;
          remotePlayer.gy = nextPoint.y;
          const ddx = remotePlayer.gx - prevX;
          const ddy = remotePlayer.gy - prevY;
          if (Math.abs(ddx) > 0.5 || Math.abs(ddy) > 0.5) {
            remotePlayer.movingUntil = this.time.now + 220;
            if (Math.abs(ddy) >= Math.abs(ddx)) {
              remotePlayer.dir = ddy > 0 ? 'front' : 'back';
            } else {
              remotePlayer.dir = 'side';
              remotePlayer.facingLeft = ddx < 0;
            }
          }
          remotePlayer.sync();
          // Quest badges v1: keep their badge record fresh from the
          // room state too (room_state re-renders on the fallback
          // sync, so a badge earned while you weren't looking still
          // lands in their label).
          if (player.badges !== undefined) this._updateRemoteBadges(sid, player.badges);
        } else {
          this._spawnRemote(sid, player);
        }
      });
      this._emitRoomPopulation();
    });

    socket.on('player_joined', ({ socketId, player }) => {
      if (socketId !== socket.id && !(player?.id && this.userId && String(player.id) === String(this.userId))) {
        this._spawnRemote(socketId, player);
      }
      this._emitRoomPopulation();
    });

    // Quest badges v1: the server's badge record for me (reply to
    // badges_sync / get_badges), and live updates for other players
    // (someone just earned a badge, or re-synced after a restart).
    socket.on('badges_state', (payload = {}) => {
      const uid = payload.userId;
      if (uid && this.userId && String(uid) !== String(this.userId)) {
        // Badges for someone else (a get_badges reply): update
        // their record, if they are in this room.
        const sid = this._findRemoteSocketIdByUserKey(`user:${String(uid)}`);
        if (sid) this._updateRemoteBadges(sid, payload.badges);
        return;
      }
      try { this.questManager?.applyServerBadges?.(payload.badges); } catch {}
    });

    socket.on('player_badges', ({ socketId, userId, badges } = {}) => {
      if (socketId && socketId === socket.id) return;
      if (userId && this.userId && String(userId) === String(this.userId)) {
        try { this.questManager?.applyServerBadges?.(badges); } catch {}
        return;
      }
      if (socketId) this._updateRemoteBadges(socketId, badges);
    });

    socket.on('player_moved', ({ socketId, x, y }) => {
      const remotePlayer = this.remotePlayers.get(socketId);
      if (remotePlayer) {
        const nextPoint = this._clampRemotePosition(x, y);
        const ddx = nextPoint.x - remotePlayer.gx;
        const ddy = nextPoint.y - remotePlayer.gy;
        if (Math.abs(ddy) >= Math.abs(ddx)) {
          remotePlayer.dir = ddy > 0 ? 'front' : 'back';
        } else {
          remotePlayer.dir = 'side';
          remotePlayer.facingLeft = ddx < 0;
        }
        remotePlayer.movingUntil = this.time.now + 220;
        remotePlayer.gx = nextPoint.x;
        remotePlayer.gy = nextPoint.y;
        remotePlayer.sync();
      }
    });

    socket.on('player_left', ({ socketId }) => {
      this._removeRemoteBySocketId(socketId);
      this._emitRoomPopulation();
    });

    socket.on('room_decorations', (items) => {
      this.customZones = [];
      (items || []).forEach((item) => {
        const zone = this._normalizeDecoration(item);
        if (zone) this.customZones.push(zone);
      });
      this._refreshDecorationsView();
    });

    socket.on('decoration_placed', (item) => {
      const zone = this._normalizeDecoration(item);
      if (!zone) return;
      if (this.customZones.some(z => z.id === zone.id)) return;
      this.customZones.push(zone);
      this._refreshDecorationsView();
    });

    socket.on('decoration_removed', ({ id }) => {
      if (!id) return;
      this.customZones = this.customZones.filter(z => z.id !== id);
      this._refreshDecorationsView();
    });

    socket.on('decoration_error', ({ message }) => {
      if (message) {
        console.warn('[VillageScene] decoration_error:', message);
        this.onSystemNotice(message);
      }
    });

    socket.on('receive_message', (payload) => {
      if (!payload?.message || !payload?.position) return;
      const dx = payload.position.x - this.player.gx;
      const dy = payload.position.y - this.player.gy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= PROXIMITY_RADIUS) {
        this.onChatMessage({
          senderName: payload.senderName || 'Traveler',
          message: payload.message,
          isSelf: payload.socketId === socket.id,
          distance: Math.round(distance),
          timestamp: payload.timestamp || Date.now(),
        });
      }
    });

    // Remote player fed the ducks: mirror the feeding frenzy locally.
    socket.on('duck_fed', ({ x, y } = {}) => {
      this.duckPond?.feed(x, y, true);
    });

    // Somebody lit a jack-o'-lantern in this room: light ours too.
    socket.on('pumpkin_lit', ({ index } = {}) => {
      this.halloween?.setPumpkinLit(index);
    });

    // The room's already-lit pumpkins, sent when we join.
    socket.on('pumpkin_state', ({ lit } = {}) => {
      this.halloween?.applyPumpkinState(lit || []);
    });

    // Somebody petted the cafe cat: react locally (no re-broadcast).
    socket.on('cat_petted', ({ pets } = {}) => {
      this.cafeCat?.onRemotePet();
      if (Number.isFinite(Number(pets))) this.cafeCat.pets = Number(pets);
    });

    // The cat's shared state (pets so far, asleep or awake), sent when
    // we join and whenever it changes.
    socket.on('cat_state', (payload = {}) => {
      this.cafeCat?.applyState(payload);
    });

    // Hungry Cat v1 (`sq-hungry-cat-v1`): the server's hunger state
    // for this window — the bubble + tracker line come from CafeCat,
    // and the quest banner pops the first time a window opens (once
    // per window per session: the banner id is window-scoped, so the
    // evening window still announces itself after the morning one).
    // When someone else feeds her, the room hears the hunger end
    // with their name (the feeder gets the quest toast instead).
    socket.on('cat_hunger', (payload = {}) => {
      const wasHungry = Boolean(this.cafeCat?.hungry);
      this.cafeCat?.setHungry(Boolean(payload.hungry), payload.windowId || null);
      if (payload.hungry && !wasHungry && payload.windowId) {
        try {
          this.questManager?.showQuestBannerFor({
            id: `hungry-cat:${payload.windowId}`,
            emoji: '🐱',
            title: 'Feed the Hungry Cat',
            description: 'The cafe cat is hungry! Feed her a treat.',
            rewardCoins: 3,
          });
        } catch {}
      }
      if (!payload.hungry && payload.fedByName
        && String(payload.fedByUserId || '') !== String(this.userId || '')) {
        try { this.onSystemNotice?.(`🐱 ${payload.fedByName} fed the hungry cat!`); } catch {}
      }
    });

    // Hungry Cat v1: the server confirms I was the first feeder in
    // this window — +3 coins ON TOP of the usual +1 pet coin (the
    // treat already paid that), the badge once ever, and the quest
    // toast. The quest is repeatable: this fires again at the next
    // window. Coins are paid here, on the server's word — never
    // optimistically, or a second feeder could pay themself.
    socket.on('hungry_cat_completed', (payload = {}) => {
      const coins = Number(payload.rewardCoins) || 3;
      try {
        import('./CoinWallet.js').then((m) => m.earnCoins(coins, 'quest-hungry-cat')).catch(() => {});
      } catch {}
      try { this.questManager?.recordHungryCatCompletion?.(); } catch {}
      try { this.questManager?.showToast?.(`🎉 Quest complete! 🐱 Feed the Hungry Cat — +${coins} coins`); } catch {}
    });

    // Quest state (your progress + the room's shared total), sent when
    // we join and whenever it changes.
    socket.on('quest_state', (payload = {}) => {
      this.questManager?.applyServerState(payload);
    });

    // Somebody in the room finished a quest.
    socket.on('quest_completed', (payload = {}) => {
      this.questManager?.onRemoteCompleted(payload);
    });

    // Group puzzle state (Agora, shared for the whole room).
    socket.on('puzzle_state', (payload = {}) => {
      this.puzzleQuest?.applyState(payload);
    });

    // Trim the Tree state (Agora, shared for the whole room).
    socket.on('tree_state', (payload = {}) => {
      this.trimTreeQuest?.applyState(payload);
    });

    // Christmas Lights state (Agora, shared for the whole room).
    socket.on('lights_state', (payload = {}) => {
      this.christmasLightsQuest?.applyState(payload);
    });

    // Build a Snowman state (Shepherd Park, shared for the whole room).
    socket.on('snow_state', (payload = {}) => {
      this.snowmanQuest?.applyState(payload);
    });

    // Notice board state (shared for the whole room — one board
    // per room, in-memory on the server like the puzzle).
    socket.on('board_state', (payload = {}) => {
      this.noticeBoardSystem?.applyState(payload);
    });

    // Pick-Up Notes state (shared for the whole room — one floor
    // of notes per room, in-memory on the server like the notice
    // board, persisted to Postgres).
    socket.on('notes_state', (payload = {}) => {
      this.noteSystem?.applyState(payload);
    });

    // Pick-Up Notes drop answer (per drop): ok → the note is mine
    // now; fail → it never landed, with the reason.
    socket.on('note_drop_result', (payload = {}) => {
      this.noteSystem?.onDropResult(payload);
    });

    // Pick-Up Notes removal answer (per removal): ok is confirmed
    // by the broadcast; fail says why.
    socket.on('note_delete_result', (payload = {}) => {
      this.noteSystem?.onDeleteResult(payload);
    });

    // Notes Moderation v1 (`sq-notes-moderation-v1`): report
    // answer, flagged-list answer (moderator-only), and restore
    // answer — all routed to NoteSystem, same as the drop and
    // delete answers above.
    socket.on('note_report_result', (payload = {}) => {
      this.noteSystem?.onReportResult(payload);
    });

    socket.on('note_flagged_list_result', (payload = {}) => {
      this.noteSystem?.onFlaggedListResult(payload);
    });

    socket.on('note_restore_result', (payload = {}) => {
      this.noteSystem?.onRestoreResult(payload);
    });

    // Notes Strike System v1 (`sq-notes-strikes-v1`): my mute
    // status, the answer to a strike or a clear, and the notice
    // the server sends me when I am struck (or my strikes are
    // cleared) — all routed to NoteSystem, same as the drop and
    // delete answers above.
    socket.on('my_note_status', (payload = {}) => {
      this.noteSystem?.onMyNoteStatusResult(payload);
    });

    socket.on('note_strike_result', (payload = {}) => {
      this.noteSystem?.onStrikeResult(payload);
    });

    socket.on('note_clear_strikes_result', (payload = {}) => {
      this.noteSystem?.onClearStrikesResult(payload);
    });

    socket.on('note_strike_notice', (payload = {}) => {
      this.noteSystem?.onStrikeNotice(payload);
    });

    // Placed decorations (shared for the whole room — one set per
    // room, in-memory on the server like the notice board).
    socket.on('decor_state', (payload = {}) => {
      this.decorSystem?.applyState(payload);
    });

    // Shared floor litter (shared for the whole room — one set per
    // room, in-memory on the server like the notice board).
    socket.on('floor_litter', (payload = {}) => {
      this.floorLitterSystem?.applyState(payload);
    });

    // Shared litter drop answer (per drop): ok → the item leaves
    // the pocket; fail → it stays, with the reason.
    socket.on('drop_item_result', (payload = {}) => {
      this.floorLitterSystem?.onDropResult(payload);
    });

    // Shared litter pickup answer (per pickup): ok → the item
    // lands in the pocket (then the client confirms); fail → it
    // stays on the floor, with the reason.
    socket.on('pickup_floor_item_result', (payload = {}) => {
      this.floorLitterSystem?.onPickupResult(payload);
    });

    // Catch a Litterbug v1 (`sq-litterbug-quest-v1`): the answer
    // to my catch attempt — ok records quest progress (inside
    // the litter system), fail just says why.
    socket.on('litterbug_catch_result', (payload = {}) => {
      this.floorLitterSystem?.onCatchResult(payload);
    });

    // Catch a Litterbug v1 (`sq-litterbug-quest-v1`): someone in
    // this room got caught littering — show the 🚨 LITTERBUG!
    // label above them for a minute.
    socket.on('litterbug_caught', (payload = {}) => {
      this._showLitterbugLabel(payload);
    });

    // Santa Hat state (Agora, shared for the whole room — one hat,
    // in-memory on the server like the puzzle).
    socket.on('hat_state', (payload = {}) => {
      this.santaHatSystem?.applyState(payload);
    });

    // Santa's Lost Present state (Agora, per player per Chicago
    // day — the server's canonical daily rule, in-memory like the
    // hat). present_result is the answer to my own find attempt
    // (a same-day refusal); present_state is the room broadcast.
    socket.on('present_state', (payload = {}) => {
      this.santasPresentSystem?.applyState(payload);
    });
    socket.on('present_result', (payload = {}) => {
      this.santasPresentSystem?.onFindResult(payload);
    });

    // Your Place state (per player — only your own stored items,
    // in-memory on the server like badges).
    socket.on('home_state', (payload = {}) => {
      this.homeStorageSystem?.applyState(payload);
    });

    // Mailbox state (per player — only your own inbox, in-memory on
    // the server like badges). The first state after connect fires
    // the "You've got mail!" toast when there is unread mail.
    socket.on('mail_state', (payload = {}) => {
      this.mailSystem?.applyState(payload);
    });

    // Mailbox send answer (per send): ok → the item leaves the
    // pocket; fail → it stays, with the reason.
    socket.on('mail_send_result', (payload = {}) => {
      this.mailSystem?.onSendResult(payload);
    });

    // Mailbox collect answer (per package): ok → the item lands in
    // the pocket and the client confirms, which is when the server
    // removes it from the inbox. A full pocket never eats a gift.
    socket.on('mail_collect_result', (payload = {}) => {
      this.mailSystem?.onCollectResult(payload);
    });

    // Mail just arrived while I'm online: toast now (the server
    // sends the fresh mail_state right after, so the dot and the
    // flag update on their own).
    socket.on('mail_arrived', (payload = {}) => {
      this.mailSystem?.onMailArrived(payload);
    });

    // Gift Giver v1 (`sq-gift-giver-v1`): the direct-give
    // handshake — offer in, answers out, receipt in. The gift
    // moves only on the recipient's confirm (onGiftConfirmed).
    socket.on('gift_offered', (payload = {}) => {
      this.giftSystem?.onGiftOffered(payload);
    });
    socket.on('gift_offer_result', (payload = {}) => {
      this.giftSystem?.onOfferResult(payload);
    });
    socket.on('gift_offer_accepted', (payload = {}) => {
      this.giftSystem?.onGiftOfferAccepted(payload);
    });
    socket.on('gift_received', (payload = {}) => {
      this.giftSystem?.onGiftReceived(payload);
    });
    socket.on('gift_confirmed', (payload = {}) => {
      this.giftSystem?.onGiftConfirmed(payload);
    });
    socket.on('gift_declined', (payload = {}) => {
      this.giftSystem?.onGiftDeclined(payload);
    });
    socket.on('gift_failed', (payload = {}) => {
      this.giftSystem?.onGiftFailed(payload);
    });
    socket.on('gift_offer_gone', (payload = {}) => {
      this.giftSystem?.onGiftOfferGone(payload);
    });
    // The room finished the puzzle — re-ask for the canonical state
    // (the puzzle_state broadcast just before this carries it too;
    // this covers a missed broadcast). Completion handling itself
    // lives in PuzzleQuest.applyState, so it can only fire once.
    socket.on('puzzle_completed', () => {
      try { socket.emit('get_puzzle', { roomId: this.roomId }); } catch {}
    });

    // A tree finished trimming — re-ask for the canonical state
    // (same missed-broadcast cover as the puzzle; completion
    // handling lives in TrimTreeQuest.applyState).
    socket.on('tree_completed', () => {
      try { socket.emit('get_tree', { roomId: this.roomId }); } catch {}
    });

    // The room lit up — re-ask for the canonical state (same
    // missed-broadcast cover; completion handling lives in
    // ChristmasLightsQuest.applyState).
    socket.on('lights_completed', () => {
      try { socket.emit('get_lights', { roomId: this.roomId }); } catch {}
    });

    // The server's canonical day/night phase (outdoor venues render
    // it; the module ignores it indoors).
    socket.on('time_phase', (payload = {}) => {
      this.dayNight?.applyPhase(payload);
    });

    // Remote player bought a drink at the bar: play their toast locally.
    socket.on('player_drank', ({ socketId } = {}) => {
      this._raiseBuzz(socketId);
      this.remotePlayers.get(socketId)?.avatar?.playDrink?.();
    });

    // A player ordered a drink: the bartender serves it, in order.
    socket.on('drink_ordered', ({ socketId, beer } = {}) => {
      this._enqueueDrinkOrder(socketId, beer);
    });

    // Room-wide YouTube jukebox: play the server's now-playing video for everyone.
    socket.on('jukebox_state', ({ nowPlaying } = {}) => {
      this._syncYouTubeJukebox(nowPlaying);
    });

    // AI-backed NPC reply from the Inworld Router (server/socket.js `send_message` handler).
    socket.on('npc_reply', (payload) => {
      if (!payload?.message) return;
      this.onChatMessage({
        senderName: 'NPC',
        message: payload.message,
        isSelf: false,
        timestamp: payload.timestamp || Date.now(),
        channel: 'npc',
        npcId: payload.roomId,
      });
    });

    // AI-backed reply for a specific static NPC (server/socket.js `npc_chat` handler).
    socket.on('npc_chat_reply', ({ npcId, message: reply, error } = {}) => {
      if (!npcId) return;
      const npcEntry = this.staticNpcs.find((entry) => entry.id === npcId);
      if (npcEntry?.isBartender) {
        this._convoArmUntil = this.time.now + 45000;
      }
      const distance = npcEntry
        ? Math.hypot(this.player.gx - npcEntry.gx, this.player.gy - npcEntry.gy)
        : 0;
      this.onChatMessage({
        senderName: npcEntry?.name || 'NPC',
        message: error || !reply ? 'Sorry, could you say that again?' : reply,
        isSelf: false,
        distance: Math.round(distance),
        timestamp: Date.now(),
        channel: 'npc',
        npcId,
      });
    });
  }

  _selectNpcResponse(npcId, response, npcName) {
    const key = npcId || npcName || 'npc';
    const recent = this.npcRecentResponses.get(key) || [];
    const normalizedRecent = new Set(recent.map(normalizeNpcResponseLine));
    let selected = response;
    const candidates = getNpcAmbientLines(this.layout?.id, this.isOutdoorLocation, npcName);
    const normalizedSelected = normalizeNpcResponseLine(selected);

    if (shouldReplaceNpcResponse(selected) || normalizedRecent.has(normalizedSelected)) {
      selected = candidates.find((line) => !normalizedRecent.has(normalizeNpcResponseLine(line)) && !shouldReplaceNpcResponse(line))
        || candidates[0]
        || 'Hey!';
    }

    this.npcRecentResponses.set(key, [selected, ...recent.filter((line) => line !== selected)].slice(0, 4));
    return selected;
  }

  _clearNpcConversation(npcId) {
    if (!npcId) return;
    this.npcReplyCounts.delete(npcId);
    this.npcRecentResponses.delete(npcId);
    this.npcConversationState.delete(npcId);
    this.onNpcConversationClear({ npcId });
  }

  sendChatMessage(message, recipient = 'players') {
    const text = (message || '').trim();
    if (!text) return;
    const nearbyNpc = this._getNearbyStaticNpc();
    if (recipient === 'npc' && nearbyNpc) {
      const npc = this.staticNpcs.find((entry) => entry.id === nearbyNpc.id);
      if (npc) {
        npc.target = null;
        npc.pausedUntil = this.time.now + 15000;
      }
      if (npc?.isBartender) {
        const normText = text.toLowerCase().replace(/[.!?,]+$/, '').trim();
        if (WHAT_HAVE_RE.test(normText)
          && Math.hypot(this.player.gx - npc.gx, this.player.gy - npc.gy) <= 170) {
          this._openDrinkCard();
          this._convoArmUntil = this.time.now + 60000;
        }
        const wasArmed = this.time.now < this._convoArmUntil;
        this._maybeConversationalOrder(text, npc, wasArmed);
        this._convoArmUntil = this.time.now + 45000;
      }
      // Group puzzle v1.2: the old "ask the barista" piece is gone —
      // piece 8 now turns up at random in a coffee you buy (see
      // _tryBuyDrink / tryCoffeePiece). Chatting about the puzzle
      // earns nothing anymore.
      const replyNumber = this.npcReplyCounts.get(nearbyNpc.id) || 0;
      this.npcReplyCounts.set(nearbyNpc.id, replyNumber + 1);
      this.onChatMessage({
        senderName: 'You', message: text, isSelf: true,
        distance: Math.round(nearbyNpc.distance), timestamp: Date.now(),
        channel: 'npc', npcId: nearbyNpc.id,
      });

      if (this.socket?.connected) {
        // AI-backed reply (server/socket.js `npc_chat` handler); response arrives via `npc_chat_reply`.
        this.socket.emit('npc_chat', {
          npcId: nearbyNpc.id,
          npcName: nearbyNpc.name,
          layoutId: this.layout?.id,
          roomId: this.layout?.id || this.roomId || 'npc-room',
          isOutdoor: Boolean(this.isOutdoorLocation),
          timeOfDay: this.roomMood?.label || getTimeOfDayMood(new Date()).label,
          message: text,
          playerId: this.player?.id || this.player?._id || 'guest',
          playerName: this.player?.name || 'Traveler',
        });
        return;
      }

      // Offline fallback: rule-based canned responses when there's no server connection.
      const requestedGenre = getRequestedBookGenre(text);
      this.time.delayedCall(350, async () => {
        if (this._isShuttingDown) return;
        const isLibrary = this.layout?.id === 'md-anderson-library' || String(this.layout?.id || '').includes('library');
        const isGreeting = /^(hi|hello|hey|howdy|good morning|good afternoon|good evening)[!.?\s]*$/i.test(text);
        const awaitingFavoriteBook = this.npcConversationState.get(nearbyNpc.id) === 'favorite-book';
        const wantsLibraryPick = isLibrary && /\b(recommend|suggest|bestseller|best seller|what should i read|book)\b/i.test(text);
        let response = isLibrary && awaitingFavoriteBook && !isGreeting
          ? getRecommendationFromFavoriteBook(text)
          : replyNumber === 0 && isGreeting
          ? getNpcOpeningResponse(this.layout?.id, this.isOutdoorLocation)
          : this.isOutdoorLocation
            ? getParkNpcResponse(nearbyNpc.name, text)
            : isLibrary
              ? getLibraryNpcResponse(nearbyNpc.name, text)
              : String(this.layout?.id || '').toLowerCase().includes('asgard')
                ? getAsgardNpcResponse(nearbyNpc.name, text)
              : getVenueNpcResponse(this.layout?.id, text);
        if (isLibrary && awaitingFavoriteBook && !isGreeting) {
          this.npcConversationState.delete(nearbyNpc.id);
        }
        if ((requestedGenre || wantsLibraryPick) && !awaitingFavoriteBook) {
          try {
            const book = await getLiveBookRecommendation(requestedGenre || 'nonfiction');
            response = `Try ${book.title} by ${book.author}.`;
          } catch {
            response = response || 'Try The Shining by Stephen King.';
          }
        }
        if (this._isShuttingDown) return;
        const finalResponse = this._selectNpcResponse(
          nearbyNpc.id,
          replyNumber === 0 && isGreeting ? response : varyNpcResponse(response, replyNumber, this.isOutdoorLocation),
          nearbyNpc.name,
        );
        if (isLibrary && finalResponse === "What's your favorite book?") {
          this.npcConversationState.set(nearbyNpc.id, 'favorite-book');
        }
        this.onChatMessage({
          senderName: nearbyNpc.name,
          message: finalResponse,
          isSelf: false,
          distance: Math.round(nearbyNpc.distance),
          timestamp: Date.now(),
          channel: 'npc', npcId: nearbyNpc.id,
        });
      });
      return;
    }
    if (!this.socket?.connected) return;
    this.socket.emit('send_message', {
      roomId: this.roomId,
      message: text,
    });
  }

  placeDecoration(zone) {
    if (!this.socket?.connected) return false;
    const outdoorPlacement = Boolean(this.isOutdoorLocation);
    const inside = outdoorPlacement
      ? this.roomLayout?.isRectFullyInsideRoom(
          zone.x,
          zone.y,
          zone.w || 60,
          zone.h || 60,
          2,
        ) ?? true
      : this.roomLayout?.isRectFullyInsideRoom(
          zone.x,
          zone.y,
          zone.w || 60,
          zone.h || 60,
          6,
        );
    if (!inside) {
      this.onSystemNotice(outdoorPlacement
        ? 'Placement is outside the park boundary.'
        : 'Placement is outside the room boundary.');
      return false;
    }
    const clearOfSolids = outdoorPlacement
      ? true
      : this.roomLayout?.canPlaceRect(
          zone.x,
          zone.y,
          zone.w || 60,
          zone.h || 60,
          8,
        );
    if (!clearOfSolids) {
      this.onSystemNotice(outdoorPlacement
        ? 'Placement overlaps another outdoor item.'
        : 'Placement overlaps furniture or another item.');
      return false;
    }
    this.socket.emit('place_decoration', {
      roomId: this.roomId,
      item: {
        frameKey: zone.frameKey,
        type: zone.type || zone.frameKey,
        x: zone.x,
        y: zone.y,
        w: zone.w || 60,
        h: zone.h || 60,
        label: zone.label || '',
        renderAsZone: zone.renderAsZone || null,
      },
    });
    return true;
  }

  removeDecoration(id) {
    if (!this.socket?.connected || !id) return;
    this.socket.emit('remove_decoration', {
      roomId: this.roomId,
      id,
    });
  }

  clearOwnDecorations() {
    this.customZones
      .filter(z => z.placedBy === this.userId)
      .forEach(z => this.removeDecoration(z.id));
  }

  _clampRemotePosition(x, y, margin = 18) {
    const fallback = {
      x: Number.isFinite(Number(x)) ? Number(x) : 400,
      y: Number.isFinite(Number(y)) ? Number(y) : 300,
    };
    if (!this.roomLayout) return fallback;
    return this.roomLayout.clampPointToRoom(fallback.x, fallback.y, margin) || fallback;
  }

  _normalizeDecoration(item) {
    if (!item) return null;
    const width = Number(item.w || 60);
    const height = Number(item.h || 60);
    const boundaryMargin = Math.ceil(Math.max(width, height) / 2) + 6;
    const clamped = this.roomLayout?.clampPointToRoom(item.x, item.y, boundaryMargin) || { x: item.x, y: item.y };
    const isInside = this.roomLayout?.isRectFullyInsideRoom(clamped.x, clamped.y, width, height, 6) ?? true;
    if (!isInside) return null;

    let resolvedType = item.type || '';
    let frameKey = item.frameKey || LEGACY_TYPE_TO_FRAME_KEY[resolvedType] || null;

    if (this.isOutdoorLocation) {
      resolvedType = inferOutdoorType(resolvedType || frameKey, width, height);
      const outdoorFrameMap = {
        oak_tree: 'prop_plant_potted',
        tree: 'prop_plant_potted',
        shrub: 'prop_plant_potted',
        hedge: 'prop_plant_potted',
        bench: 'prop_chair_wooden',
        lamppost: 'prop_lamp_floor',
        flowerbed: 'prop_rug_rolled',
      };
      if (!frameKey || !PROP_DEFS[frameKey]) {
        frameKey = outdoorFrameMap[resolvedType] || frameKey || null;
      }
    }

    if (frameKey && !PROP_DEFS[frameKey] && !OUTDOOR_TYPES.has(resolvedType)) return null;
    if (!frameKey && !OUTDOOR_TYPES.has(resolvedType)) return null;

    return {
      id: item.id,
      frameKey,
      type: resolvedType || frameKey,
      x: clamped.x,
      y: clamped.y,
      w: width,
      h: height,
      label: item.label || '',
      renderAsZone: item.renderAsZone || null,
      placedBy: item.placedBy,
    };
  }

  async _spawnRemote(socketId, player) {
    if (this.remotePlayers.has(socketId) || this.pendingRemoteSpawns.has(socketId)) return;
    const userKey = this._remoteUserKey(player, socketId);
    const existingSocketForUser = this._findRemoteSocketIdByUserKey(userKey, socketId);
    if (existingSocketForUser) {
      // Replace stale/duplicate socket representation for same logical user.
      this._removeRemoteBySocketId(existingSocketForUser);
    }

    this.pendingRemoteSpawns.add(socketId);
    const avatarState = normalizeAvatarState(player);
    const spawnPoint = this._clampRemotePosition(player.x, player.y);
    try {
      const avatar = await createAvatarEntity(this, spawnPoint.x, spawnPoint.y, {
        ...avatarState,
        name: player?.firstName || player?.name || 'Traveler',
        isLocal: false,
      });
      if (!avatar || this.remotePlayers.has(socketId)) return;
      if (avatarState.photo) avatar.attachPhoto(this, avatarState.photo);
      const remotePlayer = {
        userKey,
        gx: spawnPoint.x,
        gy: spawnPoint.y,
        avatar,
        dir: 'front',
        facingLeft: false,
        movingUntil: 0,
        sync: () => {
          avatar.setPosition(remotePlayer.gx, remotePlayer.gy);
          avatar.setDepth(DEPTH.ACTOR_MIN + Math.round(remotePlayer.gy));
          avatar.syncLabel();
        },
        destroy: () => {
          avatar.destroy();
        },
      };
      remotePlayer.sync();
      remotePlayer.avatar.setScale?.(this._currentAvatarScale());
      remotePlayer.avatar.syncLabel?.();
      // Quest badges v1: carry their badge record on the player, and
      // show the count in their name label ("Jules 🏅3") so you can
      // see at a glance who has badges before you click them.
      remotePlayer.userId = player?.id || null;
      remotePlayer.displayName = player?.firstName || player?.name || 'Traveler';
      remotePlayer.badges = normalizeBadgeMap(player?.badges);
      try { remotePlayer.avatar?.setBadgeCount?.(Object.keys(remotePlayer.badges).length); } catch {}
      this.remotePlayers.set(socketId, remotePlayer);
      this._emitRoomPopulation();
    } catch (error) {
      console.warn('[VillageScene] failed to spawn remote avatar', error);
    } finally {
      this.pendingRemoteSpawns.delete(socketId);
    }
  }

  // ---- quest badges v1 (`sq-quest-badges-v1`) ----------------------

  /** Remote player at world (wx, wy), if you are standing close
   *  enough to look at them — for the badges panel. Same ranges as
   *  the bartender click (46px to hit, 170px to reach). */
  _playerAt(wx, wy) {
    if (!this.player) return null;
    for (const [socketId, remotePlayer] of this.remotePlayers.entries()) {
      if (Math.hypot(wx - remotePlayer.gx, wy - remotePlayer.gy) >= 46) continue;
      if (Math.hypot(this.player.gx - remotePlayer.gx, this.player.gy - remotePlayer.gy) > 170) continue;
      return socketId;
    }
    return null;
  }

  // ---- 🚨 LITTERBUG! labels (Catch a Litterbug v1,
  // `sq-litterbug-quest-v1`) -------------------------------------------
  //
  // On `litterbug_caught` every client in the room shows
  // "🚨 LITTERBUG!" above the litterer for a minute — a real
  // player (their avatar), an NPC (its sprite), or yourself. The
  // label is cosmetic only: the litterer loses no coins, ever.
  // Labels are scene-level text, repositioned every frame like
  // the cat's "hungry..." bubble — the target may be walking.
  // A label is keyed by litterer id so a second catch of the
  // same litterer just refreshes the minute instead of stacking.

  /** Show (or refresh) the 🚨 LITTERBUG! label for a caught
   * litterer. Payload: { littererId, littererName, npc }. */
  _showLitterbugLabel(payload = {}) {
    const littererId = String(payload.littererId || '');
    if (!littererId) return;
    const target = this._resolveLitterbugTarget(payload);
    if (!target) return;
    const until = Date.now() + LITTERBUG_LABEL_MS;
    const existing = this._litterbugLabels?.get(target.key);
    if (existing) {
      existing.until = until;
      existing.resolve = target.resolve;
      return;
    }
    let textObj = null;
    try {
      textObj = this.add.text(0, 0, '🚨 LITTERBUG!', {
        fontSize: '16px',
        color: '#ffffff',
        backgroundColor: 'rgba(120,0,0,0.85)',
        padding: { x: 6, y: 3 },
      });
      textObj.setOrigin(0.5, 1);
      textObj.setDepth(DEPTH.ACTOR_MIN + 500);
    } catch {}
    if (!textObj) return;
    if (!this._litterbugLabels) this._litterbugLabels = new Map();
    this._litterbugLabels.set(target.key, { textObj, until, resolve: target.resolve });
  }

  /** Where the litterer is right now — { x, y } for the label
   * anchor, or null when they are gone. */
  _resolveLitterbugTarget(payload = {}) {
    const littererId = String(payload.littererId || '');
    const littererName = String(payload.littererName || '');
    if (payload.npc) {
      const npc = (this.staticNpcs || []).find((n) => n && n.name === littererName);
      if (!npc) return null;
      return {
        key: `npc:${littererName}`,
        resolve: () => ({ x: npc.gx, y: npc.gy }),
      };
    }
    // Myself: the litterer id is my own user id.
    if (littererId && this.userId && String(this.userId) === littererId) {
      return {
        key: `user:${littererId}`,
        resolve: () => (this.player ? { x: this.player.gx, y: this.player.gy } : null),
      };
    }
    // Another player: match by socket id or by user key. (Guests
    // share the 'guest' id, so a guest viewer may see a fellow
    // guest's label on themself instead — a pre-existing identity
    // quirk, not something this kit can fix. Logged-in players
    // are exact.)
    for (const [sid, remotePlayer] of this.remotePlayers.entries()) {
      if (!remotePlayer) continue;
      if (sid === littererId
        || remotePlayer.userKey === `user:${littererId}`
        || remotePlayer.userKey === `socket:${littererId}`
        || (remotePlayer.userId && String(remotePlayer.userId) === littererId)) {
        return {
          key: `user:${littererId}`,
          resolve: () => ({ x: remotePlayer.gx, y: remotePlayer.gy }),
        };
      }
    }
    return null;
  }

  /** Every frame: ride each label above its (possibly walking)
   * target, and drop expired ones (or ones whose target left). */
  _updateLitterbugLabels() {
    const labels = this._litterbugLabels;
    if (!labels || labels.size === 0) return;
    const now = Date.now();
    for (const [key, label] of [...labels.entries()]) {
      let pos = null;
      try { pos = label.resolve?.(); } catch {}
      if (!pos || now >= label.until) {
        try { label.textObj?.destroy(); } catch {}
        labels.delete(key);
        continue;
      }
      try {
        label.textObj?.setPosition(pos.x, pos.y - 56).setAlpha(1);
      } catch {}
    }
  }

  _clearLitterbugLabels() {
    for (const label of this._litterbugLabels?.values() || []) {
      try { label.textObj?.destroy(); } catch {}
    }
    this._litterbugLabels?.clear();
  }

  /** Open another player's badges panel (DOM, via VillageCanvas). */
  _openPlayerBadges(socketId) {
    const remotePlayer = this.remotePlayers.get(socketId);
    if (!remotePlayer) return;
    // Ask the server for their freshest badges too — the panel polls
    // getPlayerBadges(), so the fresh copy lands when it arrives.
    try { this.requestPlayerBadges(socketId); } catch {}
    try { this.onOpenPlayerBadges({ socketId }); } catch {}
  }

  /** Badge state for one remote player, for the DOM panel:
   *  { name, badges: [{ questId, emoji, title, description,
   *  completedAt, completedLabel }] } or null if they left. */
  getPlayerBadges(socketId) {
    const remotePlayer = this.remotePlayers.get(socketId);
    if (!remotePlayer) return null;
    return {
      name: remotePlayer.displayName || 'Traveler',
      badges: badgeListFrom(remotePlayer.badges || {}).map((b) => ({
        ...b,
        completedLabel: formatBadgeDate(b.completedAt),
      })),
    };
  }

  /** Ask the server for one player's freshest badges (by their
   *  userId, not their socket — sockets change on reconnect). */
  requestPlayerBadges(socketId) {
    try {
      const remotePlayer = this.remotePlayers.get(socketId);
      const userId = remotePlayer?.userId;
      if (!userId || !this.socket?.connected) return false;
      this.socket.emit('get_badges', { userId });
      return true;
    } catch {
      return false;
    }
  }

  /** Apply a fresh badge record for a remote player (from
   *  player_badges, room_state, or badges_state): store it and
   *  update the 🏅 count in their name label. No-op when nothing
   *  changed, so the room_state fallback sync doesn't re-set the
   *  label every second. */
  _updateRemoteBadges(socketId, badges) {
    const remotePlayer = this.remotePlayers.get(socketId);
    if (!remotePlayer) return false;
    const next = normalizeBadgeMap(badges);
    if (JSON.stringify(next) === JSON.stringify(remotePlayer.badges || {})) return false;
    remotePlayer.badges = next;
    try { remotePlayer.avatar?.setBadgeCount?.(Object.keys(next).length); } catch {}
    return true;
  }

  _runFallbackSync() {
    const socket = this.socket;
    if (!socket?.connected) return;
    const now = Date.now();
    const hasRemotePlayers = this.remotePlayers.size > 0;

    const presenceEveryMs = hasRemotePlayers ? PRESENCE_SYNC_HEALTHY_MS : PRESENCE_SYNC_MS;
    const decorEveryMs = hasRemotePlayers ? DECOR_SYNC_HEALTHY_MS : DECOR_SYNC_MS;

    if (now - this._lastPresenceSyncAt >= presenceEveryMs) {
      socket.emit('get_room_state', { roomId: this.roomId });
      this._lastPresenceSyncAt = now;
    }
    if (now - this._lastDecorSyncAt >= decorEveryMs) {
      socket.emit('get_room_decorations', { roomId: this.roomId });
      this._lastDecorSyncAt = now;
    }
  }

  update(_t, delta) {
    if (this.roomEditor?.isActive) {
      this.target = null;
      this.player?.avatar?.setMovementState?.({
        moving: false,
        direction: this.dir || 'front',
        facingLeft: Boolean(this.player?.facingLeft),
      });
      return;
    }

    const localAvatar = this.player?.avatar;
    if (!localAvatar || localAvatar.active === false) {
      if (!this._localRespawnPending && this.player && this._localSpawnPoint) {
        this._spawnLocalAvatar(this._localSpawnName || 'You', this._localSpawnPoint, 0);
      }
      return;
    }
    if (localAvatar.visible === false) localAvatar.setVisible?.(true);
    if (typeof localAvatar.alpha === 'number' && localAvatar.alpha < 1) localAvatar.setAlpha?.(1);

    const step = (SPEED * delta) / 1000;
    let dx = 0, dy = 0;

    // Don't move while typing in a form field (book titles, chat, etc.).
    const typing = this._isTypingContext?.();
    const kbL = !typing && (this.cursors?.left.isDown  || this.wasd?.A.isDown);
    const kbR = !typing && (this.cursors?.right.isDown || this.wasd?.D.isDown);
    const kbU = !typing && (this.cursors?.up.isDown    || this.wasd?.W.isDown);
    const kbD = !typing && (this.cursors?.down.isDown  || this.wasd?.S.isDown);

    if (kbL || kbR || kbU || kbD) {
      this.target = null;
      if (kbL) dx -= 1; if (kbR) dx += 1;
      if (kbU) dy -= 1; if (kbD) dy += 1;
    } else if (this.target) {
      dx = this.target.x - this.player.gx;
      dy = this.target.y - this.player.gy;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) { this.target = null; } else { dx /= dist; dy /= dist; }
    }

    const W = this.scale.width, H = this.scale.height;
    if (dx || dy) {
      const prevX = this.player.gx;
      const prevY = this.player.gy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = this.player.gx + (dx / len) * step;
      const ny = this.player.gy + (dy / len) * step;

      if (this.roomLayout?.isPointInsideRoom(nx, ny, 18)) {
        this.player.gx = nx;
        this.player.gy = ny;
      } else if (this.roomLayout?.isPointInsideRoom(nx, this.player.gy, 18)) {
        this.player.gx = nx;
      } else if (this.roomLayout?.isPointInsideRoom(this.player.gx, ny, 18)) {
        this.player.gy = ny;
      } else {
        const clamped = this.roomLayout?.clampPointToRoom(nx, ny, 18)
          || { x: Phaser.Math.Clamp(nx, 20, W * 4 - 20), y: Phaser.Math.Clamp(ny, 60, H * 4 - 10) };
        this.player.gx = clamped.x;
        this.player.gy = clamped.y;
      }

      const solidResolved = this.roomLayout?.resolveAgainstSolids(prevX, prevY, this.player.gx, this.player.gy, 16);
      if (solidResolved) {
        this.player.gx = solidResolved.x;
        this.player.gy = solidResolved.y;
      }

      // Final safety pass: keep the local avatar inside room boundaries even
      // after collision resolution nudges, across all room shapes.
      const safePoint = this.roomLayout?.resolveSafeSpawnPoint?.([
        { x: this.player.gx, y: this.player.gy },
        { x: prevX, y: prevY },
      ], 18);
      if (safePoint) {
        this.player.gx = safePoint.x;
        this.player.gy = safePoint.y;
      }

      if (Math.abs(dy) >= Math.abs(dx)) {
        this.dir = dy > 0 ? 'front' : 'back';
      } else {
        this.dir = 'side';
        this.player.facingLeft = dx < 0;
      }
    } else {
      // no-op
    }

    // Mobile movement v1 (`sq-mobile-move-v1`): tap-to-move has no
    // steering (no keyboard on a phone), so a target whose straight-line
    // path is blocked leaves the player pushing against furniture
    // forever. If we haven't gotten meaningfully closer for a while,
    // drop the target — they stop, and tap a clear spot to walk around.
    if (this.target) {
      const distToTarget = Math.hypot(this.target.x - this.player.gx, this.target.y - this.player.gy);
      const stuck = stuckDropCheck(this._targetStuck || null, distToTarget, this.time.now);
      if (stuck.drop) {
        this.target = null;
        this._targetStuck = null;
      } else {
        this._targetStuck = stuck.state;
      }
    } else {
      this._targetStuck = null;
    }

    this.player.avatar.setMovementState({
      moving: Boolean(dx || dy),
      direction: this.dir,
      facingLeft: this.player.facingLeft,
    });
    this.player.avatar.tick(delta);
    this.player.sync();

    this.remotePlayers.forEach((remotePlayer) => {
      remotePlayer.avatar.setMovementState({
        moving: this.time.now < (remotePlayer.movingUntil || 0),
        direction: remotePlayer.dir || 'front',
        facingLeft: Boolean(remotePlayer.facingLeft),
      });
      remotePlayer.avatar.tick(delta);
    });
    this._updateStaticNpcs(delta);
    this._updateGhosts();

    // Nearby count for chat gating UI
    let nearbyCount = 0;
    this.remotePlayers.forEach((remotePlayer) => {
      const ddx = this.player.gx - remotePlayer.gx;
      const ddy = this.player.gy - remotePlayer.gy;
      if (Math.sqrt(ddx * ddx + ddy * ddy) <= PROXIMITY_RADIUS) nearbyCount += 1;
    });
    if (nearbyCount !== this._nearbyCount) {
      this._nearbyCount = nearbyCount;
      this.onNearbyChange(nearbyCount);
    }
    const nearbyNpc = this._getNearbyStaticNpc();
    if (nearbyNpc?.id !== this._nearbyNpcId) {
      if (this._nearbyNpcId) this._clearNpcConversation(this._nearbyNpcId);
      this._nearbyNpcId = nearbyNpc?.id || null;
      this.onNearbyNpcChange(nearbyNpc);
    }

    // Coffee cup near café
    const nearCafe = this.roomLayout?.interactZones?.some(z =>
      z.type === 'cafe_counter' &&
      Math.abs(this.player.gx - (z.x + z.w / 2)) < 200 &&
      Math.abs(this.player.gy - (z.y + z.h / 2)) < 200
    );
    if (nearCafe) {
      this.coffeeCup.setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.coffeeCup.setAlpha(0);
    }

    // Duck pond: tick ducks, show feed prompt near ponds, decay feed cooldown.
    this._feedCooldownMs = Math.max(0, (this._feedCooldownMs || 0) - delta);
    this._drinkCooldownMs = Math.max(0, (this._drinkCooldownMs || 0) - delta);
    this.duckPond?.update(delta);
    this.cafeCat?.update(delta);
    this.hiddenKey?.update(delta);
    this.puzzleQuest?.update(delta);
    this.trimTreeQuest?.update(delta);
    this.christmasLightsQuest?.update(delta); // Christmas Lights v1 (`sq-christmas-lights-v1`)
    this.snowmanQuest?.update(delta); // Build a Snowman v1 (`sq-build-snowman-v1`)
    this.santaHatSystem?.update(delta);
    this.santasPresentSystem?.update(delta); // Santa's Lost Present v1.1 (`sq-santas-lost-present-v1.1`)
    // sq-temperature-v1: ticks the toast (1s) and the shiver /
    // sweat visuals (every frame, after player.sync()).
    this.temperatureSystem?.update(delta);
    // sq-hunger-v1: ticks the hunger toast (1s) and the
    // "hungry..." bubble / 🤢 visuals (every frame, after
    // player.sync()).
    this.hungerSystem?.update(delta);
    this.itemsSystem?.update(delta);
    // Shared Floor Litter v1: the litter system's 1s tick was
    // never wired until Catch a Litterbug v1
    // (`sq-litterbug-quest-v1`) needed it — it expires the "!"
    // markers, rolls NPC litter drops, and re-spawns litter after
    // a floor switch.
    this.floorLitterSystem?.update(delta);
    this._updateLitterbugLabels();
    this.questManager?.update(delta);
    this.halloween?.update(delta);
    this.dayNight?.update(delta);
    this.snowfall?.update(delta); // Snowfall v1 (`sq-snowfall-v1`)
    // No-E on mobile (`sq-no-e-mobile-v1`): on a phone there is no E
    // key, so the floating prompts drop the " [E]" suffix. The drink
    // prompts below already said "· tap" on touch — same idea.
    const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0));
    const noE = (text) => (isTouchDevice ? text.replace(' [E]', '') : text);
    const nearDuck = this.duckPond?.nearestPettableDuck(this.player.gx, this.player.gy);
    const nearPond = this.duckPond?.nearestFeedablePond(this.player.gx, this.player.gy);
    // Pet prompt wins when a duck is right next to you; otherwise the
    // feed prompt shows near a pond.
    if (nearDuck) {
      this.duckPrompt.setText(noE('🦆 Pet the duck [E]')).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.duckPrompt.setAlpha(0);
    }
    if (nearPond && !nearDuck && this._feedCooldownMs <= 0) {
      this.feedPrompt.setText(noE('🦆 Feed the ducks [E]')).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.feedPrompt.setAlpha(0);
    }

    // Santa Hat v1: the hat on the ground wins over petting the cat
    // (it fell right beside her) — checked first, used below.
    const nearHat = this.santaHatSystem?.nearestGroundHat(this.player.gx, this.player.gy);

    // Cafe cat: prompt near the cat (duck prompt takes priority).
    const nearCat = this.cafeCat?.nearestCat(this.player.gx, this.player.gy);
    if (nearCat && !nearPond && !nearHat) {
      // Hungry Cat v1 (`sq-hungry-cat-v1`): near a hungry cat the
      // prompt says she is hungry instead of "Pet the cat [E]" —
      // and it carries no [E], because E would only pet her: feeding
      // is a treat from the pocket (Use on the food). The bubble
      // above her says "hungry..." already; this is the close-up
      // version with the what-to-do.
      this.catPrompt.setText(this.cafeCat?.hungry
        ? '🐱 The cat looks hungry — feed her a treat!'
        : noE('🐱 Pet the cat [E]')).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.catPrompt.setAlpha(0);
    }

    // Santa Hat v1: prompt near the hat on the ground.
    if (nearHat && !nearPond) {
      this.hatPrompt.setText(noE('🎅 Pick up the Santa hat [E]')).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.hatPrompt.setAlpha(0);
    }

    // Group puzzle: prompt near the table only. v1.2 pieces are
    // functionally invisible — there is no prompt near a hidden
    // piece, or the prompt would give away where they are.
    const nearTable = this.puzzleQuest?.nearestTable(this.player.gx, this.player.gy);
    if (nearTable && !nearPond && !nearCat) {
      this.puzzlePrompt.setText(noE('🧩 Puzzle table [E]')).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.puzzlePrompt.setAlpha(0);
    }

    // Trim the Tree: prompt near the ornament box (take one) or near
    // the active tree (hang the one you are carrying — or grab one
    // from the box first). Carrying wins (v1.2,
    // `sq-christmas-multi-v1.2`): with an ornament in hand the hang
    // prompt shows whenever you are at the tree, even if the pond,
    // the cat, or a puzzle table is also near. v1.3
    // (`sq-christmas-lights-v1.3`): it stays quiet while a light
    // string is in hand — the south light corners sit inside the
    // trees' ranges, and "Grab an ornament" over "Hang the lights"
    // would contradict itself.
    const nearBox = this.trimTreeQuest?.nearestBox(this.player.gx, this.player.gy);
    const nearTree = this.trimTreeQuest?.nearestTree(this.player.gx, this.player.gy);
    if (nearBox && !nearPond && !nearCat && !nearTable) {
      this.treePrompt.setText(noE('🎄 Take an ornament [E]')).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else if (showHangPrompt({ nearHangSpot: nearTree, nearPond, nearCat, nearTable, carrying: this.trimTreeQuest?.carrying, otherCarrying: this.christmasLightsQuest?.carrying })) {
      this.treePrompt.setText(
        this.trimTreeQuest?.carrying ? noE('🎄 Hang the ornament [E]') : '🎄 Grab an ornament from the box first',
      ).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.treePrompt.setAlpha(0);
    }

    // Christmas Lights: prompt near the lights box (take one) or
    // near a hang spot (hang the one you are carrying — or grab
    // one from the box first). Carrying wins (v1.2,
    // `sq-christmas-multi-v1.2`): with a light string in hand the
    // hang prompt shows whenever you are at a spot, even if the
    // pond, the cat, or a puzzle table is also near — this was the
    // reported bug (standing at the coffee bar with a string in
    // hand and no "Hang the lights" prompt at all). v1.3
    // (`sq-christmas-lights-v1.3`): it stays quiet while an ornament
    // is in hand, for the same corner-overlap reason as the tree
    // prompt above. "At a spot" is any of the five hang spots
    // (bar wall + four corners) — nearestHangSpot decides.
    const nearLightsBox = this.christmasLightsQuest?.nearestBox(this.player.gx, this.player.gy);
    const nearLightsWall = this.christmasLightsQuest?.nearestHangSpot(this.player.gx, this.player.gy);
    if (nearLightsBox && !nearPond && !nearCat && !nearTable) {
      this.lightsPrompt.setText(noE('💡 Take a light string [E]')).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else if (showHangPrompt({ nearHangSpot: nearLightsWall, nearPond, nearCat, nearTable, carrying: this.christmasLightsQuest?.carrying, otherCarrying: this.trimTreeQuest?.carrying })) {
      this.lightsPrompt.setText(
        this.christmasLightsQuest?.carrying ? noE('💡 Hang the lights [E]') : '💡 Grab a light string from the box first',
      ).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.lightsPrompt.setAlpha(0);
    }

    // Build a Snowman: prompt near the snow pile (take one) or
    // near the snowman (add the one you are carrying — or grab one
    // from the pile first). Carrying wins: with a snowball in hand
    // the add prompt shows whenever you are at the snowman, even
    // if the pond, the cat, or a puzzle table is also near — the
    // same fix as the lights/tree hang prompts. It stays quiet
    // while a light string or an ornament is in hand (the other
    // quests' items decide, same as the tree/lights pair — the
    // rooms never share, so this is structural, not a live
    // conflict).
    const nearSnowPile = this.snowmanQuest?.nearestPile(this.player.gx, this.player.gy);
    const nearSnowman = this.snowmanQuest?.nearestSnowman(this.player.gx, this.player.gy);
    if (nearSnowPile && !nearPond && !nearCat && !nearTable) {
      this.snowPrompt.setText(noE('⛄ Take a snowball [E]')).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else if (showHangPrompt({ nearHangSpot: nearSnowman, nearPond, nearCat, nearTable, carrying: this.snowmanQuest?.carrying, otherCarrying: this.christmasLightsQuest?.carrying || this.trimTreeQuest?.carrying })) {
      this.snowPrompt.setText(
        this.snowmanQuest?.carrying ? noE('⛄ Add the snowball [E]') : '⛄ Grab a snowball from the pile first',
      ).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.snowPrompt.setAlpha(0);
    }

    // Bookshelf: prompt near interactable shelves (duck prompt takes priority).
    const nearShelf = this._nearestShelf();
    if (nearShelf && !nearPond) {
      this.shelfPrompt.setText(noE(`📚 ${nearShelf.label} [E]`)).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.shelfPrompt.setAlpha(0);
    }

    // Decoration Shop v1: prompt near a placed decoration (pick it
    // up if it is yours; someone else's just says whose it is).
    const nearDecor = this.decorSystem?.nearestDecoration(this.player.gx, this.player.gy);
    if (nearDecor && !nearPond && !nearCat && !nearTable && !nearBox && !nearTree && !nearLightsBox && !nearLightsWall) {
      this.decorPrompt.setText(
        nearDecor.mine
          ? noE(`🎄 Pick up your ${nearDecor.label} [E]`)
          : `🎄 ${nearDecor.addedByName}'s ${nearDecor.label}`,
      ).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.decorPrompt.setAlpha(0);
    }

    // Mailbox v1: prompt near the mailbox — "You've got mail!"
    // when there is unread mail waiting, plain "Mailbox" otherwise.
    // The board / chest have no prompt of their own; the mailbox
    // gets one because it lives in a park the player may visit
    // rarely, and the flag alone is easy to miss.
    const nearMailbox = this.mailSystem?.nearestMailbox(this.player.gx, this.player.gy);
    if (nearMailbox && !nearPond && !nearCat && !nearTable && !nearBox && !nearTree) {
      const mailUnread = (this.mailSystem?.getState?.().unread || 0);
      this.mailPrompt.setText(mailUnread > 0 ? noE('📬 You’ve got mail! [E]') : noE('📬 Mailbox [E]')).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.mailPrompt.setAlpha(0);
    }

    // Jukebox: prompt near jukeboxes (pond and shelf prompts take priority).
    // Client-side audio: play CC-licensed tracks when near any jukebox.
    const nearJukebox = this._nearestJukebox();
    if (nearJukebox && !nearPond && !nearShelf) {
      this.jukeboxPrompt.setText(noE('🎵 Jukebox [E]')).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.jukeboxPrompt.setAlpha(0);
    }

    // Bar counter: prompt near the bar (other prompts take priority);
    // a failed order flashes a "need coins" note instead, a wandered-off
    // customer gets a "no charge" note, and an order in flight shows as
    // "coming right up".
    // Coffee bar mobile (`sq-coffee-bar-mobile-v1`): on a phone there is
    // no E key — the prompts name the button to tap instead of "[E]".
    // (isTouchDevice is defined above, at the top of the prompt block.)
    const eHint = (emoji) => (isTouchDevice ? `· tap ${emoji}` : '[E]');
    const nearBar = this._nearestBar();
    const myId = this.socket?.id || '__local__';
    const myOrderActive = this._drinkQueue.some((entry) => entry.socketId === myId)
      || this.staticNpcs.some((npc) => npc.serve?.socketId === myId);
    // Ordering happens at the bartender, not just anywhere along the bar:
    // at a staffed bar you must be within reach of him personally.
    const bartender = this._bartenderNpc();
    const nearBartender = bartender
      ? Math.hypot(this.player.gx - bartender.gx, this.player.gy - bartender.gy) <= 170
      : false;
    const canOrder = Boolean(nearBar) && (!bartender || nearBartender);
    if (this._drinkBrokeUntil > this.time.now && nearBar) {
      this.drinkPrompt.setText('🍺 Need 2 coins!').setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else if (this._drinkMissedUntil > this.time.now && nearBar) {
      this.drinkPrompt.setText('🍺 You wandered off — no charge').setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else if (nearBar && (myOrderActive || this.time.now < (this._drinkAnimUntil || 0))) {
      // Your drink is being poured / drunk: no prompt over the mug.
      this.drinkPrompt.setAlpha(0);
    } else if (canOrder && !nearPond && !nearShelf && !nearJukebox) {
      // Agora's coffee bar gets a coffee prompt (not a beer one) — the
      // Barista serves coffee via the instant-buy path, -2 coins.
      // Decoration Shop v1: E at the Agora bar opens the shop
      // (coffee or a decoration), so the prompt says so.
      const isCoffeeBar = /coffee/i.test(nearBar?.label || '');
      this.drinkPrompt.setText(bartender ? '🍺 Talk to the bartender to order · 2 coins' : (isCoffeeBar ? `🎄☕ Coffee bar — coffee or decorations ${eHint('☕')}` : `🍺 Buy a drink · 2 coins ${eHint('🍺')}`)).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else if (nearBar && bartender && !nearBartender && !myOrderActive && !nearPond && !nearShelf && !nearJukebox) {
      this.drinkPrompt.setText('🍺 Get closer to the bartender to order').setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.drinkPrompt.setAlpha(0);
    }

    // Bread Shop v1 (`sq-bread-shop-v1`): prompt at the Register
    // counter in a food-shop room. A counter in a non-food shop
    // (pharmacy, bookshop) has an empty stock, so it shows nothing
    // at all — the counter simply does nothing there.
    const nearShop = this._nearestShopCounter();
    const shopStock = nearShop ? this._shopStock() : [];
    if (nearShop && shopStock.length > 0 && !nearPond && !nearShelf && !nearJukebox) {
      this.shopPrompt.setText(`🛒 Buy bread · 3 coins ${eHint('🛒')}`).setPosition(this.player.gx, this.player.gy - 60).setAlpha(1);
    } else {
      this.shopPrompt.setAlpha(0);
    }


    // Bartender speech bubble: the question while you pick, the call-out
    // ("One Lone Star") for a breath after each hand-off.
    if (this._serveBubbleNpc && this.time.now >= (this._serveBubbleFrom || 0) && this.time.now < this._serveBubbleUntil) {
      this.bartenderBubble.setText(this._serveBubbleText).setPosition(this._serveBubbleNpc.gx, this._serveBubbleNpc.gy - 104).setAlpha(1);
    } else {
      this.bartenderBubble.setAlpha(0);
    }

    // Clear the stage while your drink is poured and drunk: your
    // name tag and the bartender's hide so nothing sits on the mug.
    const stageClear = myOrderActive || this.time.now < (this._drinkAnimUntil || 0);
    if (this.player?.avatar?._label) this.player.avatar._label.setVisible(!stageClear);
    if (bartender?.avatar?._label) bartender.avatar._label.setVisible(!stageClear);

    // Buzz performance: I sway, and so does everyone I can see drink.
    if (this.player?.avatar?.setDrunkenness) {
      this.player.avatar.setDrunkenness(this._buzzLevel(this.socket?.id || '__local__'));
    }
    this.remotePlayers.forEach((rp, sid) => {
      rp?.avatar?.setDrunkenness?.(this._buzzLevel(sid));
    });

    // Drink card: rides at the bartender's shoulder while it's open;
    // closes on timeout or when you walk off.
    if (this._drinkCard?.visible) {
      if (this.time.now > this._drinkCardUntil || !bartender
        || Math.hypot(this.player.gx - bartender.gx, this.player.gy - bartender.gy) > 200) {
        this._drinkCard.setVisible(false);
      } else {
        this._drinkCard.setPosition(bartender.gx, bartender.gy - 60);
      }
    }
    this._updateJukeboxAudio();

    // Escalator check
    this._escalatorCooldown = Math.max(0, this._escalatorCooldown - delta);
    if (this._escalatorCooldown === 0 && this.roomLayout) {
      const esc = this.roomLayout.checkEscalator(this.player.gx, this.player.gy);
      if (esc) {
        this._escalatorCooldown = 1500;
        this._switchFloor(esc.toFloor);
      }
    }

    // Broadcast position at tick rate
    this.tickAccum += delta;
    if (this.tickAccum >= TICK_MS && this.socket?.connected) {
      this.tickAccum = 0;
      const { gx, gy } = this.player;
      if (gx !== this.lastPos.x || gy !== this.lastPos.y) {
        this.socket.emit('send_move', { roomId: this.roomId, x: gx, y: gy, direction: this.dir });
        this.lastPos = { x: gx, y: gy };
      }
    }
  }

  _renderSavedProps() {
    this._propSprites.forEach(p => p.destroy());
    this._propSprites = [];
    if (!this.textures.exists('props')) return;
    const layoutOutdoorZones = this.isOutdoorLocation
      ? (this.layout?.floors?.[this.currentFloor]?.zones || []).filter((zone) => OUTDOOR_TYPES.has(zone.type))
      : [];
    [...layoutOutdoorZones, ...(this.customZones || [])].forEach(z => {
      if (z.renderAsZone) return;
      if (!z.frameKey && !OUTDOOR_TYPES.has(z.type)) return;
      const meta = this.isOutdoorLocation ? getOutdoorSpriteMeta(z.type || z.frameKey) : null;
      const frameKey = this.isOutdoorLocation ? (z.type || z.frameKey) : z.frameKey;
      this._propSprites.push(new Prop(this, z.x, z.y, frameKey, {
        textureKey: meta?.textureKey || 'props',
        targetHeight: meta?.targetHeight,
        displaySize: meta?.displaySize || undefined,
        rotation: meta?.rotation,
      }));
    });
  }

  _renderStaticNpcs() {
    this._npcRenderVersion += 1;
    const renderVersion = this._npcRenderVersion;
    this.staticNpcs.forEach((npc) => npc.destroy?.());
    this.staticNpcs = [];

    const employees = this.layout?.floors?.[this.currentFloor]?.zones
      ?.filter((zone) => zone.type === 'employee') || [];

    employees.forEach(async (employee, index) => {
      try {
        const npc = await createAvatarEntity(this, employee.x, employee.y, {
          avatarModel: index % 3 === 0 ? 'bunny' : (index % 3 === 1 ? 'turtle' : 'snake'),
          bodyType: 'standard',
          name: employee.label || 'Library Staff',
          isLocal: false,
        });
        if (!npc) return;
        if (this._isShuttingDown || renderVersion !== this._npcRenderVersion) {
          npc.destroy();
          return;
        }
        npc.setMovementState?.({ direction: index % 2 === 0 ? 'side' : 'front', facingLeft: index % 2 === 0 });
        npc.setDepth(DEPTH.ACTOR_MIN + Math.round(employee.y));
        npc.syncLabel?.();
        this.staticNpcs.push({
          // Unique per spawned instance so two NPCs sharing a label never collide (e.g. same reply history).
          id: `${this.layout?.id || 'layout'}::${this.currentFloor}::${index}`,
          name: employee.label || 'Library Staff',
          avatar: npc,
          gx: employee.x,
          gy: employee.y,
          homeX: employee.x,
          homeY: employee.y,
          patrol: (Array.isArray(employee.patrol) ? employee.patrol : []).filter(
            (pt) => Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1])
          ),
          target: null,
          pausedUntil: 0,
          nextTargetAt: this.time.now + 800 + Math.random() * 1600,
          direction: index % 2 === 0 ? 'side' : 'front',
          facingLeft: index % 2 === 0,
          destroy: () => npc.destroy(),
        });
      } catch (error) {
        console.warn('[VillageScene] failed to spawn static NPC', error);
      }
    });
  }

  _updateStaticNpcs(delta) {
    this._pumpDrinkQueue();
    this.staticNpcs.forEach((npc) => {
      if (!npc.avatar || npc.avatar.active === false) return;

      // Bartender mid-serve: the serve task drives this NPC until it
      // completes (patrol and proximity-pause stand aside, dialogue AI
      // is unaffected — it never drove movement).
      if (npc.serve) {
        const serveMoving = this._stepNpcServe(npc, delta);
        npc.avatar.setPosition(npc.gx, npc.gy);
        npc.avatar.setDepth(DEPTH.ACTOR_MIN + Math.round(npc.gy));
        npc.avatar.setMovementState({ moving: serveMoving, direction: npc.direction, facingLeft: npc.facingLeft });
        npc.avatar.tick(delta);
        npc.avatar.syncLabel?.();
        return;
      }

      const distToPlayer = (this.player && Number.isFinite(this.player.gx) && Number.isFinite(this.player.gy))
        ? Math.hypot(this.player.gx - npc.gx, this.player.gy - npc.gy)
        : Infinity;
      const isNearPlayer = distToPlayer <= PROXIMITY_RADIUS;
      const isPaused = isNearPlayer || (this.time.now < npc.pausedUntil);

      if (isNearPlayer) {
        const pdx = this.player.gx - npc.gx;
        const pdy = this.player.gy - npc.gy;
        if (Math.abs(pdy) >= Math.abs(pdx)) {
          npc.direction = pdy > 0 ? 'front' : 'back';
        } else {
          npc.direction = 'side';
          npc.facingLeft = pdx < 0;
        }
      }

      if (!isPaused && !npc.target && this.time.now >= npc.nextTargetAt) {
        const patrol = (Array.isArray(npc.patrol) ? npc.patrol : [])
          .filter((pt) => Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
          .filter(([x, y]) => Math.hypot(x - npc.gx, y - npc.gy) > 24)
          .sort(() => Math.random() - 0.5);
        for (const [x, y] of patrol) {
          if (this.roomLayout?.isPointInsideRoom(x, y, 20)
            && !this.roomLayout?.collidesWithSolid(x, y, 18)) {
            npc.target = { x, y };
            break;
          }
        }
        npc.nextTargetAt = this.time.now + 1200 + Math.random() * 2600;
      }

      let moving = false;
      if (!isPaused && npc.target) {
        const dx = npc.target.x - npc.gx;
        const dy = npc.target.y - npc.gy;
        const distance = Math.hypot(dx, dy);
        if (distance < 4) {
          npc.target = null;
        } else {
          const step = Math.min(distance, (SPEED * 0.38 * delta) / 1000);
          const nextX = npc.gx + (dx / distance) * step;
          const nextY = npc.gy + (dy / distance) * step;
          const resolved = this.roomLayout?.resolveAgainstSolids(npc.gx, npc.gy, nextX, nextY, 16);
          if (resolved && Math.hypot(resolved.x - npc.gx, resolved.y - npc.gy) < 1) {
            npc.target = null;
          } else {
            npc.gx = resolved?.x ?? nextX;
            npc.gy = resolved?.y ?? nextY;
            moving = true;
            if (Math.abs(dy) >= Math.abs(dx)) npc.direction = dy > 0 ? 'front' : 'back';
            else {
              npc.direction = 'side';
              npc.facingLeft = dx < 0;
            }
          }
        }
      }

      npc.avatar.setPosition(npc.gx, npc.gy);
      npc.avatar.setDepth(DEPTH.ACTOR_MIN + Math.round(npc.gy));
      npc.avatar.setMovementState({ moving, direction: npc.direction, facingLeft: npc.facingLeft });
      npc.avatar.tick(delta);
      npc.avatar.syncLabel?.();
    });
  }

  _getNearbyStaticNpc() {
    let closest = null;
    this.staticNpcs.forEach((npc) => {
      const distance = Math.hypot(this.player.gx - npc.gx, this.player.gy - npc.gy);
      if (distance <= PROXIMITY_RADIUS && (!closest || distance < closest.distance)) {
        closest = { id: npc.id, name: npc.name, distance };
      }
    });
    return closest;
  }

  shutdown() {
    if (this._isShuttingDown) return;
    this._isShuttingDown = true;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onWindowBlur);
    // Portrait fill v1 (`sq-portrait-fill-v1`): drop the resize listener
    // so a restarted scene does not stack camera re-applies.
    try { this.scale?.off('resize', this._onScaleResize); } catch {}
    this._onScaleResize = null;
    this.socket?.removeAllListeners?.();
    this.socket?.disconnect();
    this.socket = null;
    if (this._fallbackSyncTimer) {
      clearInterval(this._fallbackSyncTimer);
      this._fallbackSyncTimer = null;
    }
    this.remotePlayers.forEach(a => a.destroy());
    this.remotePlayers.clear();
    this.duckPond?.destroy();
    this.duckPond = null;
    this.cafeCat?.destroy();
    this.cafeCat = null;
    this.hiddenKey?.destroy();
    this.hiddenKey = null;
    this.puzzleQuest?.destroy();
    this.puzzleQuest = null;
    this.trimTreeQuest?.destroy();
    this.trimTreeQuest = null;
    this.christmasLightsQuest?.destroy(); // Christmas Lights v1 (`sq-christmas-lights-v1`)
    this.christmasLightsQuest = null;
    this.snowmanQuest?.destroy(); // Build a Snowman v1 (`sq-build-snowman-v1`)
    this.snowmanQuest = null;
    this.itemsSystem?.destroy();
    this.itemsSystem = null;
    this.noticeBoardSystem?.destroy();
    this.noticeBoardSystem = null;
    this.noteSystem?.destroy(); // Pick-Up Notes v1 (`sq-pickup-notes-v1`)
    this.noteSystem = null;
    this.mailSystem?.destroy();
    this.mailSystem = null;
    this.giftSystem?.destroy(); // Gift Giver v1 (`sq-gift-giver-v1`)
    this.giftSystem = null;
    this.decorSystem?.destroy();
    this.decorSystem = null;
    this.floorLitterSystem?.destroy();
    this.floorLitterSystem = null;
    this._clearLitterbugLabels?.();
    this.santaHatSystem?.destroy();
    this.santaHatSystem = null;
    this.temperatureSystem?.destroy();
    this.temperatureSystem = null;
    this.hungerSystem?.destroy();
    this.hungerSystem = null;
    this.homeStorageSystem?.destroy();
    this.homeStorageSystem = null;
    this.questManager?.destroy();
    this.questManager = null;
    this.catPrompt?.destroy();
    this.hatPrompt?.destroy();
    this.puzzlePrompt?.destroy();
    this.treePrompt?.destroy();
    this.lightsPrompt?.destroy(); // Christmas Lights v1 (`sq-christmas-lights-v1`)
    this.snowPrompt?.destroy(); // Build a Snowman v1 (`sq-build-snowman-v1`)
    this.decorPrompt?.destroy();
    this.mailPrompt?.destroy();
    this.halloween?.destroy();
    this.halloween = null;
    this.dayNight?.destroy();
    this.dayNight = null;
    this.snowfall?.destroy(); // Snowfall v1 (`sq-snowfall-v1`)
    this.snowfall = null;
    this.feedPrompt?.destroy();
    this.duckPrompt?.destroy();
    this.shelfPrompt?.destroy();
    this.jukeboxPrompt?.destroy();
    this.drinkPrompt?.destroy();
    // Bread Shop v1 (`sq-bread-shop-v1`).
    this.shopPrompt?.destroy();
    this.bartenderBubble?.destroy();
    this._drinkCard?.destroy();
    try { stopYouTube(); } catch {}
    if (this.ghosts) { for (const [, g] of this.ghosts) { try { g.avatar.destroy(); } catch {} } this.ghosts.clear(); }
    this.staticNpcs?.forEach((npc) => npc.destroy?.());
    this.staticNpcs = [];
    this._npcRenderVersion += 1;
    this.npcReplyCounts?.clear();
    this.onNearbyNpcChange(null);
    this.onRoomPopulationChange(0);
    this.roomLayout?.destroy();
    this.roomEditor?.destroy();
    this._propSprites?.forEach(p => p.destroy());
    this.onEditorChange(false);
    this.onNearbyChange(0);
    this.onFloorStatusChange({ currentFloor: 0, totalFloors: 1, stairScaffoldActive: false, layoutId: '' });
    this.pendingRemoteSpawns?.clear();
  }

  _switchFloor(floorIndex) {
    if (floorIndex === this.currentFloor) return;
    if (!this.layout.floors[floorIndex]) return;
    this.currentFloor = floorIndex;
    this.roomLayout.drawFloor(floorIndex);
    this.duckPond?.refresh();
    this.cafeCat?.refresh();
    this.questManager?.refresh();
    this.hiddenKey?.refresh();
    this.puzzleQuest?.refresh();
    this.trimTreeQuest?.refresh();
    this.christmasLightsQuest?.refresh(); // Christmas Lights v1 (`sq-christmas-lights-v1`)
    this.snowmanQuest?.refresh(); // Build a Snowman v1 (`sq-build-snowman-v1`)
    this.itemsSystem?.refresh();
    // Notice board everywhere v1: re-resolve the board for this
    // floor (upper floors have no board — _board goes null, so the
    // ground-floor board cannot be opened from upstairs).
    this.noticeBoardSystem?.refresh();
    // Pick-Up Notes v1 (`sq-pickup-notes-v1`): re-resolve the
    // room's notes for this floor (notes re-draw after the switch).
    this.noteSystem?.refresh();
    // Mailbox v1: re-resolve the mailbox for this floor (upper
    // floors have no mailbox — _mailbox goes null, so the
    // ground-floor box cannot be opened from upstairs).
    this.mailSystem?.refresh();
    // Decoration Shop v1: re-resolve the room's decorations for
    // this floor (placed decorations re-draw after the switch).
    this.decorSystem?.refresh();
    // Shared Floor Litter v1: re-resolve the room's floor litter
    // for this floor (shared litter re-draws after the switch).
    this.floorLitterSystem?.refresh();
    this.questManager?.noteRoomVisit();
    this._emitFloorStatus();
    this.roomLayout.setDynamicSolids(this.customZones);
    this.roomLayout.setCollisionDebug(this.showCollisionDebug);
    this.roomLayout.setFootprintDebug(this.showFootprintDebug);
    this._applyCameraMode();
    this._renderStaticNpcs();
    const spawn = floorIndex === 0
      ? (this.layout.spawnF1 || { x: 800, y: 750 })
      : (this.layout.spawnF2 || { x: 900, y: 370 });
    const safeSpawn = this.roomLayout?.resolveSafeSpawnPoint?.([
      spawn,
      this.roomLayout?.getBoundaryBounds?.()
        ? {
            x: this.roomLayout.getBoundaryBounds().x + (this.roomLayout.getBoundaryBounds().w / 2),
            y: this.roomLayout.getBoundaryBounds().y + (this.roomLayout.getBoundaryBounds().h / 2),
          }
        : null,
    ], 20) || spawn;
    this.player.gx = safeSpawn.x;
    this.player.gy = safeSpawn.y;
    this.player.sync();
  }
}
