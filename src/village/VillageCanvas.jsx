import React, { useEffect, useRef, useState } from 'react';
import { fetchApprovedLayout, approvedToLayout } from './approvedLayout.js';
import Phaser from 'phaser';
import { VillageScene } from './VillageScene.js';
import ShelfPanel from './ShelfPanel.jsx';
import JukeboxPanel from './JukeboxPanel.jsx';
import PuzzleBoard from './PuzzleBoard.jsx';
import InventoryPanel from './InventoryPanel.jsx';
import DecorShopPanel from './DecorShopPanel.jsx';
import NoticeBoardPanel from './NoticeBoardPanel.jsx';
import MailboxPanel from './MailboxPanel.jsx';
import HomeStoragePanel from './HomeStoragePanel.jsx';
import PlayerBadgesPanel from './PlayerBadgesPanel.jsx';
import InteriorSketchModal from './InteriorSketchModal.jsx';
import ModQueuePanel from './ModQueuePanel.jsx';
import { getCoins } from './CoinWallet.js';
import { buildAutoLayout } from './AutoLayout.js';
import { isOutdoorLocation } from './outdoorRoomDetection.js';
import { bookstore } from './layouts/bookstore.js';
import { library } from './layouts/library.js';
import { agora } from './layouts/agora.js';
import { home } from './layouts/home.js';
import { isHomeRoom } from './homeStorage.js';
import { getDistanceMeters } from '../geo';
import { ROOMS, getAllRooms } from '../../rooms/rooms.js';
import { getVenueEvents } from '../../lib/venueEvents.js';
// Mailbox v1.1 (`sq-mailbox-v1.1`): the "Go to my mailbox" seam —
// close the pocket, then enter the mailbox room through the
// app-level entry (same path as a map pin).
import { goToMailboxRoom } from './mailState.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://location-chat-production.up.railway.app';

const LIVE_OAK_PARK_CENTER = { lat: 29.754535, lng: -95.409365 };
const LIVE_OAK_OSM_WAY_ID = '392274785';
const LIVE_OAK_PARK_FOOTPRINT = [
  { lat: 29.7543320, lon: -95.4098284 },
  { lat: 29.7542983, lon: -95.4098136 },
  { lat: 29.7542808, lon: -95.4097895 },
  { lat: 29.7542738, lon: -95.4097372 },
  { lat: 29.7542808, lon: -95.4089674 },
  { lat: 29.7542924, lon: -95.4089312 },
  { lat: 29.7543087, lon: -95.4089151 },
  { lat: 29.7543367, lon: -95.4089151 },
  { lat: 29.7547314, lon: -95.4089110 },
  { lat: 29.7547523, lon: -95.4089245 },
  { lat: 29.7547698, lon: -95.4089513 },
  { lat: 29.7547733, lon: -95.4089848 },
  { lat: 29.7547663, lon: -95.4090183 },
  { lat: 29.7544345, lon: -95.4097921 },
  { lat: 29.7544182, lon: -95.4098176 },
  { lat: 29.7543798, lon: -95.4098284 },
  { lat: 29.7543320, lon: -95.4098284 },
];

const SHEPHERD_PARK_CENTER = { lat: 29.8341952, lng: -95.4174423 };
const SHEPHERD_PARK_OSM_WAY_ID = '289943234';
const SHEPHERD_PARK_FOOTPRINT = [
  { lat: 29.8335422, lon: -95.4186888 },
  { lat: 29.8335639, lon: -95.4163778 },
  { lat: 29.8349965, lon: -95.4163985 },
  { lat: 29.8349885, lon: -95.4182790 },
  { lat: 29.8348102, lon: -95.4182811 },
  { lat: 29.8346319, lon: -95.4183171 },
  { lat: 29.8343713, lon: -95.4184029 },
  { lat: 29.8340191, lon: -95.4185923 },
  { lat: 29.8337291, lon: -95.4186845 },
  { lat: 29.8335422, lon: -95.4186888 },
];

const RUNTIME_SESSION_STAMP = new Date().toISOString();

function formatDebugStamp(value = '') {
  const text = String(value || '').trim();
  if (!text) return 'unknown';
  if (text === 'dev') return 'dev';
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return text;
  return new Date(parsed).toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function normalizePlaceText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasOsmWayId(room = {}, osmWayId = '') {
  if (!osmWayId) return false;
  const rawId = String(room?.id || '');
  return rawId === `osm-${osmWayId}` || rawId.endsWith(`-${osmWayId}`) || rawId.includes(osmWayId);
}

function resolveKnownRoomFootprint(room = {}) {
  const name = normalizePlaceText(room?.name || '');
  const amenity = normalizePlaceText(room?.amenity || '');
  const lat = Number(room?.lat);
  const lng = Number(room?.lng);

  if (hasOsmWayId(room, LIVE_OAK_OSM_WAY_ID)) return LIVE_OAK_PARK_FOOTPRINT;
  if (hasOsmWayId(room, SHEPHERD_PARK_OSM_WAY_ID)) return SHEPHERD_PARK_FOOTPRINT;

  const looksLikeLiveOak = name.includes('live oak park');
  const nearLiveOak = Number.isFinite(lat) && Number.isFinite(lng)
    && getDistanceMeters(lat, lng, LIVE_OAK_PARK_CENTER.lat, LIVE_OAK_PARK_CENTER.lng) <= 280;
  if (looksLikeLiveOak || (amenity === 'park' && nearLiveOak)) {
    return LIVE_OAK_PARK_FOOTPRINT;
  }

  const looksLikeShepherd = name.includes('shepherd park');
  const nearShepherd = Number.isFinite(lat) && Number.isFinite(lng)
    && getDistanceMeters(lat, lng, SHEPHERD_PARK_CENTER.lat, SHEPHERD_PARK_CENTER.lng) <= 320;
  if (looksLikeShepherd || (amenity === 'park' && nearShepherd)) {
    return SHEPHERD_PARK_FOOTPRINT;
  }

  return null;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'room';
}

function canonicalRoomId(room) {
  if (!room) return null;
  const rawId = String(room.id || '').trim();
  if (rawId) return rawId;

  const hasCoords = Number.isFinite(room.lat) && Number.isFinite(room.lng);
  if (hasCoords) {
    // Coarser precision avoids tiny GPS drift creating separate rooms.
    const lat = Number(room.lat).toFixed(3);
    const lng = Number(room.lng).toFixed(3);
    return `geo-${lat}-${lng}`;
  }

  const nameKey = slugify(room.name || room.shop || room.amenity || 'room');
  return `name-${nameKey}`;
}

function isShepherdParkRoom(room = {}) {
  const id = String(room?.id || '').toLowerCase();
  const name = normalizePlaceText(room?.name || '');
  return id.includes('shepherd-park')
    || id.includes(SHEPHERD_PARK_OSM_WAY_ID)
    || name.includes('shepherd park');
}

function inferAmenityTag(room = {}) {
  const explicitAmenity = normalizePlaceText(room?.amenity || '');
  if (explicitAmenity && explicitAmenity !== 'default') return room.amenity;

  const id = normalizePlaceText(room?.id || '');
  const name = normalizePlaceText(room?.name || '');
  const taggedAmenity = normalizePlaceText(room?.tags?.amenity || '');
  const leisure = normalizePlaceText(room?.tags?.leisure || room?.leisure || '');
  const natural = normalizePlaceText(room?.tags?.natural || room?.natural || '');
  const parkKeywords = ['park', 'garden', 'greenspace', 'green space', 'green square', 'lawn', 'trail', 'grove', 'arboretum'];

  if (isShepherdParkRoom(room)) return 'park';
  if (leisure === 'park' || leisure === 'garden' || leisure === 'nature reserve') return 'park';
  if (natural === 'wood' || natural === 'tree' || natural === 'grassland') return 'park';
  if (parkKeywords.some((keyword) => id.includes(keyword) || name.includes(keyword))) return 'park';

  return room?.amenity || taggedAmenity || '';
}

function createLocalRadiusFallbackFootprint(room = {}) {
  const lat = Number(room?.lat);
  const lng = Number(room?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const radiusMeters = Math.max(30, Number(room?.radiusMeters || room?.radius || 80));
  const northSouthRadiusMeters = radiusMeters * 0.88;
  const eastWestRadiusMeters = radiusMeters;
  const lonScale = Math.max(0.000001, Math.cos((lat * Math.PI) / 180));
  const ringProfile = [
    [0.00, 1.00],
    [0.48, 0.88],
    [0.84, 0.52],
    [1.00, 0.00],
    [0.84, -0.52],
    [0.48, -0.88],
    [0.00, -1.00],
    [-0.48, -0.88],
    [-0.84, -0.52],
    [-1.00, 0.00],
    [-0.84, 0.52],
    [-0.48, 0.88],
  ];

  return ringProfile.map(([dx, dy]) => {
    const latDelta = (dy * northSouthRadiusMeters) / 111320;
    const lonDelta = (dx * eastWestRadiusMeters) / (111320 * lonScale);
    return {
      lat: lat + latDelta,
      lon: lng + lonDelta,
    };
  });
}

function createDecahedronRoomFootprint(room = {}) {
  const lat = Number(room?.lat);
  const lng = Number(room?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const radiusMeters = Math.max(30, Number(room?.radiusMeters || room?.radius || 80));
  const lonScale = Math.max(0.000001, Math.cos((lat * Math.PI) / 180));
  const majorRadiusMeters = radiusMeters * 1.15;
  const minorRadiusMeters = radiusMeters * 0.84;
  const points = [];
  const sides = 10;

  for (let i = 0; i < sides; i++) {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const radius = i % 2 === 0 ? majorRadiusMeters : minorRadiusMeters;
    const dx = Math.cos(angle) * radius;
    const dy = Math.sin(angle) * radius;
    points.push({
      lat: lat + (dy / 111320),
      lon: lng + (dx / (111320 * lonScale)),
    });
  }

  return points;
}

export default function VillageCanvas({ room, profile, onLeave, location, venueEvents: providedVenueEvents = [], canManageVenue = false, isModerator = false, onEnterRoom }) {
  const BASE_WIDTH = 1600;
  const BASE_HEIGHT = 900;
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const [editorActive, setEditorActive] = useState(false);
  const [nearbyCount, setNearbyCount] = useState(0);
  const [nearbyNpc, setNearbyNpc] = useState(null);
  const [chatRecipient, setChatRecipient] = useState('players');
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [showEditHint, setShowEditHint] = useState(false);
  const [systemNotice, setSystemNotice] = useState('');
  const [coinBalance, setCoinBalance] = useState(() => getCoins());
  const [showInteriorSketch, setShowInteriorSketch] = useState(false);
  const [showModQueue, setShowModQueue] = useState(false);
  const [approvedLayout, setApprovedLayout] = useState(null);
  const [interactKind, setInteractKind] = useState(null);
  const [questHud, setQuestHud] = useState(null);
  const questHudVersionRef = useRef(-1);
  const [roomPopulation, setRoomPopulation] = useState(1);
  const [cameraMode, setCameraMode] = useState('wide-follow');
  const [currentFloor, setCurrentFloor] = useState(0);
  const [totalFloors, setTotalFloors] = useState(1);
  const [stairScaffoldActive, setStairScaffoldActive] = useState(false);
  const [openShelf, setOpenShelf] = useState(null);
  const [openJukebox, setOpenJukebox] = useState(null);
  const [openPuzzle, setOpenPuzzle] = useState(false);
  const [openInventory, setOpenInventory] = useState(false);
  const [openNoticeBoard, setOpenNoticeBoard] = useState(false);
  // Mailbox v1 (`sq-mailbox-v1`): the mailbox overlay + how many
  // unread packages are waiting (the envelope dot on the 🎒 button).
  const [openMailbox, setOpenMailbox] = useState(false);
  const [mailUnread, setMailUnread] = useState(0);
  // Decoration Shop v1 (`sq-dec-shop-v1`): the Agora coffee-bar shop.
  const [openDecorShop, setOpenDecorShop] = useState(false);
  // Your Place v1: the storage chest panel, opened from the chest
  // in your home room (E key / click / interact button).
  const [openHomeStorage, setOpenHomeStorage] = useState(false);
  // Quest badges v1: another player's badges panel, opened by
  // clicking them ({ socketId } or null).
  const [openPlayerBadges, setOpenPlayerBadges] = useState(null);
  const [inventoryCount, setInventoryCount] = useState(null); // "n/cap" for the bottom-left button badge

  // Refresh coin balance when jukebox closes or every 5s
  useEffect(() => {
    if (!openJukebox) setCoinBalance(getCoins());
  }, [openJukebox]);
  useEffect(() => {
    const t = setInterval(() => setCoinBalance(getCoins()), 5000);
    return () => clearInterval(t);
  }, []);
  // Poll the scene for what the interact button should do (mobile E key)
  useEffect(() => {
    const t = setInterval(() => {
      try {
        const scene = gameRef.current?.scene?.getScene('VillageScene');
        setInteractKind(scene?.getInteractKind ? scene.getInteractKind() : null);
      } catch { setInteractKind(null); }
    }, 1000);
    return () => clearInterval(t);
  }, []);
  // Poll the inventory badge (bottom-left 🎒 button count, "n/cap").
  // Mailbox v1 (`sq-mailbox-v1`): the same poll reads the unread
  // mail count, so the envelope dot on the 🎒 button appears the
  // moment mail arrives and clears when it is collected.
  useEffect(() => {
    const t = setInterval(() => {
      try {
        const scene = gameRef.current?.scene?.getScene('VillageScene');
        const st = scene?.itemsSystem?.getState ? scene.itemsSystem.getState() : null;
        if (st) {
          setInventoryCount(`${st.count}/${st.capacity}`);
          setMailUnread(Number(st.mailUnread) || 0);
        } else if (inventoryCount !== null) setInventoryCount(null);
      } catch { /* scene not ready yet */ }
    }, 1000);
    return () => clearInterval(t);
  }, []);
  // Poll the quest HUD (tracker/banner/toast as DOM, below the top bar).
  // The in-canvas quest text sits underneath the DOM top bar on PC, so
  // the DOM is the only render path that can actually be seen. The
  // manager bumps `version` on every change; only re-render then.
  useEffect(() => {
    const t = setInterval(() => {
      try {
        const scene = gameRef.current?.scene?.getScene('VillageScene');
        const hud = scene?.questManager?.getHudState ? scene.questManager.getHudState() : null;
        if (!hud) {
          if (questHudVersionRef.current !== -1) { questHudVersionRef.current = -1; setQuestHud(null); }
          return;
        }
        if (hud.version !== questHudVersionRef.current) {
          questHudVersionRef.current = hud.version;
          setQuestHud(hud);
        }
      } catch { /* scene not ready yet */ }
    }, 500);
    return () => clearInterval(t);
  }, []);

  const dismissQuestBanner = () => {
    try {
      const scene = gameRef.current?.scene?.getScene('VillageScene');
      if (scene?.questManager?.dismissBanner) scene.questManager.dismissBanner();
    } catch {}
  };

  const triggerInteract = () => {
    try {
      const scene = gameRef.current?.scene?.getScene('VillageScene');
      if (scene?.triggerInteract) {
        scene.triggerInteract();
        // Refresh the icon right away
        setInteractKind(scene.getInteractKind ? scene.getInteractKind() : null);
      }
    } catch {}
  };

  // Mobile interact button: one icon + label per kind. Before this,
  // only 'ducks'/'shelf'/'jukebox' had icons, so petting the cat
  // showed a 🎵 "Open the jukebox" button — the phone's only pet path
  // looked like the wrong action.
  const INTERACT_META = {
    duck: ['🦆', 'Pet the duck'],
    ducks: ['🦆', 'Feed the ducks'],
    cat: ['🐱', 'Pet the cat'],
    'cat-asleep': ['💤', 'Cat is asleep'],
    key: ['🔑', 'Pick up the golden key'],
    'puzzle-table': ['🧩', 'Open the puzzle table'],
    'notice-board': ['📌', 'Read the notice board'],
    // Mailbox v1 (`sq-mailbox-v1`): open your mailbox at the park.
    mailbox: ['📬', 'Open your mailbox'],
    'storage-chest': ['📦', 'Open your storage chest'],
    'floor-item': ['🎒', 'Pick up'],
    shelf: ['📚', 'Browse the shelf'],
    jukebox: ['🎵', 'Open the jukebox'],
    bar: ['🍺', 'Order a drink'],
  };
  const interactMeta = INTERACT_META[interactKind] || ['✦', 'Interact'];
  const [eventClock, setEventClock] = useState(() => Date.now());
  const roomId = canonicalRoomId(room);
  const venueEvents = providedVenueEvents.length
    ? providedVenueEvents
    : getVenueEvents(roomId, new Date(eventClock));
  const featuredEvent = venueEvents[0] || null;
  const isMcDonaldsRoom = roomId.includes('mcdonald') || normalizePlaceText(room?.name || '').includes('mcdonald');
  const normalizedAmenity = inferAmenityTag(room);
  const normalizedRoom = {
    ...(room || {}),
    amenity: normalizedAmenity,
  };
  const knownRoomFootprint = resolveKnownRoomFootprint(normalizedRoom);
  const localRadiusFallbackFootprint = createLocalRadiusFallbackFootprint(normalizedRoom);
  const decahedronMcDonaldsFootprint = isMcDonaldsRoom ? createDecahedronRoomFootprint(normalizedRoom) : null;
  const baseRoomFootprint = Array.isArray(normalizedRoom?.footprint)
    ? normalizedRoom.footprint
    : Array.isArray(normalizedRoom?.roomShape)
      ? normalizedRoom.roomShape
      : Array.isArray(decahedronMcDonaldsFootprint)
        ? decahedronMcDonaldsFootprint
      : Array.isArray(knownRoomFootprint)
        ? knownRoomFootprint
        : localRadiusFallbackFootprint;
  const roomFootprint = baseRoomFootprint;
  const footprintKey = Array.isArray(roomFootprint)
    ? roomFootprint
        .map((point) => `${Number(point?.lat ?? point?.y ?? 0).toFixed(5)}:${Number(point?.lng ?? point?.lon ?? point?.x ?? 0).toFixed(5)}`)
        .join('|')
    : '';
  const indoorLayoutKey = normalizedRoom?.indoorLayout
    ? `${normalizedRoom.indoorLayout.id || ''}:${normalizedRoom.indoorLayout.floors?.length || 0}:${(normalizedRoom.indoorLayout.floors || []).map((floor) => floor?.zones?.length || 0).join(',')}`
    : '';
  const seedRoomMeta = ROOMS.find((candidate) => candidate?.id === roomId) || null;
  const roomSignature = [
    roomId,
    normalizedRoom?.name || '',
    normalizedRoom?.amenity || '',
    normalizedRoom?.shop || '',
    String(
      normalizedRoom?.tags?.['building:levels']
      ?? normalizedRoom?.buildingLevels
      ?? normalizedRoom?.levels
      ?? seedRoomMeta?.tags?.['building:levels']
      ?? seedRoomMeta?.buildingLevels
      ?? seedRoomMeta?.levels
      ?? 1
    ),
    footprintKey,
    indoorLayoutKey,
  ].join('::');
  const indoorSource = String(normalizedRoom?.osmIndoorSource || '').toLowerCase();
  const indoorSourceIsLive = indoorSource.startsWith('live-overpass');
  const initialFootprintSource = normalizedRoom?.footprintSource
    || (Array.isArray(normalizedRoom?.footprint)
      ? 'room-footprint'
      : Array.isArray(normalizedRoom?.roomShape)
        ? 'room-shape-seed'
        : Array.isArray(knownRoomFootprint)
          ? 'known-override'
          : Array.isArray(localRadiusFallbackFootprint)
            ? 'radius-fallback-local'
          : 'none');
  const footprintSource = (indoorSourceIsLive && (initialFootprintSource === 'radius-fallback' || initialFootprintSource === 'radius-fallback-local' || initialFootprintSource === 'none'))
    ? 'indoor-derived'
    : initialFootprintSource;
  const footprintSourceLabel = {
    'authoritative-footprint': 'authoritative footprint',
    'indoor-derived': 'indoor-derived live',
    'known-override': 'known override',
    'provider-footprint': 'provider footprint',
    'radius-fallback': 'radius fallback',
    'radius-fallback-local': 'radius fallback',
    'room-footprint': 'room footprint',
    'room-shape-seed': 'seed room shape',
    none: 'none',
  }[footprintSource] || footprintSource;

  const roomDescriptor = [normalizedRoom?.id || '', normalizedRoom?.name || '', normalizedRoom?.amenity || '', normalizedRoom?.shop || '']
    .join(' ')
    .toLowerCase();
  const roomBuildingLevels = Number.parseInt(String(
    normalizedRoom?.tags?.['building:levels']
    ?? normalizedRoom?.['building:levels']
    ?? normalizedRoom?.buildingLevels
    ?? normalizedRoom?.levels
    ?? seedRoomMeta?.tags?.['building:levels']
    ?? seedRoomMeta?.['building:levels']
    ?? seedRoomMeta?.buildingLevels
    ?? seedRoomMeta?.levels
    ?? '1'
  ), 10);
  const isCoffeeVenue = roomDescriptor.includes('starbucks')
    || roomDescriptor.includes('coffee')
    || normalizedRoom?.amenity === 'cafe'
    || normalizedRoom?.shop === 'coffee';
  const forceBookstoreLayout = roomDescriptor.includes('barnes')
    || roomDescriptor.includes('noble')
    || roomDescriptor.includes('bookstore')
    || normalizedRoom?.amenity === 'books'
    || normalizedRoom?.shop === 'books';
  const isAndersonLibraryRoom = roomDescriptor.includes('md anderson')
    || roomDescriptor.includes('anderson library')
    || (Math.abs(Number(normalizedRoom?.lat) - 29.7218) < 0.002
      && Math.abs(Number(normalizedRoom?.lng) - (-95.3420)) < 0.002);
  const forceLibraryLayout = isAndersonLibraryRoom
    || roomDescriptor.includes('library')
    || roomId === 'md-anderson-library'
    || seedRoomMeta?.id === 'md-anderson-library'
    || normalizedRoom?.amenity === 'library'
    || normalizedRoom?.tags?.amenity === 'library'
    || normalizedRoom?.shop === 'library';
  // Agora: use the furnished big-space layout (layouts/agora.js) instead
  // of the auto-generated two-level scaffold its building:levels=2
  // would otherwise force. An approved user layout still wins (see
  // explicitLayout below), as with every other room.
  const forceAgoraLayout = roomId === 'agora-houston' || roomDescriptor.includes('agora');
  // Your Place: use the furnished home layout (layouts/home.js) for
  // `home-<owner>` room ids, instead of the auto-generated scaffold.
  // An approved user layout still wins (see explicitLayout below),
  // as with every other room.
  const forceHomeLayout = isHomeRoom(roomId);
  const preferUltraClose = roomDescriptor.includes('agora');
  const preferredCameraMode = preferUltraClose
    ? 'ultra-close-follow'
    : (isCoffeeVenue ? 'close-follow' : 'wide-follow');

  const zoomLabel = cameraMode === 'overview'
    ? 'Overview'
    : cameraMode === 'ultra-close-follow'
      ? 'Ultra'
    : cameraMode === 'close-follow'
      ? 'Close'
    : cameraMode === 'wide-follow'
      ? 'Wide'
      : 'Follow';
  const outdoorMode = !forceBookstoreLayout
    && isOutdoorLocation(normalizedRoom?.id || '', normalizedRoom?.name || '', normalizedRoom?.amenity || '', normalizedRoom?.shop || '');
  const shouldForceMultiLevelScaffold = !outdoorMode
    && !forceBookstoreLayout
    && Number.isFinite(roomBuildingLevels)
    && roomBuildingLevels >= 2;
  const roomModeLabel = outdoorMode ? 'outdoor' : 'indoor';
  const buildStampLabel = formatDebugStamp(import.meta.env.VITE_BUILD_STAMP);
  const runtimeStampLabel = formatDebugStamp(RUNTIME_SESSION_STAMP);
  const discoveryStatus = String(room?.poiDiscoveryStatus || 'unknown');
  const osmContextStatus = String(normalizedRoom?.osmContextStatus || 'unknown');
  const osmContextSource = String(normalizedRoom?.osmContextSource || 'unknown');
  const osmStrictMode = Boolean(normalizedRoom?.osmStrictMode);
  const osmStrictBlocked = Boolean(normalizedRoom?.osmStrictBlocked);
  const paletteProfile = String(normalizedRoom?.paletteProfile || 'unknown');
  const paletteDiagnostics = normalizedRoom?.paletteDiagnostics || null;
  const paletteFinal = paletteDiagnostics?.final || null;
  const paletteScores = Array.isArray(paletteDiagnostics?.scores) ? paletteDiagnostics.scores : [];
  const paletteTransition = Array.isArray(normalizedRoom?.osmPaletteTransition) ? normalizedRoom.osmPaletteTransition : [];
  const nearbyDiscovering = room?.poiDiscoveryPending === true || discoveryStatus === 'loading';
  const footprintFallbackWarning = footprintSource === 'radius-fallback' || footprintSource === 'radius-fallback-local';
  const osmMissingWarning = !['ready', 'partial', 'loading', 'skipped'].includes(osmContextStatus);
  const debugHasWarning = footprintFallbackWarning || nearbyDiscovering || osmMissingWarning || osmStrictBlocked;
  const debugBadgeStyle = debugHasWarning
    ? {
        background: '#450a0ae6',
        border: '1px solid #ef4444',
        color: '#fee2e2',
      }
    : {
        background: '#020617e6',
        border: '1px solid #1d4ed8',
        color: '#bfdbfe',
      };
  const debugTitleColor = debugHasWarning ? '#fca5a5' : '#93c5fd';
  const debugWarnings = [
    footprintFallbackWarning ? 'fallback-boundary' : null,
    nearbyDiscovering ? 'nearby-loading' : null,
    osmMissingWarning ? 'osm-context-missing' : null,
    osmStrictBlocked ? 'osm-strict-blocked' : null,
  ].filter(Boolean);
  const debugSnapshotText = JSON.stringify({
    build: buildStampLabel,
    session: runtimeStampLabel,
    room: roomId || 'unknown',
    mode: roomModeLabel,
    floor: `${Math.max(1, currentFloor + 1)}/${Math.max(1, totalFloors)}`,
    stair_scaffold: stairScaffoldActive ? 'active' : 'none',
    footprint: footprintSourceLabel,
    osm_context: `${osmContextStatus}:${osmContextSource}`,
    osm_strict: osmStrictMode ? (osmStrictBlocked ? 'blocked' : 'ready') : 'off',
    palette_profile: paletteProfile,
    palette_final_hsl: paletteFinal ? `${paletteFinal.hue}/${paletteFinal.saturation}/${paletteFinal.lightness}` : 'unknown',
    palette_scores: paletteScores.slice(0, 4),
    palette_transition: paletteTransition.slice(-4),
    nearby_api: discoveryStatus,
    warnings: debugWarnings.length ? debugWarnings : ['none'],
    time: new Date().toISOString(),
  }, null, 2);

  useEffect(() => {
    window.__chatInputFocused = false;
    return () => { window.__chatInputFocused = false; };
  }, []);

  useEffect(() => {
    setShowEditHint(true);
    const timer = setTimeout(() => setShowEditHint(false), 7000);
    return () => clearTimeout(timer);
  }, [roomSignature]);

  useEffect(() => {
    setCameraMode(preferredCameraMode);
  }, [roomSignature]);

  // Fetch the room's approved user-designed layout (if any).
  useEffect(() => {
    let cancelled = false;
    setApprovedLayout(null);
    if (!roomId) return undefined;
    fetchApprovedLayout(roomId)
      .then((rec) => {
        if (cancelled || !rec) return;
        const layout = approvedToLayout(rec, roomId, normalizedRoom?.name);
        if (layout) {
          console.log('[VillageCanvas] using approved layout for', roomId);
          setApprovedLayout(layout);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [roomId]);

  useEffect(() => {
    setEventClock(Date.now());
    const timer = setInterval(() => setEventClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [roomSignature]);

  useEffect(() => {
    if (!containerRef.current || !roomId) return;

    // Defensive cleanup: if a previous scene leaked UI, clear it before mounting.
    document.querySelectorAll('[data-sidequest-editor-panel="true"]').forEach((panel) => panel.remove());
    if (gameRef.current) {
      try {
        gameRef.current.destroy(true);
      } catch {}
      gameRef.current = null;
    }

    const el = containerRef.current;
    // Dev-mode remounts can leave stale canvases behind; reset container before creating a game.
    el.innerHTML = '';
    const explicitLayout = approvedLayout
      || (forceHomeLayout
        ? home
        : forceLibraryLayout
          ? library
          : forceBookstoreLayout
            ? bookstore
            : forceAgoraLayout
              ? agora
              : (outdoorMode || shouldForceMultiLevelScaffold
                ? buildAutoLayout(roomId, normalizedRoom?.name || '', normalizedRoom?.amenity || '', normalizedRoom?.shop || '', roomFootprint || null, normalizedRoom)
                : null));

    VillageScene._boot = {
      roomId,
      roomName:   normalizedRoom?.name   || '',
      roomOwnerId: normalizedRoom?.ownerId || '',
      amenityTag: normalizedRoom?.amenity || '',
      shopTag:    normalizedRoom?.shop    || '',
      roomShape:  roomFootprint,
      roomData: normalizedRoom,
      explicitLayout,
      profile,
      canManageVenue,
      // Decoration Shop v1: the scene needs to know moderators (they
      // can take down any placed decoration) and how to open the shop.
      isModerator,
      userLocation: location || null,
      onLeave,
      preferredCameraMode,
      onEditorChange: setEditorActive,
      onNearbyChange: setNearbyCount,
      onOpenShelf: (info) => setOpenShelf(info),
      onOpenJukebox: (info) => setOpenJukebox(info),
      onOpenPuzzle: () => setOpenPuzzle(true),
      onOpenInventory: () => setOpenInventory(true),
      onOpenNoticeBoard: () => setOpenNoticeBoard(true),
      // Mailbox v1 (`sq-mailbox-v1`): opens the mailbox overlay.
      onOpenMailbox: () => setOpenMailbox(true),
      // Mailbox v1 (`sq-mailbox-v1`): every room the app knows
      // about (featured + user-created), so the scene can find the
      // player's nearest park room (their mailbox room).
      allRooms: getAllRooms(),
      onOpenHomeStorage: () => setOpenHomeStorage(true),
      // Decoration Shop v1: opens the coffee-bar shop panel (DOM).
      onOpenDecorShop: () => setOpenDecorShop(true),
      onOpenPlayerBadges: (info) => setOpenPlayerBadges(info),
      onNearbyNpcChange: setNearbyNpc,
      onNpcConversationClear: ({ npcId } = {}) => {
        setMessages((prev) => prev.filter((msg) => msg.channel !== 'npc' || msg.npcId !== npcId));
        setDraft('');
        setChatRecipient('players');
      },
      onRoomPopulationChange: (count) => {
        setRoomPopulation(Math.max(0, Number(count) || 0));
      },
      onFloorStatusChange: (status = {}) => {
        const nextFloor = Math.max(0, Number(status.currentFloor) || 0);
        const nextTotal = Math.max(1, Number(status.totalFloors) || 1);
        const scaffoldOn = Boolean(status.stairScaffoldActive);

        setCurrentFloor(nextFloor);
        setTotalFloors(nextTotal);
        setStairScaffoldActive(scaffoldOn);
      },
      onChatMessage: (msg) => {
        setMessages((prev) => [...prev.slice(-9), msg]);
      },
      onSystemNotice: (message) => {
        if (!message) return;
        setSystemNotice(message);
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = setTimeout(() => setSystemNotice(''), 2600);
      },
    };

    const config = {
      // Canvas renderer is more reliable than WebGL in constrained embedded browsers.
      type: Phaser.CANVAS,
      parent: el,
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
      backgroundColor: '#0f172a',
      scene: VillageScene,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
      setEditorActive(false);
      setNearbyCount(0);
      setMessages([]);
      setDraft('');
      setSystemNotice('');
      setRoomPopulation(1);
      setCameraMode('wide-follow');
      setCurrentFloor(0);
      setTotalFloors(1);
      setStairScaffoldActive(false);
    };
  }, [roomSignature, roomId, outdoorMode, forceBookstoreLayout, forceLibraryLayout, forceAgoraLayout, forceHomeLayout, preferredCameraMode, shouldForceMultiLevelScaffold, approvedLayout]);

  const toggleEditor = () => {
    const scene = gameRef.current?.scene?.getScene('VillageScene');
    if (scene?.sys?.isActive()) {
      scene.toggleEditor?.();
      setShowEditHint(false);
    }
  };

  const sendChat = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const scene = gameRef.current?.scene?.getScene('VillageScene');
    if (scene?.sys?.isActive()) {
      const recipient = nearbyNpc && (chatRecipient === 'npc' || nearbyCount === 0) ? 'npc' : chatRecipient;
      scene.sendChatMessage?.(text, recipient);
      setDraft('');
    }
  };

  useEffect(() => {
    if (nearbyNpc && nearbyCount === 0) setChatRecipient('npc');
    if (!nearbyNpc && chatRecipient === 'npc') setChatRecipient('players');
  }, [nearbyNpc, nearbyCount, chatRecipient]);

  const toggleZoom = () => {
    const scene = gameRef.current?.scene?.getScene('VillageScene');
    if (!scene?.sys?.isActive()) return;
    const nextMode = scene.toggleCameraMode?.();
    if (nextMode) setCameraMode(nextMode);
  };

  const copyDebugSnapshot = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(debugSnapshotText);
      } else {
        throw new Error('Clipboard API unavailable');
      }
      setSystemNotice('Debug snapshot copied');
    } catch {
      setSystemNotice('Copy failed: clipboard not available');
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {openShelf && (
        <ShelfPanel
          roomId={roomId}
          shelf={openShelf.shelf}
          onClose={() => setOpenShelf(null)}
          getSocket={() => gameRef.current?.scene?.getScene('VillageScene')?.socket}
        />
      )}
      {showModQueue && (
        <ModQueuePanel
          onClose={() => setShowModQueue(false)}
          actorId={profile?.profile?.email || profile?.mode || 'guest'}
        />
      )}
      {showInteriorSketch && (
        <InteriorSketchModal
          roomName={room?.name || roomId}
          onClose={() => setShowInteriorSketch(false)}
          onSubmit={(layout) => {
            const payload = {
              roomId,
              roomName: room?.name || roomId,
              submitter: profile?.profile?.email || profile?.mode || 'guest',
              submitterName: profile?.profile?.characterName || profile?.profile?.firstName || 'Someone',
              layout,
            };
            fetch(`${BACKEND_URL}/api/layout-submissions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }).catch(() => {
              // Offline fallback: stash locally so nothing is lost.
              try {
                const k = 'location-chat-pending-layouts';
                const pending = JSON.parse(localStorage.getItem(k) || '[]');
                pending.push({ ...layout, ...payload, submittedAt: new Date().toISOString(), status: 'pending' });
                localStorage.setItem(k, JSON.stringify(pending));
              } catch {}
            });
            setShowInteriorSketch(false);
          }}
        />
      )}
      {openJukebox && (
        <JukeboxPanel
          roomId={roomId}
          onClose={() => setOpenJukebox(null)}
          getSocket={() => gameRef.current?.scene?.getScene('VillageScene')?.socket}
        />
      )}
      {openPuzzle && (
        <PuzzleBoard
          getBoardState={() => gameRef.current?.scene?.getScene('VillageScene')?.puzzleQuest?.getBoardState?.()}
          onPlace={(pieceId, col, row) => {
            const scene = gameRef.current?.scene?.getScene('VillageScene');
            return scene?.puzzleQuest?.placePiece?.(pieceId, col, row) || { ok: false, reason: 'error' };
          }}
          onClose={() => setOpenPuzzle(false)}
        />
      )}
      {openInventory && (
        <InventoryPanel
          getState={() => gameRef.current?.scene?.getScene('VillageScene')?.itemsSystem?.getState?.()}
          getBadges={() => gameRef.current?.scene?.getScene('VillageScene')?.questManager?.getCompletions?.() || []}
          onUse={(id) => gameRef.current?.scene?.getScene('VillageScene')?.itemsSystem?.useItem?.(id) || { ok: false, reason: 'error' }}
          onDrop={(id) => {
            // Drop on the home floor v1 (`sq-home-drop-v1`): in your
            // OWN home room, Drop puts a PERSISTED item on the floor
            // (homeStorageSystem — server-backed, survives restarts).
            // Anywhere else, Drop is the session-only litter from
            // ItemsSystem, as before.
            const scene = gameRef.current?.scene?.getScene('VillageScene');
            const home = scene?.homeStorageSystem;
            if (home?.enabled) return home.dropItem?.(id) || { ok: false, reason: 'error' };
            return scene?.itemsSystem?.dropItem?.(id) || { ok: false, reason: 'error' };
          }}
          onDispose={(id) => gameRef.current?.scene?.getScene('VillageScene')?.itemsSystem?.disposeTrash?.(id) || { ok: false, reason: 'error' }}
          onBuyBag={() => gameRef.current?.scene?.getScene('VillageScene')?.itemsSystem?.buyBag?.() || { ok: false, reason: 'error' }}
          onMakeFlyer={(title, text) => gameRef.current?.scene?.getScene('VillageScene')?.itemsSystem?.makeFlyer?.(title, text) || { ok: false, reason: 'error' }}
          onPinFlyer={(id) => gameRef.current?.scene?.getScene('VillageScene')?.itemsSystem?.pinFlyerToBoard?.(id) || { ok: false, reason: 'error' }}
          onPlaceDecoration={(id) => gameRef.current?.scene?.getScene('VillageScene')?.decorSystem?.placeDecoration?.(id) || { ok: false, reason: 'error' }}
          onPutHatOnCat={(id) => gameRef.current?.scene?.getScene('VillageScene')?.santaHatSystem?.placeOnCat?.(id) || { ok: false, reason: 'error' }}
          // Mailbox v1 (`sq-mailbox-v1`): send a pocket item to the
          // player with this mailbox code — it leaves the pocket
          // only when the server confirms the send.
          onSendMail={(id, code) => gameRef.current?.scene?.getScene('VillageScene')?.itemsSystem?.sendMail?.(id, code) || { ok: false, reason: 'error' }}
          // Mailbox v1.1 (`sq-mailbox-v1.1`): "Go to my mailbox" —
          // close the pocket, then enter the mailbox room through
          // the app-level entry (onEnterRoom, wired in app.jsx to
          // openFeaturedRoomDirect — the same path as tapping the
          // room's pin on the map, GPS gates included).
          onGoToMailboxRoom={(roomId, roomName) => goToMailboxRoom({ closePanel: () => setOpenInventory(false), onEnterRoom, roomId, roomName })}
          onOpenPuzzle={() => { setOpenInventory(false); setOpenPuzzle(true); }}
          onClose={() => { setOpenInventory(false); setCoinBalance(getCoins()); }}
        />
      )}
      {openNoticeBoard && (
        <NoticeBoardPanel
          getState={() => gameRef.current?.scene?.getScene('VillageScene')?.noticeBoardSystem?.getState?.()}
          onRemove={(flyerId) => gameRef.current?.scene?.getScene('VillageScene')?.noticeBoardSystem?.removeFlyer?.(flyerId) || { ok: false, reason: 'error' }}
          isModerator={isModerator}
          onClose={() => setOpenNoticeBoard(false)}
        />
      )}
      {/* Mailbox v1 (`sq-mailbox-v1`): your packages at your nearest
          park (or the nearest public place when no park is close).
          Take asks the server first — a full pocket refuses and the
          package stays in the mailbox. */}
      {openMailbox && (
        <MailboxPanel
          getState={() => gameRef.current?.scene?.getScene('VillageScene')?.itemsSystem?.getState?.()}
          onCollect={(packageId) => gameRef.current?.scene?.getScene('VillageScene')?.mailSystem?.collectPackage?.(packageId) || { ok: false, reason: 'error' }}
          onCollectAll={() => gameRef.current?.scene?.getScene('VillageScene')?.mailSystem?.collectAll?.() || { ok: false, reason: 'error' }}
          onClose={() => setOpenMailbox(false)}
        />
      )}
      {openHomeStorage && (
        <HomeStoragePanel
          getState={() => gameRef.current?.scene?.getScene('VillageScene')?.homeStorageSystem?.getState?.()}
          onStore={(id) => gameRef.current?.scene?.getScene('VillageScene')?.homeStorageSystem?.storeItem?.(id) || { ok: false, reason: 'error' }}
          onTake={(id) => gameRef.current?.scene?.getScene('VillageScene')?.homeStorageSystem?.takeItem?.(id) || { ok: false, reason: 'error' }}
          onUnloadAll={() => gameRef.current?.scene?.getScene('VillageScene')?.homeStorageSystem?.unloadAll?.() || { ok: false, reason: 'error' }}
          onClose={() => setOpenHomeStorage(false)}
        />
      )}
      {openDecorShop && (
        <DecorShopPanel
          getState={() => gameRef.current?.scene?.getScene('VillageScene')?.decorSystem?.getShopState?.()}
          onBuyCoffee={() => gameRef.current?.scene?.getScene('VillageScene')?.buyCoffeeFromShop?.() || { ok: false, reason: 'error' }}
          onBuyDecoration={(kind) => gameRef.current?.scene?.getScene('VillageScene')?.decorSystem?.buyDecoration?.(kind) || { ok: false, reason: 'error' }}
          onClose={() => setOpenDecorShop(false)}
        />
      )}
      {openPlayerBadges && (
        <PlayerBadgesPanel
          getState={() => gameRef.current?.scene?.getScene('VillageScene')?.getPlayerBadges?.(openPlayerBadges.socketId)}
          onClose={() => setOpenPlayerBadges(null)}
        />
      )}
      {showEditHint && (
        <div style={{
          position: 'absolute',
          top: 116,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1001,
          pointerEvents: 'none',
          background: '#0f172aee',
          border: '1px solid #334155',
          borderRadius: 8,
          padding: '8px 12px',
          color: '#e2e8f0',
          fontFamily: 'Courier New, monospace',
          fontSize: 12,
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        }}>
          {outdoorMode ? 'Outdoor Edit Mode' : 'Edit Mode'}: press <strong>~</strong> to toggle
        </div>
      )}
      {systemNotice && (
        <div style={{
          position: 'absolute',
          top: 116,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1002,
          background: '#7f1d1dcc',
          border: '1px solid #ef4444',
          borderRadius: 8,
          padding: '8px 12px',
          color: '#fee2e2',
          fontFamily: 'Courier New, monospace',
          fontSize: 12,
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        }}>
          {systemNotice}
        </div>
      )}
      {featuredEvent && (
        <div style={{
          position: 'absolute',
          top: 116,
          left: 12,
          zIndex: 1000,
          width: 'min(320px, calc(100vw - 24px))',
          boxSizing: 'border-box',
          background: featuredEvent.status === 'active' ? '#3f2f16ee' : '#0f172add',
          border: `1px solid ${featuredEvent.status === 'active' ? '#fbbf24' : '#64748b'}`,
          borderRadius: 8,
          padding: '9px 11px',
          color: '#f8fafc',
          fontFamily: 'Courier New, monospace',
          boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
        }}>
          <div style={{ color: featuredEvent.status === 'active' ? '#fbbf24' : '#cbd5e1', fontSize: 10, fontWeight: 'bold', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {featuredEvent.status === 'active' ? 'Happening Here' : 'Coming Here'}
          </div>
          <div style={{ marginTop: 3, fontSize: 14, fontWeight: 'bold' }}>{featuredEvent.title}</div>
          <div style={{ marginTop: 3, color: '#cbd5e1', fontSize: 11, lineHeight: 1.35 }}>{featuredEvent.description}</div>
        </div>
      )}
      <div style={{
        position: 'absolute',
        top: 12,
        left: 12,
        right: 116,
        zIndex: 1000,
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
        paddingBottom: 4,
      }}>
        {/* Leave rename v1 (sq-leave-rename-v1): the button says what it
            does now — "Return to map". Same onLeave, same spot, same style. */}
        <button
          onClick={onLeave}
          style={{
            background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            minHeight: 44,
            display: 'flex', alignItems: 'center',
            cursor: 'pointer',
            fontSize: 14,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          ← Return to map
        </button>
        {/* Two Places v1 (`sq-two-places-v1`): there is NO 🏠 Home
            button any more. Your places are real locations — you
            enter one from the map when you are next to it (GPS
            proximity, like any other place). The teleport home is
            gone entirely, so nothing here takes you to a place. */}
        <button
          onClick={toggleEditor}
          style={{
            background: editorActive ? '#fbbf24' : 'rgba(0,0,0,0.55)',
            color: editorActive ? '#000' : '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            minHeight: 44,
            display: 'flex', alignItems: 'center',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 'bold',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {editorActive ? 'Done' : (outdoorMode ? 'Outdoor Edit' : 'Edit')}
        </button>
        <button
          onClick={() => setShowInteriorSketch(true)}
          title="Sketch the interior layout of this place"
          style={{
            background: 'rgba(0,0,0,0.55)', color: '#35e0ff',
            border: '2px solid #35e0ff',
            borderRadius: 8, padding: '6px 14px',
            fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
            minHeight: 44, display: 'flex', alignItems: 'center', flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          🏠 Build layout
        </button>
        <button
          onClick={toggleZoom}
          style={{
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            minHeight: 44,
            display: 'flex', alignItems: 'center',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 'bold',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          Zoom: {zoomLabel}
        </button>
        <div
          title="Your coins — earn 10 daily, 5 for new places"
          style={{
            background: 'rgba(0,0,0,0.55)', color: '#ffb02e',
            borderRadius: 8, padding: '6px 14px',
            fontSize: 14, fontWeight: 'bold',
            display: 'flex', alignItems: 'center', gap: 4,
            minHeight: 44, flexShrink: 0,
          }}
        >
          🪙 {coinBalance}
        </div>
        {isModerator && (
        <button
          onClick={() => setShowModQueue(true)}
          title="Review pending layout submissions"
          style={{
            background: 'rgba(0,0,0,0.55)', color: '#ffb02e',
            border: '2px solid #ffb02e',
            borderRadius: 8, padding: '6px 14px',
            fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
            minHeight: 44, display: 'flex', alignItems: 'center', flexShrink: 0,
          }}
        >
          📋 Review
        </button>
        )}
      </div>

      {/* Quest HUD as DOM, below the top bar: the in-canvas tracker and
          banner sit underneath the DOM top bar on PC (zIndex 1000) and
          can't be seen, so the DOM is the render path. Tracker is
          persistent; banner shows ~5.5s per quest (click dismisses). */}
      {questHud?.trackerLines?.length > 0 && (
        <div style={{
          position: 'absolute', top: 116, left: 12, zIndex: 1000,
          maxWidth: 'min(340px, calc(100vw - 24px))',
          background: 'rgba(255,255,255,0.92)', color: '#1a4971',
          borderRadius: 8, padding: '8px 10px', fontSize: 14, lineHeight: 1.35,
          pointerEvents: 'none', whiteSpace: 'pre-line',
          boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
        }}>
          {questHud.trackerSections ? (
            <>
              <div style={{ whiteSpace: 'pre-line' }}>
                {questHud.trackerSections.room.length > 0 ? questHud.trackerSections.room.join('\n') : '✅ All quests complete — more coming soon!'}
              </div>
              {/* Onboarding v1 (`sq-onboarding-v1`): the First Steps
                  nudge, inside the tracker box so it can never
                  overlap it — visible only while First Steps is the
                  active quest and unfinished (QuestManager clears it
                  the moment the quest completes). */}
              {questHud.stepPrompt && (
                <div style={{
                  marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(146,64,14,0.35)',
                  color: '#92400e', fontWeight: 'bold', whiteSpace: 'pre-line',
                }}>
                  {questHud.stepPrompt}
                </div>
              )}
              {questHud.trackerSections.anywhere.length > 0 && (
                <div style={{
                  marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(26,73,113,0.3)',
                  fontSize: 12.5, lineHeight: 1.35, color: '#3d6a8a', whiteSpace: 'pre-line',
                }}>
                  <div style={{ fontWeight: 'bold', fontSize: 12, letterSpacing: '0.04em', color: '#1a4971' }}>🌍 ANYWHERE QUESTS</div>
                  {questHud.trackerSections.anywhere.join('\n')}
                </div>
              )}
            </>
          ) : (
            questHud.trackerLines.join('\n')
          )}
        </div>
      )}
      {questHud?.banner && (
        <div
          onClick={dismissQuestBanner}
          title="Click to dismiss"
          style={{
            position: 'absolute', top: 116, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1001, width: 'min(360px, calc(100vw - 24px))',
            background: 'rgba(255,255,255,0.95)', color: '#1a4971',
            borderRadius: 8, padding: '10px 14px', fontSize: 15, textAlign: 'center',
            cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
          }}
        >
          <div style={{ fontWeight: 'bold', fontSize: 16 }}>{questHud.banner.emoji} {questHud.banner.title}</div>
          <div>{questHud.banner.description}</div>
          {/* Onboarding v1: a 0-coin reward (First Steps) shows no
              reward line — never "Reward: +0 coins". */}
          {questHud.banner.rewardCoins > 0 && (<div>Reward: +{questHud.banner.rewardCoins} coins</div>)}
        </div>
      )}
      {questHud?.toast && (
        <div style={{
          position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%, -50%)',
          zIndex: 1001, background: 'rgba(255,255,255,0.94)', color: '#14532d',
          borderRadius: 8, padding: '10px 14px', fontSize: 16, fontWeight: 'bold',
          textAlign: 'center', pointerEvents: 'none',
          boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
        }}>
          {questHud.toast}
        </div>
      )}

      {import.meta.env.DEV && (
        <div style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          zIndex: 1000,
        }}>
          <button
            onClick={copyDebugSnapshot}
            style={{
              background: '#0f172acc',
              color: '#bfdbfe',
              border: '1px solid #1d4ed8',
              borderRadius: 8,
              padding: '6px 12px',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 'bold',
              fontFamily: 'Courier New, monospace',
            }}
          >
            Copy Debug Snapshot
          </button>
        </div>
      )}

      <div style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 1000,
        background: '#0f172acc',
        border: '1px solid #334155',
        borderRadius: 8,
        padding: '6px 10px',
        color: '#e2e8f0',
        fontFamily: 'Courier New, monospace',
        fontSize: 11,
        fontWeight: 'bold',
      }}>
        In room: {roomPopulation}
      </div>

      <div style={{
        position: 'absolute',
        top: 46,
        right: 12,
        zIndex: 1000,
        background: '#0f172acc',
        border: '1px solid #334155',
        borderRadius: 8,
        padding: '4px 8px',
        color: '#cbd5e1',
        fontFamily: 'Courier New, monospace',
        fontSize: 10,
      }}>
        Footprint: {footprintSourceLabel}
      </div>

      <div style={{
        position: 'absolute',
        top: 68,
        right: 12,
        zIndex: 1000,
        background: '#0f172acc',
        border: '1px solid #334155',
        borderRadius: 8,
        padding: '4px 8px',
        color: '#cbd5e1',
        fontFamily: 'Courier New, monospace',
        fontSize: 10,
      }}>
        Floor: {Math.max(1, currentFloor + 1)}/{Math.max(1, totalFloors)}
      </div>

      {stairScaffoldActive && (
        <div style={{
          position: 'absolute',
          top: 90,
          right: 12,
          zIndex: 1000,
          background: '#1f2937d9',
          border: '1px solid #22d3ee',
          borderRadius: 8,
          padding: '4px 8px',
          color: '#67e8f9',
          fontFamily: 'Courier New, monospace',
          fontSize: 10,
          fontWeight: 'bold',
        }}>
          Stair scaffold active
        </div>
      )}

      {osmStrictMode && (
        <div style={{
          position: 'absolute',
          top: stairScaffoldActive ? 114 : 96,
          right: 270,
          zIndex: 1000,
          background: osmStrictBlocked ? '#7f1d1dcc' : '#052e16cc',
          border: osmStrictBlocked ? '1px solid #ef4444' : '1px solid #22c55e',
          borderRadius: 8,
          padding: '4px 8px',
          color: osmStrictBlocked ? '#fecaca' : '#bbf7d0',
          fontFamily: 'Courier New, monospace',
          fontSize: 10,
          fontWeight: 'bold',
        }}>
          OSM Strict: {osmStrictBlocked ? 'BLOCKED' : 'READY'}
        </div>
      )}

      {/* Inventory button (Items + Inventory v1): BOTTOM LEFT, never the
          toolbar — the user said the toolbar already has too many
          things. Stacked above the round interact button (same left
          edge), always visible, with a n/capacity badge. Tapping it
          opens the pocket/bag popup (same feel as the puzzle board). */}
      <button
        onClick={() => setOpenInventory(true)}
        title={inventoryCount ? `Pocket — ${inventoryCount} items` : 'Pocket — look inside'}
        style={{
          position: 'absolute',
          left: 16,
          bottom: 104,
          zIndex: 1001,
          width: 68, height: 68,
          borderRadius: '50%',
          background: '#1a4971',
          border: '3px solid #e2b46c',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          fontSize: 30,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff',
        }}
      >
        🎒
        {inventoryCount && (
          <span style={{
            position: 'absolute', bottom: -4, right: -6,
            background: '#fbbf24', color: '#1a4971',
            borderRadius: 10, padding: '1px 6px',
            fontSize: 11, fontWeight: 'bold', lineHeight: 1.4,
            border: '2px solid #1a4971',
          }}>
            {inventoryCount}
          </span>
        )}
        {/* Mailbox v1 (`sq-mailbox-v1`): the envelope dot — up while
            you have unread mail, until you've collected it. */}
        {mailUnread > 0 && (
          <span
            title={`You’ve got mail (${mailUnread})! Open your mailbox at the park.`}
            style={{
              position: 'absolute', top: -4, right: -4,
              background: '#dc2626', color: '#fff',
              borderRadius: 10, padding: '1px 6px',
              fontSize: 12, fontWeight: 'bold', lineHeight: 1.4,
              border: '2px solid #fff',
            }}
          >
            ✉️
          </span>
        )}
      </button>
      {interactKind && (
        <button
          onClick={triggerInteract}
          title={interactMeta[1]}
          style={{
            position: 'absolute',
            left: 16,
            bottom: 24,
            zIndex: 1001,
            width: 68, height: 68,
            borderRadius: '50%',
            background: '#ffb02e',
            border: '3px solid #2b2b33',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            fontSize: 30,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {interactMeta[0]}
        </button>
      )}
      <div style={{
        position: 'absolute',
        right: 12,
        left: 'auto',
        bottom: 64,
        width: 'min(280px, calc(100vw - 24px))',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        maxHeight: '45vh',
        overflowY: 'visible',
        paddingBottom: 0,
      }}>
        <div style={{
          background: '#0f172acc',
          border: '1px solid #334155',
          borderRadius: 6,
          padding: '6px 10px',
          color: nearbyCount > 0 ? '#4ade80' : '#64748b',
          fontFamily: 'Courier New, monospace',
          fontSize: 11,
        }}>
          {nearbyNpc ? `Talk to ${nearbyNpc.name}` : nearbyCount > 0 ? `Chat unlocked: ${nearbyCount} nearby` : 'Approach someone to chat'}
        </div>

        {nearbyNpc && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => setChatRecipient('npc')} style={{ flex: 1, padding: '6px 8px', border: `1px solid ${chatRecipient === 'npc' ? '#e2b46c' : '#475569'}`, borderRadius: 6, background: chatRecipient === 'npc' ? '#3f2f16' : '#0f172acc', color: '#f8fafc', fontFamily: 'Courier New, monospace', fontSize: 11, cursor: 'pointer' }}>
              {nearbyNpc.name}
            </button>
            {nearbyCount > 0 && <button type="button" onClick={() => setChatRecipient('players')} style={{ flex: 1, padding: '6px 8px', border: `1px solid ${chatRecipient === 'players' ? '#e2b46c' : '#475569'}`, borderRadius: 6, background: chatRecipient === 'players' ? '#3f2f16' : '#0f172acc', color: '#f8fafc', fontFamily: 'Courier New, monospace', fontSize: 11, cursor: 'pointer' }}>People</button>}
          </div>
        )}

        {messages.length > 0 && (
          <div style={{
            maxHeight: '22vh',
            overflowY: 'auto',
            background: '#0f172acc',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '8px 10px',
            fontFamily: 'Courier New, monospace',
            fontSize: 11,
            color: '#f8fafc',
          }}>
            {messages.map((m, i) => (
              <div key={`${m.timestamp || i}-${i}`} style={{ marginBottom: 4 }}>
                <strong style={{ color: m.isSelf ? '#fbbf24' : '#93c5fd' }}>{m.isSelf ? 'You' : m.senderName}</strong>
                <span style={{ color: '#64748b', fontSize: 10 }}> ({m.distance}px)</span>: {m.message}
              </div>
            ))}
          </div>
        )}

        <form onSubmit={sendChat} style={{ display: 'flex', gap: 6, position: 'sticky', bottom: 0, background: 'linear-gradient(180deg, rgba(15,23,42,0.25) 0%, rgba(15,23,42,0.92) 60%)', paddingTop: 4 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => { window.__chatInputFocused = true; }}
            onBlur={() => { window.__chatInputFocused = false; }}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
            placeholder={nearbyNpc && chatRecipient === 'npc' ? `Ask ${nearbyNpc.name} about books...` : nearbyCount > 0 ? 'Say something nearby...' : 'No one nearby'}
            disabled={nearbyCount === 0 && !nearbyNpc}
            style={{
              flex: 1,
              padding: '7px 10px',
              border: '1px solid #475569',
              borderRadius: 6,
              background: '#111827cc',
              color: '#f8fafc',
              fontFamily: 'Courier New, monospace',
              fontSize: 12,
            }}
          />
          <button
            type="submit"
            disabled={(nearbyCount === 0 && !nearbyNpc) || !draft.trim()}
            style={{
              padding: '7px 12px',
              border: 'none',
              background: nearbyCount > 0 || nearbyNpc ? '#e2b46c' : '#475569',
              color: '#0f172a',
              cursor: nearbyCount > 0 || nearbyNpc ? 'pointer' : 'not-allowed',
              fontWeight: 'bold',
              fontFamily: 'Courier New, monospace',
              borderRadius: 6,
            }}
          >
            ↩
          </button>
        </form>
      </div>
    </div>
  );
}
