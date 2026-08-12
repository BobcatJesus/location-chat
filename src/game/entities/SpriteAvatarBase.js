import Phaser from 'phaser';

const PHOTO_BASE_SIZE = 32;
const PHOTO_BASE_RADIUS = PHOTO_BASE_SIZE / 2;

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
    targetHeight = 52,
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

    this._shadow = scene.add.ellipse(0, 3, 34, 12, shadowColor, 0.22);
    this.add(this._shadow);

    const initialTexture = this._resolveTexture('front', 0);
    this._sprite = scene.add.image(0, 0, initialTexture).setOrigin(0.5, 1);
    this._baseScale = inferSpriteScale(scene, initialTexture, this._targetHeight);
    this._sprite.setScale(this._baseScale);
    this.add(this._sprite);

    const labelText = (name || '').trim() || (isLocal ? 'YOU' : 'Traveler');
    this._label = scene.add.text(x, y - 38, labelText, {
      fontFamily: 'Courier New',
      fontSize: '10px',
      color: isLocal ? '#fef3c7' : '#fca5a5',
      backgroundColor: '#00000099',
      padding: { x: 3, y: 2 },
    }).setOrigin(0.5);

    this.setSize(44, 62);
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

  _getVisualScale() {
    return Math.max(1, Number(this.scaleX) || Number(this.scaleY) || 1);
  }

  _getLabelYOffset() {
    const scale = this._getVisualScale();
    return 42 + (scale - 1) * 28;
  }

  _getPhotoYOffset() {
    const scale = this._getVisualScale();
    return 66 + (scale - 1) * 30;
  }

  _getPhotoSize() {
    const scale = this._getVisualScale();
    return Math.round(PHOTO_BASE_SIZE * Math.max(1.1, scale));
  }

  setScale(x, y = x) {
    super.setScale(x, y);
    this.syncLabel();
    return this;
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
    if (this._photoRing) this._photoRing.setDepth(depth + 10);
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
    this._label.setPosition(this.x, this.y - this._getLabelYOffset());
    if (this._photo) {
      const photoY = this.y - this._getPhotoYOffset();
      const photoSize = this._getPhotoSize();
      const photoRadius = Math.max(PHOTO_BASE_RADIUS, Math.round(photoSize / 2));
      const ringRadius = photoRadius + 3;
      const ringDiameter = ringRadius * 2;
      this._photo.setPosition(this.x, photoY);
      const hasRenderableFrame = Boolean(this._photo.frame?.sourceSize);
      if (!hasRenderableFrame) {
        // Texture frame can be momentarily unavailable while base64 upload finalizes.
        // Keep objects alive and hide them until the frame is renderable.
        this._photo.setVisible(false);
        if (this._photoRing) this._photoRing.setVisible(false);
        return;
      }
      this._photo.setVisible(true);
      this._photo.setDisplaySize(photoSize, photoSize);
      if (this._photoMask) this._photoMask.clear().fillCircle(this.x, photoY, photoRadius);
      if (this._photoRing) {
        this._photoRing.setVisible(true);
        this._photoRing.setPosition(this.x, photoY);
        if (typeof this._photoRing.setRadius === 'function') {
          this._photoRing.setRadius(ringRadius);
        } else {
          this._photoRing.setDisplaySize(ringDiameter, ringDiameter);
        }
      }
    }
  }

  attachPhoto(scene, photoDataUrl) {
    if (typeof photoDataUrl !== 'string' || !photoDataUrl.trim()) return;
    const texKey = `photo_${Math.random().toString(36).slice(2)}`;
    const createPhoto = (resolvedKey = texKey) => {
      if (this._photo || !scene.textures.exists(resolvedKey)) return;
      const photoY = this.y - this._getPhotoYOffset();
      const photoSize = this._getPhotoSize();
      const photoRadius = Math.max(PHOTO_BASE_RADIUS, Math.round(photoSize / 2));
      const ringRadius = photoRadius + 3;
      this._photo = scene.add.image(this.x, photoY, resolvedKey).setDisplaySize(photoSize, photoSize).setOrigin(0.5);
      this._photoRing = scene.add.circle(this.x, photoY, ringRadius, 0x0f172a, 0.7)
        .setStrokeStyle(2, 0xf8fafc, 0.88);
      this._photoMask = scene.add.graphics().fillCircle(this.x, photoY, photoRadius);
      this._photoMask.setVisible(false);
      this._photo.setMask(this._photoMask.createGeometryMask());
      this._photoRing.setDepth((this.depth || 0) + 10);
      this._photo.setDepth((this.depth || 0) + 11);
      this._photoMask.setDepth((this.depth || 0) + 10);
      this.syncLabel();
    };

    const value = photoDataUrl.trim();
    const isDataImage = value.startsWith('data:image/');

    if (isDataImage) {
      scene.textures.once(`addtexture-${texKey}`, createPhoto);
      try {
        scene.textures.addBase64(texKey, value);
      } catch {
        return;
      }

      if (scene.textures.exists(texKey)) {
        createPhoto();
      } else if (scene.time?.delayedCall) {
        scene.time.delayedCall(0, createPhoto);
      }
      return;
    }

    // Support persisted URL-based photos and preloaded texture keys.
    if (scene.textures.exists(value)) {
      createPhoto(value);
      return;
    }

    if (!scene.load) return;
    scene.load.image(texKey, value);
    scene.load.once(Phaser.Loader.Events.COMPLETE, createPhoto);
    if (!scene.load.isLoading()) scene.load.start();
  }

  destroy(fromScene) {
    this._label?.destroy();
    this._photoRing?.destroy();
    this._photo?.destroy();
    this._photoMask?.destroy();
    super.destroy(fromScene);
  }
}
