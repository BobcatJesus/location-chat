export { AVATAR_FRAME_KEYS, preloadAvatarTextures } from './avatarTextures';
export { AVATAR_MODELS, normalizeAvatarModel } from './avatarModels.js';
import { normalizeAvatarModel } from './avatarModels.js';

function canInstantiateInScene(scene) {
  if (!scene?.sys || !scene?.add) return false;
  if (scene.sys.settings?.isDestroyed) return false;
  if (typeof scene.sys.isActive === 'function' && !scene.sys.isActive()) return false;
  return true;
}

async function buildAvatar(scene, x, y, options, importer) {
  const module = await importer();
  if (!canInstantiateInScene(scene)) return null;
  return new module.default(scene, x, y, options);
}

export function createAvatarEntity(scene, x, y, options = {}) {
  const avatarModel = normalizeAvatarModel(options.avatarModel);
  if (avatarModel === 'og') {
    return buildAvatar(scene, x, y, options, () => import('./OgDemonAvatar.js'));
  }
  if (avatarModel === 'bunny') {
    return buildAvatar(scene, x, y, options, () => import('./ModularAvatar.js'));
  }
  if (avatarModel === 'turtle') {
    return buildAvatar(scene, x, y, options, () => import('./TurtleAvatar.js'));
  }
  if (avatarModel === 'snake') {
    return buildAvatar(scene, x, y, options, () => import('./SnakeAvatar.js'));
  }
  return buildAvatar(scene, x, y, options, () => import('./ModularAvatar.js'));
}
