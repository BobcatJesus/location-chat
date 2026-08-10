import Phaser from 'phaser';

const SKIN_TINTS = {
  blue: 0x3b82f6,
  red: 0xe53e3e,
  green: 0x16a34a,
  purple: 0x7c3aed,
  orange: 0xea580c,
  pink: 0xec4899,
  teal: 0x0891b2,
  slate: 0x94a3b8,
};

export default class OgDemonAvatar {
  constructor(scene, x, y, { skinId = 'slate', name = '', isLocal = false } = {}) {
    this.scene = scene;
    this.skinId = skinId;
    this.x = x;
    this.y = y;
    this._dir = 'front';
    this._moving = false;
    this._facingLeft = false;
    this._stepAccum = Math.random() * 120;
    this._stepFrame = 0;

    this._shadow = scene.add.ellipse(x, y, 28, 14, 0x000000, 0.25);
    this._sprite = scene.add.image(x, y, 'demon-front-step1').setOrigin(0.5, 1).setScale(0.09);
    this._sprite.setTint(SKIN_TINTS[this.skinId] || 0xffffff);

    const labelText = (name || '').trim() || (isLocal ? 'YOU' : 'Traveler');
    this._label = scene.add.text(x, y - 24, labelText, {
      fontFamily: 'Courier New',
      fontSize: '10px',
      color: isLocal ? '#fef3c7' : '#fca5a5',
      backgroundColor: '#00000099',
      padding: { x: 3, y: 2 },
    }).setOrigin(0.5);
  }

  setPosition(x, y) {
    this.x = x;
    this.y = y;
    this._sprite.setPosition(x, y);
    this._shadow.setPosition(x, y);
    this.syncLabel();
  }

  setDepth(depth) {
    this._sprite.setDepth(depth);
    this._shadow.setDepth(Math.max(0, depth - 1000));
    this._label.setDepth(depth + 10);
    if (this._photo) this._photo.setDepth(depth + 11);
  }

  setMovementState({ moving = false, direction = 'front', facingLeft = false } = {}) {
    this._moving = Boolean(moving);
    this._dir = direction || 'front';
    this._facingLeft = Boolean(facingLeft);
  }

  tick(delta = 16) {
    this._stepAccum += delta;
    if (this._moving && this._stepAccum >= 180) {
      this._stepAccum -= 180;
      this._stepFrame = 1 - this._stepFrame;
    }
    if (!this._moving) this._stepFrame = 0;

    const frame = this._stepFrame + 1;
    const texture = `demon-${this._dir}-step${frame}`;
    if (this.scene.textures.exists(texture)) this._sprite.setTexture(texture);
    this._sprite.setFlipX(this._dir === 'side' && this._facingLeft);
  }

  // Back-compat with older callers.
  setAnimationState({ moving = false, direction = 'front', sideFlip = 1, delta = 16 } = {}) {
    this.setMovementState({ moving, direction, facingLeft: sideFlip < 0 });
    this.tick(delta);
  }

  syncLabel() {
    this._label.setPosition(this.x, this.y - 24);
    if (this._photo) {
      this._photo.setPosition(this.x, this.y - 42);
      if (this._photoMask) this._photoMask.clear().fillCircle(this.x, this.y - 42, 13);
    }
  }

  attachPhoto(scene, photoDataUrl) {
    const texKey = `photo_${Math.random().toString(36).slice(2)}`;
    scene.textures.addBase64(texKey, photoDataUrl);
    scene.textures.once(`addtexture-${texKey}`, () => {
      this._photo = scene.add.image(this.x, this.y - 42, texKey).setDisplaySize(26, 26).setOrigin(0.5);
      this._photoMask = scene.add.graphics().fillCircle(this.x, this.y - 42, 13);
      this._photo.setMask(this._photoMask.createGeometryMask());
    });
  }

  destroy() {
    this._sprite.destroy();
    this._shadow.destroy();
    this._label.destroy();
    this._photo?.destroy();
    this._photoMask?.destroy();
  }
}
