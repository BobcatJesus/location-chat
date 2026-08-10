const PIGMENT_STOPS = [
  '#f5d8b6',
  '#ddb892',
  '#b08968',
  '#7f5539',
  '#3d2b1f',
  '#25262b',
  '#111218',
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

export const pigmentToBodyColor = (pigment = 82) => {
  const p = clamp(Number(pigment), 0, 100);
  const segmentSize = 100 / (PIGMENT_STOPS.length - 1);
  const idx = Math.min(PIGMENT_STOPS.length - 2, Math.floor(p / segmentSize));
  const segmentStart = idx * segmentSize;
  const t = (p - segmentStart) / segmentSize;
  return lerpHex(PIGMENT_STOPS[idx], PIGMENT_STOPS[idx + 1], t);
};

export const pigmentToEarInnerColor = (pigment = 82) => shiftColor(pigmentToBodyColor(pigment), 24);
export const pigmentToLimbColor = (pigment = 82) => shiftColor(pigmentToBodyColor(pigment), -18);
export const pigmentToOutlineColor = (pigment = 82) => shiftColor(pigmentToBodyColor(pigment), -42);

export const scarfColorFromHue = (hue = 195, saturation = 52, lightness = 72) => {
  const { r, g, b } = hslToRgb(Number(hue), saturation, lightness);
  return rgbToHex(r, g, b);
};

export const eyeGlowColorFromHue = (hue = 42, saturation = 95, lightness = 57) => {
  const { r, g, b } = hslToRgb(Number(hue), saturation, lightness);
  return rgbToHex(r, g, b);
};

export const scarfSwatchFromProfile = (profile) => {
  if (profile && profile.scarfHue !== undefined && profile.scarfHue !== null) {
    return scarfColorFromHue(profile.scarfHue);
  }
  return '#8a8f9e';
};
