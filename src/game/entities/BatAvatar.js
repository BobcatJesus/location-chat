import SpriteAvatarBase from './SpriteAvatarBase';
import { AVATAR_FRAME_KEYS } from './avatarTextures';

export default class BatAvatar extends SpriteAvatarBase {
  constructor(scene, x, y, options = {}) {
    super(scene, x, y, {
      ...options,
      frameKeys: AVATAR_FRAME_KEYS.bat,
      targetHeight: 64,
      shadowColor: 0x5a4a5e,
    });
  }
}
