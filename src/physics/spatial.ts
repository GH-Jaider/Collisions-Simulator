import type { Body } from "./body";

/**
 * Only half of the eight neighbouring cells are visited. Every unordered pair
 * of adjacent cells is still reached exactly once -- from whichever of the two
 * the scan happens to arrive at first -- so no pair is emitted twice and no
 * deduplicating set is needed.
 */
const FORWARD_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
];

/**
 * Buckets bodies into a uniform grid so only nearby pairs are tested.
 *
 * Testing every pair costs O(n^2), which is what makes naive simulations fall
 * over somewhere around a hundred bodies. The cell size is held at the largest
 * body's diameter, which guarantees that two overlapping bodies always land in
 * the same cell or in directly adjacent ones -- so scanning each cell against
 * its forward neighbours misses nothing.
 */
export class SpatialHash {
  private cells = new Map<number, number[]>();
  private columns = 0;
  cellSize = 1;

  rebuild(bodies: readonly Body[]): void {
    this.cells.clear();
    let largest = 0;
    for (const body of bodies) {
      if (body.radius > largest) largest = body.radius;
    }
    // A cell must be at least as wide as the widest possible contact, which is
    // r_i + r_j <= 2 * r_max. Anything smaller could let an overlapping pair
    // straddle two non-adjacent cells and slip through undetected.
    this.cellSize = Math.max(2 * largest, 1e-9);

    // Cell coordinates are folded into one integer key so the map can be keyed
    // by a number; string keys turned out to dominate the broad phase.
    this.columns = 0x10000;
    for (let index = 0; index < bodies.length; index++) {
      const body = bodies[index]!;
      const key = this.keyFor(body.position.x, body.position.y);
      const bucket = this.cells.get(key);
      if (bucket === undefined) this.cells.set(key, [index]);
      else bucket.push(index);
    }
  }

  private keyFor(x: number, y: number): number {
    const column = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);
    return (row + 0x8000) * this.columns + (column + 0x8000);
  }

  /** Call `visit` once for every potentially-overlapping pair of indices. */
  forEachCandidatePair(visit: (a: number, b: number) => void): void {
    for (const [key, bucket] of this.cells) {
      const count = bucket.length;
      for (let i = 0; i < count; i++) {
        const first = bucket[i]!;
        for (let j = i + 1; j < count; j++) visit(first, bucket[j]!);
      }
      for (const [dx, dy] of FORWARD_NEIGHBOURS) {
        const neighbour = this.cells.get(key + dy * this.columns + dx);
        if (neighbour === undefined) continue;
        for (const first of bucket) {
          for (const second of neighbour) visit(first, second);
        }
      }
    }
  }

  get occupiedCells(): number {
    return this.cells.size;
  }
}
