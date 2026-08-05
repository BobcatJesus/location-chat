import Phaser from 'phaser';

// Predefined skin presets — id must match AVATAR_SKINS in SpatialCanvas.jsx
export const SKINS = {
  blue:   { shirt: 0x3b82f6, pants: 0x1e3a5f, hair: 0x7c4a1e },
  red:    { shirt: 0xe53e3e, pants: 0x4a1a1a, hair: 0x2d1a0e },
  green:  { shirt: 0x16a34a, pants: 0x0a2a10, hair: 0x5c3d1e },
  purple: { shirt: 0x7c3aed, pants: 0x2a0a5a, hair: 0x2d1a0e },
  orange: { shirt: 0xea580c, pants: 0x3a1a0a, hair: 0x7c4a1e },
  pink:   { shirt: 0xec4899, pants: 0x4a1a2a, hair: 0x7c4a1e },
  teal:   { shirt: 0x0891b2, pants: 0x0a2a3a, hair: 0x2d1a0e },
  slate:  { shirt: 0x475569, pants: 0x111827, hair: 0xd1d5db },
};

export default class ModularAvatar extends Phaser.GameObjects.Container {
  constructor(scene, x, y, { skinId = 'blue', name = '', isLocal = false } = {}) {
    super(scene, x, y);

    const skin = SKINS[skinId] || SKINS.blue;
    const { shirt, pants, hair } = skin;
    const skin_color = 0xf5c27a;

    // Shadow
    this.add(scene.add.ellipse(0, 14, 20, 6, 0x000000).setAlpha(0.3));
    // Legs
    this.add(scene.add.rectangle(-4, 10, 5, 8, pants));
    this.add(scene.add.rectangle(4, 10, 5, 8, pants));
    // Shoes
    this.add(scene.add.rectangle(-4, 15, 6, 4, 0x222222));
    this.add(scene.add.rectangle(4, 15, 6, 4, 0x222222));
    // Body
    this.add(scene.add.rectangle(0, 1, 14, 12, shirt));
    // Belt
    this.add(scene.add.rectangle(0, 7, 14, 2, 0x8B6914));
    // Arms
    this.add(scene.add.rectangle(-9, 2, 4, 9, shirt));
    this.add(scene.add.rectangle(9, 2, 4, 9, shirt));
    // Hands
    this.add(scene.add.circle(-9, 7, 3, skin_color));
    this.add(scene.add.circle(9, 7, 3, skin_color));
    // Neck
    this.add(scene.add.rectangle(0, -5, 5, 4, skin_color));
    // Head
    this.add(scene.add.rectangle(0, -12, 14, 12, skin_color));
    // Hair
    this.add(scene.add.rectangle(0, -17, 14, 5, hair));
    this.add(scene.add.rectangle(-6, -14, 3, 8, hair));
    // Eyes
    this.add(scene.add.rectangle(-3, -13, 3, 3, 0x333333));
    this.add(scene.add.rectangle(3, -13, 3, 3, 0x333333));
    // Eye shine
    this.add(scene.add.rectangle(-2, -14, 1, 1, 0xffffff));
    this.add(scene.add.rectangle(4, -14, 1, 1, 0xffffff));

    // Name label — use name as-is (callers now pass firstName directly)
    const labelText = (name || '').trim() || (isLocal ? 'YOU' : 'Traveler');
    this._label = scene.add.text(x, y - 28, labelText, {
      fontFamily: 'Courier New', fontSize: '10px',
      color: isLocal ? '#fef3c7' : '#fca5a5',
      backgroundColor: '#00000099',
      padding: { x: 3, y: 2 },
    }).setOrigin(0.5);

    scene.add.existing(this);
  }

  // Call every frame or on move to keep label in sync
  syncLabel() {
    if (this._label) this._label.setPosition(this.x, this.y - 28);
    if (this._photo) {
      this._photo.setPosition(this.x, this.y - 46);
      if (this._photoMask) this._photoMask.clear().fillCircle(this.x, this.y - 46, 14);
    }
  }

  // Attach a base64 photo above the avatar
  attachPhoto(scene, photoDataUrl) {
    const texKey = `photo_${Math.random().toString(36).slice(2)}`;
    scene.textures.addBase64(texKey, photoDataUrl);
    scene.textures.once('addtexture-' + texKey, () => {
      this._photo = scene.add.image(this.x, this.y - 46, texKey).setDisplaySize(28, 28).setOrigin(0.5);
      this._photoMask = scene.add.graphics().fillCircle(this.x, this.y - 46, 14);
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
