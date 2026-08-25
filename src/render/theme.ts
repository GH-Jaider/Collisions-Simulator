/**
 * Theme access for everything drawn on a canvas.
 *
 * The palettes live in the stylesheet, not here -- in teletipo's themes.css
 * since the migration. That keeps a colour written down exactly once: the
 * chrome takes it through `var(--x)` and the canvas reads the same property
 * back. The alternative, a table of hexes in TypeScript mirrored by a table
 * of hexes in CSS, drifts apart the first time anyone adjusts one of them.
 *
 * Reading tokens, switching the document attribute and remembering the
 * choice across visits are teletipo's job now (readTokens.ts / theme.ts);
 * this module adapts them to the shape the lab's renderers expect, and adds
 * the one thing the library cannot know: which properties this canvas cares
 * about. Resolving a custom property is not free, so the whole set is read
 * once per theme change and cached; an unresolved property falls back to
 * teletipo's stand-in grey rather than an empty string.
 */

import {
  createTokenReader,
  createTheme,
  isLight,
  THEMES as TELETIPO_THEMES,
} from "teletipo";

export interface ThemeId {
  id: string;
  label: string;
}

/** Same four palettes the stylesheet and the swatch picker know. */
export const THEMES: ThemeId[] = TELETIPO_THEMES.map((entry) => ({
  id: entry.id,
  label: entry.label,
}));

const STORAGE_KEY = "collisions.theme";

/**
 * The document properties this canvas reads back, mapped to the
 * ThemeColors fields they feed. The domain tokens (--canvas-*, --body-*)
 * are app-side, declared in styles/main.css; the rest come from the
 * teletipo palettes.
 */
const PROPERTIES = {
  canvasBg: "--canvas-bg",
  canvasDot: "--canvas-dot",
  canvasLine: "--canvas-line",
  canvasTick: "--canvas-tick",
  canvasMark: "--canvas-mark",
  body1: "--body-1",
  body2: "--body-2",
  body3: "--body-3",
  body4: "--body-4",
  body5: "--body-5",
  body6: "--body-6",
  body7: "--body-7",
  body8: "--body-8",
  star: "--body-star",
  cue: "--body-cue",
  pink: "--pink",
  purple: "--purple",
  cyan: "--cyan",
  amber: "--amber",
  green: "--green",
  red: "--red",
  blue: "--blue",
  text: "--text",
  textDim: "--text-dim",
} as const;

/** The --body-N keys, in the order labs hand colours out. */
const BODY_KEYS = [
  "body1",
  "body2",
  "body3",
  "body4",
  "body5",
  "body6",
  "body7",
  "body8",
] as const;

/** Owns the document attribute and the localStorage persistence. */
const controller = createTheme({ storageKey: STORAGE_KEY });

/** Cached token resolution; drops itself whenever the theme changes. */
const reader = createTokenReader(controller, PROPERTIES);

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

controller.onChange(() => {
  cache = null;
});

function buildColors(): ThemeColors {
  const token = reader.read();
  return {
    canvasBg: token.canvasBg,
    canvasDot: token.canvasDot,
    canvasLine: token.canvasLine,
    canvasTick: token.canvasTick,
    canvasMark: token.canvasMark,
    bodies: BODY_KEYS.map((key) => token[key]),
    star: token.star,
    cue: token.cue,
    pink: token.pink,
    purple: token.purple,
    cyan: token.cyan,
    amber: token.amber,
    green: token.green,
    red: token.red,
    blue: token.blue,
    text: token.text,
    textDim: token.textDim,
    light: isLight(token.canvasBg),
  };
}

/** The resolved palette for whichever theme is active. */
export function theme(): ThemeColors {
  if (!cache) cache = buildColors();
  return cache;
}

/** Cycle through the body palette, so any count of bodies gets a colour. */
export function bodyColor(index: number): string {
  const palette = theme().bodies;
  return palette[index % palette.length]!;
}

export function currentThemeId(): string {
  return controller.currentTheme();
}

/** Switch themes. An id outside THEMES is ignored, as before. */
export function setTheme(id: string): void {
  controller.setTheme(id);
}

/** Called after the palette changes, once the new one is already resolvable. */
export function onThemeChange(listener: () => void): void {
  // The controller hands back an unsubscribe function; this module's long-
  // standing API never had one to give, so it is dropped here.
  controller.onChange(listener);
}

/**
 * Adopt the stored theme.
 *
 * Persistence itself lives in the controller now. A small inline script in
 * the document head does the same thing before first paint, so the page
 * never flashes the default palette; this is the fallback for when that
 * script did not run.
 */
export function restoreTheme(): void {
  controller.restoreTheme();
}
