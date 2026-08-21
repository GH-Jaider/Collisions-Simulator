/**
 * Number formatting for an instrument panel.
 *
 * Every value keeps a fixed number of decimals so that a digit changing never
 * shifts the ones beside it; combined with tabular figures in the stylesheet,
 * a column of readings stays perfectly still while it updates.
 */

export function fixed(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "--";
  // Avoid rendering "-0.00", which reads as a different number to "0.00".
  const rounded = Number(value.toFixed(decimals));
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(decimals);
}

export function signed(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "--";
  const text = fixed(Math.abs(value), decimals);
  const rounded = Number(value.toFixed(decimals));
  return `${rounded < 0 ? "−" : "+"}${text}`;
}

/** Compact large magnitudes so a column never changes width. */
export function compact(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "--";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6) return `${fixed(value / 1e6, 2)}M`;
  if (magnitude >= 1e3) return `${fixed(value / 1e3, 2)}k`;
  return fixed(value, decimals);
}

export function percent(value: number, decimals = 3): string {
  return `${signed(value * 100, decimals)}%`;
}
