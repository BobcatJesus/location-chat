export const AVATAR_MODELS = [
  { id: 'og', label: 'OG Demon' },
  { id: 'bunny', label: 'Bunny Avatar' },
  { id: 'turtle', label: 'Turtle Avatar' },
  { id: 'snake', label: 'Snake Avatar' },
];

export function normalizeAvatarModel(model) {
  const value = String(model || '').trim().toLowerCase();
  if (['og', 'demon', 'og-demon', 'original', 'legacy'].includes(value)) return 'og';
  if (['bunny', 'rabbit', 'bun', 'modular', 'bunny-avatar'].includes(value)) return 'bunny';
  if (['turtle', 'tortoise', 'turtle-avatar'].includes(value)) return 'turtle';
  if (['snake', 'serpent', 'snake-avatar'].includes(value)) return 'snake';
  if (['hoodie', 'human', 'human-chibi', 'chibi', 'male', 'female'].includes(value)) return 'bunny';
  return 'bunny';
}
