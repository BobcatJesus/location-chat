export const AVATAR_MODELS = [
  { id: 'og', label: 'OG Demon' },
  { id: 'hoodie', label: 'Hoodie Avatar' },
  { id: 'bunny', label: 'Bunny Avatar' },
];

export function normalizeAvatarModel(model) {
  if (model === 'og') return 'og';
  if (model === 'bunny') return 'bunny';
  if (model === 'hoodie') return 'hoodie';
  return 'hoodie';
}