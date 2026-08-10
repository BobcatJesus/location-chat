import ModularAvatar from './ModularAvatar';
import OgDemonAvatar from './OgDemonAvatar';
import HoodieAvatar from './HoodieAvatar';
export { AVATAR_FRAME_KEYS, preloadAvatarTextures } from './avatarTextures';

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

export function createAvatarEntity(scene, x, y, options = {}) {
  const avatarModel = normalizeAvatarModel(options.avatarModel);
  if (avatarModel === 'og') {
    return new OgDemonAvatar(scene, x, y, options);
  }
  if (avatarModel === 'bunny') {
    return new ModularAvatar(scene, x, y, options);
  }
  return new HoodieAvatar(scene, x, y, options);
}
