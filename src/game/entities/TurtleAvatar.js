import SpriteAvatarBase from './SpriteAvatarBase';
import { AVATAR_FRAME_KEYS } from './avatarTextures';

export default class TurtleAvatar extends SpriteAvatarBase {
  constructor(scene, x, y, options = {}) {
    super(scene, x, y, {
      ...options,
      frameKeys: AVATAR_FRAME_KEYS.turtle,
      targetHeight: 60,
      shadowColor: 0x3d3438,
    });
  }
}
