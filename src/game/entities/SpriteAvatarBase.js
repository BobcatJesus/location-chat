import Phaser from 'phaser';

function firstExistingTexture(scene, keys) {
  for (const key of keys) {
    if (scene.textures.exists(key)) return key;
  }
  return '__MISSING';
}

function inferSpriteScale(scene, textureKey, targetHeight) {
  try {
    const tex = scene.textures.get(textureKey);
    const src = tex?.getSourceImage?.();
    const h = Number(src?.height || 0);
    if (!h) return 0.17;
    return targetHeight / h;
  } catch {
    return 0.17;
  }
}

export default class SpriteAvatarBase extends Phaser.GameObjects.Container {
  constructor(scene, x, y, {
    name = '',
    isLocal = false,
    frameKeys,
    targetHeight = 42,
    shadowColor = 0x000000,
  } = {}) {
    super(scene, x, y);
    this.scene = scene;
    this.x = x;
    this.y = y;
    this._frameKeys = frameKeys;
    this._targetHeight = targetHeight;
    this._dir = 'front';
    this._moving = false;
    this._facingLeft = false;
    this._stepAccum = Math.random() * 120;
    this._stepFrame = 0;

    this._shadow = scene.add.ellipse(0, 2, 26, 10, shadowColor, 0.22);
    this.add(this._shadow);

    const initialTexture = this._resolveTexture('front', 0);
    this._sprite = scene.add.image(0, 0, initialTexture).setOrigin(0.5, 1);
    this._baseScale = inferSpriteScale(scene, initialTexture, this._targetHeight);
    this._sprite.setScale(this._baseScale);
    this.add(this._sprite);

    const labelText = (name || '').trim() || (isLocal ? 'YOU' : 'Traveler');
    this._label = scene.add.text(x, y - 30, labelText, {
      fontFamily: 'Courier New',
      fontSize: '10px',
      color: isLocal ? '#fef3c7' : '#fca5a5',
      backgroundColor: '#00000099',
      padding: { x: 3, y: 2 },
    }).setOrigin(0.5);

    this.setSize(34, 50);
    scene.add.existing(this);
  }

  _resolveTexture(direction, frameIdx) {
    const selected = this._frameKeys?.[direction]?.[frameIdx];
    const sameModelFallback = this._frameKeys?.front?.[0];
    const globalFallback = 'demon-front-step1';
    return firstExistingTexture(this.scene, [selected, sameModelFallback, globalFallback]);
  }

  _applyTexture(direction, frameIdx) {
    const key = this._resolveTexture(direction, frameIdx);
    this._sprite.setTexture(key);
    this._sprite.setScale(this._baseScale);
  }

  setPosition(x, y) {
    this.x = x;
    this.y = y;
    super.setPosition(x, y);
    if (this._label) this.syncLabel();
  }

  setDepth(depth) {
    super.setDepth(depth);
    this._shadow.setDepth(Math.max(0, depth - 1000));
    this._sprite.setDepth(depth);
    this._label.setDepth(depth + 10);
    if (this._photo) this._photo.setDepth(depth + 11);
  }

  setMovementState({ moving = false, direction = 'front', facingLeft = false } = {}) {
    this._moving = Boolean(moving);
    this._dir = direction || 'front';
    this._facingLeft = Boolean(facingLeft);
    this._sprite.setFlipX(this._dir === 'side' && this._facingLeft);
  }

  tick(delta = 16) {
    this._stepAccum += delta;
    if (this._moving && this._stepAccum >= 180) {
      this._stepAccum -= 180;
      this._stepFrame = 1 - this._stepFrame;
    }
    if (!this._moving) this._stepFrame = 0;

    const frame = this._moving ? this._stepFrame : 0;
    this._applyTexture(this._dir, frame);

    const bob = this._moving ? (this._stepFrame ? -1.1 : -0.3) : -0.2;
    this._sprite.y = bob;
    this._shadow.scaleX = this._moving ? (this._stepFrame ? 0.96 : 1) : 1;
  }

  // Back-compat with older callers.
  setAnimationState({ moving = false, direction = 'front', sideFlip = 1, delta = 16 } = {}) {
    this.setMovementState({ moving, direction, facingLeft: sideFlip < 0 });
    this.tick(delta);
  }

  syncLabel() {
    if (!this._label) return;
    this._label.setPosition(this.x, this.y - 30);
    if (this._photo) {
      this._photo.setPosition(this.x, this.y - 48);
      if (this._photoMask) this._photoMask.clear().fillCircle(this.x, this.y - 48, 13);
    }
  }

  attachPhoto(scene, photoDataUrl) {
    const texKey = `photo_${Math.random().toString(36).slice(2)}`;
    scene.textures.addBase64(texKey, photoDataUrl);
    scene.textures.once(`addtexture-${texKey}`, () => {
      this._photo = scene.add.image(this.x, this.y - 48, texKey).setDisplaySize(26, 26).setOrigin(0.5);
      this._photoMask = scene.add.graphics().fillCircle(this.x, this.y - 48, 13);
      this._photo.setMask(this._photoMask.createGeometryMask());
    });
  }

  destroy(fromScene) {
    this._label?.destroy();
    this._photo?.destroy();
    this._photoMask?.destroy();
    super.destroy(fromScene);
  }
}
