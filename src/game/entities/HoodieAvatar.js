import SpriteAvatarBase from './SpriteAvatarBase';
import { AVATAR_FRAME_KEYS } from './avatarTextures';

export default class HoodieAvatar extends SpriteAvatarBase {
  constructor(scene, x, y, options = {}) {
    super(scene, x, y, {
      ...options,
      frameKeys: AVATAR_FRAME_KEYS.hoodie,
      targetHeight: 64,
      shadowColor: 0x000000,
    });
  }
}
