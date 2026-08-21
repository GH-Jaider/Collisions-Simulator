import { Vec2 } from "./vec";

let nextId = 1;

export interface BodyOptions {
  position: Vec2;
  velocity?: Vec2;
  /** Radius in metres. */
  radius?: number;
  /** Mass in kilograms. */
  mass?: number;
  color?: string;
  label?: string;
  /** Immovable scenery: pegs, anchors, a planet you do not want to drift. */
  isStatic?: boolean;
}

/**
 * A uniform-density disc.
 *
 * Everything is in SI units -- metres, kilograms, seconds -- so the numbers on
 * screen are physical quantities rather than pixel counts.
 *
 * Mass and rotational inertia are cached as *inverses* because that is the
 * form every impulse equation needs, and because it lets an immovable body be
 * expressed exactly (inverse mass of zero) rather than approximated with a
 * very large number.
 */
export class Body {
  readonly id: number;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  mass: number;
  color: string;
  label: string;
  readonly isStatic: boolean;

  /** Orientation in radians; only visible once friction can impart spin. */
  angle = 0;
  /** Angular velocity in radians per second. */
  spin = 0;
  /** Temporarily immovable, e.g. while held by the pointer. */
  pinned = false;
  /** Recent positions, for drawing a trail. Owned by whoever renders it. */
  trail: Vec2[] = [];

  private inverseMass = 0;
  private inverseInertia = 0;

  constructor(options: BodyOptions) {
    this.id = nextId++;
    this.position = options.position;
    this.velocity = options.velocity ?? Vec2.zero;
    this.radius = options.radius ?? 0.15;
    this.mass = options.mass ?? 1;
    this.color = options.color ?? "#e2e8f0";
    this.label = options.label ?? "";
    this.isStatic = options.isStatic ?? false;
    this.refreshMassProperties();
  }

  private refreshMassProperties(): void {
    if (this.isStatic || this.mass <= 0) {
      this.inverseMass = 0;
      this.inverseInertia = 0;
      return;
    }
    this.inverseMass = 1 / this.mass;
    // Moment of inertia of a solid disc about its centre: I = m r^2 / 2.
    const inertia = 0.5 * this.mass * this.radius * this.radius;
    this.inverseInertia = inertia > 0 ? 1 / inertia : 0;
  }

  /** Change the mass, keeping the cached inverses consistent. */
  setMass(mass: number): void {
    this.mass = mass;
    this.refreshMassProperties();
  }

  /** Change the radius, keeping the cached inverses consistent. */
  setRadius(radius: number): void {
    this.radius = radius;
    this.refreshMassProperties();
  }

  /** Inverse mass, or zero while the body is immovable. */
  get invMass(): number {
    return this.pinned ? 0 : this.inverseMass;
  }

  get invInertia(): number {
    return this.pinned ? 0 : this.inverseInertia;
  }

  get movable(): boolean {
    return !this.isStatic && !this.pinned;
  }

  get speed(): number {
    return this.velocity.length;
  }

  /** Linear momentum p = mv, in kg m/s. Momentum is a vector. */
  get momentum(): Vec2 {
    return this.isStatic ? Vec2.zero : this.velocity.scale(this.mass);
  }

  /** Translational plus rotational kinetic energy, in joules. */
  get kineticEnergy(): number {
    if (this.isStatic) return 0;
    const linear = 0.5 * this.mass * this.velocity.lengthSquared;
    const inertia = 0.5 * this.mass * this.radius * this.radius;
    return linear + 0.5 * inertia * this.spin * this.spin;
  }

  contains(point: Vec2): boolean {
    return this.position.distanceTo(point) <= this.radius;
  }
}
