/**
 * Theme access for everything drawn on a canvas.
 *
 * The palettes live in the stylesheet, not here. That keeps a colour written
 * down exactly once -- the chrome takes it through `var(--x)` and the canvas
 * reads the same property back with `getComputedStyle`. The alternative, a
 * table of hexes in TypeScript mirrored by a table of hexes in CSS, drifts
 * apart the first time anyone adjusts one of them.
 *
 * Resolving a custom property is not free, so the whole set is read once per
 * theme change and cached.
 */

export interface ThemeId {
  id: string;
  label: string;
}

export const THEMES: ThemeId[] = [
  { id: "charm", label: "charm" },
  { id: "onyx", label: "onyx" },
  { id: "ember", label: "ember" },
  { id: "paper", label: "paper" },
];

const DEFAULT_THEME = "charm";
const STORAGE_KEY = "collisions.theme";

export interface ThemeColors {
  canvasBg: string;
  canvasDot: string;
  canvasLine: string;
  canvasTick: string;
  canvasMark: string;
  /** Body colours in the order labs hand them out. */
  bodies: string[];
  star: string;
  cue: string;
  pink: string;
  purple: string;
  cyan: string;
  amber: string;
  green: string;
  red: string;
  blue: string;
  text: string;
  textDim: string;
  /**
   * Whether the canvas ground is light.
   *
   * Shading has to run the other way on a light theme: a disc filled by
   * darkening its own colour reads as a bright ring around a hole, and a row
   * of them turns into mud. Derived from the background rather than declared,
   * so a new theme cannot forget to set it.
   */
  light: boolean;
}

let cache: ThemeColors | null = null;
const listeners = new Set<() => void>();

function read(): ThemeColors {
  const style = getComputedStyle(document.documentElement);
  const value = (name: string): string => style.getPropertyValue(name).trim() || "#888888";
  return {
    canvasBg: value("--canvas-bg"),
    canvasDot: value("--canvas-dot"),
    canvasLine: value("--canvas-line"),
    canvasTick: value("--canvas-tick"),
    canvasMark: value("--canvas-mark"),
    bodies: [1, 2, 3, 4, 5, 6, 7, 8].map((index) => value(`--body-${index}`)),
    star: value("--body-star"),
    cue: value("--body-cue"),
    pink: value("--pink"),
    purple: value("--purple"),
    cyan: value("--cyan"),
    amber: value("--amber"),
    green: value("--green"),
    red: value("--red"),
    blue: value("--blue"),
    text: value("--text"),
    textDim: value("--text-dim"),
    light: isLight(value("--canvas-bg")),
  };
}

/** Perceived brightness, on the usual weighted-RGB approximation. */
function isLight(hex: string): boolean {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const int = Number.parseInt(full, 16);
  if (!Number.isFinite(int)) return false;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

/** The resolved palette for whichever theme is active. */
export function theme(): ThemeColors {
  if (!cache) cache = read();
  return cache;
}

/** Cycle through the body palette, so any count of bodies gets a colour. */
export function bodyColor(index: number): string {
  const palette = theme().bodies;
  return palette[index % palette.length]!;
}

export function currentThemeId(): string {
  return document.documentElement.dataset["theme"] ?? DEFAULT_THEME;
}

export function setTheme(id: string): void {
  if (!THEMES.some((entry) => entry.id === id)) return;
  if (id === DEFAULT_THEME) delete document.documentElement.dataset["theme"];
  else document.documentElement.dataset["theme"] = id;
  cache = null;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private browsing, or storage disabled. The theme still applies for this
    // visit; only remembering it fails, which is not worth interrupting for.
  }
  for (const listener of listeners) listener();
}

/** Called after the palette changes, once the new one is already resolvable. */
export function onThemeChange(listener: () => void): void {
  listeners.add(listener);
}

/**
 * Adopt the stored theme.
 *
 * A small inline script in the document head does this too, before first
 * paint, so the page never flashes the default palette. This is the fallback
 * for when that script did not run.
 */
export function restoreTheme(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored !== currentThemeId()) setTheme(stored);
  } catch {
    // Nothing to restore.
  }
}
