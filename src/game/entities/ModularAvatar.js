import Phaser from 'phaser';
import { colorHexToInt, skinToneToColor, skinToneToShade, hairHueToColor, accessoryHueToColor } from '../../utils/avatarColors';

// Predefined skin presets — id must match AVATAR_SKINS in SpatialCanvas.jsx
export const SKINS = {
  blue:   { outfitHue: 210 },
  red:    { outfitHue: 350 },
  green:  { outfitHue: 135 },
  purple: { outfitHue: 275 },
  orange: { outfitHue: 24 },
  pink:   { outfitHue: 330 },
  teal:   { outfitHue: 178 },
  slate:  { outfitHue: 220 },
};

export const HAIR_STYLES = {
  messy: 'Messy Hair',
  combed: 'Combed Hair',
};

export const BODY_TYPES = {
  compact: { torsoW: 14, torsoH: 12, legGap: 3 },
  standard: { torsoW: 16, torsoH: 14, legGap: 4 },
  broad: { torsoW: 18, torsoH: 15, legGap: 5 },
};

const mapLegacyHairStyle = (hairStyle) => {
  if (hairStyle === 'messy' || hairStyle === 'combed') return hairStyle;
  if (hairStyle === 'side' || hairStyle === 'mohawk') return 'messy';
  return 'combed';
};

export default class ModularAvatar extends Phaser.GameObjects.Container {
  constructor(
    scene,
    x,
    y,
    {
      skinId = 'blue',
      name = '',
      isLocal = false,
      hairStyle = 'combed',
      bodyType = 'standard',
      skinTone,
      hairHue,
      outfitHue,
      topStyle = 'hoodie',
      bottomStyle = 'pants',
      footwear = 'sneakers',
      glasses = false,
      hasScythe = false,
      // Legacy compatibility inputs
      pigment,
      scarfHue,
      eyeHue,
    } = {},
  ) {
    super(scene, x, y);

    const skin = SKINS[skinId] || SKINS.blue;
    const body = BODY_TYPES[bodyType] || BODY_TYPES.standard;
    const resolvedSkinTone = skinTone ?? pigment ?? 45;
    const resolvedHairHue = hairHue ?? eyeHue ?? 26;
    const resolvedOutfitHue = outfitHue ?? scarfHue ?? skin.outfitHue;
    const resolvedHairStyle = mapLegacyHairStyle(hairStyle);

    const skinColor = colorHexToInt(skinToneToColor(resolvedSkinTone));
    const skinShadow = colorHexToInt(skinToneToShade(resolvedSkinTone, -16));
    const hairColor = colorHexToInt(hairHueToColor(resolvedHairHue));
    const outfitColor = colorHexToInt(accessoryHueToColor(resolvedOutfitHue));
    const outfitDark = colorHexToInt(accessoryHueToColor(resolvedOutfitHue, 48, 34));
    const outlineColor = colorHexToInt('#15161b');

    const headR = bodyType === 'compact' ? 8.5 : bodyType === 'broad' ? 10.5 : 9.5;
    const { torsoW, torsoH, legGap } = body;

    this.add(scene.add.ellipse(0, 14, torsoW + 10, 6, 0x000000).setAlpha(0.25));

    if (hasScythe) {
      const shaft = scene.add.rectangle(11, -1, 2, 28, 0x6b7280).setAngle(22);
      const blade = scene.add.arc(15, -15, 8, 200, 20, false, 0xdbe4f2).setLineWidth(3, 0xdbe4f2);
      this.add(shaft);
      this.add(blade);
    }

    // Legs
    this.add(scene.add.rectangle(-legGap, 10, 5, 9, bottomStyle === 'skirt' ? outfitDark : outfitColor));
    this.add(scene.add.rectangle(legGap, 10, 5, 9, bottomStyle === 'skirt' ? outfitDark : outfitColor));

    // Shoes
    if (footwear === 'heels') {
      this.add(scene.add.rectangle(-legGap, 15, 7, 3, 0x1f2937));
      this.add(scene.add.rectangle(legGap, 15, 7, 3, 0x1f2937));
      this.add(scene.add.rectangle(-legGap + 2, 17, 2, 2, 0x111827));
      this.add(scene.add.rectangle(legGap + 2, 17, 2, 2, 0x111827));
    } else {
      this.add(scene.add.rectangle(-legGap, 15, 8, 4, 0x2b2f38));
      this.add(scene.add.rectangle(legGap, 15, 8, 4, 0x2b2f38));
    }

    // Torso
    this.add(scene.add.rectangle(0, 1, torsoW, torsoH, outfitColor));

    if (bottomStyle === 'skirt') {
      this.add(scene.add.triangle(0, 8, -(torsoW / 2), -1, torsoW / 2, -1, 0, 6, outfitDark));
    }

    if (topStyle === 'hoodie') {
      this.add(scene.add.arc(0, -6, 8, 200, -20, false, outfitDark).setLineWidth(3, outfitDark));
      this.add(scene.add.rectangle(0, 5, 6, 2, outfitDark));
    } else {
      this.add(scene.add.rectangle(0, -6, torsoW - 2, 3, outfitDark));
      this.add(scene.add.rectangle(0, -4, torsoW - 4, 2, outfitDark));
    }

    // Arms
    this.add(scene.add.rectangle(-(torsoW / 2 + 2), 2, 4, 9, outfitColor));
    this.add(scene.add.rectangle(torsoW / 2 + 2, 2, 4, 9, outfitColor));
    this.add(scene.add.circle(-(torsoW / 2 + 2), 7, 2.5, skinColor));
    this.add(scene.add.circle(torsoW / 2 + 2, 7, 2.5, skinColor));

    // Head and neck
    this.add(scene.add.rectangle(0, -5, 4, 3, skinShadow));
    this.add(scene.add.circle(0, -12, headR, skinColor));

    // Hair
    if (resolvedHairStyle === 'messy') {
      this.add(scene.add.rectangle(0, -17, headR * 2, 4, hairColor));
      this.add(scene.add.triangle(-6, -16, -3, 1, 2, 1, 0, -3, hairColor));
      this.add(scene.add.triangle(4, -17, -3, 1, 2, 1, 0, -3, hairColor));
      this.add(scene.add.rectangle(-7, -12, 2, 6, hairColor));
    } else {
      this.add(scene.add.rectangle(0, -17, headR * 2 + 1, 5, hairColor));
      this.add(scene.add.rectangle(0, -14, headR * 2 - 1, 2, hairColor));
      this.add(scene.add.rectangle(6, -12, 2, 5, hairColor));
    }

    // Face
    this.add(scene.add.ellipse(-3, -12, 2.5, 3.5, 0x1f2937));
    this.add(scene.add.ellipse(3, -12, 2.5, 3.5, 0x1f2937));
    this.add(scene.add.arc(0, -9, 1.5, 15, 165, false, 0x8b5f52).setLineWidth(1, 0x8b5f52));

    if (glasses) {
      this.add(scene.add.rectangle(-3, -12, 4, 4, 0x000000).setAlpha(0.28));
      this.add(scene.add.rectangle(3, -12, 4, 4, 0x000000).setAlpha(0.28));
      this.add(scene.add.rectangle(0, -12, 2, 1, 0x111111));
    }

    // Outline
    this.add(scene.add.circle(0, -12, headR + 1, outlineColor).setAlpha(0.08));

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
