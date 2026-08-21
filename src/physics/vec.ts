/** Immutable 2-D vector arithmetic. */
export class Vec2 {
  constructor(
    readonly x: number = 0,
    readonly y: number = 0,
  ) {}

  static readonly zero = new Vec2(0, 0);

  /** A vector of length `magnitude` pointing at `radians` from the +x axis. */
  static fromPolar(magnitude: number, radians: number): Vec2 {
    return new Vec2(magnitude * Math.cos(radians), magnitude * Math.sin(radians));
  }

  add(other: Vec2): Vec2 {
    return new Vec2(this.x + other.x, this.y + other.y);
  }

  sub(other: Vec2): Vec2 {
    return new Vec2(this.x - other.x, this.y - other.y);
  }

  scale(factor: number): Vec2 {
    return new Vec2(this.x * factor, this.y * factor);
  }

  negate(): Vec2 {
    return new Vec2(-this.x, -this.y);
  }

  dot(other: Vec2): number {
    return this.x * other.x + this.y * other.y;
  }

  /** The z-component of the 3-D cross product of two planar vectors. */
  cross(other: Vec2): number {
    return this.x * other.y - this.y * other.x;
  }

  get length(): number {
    return Math.hypot(this.x, this.y);
  }

  get lengthSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  get angle(): number {
    return Math.atan2(this.y, this.x);
  }

  distanceTo(other: Vec2): number {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }

  /** Rotated a quarter turn counter-clockwise. */
  perpendicular(): Vec2 {
    return new Vec2(-this.y, this.x);
  }

  /**
   * A unit vector in the same direction, or `fallback` when this vector has
   * no direction. Coincident bodies are routine in a dense simulation, so
   * this never throws.
   */
  normalized(fallback: Vec2 = Vec2.zero): Vec2 {
    const length = Math.hypot(this.x, this.y);
    if (length < 1e-12) return fallback;
    return new Vec2(this.x / length, this.y / length);
  }

  /** Shortened to at most `limit`, preserving direction. */
  clamped(limit: number): Vec2 {
    const lengthSq = this.x * this.x + this.y * this.y;
    if (lengthSq <= limit * limit || lengthSq < 1e-24) return this;
    const scale = limit / Math.sqrt(lengthSq);
    return new Vec2(this.x * scale, this.y * scale);
  }

  equals(other: Vec2, epsilon = 0): boolean {
    return Math.abs(this.x - other.x) <= epsilon && Math.abs(this.y - other.y) <= epsilon;
  }

  toString(): string {
    return `(${this.x.toFixed(3)}, ${this.y.toFixed(3)})`;
  }
}

export const vec = (x: number, y: number): Vec2 => new Vec2(x, y);
