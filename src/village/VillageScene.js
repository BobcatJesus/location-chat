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
    return 'Hello. What are you in the mood to read today: a favorite genre, a new recommendation, or something for a class?';
  }
  if (mentionsAllNighter) {
    return 'An all-nighter is rough. Pick your three most important tasks, take a five-minute break each hour, drink water, and protect some sleep before anything high-stakes.';
  }
  if (asksForFavoriteBook) {
    const favorites = {
      'Archives Guide': 'My favorite book is A Pattern Language by Christopher Alexander. It makes you notice the stories hidden in ordinary places.',
      'Research Mentor': 'I keep returning to The Demon-Haunted World by Carl Sagan. It is a warm guide to asking better questions.',
      'Reference Desk': 'My favorite book is The Left Hand of Darkness by Ursula K. Le Guin. It is thoughtful, strange, and rewards a second read.',
      Librarian: 'My favorite book is The City and the City by China Mieville. It is part mystery, part world-building puzzle, and very hard to forget.',
    };
    return favorites[npcName] || 'My favorite book changes with the season, but I always admire a story that sends someone back to the shelves for more.';
  }
  if (lovesReading) {
    return 'That is excellent company to keep. What kind of book makes you forget to check the time?';
  }
  if (mentionsStudyHelp) {
    return 'Try a 25-minute focused block, then summarize what you learned in your own words. A short retrieval quiz beats rereading every time.';
  }
  if (npcName === 'Archives Guide') {
    if (text.includes('map') || text.includes('history')) return 'The local history maps are in the Archives & Special Collections stacks. Handle them gently.';
    if (asksForFavoriteSection) return 'My favorite section is local history. A city map beside a first-person account can make the past feel wonderfully close.';
    if (asksForSuggestion) return 'For a remarkable afternoon, try a local history collection, then follow its footnotes into the rare-book catalog.';
    return 'Archives holds rare books, manuscripts, and Houston history. What would you like to explore?';
  }
  if (npcName === 'Research Mentor') {
    if (text.includes('source') || text.includes('cite')) return 'Start with the library catalog, then check peer-reviewed databases. Save each citation as you go.';
    if (asksForSuggestion) return 'Choose one book that gives the big picture, then one recent article that challenges it. That is a strong research pairing.';
    if (mentionsReading) return 'For deep reading, begin with the introduction and conclusion, then follow the evidence that catches your attention.';
    return 'I can help you shape a research question, find sources, or build a citation plan.';
  }
  if (npcName === 'Reference Desk') {
    if (text.includes('book') || text.includes('find')) return 'Tell me the title, author, or subject and I will point you toward the right shelf or catalog search.';
    if (asksForFavoriteSection) return 'I am partial to the science shelves, but a good library section is whichever one makes you lose track of time.';
    if (asksForSuggestion) return 'Tell me a subject you enjoy and I can suggest a shelf. Fiction, history, science, and the arts are all nearby.';
    return 'Welcome to reference. Need help finding a book, article, or database?';
  }
  if (asksForFavoriteSection) return 'My favorite section changes often, but today I would pick the arts shelves. They are full of unexpected detours.';
  if (asksForSuggestion) return 'Try a book from a section you do not usually visit, then choose another from the shelf right beside it.';
  if (mentionsReading) return 'A good reading session needs a comfortable chair, a little time, and permission to follow your curiosity.';
  if (text.includes('book') || text.includes('borrow') || text.includes('checkout')) return 'You can check out books at the circulation desk. Keep your account details handy.';
  return 'Tell me what you are looking for: a genre recommendation, a favorite book, help finding a title, or a study plan.';
}

function getParkNpcResponse(npcName, message) {
  const text = String(message || '').toLowerCase();
  const isGreeting = /^(hi|hello|hey|howdy|good morning|good afternoon|good evening)[!.?\s]*$/i.test(text.trim());
  if (text.includes('how are you') || text.includes('how r you')) return 'I am doing well, thanks. It is nice to be out in the park.';
  if (text.includes('feeding the ducks') || text.includes('feed the ducks')) return 'That sounds peaceful. Just be sure to use duck-friendly food instead of bread.';
  if (text.includes('beautiful day') || text.includes('day is beautiful') || text.includes('nice day')) return 'It really is. The trees make the park feel especially calm today.';
  if (text.includes('raining') || text.includes('rainy') || text.includes('rain today')) return 'Rain changes the whole park. The paths can get slick, but the trees and pond look lovely afterward.';
  if (text.includes('jog') || text.includes('run') || text.includes('exercise')) return 'The outer path is great for a relaxed jog. Start easy, bring water, and leave some energy for the walk home.';
  if (text.includes('sun') || text.includes('weather') || text.includes('outside')) return 'A little time in the sun can be lovely. A shady bench and sunscreen make it much easier to enjoy.';
  if (text.includes('playground') || text.includes('play')) return 'The playground is busiest after school. It is a cheerful spot, and the nearby benches make it easy to keep an eye on the action.';
  if (text.includes('duck') || text.includes('pond') || text.includes('bird')) return 'The pond is peaceful for birdwatching. Please skip bread for ducks; their natural food is much better for them.';
  if (text.includes('picnic') || text.includes('eat') || text.includes('lunch')) return 'There are good picnic spots under the trees. Pack out what you bring in so the park stays welcoming.';
  if (npcName === 'Morning Jogger') return isGreeting ? 'Hey there. I am just finishing a loop. Are you out for a walk or a jog?' : 'I like an early loop before the park gets busy. The tree-lined stretch is my favorite part.';
  if (npcName === 'Pond Watcher') return isGreeting ? 'Hello. The pond is especially calm this morning. Have you spotted any birds yet?' : 'I come here to slow down and watch the water for a while. It is a fine place to reset.';
  return isGreeting ? 'Hi. It is a great day to be outside. Are you exploring the paths, the playground, or the pond?' : 'This park has a little room for every kind of afternoon: a walk, a run, a picnic, or simply some quiet.';
}

function getVenueNpcResponse(layoutId, message) {
  const text = String(message || '').toLowerCase();
  const isGreeting = /^(hi|hello|hey|howdy|good morning|good afternoon|good evening)[!.?\s]*$/i.test(text.trim());
  const theme = String(layoutId || '').replace(/^auto-/, '').replace(/-poly.*$/, '');
  const responses = {
    cafe: text.includes('study') ? 'This is a good study spot. Coffee first, then the to-do list.' : text.includes('drink') || text.includes('coffee') ? 'What are you drinking today? The pastry case is tempting too.' : 'The window seats fill up fast, but there is usually a quiet corner nearby.',
    restaurant: text.includes('order') || text.includes('food') ? 'Have you decided what to order? I hear the special is good today.' : text.includes('dessert') ? 'Save room for dessert.' : 'The best conversations happen over a meal.',
    shop: text.includes('find') || text.includes('looking') ? 'Looking for anything in particular? There are some good finds near the back.' : text.includes('opinion') ? 'Need a second opinion? I like browsing without a plan.' : 'Take your time. The best finds are often unexpected.',
    gym: text.includes('leg') ? 'Leg day? Start light and focus on form.' : text.includes('workout') || text.includes('train') ? 'What are you training today? A warm-up makes the rest feel better.' : 'You have got this. Remember to cool down afterward.',
    theater: text.includes('movie') || text.includes('see') ? 'What are you here to see? The trailers start soon.' : text.includes('popcorn') ? 'Popcorn is practically required.' : 'I love the quiet before a movie starts.',
    bar: text.includes('music') ? 'Good music tonight.' : text.includes('friend') || text.includes('meeting') ? 'Are you meeting friends? There is a seat open nearby.' : 'How is your night going? Take your time getting home.',
    pharmacy: text.includes('medicine') || text.includes('prescription') ? 'The pharmacist can help with medication questions. For anything urgent, please seek professional care.' : 'I hope you find what you need. Take care of yourself.',
    default: text.includes('nearby') || text.includes('place') ? 'Have you checked out the nearby spots?' : 'It is nice seeing the neighborhood out and about.',
  };
  return isGreeting ? 'Hi. What brings you by today?' : (responses[theme] || responses.default);
}

function getNpcOpeningResponse(layoutId, isOutdoorLocation) {
  if (isOutdoorLocation) return 'Hello! Enjoying the park?';
  const layoutName = String(layoutId || '');
  const theme = layoutName.includes('library') ? 'library' : layoutName.replace(/^auto-/, '').replace(/-poly.*$/, '');
  if (theme === 'library') return 'Hello! Want a book suggestion?';
  if (theme === 'cafe') return 'Hello! Getting coffee or finding a study spot?';
  if (theme === 'restaurant') return 'Hello! Have you decided what to order?';
  if (theme === 'shop') return 'Hello! Looking for anything in particular?';
  if (theme === 'gym') return 'Hello! What are you training today?';
  if (theme === 'theater') return 'Hello! What are you here to see?';
  if (theme === 'bar') return 'Hello! How is your night going?';
  if (theme === 'pharmacy') return 'Hello! I hope you find what you need.';
  return 'Hello! What brings you by today?';
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
  const followUps = isOutdoorLocation ? [
    'It is good to take a moment and enjoy it.',
    'There is always something new to notice outside.',
    'The park feels different every time you visit.',
    'A slow walk is never a bad idea.',
    'The fresh air helps put things in perspective.',
    'I hope you get to enjoy the rest of your day here.',
    'The trees make a fine place to pause.',
    'Take your time and enjoy the path ahead.',
    'It is a nice place to reset for a few minutes.',
    'There is no rush in a good park afternoon.',
    'I am glad you stopped to chat.',
    'The next turn on the path might be the best one.',
  ] : [
    'Want another direction to explore?',
    'I can offer a different shelf if that is not your style.',
    'The catalog can help you find a copy that is available today.',
    'A neighboring call number often leads to a good surprise.',
    'Tell me what mood you are in and I will narrow it down.',
    'There is always another excellent path through the stacks.',
    'A different corner of this place may have exactly what you need.',
    'It is worth taking a little time to look around.',
    'The best option is often the one you did not expect.',
    'Ask again with a detail and I can be more specific.',
    'There is always room for one more good idea.',
    'I am glad you asked.',
  ];
  return `${response} ${followUps[replyNumber % followUps.length]}`;
}


export class VillageScene extends Phaser.Scene {
  constructor() { super({ key: 'VillageScene' }); }

  static _boot = null;

  init(data) {
    const d = VillageScene._boot || data;
    VillageScene._boot = null;
    this.roomId     = d.roomId     ?? 'default-room';
    this.roomName   = d.roomName   ?? '';
    this.roomOwnerId = d.roomOwnerId ?? '';
    this.amenityTag = d.amenityTag ?? '';
    this.shopTag    = d.shopTag    ?? '';
    this.roomShape  = d.roomShape  ?? null;
    this.roomData   = d.roomData   ?? null;
    this.explicitLayout = d.explicitLayout ?? null;
    this.profile    = d.profile    ?? {};
    this.preferredCameraMode = ['ultra-close-follow', 'close-follow', 'follow', 'wide-follow', 'overview'].includes(d.preferredCameraMode)
      ? d.preferredCameraMode
      : null;
    this.avatarState = normalizeAvatarState(d.profile?.profile || {});
    this.onEditorChange = d.onEditorChange ?? (() => {});
    this.onNearbyChange = d.onNearbyChange ?? (() => {});
    this.onNearbyNpcChange = d.onNearbyNpcChange ?? (() => {});
    this.onRoomPopulationChange = d.onRoomPopulationChange ?? (() => {});
    this.onChatMessage = d.onChatMessage ?? (() => {});
    this.onSystemNotice = d.onSystemNotice ?? (() => {});
    this.onFloorStatusChange = d.onFloorStatusChange ?? (() => {});
    this.npcReplyCounts = new Map();
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

    socket.on('connect', () => {
      socket.emit('join_room', {
        roomId: this.roomId,
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
      });
      this.time.delayedCall(350, async () => {
        if (this._isShuttingDown) return;
        const isLibrary = this.layout?.id === 'md-anderson-library' || String(this.layout?.id || '').includes('library');
        const isGreeting = /^(hi|hello|hey|howdy|good morning|good afternoon|good evening)[!.?\s]*$/i.test(text);
        let response = replyNumber === 0 && isGreeting
          ? getNpcOpeningResponse(this.layout?.id, this.isOutdoorLocation)
          : this.isOutdoorLocation
            ? getParkNpcResponse(nearbyNpc.name, text)
            : isLibrary
              ? getLibraryNpcResponse(nearbyNpc.name, text)
              : getVenueNpcResponse(this.layout?.id, text);
        if (requestedGenre) {
          try {
            const book = await getLiveBookRecommendation(requestedGenre);
            response = `For ${requestedGenre.replace(/-/g, ' ')}, try ${book.title} by ${book.author}. ${book.signal} Source: ${book.source}.`;
          } catch {
            response = `${response} I could not reach the current catalog, so this is general guidance rather than a live ranking.`;
          }
        }
        if (this._isShuttingDown) return;
        this.onChatMessage({
          senderName: nearbyNpc.name,
          message: replyNumber === 0 && isGreeting ? response : varyNpcResponse(response, replyNumber, this.isOutdoorLocation),
          isSelf: false,
          distance: Math.round(nearbyNpc.distance),
          timestamp: Date.now(),
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
          avatarModel: index % 2 === 0 ? 'bunny' : 'turtle',
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
      const isPaused = this.time.now < npc.pausedUntil;
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
