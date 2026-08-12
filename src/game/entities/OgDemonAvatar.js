import SpriteAvatarBase from './SpriteAvatarBase';
import { AVATAR_FRAME_KEYS } from './avatarTextures';

export default class OgDemonAvatar extends SpriteAvatarBase {
  constructor(scene, x, y, options = {}) {
    super(scene, x, y, {
      ...options,
      frameKeys: AVATAR_FRAME_KEYS.og,
      targetHeight: 64,
      shadowColor: 0x000000,
    });
  }
}
