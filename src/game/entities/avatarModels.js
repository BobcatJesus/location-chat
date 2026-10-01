// Single source of truth for avatar models.
// Adding a new avatar? Add one entry here (id, label, previewSrc) plus its
// frame keys/paths in avatarTextures.js and its class in avatarFactory.js —
// every picker and spawner in the app reads from this file.
export const AVATAR_MODELS = [
  { id: 'og', label: 'OG Demon', previewSrc: '/village-sprites/characters/demon-front-step1.png' },
  { id: 'bunny', label: 'Bunny', previewSrc: '/avatars/bunny/front-step1.png' },
  { id: 'turtle', label: 'Turtle', previewSrc: '/avatars/turtle/front-step1.png' },
  { id: 'snake', label: 'Snake', previewSrc: '/avatars/snake/front-step1.png' },
  { id: 'sheep', label: 'Demon Sheep', previewSrc: '/avatars/sheep/front-step1.png' },
  { id: 'wisp', label: 'Wisp', previewSrc: '/avatars/wisp/front-step1.png' },
];

export const AVATAR_MODEL_MAP = Object.fromEntries(AVATAR_MODELS.map((m) => [m.id, m]));

export function normalizeAvatarModel(model) {
  const value = String(model || '').trim().toLowerCase();
  if (['og', 'demon', 'og-demon', 'original', 'legacy'].includes(value)) return 'og';
  if (['bunny', 'rabbit', 'bun', 'modular', 'bunny-avatar'].includes(value)) return 'bunny';
  if (['turtle', 'tortoise', 'turtle-avatar'].includes(value)) return 'turtle';
  if (['snake', 'serpent', 'snake-avatar'].includes(value)) return 'snake';
  if (['sheep', 'lamb', 'ram', 'demon-sheep', 'demon sheep', 'sheep-avatar'].includes(value)) return 'sheep';
  if (['wisp', 'ghost', 'imp', 'wisp-avatar', 'ghost-chibi'].includes(value)) return 'wisp';
  if (['hoodie', 'human', 'human-chibi', 'chibi', 'male', 'female'].includes(value)) return 'bunny';
  return 'bunny';
}

export function getAvatarModelEntry(model) {
  return AVATAR_MODEL_MAP[normalizeAvatarModel(model)] || AVATAR_MODEL_MAP.bunny;
}
