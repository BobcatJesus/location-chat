// furnitureCatalog.js — single shared furniture/prop library.
// Used by RoomEditor (in-game edit mode) and InteriorSketchModal (layout designer).
// Add a type here once and it appears in both. `renderAsZone` maps the prop
// to a RoomLayout zone type for in-game rendering; without it the prop draws
// as a generic colored block.

export const FURNITURE_CATALOG = [
  { name: 'prop_table_round',    css: '#8b4513', label: 'Table',           icon: '🪑', w: 90,  h: 90 },
  { name: 'prop_chair_wooden',   css: '#a0522d', label: 'Chair',           icon: '💺', w: 60,  h: 60 },
  { name: 'prop_plant_potted',   css: '#228b22', label: 'Plant',           icon: '🪴', w: 60,  h: 60 },
  { name: 'prop_bookshelf',      css: '#6b4c2a', label: 'Bookshelf',       icon: '📚', w: 120, h: 50,  renderAsZone: 'shelf' },
  { name: 'prop_lamp_floor',     css: '#d4a017', label: 'Floor Lamp',      icon: '🛋', w: 50,  h: 50 },
  { name: 'prop_jukebox',        css: '#c0392b', label: 'Jukebox',         icon: '🎵', w: 70,  h: 70,  renderAsZone: 'jukebox' },
  { name: 'prop_trash_can',      css: '#888888', label: 'Trash Can',       icon: '🗑', w: 50,  h: 50 },
  { name: 'prop_coffee_cup',     css: '#4a2c0a', label: 'Coffee Cup',      icon: '☕', w: 40,  h: 40 },
  { name: 'prop_books_stack',    css: '#2e86ab', label: 'Book Stack',      icon: '📖', w: 60,  h: 40 },
  { name: 'prop_candle',         css: '#f5c842', label: 'Candle',          icon: '🕯', w: 40,  h: 40 },
  { name: 'prop_rug_rolled',     css: '#c8a96e', label: 'Rug',             icon: '🧶', w: 140, h: 90 },
  { name: 'prop_portrait_framed',css: '#7d6b4a', label: 'Portrait',        icon: '🖼', w: 80,  h: 60 },
  { name: 'prop_couch',          css: '#7c3aed', label: 'Couch',           icon: '🛋', w: 160, h: 70,  renderAsZone: 'couch' },
  { name: 'prop_bar',            css: '#8b5a2b', label: 'Bar',             icon: '🍺', w: 220, h: 60,  renderAsZone: 'counter' },
  { name: 'prop_stage',          css: '#ff3da6', label: 'Stage',           icon: '🎤', w: 220, h: 110 },
  { name: 'prop_dancefloor',     css: '#f472b6', label: 'Dance Floor',     icon: '💃', w: 170, h: 170 },
  { name: 'prop_pond',           css: '#2b6cb0', label: 'Pond',            icon: '🦆', w: 220, h: 160, renderAsZone: 'pond' },
  { name: 'prop_npc_spot',       css: '#4ade80', label: 'NPC Spot',        icon: '🧍', w: 60,  h: 60,  renderAsZone: 'npc' },
  { name: 'prop_entrance',       css: '#35e0ff', label: 'Entrance',        icon: '🚪', w: 110, h: 60,  renderAsZone: 'entry' },
  // Composite / border pieces (from RoomEditor)
  { name: 'bookshelf_border_h',  css: '#7c4a1d', label: 'Bookshelf Wall',  icon: '📚', w: 220, h: 34, frameKey: 'prop_bookshelf', renderAsZone: 'shelf' },
  { name: 'bookshelf_border_v',  css: '#7c4a1d', label: 'Tall Shelf Wall', icon: '📚', w: 34,  h: 220, frameKey: 'prop_bookshelf', renderAsZone: 'shelf' },
  { name: 'restroom_block',      css: '#64748b', label: 'Restroom',        icon: '🚻', w: 150, h: 120, frameKey: 'prop_portrait_framed', renderAsZone: 'bathroom' },
  { name: 'service_counter_h',   css: '#8b6a50', label: 'Counter',         icon: '🧾', w: 240, h: 42, frameKey: 'prop_table_round', renderAsZone: 'counter' },
  { name: 'coffee_bar_h',        css: '#0f6b4f', label: 'Coffee Bar',      icon: '☕', w: 260, h: 54, frameKey: 'prop_table_round', renderAsZone: 'cafe_counter' },
  { name: 'plant_border_h',      css: '#166534', label: 'Plant Border',    icon: '🌿', w: 200, h: 44, frameKey: 'prop_plant_potted', renderAsZone: 'planter_border' },
  { name: 'plant_border_v',      css: '#166534', label: 'Tall Plant Border', icon: '🌿', w: 44, h: 200, frameKey: 'prop_plant_potted', renderAsZone: 'planter_border' },
];

export const furnitureByName = new Map(FURNITURE_CATALOG.map((f) => [f.name, f]));

/** Build a RoomEditor-compatible zone object from a catalog entry + position. */
export function makeFurnitureZone(catalogEntry, x, y, extra = {}) {
  return {
    type: catalogEntry.name,
    frameKey: catalogEntry.frameKey || catalogEntry.name,
    x, y,
    w: catalogEntry.w || 60,
    h: catalogEntry.h || 60,
    label: catalogEntry.label,
    renderAsZone: catalogEntry.renderAsZone || null,
    solid: true,
    ...extra,
  };
}
