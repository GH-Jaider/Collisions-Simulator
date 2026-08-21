import { Body } from "./body";
import { SpatialHash } from "./spatial";
import { Vec2 } from "./vec";

/**
 * Leaving a sliver of overlap unresolved stops bodies in permanent contact
 * from twitching between "touching" and "separated" every frame. Expressed as
 * a fraction of the contact size so it behaves the same at any scale.
 */
const PENETRATION_SLOP = 0.004;
/** Resolving overlap only partially each substep keeps a deep pile calm. */
const CORRECTION_RATE = 0.8;
/** Overlap is relaxed over several sweeps; more than a handful stops helping. */
const SEPARATION_PASSES = 3;
/**
 * Below this approach speed a contact is bodies resting against one another
 * rather than colliding, and is not worth recording. A scenario that lets
 * bodies settle raises `restitutionThreshold`, and that figure takes over --
 * otherwise a settled heap reports thousands of collisions a second.
 */
const IMPACT_SPEED = 0.05;
/** How many collisions to keep for the inspector. */
const LOG_CAPACITY = 40;

export interface Parameters {
  /** Bounciness of body-body contacts: 1 is perfectly elastic, 0 sticks. */
  restitution: number;
  wallRestitution: number;
  /** Coulomb friction coefficient at contacts; also what creates spin. */
  friction: number;
  /** Uniform acceleration in m/s^2. */
  gravity: Vec2;
  /** Gravitational constant for body-body attraction; 0 disables it. */
  mutualGravity: number;
  /** Exponential velocity damping per second, standing in for air or felt. */
  drag: number;
  /**
   * Approach speed below which a contact stops bouncing.
   *
   * Zero keeps collisions exactly elastic, which is what makes the energy
   * readout trustworthy. Scenarios that let bodies come to rest raise it,
   * because a stack of perfectly elastic discs never settles.
   */
  restitutionThreshold: number;
  substeps: number;
  /**
   * Relaxation sweeps per substep. Sequential impulses converge on the
   * simultaneous solution from below, so too few sweeps quietly *lose* energy
   * in a crowd. Raising this is cheap and is what pins the drift at zero.
   */
  iterations: number;
  walls: boolean;
  speedLimit: number;
}

export function defaultParameters(overrides: Partial<Parameters> = {}): Parameters {
  return {
    restitution: 1,
    wallRestitution: 1,
    friction: 0,
    gravity: Vec2.zero,
    mutualGravity: 0,
    drag: 0,
    restitutionThreshold: 0,
    substeps: 4,
    iterations: 8,
    walls: true,
    speedLimit: 100,
    ...overrides,
  };
}

/** One resolved overlap, kept alive across solver iterations. */
interface Contact {
  a: Body;
  b: Body;
  /** Unit normal pointing from `a` towards `b`, as two scalars. */
  nx: number;
  ny: number;
  depth: number;
  /** Separating speed the normal impulse should aim to produce. */
  bias: number;
  normalMass: number;
  tangentMass: number;
  normalImpulse: number;
  tangentImpulse: number;
}

/** A collision worth drawing a flash for. */
export interface Impact {
  position: Vec2;
  strength: number;
}

/** Everything the inspector needs to explain one collision. */
export interface CollisionRecord {
  time: number;
  point: Vec2;
  /** Unit vector from body A's centre towards body B's. */
  normal: Vec2;
  restitution: number;
  /** Closing speed along the normal, always positive. */
  approachSpeed: number;
  /** Separation speed along the normal after the impulse. */
  separationSpeed: number;
  /** Magnitude of the exchanged impulse, in kg m/s. */
  impulse: number;
  a: CollisionSide;
  b: CollisionSide;
}

export interface CollisionSide {
  id: number;
  label: string;
  color: string;
  mass: number;
  before: Vec2;
  after: Vec2;
}

interface PendingRecord {
  record: CollisionRecord;
  contact: Contact;
}

export interface Measurements {
  time: number;
  count: number;
  collisions: number;
  momentum: Vec2;
  kinetic: number;
  potential: number;
  total: number;
  meanEnergy: number;
  drift: number | null;
  conservative: boolean;
}

/**
 * A box of discs.
 *
 * The engine has no knowledge of canvases, the DOM, or units of display. It
 * steps headlessly, which is how the tests drive it.
 */
export class World {
  readonly bodies: Body[] = [];
  params: Parameters;
  width: number;
  height: number;
  time = 0;
  collisions = 0;
  impacts: Impact[] = [];
  /** Most recent collisions, newest last, for the inspector. */
  readonly log: CollisionRecord[] = [];
  substepsUsed = 0;

  private readonly hash = new SpatialHash();
  private referenceEnergy: number | null = null;
  private pending: PendingRecord[] = [];

  constructor(width: number, height: number, params: Parameters = defaultParameters()) {
    this.width = width;
    this.height = height;
    this.params = params;
  }

  // -- population ------------------------------------------------------

  add(body: Body): Body {
    this.bodies.push(body);
    return body;
  }

  remove(body: Body): void {
    const index = this.bodies.indexOf(body);
    if (index >= 0) this.bodies.splice(index, 1);
  }

  clear(): void {
    this.bodies.length = 0;
    this.log.length = 0;
    this.impacts = [];
    this.time = 0;
    this.collisions = 0;
    this.referenceEnergy = null;
  }

  /** Adopt new bounds, pulling any stranded body back inside. */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    for (const body of this.bodies) {
      const x = Math.min(Math.max(body.position.x, body.radius), Math.max(width - body.radius, body.radius));
      const y = Math.min(Math.max(body.position.y, body.radius), Math.max(height - body.radius, body.radius));
      body.position = new Vec2(x, y);
    }
  }

  /** Topmost body containing `point`, searching newest first. */
  bodyAt(point: Vec2): Body | null {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const body = this.bodies[i]!;
      if (body.contains(point)) return body;
    }
    return null;
  }

  // -- stepping --------------------------------------------------------

  /** Advance the simulation by `dt` seconds. */
  step(dt: number): void {
    if (dt <= 0 || this.bodies.length === 0) return;
    this.impacts = [];
    this.pending = [];

    const substeps = this.chooseSubsteps(dt);
    this.substepsUsed = substeps;
    const h = dt / substeps;
    for (let i = 0; i < substeps; i++) {
      this.integrate(h);
      const contacts = this.findContacts();
      this.solve(contacts);
      this.separate(contacts);
      if (this.params.walls) this.solveWalls();
    }
    this.time += dt;
    this.finishRecords();
  }

  /**
   * Pick a substep count that keeps bodies from tunnelling.
   *
   * For a body to slip through another between two discrete positions it has
   * to clear the whole overlap band, which is 2*(r_a + r_b) wide and so at
   * least four of the smallest radius. Capping travel at one such radius keeps
   * a fourfold margin even for two bodies closing head-on. Being stricter is
   * not safer, just slower: the count is set by the single fastest body and
   * paid for by every one of them.
   */
  private chooseSubsteps(dt: number): number {
    let fastest = 0;
    let smallest = Infinity;
    for (const body of this.bodies) {
      const speedSq = body.velocity.lengthSquared;
      if (speedSq > fastest) fastest = speedSq;
      if (body.radius < smallest) smallest = body.radius;
    }
    if (!Number.isFinite(smallest)) return this.params.substeps;
    const travel = Math.sqrt(fastest) * dt;
    const safe = Math.max(smallest, 1e-9);
    const needed = travel > safe ? Math.ceil(travel / safe) : 1;
    return Math.max(this.params.substeps, Math.min(needed, 32));
  }

  /**
   * Semi-implicit Euler: accelerate first, then move.
   *
   * Updating velocity before position is what keeps orbital and oscillating
   * systems from spiralling out -- it is symplectic, so energy wobbles but
   * does not steadily grow.
   */
  private integrate(h: number): void {
    const { gravity, drag, speedLimit, mutualGravity } = this.params;
    const gx = gravity.x * h;
    const gy = gravity.y * h;
    const accelerating = gx !== 0 || gy !== 0;
    const damping = drag > 0 ? Math.exp(-drag * h) : 1;

    if (mutualGravity !== 0) this.applyMutualGravity(h);

    for (const body of this.bodies) {
      if (!body.movable) continue;
      let vx = body.velocity.x;
      let vy = body.velocity.y;
      if (accelerating) {
        vx += gx;
        vy += gy;
      }
      if (damping !== 1) {
        vx *= damping;
        vy *= damping;
        body.spin *= damping;
      }
      const speedSq = vx * vx + vy * vy;
      if (speedSq > speedLimit * speedLimit) {
        const scale = speedLimit / Math.sqrt(speedSq);
        vx *= scale;
        vy *= scale;
      }
      body.velocity = new Vec2(vx, vy);
      body.position = new Vec2(body.position.x + vx * h, body.position.y + vy * h);
      body.angle += body.spin * h;
    }
  }

  /**
   * Direct-sum n-body attraction with Plummer softening, which keeps the
   * 1/r^2 force finite when two bodies pass very close -- otherwise a near
   * miss flings them both to infinity in a single step.
   */
  private applyMutualGravity(h: number): void {
    const g = this.params.mutualGravity;
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]!;
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const softening = (a.radius + b.radius) * 0.5;
        const distSq = dx * dx + dy * dy + softening * softening;
        const invDist = 1 / Math.sqrt(distSq);
        const magnitude = (g * a.mass * b.mass) / distSq;
        const fx = magnitude * dx * invDist;
        const fy = magnitude * dy * invDist;
        if (a.movable) {
          const k = a.invMass * h;
          a.velocity = new Vec2(a.velocity.x + fx * k, a.velocity.y + fy * k);
        }
        if (b.movable) {
          const k = b.invMass * h;
          b.velocity = new Vec2(b.velocity.x - fx * k, b.velocity.y - fy * k);
        }
      }
    }
  }

  // -- narrow phase ----------------------------------------------------

  private findContacts(): Contact[] {
    const bodies = this.bodies;
    const contacts: Contact[] = [];
    if (bodies.length < 2) return contacts;

    this.hash.rebuild(bodies);
    const { restitution, restitutionThreshold } = this.params;
    const recordable = Math.max(IMPACT_SPEED, restitutionThreshold);

    this.hash.forEachCandidatePair((i, j) => {
      const a = bodies[i]!;
      const b = bodies[j]!;
      const invSum = a.invMass + b.invMass;
      if (invSum === 0) return; // two immovable bodies resolve nothing

      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const radii = a.radius + b.radius;
      const distSq = dx * dx + dy * dy;
      if (distSq >= radii * radii) return;

      const distance = Math.sqrt(distSq);
      let nx: number;
      let ny: number;
      if (distance > 1e-12) {
        nx = dx / distance;
        ny = dy / distance;
      } else {
        // Exactly coincident centres have no meaningful normal. Pick a stable
        // one from the body id so the pair separates the same way every frame
        // instead of jittering at random.
        const theta = (a.id * 2.399963229728653) % (Math.PI * 2);
        nx = Math.cos(theta);
        ny = Math.sin(theta);
      }

      const ra = a.radius;
      const rb = b.radius;
      const contactAx = a.velocity.x - a.spin * ny * ra;
      const contactAy = a.velocity.y + a.spin * nx * ra;
      const contactBx = b.velocity.x + b.spin * ny * rb;
      const contactBy = b.velocity.y - b.spin * nx * rb;
      const normalSpeed = (contactBx - contactAx) * nx + (contactBy - contactAy) * ny;

      // A pair already flying apart still gets a contact. The accumulated
      // impulse clamp declines to apply anything to it -- which is the fix for
      // "colliding" separating pairs and sucking them back together -- but the
      // overlap it carries still has to be pushed out. Dropping it here lets a
      // jostling pile accumulate interpenetration that never resolves.

      // For discs the contact offset is parallel to the normal, so it exerts
      // no torque and the normal effective mass is just the sum of inverse
      // masses. The tangent does pick up a spin term: r x t = +/- radius.
      const tangentMass = invSum + ra * ra * a.invInertia + rb * rb * b.invInertia;

      // Restitution is captured once, from the approach speed, so that
      // repeated solver iterations cannot pump energy into the contact.
      const bias = normalSpeed < -restitutionThreshold ? -restitution * normalSpeed : 0;

      const contact: Contact = {
        a,
        b,
        nx,
        ny,
        depth: radii - distance,
        bias,
        normalMass: 1 / invSum,
        tangentMass: tangentMass > 0 ? 1 / tangentMass : 0,
        normalImpulse: 0,
        tangentImpulse: 0,
      };
      contacts.push(contact);

      if (normalSpeed < -recordable) {
        this.collisions++;
        this.pending.push({
          contact,
          record: {
            time: this.time,
            point: new Vec2(
              a.position.x + nx * (ra - (radii - distance) * 0.5),
              a.position.y + ny * (ra - (radii - distance) * 0.5),
            ),
            normal: new Vec2(nx, ny),
            restitution,
            approachSpeed: -normalSpeed,
            separationSpeed: 0,
            impulse: 0,
            a: sideOf(a),
            b: sideOf(b),
          },
        });
      }
    });

    return contacts;
  }

  /**
   * Sequential impulses: relax every contact, repeatedly.
   *
   * One pass is exact for an isolated pair. Extra passes are what let a row of
   * touching balls pass an impulse along the chain within a single step
   * instead of leaking it into a slow shove.
   */
  private solve(contacts: Contact[]): void {
    const { friction, iterations } = this.params;
    for (let pass = 0; pass < iterations; pass++) {
      for (const contact of contacts) applyImpulse(contact, friction);
    }
    for (const contact of contacts) {
      if (contact.normalImpulse <= 0) continue;
      const reach = contact.a.radius - contact.depth * 0.5;
      this.impacts.push({
        position: new Vec2(
          contact.a.position.x + contact.nx * reach,
          contact.a.position.y + contact.ny * reach,
        ),
        strength: contact.normalImpulse,
      });
    }
  }

  /**
   * Push overlapping bodies apart without touching their velocities.
   *
   * Impulses alone cannot undo an existing overlap -- they only fix the
   * velocities -- so bodies sink into each other and stay stuck. Moving them
   * apart geometrically, split in proportion to inverse mass, is what keeps a
   * pile solid. Because no velocity changes, no energy is created.
   *
   * The pass repeats, re-measuring each overlap from the positions as they
   * stand: shoving one body out of its neighbour routinely shoves it into the
   * next one along, and a single sweep leaves a deep pile visibly squashed.
   */
  private separate(contacts: Contact[]): void {
    for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
      let settled = true;
      for (const contact of contacts) {
        const { a, b } = contact;
        const invA = a.invMass;
        const invB = b.invMass;
        const invSum = invA + invB;
        if (invSum === 0) continue;

        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const radii = a.radius + b.radius;
        const distSq = dx * dx + dy * dy;
        if (distSq >= radii * radii) continue;
        const distance = Math.sqrt(distSq);
        const correction = radii - distance - PENETRATION_SLOP * radii;
        if (correction <= 0) continue;

        let nx = contact.nx;
        let ny = contact.ny;
        if (distance > 1e-12) {
          nx = dx / distance;
          ny = dy / distance;
        }

        settled = false;
        const scale = (correction * CORRECTION_RATE) / invSum;
        const shiftX = nx * scale;
        const shiftY = ny * scale;
        if (invA !== 0) {
          a.position = new Vec2(a.position.x - shiftX * invA, a.position.y - shiftY * invA);
        }
        if (invB !== 0) {
          b.position = new Vec2(b.position.x + shiftX * invB, b.position.y + shiftY * invB);
        }
      }
      if (settled) break;
    }
  }

  /**
   * Keep bodies inside the box.
   *
   * Position is clamped *before* the velocity is reflected. Reflecting alone
   * lets a body that overshot the wall get flipped back and forth while it is
   * still outside, vibrating in place.
   */
  private solveWalls(): void {
    const { wallRestitution, restitutionThreshold } = this.params;
    const recordable = Math.max(IMPACT_SPEED, restitutionThreshold);
    for (const body of this.bodies) {
      if (!body.movable) continue;
      const r = body.radius;
      let { x, y } = body.position;
      let vx = body.velocity.x;
      let vy = body.velocity.y;
      let hit = 0;

      if (x < r) {
        x = r;
        if (vx < 0) {
          hit = Math.max(hit, -vx);
          vx = -vx * wallRestitution;
        }
      } else if (x > this.width - r) {
        x = this.width - r;
        if (vx > 0) {
          hit = Math.max(hit, vx);
          vx = -vx * wallRestitution;
        }
      }

      if (y < r) {
        y = r;
        if (vy < 0) {
          hit = Math.max(hit, -vy);
          vy = -vy * wallRestitution;
        }
      } else if (y > this.height - r) {
        y = this.height - r;
        if (vy > 0) {
          hit = Math.max(hit, vy);
          vy = -vy * wallRestitution;
        }
      }

      if (hit > 0) {
        body.position = new Vec2(x, y);
        body.velocity = new Vec2(vx, vy);
        if (hit > recordable) {
          this.collisions++;
          this.impacts.push({ position: body.position, strength: hit * body.mass * 0.5 });
        }
      } else if (x !== body.position.x || y !== body.position.y) {
        body.position = new Vec2(x, y);
      }
    }
  }

  /**
   * Fill in the after-state of this step's collisions.
   *
   * The record is opened when the contact is found and closed here, once the
   * solver has finished, so the inspector can show genuine before and after
   * velocities rather than a mid-solve snapshot.
   */
  private finishRecords(): void {
    for (const { record, contact } of this.pending) {
      const { a, b } = contact;
      record.a.after = a.velocity;
      record.b.after = b.velocity;
      record.impulse = contact.normalImpulse;
      const relative = b.velocity.sub(a.velocity);
      record.separationSpeed = relative.dot(record.normal);
      this.log.push(record);
    }
    this.pending = [];
    if (this.log.length > LOG_CAPACITY) this.log.splice(0, this.log.length - LOG_CAPACITY);
  }

  // -- measurements ----------------------------------------------------

  get totalMomentum(): Vec2 {
    let x = 0;
    let y = 0;
    for (const body of this.bodies) {
      if (body.isStatic) continue;
      x += body.mass * body.velocity.x;
      y += body.mass * body.velocity.y;
    }
    return new Vec2(x, y);
  }

  get kineticEnergy(): number {
    let total = 0;
    for (const body of this.bodies) total += body.kineticEnergy;
    return total;
  }

  /**
   * Stored energy in whichever force fields are switched on.
   *
   * Kinetic energy alone is not conserved the moment gravity is involved -- a
   * falling ball speeds up because potential energy is converting into motion,
   * not because the solver is broken. Accounting for both keeps the drift
   * readout meaningful in every experiment.
   */
  get potentialEnergy(): number {
    const { gravity, mutualGravity } = this.params;
    let total = 0;

    if (gravity.x !== 0 || gravity.y !== 0) {
      // Measured from the far corner, so a body resting at the bottom of a
      // downward field sits at zero rather than something negative.
      for (const body of this.bodies) {
        if (body.isStatic) continue;
        total -=
          body.mass *
          (gravity.x * (body.position.x - this.width) + gravity.y * (body.position.y - this.height));
      }
    }

    if (mutualGravity !== 0) {
      const bodies = this.bodies;
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i]!;
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j]!;
          const dx = b.position.x - a.position.x;
          const dy = b.position.y - a.position.y;
          // Matches the softened force the integrator applies, so the two stay
          // consistent.
          const softening = (a.radius + b.radius) * 0.5;
          total -= (mutualGravity * a.mass * b.mass) / Math.sqrt(dx * dx + dy * dy + softening * softening);
        }
      }
    }
    return total;
  }

  get totalEnergy(): number {
    return this.kineticEnergy + this.potentialEnergy;
  }

  /**
   * Whether the current settings should conserve energy at all. Restitution
   * below 1, friction and drag all remove energy by design, so a drift figure
   * would be measuring the dissipation rather than the integrator.
   */
  get conservative(): boolean {
    const p = this.params;
    return (
      p.restitution >= 1 &&
      (p.wallRestitution >= 1 || !p.walls) &&
      p.friction <= 0 &&
      p.drag <= 0
    );
  }

  /** Snapshot the current energy so drift can be reported against it. */
  markReferenceEnergy(): void {
    this.referenceEnergy = this.totalEnergy;
  }

  /**
   * Fractional change in total energy since the reference snapshot. With
   * perfectly elastic collisions and no friction this stays pinned at zero;
   * watching it is the quickest way to catch a solver quietly manufacturing
   * energy.
   */
  get energyDrift(): number | null {
    const reference = this.referenceEnergy;
    if (reference === null || reference === 0) return null;
    return (this.totalEnergy - reference) / Math.abs(reference);
  }

  measure(): Measurements {
    const movable = this.bodies.filter((body) => !body.isStatic);
    const kinetic = this.kineticEnergy;
    return {
      time: this.time,
      count: this.bodies.length,
      collisions: this.collisions,
      momentum: this.totalMomentum,
      kinetic,
      potential: this.potentialEnergy,
      total: this.totalEnergy,
      meanEnergy: movable.length > 0 ? kinetic / movable.length : 0,
      drift: this.energyDrift,
      conservative: this.conservative,
    };
  }

  speeds(): number[] {
    const values: number[] = [];
    for (const body of this.bodies) {
      if (!body.isStatic) values.push(body.velocity.length);
    }
    return values;
  }
}

function sideOf(body: Body): CollisionSide {
  return {
    id: body.id,
    label: body.label,
    color: body.color,
    mass: body.mass,
    before: body.velocity,
    after: body.velocity,
  };
}

/**
 * One relaxation sweep over a single contact.
 *
 * Accumulated-impulse clamping: the running total may never go negative,
 * because a contact can push bodies apart but never pull them together.
 * Individual increments are free to be negative.
 */
function applyImpulse(contact: Contact, friction: number): void {
  const { a, b, nx, ny } = contact;
  const ra = a.radius;
  const rb = b.radius;
  const invA = a.invMass;
  const invB = b.invMass;

  let avx = a.velocity.x;
  let avy = a.velocity.y;
  let bvx = b.velocity.x;
  let bvy = b.velocity.y;
  const aSpin = a.spin;
  const bSpin = b.spin;

  let relX = bvx + bSpin * ny * rb - (avx - aSpin * ny * ra);
  let relY = bvy - bSpin * nx * rb - (avy + aSpin * nx * ra);
  const normalSpeed = relX * nx + relY * ny;

  let total = contact.normalImpulse + (contact.bias - normalSpeed) * contact.normalMass;
  if (total < 0) total = 0;
  const applied = total - contact.normalImpulse;
  contact.normalImpulse = total;

  if (applied !== 0) {
    const ix = nx * applied;
    const iy = ny * applied;
    if (invA !== 0) {
      avx -= ix * invA;
      avy -= iy * invA;
      a.velocity = new Vec2(avx, avy);
    }
    if (invB !== 0) {
      bvx += ix * invB;
      bvy += iy * invB;
      b.velocity = new Vec2(bvx, bvy);
    }
  }

  if (friction <= 0 || contact.tangentMass === 0) return;

  const tx = -ny;
  const ty = nx;
  relX = bvx + bSpin * ny * rb - (avx - aSpin * ny * ra);
  relY = bvy - bSpin * nx * rb - (avy + aSpin * nx * ra);
  const tangentSpeed = relX * tx + relY * ty;

  // Coulomb's law: tangential force cannot exceed mu times normal force. Past
  // that limit the surfaces slide instead of gripping.
  const limit = friction * contact.normalImpulse;
  let totalT = contact.tangentImpulse - tangentSpeed * contact.tangentMass;
  if (totalT > limit) totalT = limit;
  else if (totalT < -limit) totalT = -limit;
  const appliedT = totalT - contact.tangentImpulse;
  contact.tangentImpulse = totalT;

  if (appliedT !== 0) {
    const ix = tx * appliedT;
    const iy = ty * appliedT;
    if (invA !== 0) {
      a.velocity = new Vec2(avx - ix * invA, avy - iy * invA);
      a.spin -= (nx * iy - ny * ix) * ra * a.invInertia;
    }
    if (invB !== 0) {
      b.velocity = new Vec2(bvx + ix * invB, bvy + iy * invB);
      b.spin += (ny * ix - nx * iy) * rb * b.invInertia;
    }
  }
}
