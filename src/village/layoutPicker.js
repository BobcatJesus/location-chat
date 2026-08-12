import { bookstore } from './layouts/bookstore.js';
import { buildAutoLayout } from './AutoLayout.js';

const NAME_KEYWORDS = [
  { words: ['barnes', 'noble', 'bookstore', 'booksellers'], layout: bookstore },
];

const TAG_MAP = {
  books: bookstore,
  library: bookstore,
};

export function pickLayout(roomId = '', roomName = '', amenityTag = '', shopTag = '', roomShape = null) {
  if (amenityTag && TAG_MAP[amenityTag]) return TAG_MAP[amenityTag];
  const lower = (roomName + ' ' + roomId).toLowerCase();
  for (const { words, layout } of NAME_KEYWORDS) {
    if (words.some(w => lower.includes(w))) return layout;
  }
  // Auto-generate themed layout from OSM tags — no user input needed
  return buildAutoLayout(roomId, roomName, amenityTag, shopTag, roomShape);
}
