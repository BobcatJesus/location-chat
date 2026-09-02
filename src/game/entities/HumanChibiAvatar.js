import SpriteAvatarBase from './SpriteAvatarBase';
import {
  colorHexToInt,
} from '../../utils/avatarColors';

const AVATAR_VARIANTS = {
  male: {
    skin: '#ffd4b0',
    hair: '#e5b06b',
    hoodie: '#abdfc4',
  },
  female: {
    skin: '#ffd0b2',
    hair: '#d39a66',
    hoodie: '#aadfc8',
  },
};

const MALE_FRAME_KEYS = {
  front: ['male-front-step1', 'male-front-step2'],
  back: ['male-back-step1', 'male-back-step2'],
  side: ['male-side-step1', 'male-side-step2'],
};

function hasAllMaleFrames(scene) {
  return MALE_FRAME_KEYS.front.every((key) => scene.textures.exists(key))
    && MALE_FRAME_KEYS.back.every((key) => scene.textures.exists(key))
    && MALE_FRAME_KEYS.side.every((key) => scene.textures.exists(key));
}

function normalizeAvatarGender(value) {
  return String(value || '').toLowerCase() === 'female' ? 'female' : 'male';
}

function clamp255(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function tintInt(color, amount) {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return (clamp255(r + amount) << 16) | (clamp255(g + amount) << 8) | clamp255(b + amount);
}

function drawHair(g, { hair, facingBack, facingSide, isFemale }) {
  const shine = tintInt(hair, 18);
  g.fillStyle(hair, 1);

  if (facingBack) {
    g.fillEllipse(48, 23, isFemale ? 43 : 44, 23);
    g.fillRoundedRect(30, 23, 36, 14, 7);
    g.fillCircle(50, 12, isFemale ? 2 : 2.4);
    if (!isFemale) {
      g.beginPath();
      g.moveTo(34, 36);
      g.lineTo(38, 34);
      g.lineTo(42, 36);
      g.lineTo(46, 34);
      g.lineTo(50, 36);
      g.lineTo(54, 34);
      g.lineTo(58, 36);
      g.lineTo(62, 34);
      g.lineTo(66, 36);
      g.lineTo(66, 28);
      g.lineTo(34, 28);
      g.closePath();
      g.fillPath();
    }
    g.fillStyle(shine, 0.16);
    g.fillEllipse(48, 18, 18, 5);
    return;
  }

  if (facingSide) {
    g.fillEllipse(49, 23, isFemale ? 43 : 44, 23);
    g.fillRoundedRect(25, 20, 42, 13, 6);
    g.beginPath();
    g.moveTo(29, 27);
    g.lineTo(36, 25);
    g.lineTo(42, 30);
    g.lineTo(48, 28);
    g.lineTo(56, isFemale ? 32 : 31);
    g.lineTo(65, 28);
    g.lineTo(68, 20);
    g.lineTo(25, 20);
    g.closePath();
    g.fillPath();
    g.fillCircle(54, 12, isFemale ? 1.8 : 2);
    if (isFemale) {
      g.fillRoundedRect(24, 31, 7, 9, 4);
    }
    g.lineStyle(1.1, shine, 0.75);
    g.lineBetween(39, 15, 48, 18);
    g.lineBetween(44, 13, 51, 17);
    return;
  }

  g.fillEllipse(48, 22, isFemale ? 45 : 46, 23);
  g.fillRoundedRect(25, 19, 46, 14, 6);
  g.beginPath();
  g.moveTo(25, 28);
  g.lineTo(30, 35);
  g.lineTo(34, 31);
  g.lineTo(40, isFemale ? 35 : 34);
  g.lineTo(46, 31);
  g.lineTo(52, isFemale ? 35 : 34);
  g.lineTo(58, 31);
  g.lineTo(64, isFemale ? 33 : 32);
  g.lineTo(68, 28);
  g.lineTo(71, 21);
  g.lineTo(25, 21);
  g.closePath();
  g.fillPath();
  g.fillCircle(50, 12, 2.4);
  if (isFemale) {
    g.fillRoundedRect(24, 31, 7, 9, 4);
    g.fillRoundedRect(65, 31, 7, 9, 4);
  }
  g.lineStyle(1.1, shine, 0.75);
  g.lineBetween(39, 16, 46, 18);
  g.lineBetween(47, 14, 55, 18);
  g.lineBetween(52, 18, 57, 21);
}

function drawBody(g, cfg) {
  const {
    skin,
    skinShade,
    hoodie,
    hoodieShade,
    hoodieTrim,
    pants,
    shoe,
    facingBack,
    facingSide,
    isWalkingFrame,
    isFemale,
  } = cfg;

  const armShift = isWalkingFrame ? 1 : 0;

  if (!facingBack) {
    g.fillStyle(skinShade, 1);
    g.fillRoundedRect(44, 50, 8, 7, 3);
  }

  g.fillStyle(hoodie, 1);
  g.fillRoundedRect(28, 54, 40, 24, 11);
  g.fillStyle(hoodieShade, 0.45);
  g.fillRoundedRect(34, 68, 28, 8, 5);

  if (facingBack) {
    g.fillStyle(hoodieShade, 1);
    g.fillRoundedRect(35, 52, 26, 10, 7);
    if (!isFemale) {
      g.lineStyle(1.6, tintInt(hoodieShade, -16), 0.8);
      g.beginPath();
      g.moveTo(35, 60);
      g.lineTo(48, 66);
      g.lineTo(61, 60);
      g.strokePath();
    }
  } else {
    g.fillStyle(hoodieShade, 1);
    g.fillRoundedRect(38, 50, 20, 10, 6);
    if (isFemale) {
      g.lineStyle(1.7, hoodieTrim, 1);
      g.lineBetween(42, 60, 42, 74);
      g.lineBetween(54, 60, 54, 74);
    }

    if (!facingSide) {
      g.lineStyle(1.5, tintInt(hoodieShade, -20), 0.9);
      g.beginPath();
      g.moveTo(35, 73);
      g.lineTo(37, 68);
      g.lineTo(48, 68);
      g.lineTo(59, 68);
      g.lineTo(61, 73);
      g.strokePath();
    }
  }

  g.fillStyle(hoodie, 1);
  g.fillRoundedRect(24 + armShift, 58, 8, 15, 4);
  g.fillRoundedRect(64 - armShift, 58, 8, 15, 4);
  g.fillStyle(skin, 1);
  g.fillCircle(28 + armShift, 74, 5);
  g.fillCircle(68 - armShift, 74, 5);

  g.fillStyle(pants, 1);
  if (facingSide && isWalkingFrame) {
    g.fillRoundedRect(34, 78, 13, 15, 5);
    g.fillRoundedRect(50, 78, 12, 15, 5);
  } else {
    g.fillRoundedRect(36, 78, 11, 15, 5);
    g.fillRoundedRect(50, 78, 11, 15, 5);
  }

  g.fillStyle(shoe, 1);
  if (facingSide && isWalkingFrame) {
    g.fillRoundedRect(31, 92, 17, 9, 5);
    g.fillRoundedRect(50, 91, 14, 9, 5);
  } else {
    g.fillRoundedRect(33, 92, 15, 9, 5);
    g.fillRoundedRect(50, 92, 15, 9, 5);
  }
}

function drawFace(g, { facingBack, facingSide, stepX, isFemale }) {
  if (facingBack) return;

  g.fillStyle(0x4a3f58, 1);
  if (facingSide) {
    g.fillEllipse(43 + stepX, 40, 4.2, 6.2);
  } else {
    g.fillEllipse(40 + stepX, 40, 4.2, 6.2);
    g.fillEllipse(56 + stepX, 40, 4.2, 6.2);
  }

  g.fillStyle(0xf6c3a5, 0.65);
  if (!facingSide) {
    g.fillCircle(33, 46, 3.6);
    g.fillCircle(63, 46, 3.6);
  } else {
    g.fillCircle(33, 45, 3.2);
  }

  g.lineStyle(isFemale ? 1.5 : 1.7, 0xdf8168, 0.95);
  g.beginPath();
  g.arc(facingSide ? 34 : 48 + stepX, 46, 2.4, 0.2, Math.PI - 0.2, false);
  g.strokePath();
}

function drawOutline(g, { outline, facingBack, facingSide, isWalkingFrame }) {
  g.lineStyle(1.9, outline, 0.92);

  if (facingBack) {
    g.strokeEllipse(48, 31, 38, 36);
  } else if (facingSide) {
    g.strokeEllipse(49, 31, 38, 36);
    g.strokeCircle(32, 38, 7);
  } else {
    g.strokeCircle(48, 32, 19);
    g.strokeCircle(29, 37, 7);
    g.strokeCircle(67, 37, 7);
  }

  g.strokeRoundedRect(28, 54, 40, 24, 11);
  if (facingSide && isWalkingFrame) {
    g.strokeRoundedRect(30, 91, 35, 10, 5);
  } else {
    g.strokeRoundedRect(32, 92, 34, 9, 5);
  }

  if (!facingBack) {
    g.lineStyle(1.4, tintInt(outline, 16), 0.35);
    if (facingSide) {
      g.lineBetween(43, 15, 49, 18);
    } else {
      g.lineBetween(39, 16, 46, 18);
      g.lineBetween(47, 14, 55, 18);
      g.lineBetween(52, 18, 57, 21);
    }
  }
}

function ensureChibiFrame(scene, key, palette, direction = 'front', step = 0) {
  if (scene.textures.exists(key)) return;

  const g = scene.make.graphics({ x: 0, y: 0, add: false });

  const skin = palette.skin;
  const skinShade = tintInt(skin, -12);
  const hair = palette.hair;
  const hoodie = palette.hoodie;
  const hoodieShade = tintInt(hoodie, -14);
  const hoodieTrim = 0x2e2a30;
  const pants = 0x514c5b;
  const shoe = 0x0d0d0e;
  const outline = 0x342d33;
  const isFemale = palette.variant === 'female';

  const isWalkingFrame = step === 1;
  const stepX = isWalkingFrame ? 1 : 0;
  const facingSide = direction === 'side';
  const facingBack = direction === 'back';

  g.fillStyle(0x000000, 0.2);
  g.fillRoundedRect(23, 95, 50, 4, 2);

  g.fillStyle(skin, 1);
  g.fillCircle(48, 32, 19);
  if (!facingBack) {
    g.fillCircle(facingSide ? 32 : 29, 37, 7);
    if (!facingSide) g.fillCircle(67, 37, 7);
  }

  drawHair(g, { hair, facingBack, facingSide, isFemale });

  drawBody(g, {
    skin,
    skinShade,
    hoodie,
    hoodieShade,
    hoodieTrim,
    pants,
    shoe,
    facingBack,
    facingSide,
    isWalkingFrame,
    isFemale,
  });

  drawFace(g, { facingBack, facingSide, stepX, isFemale });

  drawOutline(g, { outline, facingBack, facingSide, isWalkingFrame });

  g.generateTexture(key, 96, 96);
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
    const avatarGender = normalizeAvatarGender(options.avatarGender);
    const variant = AVATAR_VARIANTS[avatarGender];

    if (avatarGender === 'male' && hasAllMaleFrames(scene)) {
        super(scene, x, y, {
          ...options,
          bodyType: 'standard',
          frameKeys: MALE_FRAME_KEYS,
          targetHeight: 76,
          shadowColor: 0x000000,
        });
        return;
    }

    const palette = {
      skin: colorHexToInt(variant.skin),
      hair: colorHexToInt(variant.hair),
      hoodie: colorHexToInt(variant.hoodie),
      variant: avatarGender,
    };

    const paletteKey = avatarGender;
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
