/**
 * Colours shared by the WebGL scene and the page's CSS. The ten arm colours
 * are evenly spaced hues at one OKLCH lightness and chroma, so no digit looks
 * louder than another on the dark ground.
 */

export type Rgb = [number, number, number];

const ARM_LIGHTNESS = 0.76;
const ARM_CHROMA = 0.135;
const ARM_FIRST_HUE = 25;

/** OKLCH -> linear-light sRGB (Björn Ottosson's OKLab matrices). */
function oklchToLinear(l: number, c: number, hueDegrees: number): Rgb {
  const h = (hueDegrees * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

function linearToSrgb(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}

/** OKLCH -> display sRGB, each channel 0..1. */
export function oklch(l: number, c: number, hueDegrees: number): Rgb {
  const [r, g, b] = oklchToLinear(l, c, hueDegrees);
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(b)];
}

export function css(rgb: Rgb): string {
  const [r, g, b] = rgb.map((v) => Math.round(v * 255));
  return `rgb(${r} ${g} ${b})`;
}

/** One colour per digit 0..9. */
export const ARM_COLORS: Rgb[] = Array.from({ length: 10 }, (_, digit) =>
  oklch(ARM_LIGHTNESS, ARM_CHROMA, ARM_FIRST_HUE + digit * 36),
);

/** Fallen dominoes that belong to no digit. */
export const SHARED_COLOR: Rgb = oklch(0.62, 0.012, 80);

export const IVORY: Rgb = [0.9, 0.9, 0.88];
/** The one accent colour, shared with the page's CSS. */
export const ACCENT: Rgb = [0.776, 0.945, 0.208];
export const FOG: Rgb = [0.043, 0.043, 0.047];
export const GROUND: Rgb = [0.06, 0.06, 0.064];
