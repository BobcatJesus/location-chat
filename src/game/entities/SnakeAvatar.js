import SpriteAvatarBase from './SpriteAvatarBase';
import { AVATAR_FRAME_KEYS } from './avatarTextures';

export default class SnakeAvatar extends SpriteAvatarBase {
  constructor(scene, x, y, options = {}) {
    super(scene, x, y, {
      ...options,
      frameKeys: AVATAR_FRAME_KEYS.snake,
      targetHeight: 50,
      shadowColor: 0x3d3438,
    });
    this._slitherPhase = Math.random() * Math.PI * 2;
  }

  tick(delta = 16) {
    // Slither instead of walk: snakes don't bob up and down — they
    // undulate side to side. Lateral sine wiggle + body roll, minimal bob.
    this._stepAccum += delta;
    if (this._moving && this._stepAccum >= 140) {
      this._stepAccum -= 140;
      this._stepFrame = 1 - this._stepFrame;
    }
    if (!this._moving) this._stepFrame = 0;

    const frame = this._moving ? this._stepFrame : 0;
    this._applyTexture(this._dir, frame);

    if (this._moving) {
      this._slitherPhase += delta / 130;
      const s = Math.sin(this._slitherPhase);
      this._sprite.x = s * 3.5;                    // lateral undulation
      this._sprite.angle = s * 7;                  // body roll with the wiggle
      this._sprite.y = -0.4 + Math.cos(this._slitherPhase * 2) * 0.4; // barely-there bob
      this._shadow.scaleX = 0.97 + s * 0.02;
    } else {
      // Ease back to neutral when stopped.
      this._slitherPhase = 0;
      this._sprite.x *= 0.8;
      this._sprite.angle *= 0.8;
      if (Math.abs(this._sprite.x) < 0.05) this._sprite.x = 0;
      if (Math.abs(this._sprite.angle) < 0.05) this._sprite.angle = 0;
      this._sprite.y = -0.2;
      this._shadow.scaleX = 1;
    }
  }
}
