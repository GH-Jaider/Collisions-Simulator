import { describe, expect, it } from "vitest";
import { Body, SpatialHash, Vec2, World, defaultParameters } from "../src/physics";
import type { Parameters } from "../src/physics";

/** A boundless box, so walls cannot muddy a conservation check. */
function freeWorld(overrides: Partial<Parameters> = {}): World {
  return new World(1000, 1000, defaultParameters({ walls: false, ...overrides }));
}

function run(world: World, seconds: number, dt = 1 / 480): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) world.step(dt);
}

describe("elastic collisions", () => {
  it("makes equal masses exchange velocities head-on", () => {
    const world = freeWorld();
    const a = world.add(new Body({ position: new Vec2(500, 500), velocity: new Vec2(3, 0), radius: 0.2 }));
    const b = world.add(new Body({ position: new Vec2(501, 500), velocity: new Vec2(-3, 0), radius: 0.2 }));
    run(world, 0.5);
    expect(a.velocity.x).toBeCloseTo(-3, 9);
    expect(b.velocity.x).toBeCloseTo(3, 9);
  });

  // Every case here has an answer derivable on paper, so a failure means the
  // solver is wrong rather than merely different.
  it.each([
    { m1: 1, m2: 3, u1: 4, u2: -1 },
    { m1: 5, m2: 1, u1: 2.5, u2: 0 },
    { m1: 2, m2: 2.5, u1: 3, u2: -1.2 },
    { m1: 1, m2: 1000, u1: 5, u2: 0 },
  ])("matches the closed form for m=$m1/$m2 u=$u1/$u2", ({ m1, m2, u1, u2 }) => {
    const v1 = ((m1 - m2) * u1 + 2 * m2 * u2) / (m1 + m2);
    const v2 = ((m2 - m1) * u2 + 2 * m1 * u1) / (m1 + m2);

    const world = freeWorld();
    const a = world.add(new Body({ position: new Vec2(499.5, 500), velocity: new Vec2(u1, 0), radius: 0.15, mass: m1 }));
    const b = world.add(new Body({ position: new Vec2(500.5, 500), velocity: new Vec2(u2, 0), radius: 0.25, mass: m2 }));
    run(world, 2);

    expect(a.velocity.x).toBeCloseTo(v1, 9);
    expect(b.velocity.x).toBeCloseTo(v2, 9);
  });

  it("sends equal masses off at right angles after a glancing blow", () => {
    // The result every pool player relies on. It falls out of conservation of
    // momentum and energy together, so it fails if either the direction or the
    // magnitude of the impulse is wrong.
    const world = freeWorld();
    const a = world.add(new Body({ position: new Vec2(498, 500), velocity: new Vec2(4, 0), radius: 0.2 }));
    const b = world.add(new Body({ position: new Vec2(500, 500.15), radius: 0.2 }));
    run(world, 2);
    const cosine = a.velocity.normalized().dot(b.velocity.normalized());
    expect((Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI).toBeCloseTo(90, 6);
  });

  it("leaves bodies moving together at zero restitution", () => {
    const world = freeWorld({ restitution: 0 });
    const a = world.add(new Body({ position: new Vec2(499.5, 500), velocity: new Vec2(3, 0), radius: 0.2, mass: 1 }));
    const b = world.add(new Body({ position: new Vec2(500.5, 500), velocity: new Vec2(-1, 0), radius: 0.2, mass: 3 }));
    run(world, 1);
    const shared = (1 * 3 + 3 * -1) / 4;
    expect(a.velocity.x).toBeCloseTo(shared, 9);
    expect(b.velocity.x).toBeCloseTo(shared, 9);
  });
});

describe("conservation", () => {
  it("holds momentum and energy through a chaotic many-body run", () => {
    // Bodies go on a grid rather than at random: random placement starts a
    // crowd deeply interpenetrated, and unpicking that initial tangle -- not
    // the collisions afterwards -- is what would dominate the error.
    const world = freeWorld({ iterations: 12 });
    let seed = 12345;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const radius = 0.18;
    for (let row = 0; row < 9; row++) {
      for (let column = 0; column < 10; column++) {
        world.add(
          new Body({
            position: new Vec2(497 + column * 2.6 * radius, 498 + row * 2.6 * radius),
            velocity: new Vec2(random() * 1.6 - 0.8, random() * 1.6 - 0.8),
            radius: radius * (0.6 + random() * 0.4),
            mass: 1 + random() * 3,
          }),
        );
      }
    }
    const momentum = world.totalMomentum;
    const energy = world.kineticEnergy;
    run(world, 12, 1 / 240);

    expect(world.collisions).toBeGreaterThan(150);
    expect(world.totalMomentum.sub(momentum).length).toBeLessThan(1e-12);
    expect(Math.abs(world.kineticEnergy - energy) / energy).toBeLessThan(1e-9);
  });

  it("keeps bodies inside the box without draining energy", () => {
    const world = new World(8, 5, defaultParameters());
    let seed = 99;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 40; i++) {
      world.add(
        new Body({
          position: new Vec2(0.5 + random() * 7, 0.5 + random() * 4),
          velocity: new Vec2(random() * 6 - 3, random() * 6 - 3),
          radius: 0.06 + random() * 0.05,
          mass: 1 + random() * 2,
        }),
      );
    }
    const energy = world.kineticEnergy;
    run(world, 20, 1 / 240);

    for (const body of world.bodies) {
      expect(body.position.x).toBeGreaterThanOrEqual(body.radius - 1e-9);
      expect(body.position.x).toBeLessThanOrEqual(8 - body.radius + 1e-9);
      expect(body.position.y).toBeGreaterThanOrEqual(body.radius - 1e-9);
      expect(body.position.y).toBeLessThanOrEqual(5 - body.radius + 1e-9);
    }
    // Perfectly elastic walls may redirect momentum but must not drain energy.
    expect(Math.abs(world.kineticEnergy - energy) / energy).toBeLessThan(1e-5);
  });

  it("counts gravitational potential energy so free fall balances", () => {
    const world = new World(10, 10, defaultParameters({ gravity: new Vec2(0, 9.81) }));
    world.add(new Body({ position: new Vec2(5, 1), radius: 0.1 }));
    world.markReferenceEnergy();
    run(world, 0.5);
    expect(world.kineticEnergy).toBeGreaterThan(0);
    expect(Math.abs(world.energyDrift ?? 0)).toBeLessThan(5e-3);
  });
});

describe("robustness", () => {
  it("does not let a fast body tunnel through a slow one", () => {
    const world = freeWorld();
    const bullet = world.add(new Body({ position: new Vec2(100, 500), velocity: new Vec2(80, 0), radius: 0.1 }));
    const target = world.add(new Body({ position: new Vec2(110, 500), radius: 0.1 }));
    for (let i = 0; i < 60; i++) world.step(1 / 60);
    expect(target.velocity.x).toBeCloseTo(80, 6);
    expect(bullet.velocity.x).toBeCloseTo(0, 6);
  });

  it("never moves a static body", () => {
    const world = freeWorld();
    const peg = world.add(new Body({ position: new Vec2(500, 500), radius: 0.3, isStatic: true }));
    const ball = world.add(new Body({ position: new Vec2(499.2, 500), velocity: new Vec2(2, 0), radius: 0.2, mass: 2 }));
    run(world, 1);
    expect(peg.position.distanceTo(new Vec2(500, 500))).toBe(0);
    expect(ball.velocity.x).toBeCloseTo(-2, 9);
  });

  it("separates exactly coincident centres instead of failing", () => {
    // Vector normalisation has no answer here; a dense simulation hits this
    // case routinely, so it has to resolve rather than produce NaN.
    const world = freeWorld();
    const a = world.add(new Body({ position: new Vec2(500, 500), radius: 0.2 }));
    const b = world.add(new Body({ position: new Vec2(500, 500), radius: 0.2 }));
    run(world, 1, 1 / 60);
    expect(Number.isFinite(a.position.x)).toBe(true);
    expect(a.position.distanceTo(b.position)).toBeCloseTo(0.4, 2);
  });

  it("finds every overlapping pair in the broad phase", () => {
    // The broad phase may over-report, but it may never miss a real overlap.
    let seed = 7;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let trial = 0; trial < 200; trial++) {
      const bodies: Body[] = [];
      const count = 2 + Math.floor(random() * 58);
      for (let i = 0; i < count; i++) {
        bodies.push(
          new Body({
            position: new Vec2(random() * 12, random() * 8),
            radius: 0.05 + random() * 0.6,
          }),
        );
      }
      const truth = new Set<string>();
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i]!;
          const b = bodies[j]!;
          if (a.position.distanceTo(b.position) < a.radius + b.radius) truth.add(`${i},${j}`);
        }
      }
      const hash = new SpatialHash();
      hash.rebuild(bodies);
      const emitted: string[] = [];
      hash.forEachCandidatePair((i, j) => emitted.push(i < j ? `${i},${j}` : `${j},${i}`));
      expect(new Set(emitted).size).toBe(emitted.length);
      const found = new Set(emitted);
      for (const pair of truth) expect(found.has(pair)).toBe(true);
    }
  });
});

describe("collision records", () => {
  it("reports the impulse the textbook formula predicts", () => {
    // J = (1 + e) * v_approach / (1/m1 + 1/m2). The inspector shows this very
    // equation, so the number behind it had better be the same one.
    const restitution = 0.8;
    const world = freeWorld({ restitution });
    const m1 = 2;
    const m2 = 5;
    world.add(new Body({ position: new Vec2(499.5, 500), velocity: new Vec2(3, 0), radius: 0.15, mass: m1, label: "A" }));
    world.add(new Body({ position: new Vec2(500.5, 500), velocity: new Vec2(-1, 0), radius: 0.25, mass: m2, label: "B" }));
    run(world, 1);

    expect(world.log).toHaveLength(1);
    const record = world.log[0]!;
    const approach = 4;
    const expected = ((1 + restitution) * approach) / (1 / m1 + 1 / m2);

    expect(record.approachSpeed).toBeCloseTo(approach, 9);
    expect(record.impulse).toBeCloseTo(expected, 9);
    expect(record.separationSpeed).toBeCloseTo(restitution * approach, 9);
    expect(record.a.before.x).toBeCloseTo(3, 9);
    expect(record.b.before.x).toBeCloseTo(-1, 9);
    // Momentum change on each side must equal the recorded impulse.
    expect(m1 * (record.a.after.x - record.a.before.x)).toBeCloseTo(-record.impulse, 9);
    expect(m2 * (record.b.after.x - record.b.before.x)).toBeCloseTo(record.impulse, 9);
  });

  it("does not log the endless micro-contacts of a resting pile", () => {
    const world = new World(4, 3, defaultParameters({
      gravity: new Vec2(0, 9.81),
      restitution: 0.2,
      wallRestitution: 0.1,
      restitutionThreshold: 0.4,
    }));
    for (let i = 0; i < 12; i++) {
      world.add(new Body({ position: new Vec2(0.4 + i * 0.28, 0.5), radius: 0.12, mass: 1 }));
    }
    run(world, 8, 1 / 120);
    const settled = world.collisions;
    run(world, 8, 1 / 120);
    // Once everything has come to rest the counter should barely move.
    expect(world.collisions - settled).toBeLessThan(20);
  });
});
