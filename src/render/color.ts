/** Minimal colour helpers for shading bodies. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const cache = new Map<string, Rgb>();

export function parse(hex: string): Rgb {
  const cached = cache.get(hex);
  if (cached) return cached;
  let value = hex.replace("#", "");
  if (value.length === 3) {
    value = value
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const int = Number.parseInt(value, 16);
  const rgb = { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
  cache.set(hex, rgb);
  return rgb;
}

/** Blend towards white by `amount`, 0 to 1. */
export function lighten(hex: string, amount: number): string {
  const { r, g, b } = parse(hex);
  return `rgb(${mix(r, 255, amount)} ${mix(g, 255, amount)} ${mix(b, 255, amount)})`;
}

/** Blend towards black by `amount`, 0 to 1. */
export function darken(hex: string, amount: number): string {
  const { r, g, b } = parse(hex);
  return `rgb(${mix(r, 0, amount)} ${mix(g, 0, amount)} ${mix(b, 0, amount)})`;
}

export function alpha(hex: string, value: number): string {
  const { r, g, b } = parse(hex);
  return `rgba(${r}, ${g}, ${b}, ${value})`;
}

function mix(from: number, to: number, amount: number): number {
  return Math.round(from + (to - from) * amount);
}
