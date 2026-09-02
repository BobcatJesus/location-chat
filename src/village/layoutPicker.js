import { bookstore } from './layouts/bookstore.js';
import { library } from './layouts/library.js';
import { buildAutoLayout } from './AutoLayout.js';

const NAME_KEYWORDS = [
  { words: ['barnes', 'noble', 'bookstore', 'booksellers'], layout: bookstore },
  { words: ['library', 'academic library', 'university library', 'public library'], layout: library },
];

const TAG_MAP = {
  books: bookstore,
  library: library,
};

function hasStructuredIndoorSource(roomData = null) {
  if (!roomData || typeof roomData !== 'object') return false;
  if (roomData.indoorLayout && typeof roomData.indoorLayout === 'object') return true;
  if (roomData.floorplan && typeof roomData.floorplan === 'object') return true;
  if (roomData.floorPlan && typeof roomData.floorPlan === 'object') return true;
  if (Array.isArray(roomData.indoorFloors) && roomData.indoorFloors.length) return true;
  if (Array.isArray(roomData.levels) && roomData.levels.length) return true;
  if (Array.isArray(roomData.elements) && roomData.elements.length) return true;
  if (Array.isArray(roomData.floors) && roomData.floors.length) return true;
  return false;
}

export function pickLayout(roomId = '', roomName = '', amenityTag = '', shopTag = '', roomShape = null, roomData = null) {
  const lower = (roomName + ' ' + roomId).toLowerCase();
  const isLibrary = amenityTag === 'library' || lower.includes('library');
  if (isLibrary) return library;

  if (hasStructuredIndoorSource(roomData)) {
    return buildAutoLayout(roomId, roomName, amenityTag, shopTag, roomShape, roomData);
  }
  if (amenityTag && TAG_MAP[amenityTag]) return TAG_MAP[amenityTag];
  for (const { words, layout } of NAME_KEYWORDS) {
    if (words.some(w => lower.includes(w))) return layout;
  }
  // Auto-generate themed layout from OSM tags — no user input needed
  return buildAutoLayout(roomId, roomName, amenityTag, shopTag, roomShape, roomData);
}
