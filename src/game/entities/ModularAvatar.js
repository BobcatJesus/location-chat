import SpriteAvatarBase from './SpriteAvatarBase';
import { AVATAR_FRAME_KEYS } from './avatarTextures';

// Kept for compatibility with previous avatar configuration calls.
export const SKINS = {
  blue: { outfitHue: 210 },
  red: { outfitHue: 350 },
  green: { outfitHue: 135 },
  purple: { outfitHue: 275 },
  orange: { outfitHue: 24 },
  pink: { outfitHue: 330 },
  teal: { outfitHue: 178 },
  slate: { outfitHue: 220 },
};

export const HAIR_STYLES = {
  messy: 'Messy Hair',
  combed: 'Combed Hair',
};

export const BODY_TYPES = {
  compact: { scale: 0.92 },
  standard: { scale: 1 },
  broad: { scale: 1.08 },
};

export default class ModularAvatar extends SpriteAvatarBase {
  constructor(scene, x, y, options = {}) {
    super(scene, x, y, {
      ...options,
      frameKeys: AVATAR_FRAME_KEYS.bunny,
      targetHeight: 44,
      shadowColor: 0xe9a89f,
    });
  }
}
