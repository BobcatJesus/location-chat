import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { VillageScene } from './VillageScene.js';
import { buildAutoLayout } from './AutoLayout.js';
import { isOutdoorLocation } from './outdoorRoomDetection.js';
import { bookstore } from './layouts/bookstore.js';
import { library } from './layouts/library.js';
import { getDistanceMeters } from '../geo';
import { ROOMS } from '../../rooms/rooms.js';

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
const ROOM_SHAPE_PRESETS = [
  { id: 'auto', label: 'Auto' },
  { id: 'cozy', label: 'Cozy' },
  { id: 'wide', label: 'Wide' },
  { id: 'long', label: 'Long' },
  { id: 'l-shape', label: 'L-Shape' },
  { id: 'courtyard', label: 'Courtyard' },
];

function metersToLatLon(room = {}, dxMeters = 0, dyMeters = 0) {
  const lat = Number(room?.lat);
  const lng = Number(room?.lng);
  const centerLat = Number.isFinite(lat) ? lat : 0;
  const centerLng = Number.isFinite(lng) ? lng : 0;
  const lonScale = Math.max(0.000001, Math.cos((centerLat * Math.PI) / 180));
  return {
    lat: centerLat + (dyMeters / 111320),
    lon: centerLng + (dxMeters / (111320 * lonScale)),
  };
}

function createUserRoomShapeFootprint(room = {}, presetId = 'auto') {
  if (!presetId || presetId === 'auto') return null;

  const radiusMeters = Math.max(36, Number(room?.radiusMeters || room?.radius || 82));
  const scale = radiusMeters / 82;
  const shapes = {
    cozy: [
      [-58, -40], [58, -40], [74, -18], [74, 42], [42, 60], [-42, 60], [-74, 42], [-74, -18],
    ],
    wide: [
      [-112, -38], [112, -38], [130, -18], [130, 46], [88, 66], [-88, 66], [-130, 46], [-130, -18],
    ],
    long: [
      [-48, -92], [48, -92], [68, -68], [68, 86], [44, 114], [-44, 114], [-68, 86], [-68, -68],
    ],
    'l-shape': [
      [-100, -76], [48, -76], [48, -22], [102, -22], [102, 74], [-100, 74],
    ],
    courtyard: [
      [0, -104], [74, -78], [112, -12], [92, 62], [28, 104], [-48, 96], [-106, 42], [-102, -34], [-52, -88],
    ],
  };

  const points = shapes[presetId];
  if (!points) return null;
  return points.map(([dx, dy]) => metersToLatLon(room, dx * scale, dy * scale));
}

function storageKeyForRoomShape(roomId = '') {
  return `sidequest:room-shape:${roomId || 'unknown'}`;
}

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

export default function VillageCanvas({ room, profile, onLeave }) {
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
  const [roomPopulation, setRoomPopulation] = useState(1);
  const [cameraMode, setCameraMode] = useState('wide-follow');
  const [footprintDebug, setFootprintDebug] = useState(false);
  const [currentFloor, setCurrentFloor] = useState(0);
  const [totalFloors, setTotalFloors] = useState(1);
  const [stairScaffoldActive, setStairScaffoldActive] = useState(false);
  const roomId = canonicalRoomId(room);
  const [roomShapePreset, setRoomShapePreset] = useState('auto');
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
  const userShapeFootprint = createUserRoomShapeFootprint(normalizedRoom, roomShapePreset);
  const roomFootprint = Array.isArray(userShapeFootprint) ? userShapeFootprint : baseRoomFootprint;
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
    roomShapePreset,
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
    if (!roomId) return;
    try {
      const saved = window.localStorage?.getItem(storageKeyForRoomShape(roomId));
      const hasPreset = ROOM_SHAPE_PRESETS.some((preset) => preset.id === saved);
      setRoomShapePreset(hasPreset ? saved : 'auto');
    } catch {
      setRoomShapePreset('auto');
    }
  }, [roomId]);

  useEffect(() => {
    setShowEditHint(true);
    const timer = setTimeout(() => setShowEditHint(false), 7000);
    return () => clearTimeout(timer);
  }, [roomSignature]);

  useEffect(() => {
    setCameraMode(preferredCameraMode);
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
    const explicitLayout = forceLibraryLayout
      ? library
      : forceBookstoreLayout
        ? bookstore
        : (outdoorMode || shouldForceMultiLevelScaffold
          ? buildAutoLayout(roomId, normalizedRoom?.name || '', normalizedRoom?.amenity || '', normalizedRoom?.shop || '', roomFootprint || null, normalizedRoom)
          : null);

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
      preferredCameraMode,
      onEditorChange: setEditorActive,
      onNearbyChange: setNearbyCount,
      onNearbyNpcChange: setNearbyNpc,
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
      setFootprintDebug(false);
      setCurrentFloor(0);
      setTotalFloors(1);
      setStairScaffoldActive(false);
    };
  }, [roomSignature, roomId, outdoorMode, forceBookstoreLayout, forceLibraryLayout, preferredCameraMode, shouldForceMultiLevelScaffold]);

  const changeRoomShapePreset = (event) => {
    const nextPreset = event.target.value;
    const hasPreset = ROOM_SHAPE_PRESETS.some((preset) => preset.id === nextPreset);
    const safePreset = hasPreset ? nextPreset : 'auto';
    setRoomShapePreset(safePreset);
    try {
      if (roomId) window.localStorage?.setItem(storageKeyForRoomShape(roomId), safePreset);
    } catch {}
    const label = ROOM_SHAPE_PRESETS.find((preset) => preset.id === safePreset)?.label || safePreset;
    setSystemNotice(safePreset === 'auto' ? 'Room shape set to Auto' : `Room shape: ${label}`);
  };

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

  const toggleFootprintDebug = () => {
    const scene = gameRef.current?.scene?.getScene('VillageScene');
    if (!scene?.sys?.isActive()) return;
    const nextState = scene.toggleFootprintDebug?.();
    if (typeof nextState === 'boolean') setFootprintDebug(nextState);
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
      {showEditHint && (
        <div style={{
          position: 'absolute',
          top: 56,
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
          top: showEditHint ? 52 : 12,
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
      <div style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 1000,
        display: 'flex',
        gap: 6,
        flexWrap: 'nowrap',
      }}>
        <button
          onClick={onLeave}
          style={{
            background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            minHeight: 0,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          ← Leave
        </button>
        <button
          onClick={toggleEditor}
          style={{
            background: editorActive ? '#fbbf24' : 'rgba(0,0,0,0.55)',
            color: editorActive ? '#000' : '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            minHeight: 0,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 'bold',
          }}
        >
          {editorActive ? 'Done' : (outdoorMode ? 'Outdoor Edit' : 'Edit')}
        </button>
        <button
          onClick={toggleZoom}
          style={{
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            minHeight: 0,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 'bold',
          }}
        >
          Zoom: {zoomLabel}
        </button>
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: roomShapePreset === 'auto' ? 'rgba(0,0,0,0.55)' : '#38bdf8',
          color: roomShapePreset === 'auto' ? '#fff' : '#082f49',
          border: 'none',
          borderRadius: 8,
          padding: '6px 10px',
          minHeight: 0,
          fontSize: 14,
          fontWeight: 'bold',
        }}>
          Shape
          <select
            value={roomShapePreset}
            onChange={changeRoomShapePreset}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
            style={{
              border: '1px solid rgba(15,23,42,0.3)',
              borderRadius: 6,
              background: '#f8fafc',
              color: '#0f172a',
              fontSize: 13,
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            {ROOM_SHAPE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
        </label>
        <button
          onClick={toggleFootprintDebug}
          style={{
            background: footprintDebug ? '#38bdf8' : 'rgba(0,0,0,0.55)',
            color: footprintDebug ? '#082f49' : '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            minHeight: 0,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 'bold',
          }}
        >
          Border Debug
        </button>
      </div>

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

      <div style={{
        position: 'absolute',
        top: 52,
        left: 12,
        zIndex: 1000,
        background: '#0f172acc',
        border: '1px solid #334155',
        borderRadius: 6,
        padding: '5px 8px',
        color: '#cbd5e1',
        fontFamily: 'Courier New, monospace',
        fontSize: 11,
      }}>
        Press ~ to toggle {outdoorMode ? 'Outdoor Edit Mode' : 'Edit Mode'}
      </div>

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
