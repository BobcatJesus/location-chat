import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { io } from 'socket.io-client';
import { getDistanceMeters } from '../geo';

const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.PROD ? 'https://location-chat-production.up.railway.app' : 'http://localhost:4000');

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Map OpenStreetMap amenity/tag → emoji + colour
const POI_TYPES = [
  // Food & drink
  { tag: 'amenity', value: 'cafe',             emoji: '☕', color: '#00704a', label: 'Café' },
  { tag: 'amenity', value: 'restaurant',       emoji: '🍽️', color: '#f59e0b', label: 'Restaurant' },
  { tag: 'amenity', value: 'fast_food',        emoji: '🍔', color: '#f97316', label: 'Fast Food' },
  { tag: 'amenity', value: 'bar',              emoji: '🍺', color: '#a855f7', label: 'Bar' },
  { tag: 'amenity', value: 'pub',              emoji: '🍺', color: '#a855f7', label: 'Pub' },
  { tag: 'amenity', value: 'ice_cream',        emoji: '🍦', color: '#fbcfe8', label: 'Ice Cream' },
  { tag: 'amenity', value: 'food_court',       emoji: '🍱', color: '#fbbf24', label: 'Food Court' },
  // Culture & learning
  { tag: 'tourism', value: 'museum',           emoji: '🏛️', color: '#c084fc', label: 'Museum' },
  { tag: 'tourism', value: 'gallery',          emoji: '🖼️', color: '#818cf8', label: 'Art Gallery' },
  { tag: 'tourism', value: 'artwork',          emoji: '🗿', color: '#a78bfa', label: 'Artwork' },
  { tag: 'tourism', value: 'information',      emoji: '🛈', color: '#38bdf8', label: 'Info Point' },
  { tag: 'amenity', value: 'library',          emoji: '📚', color: '#6366f1', label: 'Library' },
  { tag: 'amenity', value: 'theatre',          emoji: '🎭', color: '#f43f5e', label: 'Theatre' },
  { tag: 'amenity', value: 'cinema',           emoji: '🎬', color: '#ef4444', label: 'Cinema' },
  // Nature & outdoors
  { tag: 'leisure', value: 'park',             emoji: '🌳', color: '#4ade80', label: 'Park' },
  { tag: 'leisure', value: 'garden',           emoji: '🌸', color: '#86efac', label: 'Garden' },
  { tag: 'leisure', value: 'nature_reserve',   emoji: '🌿', color: '#16a34a', label: 'Nature Reserve' },
  { tag: 'leisure', value: 'dog_park',         emoji: '🐕', color: '#a3e635', label: 'Dog Park' },
  { tag: 'leisure', value: 'playground',       emoji: '🛝', color: '#fbbf24', label: 'Playground' },
  { tag: 'leisure', value: 'swimming_pool',    emoji: '🏊', color: '#0ea5e9', label: 'Pool' },
  { tag: 'leisure', value: 'marina',           emoji: '⛵', color: '#0369a1', label: 'Marina' },
  { tag: 'leisure', value: 'fishing',          emoji: '🎣', color: '#0891b2', label: 'Fishing Spot' },
  { tag: 'natural', value: 'beach',            emoji: '🏖️', color: '#fcd34d', label: 'Beach' },
  { tag: 'natural', value: 'peak',             emoji: '⛰️', color: '#78716c', label: 'Peak' },
  { tag: 'natural', value: 'waterfall',        emoji: '💧', color: '#7dd3fc', label: 'Waterfall' },
  { tag: 'natural', value: 'water',            emoji: '🏞️', color: '#3b82f6', label: 'Lake / Pond' },
  { tag: 'natural', value: 'spring',           emoji: '💦', color: '#93c5fd', label: 'Spring' },
  // Trails & viewpoints
  { tag: 'tourism', value: 'viewpoint',        emoji: '🔭', color: '#f97316', label: 'Viewpoint' },
  { tag: 'tourism', value: 'picnic_site',      emoji: '🧺', color: '#84cc16', label: 'Picnic Spot' },
  { tag: 'tourism', value: 'camp_site',        emoji: '⛺', color: '#65a30d', label: 'Campsite' },
  { tag: 'tourism', value: 'wilderness_hut',   emoji: '🛖', color: '#92400e', label: 'Wilderness Hut' },
  { tag: 'highway', value: 'trailhead',        emoji: '🥾', color: '#a16207', label: 'Trailhead' },
  // Spiritual & historic
  { tag: 'amenity', value: 'place_of_worship', emoji: '🙏', color: '#e2b46c', label: 'Place of Worship' },
  { tag: 'historic', value: 'monument',        emoji: '🗽', color: '#d97706', label: 'Monument' },
  { tag: 'historic', value: 'ruins',           emoji: '🏚️', color: '#92400e', label: 'Ruins' },
  { tag: 'historic', value: 'memorial',        emoji: '🕯️', color: '#b45309', label: 'Memorial' },
  { tag: 'historic', value: 'castle',          emoji: '🏰', color: '#7c3aed', label: 'Castle' },
  // Fitness & sport
  { tag: 'amenity', value: 'gym',              emoji: '💪', color: '#ec4899', label: 'Gym' },
  { tag: 'leisure', value: 'sports_centre',    emoji: '🏟️', color: '#e11d48', label: 'Sports Centre' },
  { tag: 'leisure', value: 'stadium',          emoji: '🏟️', color: '#be123c', label: 'Stadium' },
  { tag: 'leisure', value: 'golf_course',      emoji: '⛳', color: '#15803d', label: 'Golf Course' },
  { tag: 'leisure', value: 'skate_park',       emoji: '🛹', color: '#6b7280', label: 'Skate Park' },
  // Practical
  { tag: 'amenity', value: 'school',           emoji: '🏫', color: '#60a5fa', label: 'School' },
  { tag: 'amenity', value: 'pharmacy',         emoji: '💊', color: '#10b981', label: 'Pharmacy' },
  { tag: 'amenity', value: 'bank',             emoji: '🏦', color: '#64748b', label: 'Bank' },
  { tag: 'amenity', value: 'fuel',             emoji: '⛽', color: '#ef4444', label: 'Gas Station' },
  { tag: 'amenity', value: 'marketplace',      emoji: '🏪', color: '#f59e0b', label: 'Market' },
  { tag: 'shop',    value: 'supermarket',      emoji: '🛒', color: '#60a5fa', label: 'Supermarket' },
  { tag: 'shop',    value: 'convenience',      emoji: '🏪', color: '#94a3b8', label: 'Store' },
  { tag: 'shop',    value: 'deli',             emoji: '🥪', color: '#f59e0b', label: 'Deli' },
  { tag: 'shop',    value: 'bakery',           emoji: '🥐', color: '#fcd34d', label: 'Bakery' },
  { tag: 'shop',    value: 'butcher',          emoji: '🥩', color: '#ef4444', label: 'Butcher' },
  { tag: 'shop',    value: 'seafood',          emoji: '🦞', color: '#0ea5e9', label: 'Seafood' },
  { tag: 'shop',    value: 'wine',             emoji: '🍷', color: '#9333ea', label: 'Wine Shop' },
  { tag: 'shop',    value: 'coffee',           emoji: '☕', color: '#00704a', label: 'Coffee Shop' },
  { tag: 'shop',    value: 'clothes',          emoji: '👕', color: '#ec4899', label: 'Clothing' },
  { tag: 'shop',    value: 'books',            emoji: '📚', color: '#6366f1', label: 'Bookstore' },
  { tag: 'shop',    value: 'music',            emoji: '🎵', color: '#a855f7', label: 'Music' },
  { tag: 'shop',    value: 'art',              emoji: '🎨', color: '#818cf8', label: 'Art Shop' },
  { tag: 'amenity', value: 'deli',             emoji: '🥪', color: '#f59e0b', label: 'Deli' },
  { tag: 'amenity', value: 'juice_bar',        emoji: '🥤', color: '#4ade80', label: 'Juice Bar' },
  { tag: 'amenity', value: 'hookah_lounge',    emoji: '💨', color: '#a78bfa', label: 'Lounge' },
];

const POI_RADIUS = 40; // metres
const AUTHORITATIVE_FOOTPRINTS_URL = '/assets/footprints/parks.geojson';
let authoritativeParkFootprints = [];
let authoritativeParkFootprintsLoad = null;

const LIVE_OAK_PARK_CENTER = { lat: 29.754535, lng: -95.409365 };
const LIVE_OAK_OSM_WAY_ID = '392274785';
// Exact OSM polygon for Live Oak Park (way 392274785), used as a stable
// footprint override when provider footprints are missing or noisy.
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
// Exact OSM polygon for Shepherd Park (way 289943234), normalized to
// { lat, lon } pairs for the in-room boundary pipeline.
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

const HOMEWOOD_PARK_CENTER = { lat: 29.7546720, lng: -95.4202793 };
const HOMEWOOD_PARK_OSM_WAY_ID = '123419608';
const HOMEWOOD_PARK_FOOTPRINT = [
  { lat: 29.7542423, lon: -95.4207945 },
  { lat: 29.7540095, lon: -95.4207784 },
  { lat: 29.7537766, lon: -95.4207328 },
  { lat: 29.7536998, lon: -95.4207006 },
  { lat: 29.7536509, lon: -95.4206577 },
  { lat: 29.7536206, lon: -95.4205987 },
  { lat: 29.7535973, lon: -95.4205182 },
  { lat: 29.7536089, lon: -95.4204377 },
  { lat: 29.7536415, lon: -95.4203814 },
  { lat: 29.7537184, lon: -95.4203036 },
  { lat: 29.7539000, lon: -95.4201534 },
  { lat: 29.7541259, lon: -95.4200139 },
  { lat: 29.7543262, lon: -95.4199201 },
  { lat: 29.7545613, lon: -95.4198503 },
  { lat: 29.7547826, lon: -95.4198208 },
  { lat: 29.7550736, lon: -95.4198101 },
  { lat: 29.7553042, lon: -95.4198450 },
  { lat: 29.7554788, lon: -95.4198986 },
  { lat: 29.7555230, lon: -95.4199335 },
  { lat: 29.7555463, lon: -95.4199764 },
  { lat: 29.7555650, lon: -95.4200434 },
  { lat: 29.7555696, lon: -95.4201266 },
  { lat: 29.7555370, lon: -95.4202097 },
  { lat: 29.7554346, lon: -95.4203144 },
  { lat: 29.7552483, lon: -95.4204565 },
  { lat: 29.7550294, lon: -95.4205960 },
  { lat: 29.7547919, lon: -95.4206899 },
  { lat: 29.7545194, lon: -95.4207650 },
  { lat: 29.7542423, lon: -95.4207945 },
];

const CHERRYHURST_PARK_CENTER = { lat: 29.7442870, lng: -95.3984587 };
const CHERRYHURST_PARK_OSM_WAY_ID = '87450845';
const CHERRYHURST_PARK_FOOTPRINT = [
  { lat: 29.7443799, lon: -95.3990871 },
  { lat: 29.7437791, lon: -95.3987123 },
  { lat: 29.7441940, lon: -95.3978302 },
  { lat: 29.7447948, lon: -95.3982051 },
  { lat: 29.7443799, lon: -95.3990871 },
];

const SPOTTS_PARK_CENTER = { lat: 29.7649672, lng: -95.3959186 };
const SPOTTS_PARK_OSM_WAY_ID = '54030375';
const SPOTTS_PARK_FOOTPRINT = [
  { lat: 29.7658252, lon: -95.3975612 },
  { lat: 29.7657720, lon: -95.3975608 },
  { lat: 29.7655255, lon: -95.3975590 },
  { lat: 29.7653177, lon: -95.3974742 },
  { lat: 29.7650894, lon: -95.3973277 },
  { lat: 29.7648450, lon: -95.3971575 },
  { lat: 29.7646648, lon: -95.3969837 },
  { lat: 29.7644178, lon: -95.3965052 },
  { lat: 29.7642325, lon: -95.3960726 },
  { lat: 29.7641457, lon: -95.3957130 },
  { lat: 29.7639529, lon: -95.3949912 },
  { lat: 29.7637659, lon: -95.3941657 },
  { lat: 29.7636157, lon: -95.3936408 },
  { lat: 29.7634604, lon: -95.3931367 },
  { lat: 29.7634003, lon: -95.3929210 },
  { lat: 29.7633273, lon: -95.3926253 },
  { lat: 29.7634635, lon: -95.3926113 },
  { lat: 29.7635570, lon: -95.3931100 },
  { lat: 29.7637767, lon: -95.3938339 },
  { lat: 29.7639319, lon: -95.3943412 },
  { lat: 29.7641575, lon: -95.3946086 },
  { lat: 29.7652532, lon: -95.3945896 },
  { lat: 29.7665466, lon: -95.3946335 },
  { lat: 29.7665461, lon: -95.3946519 },
  { lat: 29.7664921, lon: -95.3946670 },
  { lat: 29.7664597, lon: -95.3947142 },
  { lat: 29.7664337, lon: -95.3947912 },
  { lat: 29.7664372, lon: -95.3948742 },
  { lat: 29.7664942, lon: -95.3949627 },
  { lat: 29.7665937, lon: -95.3950402 },
  { lat: 29.7665884, lon: -95.3956306 },
  { lat: 29.7660481, lon: -95.3956323 },
  { lat: 29.7660439, lon: -95.3962784 },
  { lat: 29.7660929, lon: -95.3964940 },
  { lat: 29.7663551, lon: -95.3965986 },
  { lat: 29.7663543, lon: -95.3969067 },
  { lat: 29.7665632, lon: -95.3969133 },
  { lat: 29.7665145, lon: -95.3970582 },
  { lat: 29.7664619, lon: -95.3972378 },
  { lat: 29.7661869, lon: -95.3973623 },
  { lat: 29.7659218, lon: -95.3975049 },
  { lat: 29.7658308, lon: -95.3975153 },
  { lat: 29.7658252, lon: -95.3975612 },
];

const KNOX_PARK_CENTER = { lat: 29.7661730, lng: -95.3978686 };
const KNOX_PARK_OSM_WAY_ID = '221233748';
const KNOX_PARK_FOOTPRINT = [
  { lat: 29.7657631, lon: -95.3980504 },
  { lat: 29.7657557, lon: -95.3980342 },
  { lat: 29.7657841, lon: -95.3980022 },
  { lat: 29.7660635, lon: -95.3977822 },
  { lat: 29.7662824, lon: -95.3976293 },
  { lat: 29.7664169, lon: -95.3975621 },
  { lat: 29.7664588, lon: -95.3975460 },
  { lat: 29.7664914, lon: -95.3975702 },
  { lat: 29.7664961, lon: -95.3976453 },
  { lat: 29.7664914, lon: -95.3980449 },
  { lat: 29.7659815, lon: -95.3980235 },
  { lat: 29.7658120, lon: -95.3980397 },
  { lat: 29.7657631, lon: -95.3980504 },
];

function normalizePlaceText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isParkLikeAmenity(amenity = '') {
  const value = normalizePlaceText(amenity);
  return value === 'park' || value === 'garden' || value === 'nature reserve' || value === 'playground';
}

function normalizeGeoJsonFeature(feature = {}) {
  const geometry = feature?.geometry || {};
  if (geometry.type !== 'Polygon') return null;
  const ring = Array.isArray(geometry.coordinates?.[0]) ? geometry.coordinates[0] : [];
  const footprint = ring
    .map((point) => ({ lon: Number(point?.[0]), lat: Number(point?.[1]) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  if (footprint.length < 3) return null;

  const deduped = [];
  const epsilon = 1e-9;
  footprint.forEach((point) => {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.abs(prev.lat - point.lat) > epsilon || Math.abs(prev.lon - point.lon) > epsilon) {
      deduped.push(point);
    }
  });
  if (deduped.length >= 3) {
    const first = deduped[0];
    const last = deduped[deduped.length - 1];
    if (Math.abs(first.lat - last.lat) <= epsilon && Math.abs(first.lon - last.lon) <= epsilon) {
      deduped.pop();
    }
  }
  if (deduped.length < 3) return null;

  const centerLat = deduped.reduce((sum, point) => sum + point.lat, 0) / deduped.length;
  const centerLon = deduped.reduce((sum, point) => sum + point.lon, 0) / deduped.length;
  return {
    nameKey: normalizePlaceText(feature?.properties?.name || ''),
    osmWayId: String(feature?.properties?.osmWayId || ''),
    source: String(feature?.properties?.source || 'authoritative-geojson'),
    matchRadiusMeters: Math.max(100, Number(feature?.properties?.matchRadiusMeters || 320)),
    centerLat,
    centerLon,
    footprint: deduped,
  };
}

function loadAuthoritativeFootprints() {
  if (authoritativeParkFootprintsLoad) return authoritativeParkFootprintsLoad;
  authoritativeParkFootprintsLoad = fetch(AUTHORITATIVE_FOOTPRINTS_URL)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const features = Array.isArray(data?.features) ? data.features : [];
      authoritativeParkFootprints = features.map(normalizeGeoJsonFeature).filter(Boolean);
      return authoritativeParkFootprints;
    })
    .catch(() => {
      authoritativeParkFootprints = [];
      return authoritativeParkFootprints;
    });
  return authoritativeParkFootprintsLoad;
}

function findAuthoritativeFootprint(place = {}) {
  if (!Array.isArray(authoritativeParkFootprints) || !authoritativeParkFootprints.length) return null;
  const nameKey = normalizePlaceText(place?.name || '');
  const amenity = normalizePlaceText(place?.amenity || '');
  const lat = Number(place?.lat);
  const lng = Number(place?.lng);

  for (const candidate of authoritativeParkFootprints) {
    if (!candidate?.footprint) continue;
    if (candidate.osmWayId && hasOsmWayId(place, candidate.osmWayId)) {
      return {
        footprint: candidate.footprint,
        source: 'authoritative-footprint',
        authority: candidate.source,
      };
    }
  }

  for (const candidate of authoritativeParkFootprints) {
    if (!candidate?.footprint) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!isParkLikeAmenity(amenity)) continue;
    const byName = nameKey && candidate.nameKey && nameKey.includes(candidate.nameKey);
    const nearCenter = getDistanceMeters(lat, lng, candidate.centerLat, candidate.centerLon) <= candidate.matchRadiusMeters;
    if (byName || nearCenter) {
      return {
        footprint: candidate.footprint,
        source: 'authoritative-footprint',
        authority: candidate.source,
      };
    }
  }
  return null;
}

function hasOsmWayId(place = {}, osmWayId = '') {
  if (!osmWayId) return false;
  const rawId = String(place?.id || '');
  return rawId === `osm-${osmWayId}` || rawId.endsWith(`-${osmWayId}`) || rawId.includes(osmWayId);
}

function isValidFootprint(footprint) {
  return Array.isArray(footprint)
    && footprint.length >= 3
    && footprint.every((point) => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lon ?? point?.lng)));
}

function createRadiusFallbackFootprint(place = {}) {
  const lat = Number(place?.lat);
  const lng = Number(place?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const radiusMeters = Math.max(30, Number(place?.radiusMeters || place?.radius || POI_RADIUS || 50));
  const northSouthRadiusMeters = radiusMeters * 0.88;
  const eastWestRadiusMeters = radiusMeters;
  const lonScale = Math.max(0.000001, Math.cos((lat * Math.PI) / 180));

  // Use a rounded 12-point footprint so unknown places do not render as hard rectangles.
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

function getFootprintOverrideForPlace(place = {}) {
  const name = normalizePlaceText(place?.name || '');
  const amenity = normalizePlaceText(place?.amenity || '');
  const lat = Number(place?.lat);
  const lng = Number(place?.lng);

  if (hasOsmWayId(place, LIVE_OAK_OSM_WAY_ID)) return { footprint: LIVE_OAK_PARK_FOOTPRINT, source: 'known-override' };
  if (hasOsmWayId(place, SHEPHERD_PARK_OSM_WAY_ID)) return { footprint: SHEPHERD_PARK_FOOTPRINT, source: 'known-override' };
  if (hasOsmWayId(place, HOMEWOOD_PARK_OSM_WAY_ID)) return { footprint: HOMEWOOD_PARK_FOOTPRINT, source: 'known-override' };
  if (hasOsmWayId(place, CHERRYHURST_PARK_OSM_WAY_ID)) return { footprint: CHERRYHURST_PARK_FOOTPRINT, source: 'known-override' };
  if (hasOsmWayId(place, SPOTTS_PARK_OSM_WAY_ID)) return { footprint: SPOTTS_PARK_FOOTPRINT, source: 'known-override' };
  if (hasOsmWayId(place, KNOX_PARK_OSM_WAY_ID)) return { footprint: KNOX_PARK_FOOTPRINT, source: 'known-override' };

  const looksLikeLiveOak = name.includes('live oak park');
  const looksLikeShepherdPark = name.includes('shepherd park');
  const looksLikeHomewoodPark = name.includes('homewood park');
  const looksLikeCherryhurstPark = name.includes('cherryhurst park');
  const looksLikeSpottsPark = name.includes('spotts park');
  const looksLikeKnoxPark = name.includes('knox park');
  const nearbyLiveOakCenter = Number.isFinite(lat) && Number.isFinite(lng)
    && getDistanceMeters(lat, lng, LIVE_OAK_PARK_CENTER.lat, LIVE_OAK_PARK_CENTER.lng) <= 280;
  const nearbyShepherdParkCenter = Number.isFinite(lat) && Number.isFinite(lng)
    && getDistanceMeters(lat, lng, SHEPHERD_PARK_CENTER.lat, SHEPHERD_PARK_CENTER.lng) <= 320;
  const nearbyHomewoodParkCenter = Number.isFinite(lat) && Number.isFinite(lng)
    && getDistanceMeters(lat, lng, HOMEWOOD_PARK_CENTER.lat, HOMEWOOD_PARK_CENTER.lng) <= 320;
  const nearbyCherryhurstParkCenter = Number.isFinite(lat) && Number.isFinite(lng)
    && getDistanceMeters(lat, lng, CHERRYHURST_PARK_CENTER.lat, CHERRYHURST_PARK_CENTER.lng) <= 320;
  const nearbySpottsParkCenter = Number.isFinite(lat) && Number.isFinite(lng)
    && getDistanceMeters(lat, lng, SPOTTS_PARK_CENTER.lat, SPOTTS_PARK_CENTER.lng) <= 360;
  const nearbyKnoxParkCenter = Number.isFinite(lat) && Number.isFinite(lng)
    && getDistanceMeters(lat, lng, KNOX_PARK_CENTER.lat, KNOX_PARK_CENTER.lng) <= 240;

  if (looksLikeLiveOak || (amenity === 'park' && nearbyLiveOakCenter)) {
    return { footprint: LIVE_OAK_PARK_FOOTPRINT, source: 'known-override' };
  }
  if (looksLikeShepherdPark || (amenity === 'park' && nearbyShepherdParkCenter)) {
    return { footprint: SHEPHERD_PARK_FOOTPRINT, source: 'known-override' };
  }
  if (looksLikeHomewoodPark || (amenity === 'park' && nearbyHomewoodParkCenter)) {
    return { footprint: HOMEWOOD_PARK_FOOTPRINT, source: 'known-override' };
  }
  if (looksLikeCherryhurstPark || (amenity === 'park' && nearbyCherryhurstParkCenter)) {
    return { footprint: CHERRYHURST_PARK_FOOTPRINT, source: 'known-override' };
  }
  if (looksLikeSpottsPark || (amenity === 'park' && nearbySpottsParkCenter)) {
    return { footprint: SPOTTS_PARK_FOOTPRINT, source: 'known-override' };
  }
  if (looksLikeKnoxPark || (amenity === 'park' && nearbyKnoxParkCenter)) {
    return { footprint: KNOX_PARK_FOOTPRINT, source: 'known-override' };
  }
  return null;
}

function resolveRoomFootprint(place = {}, fetchedFootprint = null) {
  const authoritative = findAuthoritativeFootprint(place);
  if (authoritative?.footprint) return authoritative;
  const override = getFootprintOverrideForPlace(place);
  if (override?.footprint) return override;
  const fetchedGeometry = Array.isArray(fetchedFootprint)
    ? fetchedFootprint
    : Array.isArray(fetchedFootprint?.geometry)
      ? fetchedFootprint.geometry
      : null;
  if (isValidFootprint(fetchedGeometry)) return { footprint: fetchedGeometry, source: 'provider-footprint' };
  const fallback = createRadiusFallbackFootprint(place);
  if (fallback) return { footprint: fallback, source: 'radius-fallback' };
  return null;
}

function deriveElementCoords(element) {
  if (Number.isFinite(element?.lat) && Number.isFinite(element?.lon)) {
    return { lat: element.lat, lng: element.lon };
  }
  if (Number.isFinite(element?.center?.lat) && Number.isFinite(element?.center?.lon)) {
    return { lat: element.center.lat, lng: element.center.lon };
  }
  if (Array.isArray(element?.geometry) && element.geometry.length > 0) {
    const points = element.geometry.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon));
    if (!points.length) return { lat: null, lng: null };
    const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
    const lng = points.reduce((sum, point) => sum + point.lon, 0) / points.length;
    return { lat, lng };
  }
  return { lat: null, lng: null };
}

// Fetch nearby POIs from OpenStreetMap Overpass API (free, no key)
async function fetchNearbyPOIs(lat, lng, radiusMeters = 800) {
  try {
    const res = await fetch(`${SOCKET_SERVER_URL}/api/nearby-places?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius=${encodeURIComponent(radiusMeters)}`);
    if (!res.ok) return [];
    const elements = await res.json();
    return (Array.isArray(elements) ? elements : []).map((el) => {
      const coords = deriveElementCoords(el);
      const typeInfo = POI_TYPES.find((t) => el.tags?.[t.tag] === t.value) || { emoji: '📍', color: '#94a3b8', label: 'Place', value: 'default' };
      return {
        id: `osm-${el.id}`,
        name: el.tags?.name || typeInfo.label,
        lat: coords.lat,
        lng: coords.lng,
        radiusMeters: POI_RADIUS,
        kind: 'osm',
        amenity: typeInfo.value,
        emoji: typeInfo.emoji,
        color: typeInfo.color,
        tags: el.tags || {},
      };
    }).filter((poi) => Number.isFinite(poi.lat) && Number.isFinite(poi.lng));
  } catch {
    return [];
  }
}

// Fetch the building polygon footprint nearest to a given point
async function fetchBuildingFootprint(lat, lng) {
  try {
    const res = await fetch(`${SOCKET_SERVER_URL}/api/building-footprint?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchIndoorLayout(lat, lng) {
  try {
    const res = await fetch(`${SOCKET_SERVER_URL}/api/indoor-layout?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function shouldProbeIndoorLayout(place = {}) {
  const text = `${place?.id || ''} ${place?.name || ''} ${place?.amenity || ''} ${place?.shop || ''}`.toLowerCase();
  if (!text.trim()) return false;
  if (text.includes('park') || text.includes('garden') || text.includes('forest') || text.includes('trail')) return false;
  return Boolean(place?.lat && place?.lng) || Boolean(place?.tags?.building || place?.tags?.indoor || place?.tags?.level || place?.tags?.repeat_on);
}

function attachIndoorLayout(place, baseRoom = {}, onEnterRoom = () => {}) {
  if (!shouldProbeIndoorLayout(place)) return;
  fetchIndoorLayout(place.lat, place.lng).then((layout) => {
    if (!layout?.elements?.length) return;
    onEnterRoom(place.id, {
      ...baseRoom,
      ...place,
      indoorLayout: layout,
      indoorLayoutSource: 'provider-indoor',
    });
  });
}

const ROOM_STYLES = {
  'starbucks-spring': { color: '#00704a', emoji: '☕' },
  'mcdonalds-practice': { color: '#ffbc0d', emoji: '🍟' },
  'agora-houston':    { color: '#9333ea', emoji: '🍷' },
  'downtown-hub':     { color: '#60a5fa', emoji: '🏙️' },
  'forest-gate':      { color: '#4ade80', emoji: '🌲' },
  'sunset-temple':    { color: '#f472b6', emoji: '⛩️' },
  'campfire-circle':  { color: '#f97316', emoji: '🔥' },
};

export default function MapView({ location, rooms, onEnterRoom }) {
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const playerMarkerRef = useRef(null);
  const onEnterRoomRef = useRef(onEnterRoom);
  const allPinsRef = useRef([]);
  const [poiCount, setPoiCount] = useState(0);
  const [poiStatus, setPoiStatus] = useState('loading');
  const poiStatusRef = useRef('loading');
  const poiLoadedRef = useRef(false);
  const lastFetchPosRef = useRef(null);
  const roomCountsRef = useRef({});

  const updatePoiStatus = (nextStatus) => {
    poiStatusRef.current = nextStatus;
    setPoiStatus(nextStatus);
  };

  const withDiscoveryMeta = (roomData = {}) => {
    const status = poiStatusRef.current || 'loading';
    return {
      ...roomData,
      poiDiscoveryStatus: status,
      poiDiscoveryPending: status === 'loading',
    };
  };

  const loadPOIs = (lat, lng) => {
    if (!leafletRef.current) return;
    updatePoiStatus('loading');
    fetchNearbyPOIs(lat, lng, 1000).then(pois => {
      if (!leafletRef.current) return;
      // Remove old POI markers
      allPinsRef.current = allPinsRef.current.filter(pin => {
        if (pin.isOSM) { pin.marker.remove(); pin.circle.remove(); return false; }
        return true;
      });
      const manualCoords = rooms.filter(r => r.lat).map(r => [r.lat, r.lng]);
      const filtered = pois.filter(poi =>
        !manualCoords.some(([rlat, rlng]) => getDistanceMeters(poi.lat, poi.lng, rlat, rlng) < 40)
      );
      filtered.forEach(poi => {
        addPin(leafletRef.current, poi.lat, poi.lng, poi.name, poi.emoji, poi.color, poi.radiusMeters,
          () => {
            const initialResult = resolveRoomFootprint(poi, null);
            onEnterRoomRef.current(
              poi.id,
              initialResult?.footprint
                ? withDiscoveryMeta({ ...poi, footprint: initialResult.footprint, footprintSource: initialResult.source })
                : withDiscoveryMeta({ ...poi }),
            );
            attachIndoorLayout(poi, initialResult?.footprint
              ? { ...poi, footprint: initialResult.footprint, footprintSource: initialResult.source }
              : { ...poi }, onEnterRoomRef.current);
            if (initialResult?.source === 'known-override' || initialResult?.source === 'provider-footprint') return;
            fetchBuildingFootprint(poi.lat, poi.lng).then(footprint => {
              const resolvedResult = resolveRoomFootprint(poi, footprint);
              if (resolvedResult?.footprint) {
                onEnterRoomRef.current(poi.id, {
                  ...withDiscoveryMeta(),
                  ...poi,
                  footprint: resolvedResult.footprint,
                  footprintSource: resolvedResult.source,
                  tags: { ...(poi.tags || {}), ...(footprint?.tags || {}) },
                });
              }
            });
          }, true);
      });
      // Re-evaluate all pins with current position
      const lat2 = playerMarkerRef.current?.getLatLng()?.lat || lat;
      const lng2 = playerMarkerRef.current?.getLatLng()?.lng || lng;
      updateAllPins(lat2, lng2);
      setPoiCount(filtered.length);
      updatePoiStatus(filtered.length > 0 ? 'found' : 'none');
      poiLoadedRef.current = true;
      lastFetchPosRef.current = { lat, lng };
    }).catch(() => updatePoiStatus('error'));
  };

  useEffect(() => { onEnterRoomRef.current = onEnterRoom; });

  useEffect(() => {
    loadAuthoritativeFootprints();
  }, []);

  // Subscribe to live room counts from the server
  useEffect(() => {
    const socket = io(SOCKET_SERVER_URL, { transports: ['websocket'] });
    socket.on('room_counts', (counts) => {
      roomCountsRef.current = counts;
      const pos = playerMarkerRef.current?.getLatLng();
      if (pos) updateAllPins(pos.lat, pos.lng);
    });
    socket.on('community_location_added', (loc) => {
      if (!leafletRef.current) return;
      addPin(leafletRef.current, loc.lat, loc.lng, loc.name, loc.emoji || '📍', loc.color || '#f97316', loc.radius || 50,
        () => {
          const initialResult = resolveRoomFootprint(loc, null);
          onEnterRoomRef.current(
            loc.id,
            initialResult?.footprint
              ? withDiscoveryMeta({ ...loc, footprint: initialResult.footprint, footprintSource: initialResult.source })
              : withDiscoveryMeta({ ...loc }),
          );
          attachIndoorLayout(loc, initialResult?.footprint
            ? { ...loc, footprint: initialResult.footprint, footprintSource: initialResult.source }
            : { ...loc }, onEnterRoomRef.current);
          if (initialResult?.source === 'known-override' || initialResult?.source === 'provider-footprint') return;
          fetchBuildingFootprint(loc.lat, loc.lng).then(footprint => {
            const resolvedResult = resolveRoomFootprint(loc, footprint);
            if (resolvedResult?.footprint) {
              onEnterRoomRef.current(loc.id, {
                ...withDiscoveryMeta(),
                ...loc,
                footprint: resolvedResult.footprint,
                footprintSource: resolvedResult.source,
                tags: { ...(loc.tags || {}), ...(footprint?.tags || {}) },
              });
            }
          });
        }, false, loc.id);
      const pos = playerMarkerRef.current?.getLatLng();
      if (pos) updateAllPins(pos.lat, pos.lng);
    });
    return () => socket.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch existing community locations on mount
  useEffect(() => {
    fetch(`${SOCKET_SERVER_URL}/api/community-locations`)
      .then(r => r.json())
      .then(locs => {
        if (!leafletRef.current) return;
        locs.forEach(loc => {
          addPin(leafletRef.current, loc.lat, loc.lng, loc.name, loc.emoji || '📍', loc.color || '#f97316', loc.radius || 50,
            () => {
              const initialResult = resolveRoomFootprint(loc, null);
              onEnterRoomRef.current(
                loc.id,
                initialResult?.footprint
                  ? withDiscoveryMeta({ ...loc, footprint: initialResult.footprint, footprintSource: initialResult.source })
                  : withDiscoveryMeta({ ...loc }),
              );
              attachIndoorLayout(loc, initialResult?.footprint
                ? { ...loc, footprint: initialResult.footprint, footprintSource: initialResult.source }
                : { ...loc }, onEnterRoomRef.current);
              if (initialResult?.source === 'known-override' || initialResult?.source === 'provider-footprint') return;
              fetchBuildingFootprint(loc.lat, loc.lng).then(footprint => {
                const resolvedResult = resolveRoomFootprint(loc, footprint);
                if (resolvedResult?.footprint) {
                  onEnterRoomRef.current(loc.id, {
                    ...withDiscoveryMeta(),
                    ...loc,
                    footprint: resolvedResult.footprint,
                    footprintSource: resolvedResult.source,
                    tags: { ...(loc.tags || {}), ...(footprint?.tags || {}) },
                  });
                }
              });
            }, false, loc.id);
        });
        const pos = playerMarkerRef.current?.getLatLng();
        if (pos) updateAllPins(pos.lat, pos.lng);
      }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Build icon HTML based on current in-range state
  const makeIcon = (emoji, color, name, inRange, count) => L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;cursor:${inRange ? 'pointer' : 'default'};opacity:${inRange ? '1' : '0.78'}">
      <div style="background:${color};font-size:16px;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid #2b2b33;box-shadow:2px 2px 0 #2b2b33">${emoji}</div>
      <div style="background:rgba(250,240,215,0.98);color:#1f2937;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;margin-top:2px;white-space:nowrap;font-family:'Courier New',monospace;max-width:96px;overflow:hidden;text-overflow:ellipsis;border:1.5px solid #111827;box-shadow:2px 2px 0 rgba(17,24,39,0.85);text-shadow:0 1px 0 rgba(255,255,255,0.75)">${name}${inRange ? ' ✦' : ''}${count ? ` · 👤${count}` : ''}</div>
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #2b2b33"></div>
    </div>`,
    iconSize: [80, 58], iconAnchor: [40, 58],
  });

  // Re-evaluate every pin's visual against current player position — CSS only, no DOM replacement
  const updateAllPins = (playerLat, playerLng) => {
    allPinsRef.current.forEach(pin => {
      const dist = getDistanceMeters(playerLat, playerLng, pin.lat, pin.lng);
      const inRange = dist <= pin.radiusMeters;
      const count = roomCountsRef.current[pin.roomId] || 0;
      const el = pin.marker.getElement();
      if (el) {
        el.style.filter = inRange ? 'none' : 'none';
        el.style.opacity = inRange ? '1' : '0.78';
        el.style.cursor = inRange ? 'pointer' : 'default';
        const dot = el.querySelector('div > div:first-child');
        if (dot) dot.style.boxShadow = inRange ? `0 0 10px ${pin.color}cc` : `0 0 5px ${pin.color}88`;
        const label = el.querySelector('div > div:nth-child(2)');
        if (label) {
          label.textContent = pin.name + (inRange ? ' ✦' : '') + (count ? ` · 👤${count}` : '');
          label.style.background = inRange ? 'rgba(250,240,215,0.98)' : 'rgba(250,240,215,1)';
          label.style.color = '#111827';
          label.style.opacity = '1';
          label.style.textShadow = '0 1px 0 rgba(255,255,255,0.8)';
        }
      }
      pin.circle.setStyle({
        fillOpacity: inRange ? 0.15 : 0.05,
        weight: inRange ? 2 : 1,
        opacity: inRange ? 0.8 : 0.3,
        dashArray: inRange ? null : '6',
      });
    });
  };

  const addPin = (layer, lat, lng, name, emoji, color, radiusMeters, onTap, isOSM = false, roomId = null) => {
    const dist = location ? getDistanceMeters(location.latitude, location.longitude, lat, lng) : Infinity;
    const inRange = dist <= radiusMeters;
    const count = roomCountsRef.current[roomId] || 0;

    const circle = L.circle([lat, lng], {
      radius: radiusMeters, color, fillColor: color,
      fillOpacity: inRange ? 0.15 : 0.05,
      weight: inRange ? 2 : 1,
      opacity: inRange ? 0.8 : 0.3,
      dashArray: inRange ? null : '6',
      interactive: false, // never intercept clicks
    }).addTo(layer);

    const marker = L.marker([lat, lng], { icon: makeIcon(emoji, color, name, inRange, count) }).addTo(layer);

    // Bind directly on DOM element so both mouse and touch work reliably
    const bindTap = () => {
      const el = marker.getElement();
      if (!el) return;
      let touchMoved = false;
      el.addEventListener('touchstart', () => { touchMoved = false; }, { passive: true });
      el.addEventListener('touchmove', () => { touchMoved = true; }, { passive: true });
      el.addEventListener('touchend', (e) => {
        if (touchMoved) return;
        e.preventDefault();
        e.stopPropagation();
        onTap();
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onTap();
      });
    };
    if (marker.getElement()) bindTap();
    else marker.once('add', bindTap);

    allPinsRef.current.push({ marker, circle, lat, lng, radiusMeters, name, emoji, color, onTap, isOSM, roomId });
  };

  useEffect(() => {
    if (leafletRef.current) return;

    const lat = location?.latitude || 29.8368;
    const lng = location?.longitude || -95.4201;

    const map = L.map(mapRef.current, { center: [lat, lng], zoom: 17, zoomControl: false, clickTolerance: 5 });
    leafletRef.current = map;

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 20,
    }).addTo(map);

    // Player dot
    const playerIcon = L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;border-radius:50%;background:#e85d5d;border:3px solid #fff;box-shadow:0 0 0 3px rgba(232,93,93,0.4)"></div>`,
      iconSize: [16, 16], iconAnchor: [8, 8],
    });
    playerMarkerRef.current = L.marker([lat, lng], { icon: playerIcon }).addTo(map);

    // Manual rooms
    rooms.forEach(room => {
      if (!room.lat || !room.lng) return;
      const style = ROOM_STYLES[room.id] || { color: '#a78bfa', emoji: '📍' };
      addPin(map, room.lat, room.lng, room.name, style.emoji, style.color, room.radiusMeters,
        () => {
          const initialResult = resolveRoomFootprint(room, null);
          onEnterRoomRef.current(
            room.id,
            initialResult?.footprint
              ? withDiscoveryMeta({ ...room, footprint: initialResult.footprint, footprintSource: initialResult.source })
              : withDiscoveryMeta({ ...room }),
          );
              attachIndoorLayout(room, initialResult?.footprint
                ? { ...room, footprint: initialResult.footprint, footprintSource: initialResult.source }
                : { ...room }, onEnterRoomRef.current);
          if (initialResult?.source === 'known-override' || initialResult?.source === 'provider-footprint') return;
          fetchBuildingFootprint(room.lat, room.lng).then(footprint => {
            const resolvedResult = resolveRoomFootprint(room, footprint);
            if (resolvedResult?.footprint) {
              onEnterRoomRef.current(room.id, {
                ...withDiscoveryMeta(),
                ...room,
                footprint: resolvedResult.footprint,
                footprintSource: resolvedResult.source,
                tags: { ...(room.tags || {}), ...(footprint?.tags || {}) },
              });
            }
          });
        }, false, room.id);
    });

    // Fetch nearby POIs
    loadPOIs(lat, lng);

    return () => {
      if (leafletRef.current) {
        leafletRef.current.remove();
        leafletRef.current = null;
      }
      playerMarkerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [nearbyRoom, setNearbyRoom] = useState(null); // name of room you're currently inside

  // Update player position AND re-evaluate all pin states when GPS moves
  // Also re-fetch POIs if moved more than 500m from last fetch location
  useEffect(() => {
    if (!leafletRef.current || !location) return;
    const { latitude: lat, longitude: lng } = location;
    playerMarkerRef.current?.setLatLng([lat, lng]);
    leafletRef.current.setView([lat, lng], leafletRef.current.getZoom(), { animate: true, duration: 1 });
    updateAllPins(lat, lng);

    // Check if inside any named room
    const inside = allPinsRef.current.find(pin =>
      !pin.isOSM && getDistanceMeters(lat, lng, pin.lat, pin.lng) <= pin.radiusMeters
    );
    setNearbyRoom(inside?.name || null);

    // Re-fetch if moved >300m, or if initial mount used fallback coords (no real GPS yet)
    if (lastFetchPosRef.current && poiLoadedRef.current) {
      const moved = getDistanceMeters(lat, lng, lastFetchPosRef.current.lat, lastFetchPosRef.current.lng);
      if (moved > 300) loadPOIs(lat, lng);
    } else if (!poiLoadedRef.current) {
      loadPOIs(lat, lng);
    }
  }, [location?.latitude, location?.longitude]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* "You're here" banner when inside a named room's radius */}
      {nearbyRoom && (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: '#faf0d7', color: '#2b2b33', fontFamily: 'Courier New', fontSize: 13, fontWeight: 'bold', padding: '6px 16px', borderRadius: 6, border: '2px solid #2b2b33', boxShadow: '2px 2px 0 #2b2b33', whiteSpace: 'nowrap' }}>
          📍 You're at {nearbyRoom} — tap the pin to enter
        </div>
      )}
      {/* Legend */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 1000, background: '#faf0d7', border: '2px solid #2b2b33', borderRadius: 8, padding: '8px 12px', fontFamily: 'Courier New', fontSize: 11, color: '#2b2b33', boxShadow: '2px 2px 0 #2b2b33' }}>
        <div style={{ color: '#5a3e2b', fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 2 }}>Nearby places</div>
        <div>✦ Tap a lit pin to enter</div>
        {poiStatus === 'loading' && <div style={{ marginTop: 4, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>Discovering…</span>
          <span style={{ animation: 'pulse 1s infinite', fontSize: 14 }}>⟳</span>
        </div>}
        {poiStatus === 'found' && <div style={{ marginTop: 4, color: '#4ade80' }}>{poiCount} places found</div>}
        {(poiStatus === 'none' || poiStatus === 'error') && (
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ color: poiStatus === 'error' ? '#ef4444' : '#f97316' }}>
              {poiStatus === 'error' ? 'Load failed' : 'None found nearby'}
            </div>
            <button onClick={() => {
              const pos = playerMarkerRef.current?.getLatLng();
              if (pos) loadPOIs(pos.lat, pos.lng);
            }} style={{ background: '#faf0d7', border: '2px solid #2b2b33', color: '#2b2b33', padding: '3px 8px', cursor: 'pointer', fontFamily: 'Courier New', fontSize: 10, borderRadius: 4, boxShadow: '1px 1px 0 #2b2b33' }}>
              ↺ Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
