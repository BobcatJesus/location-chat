import ModularAvatar from './ModularAvatar';
import OgDemonAvatar from './OgDemonAvatar';

export const AVATAR_MODELS = [
  { id: 'hoodie', label: 'Hoodie Avatar' },
  { id: 'bunny', label: 'Bunny Avatar' },
];

export function normalizeAvatarModel(model) {
  if (model === 'bunny') return 'bunny';
  if (model === 'hoodie') return 'hoodie';
  // Backward compatibility for existing saved profiles.
  if (model === 'og') return 'hoodie';
  return 'hoodie';
}

export function createAvatarEntity(scene, x, y, options = {}) {
  const avatarModel = normalizeAvatarModel(options.avatarModel);
  if (avatarModel === 'bunny') {
    return new ModularAvatar(scene, x, y, options);
  }
  return new OgDemonAvatar(scene, x, y, options);
}
