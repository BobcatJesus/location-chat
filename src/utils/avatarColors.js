const SKIN_TONE_STOPS = [
  '#fbe5cf',
  '#f3d8b8',
  '#eec18f',
  '#dc9f67',
  '#b97753',
  '#815644',
  '#ffedcf',
  '#e0cc8f',
  '#ebb569',
  '#d08a52',
  '#8b5641',
  '#5d3d38',
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const hexToRgb = (hex) => {
  const clean = hex.replace('#', '');
  const int = parseInt(clean, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
};

const rgbToHex = (r, g, b) => {
  const toHex = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const lerp = (a, b, t) => a + (b - a) * t;

const lerpHex = (fromHex, toHex, t) => {
  const a = hexToRgb(fromHex);
  const b = hexToRgb(toHex);
  return rgbToHex(
    lerp(a.r, b.r, t),
    lerp(a.g, b.g, t),
    lerp(a.b, b.b, t),
  );
};

const shiftColor = (hex, amount) => {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + amount, g + amount, b + amount);
};

const hslToRgb = (h, s, l) => {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = light - c / 2;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hue < 60) {
    r1 = c; g1 = x; b1 = 0;
  } else if (hue < 120) {
    r1 = x; g1 = c; b1 = 0;
  } else if (hue < 180) {
    r1 = 0; g1 = c; b1 = x;
  } else if (hue < 240) {
    r1 = 0; g1 = x; b1 = c;
  } else if (hue < 300) {
    r1 = x; g1 = 0; b1 = c;
  } else {
    r1 = c; g1 = 0; b1 = x;
  }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
};

export const colorHexToInt = (hex) => parseInt(hex.replace('#', ''), 16);

export const skinToneToColor = (skinTone = 45) => {
  const p = clamp(Number(skinTone), 0, 100);
  const segmentSize = 100 / (SKIN_TONE_STOPS.length - 1);
  const idx = Math.min(SKIN_TONE_STOPS.length - 2, Math.floor(p / segmentSize));
  const segmentStart = idx * segmentSize;
  const t = (p - segmentStart) / segmentSize;
  return lerpHex(SKIN_TONE_STOPS[idx], SKIN_TONE_STOPS[idx + 1], t);
};

export const skinToneToShade = (skinTone = 45, amount = -20) => shiftColor(skinToneToColor(skinTone), amount);

export const skinToneToSpectrumIndex = (skinTone = 45) => {
  const p = clamp(Number(skinTone), 0, 100);
  const slots = SKIN_TONE_STOPS.length - 1;
  return Math.round((p / 100) * slots);
};

export const spectrumIndexToSkinTone = (index = 0) => {
  const slots = SKIN_TONE_STOPS.length - 1;
  const i = clamp(Number(index), 0, slots);
  return Math.round((i / slots) * 100);
};

export const hueToColor = (hue = 24, saturation = 70, lightness = 45) => {
  const { r, g, b } = hslToRgb(Number(hue), Number(saturation), Number(lightness));
  return rgbToHex(r, g, b);
};

export const hairHueToColor = (hue = 26) => hueToColor(hue, 65, 32);
export const accessoryHueToColor = (hue = 210) => hueToColor(hue, 60, 48);

// Backward-compatible aliases while migrating saved profiles.
export const pigmentToBodyColor = (pigment = 45) => skinToneToColor(pigment);
export const pigmentToLimbColor = (pigment = 45) => skinToneToShade(pigment, -16);
export const pigmentToOutlineColor = (pigment = 45) => skinToneToShade(pigment, -36);
export const pigmentToEarInnerColor = (pigment = 45) => skinToneToShade(pigment, 18);
export const scarfColorFromHue = (hue = 210, saturation = 60, lightness = 48) => hueToColor(hue, saturation, lightness);
export const eyeGlowColorFromHue = (hue = 42, saturation = 95, lightness = 55) => hueToColor(hue, saturation, lightness);
