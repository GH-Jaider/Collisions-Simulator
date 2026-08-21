import { Vec2 } from "../physics/vec";

/** A deterministic pseudo-random source, so an experiment can be repeated. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Non-overlapping positions on a jittered grid.
 *
 * Rejection sampling — placing at random and retrying on a clash — gets
 * exponentially slower as the box fills and can spin forever once it is dense.
 * Jittering inside grid cells wider than a body cannot produce an overlap at
 * all, and always terminates. It also matters physically: a crowd that starts
 * interpenetrated spends its first moments unpicking that tangle, and the
 * energy books never quite recover.
 */
export function scatter(
  count: number,
  width: number,
  height: number,
  radius: number,
  random: () => number,
): Vec2[] {
  const margin = radius * 1.05;
  const innerWidth = Math.max(width - 2 * margin, 0.01);
  const innerHeight = Math.max(height - 2 * margin, 0.01);
  const columns = Math.max(1, Math.ceil(Math.sqrt((count * innerWidth) / innerHeight)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const cellWidth = innerWidth / columns;
  const cellHeight = innerHeight / rows;
  const jitterX = Math.max(0, (cellWidth - 2 * radius) * 0.5);
  const jitterY = Math.max(0, (cellHeight - 2 * radius) * 0.5);

  const cells: Array<[number, number]> = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) cells.push([column, row]);
  }
  // Fisher–Yates, so the chosen cells are spread over the box rather than
  // filling it from one corner.
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = cells[i]!;
    cells[i] = cells[j]!;
    cells[j] = swap;
  }

  return cells.slice(0, count).map(([column, row]) => {
    return new Vec2(
      margin + (column + 0.5) * cellWidth + (random() * 2 - 1) * jitterX,
      margin + (row + 0.5) * cellHeight + (random() * 2 - 1) * jitterY,
    );
  });
}
