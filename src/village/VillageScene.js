import Phaser from 'phaser';
import { DEPTH } from './depth.js';
import { io } from 'socket.io-client';
import { RoomLayout } from './RoomLayout.js';
import { pickLayout } from './layoutPicker.js';
import { RoomEditor } from './RoomEditor.js';
import { OutdoorEditor } from './OutdoorEditor.js';
import { Prop, PROP_DEFS } from './Prop.js';
import { createAvatarEntity, preloadAvatarTextures } from '../game/entities/avatarFactory';
import { normalizeAvatarModel } from '../game/entities/avatarModels';
import { isOutdoorLocation } from './outdoorRoomDetection.js';

const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.PROD ? 'https://location-chat-production.up.railway.app' : 'http://localhost:4000');

const SPEED = 180;
const TICK_MS = 50; // position broadcast interval
const PROXIMITY_RADIUS = 150;
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
      return { textureKey: 'tree-oak', targetHeight: 126, rotation: 0 };
    case 'tree':
      return { textureKey: 'tree-oak', targetHeight: 92, rotation: 0 };
    case 'shrub':
      return { textureKey: 'tree-oak', targetHeight: 52, rotation: 0 };
    case 'hedge':
      return { textureKey: 'tree-oak', targetHeight: 44, rotation: 0 };
    case 'bench':
      return { textureKey: 'bench', targetHeight: 64, rotation: 0 };
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

function getVenueNpcResponse(layoutId, message) {
  const text = String(message || '').toLowerCase();
  const isGreeting = /^(hi|hello|hey|howdy|good morning|good afternoon|good evening)[!.?\s]*$/i.test(text.trim());
  const theme = String(layoutId || '').replace(/^auto-/, '').replace(/-poly.*$/, '');
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
    this.userLocation = d.userLocation ?? null;
    this.onLeave    = d.onLeave    ?? (() => {});
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

  preload() {
    preloadAvatarTextures(this);
    this.load.atlas('props', '/assets/props/props.png', '/assets/props/props.json');
    this.load.image('bench', '/assets/props/bench.png');
    this.load.image('lamppost', '/assets/props/lampost.png');
    this.load.image('tree-oak', '/assets/props/tree-oak.png');
    this.load.image('tree-cherry', '/assets/props/tree-cherry.png');
  }

  create() {
    const W = this.scale.width, H = this.scale.height;

    // Ensure cleanup runs whenever Phaser stops or destroys this scene.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.shutdown, this);

    // Pick and draw layout
    this.layout = this.explicitLayout || pickLayout(this.roomId, this.roomName, this.amenityTag, this.shopTag, this.roomShape, this.roomData);
    console.log('[VillageScene] room:', this.roomId, '| name:', this.roomName, '| layout:', this.layout.id);
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
    this.cameras.main.setZoom(FOLLOW_ZOOM);
    const layoutBounds = this.layout?.width && this.layout?.height
      ? { x: 0, y: 0, w: this.layout.width, h: this.layout.height }
      : (this.roomLayout?.getBoundaryBounds?.() || { x: 0, y: 0, w: 1600, h: 900 });
    const cameraW = Math.max(1600, Math.ceil(layoutBounds.x + layoutBounds.w));
    const cameraH = Math.max(900, Math.ceil(layoutBounds.y + layoutBounds.h));
    this.cameras.main.setBounds(0, 0, cameraW, cameraH);
    this._emitRoomPopulation();

    // Input
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.wasd = this.input.keyboard?.addKeys('W,A,S,D');
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
      const target = this.roomLayout?.clampPointToRoom(ptr.worldX, ptr.worldY, 20)
        || { x: Phaser.Math.Clamp(ptr.worldX, 20, W * 4 - 20), y: Phaser.Math.Clamp(ptr.worldY, 60, H * 4 - 10) };
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
      const fitZoom = Math.max(0.95, Math.min(2.4, Math.min(this.scale.width / Math.max(1, b.w), this.scale.height / Math.max(1, b.h)) * 1.2));
      cam.stopFollow();
      cam.setZoom(fitZoom);
      cam.centerOn(b.x + b.w / 2, b.y + b.h / 2);
      this._applyAvatarVisualScale();
      return;
    }

    const followZoom = this.cameraMode === 'ultra-close-follow'
      ? ULTRA_CLOSE_FOLLOW_ZOOM
      : this.cameraMode === 'close-follow'
      ? CLOSE_FOLLOW_ZOOM
      : this.cameraMode === 'wide-follow'
        ? WIDE_FOLLOW_ZOOM
        : FOLLOW_ZOOM;
    cam.setZoom(followZoom);
    if (this.player?.avatar) {
      cam.startFollow(this.player.avatar, true, 0.1, 0.1);
    }
    this._applyAvatarVisualScale();
  }

  _currentAvatarScale() {
    if (this.cameraMode === 'overview') return OVERVIEW_AVATAR_SCALE;
    if (this.cameraMode === 'ultra-close-follow') return ULTRA_CLOSE_AVATAR_SCALE;
    if (this.cameraMode === 'close-follow') return CLOSE_AVATAR_SCALE;
    if (this.cameraMode === 'wide-follow') return WIDE_AVATAR_SCALE;
    return FOLLOW_AVATAR_SCALE;
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
    const defaultSpawn = { x: this.scale.width / 2, y: this.scale.height / 2 };
    const roomSpawn = this.layout?.spawnF1 || defaultSpawn;
    const boundaryBounds = this.roomLayout?.getBoundaryBounds?.() || null;

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
      remotePlayer.destroy();
      this.remotePlayers.delete(socketId);
    }
    this.pendingRemoteSpawns?.delete(socketId);
  }

  _connectSocket() {
    const socket = io(SOCKET_SERVER_URL, { transports: ['websocket'] });
    this.socket = socket;
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
      socket.emit('join_room', {
        roomId: this.roomId,
        lat: this.userLocation?.latitude ?? null,
        lng: this.userLocation?.longitude ?? null,
        user: {
          id: userId,
          name: userName,
          firstName,
          isCreator,
          ...this.avatarState,
        },
      });
      socket.emit('get_room_state', { roomId: this.roomId });
      socket.emit('get_room_decorations', { roomId: this.roomId });
      const now = Date.now();
      this._lastPresenceSyncAt = now;
      this._lastDecorSyncAt = now;
      if (this._fallbackSyncTimer) clearInterval(this._fallbackSyncTimer);
      this._fallbackSyncTimer = setInterval(() => this._runFallbackSync(), 1000);
    });

    socket.on('disconnect', () => {
      if (this._fallbackSyncTimer) {
        clearInterval(this._fallbackSyncTimer);
        this._fallbackSyncTimer = null;
      }
    });

    socket.on('room_state', (state) => {
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
      const npc = this.staticNpcs.find((entry) => entry.name === nearbyNpc.id);
      if (npc) {
        npc.target = null;
        npc.pausedUntil = this.time.now + 15000;
      }
      const replyNumber = this.npcReplyCounts.get(nearbyNpc.id) || 0;
      this.npcReplyCounts.set(nearbyNpc.id, replyNumber + 1);
      const requestedGenre = getRequestedBookGenre(text);
      this.onChatMessage({
        senderName: 'You', message: text, isSelf: true,
        distance: Math.round(nearbyNpc.distance), timestamp: Date.now(),
        channel: 'npc', npcId: nearbyNpc.id,
      });
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
      this.remotePlayers.set(socketId, remotePlayer);
      this._emitRoomPopulation();
    } catch (error) {
      console.warn('[VillageScene] failed to spawn remote avatar', error);
    } finally {
      this.pendingRemoteSpawns.delete(socketId);
    }
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

    const kbL = this.cursors?.left.isDown  || this.wasd?.A.isDown;
    const kbR = this.cursors?.right.isDown || this.wasd?.D.isDown;
    const kbU = this.cursors?.up.isDown    || this.wasd?.W.isDown;
    const kbD = this.cursors?.down.isDown  || this.wasd?.S.isDown;

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
          avatar: npc,
          gx: employee.x,
          gy: employee.y,
          homeX: employee.x,
          homeY: employee.y,
          patrol: Array.isArray(employee.patrol) ? employee.patrol : [],
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
    this.staticNpcs.forEach((npc) => {
      if (!npc.avatar || npc.avatar.active === false) return;

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
        const patrol = npc.patrol
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
        closest = { id: npc.name, name: npc.name, distance };
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
    this.socket?.removeAllListeners?.();
    this.socket?.disconnect();
    this.socket = null;
    if (this._fallbackSyncTimer) {
      clearInterval(this._fallbackSyncTimer);
      this._fallbackSyncTimer = null;
    }
    this.remotePlayers.forEach(a => a.destroy());
    this.remotePlayers.clear();
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
