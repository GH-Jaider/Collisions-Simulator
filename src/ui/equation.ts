/**
 * Equation typesetting, in the amount this project needs.
 *
 * A full maths layout engine would be overkill: these are a handful of fixed
 * formulae, and hand-built markup keeps the page free of a heavy dependency
 * while still following the typographic conventions — variables in a serif
 * italic, operators spaced, substituted numbers in the monospace face.
 */

export const v = (name: string, sub?: string): string =>
  `<span class="var">${name}${sub ? `<span class="sub">${sub}</span>` : ""}</span>`;

export const op = (symbol: string): string => `<span class="op">${symbol}</span>`;

export const num = (value: string): string => `<span class="num">${value}</span>`;

export const frac = (top: string, bottom: string): string =>
  `<span class="frac"><span>${top}</span><span>${bottom}</span></span>`;

export function equationBlock(html: string, caption?: string): string {
  return (
    `<div class="equation">${html}</div>` +
    (caption ? `<div class="equation-caption">${caption}</div>` : "")
  );
}
