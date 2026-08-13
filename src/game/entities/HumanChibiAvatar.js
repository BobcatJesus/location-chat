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
  const skinShade = tintInt(skin, -22);
  const hair = palette.hair;
  const outfit = palette.outfit;
  const outfitShade = tintInt(outfit, -26);
  const outline = 0x3a2f2f;

  const stepX = step === 0 ? 0 : 1;
  const legOffset = step === 0 ? 0 : 2;

  // Soft floor shadow.
  g.fillStyle(0x000000, 0.14);
  g.fillEllipse(48, 84, 26, 8);

  // Head + ears.
  g.fillStyle(skin, 1);
  g.fillCircle(48, 30, 20);
  g.fillCircle(31, 36, 6);
  g.fillCircle(65, 36, 6);

  // Hair cap.
  g.fillStyle(hair, 1);
  g.fillEllipse(48, 24, 42, 26);
  if (direction === 'front') {
    g.fillRoundedRect(34, 25, 28, 8, 4);
  } else if (direction === 'side') {
    g.fillRoundedRect(40, 24, 20, 10, 4);
  }

  // Torso + hoodie/tee body.
  g.fillStyle(outfit, 1);
  g.fillRoundedRect(34, 47, 28, 26, 8);
  g.fillStyle(tintInt(outfit, 34), 0.42);
  g.fillRoundedRect(38, 52, 20, 10, 6);

  // Arms.
  g.fillStyle(outfitShade, 1);
  g.fillRoundedRect(28, 50, 8, 22, 4);
  g.fillRoundedRect(60, 50, 8, 22, 4);
  g.fillStyle(skinShade, 1);
  g.fillCircle(32, 73, 4);
  g.fillCircle(64, 73, 4);

  // Legs + shoes.
  g.fillStyle(tintInt(outfit, -12), 1);
  g.fillRoundedRect(39 - legOffset, 71, 8, 11, 3);
  g.fillRoundedRect(49 + legOffset, 71, 8, 11, 3);
  g.fillStyle(0x1b1b1b, 1);
  g.fillRoundedRect(37 - legOffset, 80, 10, 6, 3);
  g.fillRoundedRect(49 + legOffset, 80, 10, 6, 3);

  // Face details.
  if (direction !== 'back') {
    g.fillStyle(0x2d2120, 1);
    if (direction === 'side') {
      g.fillCircle(52 + stepX, 33, 2);
    } else {
      g.fillCircle(42 + stepX, 33, 2);
      g.fillCircle(54 + stepX, 33, 2);
    }
    g.lineStyle(2, 0xc86f5a, 0.9);
    g.beginPath();
    g.arc(48 + stepX, 39, 3, 0.2, Math.PI - 0.2, false);
    g.strokePath();
  }

  // Soft outline pass for chibi readability.
  g.lineStyle(2, outline, 0.72);
  g.strokeCircle(48, 30, 20);
  g.strokeRoundedRect(34, 47, 28, 26, 8);

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
      targetHeight: 68,
      shadowColor: 0x000000,
    });
  }
}
