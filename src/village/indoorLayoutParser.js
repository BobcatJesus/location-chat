const DEFAULT_WIDTH = 1600;
const DEFAULT_HEIGHT = 900;

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'room';
}

function toFiniteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePolygonPoints(points, targetW = DEFAULT_WIDTH, targetH = DEFAULT_HEIGHT) {
  if (!Array.isArray(points)) return null;

  const raw = points.map((point) => {
    if (!point || typeof point !== 'object') return null;
    return {
      x: toFiniteNumber(point.x ?? point.lon ?? point.lng ?? point.y),
      y: toFiniteNumber(point.y ?? point.lat ?? point.x),
      lat: toFiniteNumber(point.lat ?? point.y),
      lon: toFiniteNumber(point.lon ?? point.lng ?? point.x),
      hasLatLon: Number.isFinite(point.lat) || Number.isFinite(point.lon),
    };
  }).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (raw.length < 3) return null;

  const useGeoProjection = raw.some((point) => point.hasLatLon);
  if (!useGeoProjection) {
    return raw.map((point) => ({ x: point.x, y: point.y }));
  }

  const latLon = raw.map((point) => ({ lat: point.lat, lon: point.lon }));
  const meanLat = latLon.reduce((sum, point) => sum + point.lat, 0) / latLon.length;
  const lonScale = Math.max(0.000001, Math.cos((meanLat * Math.PI) / 180));
  const minLon = Math.min(...latLon.map((point) => point.lon));
  const maxLon = Math.max(...latLon.map((point) => point.lon));
  const minLat = Math.min(...latLon.map((point) => point.lat));
  const maxLat = Math.max(...latLon.map((point) => point.lat));
  const spanLon = (maxLon - minLon) * lonScale;
  const spanLat = maxLat - minLat;
  if (spanLon <= 0 || spanLat <= 0) return null;

  const pad = Math.max(24, Math.min(120, Math.round(Math.min(targetW, targetH) * 0.08)));
  const drawW = Math.max(120, targetW - pad * 2);
  const drawH = Math.max(120, targetH - pad * 2);
  const scale = Math.min(drawW / spanLon, drawH / spanLat);
  const ox = (targetW - spanLon * scale) / 2;
  const oy = (targetH - spanLat * scale) / 2;

  return latLon.map((point) => ({
    x: ox + ((point.lon - minLon) * lonScale) * scale,
    y: oy + (maxLat - point.lat) * scale,
  }));
}

function normalizePointList(points) {
  if (!Array.isArray(points)) return null;
  const normalized = points.map(normalizePoint).filter(Boolean);
  return normalized.length >= 3 ? normalized : null;
}

function looksLikeFloor(value) {
  if (!value || typeof value !== 'object') return false;
  return Boolean(
    value.zones || value.rooms || value.features || value.elements || value.items || value.objects || value.furniture ||
    value.outline || value.boundary || value.footprint || value.points || value.level != null || value.floor != null
  );
}

function getSourceObject(room = {}) {
  if (room.indoorLayout && typeof room.indoorLayout === 'object') return room.indoorLayout;
  if (room.floorplan && typeof room.floorplan === 'object') return room.floorplan;
  if (room.floorPlan && typeof room.floorPlan === 'object') return room.floorPlan;
  if (Array.isArray(room.indoorFloors)) return { floors: room.indoorFloors };
  if (Array.isArray(room.levels)) return { floors: room.levels };
  if (Array.isArray(room.elements)) return { elements: room.elements };
  if (Array.isArray(room.floors) && room.floors.some(looksLikeFloor)) return { floors: room.floors };
  if (looksLikeFloor(room)) return room;
  return null;
}

function getLevelKey(value = {}) {
  const raw = String(value?.level ?? value?.tags?.level ?? value?.tags?.repeat_on ?? value?.floor ?? value?.tags?.floor ?? '').trim();
  if (!raw) return '0';
  const first = raw.split(';')[0].trim();
  return first || '0';
}

function normalizeRawElementGeometry(element = {}) {
  const geometry = Array.isArray(element.geometry)
    ? element.geometry
    : Array.isArray(element.points)
      ? element.points
      : Array.isArray(element.outline)
        ? element.outline
        : null;
  return normalizePolygonPoints(geometry);
}

function inferElementZoneType(element = {}) {
  const tags = element.tags || {};
  const raw = String(element.type || element.kind || tags.indoor || tags.amenity || tags.highway || tags.shop || tags.leisure || '').toLowerCase();
  const name = String(tags.name || element.name || element.label || '').toLowerCase();
  const combined = `${raw} ${name}`;

  if (combined.includes('stairs') || combined.includes('stair')) return 'stairwell';
  if (combined.includes('escalator')) return 'escalator';
  if (combined.includes('bookshelf') || combined.includes('bookcase') || combined.includes('book shelf') || combined.includes('shelf')) return 'shelf';
  if (combined.includes('table') || combined.includes('desk')) return 'table';
  if (combined.includes('chair') || combined.includes('seat') || combined.includes('bench')) return 'chair';
  if (combined.includes('railing') || combined.includes('rail')) return 'railing';
  if (combined.includes('atrium') || combined.includes('void') || combined.includes('open')) return 'atrium';
  if (combined.includes('corridor')) return 'corridor';
  if (combined.includes('screen')) return 'screen';
  if (combined.includes('counter')) return 'counter';
  if (combined.includes('room') || combined.includes('area') || combined.includes('building:part') || combined.includes('wall')) return 'zone';
  return inferZoneType(element);
}

function getInferredPlacement(type = 'zone', index = 0, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'stairwell' || normalized === 'stairs' || normalized === 'escalator') {
    return {
      x: Math.max(24, Math.round((width - 140) / 2)),
      y: Math.max(24, Math.round(height * 0.08)),
      w: 140,
      h: 210,
    };
  }

  return {
    x: (index * 80) % Math.max(1, width),
    y: (index * 60) % Math.max(1, height),
    w: 60,
    h: 40,
  };
}

function isStairZoneType(type = '') {
  const normalized = String(type || '').toLowerCase();
  return normalized === 'stairwell' || normalized === 'stairs' || normalized === 'escalator' || normalized === 'escalator_up' || normalized === 'escalator_down';
}

function applyNorthEntryStairAnchor(floor = {}, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  const zones = Array.isArray(floor?.zones) ? floor.zones : [];
  if (!zones.length) return floor;

  const candidates = zones.filter((zone) => {
    const type = String(zone?.type || '').toLowerCase();
    const hasPosition = Number.isFinite(zone?.x) && Number.isFinite(zone?.y);
    return hasPosition && (type === 'entry' || type === 'door' || type === 'entrance' || type === 'counter');
  });
  if (!candidates.length) return floor;

  const northCandidates = candidates.filter((zone) => {
    const centerY = zone.y + (toFiniteNumber(zone.h, 0) / 2);
    return centerY <= height * 0.35;
  });
  const anchorSource = (northCandidates.length ? northCandidates : candidates)
    .slice()
    .sort((a, b) => (a.y + (toFiniteNumber(a.h, 0) / 2)) - (b.y + (toFiniteNumber(b.h, 0) / 2)))[0];

  const anchorX = anchorSource.x + (toFiniteNumber(anchorSource.w, 0) / 2);
  const anchorY = Math.max(24, Math.min(height * 0.22, anchorSource.y + toFiniteNumber(anchorSource.h, 0) + 18));

  let changed = false;
  const nextZones = zones.map((zone) => {
    if (!zone?._inferredPosition || !isStairZoneType(zone.type)) return zone;

    const stairW = Math.max(80, toFiniteNumber(zone.w, 140));
    const stairH = Math.max(120, toFiniteNumber(zone.h, 210));
    const nx = Math.max(24, Math.min(width - stairW - 24, Math.round(anchorX - stairW / 2)));
    const ny = Math.max(24, Math.min(height - stairH - 24, Math.round(anchorY)));
    changed = true;
    return { ...zone, x: nx, y: ny, w: stairW, h: stairH };
  });

  return changed ? { ...floor, zones: nextZones } : floor;
}

function normalizeRawElement(element = {}, index = 0, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  if (!element || typeof element !== 'object') return null;
  const type = inferElementZoneType(element);
  const outline = normalizeRawElementGeometry(element);
  const tags = element.tags || {};

  if (outline && (type === 'zone' || type === 'corridor' || type === 'room' || type === 'area')) {
    return { type: 'wall_polygon', points: outline, label: tags.name || element.name || element.label || '', toFloor: element.toFloor };
  }

  if (outline && type === 'atrium') {
    return { type: 'void', points: outline, label: tags.name || element.name || element.label || '' };
  }

  const centroid = outline && outline.length >= 3
    ? outline.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 })
    : null;

  const inferred = getInferredPlacement(type, index, width, height);
  const x = toFiniteNumber(element.x ?? element.cx ?? element.center?.x ?? centroid?.x, null);
  const y = toFiniteNumber(element.y ?? element.cy ?? element.center?.y ?? centroid?.y, null);
  const w = toFiniteNumber(element.w ?? element.width, inferred.w);
  const h = toFiniteNumber(element.h ?? element.height, inferred.h);
  const inferredPosition = x == null || y == null;

  return {
    type,
    x: x ?? inferred.x,
    y: y ?? inferred.y,
    w,
    h,
    label: tags.name || element.name || element.label || '',
    solid: element.solid,
    interact: element.interact,
    toFloor: element.toFloor,
    _inferredPosition: inferredPosition,
  };
}

function inferZoneType(zone = {}) {
  const raw = String(zone.type || zone.kind || zone.feature || zone.tag || zone.name || zone.label || '').toLowerCase();
  if (!raw) return 'decoration';
  if (raw.includes('stair')) return 'stairwell';
  if (raw.includes('bookshelf') || raw.includes('bookcase') || raw.includes('book shelf') || raw.includes('shelf')) return 'shelf';
  if (raw.includes('table') || raw.includes('desk')) return 'table';
  if (raw.includes('chair') || raw.includes('seat') || raw.includes('bench')) return 'chair';
  if (raw.includes('railing') || raw.includes('rail')) return 'railing';
  if (raw.includes('atrium') || raw.includes('void') || raw.includes('open')) return 'atrium';
  if (raw.includes('screen')) return 'screen';
  if (raw.includes('counter') || raw.includes('desk')) return 'counter';
  if (raw.includes('room') || raw.includes('area') || raw.includes('space')) return 'zone';
  return raw;
}

function normalizeZone(zone = {}, index = 0, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  if (!zone || typeof zone !== 'object') return null;
  const type = inferZoneType(zone);
  const outline = normalizePolygonPoints(zone.outline || zone.boundary || zone.footprint || zone.points || zone.geometry);

  if (outline && type === 'atrium') {
    return { type: 'void', points: outline, label: zone.label || zone.name || '' };
  }

  if (outline && (type === 'zone' || type === 'room' || type === 'area')) {
    return { type: 'wall_polygon', points: outline, label: zone.label || zone.name || '' };
  }

  const x = toFiniteNumber(zone.x ?? zone.cx ?? zone.left ?? zone.center?.x, null);
  const y = toFiniteNumber(zone.y ?? zone.cy ?? zone.top ?? zone.center?.y, null);
  const inferred = getInferredPlacement(type, index, width, height);
  const w = toFiniteNumber(zone.w ?? zone.width, inferred.w);
  const h = toFiniteNumber(zone.h ?? zone.height, inferred.h);
  const toFloor = zone.toFloor ?? zone.targetFloor ?? zone.nextFloor;
  const inferredPosition = x == null || y == null;

  return {
    type,
    x: x ?? inferred.x,
    y: y ?? inferred.y,
    w,
    h,
    label: zone.label || zone.name || zone.text || '',
    solid: zone.solid,
    interact: zone.interact,
    toFloor,
    _inferredPosition: inferredPosition,
  };
}

function normalizeFloor(floor = {}, index = 0, room = {}, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  if (!floor || typeof floor !== 'object') return null;
  const zonesSource = [floor.zones, floor.rooms, floor.features, floor.elements, floor.items, floor.objects, floor.furniture]
    .find(Array.isArray) || [];
  const zones = zonesSource.map((zone, zoneIndex) => normalizeZone(zone, zoneIndex, width, height)).filter(Boolean);
  const outline = normalizePolygonPoints(floor.outline || floor.boundary || floor.footprint || floor.points);
  if (outline && !zones.some((zone) => zone.type === 'wall_polygon')) {
    zones.unshift({ type: 'wall_polygon', points: outline, solid: true });
  }

  const carpet = toFiniteNumber(floor.carpet ?? floor.color ?? floor.fill, null);
  const level = toFiniteNumber(floor.level ?? floor.floor ?? floor.number, index);
  const stairZones = zones.filter((zone) => zone.type === 'stairwell' || zone.type === 'escalator_up' || zone.type === 'escalator_down');
  const spawn = floor.spawn || floor.entry || stairZones[0] || null;

  return applyNorthEntryStairAnchor({
    level,
    name: floor.name || `Floor ${index + 1}`,
    carpet: carpet ?? undefined,
    zones,
    spawn: spawn ? {
      x: toFiniteNumber(spawn.x ?? spawn.cx ?? spawn.center?.x, DEFAULT_WIDTH / 2),
      y: toFiniteNumber(spawn.y ?? spawn.cy ?? spawn.center?.y, DEFAULT_HEIGHT - 180),
    } : undefined,
    outline,
  }, width, height);
}

function normalizeElementFloors(elements = [], width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  const byLevel = new Map();

  elements.forEach((element, index) => {
    const normalized = normalizeRawElement(element, index, width, height);
    if (!normalized) return;

    const levelKey = getLevelKey(element);
    if (!byLevel.has(levelKey)) {
      byLevel.set(levelKey, {
        level: Number.isFinite(Number(levelKey)) ? Number(levelKey) : levelKey,
        name: `Level ${levelKey}`,
        zones: [],
      });
    }
    byLevel.get(levelKey).zones.push(normalized);
  });

  return Array.from(byLevel.values()).map((floor) => {
    const stairZones = floor.zones.filter((zone) => zone.type === 'stairwell' || zone.type === 'escalator_up' || zone.type === 'escalator_down');
    const entryZone = floor.zones.find((zone) => zone.type === 'entry' || zone.type === 'counter') || stairZones[0] || null;
    const normalizedFloor = {
      ...floor,
      spawn: entryZone ? {
        x: toFiniteNumber(entryZone.x, DEFAULT_WIDTH / 2),
        y: toFiniteNumber(entryZone.y, DEFAULT_HEIGHT - 180),
      } : undefined,
    };
    return applyNorthEntryStairAnchor(normalizedFloor, width, height);
  });
}

function chooseSpawn(room = {}, floors = [], source = null) {
  const fromSource = source?.spawn;
  if (fromSource && Number.isFinite(fromSource.x) && Number.isFinite(fromSource.y)) return fromSource;

  for (const floor of floors) {
    if (floor.spawn && Number.isFinite(floor.spawn.x) && Number.isFinite(floor.spawn.y)) return floor.spawn;
  }

  const firstFloor = floors[0];
  if (firstFloor?.outline?.length) {
    const avg = firstFloor.outline.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return { x: avg.x / firstFloor.outline.length, y: avg.y / firstFloor.outline.length };
  }

  return {
    x: toFiniteNumber(room.spawn?.x, DEFAULT_WIDTH / 2),
    y: toFiniteNumber(room.spawn?.y, DEFAULT_HEIGHT - 180),
  };
}

function looksLikeLibraryRoom(room = {}) {
  const roomText = `${room?.id || ''} ${room?.name || ''} ${room?.amenity || ''} ${room?.shop || ''}`.toLowerCase();
  const tags = room?.tags && typeof room.tags === 'object' ? room.tags : {};
  const tagText = `${tags.amenity || ''} ${tags.shop || ''} ${tags.name || ''}`.toLowerCase();
  return roomText.includes('library') || tagText.includes('library') || String(tags.building || '').toLowerCase() === 'library';
}

function addFallbackLibraryShelves(floor = {}, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  const zones = Array.isArray(floor?.zones) ? floor.zones.slice() : [];
  const hasShelves = zones.some((zone) => {
    const type = String(zone?.type || '').toLowerCase();
    return type === 'shelf' || type === 'wall_shelf' || type === 'book_shelf';
  });
  const hasStudyTables = zones.some((zone) => {
    const type = String(zone?.type || '').toLowerCase();
    return type === 'book_table' || type === 'table' || type === 'cafe_table';
  });
  const hasReferenceTables = zones.some((zone) => String(zone?.label || '').toLowerCase().includes('reference'));
  const hasCollabTables = zones.some((zone) => String(zone?.label || '').toLowerCase().includes('collab'));

  if (!hasShelves) {
    // Reserve a quiet north reference area and a social south collaboration zone.
    const quietZoneBottom = Math.round(height * 0.24);
    const collabZoneTop = Math.round(height * 0.72);

    const shelfW = Math.max(92, Math.round(width * 0.105));
    const shelfH = Math.max(22, Math.round(height * 0.034));
    const topY = Math.max(quietZoneBottom + 16, Math.round(height * 0.29));
    const bottomY = Math.max(topY + 120, collabZoneTop - 28);
    const stepY = Math.max(54, Math.round(height * 0.078));

    const margin = Math.max(52, Math.round(width * 0.06));
    const sideAisle = Math.max(34, Math.round(width * 0.055));
    const centerAisle = Math.max(122, Math.round(width * 0.19));
    const leftWingStart = margin + sideAisle;
    const rightWingEnd = width - margin - sideAisle;
    const centerLeftEdge = (width / 2) - (centerAisle / 2);
    const centerRightEdge = (width / 2) + (centerAisle / 2);

    const leftLane1 = Math.round(leftWingStart);
    const leftLane2 = Math.round((leftWingStart + centerLeftEdge - shelfW) / 2);
    const rightLane1 = Math.round((centerRightEdge + rightWingEnd - shelfW) / 2);
    const rightLane2 = Math.round(rightWingEnd - shelfW);

    const laneX = [leftLane1, leftLane2, rightLane1, rightLane2]
      .map((x) => Math.max(margin, Math.min(width - shelfW - margin, x)));

    let shelfCount = 0;
    for (let y = topY; y <= bottomY; y += stepY) {
      laneX.forEach((x, laneIndex) => {
        const label = shelfCount === 0
          ? 'Main Stacks'
          : (laneIndex === 0 && y === topY + stepY ? 'Quiet Stacks' : '');
        zones.push({ type: 'shelf', x, y, w: shelfW, h: shelfH, label });
        shelfCount += 1;
      });
    }
  }

  if (!hasReferenceTables) {
    const refTableW = Math.max(92, Math.round(width * 0.095));
    const refTableH = Math.max(48, Math.round(height * 0.06));
    const refY = Math.max(58, Math.round(height * 0.11));
    const refXs = [
      Math.round(width * 0.18),
      Math.round(width * 0.36),
      Math.round(width * 0.64),
      Math.round(width * 0.82),
    ];

    refXs.forEach((x, index) => {
      const tableX = Math.max(40, Math.min(width - refTableW - 40, x - refTableW / 2));
      zones.push({
        type: 'book_table',
        x: tableX,
        y: refY,
        w: refTableW,
        h: refTableH,
        label: index === 0 ? 'Reference Zone' : '',
      });
      zones.push({ type: 'chair', x: tableX + 10, y: refY + refTableH + 6, w: 20, h: 20, label: '' });
      zones.push({ type: 'chair', x: tableX + refTableW - 30, y: refY + refTableH + 6, w: 20, h: 20, label: '' });
    });
  }

  if (!hasStudyTables) {
    const tableW = Math.max(120, Math.round(width * 0.13));
    const tableH = Math.max(60, Math.round(height * 0.07));
    const tableXs = [
      Math.round(width * 0.42),
      Math.round(width * 0.56),
    ];
    const tableYs = [
      Math.round(height * 0.74),
      Math.round(height * 0.84),
    ];

    tableYs.forEach((y, rowIndex) => {
      tableXs.forEach((x) => {
        zones.push({
          type: 'book_table',
          x: Math.max(40, Math.min(width - tableW - 40, x - tableW / 2)),
          y,
          w: tableW,
          h: tableH,
          label: rowIndex === 0 && x === tableXs[0] ? 'Study Cluster' : '',
        });
        // Add a couple of chairs near each study table for readability and social feel.
        zones.push({ type: 'chair', x: x - Math.round(tableW * 0.32), y: y + tableH + 10, w: 22, h: 22, label: '' });
        zones.push({ type: 'chair', x: x + Math.round(tableW * 0.32), y: y + tableH + 10, w: 22, h: 22, label: '' });
        zones.push({ type: 'chair', x: x - Math.round(tableW * 0.32), y: y - 28, w: 22, h: 22, label: '' });
        zones.push({ type: 'chair', x: x + Math.round(tableW * 0.32), y: y - 28, w: 22, h: 22, label: '' });
      });
    });
  }

  if (!hasCollabTables) {
    const collabW = Math.max(138, Math.round(width * 0.155));
    const collabH = Math.max(72, Math.round(height * 0.084));
    const collabX = Math.max(40, Math.min(width - collabW - 40, (width - collabW) / 2));
    const collabY = Math.max(60, Math.round(height * 0.82));
    zones.push({ type: 'table', x: collabX, y: collabY, w: collabW, h: collabH, label: 'Collab Commons' });
    zones.push({ type: 'chair', x: collabX - 24, y: collabY + 10, w: 22, h: 22, label: '' });
    zones.push({ type: 'chair', x: collabX - 24, y: collabY + collabH - 30, w: 22, h: 22, label: '' });
    zones.push({ type: 'chair', x: collabX + collabW + 2, y: collabY + 10, w: 22, h: 22, label: '' });
    zones.push({ type: 'chair', x: collabX + collabW + 2, y: collabY + collabH - 30, w: 22, h: 22, label: '' });
  }

  return {
    ...floor,
    zones,
  };
}

export function parseIndoorLayout(room = {}) {
  const source = getSourceObject(room);
  if (!source) return null;

  const width = toFiniteNumber(source.width ?? room.width, DEFAULT_WIDTH);
  const height = toFiniteNumber(source.height ?? room.height, DEFAULT_HEIGHT);

  const floorsSource = Array.isArray(source.floors)
    ? source.floors
    : Array.isArray(source.levels)
      ? source.levels
      : Array.isArray(source.sections)
        ? source.sections
        : [];

  let normalizedFloors = floorsSource.map((floor, index) => normalizeFloor(floor, index, room, width, height)).filter(Boolean);
  if (!normalizedFloors.length && Array.isArray(source.elements)) {
    normalizedFloors = normalizeElementFloors(source.elements, width, height);
  }
  if (!normalizedFloors.length) {
    const singleFloor = normalizeFloor(source, 0, room, width, height);
    if (singleFloor) normalizedFloors.push(singleFloor);
  }

  if (!normalizedFloors.length) return null;

  if (looksLikeLibraryRoom(room)) {
    normalizedFloors = normalizedFloors.map((floor) => addFallbackLibraryShelves(floor, width, height));
  }

  return {
    id: `indoor-${slugify(room.id || room.name || source.id || 'room')}`,
    name: room.name || source.name || 'Interior',
    width,
    height,
    spawn: chooseSpawn(room, normalizedFloors, source),
    floors: normalizedFloors,
  };
}

export function hasIndoorLayoutData(room = {}) {
  return Boolean(parseIndoorLayout(room));
}