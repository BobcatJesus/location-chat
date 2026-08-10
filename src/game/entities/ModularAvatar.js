import Phaser from 'phaser';
import { colorHexToInt, pigmentToBodyColor, pigmentToEarInnerColor, pigmentToLimbColor, pigmentToOutlineColor, scarfColorFromHue, eyeGlowColorFromHue } from '../../utils/avatarColors';

// Predefined skin presets — id must match AVATAR_SKINS in SpatialCanvas.jsx
export const SKINS = {
  blue:   { scarfHue: 210, eyeHue: 42, pigment: 82 },
  red:    { scarfHue: 350, eyeHue: 22, pigment: 72 },
  green:  { scarfHue: 135, eyeHue: 95, pigment: 76 },
  purple: { scarfHue: 275, eyeHue: 310, pigment: 88 },
  orange: { scarfHue: 24, eyeHue: 45, pigment: 68 },
  pink:   { scarfHue: 330, eyeHue: 335, pigment: 62 },
  teal:   { scarfHue: 178, eyeHue: 188, pigment: 80 },
  slate:  { scarfHue: 220, eyeHue: 42, pigment: 92 },
};

export const HAIR_STYLES = {
  short: 'Curved Horns',
  side: 'Tall Horns',
  mohawk: 'Tilt Horns',
  buzz: 'Nub Horns',
};

export const BODY_TYPES = {
  compact: { bodyW: 12, bodyH: 10, armH: 8, legGap: 3 },
  standard: { bodyW: 14, bodyH: 12, armH: 9, legGap: 4 },
  broad: { bodyW: 16, bodyH: 12, armH: 10, legGap: 5 },
};

export default class ModularAvatar extends Phaser.GameObjects.Container {
  constructor(scene, x, y, { skinId = 'blue', name = '', isLocal = false, hairStyle = 'short', bodyType = 'standard', pigment, eyeHue, scarfHue } = {}) {
    super(scene, x, y);

    const skin = SKINS[skinId] || SKINS.blue;
    const body = BODY_TYPES[bodyType] || BODY_TYPES.standard;
    const resolvedPigment = pigment ?? skin.pigment;
    const resolvedScarfHue = scarfHue ?? skin.scarfHue;
    const resolvedEyeHue = eyeHue ?? skin.eyeHue;

    const bodyColor = colorHexToInt(pigmentToBodyColor(resolvedPigment));
    const innerColor = colorHexToInt(pigmentToEarInnerColor(resolvedPigment));
    const limbColor = colorHexToInt(pigmentToLimbColor(resolvedPigment));
    const outlineColor = colorHexToInt(pigmentToOutlineColor(resolvedPigment));
    const scarfColor = colorHexToInt(scarfColorFromHue(resolvedScarfHue));
    const eyeColor = colorHexToInt(eyeGlowColorFromHue(resolvedEyeHue));

    const headR = bodyType === 'compact' ? 10 : bodyType === 'broad' ? 12 : 11;
    const torsoW = bodyType === 'compact' ? 16 : bodyType === 'broad' ? 20 : 18;
    const torsoH = bodyType === 'compact' ? 15 : bodyType === 'broad' ? 18 : 16;

    this.add(scene.add.ellipse(0, 13, 24, 7, 0x08090d).setAlpha(0.4));

    // Body and cloak silhouette
    this.add(scene.add.ellipse(0, 1, torsoW, torsoH, bodyColor));
    this.add(scene.add.circle(0, -11, headR, bodyColor));
    this.add(scene.add.rectangle(0, 8, torsoW + 1, 3, bodyColor));

    // Horn / ear shapes mapped from current style ids
    if (hairStyle === 'side') {
      this.add(scene.add.triangle(-7, -19, -1, 7, 4, 1, -5, -6, bodyColor));
      this.add(scene.add.triangle(7, -19, 1, 7, -4, 1, 5, -6, bodyColor));
    } else if (hairStyle === 'mohawk') {
      this.add(scene.add.triangle(-5, -20, -1, 7, 4, 1, -6, -7, bodyColor));
      this.add(scene.add.triangle(6, -18, 1, 7, -4, 1, 5, -5, bodyColor));
    } else if (hairStyle === 'buzz') {
      this.add(scene.add.triangle(-4, -17, -1, 5, 3, 1, -4, -4, bodyColor));
      this.add(scene.add.triangle(4, -17, 1, 5, -3, 1, 4, -4, bodyColor));
    } else {
      this.add(scene.add.triangle(-6, -18, -1, 6, 4, 1, -5, -5, bodyColor));
      this.add(scene.add.triangle(6, -18, 1, 6, -4, 1, 5, -5, bodyColor));
    }

    // Arms and legs
    this.add(scene.add.ellipse(-(torsoW / 2 - 2), 2, 6, 10, limbColor));
    this.add(scene.add.ellipse((torsoW / 2 - 2), 2, 6, 10, limbColor));
    this.add(scene.add.ellipse(-(body.legGap + 2), 12, 8, 9, limbColor));
    this.add(scene.add.ellipse((body.legGap + 2), 12, 8, 9, limbColor));

    // Scarf + ragged hem
    this.add(scene.add.ellipse(0, -3, torsoW - 1, 7, scarfColor));
    this.add(scene.add.rectangle(4, 3, 4, 8, scarfColor));
    this.add(scene.add.triangle(-6, 9, -2, 0, 2, 0, 0, 3, bodyColor));
    this.add(scene.add.triangle(0, 9, -2, 0, 2, 0, 0, 3, bodyColor));
    this.add(scene.add.triangle(6, 9, -2, 0, 2, 0, 0, 3, bodyColor));

    // Tail
    this.add(scene.add.rectangle(7, 10, 6, 2, bodyColor).setAngle(24));
    this.add(scene.add.triangle(11, 12, -2, 1, 2, 0, 1, 3, bodyColor).setAngle(24));

    // Face + eyes
    this.add(scene.add.ellipse(-4, -11, 4, 6, eyeColor));
    this.add(scene.add.ellipse(4, -11, 4, 6, eyeColor));

    // Subtle inner ear accents on lighter pigments
    if (resolvedPigment < 60) {
      this.add(scene.add.circle(-5, -16, 2, innerColor).setAlpha(0.25));
      this.add(scene.add.circle(5, -16, 2, innerColor).setAlpha(0.25));
    }

    // Outline pass to keep the OG sticker-like silhouette
    this.add(scene.add.circle(0, -11, headR + 1.5, outlineColor).setAlpha(0.12));

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
