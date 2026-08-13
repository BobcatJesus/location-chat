import SpriteAvatarBase from './SpriteAvatarBase';
import {
  skinToneToColor,
  hairHueToColor,
  accessoryHueToColor,
  colorHexToInt,
} from '../../utils/avatarColors';

function clamp255(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function tintInt(color, amount) {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return (clamp255(r + amount) << 16) | (clamp255(g + amount) << 8) | clamp255(b + amount);
}

function ensureChibiFrame(scene, key, palette, direction = 'front', step = 0) {
  if (scene.textures.exists(key)) return;

  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  const w = 96;
  const h = 96;

  const skin = palette.skin;
  const skinShade = tintInt(skin, -18);
  const hair = palette.hair;
  const hoodie = tintInt(palette.outfit, 18);
  const hoodieShade = tintInt(hoodie, -26);
  const shorts = tintInt(palette.outfit, -54);
  const shortsShade = tintInt(shorts, -16);
  const belt = 0xc9b54e;
  const outline = 0x3b2f30;

  const stepX = step === 0 ? 0 : 1;
  const legOffset = step === 0 ? 0 : 3;
  const armSwing = step === 0 ? 0 : 2;

  const facingSide = direction === 'side';
  const facingBack = direction === 'back';

  // Soft floor shadow.
  g.fillStyle(0x000000, 0.18);
  g.fillRoundedRect(24, 86, 48, 4, 2);

  // Head + ears.
  g.fillStyle(skin, 1);
  g.fillCircle(48, 30, 21);
  if (!facingBack) {
    g.fillCircle(facingSide ? 65 : 30, 36, 6);
    if (!facingSide) g.fillCircle(66, 36, 6);
  }

  // Hair cap + bun.
  g.fillStyle(hair, 1);
  g.fillEllipse(48, 23, 44, 26);
  if (facingBack) {
    g.fillRoundedRect(31, 21, 34, 12, 6);
    g.fillCircle(52, 10, 6);
  } else if (facingSide) {
    g.fillRoundedRect(35, 22, 30, 11, 5);
    g.fillCircle(58, 10, 6);
  } else {
    g.fillRoundedRect(33, 24, 30, 8, 4);
    g.fillCircle(52, 10, 6);
  }

  // Hoodie torso.
  g.fillStyle(hoodie, 1);
  g.fillRoundedRect(32, 49, 32, 23, 8);
  g.fillStyle(hoodieShade, 0.42);
  g.fillRoundedRect(36, 61, 24, 8, 5);

  // Hood (front/back/side variants).
  g.fillStyle(hoodieShade, 1);
  if (facingBack) {
    g.fillRoundedRect(39, 43, 18, 10, 5);
  } else if (facingSide) {
    g.fillRoundedRect(41, 44, 18, 9, 5);
  } else {
    g.fillRoundedRect(40, 45, 16, 8, 4);
  }

  // Arms.
  g.fillStyle(hoodie, 1);
  g.fillRoundedRect(26 + armSwing, 51, 8, 20, 4);
  g.fillRoundedRect(62 - armSwing, 51, 8, 20, 4);
  g.fillStyle(skinShade, 1);
  g.fillCircle(30 + armSwing, 72, 4);
  g.fillCircle(66 - armSwing, 72, 4);

  // Waist band.
  g.fillStyle(belt, 1);
  g.fillRoundedRect(34, 69, 28, 5, 2);

  // Shorts.
  g.fillStyle(shorts, 1);
  g.fillRoundedRect(36, 74, 14, 9, 3);
  g.fillRoundedRect(46, 74, 14, 9, 3);
  g.fillStyle(shortsShade, 1);
  g.fillRoundedRect(36, 79, 24, 4, 2);

  // Legs + shoes.
  g.fillStyle(skin, 1);
  g.fillRoundedRect(39 - legOffset, 82, 8, 7, 3);
  g.fillRoundedRect(49 + legOffset, 82, 8, 7, 3);
  g.fillStyle(0x1b1b1b, 1);
  g.fillRoundedRect(36 - legOffset, 87, 12, 7, 4);
  g.fillRoundedRect(48 + legOffset, 87, 12, 7, 4);

  // Face details.
  if (!facingBack) {
    g.fillStyle(0x3a2b2a, 1);
    if (facingSide) {
      g.fillEllipse(53 + stepX, 33, 4, 6);
    } else {
      g.fillEllipse(42 + stepX, 33, 4, 6);
      g.fillEllipse(54 + stepX, 33, 4, 6);
    }

    // Blush + mouth.
    g.fillStyle(0xf8c29f, 0.58);
    if (!facingSide) {
      g.fillCircle(38, 39, 3.5);
      g.fillCircle(58, 39, 3.5);
    }

    g.lineStyle(2, 0xd68062, 0.95);
    g.beginPath();
    g.arc(facingSide ? 47 : 48 + stepX, 40, 2.8, 0.2, Math.PI - 0.2, false);
    g.strokePath();
  }

  // Soft outline pass for chibi readability.
  g.lineStyle(2, outline, 0.82);
  g.strokeCircle(48, 30, 21);
  g.strokeRoundedRect(32, 49, 32, 23, 8);
  g.strokeRoundedRect(34, 69, 28, 5, 2);
  g.strokeRoundedRect(36 - legOffset, 87, 24, 7, 4);

  g.generateTexture(key, w, h);
  g.destroy();
}

function makeFrameKeys(scene, paletteKey, palette) {
  const keys = {
    front: [
      `chibi-${paletteKey}-front-1`,
      `chibi-${paletteKey}-front-2`,
    ],
    back: [
      `chibi-${paletteKey}-back-1`,
      `chibi-${paletteKey}-back-2`,
    ],
    side: [
      `chibi-${paletteKey}-side-1`,
      `chibi-${paletteKey}-side-2`,
    ],
  };

  ensureChibiFrame(scene, keys.front[0], palette, 'front', 0);
  ensureChibiFrame(scene, keys.front[1], palette, 'front', 1);
  ensureChibiFrame(scene, keys.back[0], palette, 'back', 0);
  ensureChibiFrame(scene, keys.back[1], palette, 'back', 1);
  ensureChibiFrame(scene, keys.side[0], palette, 'side', 0);
  ensureChibiFrame(scene, keys.side[1], palette, 'side', 1);

  return keys;
}

export default class HumanChibiAvatar extends SpriteAvatarBase {
  constructor(scene, x, y, options = {}) {
    const skinTone = options.skinTone ?? options.pigment ?? 45;
    const hairHue = options.hairHue ?? options.eyeHue ?? 26;
    const outfitHue = options.outfitHue ?? options.scarfHue ?? 220;

    const palette = {
      skin: colorHexToInt(skinToneToColor(skinTone)),
      hair: colorHexToInt(hairHueToColor(hairHue)),
      outfit: colorHexToInt(accessoryHueToColor(outfitHue)),
    };

    const paletteKey = `${Math.round(Number(skinTone) || 45)}-${Math.round(Number(hairHue) || 26)}-${Math.round(Number(outfitHue) || 220)}`;
    const frameKeys = makeFrameKeys(scene, paletteKey, palette);

    super(scene, x, y, {
      ...options,
      frameKeys,
      targetHeight: 74,
      shadowColor: 0x000000,
    });
  }
}
