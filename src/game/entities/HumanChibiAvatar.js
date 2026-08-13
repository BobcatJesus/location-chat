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
  const skinShade = tintInt(skin, -20);
  const skinGlow = tintInt(skin, 18);
  const hair = palette.hair;
  const shirt = 0xf6f1e9;
  const shirtShade = 0xe7dece;
  const pants = tintInt(palette.outfit, -56);
  const pantsShade = tintInt(pants, -18);
  const outline = 0x3b2f30;

  const stepX = step === 0 ? 0 : 1;
  const legOffset = step === 0 ? 0 : 2;
  const armSwing = step === 0 ? 0 : 1;

  // Soft floor shadow.
  g.fillStyle(0x000000, 0.16);
  g.fillEllipse(48, 85, 28, 8);

  // Head + ears + neck.
  g.fillStyle(skin, 1);
  g.fillCircle(48, 29, 21);
  g.fillCircle(30, 35, 6);
  g.fillCircle(66, 35, 6);
  g.fillRoundedRect(44, 45, 8, 6, 3);

  g.fillStyle(skinGlow, 0.24);
  g.fillEllipse(48, 30, 26, 18);

  // Hair cap.
  g.fillStyle(hair, 1);
  g.fillEllipse(48, 22, 44, 26);
  if (direction === 'back') {
    g.fillRoundedRect(31, 20, 34, 12, 6);
  } else if (direction === 'front') {
    g.fillRoundedRect(33, 23, 30, 8, 4);
  } else if (direction === 'side') {
    g.fillRoundedRect(38, 22, 24, 10, 4);
  }

  // Shirt body.
  g.fillStyle(shirt, 1);
  g.fillRoundedRect(33, 48, 30, 24, 8);
  g.fillStyle(shirtShade, 0.64);
  g.fillRoundedRect(36, 58, 24, 10, 6);

  // Collar.
  g.fillStyle(0xffffff, 0.9);
  g.fillRoundedRect(42, 48, 12, 4, 2);

  // Arms.
  g.fillStyle(shirt, 1);
  g.fillRoundedRect(27 + armSwing, 50, 8, 21, 4);
  g.fillRoundedRect(61 - armSwing, 50, 8, 21, 4);
  g.fillStyle(skinShade, 1);
  g.fillCircle(31 + armSwing, 73, 4);
  g.fillCircle(65 - armSwing, 73, 4);

  // Legs + shoes.
  g.fillStyle(pants, 1);
  g.fillRoundedRect(39 - legOffset, 71, 8, 11, 3);
  g.fillRoundedRect(49 + legOffset, 71, 8, 11, 3);
  g.fillStyle(pantsShade, 1);
  g.fillRoundedRect(39 - legOffset, 75, 8, 7, 3);
  g.fillRoundedRect(49 + legOffset, 75, 8, 7, 3);
  g.fillStyle(0x1b1b1b, 1);
  g.fillRoundedRect(37 - legOffset, 80, 10, 6, 3);
  g.fillRoundedRect(49 + legOffset, 80, 10, 6, 3);

  // Face details.
  if (direction !== 'back') {
    g.fillStyle(0x3a2b2a, 1);
    if (direction === 'side') {
      g.fillEllipse(52 + stepX, 33, 4, 5);
    } else {
      g.fillEllipse(42 + stepX, 33, 4, 5);
      g.fillEllipse(54 + stepX, 33, 4, 5);
    }

    // Blush + mouth.
    g.fillStyle(0xf8c29f, 0.58);
    g.fillCircle(38, 39, 3.5);
    g.fillCircle(58, 39, 3.5);

    g.lineStyle(2, 0xd68062, 0.95);
    g.beginPath();
    g.arc(48 + stepX, 40, 2.8, 0.2, Math.PI - 0.2, false);
    g.strokePath();
  }

  // Soft outline pass for chibi readability.
  g.lineStyle(2, outline, 0.82);
  g.strokeCircle(48, 29, 21);
  g.strokeRoundedRect(33, 48, 30, 24, 8);
  g.strokeRoundedRect(37 - legOffset, 80, 22, 6, 3);

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
      targetHeight: 72,
      shadowColor: 0x000000,
    });
  }
}
