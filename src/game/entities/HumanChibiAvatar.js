import SpriteAvatarBase from './SpriteAvatarBase';
import {
  skinToneToColor,
  hairHueToColor,
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

function drawHair(g, cfg) {
  const {
    hair,
    facingBack,
    facingSide,
  } = cfg;

  g.fillStyle(hair, 1);
  const shine = tintInt(hair, 14);
  g.fillEllipse(48, 20, 48, 24);
  g.fillRoundedRect(24, 18, 48, 14, 6);
  if (!facingBack) {
    g.beginPath();
    g.moveTo(24, 28);
    g.lineTo(30, 34);
    g.lineTo(36, 30);
    g.lineTo(47, 35);
    g.lineTo(58, 30);
    g.lineTo(64, 34);
    g.lineTo(72, 28);
    g.lineTo(72, 18);
    g.lineTo(24, 18);
    g.closePath();
    g.fillPath();
  } else {
    g.fillRoundedRect(26, 26, 44, 10, 5);
  }

  if (facingSide) {
    g.fillStyle(shine, 0.25);
    g.fillRoundedRect(50, 13, 12, 6, 3);
  } else if (!facingBack) {
    g.fillStyle(shine, 0.22);
    g.fillRoundedRect(38, 12, 20, 5, 3);
  }
}

function ensureChibiFrame(scene, key, palette, direction = 'front', step = 0) {
  if (scene.textures.exists(key)) return;

  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  const w = 96;
  const h = 96;

  const skin = palette.skin;
  const skinShade = tintInt(skin, -12);
  const hair = palette.hair;
  const shirt = 0xf8f2e8;
  const shirtShade = 0xede2d1;
  const shirtCollar = 0xd8c9b4;
  const pants = 0x55516a;
  const pantsShade = 0x444156;
  const shoe = 0x141313;
  const outline = 0x3a2f31;

  const isWalkingFrame = step === 1;
  const stepX = isWalkingFrame ? 1 : 0;
  const legOffset = isWalkingFrame ? 5 : 0;
  const armSwing = isWalkingFrame ? 2 : 0;

  const facingSide = direction === 'side';
  const facingBack = direction === 'back';

  g.fillStyle(0x000000, 0.14);
  g.fillEllipse(48, 95, 52, 9);

  g.fillStyle(skin, 1);
  g.fillCircle(48, 32, 22);
  if (!facingBack) {
    g.fillCircle(facingSide ? 68 : 24, 37, 7);
    if (!facingSide) g.fillCircle(72, 37, 7);
  }

  drawHair(g, {
    hair,
    facingBack,
    facingSide,
  });

  // Neck.
  g.fillStyle(skinShade, 1);
  g.fillRoundedRect(44, 50, 8, 8, 3);

  // Shirt + sleeves.
  g.fillStyle(shirt, 1);
  g.fillRoundedRect(29, 54, 38, 23, 10);
  g.lineStyle(2, shirtCollar, 0.9);
  g.beginPath();
  g.arc(48, 55, 8, 0.3, Math.PI - 0.3, false);
  g.strokePath();
  g.fillStyle(shirtShade, 1);
  g.fillRoundedRect(34, 67, 28, 9, 6);
  g.fillRoundedRect(25 + armSwing, 58, 9, 15, 4);
  g.fillRoundedRect(62 - armSwing, 58, 9, 15, 4);

  // Hands.
  g.fillStyle(skin, 1);
  g.fillCircle(29 + armSwing, 74, 5);
  g.fillCircle(66 - armSwing, 74, 5);

  // Pants.
  g.fillStyle(pants, 1);
  if (facingSide && isWalkingFrame) {
    g.fillRoundedRect(34, 77, 13, 15, 5);
    g.fillRoundedRect(50, 77, 12, 15, 5);
  } else {
    g.fillRoundedRect(35, 77, 12, 15, 5);
    g.fillRoundedRect(49, 77, 12, 15, 5);
  }
  g.fillStyle(pantsShade, 1);
  g.fillRoundedRect(35, 84, 26, 6, 3);

  // Ankles + shoes.
  g.fillStyle(skin, 1);
  if (facingSide && isWalkingFrame) {
    g.fillRoundedRect(35 - legOffset, 89, 8, 5, 2);
    g.fillRoundedRect(53 + legOffset, 88, 7, 5, 2);
    g.fillStyle(shoe, 1);
    g.fillRoundedRect(31 - legOffset, 92, 16, 8, 4);
    g.fillRoundedRect(49 + legOffset, 91, 14, 8, 4);
  } else {
    g.fillRoundedRect(37 - legOffset, 89, 7, 5, 2);
    g.fillRoundedRect(52 + legOffset, 89, 7, 5, 2);
    g.fillStyle(shoe, 1);
    g.fillRoundedRect(32 - legOffset, 92, 15, 8, 4);
    g.fillRoundedRect(49 + legOffset, 92, 15, 8, 4);
  }

  if (!facingBack) {
    g.fillStyle(0x4b3a36, 1);
    if (facingSide) {
      g.fillEllipse(55 + stepX, 40, 4, 6.2);
    } else {
      g.fillEllipse(41 + stepX, 40, 4, 6.2);
      g.fillEllipse(55 + stepX, 40, 4, 6.2);
    }

    g.fillStyle(0xf8c5a9, 0.58);
    if (!facingSide) {
      g.fillCircle(35, 46, 3.9);
      g.fillCircle(61, 46, 3.9);
    }

    g.lineStyle(1.7, 0xdb886a, 0.95);
    g.beginPath();
    g.arc(facingSide ? 50 : 48 + stepX, 46, 2.4, 0.25, Math.PI - 0.25, false);
    g.strokePath();
  }

  // Outline pass to lock the reference style silhouette.
  g.lineStyle(1.8, outline, 0.88);
  g.strokeCircle(48, 32, 22);
  if (!facingBack) {
    g.strokeCircle(facingSide ? 68 : 24, 37, 7);
    if (!facingSide) g.strokeCircle(72, 37, 7);
  }
  g.strokeRoundedRect(29, 54, 38, 23, 10);
  g.strokeRoundedRect(35, 77, 26, 15, 5);
  if (facingSide && isWalkingFrame) {
    g.strokeRoundedRect(31 - legOffset, 91, 32, 9, 4);
  } else {
    g.strokeRoundedRect(32 - legOffset, 92, 32, 8, 4);
  }
  g.strokeRoundedRect(24, 18, 48, 14, 6);

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

    const palette = {
      skin: colorHexToInt(skinToneToColor(skinTone)),
      hair: colorHexToInt(hairHueToColor(hairHue)),
    };

    const paletteKey = `${Math.round(Number(skinTone) || 45)}-${Math.round(Number(hairHue) || 26)}`;
    const frameKeys = makeFrameKeys(scene, paletteKey, palette);

    super(scene, x, y, {
      ...options,
      bodyType: 'standard',
      frameKeys,
      targetHeight: 76,
      shadowColor: 0x000000,
    });
  }
}
