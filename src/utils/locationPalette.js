const DEFAULT_PROFILE = {
  key: 'default',
  hue: 254,
  saturation: 58,
  lightness: 38,
};

export const DEFAULT_PALETTE_MOOD = {
  warmth: 0,
  saturation: 0,
  contrast: 0,
};

const PROFILE_RULES = [
  {
    key: 'park',
    hue: 126,
    saturation: 56,
    lightness: 43,
    keywords: ['park', 'garden', 'forest', 'grove', 'green', 'meadow', 'nature', 'arboretum', 'playground', 'trail', 'reserve', 'botanical', 'lawn'],
  },
  {
    key: 'cafe',
    hue: 34,
    saturation: 66,
    lightness: 39,
    keywords: ['cafe', 'coffee', 'espresso', 'bakery', 'tea', 'starbucks'],
  },
  {
    key: 'restaurant',
    hue: 18,
    saturation: 64,
    lightness: 37,
    keywords: ['restaurant', 'food', 'diner', 'bistro', 'kitchen', 'fast_food'],
  },
  {
    key: 'bar',
    hue: 286,
    saturation: 62,
    lightness: 32,
    keywords: ['bar', 'pub', 'nightclub', 'wine', 'cocktail', 'agora', 'lounge'],
  },
  {
    key: 'temple',
    hue: 338,
    saturation: 54,
    lightness: 37,
    keywords: ['temple', 'shrine', 'church', 'cathedral', 'mosque', 'sanctuary', 'chapel'],
  },
  {
    key: 'urban',
    hue: 212,
    saturation: 46,
    lightness: 39,
    keywords: ['downtown', 'plaza', 'square', 'station', 'transit', 'commercial', 'mall', 'office', 'street'],
  },
  {
    key: 'waterfront',
    hue: 196,
    saturation: 60,
    lightness: 40,
    keywords: ['river', 'lake', 'harbor', 'water', 'ocean', 'bay', 'canal', 'beach'],
  },
  {
    key: 'fitness',
    hue: 206,
    saturation: 72,
    lightness: 40,
    keywords: ['gym', 'fitness', 'sports_centre', 'stadium', 'track'],
  },
  {
    key: 'culture',
    hue: 44,
    saturation: 50,
    lightness: 37,
    keywords: ['museum', 'gallery', 'theatre', 'cinema', 'library', 'art'],
  },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeHue(hue) {
  let next = Number(hue) % 360;
  if (next < 0) next += 360;
  return next;
}

function hashString(input = '') {
  let hash = 2166136261;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashUnit(input = '') {
  return hashString(input) / 0xffffffff;
}

function hslToRgb(h, s, l) {
  const hue = normalizeHue(h) / 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;

  if (sat === 0) {
    const gray = Math.round(light * 255);
    return { r: gray, g: gray, b: gray };
  }

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;

  const hueToChannel = (t) => {
    let tc = t;
    if (tc < 0) tc += 1;
    if (tc > 1) tc -= 1;
    if (tc < 1 / 6) return p + (q - p) * 6 * tc;
    if (tc < 1 / 2) return q;
    if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
    return p;
  };

  return {
    r: Math.round(hueToChannel(hue + 1 / 3) * 255),
    g: Math.round(hueToChannel(hue) * 255),
    b: Math.round(hueToChannel(hue - 1 / 3) * 255),
  };
}

function rgbToHex({ r, g, b }) {
  const toHex = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hslToHex(h, s, l) {
  return rgbToHex(hslToRgb(h, s, l));
}

function hexToInt(hex = '#000000') {
  return Number.parseInt(String(hex).replace('#', ''), 16) || 0;
}

function normalizeMood(mood = {}) {
  return {
    warmth: clamp(Number(mood?.warmth) || 0, -1, 1),
    saturation: clamp(Number(mood?.saturation) || 0, -1, 1),
    contrast: clamp(Number(mood?.contrast) || 0, -1, 1),
  };
}

function getBrandOverride(roomText = '') {
  const text = String(roomText || '').toLowerCase();

  if (text.includes('starbucks')) {
    return {
      profile: 'starbucks',
      accent: '#00704a',
      decor: '#0f8f61',
      wall: '#003826',
      floor1: '#001f15',
      floor2: '#00281b',
      brand: 'starbucks',
      brandLabel: 'Starbucks green',
    };
  }

  if (text.includes('mcdonald') || text.includes('mc donald')) {
    return {
      profile: 'mcdonalds',
      accent: '#ffbc0d',
      decor: '#ffd54f',
      wall: '#d62828',
      floor1: '#5e1f1f',
      floor2: '#7a2424',
      brand: 'mcdonalds',
      brandLabel: 'McDonald\'s red and yellow',
    };
  }

  return null;
}

function getRoomText(room = {}) {
  const tags = room?.tags && typeof room.tags === 'object' ? room.tags : {};
  const tagText = Object.entries(tags)
    .map(([key, value]) => `${String(key)} ${String(value)}`)
    .join(' ');
  return [
    room?.id,
    room?.name,
    room?.amenity,
    room?.shop,
    room?.kind,
    room?.tourism,
    room?.leisure,
    room?.natural,
    room?.landuse,
    tagText,
  ].filter(Boolean).join(' ').toLowerCase();
}

function scoreProfiles(roomText = '') {
  return PROFILE_RULES
    .map((rule) => {
      const score = rule.keywords.reduce((acc, keyword) => {
        if (!roomText.includes(keyword)) return acc;
        return acc + (keyword.includes('_') ? 1.2 : 1);
      }, 0);
      return { ...rule, score };
    })
    .filter((rule) => rule.score > 0)
    .sort((a, b) => b.score - a.score);
}

function weightedHueMean(scoredProfiles) {
  if (!Array.isArray(scoredProfiles) || scoredProfiles.length === 0) return DEFAULT_PROFILE.hue;

  let x = 0;
  let y = 0;
  scoredProfiles.forEach((profile) => {
    const weight = Math.max(0.1, Number(profile.score) || 0.1);
    const rad = (normalizeHue(profile.hue) * Math.PI) / 180;
    x += Math.cos(rad) * weight;
    y += Math.sin(rad) * weight;
  });

  if (x === 0 && y === 0) return DEFAULT_PROFILE.hue;
  return normalizeHue((Math.atan2(y, x) * 180) / Math.PI);
}

function weightedAverage(scoredProfiles, key, fallback) {
  if (!Array.isArray(scoredProfiles) || scoredProfiles.length === 0) return fallback;
  let total = 0;
  let sum = 0;
  scoredProfiles.forEach((profile) => {
    const weight = Math.max(0.1, Number(profile.score) || 0.1);
    total += weight;
    sum += Number(profile[key]) * weight;
  });
  if (!total) return fallback;
  return sum / total;
}

function deriveModulation(room = {}, roomText = '') {
  const levelRaw = room?.tags?.['building:levels'] ?? room?.buildingLevels ?? room?.levels ?? 1;
  const levels = clamp(Number.parseInt(String(levelRaw), 10) || 1, 1, 12);

  const lateNight = roomText.includes('bar') || roomText.includes('night') || roomText.includes('pub');
  const greenSpace = roomText.includes('park') || roomText.includes('garden') || roomText.includes('forest');
  const sacred = roomText.includes('temple') || roomText.includes('church') || roomText.includes('shrine');

  return {
    hueShift: (hashUnit(`${room?.id || 'room'}:h`) - 0.5) * 22,
    saturationShift: (hashUnit(`${room?.id || 'room'}:s`) - 0.5) * 12,
    lightnessShift: (hashUnit(`${room?.id || 'room'}:l`) - 0.5) * 10,
    levels,
    lateNight,
    greenSpace,
    sacred,
  };
}

export function deriveLocationPalette(room = {}, options = {}) {
  const mood = normalizeMood(options?.mood || DEFAULT_PALETTE_MOOD);
  const includeDiagnostics = Boolean(options?.includeDiagnostics);
  const roomText = getRoomText(room);
  const brandOverride = getBrandOverride(roomText);

  if (brandOverride) {
    const result = {
      ...brandOverride,
      accentInt: hexToInt(brandOverride.accent),
      decorInt: hexToInt(brandOverride.decor),
      wallInt: hexToInt(brandOverride.wall),
      floor1Int: hexToInt(brandOverride.floor1),
      floor2Int: hexToInt(brandOverride.floor2),
      mood,
    };

    if (includeDiagnostics) {
      result.diagnostics = {
        roomText,
        mood,
        scores: [{ key: brandOverride.profile, score: 10 }],
        base: null,
        modulation: {
          brandOverride: brandOverride.brandLabel,
        },
        final: {
          hue: null,
          saturation: null,
          lightness: null,
        },
        colors: {
          accent: brandOverride.accent,
          decor: brandOverride.decor,
          wall: brandOverride.wall,
          floor1: brandOverride.floor1,
          floor2: brandOverride.floor2,
        },
      };
    }

    return result;
  }

  const scoredProfiles = scoreProfiles(roomText);
  const primary = scoredProfiles[0] || DEFAULT_PROFILE;

  const baseHue = weightedHueMean(scoredProfiles);
  const baseSaturation = weightedAverage(scoredProfiles, 'saturation', DEFAULT_PROFILE.saturation);
  const baseLightness = weightedAverage(scoredProfiles, 'lightness', DEFAULT_PROFILE.lightness);
  const mod = deriveModulation(room, roomText);

  const moodHueShift = mood.warmth * 26;
  const moodSatShift = mood.saturation * 18;
  const moodLightShift = mood.contrast * -6;

  let hue = normalizeHue(baseHue + mod.hueShift + moodHueShift);
  let saturation = clamp(baseSaturation + mod.saturationShift + moodSatShift, 30, 90);
  let lightness = clamp(baseLightness + mod.lightnessShift + moodLightShift, 20, 60);

  if (mod.greenSpace) {
    lightness = clamp(lightness + 4, 24, 58);
    saturation = clamp(saturation + 4, 34, 88);
  }
  if (mod.lateNight) {
    lightness = clamp(lightness - 6, 18, 52);
    saturation = clamp(saturation + 3, 34, 88);
  }
  if (mod.sacred) {
    hue = normalizeHue(hue + 8);
    saturation = clamp(saturation - 5, 30, 82);
    lightness = clamp(lightness + 2, 22, 58);
  }

  const contrastBoost = clamp((mod.levels - 1) * 1.1 + mood.contrast * 7, 0, 10);

  const accent = hslToHex(hue, clamp(saturation + 9, 40, 92), clamp(lightness + 16, 36, 72));
  const decor = hslToHex(hue + 10, clamp(saturation + 3, 30, 90), clamp(lightness + 8 + contrastBoost, 28, 66));
  const wall = hslToHex(hue - 6, clamp(saturation - 12, 20, 74), clamp(lightness - 15 - contrastBoost, 10, 42));
  const floor1 = hslToHex(hue - 2, clamp(saturation - 20, 16, 70), clamp(lightness - 12, 12, 44));
  const floor2 = hslToHex(hue + 4, clamp(saturation - 16, 18, 72), clamp(lightness - 8, 16, 48));

  const result = {
    profile: primary.key || 'default',
    accent,
    decor,
    wall,
    floor1,
    floor2,
    cardBg: `linear-gradient(135deg, ${floor1} 0%, ${wall} 100%)`,
    accentInt: hexToInt(accent),
    decorInt: hexToInt(decor),
    wallInt: hexToInt(wall),
    floor1Int: hexToInt(floor1),
    floor2Int: hexToInt(floor2),
    mood,
  };

  if (includeDiagnostics) {
    result.diagnostics = {
      roomText,
      mood,
      scores: scoredProfiles.map((profile) => ({ key: profile.key, score: round2(profile.score) })),
      base: {
        hue: round2(baseHue),
        saturation: round2(baseSaturation),
        lightness: round2(baseLightness),
      },
      modulation: {
        hueShift: round2(mod.hueShift + moodHueShift),
        saturationShift: round2(mod.saturationShift + moodSatShift),
        lightnessShift: round2(mod.lightnessShift + moodLightShift),
        levels: mod.levels,
        lateNight: mod.lateNight,
        greenSpace: mod.greenSpace,
        sacred: mod.sacred,
      },
      final: {
        hue: round2(hue),
        saturation: round2(saturation),
        lightness: round2(lightness),
      },
      colors: {
        accent,
        decor,
        wall,
        floor1,
        floor2,
      },
    };
  }

  return result;
}
