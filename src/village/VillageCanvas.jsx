import React, { useEffect, useRef, useState } from 'react';
import { fetchApprovedLayout, approvedToLayout } from './approvedLayout.js';
import Phaser from 'phaser';
import { VillageScene } from './VillageScene.js';
import ShelfPanel from './ShelfPanel.jsx';
import JukeboxPanel from './JukeboxPanel.jsx';
import PuzzleBoard from './PuzzleBoard.jsx';
import InventoryPanel from './InventoryPanel.jsx';
import DecorShopPanel from './DecorShopPanel.jsx';
// Bread Shop v1 (`sq-bread-shop-v1`): the Register-counter bread
// panel in food-shop rooms.
import BreadShopPanel from './BreadShopPanel.jsx';
import NoticeBoardPanel from './NoticeBoardPanel.jsx';
// Pick-Up Notes v1 (`sq-pickup-notes-v1`): the read popup for one
// note on the floor.
import NotePanel from './NotePanel.jsx';
// Notes Moderation v1 (`sq-notes-moderation-v1`): the
// moderator-only review list for flagged/hidden notes.
import FlaggedNotesPanel from './FlaggedNotesPanel.jsx';
import MailboxPanel from './MailboxPanel.jsx';
import HomeStoragePanel from './HomeStoragePanel.jsx';
import PlayerBadgesPanel from './PlayerBadgesPanel.jsx';
import InteriorSketchModal from './InteriorSketchModal.jsx';
import ModQueuePanel from './ModQueuePanel.jsx';
import { getCoins } from './CoinWallet.js';
// Gift Giver v1 (`sq-gift-giver-v1`): the give picker needs to know
// whether the giver holds a sheet of wrapping paper.
import { hasWrappingPaper } from './items.js';
// Agora Graphic-Novel Reskin v1 (`sq-agora-reskin-v1`): the comic
// style test toggle — localStorage flag, default off (original look).
import { isComicStyleOn, setComicStyleOn } from './comicStyle.js';
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
// Quest messages mobile v1.1 (`sq-quest-messages-mobile-v1.1`):
// narrow-screen sizing for the quest banner + toast (see
// questMessageStyle.js).
import { isNarrowQuestViewport, questMessageStyles } from './questMessageStyle.js';
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

export default function VillageCanvas({ room, profile, onLeave, location, venueEvents: providedVenueEvents = [], canManageVenue = false, isModerator = false, onEnterRoom, onCreateEvent }) {
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
  const [systemNotice, setSystemNotice] = useState('');
  const [coinBalance, setCoinBalance] = useState(() => getCoins());
  const [showInteriorSketch, setShowInteriorSketch] = useState(false);
  const [showModQueue, setShowModQueue] = useState(false);
  const [approvedLayout, setApprovedLayout] = useState(null);
  const [interactKind, setInteractKind] = useState(null);
  const [questHud, setQuestHud] = useState(null);
  // Quest messages mobile v1.1 (`sq-quest-messages-mobile-v1.1`):
  // narrow screens get smaller banner/toast boxes (see
  // questMessageStyle.js). Recomputed on resize/rotation below.
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && isNarrowQuestViewport(window.innerWidth),
  );
  // Quests popup (`sq-quests-popup-v1`, desktop in
  // `sq-desktop-menu-v1.2`): quests live in the menu on every screen
  // now — the left-side tracker box is gone. Tapping "Quests" opens
  // them as a popup, closed by a literal X.
  const [showQuests, setShowQuests] = useState(false);
  // Menu (`sq-mobile-move-v1`, desktop in `sq-desktop-menu-v1.2`):
  // the whole top bar is a single ☰ button on every screen now;
  // this opens it as a popup.
  const [showMenu, setShowMenu] = useState(false);
  // Comic style test (`sq-agora-reskin-v1`): mirrors the
  // localStorage flag so the menu button shows the current state.
  const [comicStyle, setComicStyle] = useState(() => isComicStyleOn());
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
  // Pick-Up Notes v1 (`sq-pickup-notes-v1`): the id of the note
  // being read, or null.
  const [openNote, setOpenNote] = useState(null);
  // Notes Moderation v1 (`sq-notes-moderation-v1`): the
  // moderator-only flagged-notes review panel, or false.
  const [openFlaggedNotes, setOpenFlaggedNotes] = useState(false);
  // Mailbox v1 (`sq-mailbox-v1`): the mailbox overlay + how many
  // unread packages are waiting (the envelope dot on the 🎒 button).
  const [openMailbox, setOpenMailbox] = useState(false);
  const [mailUnread, setMailUnread] = useState(0);
  const [mailRoomName, setMailRoomName] = useState('');
  // Mailbox v1.2 (`sq-mailbox-v1.2`): the nearest mailbox room's
  // name, for the envelope dot's tooltip — the generic "Open your
  // mailbox at the park" misled the user when the mailbox was at a
  // library (the Galveston fallback). The tooltip now names the
  // real room, or says nothing about a place when unresolved.
  // Decoration Shop v1 (`sq-dec-shop-v1`): the Agora coffee-bar shop.
  const [openDecorShop, setOpenDecorShop] = useState(false);
  // Bread Shop v1 (`sq-bread-shop-v1`): the Register-counter bread
  // shop in a food-shop room.
  const [openBreadShop, setOpenBreadShop] = useState(false);
  // Your Place v1: the storage chest panel, opened from the chest
  // in your home room (E key / click / interact button).
  const [openHomeStorage, setOpenHomeStorage] = useState(false);
  // Quest badges v1: another player's badges panel, opened by
  // clicking them ({ socketId } or null).
  const [openPlayerBadges, setOpenPlayerBadges] = useState(null);
  // Gift Giver v1 (`sq-gift-giver-v1`): a direct gift offer from
  // another player in this room ({ offerId, fromName, item } or
  // null) — Accept / Decline. The scene calls onGiftOffer /
  // onGiftOfferGone when one arrives / closes.
  const [incomingGiftOffer, setIncomingGiftOffer] = useState(null);
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
  // Mailbox v1.2 (`sq-mailbox-v1.2`): the same poll also reads the
  // nearest mailbox room's name, for the dot's tooltip.
  useEffect(() => {
    const t = setInterval(() => {
      try {
        const scene = gameRef.current?.scene?.getScene('VillageScene');
        const st = scene?.itemsSystem?.getState ? scene.itemsSystem.getState() : null;
        if (st) {
          setInventoryCount(`${st.count}/${st.capacity}`);
          setMailUnread(Number(st.mailUnread) || 0);
          setMailRoomName(typeof st.mailboxRoomName === 'string' ? st.mailboxRoomName : '');
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

  // Quest messages mobile v1.1 (`sq-quest-messages-mobile-v1.1`):
  // keep the narrow flag live across rotation/resize.
  useEffect(() => {
    const update = () => setIsNarrow(isNarrowQuestViewport(window.innerWidth));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
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
    // Pick-Up Notes v1 (`sq-pickup-notes-v1`): read a note on the
    // floor.
    note: ['📝', 'Read the note'],
    // Mailbox v1 (`sq-mailbox-v1`): open your mailbox at the park.
    mailbox: ['📬', 'Open your mailbox'],
    'storage-chest': ['📦', 'Open your storage chest'],
    'floor-item': ['🎒', 'Pick up'],
    shelf: ['📚', 'Browse the shelf'],
    jukebox: ['🎵', 'Open the jukebox'],
    bar: ['🍺', 'Order a drink'],
    // Coffee bar mobile (`sq-coffee-bar-mobile-v1`): the Agora coffee
    // bar gets a coffee mug, not a beer mug.
    'coffee-bar': ['☕', 'Coffee bar'],
    // Bread Shop v1 (`sq-bread-shop-v1`): the Register counter in
    // a food-shop room.
    shop: ['🛒', 'Buy bread'],
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

  // Edit-hint banner removed (sq-remove-edit-hint-v1): the
  // "Edit Mode: press ~ to toggle" bar no longer shows on room
  // entry. ~ and the Edit button still toggle the editor.
  useEffect(() => {
    window.__chatInputFocused = false;
    return () => { window.__chatInputFocused = false; };
  }, []);

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
      // Pick-Up Notes v1 (`sq-pickup-notes-v1`): opens the read
      // popup for one note on the floor.
      onOpenNote: (noteId) => setOpenNote(noteId),
      // Mailbox v1 (`sq-mailbox-v1`): opens the mailbox overlay.
      onOpenMailbox: () => setOpenMailbox(true),
      // Mailbox v1 (`sq-mailbox-v1`): every room the app knows
      // about (featured + user-created), so the scene can find the
      // player's nearest park room (their mailbox room).
      allRooms: getAllRooms(),
      onOpenHomeStorage: () => setOpenHomeStorage(true),
      // Decoration Shop v1: opens the coffee-bar shop panel (DOM).
      onOpenDecorShop: () => setOpenDecorShop(true),
      // Bread Shop v1 (`sq-bread-shop-v1`): opens the Register
      // counter bread panel (DOM) in a food-shop room.
      onOpenBreadShop: () => setOpenBreadShop(true),
      onOpenPlayerBadges: (info) => setOpenPlayerBadges(info),
      // Gift Giver v1 (`sq-gift-giver-v1`): a direct gift offer
      // arrived (show the Accept / Decline prompt) / the prompt
      // should close (declined, accepted, expired, they left).
      onGiftOffer: (offer) => setIncomingGiftOffer(offer),
      onGiftOfferGone: () => setIncomingGiftOffer(null),
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
      // Portrait fill v1 (`sq-portrait-fill-v1`): size the game from the
      // container (WorldMapCanvas already does this) and let the canvas
      // resize with the window instead of fitting a fixed 1600x900 —
      // a portrait phone gets a tall view of the room, not a strip.
      width: el.clientWidth || BASE_WIDTH,
      height: el.clientHeight || BASE_HEIGHT,
      backgroundColor: '#0f172a',
      scene: VillageScene,
      scale: {
        mode: Phaser.Scale.RESIZE,
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

  // Mobile menu (`sq-mobile-move-v1`): the top bar's buttons as one
  // fragment, used by the wide bar (as a row) and by the narrow menu
  // popup (as a column). Every action also closes the menu — a no-op
  // on wide screens, where the menu is never open.
  // Agora Graphic-Novel Reskin v1 (`sq-agora-reskin-v1`): the comic
  // style test toggle. Flipping the flag restarts the CURRENT scene
  // — VillageScene.shutdown() tears it down (socket listeners off,
  // systems destroyed, incl. the cat) and create() re-runs preload
  // + create with the new flag, so the Agora redraws and the cat
  // swaps frames. No rebuild, no push; flipping back restores the
  // original instantly. restart() with no data is safe: init()
  // falls back to VillageScene._boot (the same room). Works from
  // any room — it only changes the Agora's look. If the scene is
  // not up yet the flag is still flipped and the next room entry
  // picks it up.
  const toggleComicStyle = () => {
    const next = setComicStyleOn(!isComicStyleOn());
    setComicStyle(next);
    setShowMenu(false);
    try {
      const scene = gameRef.current?.scene?.getScene('VillageScene');
      if (scene?.scene?.restart) scene.scene.restart();
    } catch { /* scene not ready yet — flag still flipped */ }
  };

  // Santa Hat reset (`sq-hat-reset-v1`): a moderator puts the hat
  // back behind the tree. The button only shows when canManageVenue
  // is true; the server re-checks the moderator gate. The hat_state
  // broadcast after a reset updates everyone, so no reply handling
  // is needed here — the hat is findable again right away.
  const resetHat = () => {
    try {
      const scene = gameRef.current?.scene?.getScene('VillageScene');
      const socket = scene?.socket;
      if (socket?.connected) {
        socket.emit('hat_reset', { roomId });
      }
    } catch { /* scene not ready yet — nothing to reset */ }
  };

  const topBarButtons = (
    <>
      {/* Leave rename v1 (sq-leave-rename-v1): the button says what it
          does now — "Return to map". Same onLeave, same spot, same style. */}
      <button
        onClick={() => { setShowMenu(false); onLeave(); }}
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
      {/* Create Event top bar (`sq-create-event-topbar-v1`): "+ Create
          event" used to float over this bar from app.jsx (top:12,
          left:12, zIndex 1001), covering "Return to map" on every
          screen where the player can manage the venue. It lives in
          the bar now, so it wraps with the other buttons on mobile
          instead of covering one. */}
      {canManageVenue && onCreateEvent && (
        <button
          onClick={() => { setShowMenu(false); onCreateEvent(); }}
          style={{
            background: '#fbbf24', color: '#111827', border: 'none',
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
          + Create event
        </button>
      )}
      {/* Two Places v1 (`sq-two-places-v1`): there is NO 🏠 Home
          button any more. Your places are real locations — you
          enter one from the map when you are next to it (GPS
          proximity, like any other place). The teleport home is
          gone entirely, so nothing here takes you to a place. */}
      <button
        onClick={() => { setShowMenu(false); toggleEditor(); }}
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
        {/* sq-rename-edit-place-furniture-v1: the button says what it does now. */}
        {editorActive ? 'Done' : 'Place furniture'}
      </button>
      {/* Santa Hat reset (`sq-hat-reset-v1`): moderators only. Puts
          the Santa hat back behind the tree — fixes a hat stuck in
          someone's pocket, on the cat, or on the floor. The server
          re-checks the moderator gate; the hat_state broadcast after
          a reset updates everyone. */}
      {canManageVenue && (
        <button
          onClick={() => { setShowMenu(false); resetHat(); }}
          title="Put the Santa hat back behind the tree"
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
          🎅 Reset hat
        </button>
      )}
      {/* Notes Moderation v1 (`sq-notes-moderation-v1`): moderators
          only, next to Reset hat. Opens the flagged-notes review
          list for this room — restore a note or take it down. The
          server re-checks the moderator gate on every request. */}
      {canManageVenue && (
        <button
          onClick={() => { setShowMenu(false); setOpenFlaggedNotes(true); }}
          title="Review notes players reported in this room"
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
          🚩 Flagged
        </button>
      )}
      <button
        onClick={() => { setShowMenu(false); setShowInteriorSketch(true); }}
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
        onClick={() => { setShowMenu(false); setShowModQueue(true); }}
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
      {/* Quests popup (`sq-quests-popup-v1`, desktop in
          `sq-desktop-menu-v1.1`): in the menu on every screen now —
          on narrow screens the persistent tracker box is hidden, so
          this button is the way in; on desktop it opens the same
          popup over the tracker box. Tapping it opens the quests
          popup. */}
        <button
          onClick={() => { setShowMenu(false); setShowQuests(true); }}
          style={{
            background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
            borderRadius: 8, padding: '6px 14px',
            minHeight: 44, display: 'flex', alignItems: 'center',
            cursor: 'pointer', fontSize: 14, fontWeight: 'bold',
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          🎯 Quests
        </button>
      {/* Comic style test (`sq-agora-reskin-v1`): flips the Agora
          between the original look and the graphic-novel reskin
          instantly — no rebuild, no push. The scene restarts so
          the room redraws and the cat swaps frames; flipping it
          back restores the original right away. */}
        <button
          onClick={toggleComicStyle}
          title="Test the graphic-novel look for the Agora — tap again to go right back to the original"
          style={{
            background: comicStyle ? '#fbbf24' : 'rgba(0,0,0,0.55)',
            color: comicStyle ? '#111827' : '#fff',
            border: 'none',
            borderRadius: 8, padding: '6px 14px',
            minHeight: 44, display: 'flex', alignItems: 'center',
            cursor: 'pointer', fontSize: 14, fontWeight: 'bold',
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          🎨 Comic style: {comicStyle ? 'on' : 'off'}
        </button>
    </>
  );

  // Quest messages mobile v1.1 (`sq-quest-messages-mobile-v1.1`):
  // banner/toast sizing for this viewport (desktop values are the
  // exact ones the top-right v1 kit shipped).
  const msgStyles = questMessageStyles(isNarrow);

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
          // sq-jukebox-guard-v1: the moderator remove/clear buttons
          // only render when canManageVenue is true.
          canManageVenue={canManageVenue}
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
          // Hunger System v1 (`sq-hunger-v1`): the pocket's Eat
          // button — one bite of food, its own path (never the
          // ducks/cat Use path).
          onEat={(id) => gameRef.current?.scene?.getScene('VillageScene')?.itemsSystem?.eatItem?.(id) || { ok: false, reason: 'error' }}
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
          // Pick-Up Notes v1 (`sq-pickup-notes-v1`): leave a note on
          // the floor where you are standing — free, and it takes
          // no pocket slot (a note is a world object, not an item).
          onWriteNote={(text) => gameRef.current?.scene?.getScene('VillageScene')?.noteSystem?.dropNote?.(text) || { ok: false, reason: 'error' }}
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
      {/* Pick-Up Notes v1 (`sq-pickup-notes-v1`): read one note on
          the floor — text and fade time only, anonymous. The Delete
          button shows only for the writer or a moderator; the
          server re-validates either way. */}
      {openNote && (
        <NotePanel
          getState={() => gameRef.current?.scene?.getScene('VillageScene')?.noteSystem?.getState?.()}
          onDelete={(noteId) => gameRef.current?.scene?.getScene('VillageScene')?.noteSystem?.deleteNote?.(noteId) || { ok: false, reason: 'error' }}
          // Notes Moderation v1 (`sq-notes-moderation-v1`): report
          // a note from the read popup.
          onReport={(noteId) => gameRef.current?.scene?.getScene('VillageScene')?.noteSystem?.reportNote?.(noteId) || { ok: false, reason: 'error' }}
          isModerator={isModerator}
          noteId={openNote}
          onClose={() => setOpenNote(null)}
        />
      )}
      {/* Notes Moderation v1 (`sq-notes-moderation-v1`): the
          moderator-only flagged-notes review list for this room.
          Restore puts a note back on the floor, Take down uses
          the same moderator-gated delete as the read popup. */}
      {openFlaggedNotes && (
        <FlaggedNotesPanel
          getState={() => gameRef.current?.scene?.getScene('VillageScene')?.noteSystem?.getFlaggedState?.()}
          onRefresh={() => gameRef.current?.scene?.getScene('VillageScene')?.noteSystem?.requestFlaggedList?.() || { ok: false, reason: 'error' }}
          onRestore={(noteId) => gameRef.current?.scene?.getScene('VillageScene')?.noteSystem?.restoreFlaggedNote?.(noteId) || { ok: false, reason: 'error' }}
          onDelete={(noteId) => gameRef.current?.scene?.getScene('VillageScene')?.noteSystem?.deleteNote?.(noteId) || { ok: false, reason: 'error' }}
          roomName={normalizedRoom?.name || roomId}
          onClose={() => setOpenFlaggedNotes(false)}
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
          onBuyBread={(kind) => gameRef.current?.scene?.getScene('VillageScene')?.decorSystem?.buyBread?.(kind) || { ok: false, reason: 'error' }}
          // Gift Wrapping Paper v1 (`sq-gift-wrap-v1`): wrapping
          // paper at the Agora bar, 2 coins a sheet.
          onBuySupply={(kind) => gameRef.current?.scene?.getScene('VillageScene')?.decorSystem?.buySupply?.(kind) || { ok: false, reason: 'error' }}
          // Temperature System v1 (`sq-temperature-v1`): cocoa /
          // iced coffee at the Agora bar, 2 coins each.
          onBuyDrink={(kind) => gameRef.current?.scene?.getScene('VillageScene')?.decorSystem?.buyDrink?.(kind) || { ok: false, reason: 'error' }}
          onClose={() => setOpenDecorShop(false)}
        />
      )}
      {openBreadShop && (
        <BreadShopPanel
          getState={() => gameRef.current?.scene?.getScene('VillageScene')?.decorSystem?.getBreadShopState?.()}
          onBuyBread={(kind) => gameRef.current?.scene?.getScene('VillageScene')?.decorSystem?.buyBread?.(kind) || { ok: false, reason: 'error' }}
          onClose={() => setOpenBreadShop(false)}
        />
      )}
      {openPlayerBadges && (
        <PlayerBadgesPanel
          getState={() => gameRef.current?.scene?.getScene('VillageScene')?.getPlayerBadges?.(openPlayerBadges.socketId)}
          // Gift Giver v1 (`sq-gift-giver-v1`): hand them a gift in
          // person — pick a sendable pocket item, they accept or
          // decline. The gift + wrapping sheet move only on accept.
          getSendableItems={() => gameRef.current?.scene?.getScene('VillageScene')?.giftSystem?.getSendableItems?.() || []}
          onOfferGift={(itemId) => gameRef.current?.scene?.getScene('VillageScene')?.giftSystem?.offerGift?.(openPlayerBadges.socketId, itemId) || { ok: false, reason: 'error' }}
          isOfferPending={() => gameRef.current?.scene?.getScene('VillageScene')?.giftSystem?.isOfferPendingTo?.(openPlayerBadges.socketId) || false}
          hasWrappingPaper={() => {
            try { return hasWrappingPaper(); } catch { return true; }
          }}
          onClose={() => setOpenPlayerBadges(null)}
        />
      )}
      {incomingGiftOffer && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 1200,
            background: 'rgba(15,23,42,0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 12,
          }}
        >
          <div
            style={{
              background: '#fff7e6', color: '#1a4971', borderRadius: 12,
              padding: 16, width: 'min(380px, calc(100vw - 24px))',
              boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ fontWeight: 'bold', fontSize: 17 }}>🎁 A gift for you!</div>
            <div style={{ fontSize: 14, marginTop: 8 }}>
              {incomingGiftOffer.fromName} wants to give you {incomingGiftOffer.item?.emoji || '🎁'} {incomingGiftOffer.item?.label || 'a gift'}.
            </div>
            <div style={{ fontSize: 12.5, color: '#3d6a8a', marginTop: 6 }}>
              Accept and it lands in your pocket, wrapped. Decline and nothing moves.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                onClick={() => gameRef.current?.scene?.getScene('VillageScene')?.giftSystem?.acceptOffer?.()}
                style={{
                  flex: 1, background: '#1a4971', color: '#fff', border: 'none',
                  borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                  fontSize: 14, fontWeight: 'bold',
                }}
              >
                Accept 🎁
              </button>
              <button
                onClick={() => gameRef.current?.scene?.getScene('VillageScene')?.giftSystem?.declineOffer?.()}
                style={{
                  flex: 1, background: 'transparent', color: '#1a4971',
                  border: '1px solid #1a4971', borderRadius: 8, padding: '10px 12px',
                  cursor: 'pointer', fontSize: 14, fontWeight: 'bold',
                }}
              >
                Decline
              </button>
            </div>
          </div>
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
        // Desktop menu (`sq-desktop-menu-v1`): the bar is just the ☰
        // button on every screen now. While the menu is open the bar
        // sits above the popup's dimmed backdrop, so clicking ☰
        // again toggles it closed instead of the backdrop eating
        // the click.
        zIndex: showMenu ? 2001 : 1000,
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
        paddingBottom: 4,
      }}>
        <button
          onClick={() => setShowMenu((v) => !v)}
          style={{
            background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
            borderRadius: 8, padding: '6px 14px',
            minHeight: 44, display: 'flex', alignItems: 'center',
            cursor: 'pointer', fontSize: 14, fontWeight: 'bold',
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          ☰ Menu
        </button>
        {/* sq-zoom-outside-menu-v1: Zoom lives on the top bar now, next
            to Menu, so it's one tap away instead of buried in the menu.
            Same toggleZoom, same label — it just isn't in topBarButtons
            any more, so it doesn't show in the menu popup. */}
        <button
          onClick={() => toggleZoom()}
          style={{
            background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
            borderRadius: 8, padding: '6px 14px',
            minHeight: 44, display: 'flex', alignItems: 'center',
            cursor: 'pointer', fontSize: 14, fontWeight: 'bold',
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          Zoom: {zoomLabel}
        </button>
        {/* sq-exit-place-furniture-v1: Done on the top bar while
            placing furniture. The menu's Place furniture / Done
            button is hidden inside the menu popup while you are
            placing, so exiting took opening the menu first. This
            button shows only while edit mode is active AND the
            menu is closed — when the menu opens it disappears and
            the menu's own Done is the exit — so there is always
            exactly one Done visible. Same toggleEditor, no
            setShowMenu (the menu is already closed). Amber, like
            the active Place furniture button, so it reads as the
            exit. */}
        {editorActive && !showMenu && (
          <button
            onClick={() => toggleEditor()}
            style={{
              background: '#fbbf24', color: '#000', border: 'none',
              borderRadius: 8, padding: '6px 14px',
              minHeight: 44, display: 'flex', alignItems: 'center',
              cursor: 'pointer', fontSize: 14, fontWeight: 'bold',
              flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            Done
          </button>
        )}
      </div>

      {/* Menu popup (`sq-mobile-move-v1`, desktop in
          `sq-desktop-menu-v1`): the whole top bar lives here while
          the ☰ button is the only thing in the bar itself, on every
          screen. Closed by the literal X, by tapping the dimmed
          backdrop, or by clicking ☰ again. */}
      {showMenu && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 2000,
            background: 'rgba(2,6,23,0.75)',
            display: 'grid', placeItems: 'center', padding: 20,
          }}
          onClick={() => setShowMenu(false)}
        >
          <div
            style={{
              width: 'min(420px, 100%)', maxHeight: '80vh', overflowY: 'auto',
              background: '#0f172a', color: '#f8fafc', borderRadius: 8,
              padding: '14px 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              position: 'relative',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowMenu(false)}
              aria-label="Close menu"
              style={{
                position: 'absolute', top: 8, right: 8,
                background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 8,
                width: 36, height: 36, fontSize: 18, fontWeight: 'bold',
                cursor: 'pointer', color: '#f8fafc',
                display: 'grid', placeItems: 'center',
              }}
            >
              ✕
            </button>
            <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 10, paddingRight: 44 }}>☰ Menu</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
              {topBarButtons}
            </div>
          </div>
        </div>
      )}


      {/* Left-side tracker box removed (`sq-desktop-menu-v1.2`):
          it showed the same quests as the popup, so desktop had two
          quest lists at once. Quests live in the menu popup only now
          (room quests, First Steps prompt, anywhere quests). The
          quest banner below is untouched — it still pops up on
          progress and completion. */}
      {/* Quests popup (`sq-quests-popup-v1`, desktop in
          `sq-desktop-menu-v1.2`): on every screen now, and the only
          quest list — the left-side tracker box is gone (room quests,
          First Steps prompt, anywhere quests all live here). Closed by
          the literal X, or by tapping the dimmed backdrop. */}
      {showQuests && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 2000,
            background: 'rgba(2,6,23,0.75)',
            display: 'grid', placeItems: 'center', padding: 20,
          }}
          onClick={() => setShowQuests(false)}
        >
          <div
            style={{
              width: 'min(420px, 100%)', maxHeight: '80vh', overflowY: 'auto',
              background: '#fff', color: '#1a4971', borderRadius: 8,
              padding: '14px 16px', fontSize: 14, lineHeight: 1.35,
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)', position: 'relative',
              whiteSpace: 'pre-line',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowQuests(false)}
              aria-label="Close quests"
              style={{
                position: 'absolute', top: 8, right: 8,
                background: 'rgba(0,0,0,0.08)', border: 'none', borderRadius: 8,
                width: 36, height: 36, fontSize: 18, fontWeight: 'bold',
                cursor: 'pointer', color: '#1a4971',
                display: 'grid', placeItems: 'center',
              }}
            >
              ✕
            </button>
            <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 8, paddingRight: 44 }}>🎯 Quests</div>
            {questHud?.trackerSections ? (
              <>
                <div style={{ whiteSpace: 'pre-line' }}>
                  {questHud.trackerSections.room.length > 0 ? questHud.trackerSections.room.join('\n') : '✅ All quests complete — more coming soon!'}
                </div>
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
              questHud?.trackerLines?.join('\n') || '✅ All quests complete — more coming soon!'
            )}
          </div>
        </div>
      )}
      {/* Quest messages top-right v1 (`sq-quest-messages-topright-v1`):
          the banner and toast used to sit centred (banner top:116,
          toast top:30%) and covered the avatar. They now dock in one
          top-right column below the room chips (In room / Footprint /
          Floor end around top:94), banner above toast, so they never
          overlap each other. The banner stays click-to-dismiss; the
          toast stays pointerEvents 'none' so it never blocks taps. */}
      {(questHud?.banner || questHud?.toast) && (
        <div style={{
          position: 'absolute', top: 116, right: 12, zIndex: 1001,
          display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end',
          pointerEvents: 'none',
        }}>
          {questHud?.banner && (
            <div
              onClick={dismissQuestBanner}
              title="Click to dismiss"
              style={{
                width: msgStyles.bannerWidth,
                background: 'rgba(255,255,255,0.95)', color: '#1a4971',
                borderRadius: 8, padding: msgStyles.bannerPadding, fontSize: msgStyles.bannerFontSize, textAlign: 'left',
                cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                pointerEvents: 'auto',
              }}
            >
              <div style={{ fontWeight: 'bold', fontSize: msgStyles.bannerTitleFontSize }}>{questHud.banner.emoji} {questHud.banner.title}</div>
              {/* Quest messages mobile v1.1 (`sq-quest-messages-mobile-v1.1`):
                  narrow screens drop the description line — title +
                  reward carry the meaning, and the description is the
                  longest part. Desktop shows it exactly as before. */}
              {msgStyles.showDescription && (<div>{questHud.banner.description}</div>)}
              {/* Onboarding v1: a 0-coin reward (First Steps) shows no
                  reward line — never "Reward: +0 coins". */}
              {questHud.banner.rewardCoins > 0 && (<div>Reward: +{questHud.banner.rewardCoins} coins</div>)}
            </div>
          )}
          {questHud?.toast && (
            <div style={{
              maxWidth: msgStyles.toastMaxWidth,
              background: 'rgba(255,255,255,0.94)', color: '#14532d',
              borderRadius: 8, padding: msgStyles.toastPadding, fontSize: msgStyles.toastFontSize, fontWeight: 'bold',
              textAlign: 'left', pointerEvents: 'none',
              boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
            }}>
              {questHud.toast}
            </div>
          )}
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
            you have unread mail, until you've collected it.
            Mailbox v1.2 (`sq-mailbox-v1.2`): the tooltip names the
            real mailbox room (the nearest one) — the old generic
            "Open your mailbox at the park" said "the park" even
            when the mailbox was at a library. When the room is
            unresolved it says nothing about a place at all — never
            a generic "at the park". */}
        {mailUnread > 0 && (
          <span
            title={mailRoomName
              ? `You’ve got mail (${mailUnread})! Open your mailbox at ${mailRoomName}.`
              : `You’ve got mail (${mailUnread})!`}
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
